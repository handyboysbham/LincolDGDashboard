import {
  auditEvents,
  checklistTemplateItems,
  checklistTemplates,
  companyPaymentAccounts,
  createDatabase,
  createDatabasePool,
  customerAccounts,
  organizations,
  outboxEvents,
  roles,
  runMigrations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

interface PaymentAccountResponse {
  id: string;
  isDefault: boolean;
  status: string;
}

interface ChecklistResponse {
  id: string;
  items: { id: string; label: string }[];
  status: string;
  version: number;
}

describe("Sprint 1.10.0 administration foundation", { concurrent: false }, () => {
  const databaseName = `ldg_administration_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const managedUserId = randomUUID();
  const dispatcherRoleId = randomUUID();
  const customerId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;

  const admin = () => initialized(adminPool, "admin pool");
  const migrator = () => initialized(migrationDatabase, "migration database");
  const runtime = () => initialized(runtimeDatabase, "runtime database");

  beforeAll(async () => {
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await admin().query(
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
    await runMigrations(migrator());
    await seedTenant(migrator(), {
      customerId,
      dispatcherRoleId,
      managedUserId,
      tenantId,
      userId,
    });
    await seedTenant(migrator(), {
      customerId: randomUUID(),
      dispatcherRoleId: randomUUID(),
      managedUserId: randomUUID(),
      tenantId: foreignTenantId,
      userId: foreignUserId,
    });

    process.env.DATABASE_URL = connectionString(
      environment("POSTGRES_RUNTIME_USER"),
      environment("POSTGRES_RUNTIME_PASSWORD"),
      databaseName,
    );
    process.env.DEVELOPMENT_TENANT_ID = tenantId;
    process.env.DEVELOPMENT_USER_ID = userId;
    process.env.DEVELOPMENT_PERMISSIONS = "*";
    process.env.WORKER_TENANT_IDS = tenantId;
    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
  }, 30_000);

  afterAll(async () => {
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

  it("creates a company-controlled receiving account idempotently and isolates it by tenant", async () => {
    const create = () =>
      fastify.inject({
        headers: { "idempotency-key": "administration-payment-account-1" },
        method: "POST",
        payload: {
          accountReference: "billing@lincolndg.example",
          code: "operating-zelle",
          isDefault: true,
          name: "Lincoln DG Zelle",
          paymentMethod: "zelle",
        },
        url: "/api/v1/administration/payment-accounts",
      });
    const first = await create();
    expect(first.statusCode).toBe(201);
    const account = first.json<PaymentAccountResponse>();
    expect(account).toMatchObject({ isDefault: true, status: "active" });
    expect((await create()).json<PaymentAccountResponse>().id).toBe(account.id);

    const tenantRows = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.select().from(companyPaymentAccounts),
    );
    const foreignRows = await withTenantTransaction(runtime(), foreignTenantId, (transaction) =>
      transaction.select().from(companyPaymentAccounts),
    );
    expect(tenantRows).toHaveLength(1);
    expect(foreignRows).toHaveLength(0);

    const foreignAction = await fastify.inject({
      headers: { "idempotency-key": "administration-foreign-account" },
      method: "POST",
      url: `/api/v1/administration/payment-accounts/${randomUUID()}/actions/deactivate`,
    });
    expect(foreignAction.statusCode).toBe(404);
  });

  it("publishes immutable checklist versions and retires the prior version", async () => {
    const firstDraft = await createChecklist("administration-checklist-create-1", [
      "Confirm delivery location",
      "Capture placement evidence",
    ]);
    expect(firstDraft).toMatchObject({ status: "draft", version: 1 });
    const firstPublished = await publishChecklist(
      firstDraft.id,
      "administration-checklist-publish-1",
    );
    expect(firstPublished.status).toBe("published");

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantId, async (transaction) => {
        await transaction
          .update(checklistTemplateItems)
          .set({ label: "Attempted rewrite" })
          .where(
            eq(
              checklistTemplateItems.id,
              initialized(firstPublished.items[0], "published checklist item").id,
            ),
          );
      }),
      "Published Checklist Template Items are immutable",
    );

    const secondDraft = await createChecklist("administration-checklist-create-2", [
      "Confirm delivery location",
      "Capture ticket",
      "Capture placement evidence",
    ]);
    expect(secondDraft.version).toBe(2);
    const secondPublished = await publishChecklist(
      secondDraft.id,
      "administration-checklist-publish-2",
    );
    expect(secondPublished.status).toBe("published");

    const versions = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(checklistTemplates)
        .where(eq(checklistTemplates.templateCode, "delivery-completion")),
    );
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstDraft.id, status: "retired" }),
        expect.objectContaining({ id: secondDraft.id, status: "published" }),
      ]),
    );

    const emptyDraft = await createChecklist("administration-checklist-create-empty", []);
    const emptyPublish = await fastify.inject({
      headers: { "idempotency-key": "administration-checklist-publish-empty" },
      method: "POST",
      url: `/api/v1/administration/checklist-templates/${emptyDraft.id}/actions/publish`,
    });
    expect(emptyPublish.statusCode).toBe(422);
    expect(emptyPublish.json()).toMatchObject({ error: { code: "CHECKLIST_TEMPLATE_EMPTY" } });
  });

  it("manages Users, supplier facilities, search, and filtered Audit Events", async () => {
    const externalSubject = randomUUID();
    const identityLinked = await fastify.inject({
      headers: { "idempotency-key": "administration-user-identity-1" },
      method: "POST",
      payload: { externalSubject },
      url: `/api/v1/administration/users/${managedUserId}/identity`,
    });
    expect(identityLinked.statusCode).toBe(200);
    expect(identityLinked.json()).toMatchObject({ identityLinked: true });
    const identityReplay = await fastify.inject({
      headers: { "idempotency-key": "administration-user-identity-1" },
      method: "POST",
      payload: { externalSubject },
      url: `/api/v1/administration/users/${managedUserId}/identity`,
    });
    expect(identityReplay.json()).toEqual(identityLinked.json());
    const duplicateIdentity = await fastify.inject({
      headers: { "idempotency-key": "administration-user-identity-duplicate" },
      method: "POST",
      payload: { externalSubject },
      url: `/api/v1/administration/users/${userId}/identity`,
    });
    expect(duplicateIdentity.statusCode).toBe(409);
    expect(duplicateIdentity.json()).toMatchObject({
      error: { code: "AUTHENTICATION_IDENTITY_ALREADY_LINKED" },
    });

    const assigned = await fastify.inject({
      headers: { "idempotency-key": "administration-user-role-1" },
      method: "POST",
      payload: { roleId: dispatcherRoleId },
      url: `/api/v1/administration/users/${managedUserId}/roles/actions/assign`,
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toMatchObject({ roles: [{ code: "dispatcher" }] });

    const selfDeactivate = await fastify.inject({
      headers: { "idempotency-key": "administration-self-deactivate" },
      method: "POST",
      url: `/api/v1/administration/users/${userId}/actions/deactivate`,
    });
    expect(selfDeactivate.statusCode).toBe(409);
    expect(selfDeactivate.json()).toMatchObject({
      error: { code: "USER_SELF_DEACTIVATION_FORBIDDEN" },
    });

    const supplier = await fastify.inject({
      headers: { "idempotency-key": "administration-supplier-1" },
      method: "POST",
      payload: { name: "Lancaster Aggregate" },
      url: "/api/v1/administration/suppliers",
    });
    expect(supplier.statusCode).toBe(201);
    const supplierId = supplier.json<{ id: string }>().id;
    const facility = await fastify.inject({
      headers: { "idempotency-key": "administration-facility-1" },
      method: "POST",
      payload: { addressSummary: "Lincoln, Nebraska", label: "South Pit" },
      url: `/api/v1/administration/suppliers/${supplierId}/facilities`,
    });
    expect(facility.statusCode).toBe(201);
    expect(facility.json()).toMatchObject({ facilities: [{ label: "South Pit" }] });

    const search = await fastify.inject({
      method: "GET",
      url: "/api/v1/administration/search?q=Lincoln",
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      items: [{ id: customerId, primaryLabel: "Lincoln Customer", type: "customer" }],
      query: "Lincoln",
    });

    const history = await fastify.inject({
      method: "GET",
      url: "/api/v1/administration/audit-events?entityType=ChecklistTemplate&limit=20",
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ items: { entityType: string }[] }>().items.length).toBeGreaterThan(0);
    expect(
      history
        .json<{ items: { entityType: string }[] }>()
        .items.every((event) => event.entityType === "ChecklistTemplate"),
    ).toBe(true);
  });

  it("returns a tenant-safe operational workspace with append-only command evidence", async () => {
    const response = await fastify.inject({ method: "GET", url: "/api/v1/administration" });
    expect(response.statusCode).toBe(200);
    const workspace = response.json<{
      checklistTemplates: ChecklistResponse[];
      overview: {
        checklistTemplates: { total: number };
        paymentAccounts: { total: number };
        users: { total: number };
      };
      paymentAccounts: { code: string }[];
      suppliers: { name: string }[];
    }>();
    expect(workspace.checklistTemplates).toHaveLength(3);
    expect(workspace).toMatchObject({
      overview: {
        checklistTemplates: { total: 3 },
        paymentAccounts: { total: 1 },
        users: { total: 2 },
      },
      paymentAccounts: [expect.objectContaining({ code: "operating-zelle" })],
      suppliers: [expect.objectContaining({ name: "Lancaster Aggregate" })],
    });
    const evidence = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      audit: await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.eventType, "administration.payment_account_created")),
      outbox: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "administration.payment_account_created")),
    }));
    expect(evidence.audit).toHaveLength(1);
    expect(evidence.outbox).toHaveLength(1);
  });

  async function createChecklist(key: string, labels: string[]): Promise<ChecklistResponse> {
    const response = await fastify.inject({
      headers: { "idempotency-key": key },
      method: "POST",
      payload: {
        items: labels.map((label, index) => ({
          label,
          requiresEvidence: label.includes("evidence"),
          responseType: "confirmation",
          sequence: index + 1,
        })),
        name: "Delivery completion",
        required: true,
        serviceType: "material_delivery",
        templateCode: "delivery-completion",
      },
      url: "/api/v1/administration/checklist-templates",
    });
    expect(response.statusCode).toBe(201);
    return response.json<ChecklistResponse>();
  }

  async function publishChecklist(id: string, key: string): Promise<ChecklistResponse> {
    const response = await fastify.inject({
      headers: { "idempotency-key": key },
      method: "POST",
      url: `/api/v1/administration/checklist-templates/${id}/actions/publish`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<ChecklistResponse>();
  }
});

async function seedTenant(
  database: Database,
  input: {
    customerId: string;
    dispatcherRoleId: string;
    managedUserId: string;
    tenantId: string;
    userId: string;
  },
): Promise<void> {
  await withTenantTransaction(database, input.tenantId, async (transaction) => {
    await transaction.insert(organizations).values({
      displayName: "Lincoln Administration",
      id: input.tenantId,
      legalName: "Lincoln Administration LLC",
    });
    await transaction.insert(users).values([
      {
        displayName: "Administration Owner",
        email: `${input.userId}@example.test`,
        id: input.userId,
        tenantId: input.tenantId,
      },
      {
        displayName: "Managed Dispatcher",
        email: `${input.managedUserId}@example.test`,
        id: input.managedUserId,
        tenantId: input.tenantId,
      },
    ]);
    await transaction.insert(roles).values({
      code: "dispatcher",
      id: input.dispatcherRoleId,
      name: "Dispatcher",
      permissions: ["administration:read"],
      tenantId: input.tenantId,
    });
    await transaction.insert(customerAccounts).values({
      customerType: "individual",
      displayName: "Lincoln Customer",
      id: input.customerId,
      normalizedName: "lincoln customer",
      ownerUserId: input.userId,
      tenantId: input.tenantId,
    });
  });
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for administration integration tests`);
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

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(databaseErrorText(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected database failure containing: ${expectedMessage}`);
}

function databaseErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined
    ? error.message
    : `${error.message}\n${databaseErrorText(error.cause)}`;
}
