import { hostname } from "node:os";

type AppEnvironment = "local" | "production" | "staging" | "test";

export interface ServerConfig {
  api: {
    host: string;
    port: number;
  };
  appEnvironment: AppEnvironment;
  auth:
    | {
        developmentPermissions: string[];
        developmentTenantId: string;
        developmentUserId: string;
        mode: "development";
      }
    | {
        audience: string;
        issuer: string;
        jwksUrl: string;
        mode: "jwt";
      };
  databaseUrl: string;
  databasePoolMax: number;
  expectedDatabaseRelease: string;
  notifications: {
    emailApiKey: string | null;
    emailApiUrl: string;
    emailFrom: string;
    emailProvider: "capture" | "resend";
    reminderLeadMinutes: number;
    smsAccountSid: string | null;
    smsAuthToken: string | null;
    smsFrom: string | null;
    smsProvider: "capture" | "disabled" | "twilio";
    timeoutMs: number;
    twilioApiBaseUrl: string;
  };
  observability: {
    requestLoggingEnabled: boolean;
  };
  objectStorage: {
    accessKeyId: string;
    bucket: string;
    endpoint: string;
    forcePathStyle: boolean;
    healthUrl: string;
    maxUploadBytes: number;
    presignExpiresSeconds: number;
    publicLinkDefaultExpiresSeconds: number;
    publicLinkSigningKey: string;
    region: string;
    secretAccessKey: string;
  };
  web: {
    origin: string;
  };
  worker: {
    heartbeatIntervalMs: number;
    heartbeatStaleAfterMs: number;
    id: string;
    leaseSeconds: number;
    maxAttempts: number;
    pollIntervalMs: number;
    readyRequiresHeartbeat: boolean;
    readyMaxDeadLetterEvents: number;
    readyMaxOutboxAgeSeconds: number;
    tenantIds: string[];
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loadServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const appEnvironment = enumValue("APP_ENV", environment.APP_ENV, [
    "local",
    "test",
    "staging",
    "production",
  ] as const);
  const authMode = enumValue("AUTH_MODE", environment.AUTH_MODE, ["development", "jwt"] as const);

  if (authMode === "development" && appEnvironment !== "local") {
    throw new Error("AUTH_MODE=development is allowed only when APP_ENV=local");
  }

  const auth =
    authMode === "development"
      ? {
          developmentPermissions: csv(environment.DEVELOPMENT_PERMISSIONS ?? "*"),
          developmentTenantId: requiredUuid(
            "DEVELOPMENT_TENANT_ID",
            environment.DEVELOPMENT_TENANT_ID,
          ),
          developmentUserId: requiredUuid("DEVELOPMENT_USER_ID", environment.DEVELOPMENT_USER_ID),
          mode: authMode,
        }
      : {
          audience: required("AUTH_JWT_AUDIENCE", environment.AUTH_JWT_AUDIENCE),
          issuer: requiredUrl("AUTH_JWT_ISSUER", environment.AUTH_JWT_ISSUER).replace(/\/$/, ""),
          jwksUrl: requiredUrl("AUTH_JWKS_URL", environment.AUTH_JWKS_URL),
          mode: authMode,
        };
  const defaultWorkerTenantIds = auth.mode === "development" ? auth.developmentTenantId : undefined;
  const workerTenantIds = csv(
    required("WORKER_TENANT_IDS", environment.WORKER_TENANT_IDS ?? defaultWorkerTenantIds),
  );
  for (const tenantId of workerTenantIds) {
    requiredUuid("WORKER_TENANT_IDS", tenantId);
  }

  const minioEndpoint = required("MINIO_ENDPOINT", environment.MINIO_ENDPOINT).replace(/\/$/, "");
  const emailProvider = enumValue(
    "NOTIFICATION_EMAIL_PROVIDER",
    environment.NOTIFICATION_EMAIL_PROVIDER ?? "capture",
    ["capture", "resend"] as const,
  );
  const smsProvider = enumValue(
    "NOTIFICATION_SMS_PROVIDER",
    environment.NOTIFICATION_SMS_PROVIDER ?? "disabled",
    ["capture", "disabled", "twilio"] as const,
  );

  return {
    api: {
      host: environment.API_HOST ?? "127.0.0.1",
      port: integer("API_PORT", environment.API_PORT ?? "3001", 1, 65_535),
    },
    appEnvironment,
    auth,
    databaseUrl: required("DATABASE_URL", environment.DATABASE_URL),
    databasePoolMax: integer("DATABASE_POOL_MAX", environment.DATABASE_POOL_MAX ?? "20", 1, 100),
    expectedDatabaseRelease: required(
      "EXPECTED_DATABASE_RELEASE",
      environment.EXPECTED_DATABASE_RELEASE ?? "1.10.0-rc.2",
    ),
    notifications: {
      emailApiKey:
        emailProvider === "resend"
          ? required("NOTIFICATION_EMAIL_API_KEY", environment.NOTIFICATION_EMAIL_API_KEY)
          : null,
      emailApiUrl: (environment.NOTIFICATION_EMAIL_API_URL ?? "https://api.resend.com").replace(
        /\/$/,
        "",
      ),
      emailFrom: required("MAIL_FROM", environment.MAIL_FROM),
      emailProvider,
      reminderLeadMinutes: integer(
        "NOTIFICATION_REMINDER_LEAD_MINUTES",
        environment.NOTIFICATION_REMINDER_LEAD_MINUTES ?? "1440",
        5,
        10_080,
      ),
      smsAccountSid:
        smsProvider === "twilio"
          ? required("NOTIFICATION_SMS_ACCOUNT_SID", environment.NOTIFICATION_SMS_ACCOUNT_SID)
          : null,
      smsAuthToken:
        smsProvider === "twilio"
          ? required("NOTIFICATION_SMS_AUTH_TOKEN", environment.NOTIFICATION_SMS_AUTH_TOKEN)
          : null,
      smsFrom:
        smsProvider === "twilio"
          ? required("NOTIFICATION_SMS_FROM", environment.NOTIFICATION_SMS_FROM)
          : null,
      smsProvider,
      timeoutMs: integer(
        "NOTIFICATION_PROVIDER_TIMEOUT_MS",
        environment.NOTIFICATION_PROVIDER_TIMEOUT_MS ?? "10000",
        1_000,
        60_000,
      ),
      twilioApiBaseUrl: (
        environment.NOTIFICATION_TWILIO_API_BASE_URL ?? "https://api.twilio.com"
      ).replace(/\/$/, ""),
    },
    observability: {
      requestLoggingEnabled: booleanValue(
        "LOG_REQUESTS",
        environment.LOG_REQUESTS ??
          (appEnvironment === "production" || appEnvironment === "staging" ? "true" : "false"),
      ),
    },
    objectStorage: {
      accessKeyId: required("MINIO_APP_USER", environment.MINIO_APP_USER),
      bucket: required("MINIO_BUCKET", environment.MINIO_BUCKET),
      endpoint: minioEndpoint,
      forcePathStyle: booleanValue(
        "MINIO_FORCE_PATH_STYLE",
        environment.MINIO_FORCE_PATH_STYLE ?? "true",
      ),
      healthUrl: `${minioEndpoint}/minio/health/ready`,
      maxUploadBytes: integer(
        "DOCUMENT_MAX_UPLOAD_BYTES",
        environment.DOCUMENT_MAX_UPLOAD_BYTES ?? "20971520",
        1_024,
        104_857_600,
      ),
      presignExpiresSeconds: integer(
        "DOCUMENT_PRESIGN_EXPIRES_SECONDS",
        environment.DOCUMENT_PRESIGN_EXPIRES_SECONDS ?? "300",
        30,
        3_600,
      ),
      publicLinkDefaultExpiresSeconds: integer(
        "DOCUMENT_PUBLIC_LINK_EXPIRES_SECONDS",
        environment.DOCUMENT_PUBLIC_LINK_EXPIRES_SECONDS ?? "86400",
        60,
        604_800,
      ),
      publicLinkSigningKey: minimumLength(
        "DOCUMENT_PUBLIC_LINK_SIGNING_KEY",
        environment.DOCUMENT_PUBLIC_LINK_SIGNING_KEY,
        32,
      ),
      region: environment.MINIO_REGION ?? "us-east-1",
      secretAccessKey: required("MINIO_APP_PASSWORD", environment.MINIO_APP_PASSWORD),
    },
    web: {
      origin: required("WEB_ORIGIN", environment.WEB_ORIGIN),
    },
    worker: {
      heartbeatIntervalMs: integer(
        "WORKER_HEARTBEAT_INTERVAL_MS",
        environment.WORKER_HEARTBEAT_INTERVAL_MS ?? "10000",
        1_000,
        300_000,
      ),
      heartbeatStaleAfterMs: integer(
        "WORKER_HEARTBEAT_STALE_AFTER_MS",
        environment.WORKER_HEARTBEAT_STALE_AFTER_MS ?? "30000",
        2_000,
        900_000,
      ),
      id: environment.WORKER_ID ?? `${hostname()}-${process.pid.toString()}`,
      leaseSeconds: integer(
        "WORKER_LEASE_SECONDS",
        environment.WORKER_LEASE_SECONDS ?? "60",
        1,
        3_600,
      ),
      maxAttempts: integer("WORKER_MAX_ATTEMPTS", environment.WORKER_MAX_ATTEMPTS ?? "5", 1, 100),
      pollIntervalMs: integer(
        "WORKER_POLL_INTERVAL_MS",
        environment.WORKER_POLL_INTERVAL_MS ?? "1000",
        100,
        300_000,
      ),
      readyRequiresHeartbeat: booleanValue(
        "READY_REQUIRE_WORKER",
        environment.READY_REQUIRE_WORKER ?? "false",
      ),
      readyMaxDeadLetterEvents: integer(
        "READY_MAX_DEAD_LETTER_EVENTS",
        environment.READY_MAX_DEAD_LETTER_EVENTS ?? "100000",
        0,
        100_000,
      ),
      readyMaxOutboxAgeSeconds: integer(
        "READY_MAX_OUTBOX_AGE_SECONDS",
        environment.READY_MAX_OUTBOX_AGE_SECONDS ?? "86400",
        30,
        86_400,
      ),
      tenantIds: workerTenantIds,
    },
  };
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredUuid(name: string, value: string | undefined): string {
  const parsed = required(name, value);
  if (!uuidPattern.test(parsed)) {
    throw new Error(`${name} must be a valid UUID`);
  }
  return parsed;
}

function minimumLength(name: string, value: string | undefined, length: number): string {
  const parsed = required(name, value);
  if (parsed.length < length) {
    throw new Error(`${name} must contain at least ${length.toString()} characters`);
  }
  return parsed;
}

function requiredUrl(name: string, value: string | undefined): string {
  const parsed = required(name, value);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${name} must use HTTPS outside local development`);
  }
  return url.toString();
}

function enumValue<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  allowed: T,
): T[number] {
  const parsed = required(name, value);
  if (!allowed.includes(parsed)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return parsed;
}

function integer(name: string, value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum.toString()} through ${maximum.toString()}`,
    );
  }
  return parsed;
}

function booleanValue(name: string, value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function csv(value: string): string[] {
  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error("Comma-separated configuration cannot be empty");
  }
  return values;
}
