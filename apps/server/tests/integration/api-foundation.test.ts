import { createDatabase, createDatabasePool, runMigrations, type Pool } from "@ldg/database";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

describe("API foundation", () => {
  const databaseName = `ldg_api_foundation_${randomUUID().replaceAll("-", "")}`;
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let databaseCreated = false;

  beforeAll(async () => {
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await adminPool.query(
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
    await runMigrations(createDatabase(migrationPool));
    process.env.DATABASE_URL = connectionString(
      environment("POSTGRES_RUNTIME_USER"),
      environment("POSTGRES_RUNTIME_PASSWORD"),
      databaseName,
    );
    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
  }, 30_000);

  afterAll(async () => {
    await api?.application.close();
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

  it("reports process liveness with request correlation", async () => {
    const response = await fastify.inject({
      headers: { "x-request-id": "test-correlation-1" },
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["x-request-id"]).toBe("test-correlation-1");
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("reports database, migration, and object-storage readiness", async () => {
    const response = await fastify.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      checks: {
        database: "ready",
        migrations: "ready",
        objectStorage: "ready",
        worker: "skipped",
      },
      status: "ready",
    });
  });

  it("uses the server-configured development actor", async () => {
    const response = await fastify.inject({ method: "GET", url: "/api/v1/session" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tenantId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000201",
    });
  });

  it("rejects browser-selected tenant context", async () => {
    const response = await fastify.inject({
      headers: {
        "x-request-id": "tenant-spoof-test",
        "x-tenant-id": "00000000-0000-4000-8000-000000000002",
      },
      method: "GET",
      url: "/api/v1/session",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "TENANT_HEADER_FORBIDDEN",
        correlationId: "tenant-spoof-test",
        message: "Tenant context cannot be selected by request header",
      },
    });
  });

  it("returns stable errors without leaking framework details", async () => {
    const response = await fastify.inject({
      headers: { "x-request-id": "missing-route-test" },
      method: "GET",
      url: "/api/v1/not-a-route",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "HTTP_ERROR",
        correlationId: "missing-route-test",
      },
    });
  });

  it("serves the generated OpenAPI document route", async () => {
    const response = await fastify.inject({ method: "GET", url: "/api/docs/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ info: { version: "1.10.0" }, openapi: "3.0.0" });
  });

  it("allows the configured web origin without exposing tenant headers", async () => {
    const webOrigin = process.env.WEB_ORIGIN;
    if (!webOrigin) throw new Error("WEB_ORIGIN is required for API integration tests");
    const response = await fastify.inject({
      headers: {
        "access-control-request-method": "POST",
        origin: webOrigin,
      },
      method: "OPTIONS",
      url: "/api/v1/documents/uploads",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(webOrigin);
    expect(response.headers["access-control-allow-headers"]).not.toContain("x-tenant-id");
  });
});

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for API integration tests`);
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
