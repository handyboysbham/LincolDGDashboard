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
  MAIL_FROM: "health-check@example.test",
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
    const pool = healthPool({ databaseRelease: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await expect(new HealthService(pool, configuration()).ready()).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["migrations"] },
    });
  });

  it("reports object-storage failure", async () => {
    const pool = healthPool();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    await expect(new HealthService(pool, configuration()).ready()).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["objectStorage"] },
    });
  });

  it("reports a missing required worker heartbeat", async () => {
    const pool = healthPool({ workerReady: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await expect(
      new HealthService(pool, configuration({ readyRequiresHeartbeat: true })).ready(),
    ).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["worker"] },
    });
  });

  it("reports a tenant queue whose dead letters exceed the threshold", async () => {
    const pool = healthPool({ deadLetters: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    await expect(
      new HealthService(pool, configuration({ readyMaxDeadLetterEvents: 0 })).ready(),
    ).rejects.toMatchObject({
      code: "SERVICE_NOT_READY",
      details: { failed: ["queue"] },
    });
  });
});

function healthPool(
  overrides: {
    databaseRelease?: string | null;
    deadLetters?: number;
    oldestAgeSeconds?: number;
    workerReady?: boolean;
  } = {},
): Pool {
  const client = {
    query: vi.fn((query: string) => {
      if (query.includes("with queue as")) {
        return Promise.resolve({
          rows: [
            {
              deadLetters: overrides.deadLetters ?? 0,
              oldestAgeSeconds: overrides.oldestAgeSeconds ?? 0,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn((query: string) => {
      if (query.includes("current_schema_release")) {
        return Promise.resolve({
          rows: [
            {
              release: "databaseRelease" in overrides ? overrides.databaseRelease : "1.10.0-rc.1",
            },
          ],
        });
      }
      if (query.includes("worker_heartbeats")) {
        return Promise.resolve({ rows: [{ ready: overrides.workerReady ?? true }] });
      }
      return Promise.resolve({ rows: [{ "?column?": 1 }] });
    }),
  } as unknown as Pool;
}
