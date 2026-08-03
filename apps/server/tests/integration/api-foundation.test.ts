import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

describe("API foundation", () => {
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;

  beforeAll(async () => {
    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await api?.application.close();
  });

  it("reports process liveness with request correlation", async () => {
    const response = await fastify.inject({
      headers: { "x-request-id": "test-correlation-1" },
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("test-correlation-1");
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("reports database, migration, and object-storage readiness", async () => {
    const response = await fastify.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
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
    expect(response.json()).toMatchObject({ info: { version: "1.4.0" }, openapi: "3.0.0" });
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
