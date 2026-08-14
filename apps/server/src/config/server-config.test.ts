import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./server-config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  API_PORT: "3001",
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
  MAIL_FROM: "local@example.test",
  WEB_ORIGIN: "http://127.0.0.1:3000",
};

describe("loadServerConfig", () => {
  it("loads a guarded local development configuration", () => {
    const configuration = loadServerConfig(baseEnvironment);

    expect(configuration.auth.mode).toBe("development");
    expect(configuration.worker.tenantIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(configuration.api.port).toBe(3001);
    expect(configuration.objectStorage.provider).toBe("s3");
    expect(configuration.objectStorage.s3?.bucket).toBe("documents");
    expect(configuration.objectStorage.maxUploadBytes).toBe(20_971_520);
    expect(configuration.notifications).toMatchObject({
      emailProvider: "capture",
      reminderLeadMinutes: 1440,
      smsProvider: "disabled",
    });
  });

  it("rejects development authentication outside local development", () => {
    expect(() => loadServerConfig({ ...baseEnvironment, APP_ENV: "production" })).toThrow(
      "AUTH_MODE=development is allowed only when APP_ENV=local",
    );
  });

  it("loads production JWT verification without development identities", () => {
    const configuration = loadServerConfig({
      ...baseEnvironment,
      APP_ENV: "production",
      AUTH_JWT_AUDIENCE: "authenticated",
      AUTH_JWT_ISSUER: "https://example.supabase.co/auth/v1",
      AUTH_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      AUTH_MODE: "jwt",
      DEVELOPMENT_TENANT_ID: undefined,
      DEVELOPMENT_USER_ID: undefined,
      WORKER_TENANT_IDS: "00000000-0000-4000-8000-000000000001",
    });

    expect(configuration.auth).toEqual({
      audience: "authenticated",
      issuer: "https://example.supabase.co/auth/v1",
      jwksUrl: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      mode: "jwt",
    });
  });

  it("requires explicit worker tenants and JWT endpoints in JWT mode", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        APP_ENV: "production",
        AUTH_MODE: "jwt",
        DEVELOPMENT_TENANT_ID: undefined,
        DEVELOPMENT_USER_ID: undefined,
        WORKER_TENANT_IDS: undefined,
      }),
    ).toThrow("AUTH_JWT_AUDIENCE is required");
  });

  it("rejects invalid worker tenant identifiers", () => {
    expect(() => loadServerConfig({ ...baseEnvironment, WORKER_TENANT_IDS: "not-a-uuid" })).toThrow(
      "WORKER_TENANT_IDS must be a valid UUID",
    );
  });

  it("requires provider credentials only when a production adapter is selected", () => {
    expect(() =>
      loadServerConfig({ ...baseEnvironment, NOTIFICATION_EMAIL_PROVIDER: "resend" }),
    ).toThrow("NOTIFICATION_EMAIL_API_KEY is required");
    expect(() =>
      loadServerConfig({ ...baseEnvironment, NOTIFICATION_SMS_PROVIDER: "twilio" }),
    ).toThrow("NOTIFICATION_SMS_ACCOUNT_SID is required");
  });

  it("loads Google Drive credentials only for the Google Drive document provider", () => {
    const privateKey = Buffer.from(
      "-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----\n",
    ).toString("base64");
    const configuration = loadServerConfig({
      ...baseEnvironment,
      DOCUMENT_STORAGE_PROVIDER: "google_drive",
      GOOGLE_DRIVE_DOCUMENT_FOLDER_ID: "documents-folder",
      GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "storage@example.iam.gserviceaccount.com",
      GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64: privateKey,
      GOOGLE_DRIVE_SHARED_DRIVE_ID: "shared-drive",
      MINIO_APP_PASSWORD: undefined,
      MINIO_APP_USER: undefined,
      MINIO_BUCKET: undefined,
      MINIO_ENDPOINT: undefined,
    });

    expect(configuration.objectStorage).toMatchObject({
      googleDrive: {
        documentFolderId: "documents-folder",
        serviceAccountEmail: "storage@example.iam.gserviceaccount.com",
        sharedDriveId: "shared-drive",
      },
      provider: "google_drive",
      s3: undefined,
    });
  });
});
