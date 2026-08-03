import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Logger } from "@nestjs/common";
import {
  auditEvents,
  createDatabase,
  createDatabasePool,
  documentPublicLinks,
  documents,
  organizations,
  outboxEvents,
  runMigrations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ApiApplication } from "../../src/create-api-application.js";
import { createApiApplication } from "../../src/create-api-application.js";
import { DocumentTokenService } from "../../src/documents/document-token.service.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

interface UploadResponse {
  document: { id: string; originalFilename: string; status: string };
  upload: { headers: Record<string, string>; url: string };
}

interface PublicLinkResponse {
  expiresAt: string;
  linkId: string;
  scope: string;
  token: string;
}

describe("document foundation", { concurrent: false }, () => {
  const databaseName = `ldg_documents_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  const foreignDocumentId = randomUUID();
  const objectKeys = new Set<string>();
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;
  let storageClient: S3Client | undefined;
  let availableDocumentId = "";
  const runtime = () => initialized(runtimeDatabase, "runtime database");

  beforeAll(async () => {
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await initialized(adminPool, "admin pool").query(
      `create database "${databaseName}" owner "${environment("POSTGRES_MIGRATION_USER")}"`,
    );
    databaseCreated = true;
    migrationPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_MIGRATION_USER"),
        environment("POSTGRES_MIGRATION_PASSWORD"),
        databaseName,
      ),
    );
    runtimePool = createDatabasePool(
      connectionString(
        environment("POSTGRES_RUNTIME_USER"),
        environment("POSTGRES_RUNTIME_PASSWORD"),
        databaseName,
      ),
    );
    migrationDatabase = createDatabase(migrationPool);
    runtimeDatabase = createDatabase(runtimePool);
    await runMigrations(initialized(migrationDatabase, "migration database"));
    await seedTenant(initialized(migrationDatabase, "migration database"), tenantId, userId);
    await seedTenant(
      initialized(migrationDatabase, "migration database"),
      foreignTenantId,
      foreignUserId,
    );
    await withTenantTransaction(
      initialized(migrationDatabase, "migration database"),
      foreignTenantId,
      (transaction) =>
        transaction.insert(documents).values({
          availableAt: new Date(),
          id: foreignDocumentId,
          mediaType: "text/plain",
          objectKey: `tenants/${foreignTenantId}/documents/${foreignDocumentId}`,
          originalFilename: "foreign-document.txt",
          sha256: createHash("sha256").update("foreign").digest("hex"),
          sizeBytes: 7,
          status: "available",
          tenantId: foreignTenantId,
        }),
    );

    process.env.DATABASE_URL = connectionString(
      environment("POSTGRES_RUNTIME_USER"),
      environment("POSTGRES_RUNTIME_PASSWORD"),
      databaseName,
    );
    process.env.DEVELOPMENT_TENANT_ID = tenantId;
    process.env.DEVELOPMENT_USER_ID = userId;
    process.env.WORKER_TENANT_IDS = tenantId;

    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
    storageClient = new S3Client({
      credentials: {
        accessKeyId: environment("MINIO_APP_USER"),
        secretAccessKey: environment("MINIO_APP_PASSWORD"),
      },
      endpoint: environment("MINIO_ENDPOINT"),
      forcePathStyle: true,
      region: environment("MINIO_REGION"),
    });
  }, 30_000);

  afterAll(async () => {
    for (const key of objectKeys) {
      await storageClient?.send(
        new DeleteObjectCommand({ Bucket: environment("MINIO_BUCKET"), Key: key }),
      );
    }
    storageClient?.destroy();
    await api?.application.close();
    await runtimePool?.end();
    await migrationPool?.end();
    if (adminPool && databaseCreated) {
      await adminPool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [databaseName],
      );
      await adminPool.query(`drop database if exists "${databaseName}"`);
    }
    await adminPool?.end();
  });

  it("uploads, validates, audits, and downloads one private document", async () => {
    const body = new TextEncoder().encode("delivery ticket 7421\n");
    const payload = {
      mediaType: "text/plain",
      originalFilename: "delivery-ticket.txt",
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.byteLength,
    };
    const created = await fastify.inject({
      headers: { "idempotency-key": "document-upload-1" },
      method: "POST",
      payload,
      url: "/api/v1/documents/uploads",
    });
    expect(created.statusCode).toBe(201);
    const upload = created.json<UploadResponse>();
    availableDocumentId = upload.document.id;
    objectKeys.add(`tenants/${tenantId}/documents/${availableDocumentId}`);

    const replay = await fastify.inject({
      headers: { "idempotency-key": "document-upload-1" },
      method: "POST",
      payload,
      url: "/api/v1/documents/uploads",
    });
    expect(replay.json<UploadResponse>().document.id).toBe(availableDocumentId);

    const put = await fetch(upload.upload.url, {
      body,
      headers: upload.upload.headers,
      method: "PUT",
    });
    expect(put.status).toBe(200);

    const completed = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${availableDocumentId}/actions/complete`,
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ id: availableDocumentId, status: "available" });
    const completedReplay = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${availableDocumentId}/actions/complete`,
    });
    expect(completedReplay.json()).toMatchObject({ status: "available" });

    const download = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${availableDocumentId}/actions/download`,
    });
    expect(download.statusCode).toBe(200);
    const downloaded = await fetch(download.json<{ url: string }>().url);
    expect(await downloaded.text()).toBe("delivery ticket 7421\n");

    const persisted = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      audit: await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, availableDocumentId)),
      document: await transaction.query.documents.findFirst({
        where: (table, operators) => operators.eq(table.id, availableDocumentId),
      }),
      outbox: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, availableDocumentId)),
    }));
    expect(persisted.document?.status).toBe("available");
    expect(persisted.audit.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["document.pending_created", "document.available"]),
    );
    expect(persisted.outbox.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["document.pending_created", "document.available"]),
    );
  });

  it("rejects invalid content and prevents its download", async () => {
    const body = new TextEncoder().encode("actual content");
    const created = await fastify.inject({
      headers: { "idempotency-key": "document-upload-invalid" },
      method: "POST",
      payload: {
        mediaType: "text/plain",
        originalFilename: "invalid.txt",
        sha256: "0".repeat(64),
        sizeBytes: body.byteLength,
      },
      url: "/api/v1/documents/uploads",
    });
    const upload = created.json<UploadResponse>();
    objectKeys.add(`tenants/${tenantId}/documents/${upload.document.id}`);
    await fetch(upload.upload.url, { body, headers: upload.upload.headers, method: "PUT" });

    const completed = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${upload.document.id}/actions/complete`,
    });
    expect(completed.statusCode).toBe(422);
    expect(completed.json()).toMatchObject({
      error: { code: "DOCUMENT_VALIDATION_FAILED" },
    });
    const download = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${upload.document.id}/actions/download`,
    });
    expect(download.statusCode).toBe(409);
  });

  it("denies authenticated cross-tenant document access", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${foreignDocumentId}/actions/download`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "DOCUMENT_NOT_FOUND" } });
  });

  it("creates idempotent hashed public links and enforces revocation", async () => {
    const request = () =>
      fastify.inject({
        headers: { "idempotency-key": "public-link-1" },
        method: "POST",
        payload: { expiresInSeconds: 3600, scope: "download" },
        url: `/api/v1/documents/${availableDocumentId}/public-links`,
      });
    const first = (await request()).json<PublicLinkResponse>();
    const replay = (await request()).json<PublicLinkResponse>();
    expect(replay).toEqual(first);

    const [stored] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(documentPublicLinks)
        .where(eq(documentPublicLinks.id, first.linkId)),
    );
    expect(stored?.tokenHash).not.toContain(first.token);
    expect(JSON.stringify(stored)).not.toContain(first.token);

    const resolved = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/document-links/${encodeURIComponent(first.token)}`,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.headers["cache-control"]).toBe("no-store");
    expect(resolved.json()).toMatchObject({ document: { id: availableDocumentId } });

    const revoked = await fastify.inject({
      method: "POST",
      url: `/api/v1/documents/${availableDocumentId}/public-links/${first.linkId}/actions/revoke`,
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevocation = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/document-links/${encodeURIComponent(first.token)}`,
    });
    expect(afterRevocation.statusCode).toBe(410);
    expect(afterRevocation.json()).toMatchObject({ error: { code: "PUBLIC_LINK_REVOKED" } });
  });

  it("rejects expired and tampered public links without logging secrets", async () => {
    const linkId = randomUUID();
    const tokenService = initialized(api, "API application").application.get(DocumentTokenService);
    const token = tokenService.create({ documentId: availableDocumentId, linkId, tenantId });
    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.insert(documentPublicLinks).values({
        createdAt: new Date(Date.now() - 7_200_000),
        creationKeyHash: createHash("sha256").update(randomUUID()).digest("hex"),
        documentId: availableDocumentId,
        expiresAt: new Date(Date.now() - 3_600_000),
        id: linkId,
        requestHash: createHash("sha256").update("expired-request").digest("hex"),
        scope: "download",
        tenantId,
        tokenHash: token.hash,
        updatedAt: new Date(Date.now() - 7_200_000),
      }),
    );
    const logged: string[] = [];
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    const expired = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/document-links/${encodeURIComponent(token.token)}`,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({ error: { code: "PUBLIC_LINK_EXPIRED" } });
    const tampered = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/document-links/${encodeURIComponent(`${token.token}tampered`)}`,
    });
    expect(tampered.statusCode).toBe(404);
    expect(logged.join(" ")).not.toContain(token.token);
    expect(logged.join(" ")).not.toContain("X-Amz-Signature");
    expect(logged.join(" ")).not.toContain(environment("MINIO_APP_PASSWORD"));
    errorSpy.mockRestore();
  });
});

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for document integration tests`);
  return value;
}

function connectionString(user: string, password: string, database: string): string {
  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = password;
  url.hostname = environment("POSTGRES_HOST");
  url.port = environment("POSTGRES_PORT");
  url.pathname = `/${database}`;
  return url.toString();
}

function initialized<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not initialized`);
  return value;
}

async function seedTenant(database: Database, tenantId: string, userId: string): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(organizations).values({
      displayName: "Document Test",
      id: tenantId,
      legalName: "Document Test",
    });
    await transaction.insert(users).values({
      displayName: "Document Test User",
      email: `${userId}@example.test`,
      id: userId,
      tenantId,
    });
  });
}
