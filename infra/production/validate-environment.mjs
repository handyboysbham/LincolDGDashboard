const failures = [];
const processType = oneOf("LDG_PROCESS", ["api", "worker", "web", "release"]);

if (processType === "web") {
  oneOf("APP_ENV", ["staging", "production"]);
  oneOf("NEXT_PUBLIC_AUTH_MODE", ["supabase"]);
  const apiBaseUrl = httpsUrl("NEXT_PUBLIC_API_BASE_URL");
  const supabaseUrl = httpsUrl("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = secret("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", 20, {
    publicValue: true,
  });
  if (apiBaseUrl?.pathname !== "/") {
    fail("NEXT_PUBLIC_API_BASE_URL", "must be an origin without a path");
  }
  if (supabaseUrl?.pathname !== "/") fail("NEXT_PUBLIC_SUPABASE_URL", "must not include a path");
  if (publishableKey && !publishableKey.startsWith("sb_publishable_")) {
    fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "must be a Supabase publishable key");
  }
} else if (processType) {
  oneOf("APP_ENV", ["staging", "production"]);
  oneOf("AUTH_MODE", ["jwt"]);
  const webOrigin = httpsUrl("WEB_ORIGIN");
  const jwtIssuer = httpsUrl("AUTH_JWT_ISSUER");
  const jwksUrl = httpsUrl("AUTH_JWKS_URL");
  oneOf("AUTH_JWT_AUDIENCE", ["authenticated"]);
  if (webOrigin && webOrigin.pathname !== "/")
    fail("WEB_ORIGIN", "must be an origin without a path");
  if (jwtIssuer && !jwtIssuer.pathname.endsWith("/auth/v1")) {
    fail("AUTH_JWT_ISSUER", "must identify the Supabase Auth issuer ending in /auth/v1");
  }
  if (jwksUrl && !jwksUrl.pathname.endsWith("/auth/v1/.well-known/jwks.json")) {
    fail("AUTH_JWKS_URL", "must identify the Supabase JWKS endpoint");
  }
  if (jwtIssuer && jwksUrl && jwtIssuer.origin !== jwksUrl.origin) {
    fail("AUTH_JWKS_URL", "must use the same origin as AUTH_JWT_ISSUER");
  }

  const runtimeDatabase = postgresUrl("DATABASE_URL");
  integer("DATABASE_POOL_MAX", 1, 100);
  required("EXPECTED_DATABASE_RELEASE");

  csvUuids("WORKER_TENANT_IDS");
  secret("DOCUMENT_PUBLIC_LINK_SIGNING_KEY", 64);
  const apiPublicOrigin = httpsUrl("API_PUBLIC_ORIGIN");
  if (apiPublicOrigin?.pathname !== "/") {
    fail("API_PUBLIC_ORIGIN", "must be an origin without a path");
  }
  oneOf("DOCUMENT_STORAGE_PROVIDER", ["google_drive"]);
  const serviceAccountEmail = emailAddress("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL");
  if (serviceAccountEmail && !serviceAccountEmail.endsWith(".iam.gserviceaccount.com")) {
    fail("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL", "must be a Google service-account email");
  }
  base64PemPrivateKey("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64");
  required("GOOGLE_DRIVE_SHARED_DRIVE_ID");
  required("GOOGLE_DRIVE_DOCUMENT_FOLDER_ID");
  emailAddress("MAIL_FROM");
  oneOf("NOTIFICATION_EMAIL_PROVIDER", ["resend"]);
  secret("NOTIFICATION_EMAIL_API_KEY", 20);
  const smsProvider = oneOf("NOTIFICATION_SMS_PROVIDER", ["disabled", "twilio"]);
  if (smsProvider === "twilio") {
    secret("NOTIFICATION_SMS_ACCOUNT_SID", 20);
    secret("NOTIFICATION_SMS_AUTH_TOKEN", 20);
    required("NOTIFICATION_SMS_FROM");
    httpsUrl("NOTIFICATION_TWILIO_API_BASE_URL");
  }
  oneOf("READY_REQUIRE_WORKER", ["true"]);
  oneOf("LOG_REQUESTS", ["true"]);
  integer("READY_MAX_OUTBOX_AGE_SECONDS", 30, 86_400);
  integer("READY_MAX_DEAD_LETTER_EVENTS", 0, 100_000);

  if (processType === "release") {
    const migrationDatabase = postgresUrl("DATABASE_MIGRATION_URL");
    const backupDatabase = postgresUrl("DATABASE_BACKUP_URL");
    if (runtimeDatabase && migrationDatabase) {
      if (runtimeDatabase.toString() === migrationDatabase.toString()) {
        fail("DATABASE_URL", "must be separate from DATABASE_MIGRATION_URL");
      }
      if (runtimeDatabase.username === migrationDatabase.username) {
        fail("DATABASE_URL", "must use a restricted runtime role distinct from the migration role");
      }
    }
    if (runtimeDatabase && backupDatabase && runtimeDatabase.username === backupDatabase.username) {
      fail("DATABASE_BACKUP_URL", "must not use the restricted runtime role");
    }
    required("GOOGLE_DRIVE_BACKUP_FOLDER_ID");
    required("GOOGLE_DRIVE_BACKUP_SHARED_DRIVE_ID");
    const backupServiceAccountEmail = emailAddress("GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL");
    if (
      backupServiceAccountEmail &&
      !backupServiceAccountEmail.endsWith(".iam.gserviceaccount.com")
    ) {
      fail("GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL", "must be a Google service-account email");
    }
    if (backupServiceAccountEmail && backupServiceAccountEmail === serviceAccountEmail) {
      fail(
        "GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL",
        "must differ from GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL",
      );
    }
    base64PemPrivateKey("GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64");
    base64Key("DATABASE_BACKUP_ENCRYPTION_KEY_BASE64", 32);
  }
}

if (failures.length > 0) {
  console.error("Production environment validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production environment is valid for the ${processType} process.`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(name, "is required");
    return undefined;
  }
  if (/change[_-]?me|your[-_ ]|\[[^\]]+\]|example\.com/i.test(value)) {
    fail(name, "contains a placeholder value");
    return undefined;
  }
  return value;
}

function secret(name, minimumLength, { publicValue = false } = {}) {
  const value = required(name);
  if (value && value.length < minimumLength)
    fail(name, `must contain at least ${minimumLength} characters`);
  if (value && !publicValue && /^(test|local|development)/i.test(value)) {
    fail(name, "must not use a development credential");
  }
  return value;
}

function oneOf(name, allowed) {
  const value = required(name);
  if (value && !allowed.includes(value)) fail(name, `must be one of: ${allowed.join(", ")}`);
  return value;
}

function httpsUrl(name) {
  const value = required(name);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") fail(name, "must use HTTPS");
    if (url.username || url.password) fail(name, "must not contain embedded credentials");
    return url;
  } catch {
    fail(name, "must be a valid URL");
    return undefined;
  }
}

function postgresUrl(name) {
  const value = required(name);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      fail(name, "must be a PostgreSQL URL");
    }
    if (!url.username || !url.password) fail(name, "must include a database role and credential");
    if (!url.pathname || url.pathname === "/") fail(name, "must select a database");
    if (!["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) {
      fail(name, "must set sslmode=require, verify-ca, or verify-full");
    }
    return url;
  } catch {
    fail(name, "must be a valid PostgreSQL URL");
    return undefined;
  }
}

function integer(name, minimum, maximum) {
  const value = required(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(name, `must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function csvUuids(name) {
  const value = required(name);
  if (!value) return;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !uuid.test(entry))) {
    fail(name, "must be a non-empty comma-separated UUID list");
  }
}

function emailAddress(name) {
  const value = required(name);
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail(name, "must be a valid email address");
  }
  return value;
}

function base64PemPrivateKey(name) {
  const value = secret(name, 100);
  if (!value) return undefined;
  let decoded;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    fail(name, "must be valid base64");
    return undefined;
  }
  if (!decoded.includes("-----BEGIN PRIVATE KEY-----")) {
    fail(name, "must contain a base64-encoded PEM private key");
  }
  return decoded;
}

function base64Key(name, expectedBytes) {
  const value = secret(name, 40);
  if (!value) return undefined;
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== expectedBytes) {
    fail(name, `must decode to exactly ${expectedBytes} bytes`);
  }
  return decoded;
}

function fail(name, message) {
  failures.push(`${name} ${message}`);
}
