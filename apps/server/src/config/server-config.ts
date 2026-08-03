import { hostname } from "node:os";

type AppEnvironment = "local" | "production" | "staging" | "test";

export interface ServerConfig {
  api: {
    host: string;
    port: number;
  };
  appEnvironment: AppEnvironment;
  auth: {
    developmentPermissions: string[];
    developmentTenantId: string;
    developmentUserId: string;
    mode: "development";
  };
  databaseUrl: string;
  objectStorage: {
    bucket: string;
    healthUrl: string;
  };
  worker: {
    heartbeatIntervalMs: number;
    heartbeatStaleAfterMs: number;
    id: string;
    leaseSeconds: number;
    maxAttempts: number;
    pollIntervalMs: number;
    readyRequiresHeartbeat: boolean;
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
  const authMode = enumValue("AUTH_MODE", environment.AUTH_MODE, ["development"] as const);

  if (appEnvironment !== "local") {
    throw new Error("AUTH_MODE=development is allowed only when APP_ENV=local");
  }

  const developmentTenantId = requiredUuid(
    "DEVELOPMENT_TENANT_ID",
    environment.DEVELOPMENT_TENANT_ID,
  );
  const developmentUserId = requiredUuid("DEVELOPMENT_USER_ID", environment.DEVELOPMENT_USER_ID);
  const workerTenantIds = csv(environment.WORKER_TENANT_IDS ?? developmentTenantId);
  for (const tenantId of workerTenantIds) {
    requiredUuid("WORKER_TENANT_IDS", tenantId);
  }

  const minioEndpoint = required("MINIO_ENDPOINT", environment.MINIO_ENDPOINT).replace(/\/$/, "");

  return {
    api: {
      host: environment.API_HOST ?? "127.0.0.1",
      port: integer("API_PORT", environment.API_PORT ?? "3001", 1, 65_535),
    },
    appEnvironment,
    auth: {
      developmentPermissions: csv(environment.DEVELOPMENT_PERMISSIONS ?? "*"),
      developmentTenantId,
      developmentUserId,
      mode: authMode,
    },
    databaseUrl: required("DATABASE_URL", environment.DATABASE_URL),
    objectStorage: {
      bucket: required("MINIO_BUCKET", environment.MINIO_BUCKET),
      healthUrl: `${minioEndpoint}/minio/health/ready`,
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
