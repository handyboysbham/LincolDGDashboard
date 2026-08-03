import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./server-config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  API_PORT: "3001",
  APP_ENV: "local",
  AUTH_MODE: "development",
  DATABASE_URL: "postgresql://app:password@127.0.0.1:5432/database",
  DEVELOPMENT_TENANT_ID: "00000000-0000-4000-8000-000000000001",
  DEVELOPMENT_USER_ID: "00000000-0000-4000-8000-000000000201",
  MINIO_BUCKET: "documents",
  MINIO_ENDPOINT: "http://127.0.0.1:9000",
};

describe("loadServerConfig", () => {
  it("loads a guarded local development configuration", () => {
    const configuration = loadServerConfig(baseEnvironment);

    expect(configuration.auth.mode).toBe("development");
    expect(configuration.worker.tenantIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(configuration.api.port).toBe(3001);
  });

  it("rejects development authentication outside local development", () => {
    expect(() => loadServerConfig({ ...baseEnvironment, APP_ENV: "production" })).toThrow(
      "AUTH_MODE=development is allowed only when APP_ENV=local",
    );
  });

  it("rejects invalid worker tenant identifiers", () => {
    expect(() => loadServerConfig({ ...baseEnvironment, WORKER_TENANT_IDS: "not-a-uuid" })).toThrow(
      "WORKER_TENANT_IDS must be a valid UUID",
    );
  });
});
