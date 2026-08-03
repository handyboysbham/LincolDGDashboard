import type { Pool } from "@ldg/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadServerConfig, type ServerConfig } from "../config/server-config.js";
import type { ServerConfigService } from "../config/server-config.service.js";
import { HealthService } from "./health.service.js";

const environment: NodeJS.ProcessEnv = {
  APP_ENV: "local",
  AUTH_MODE: "development",
  DATABASE_URL: "postgresql://app:password@127.0.0.1:5432/database",
  DEVELOPMENT_TENANT_ID: "00000000-0000-4000-8000-000000000001",
  DEVELOPMENT_USER_ID: "00000000-0000-4000-8000-000000000201",
  DOCUMENT_PUBLIC_LINK_SIGNING_KEY: "unit-test-signing-key-with-32-characters",
  MINIO_APP_PASSWORD: "object-storage-secret",
  MINIO_APP_USER: "object-storage-user",
  MINIO_BUCKET: "documents",
  MINIO_ENDPOINT: "http://127.0.0.1:9000",
  WEB_ORIGIN: "http://127.0.0.1:3000",
};

function configuration(overrides: Partial<ServerConfig["worker"]> = {}): ServerConfigService {
  const base = loadServerConfig(environment);
  return {
    value: { ...base, worker: { ...base.worker, ...overrides } },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("HealthService readiness", () => {
  it("reports a missing migration without exposing connection details", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
        .mockResolvedValueOnce({ rows: [{ current_tenant: null, organizations: null }] }),
    } as unknown as Pool;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await expect(new HealthService(pool, configuration()).ready()).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["migrations"] },
    });
  });

  it("reports object-storage failure", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
        .mockResolvedValueOnce({
          rows: [{ current_tenant: "current_tenant_id()", organizations: "organizations" }],
        }),
    } as unknown as Pool;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(new HealthService(pool, configuration()).ready()).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["objectStorage"] },
    });
  });

  it("reports a missing required worker heartbeat", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ "?column?": 1 }] })
        .mockResolvedValueOnce({
          rows: [{ current_tenant: "current_tenant_id()", organizations: "organizations" }],
        })
        .mockResolvedValueOnce({ rows: [{ ready: false }] }),
    } as unknown as Pool;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await expect(
      new HealthService(pool, configuration({ readyRequiresHeartbeat: true })).ready(),
    ).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["worker"] },
    });
  });
});
