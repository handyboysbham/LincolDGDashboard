import { bootstrapTenantFoundation, createDatabase, createDatabasePool } from "../src/index.js";
import { requireEnvironment } from "./environment.js";

if (requireEnvironment("APP_ENV") !== "production") {
  throw new Error("The tenant foundation bootstrap may run only when APP_ENV=production");
}
if (requireEnvironment("LDG_PROCESS") !== "release") {
  throw new Error("The tenant foundation bootstrap may run only when LDG_PROCESS=release");
}
if (requireEnvironment("BOOTSTRAP_CONFIRM") !== "PROVISION_TENANT_FOUNDATION") {
  throw new Error("BOOTSTRAP_CONFIRM must equal PROVISION_TENANT_FOUNDATION");
}

const pool = createDatabasePool(requireEnvironment("DATABASE_MIGRATION_URL"), {
  application_name: "ldg-tenant-foundation-bootstrap",
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 1,
});

try {
  const result = await bootstrapTenantFoundation(createDatabase(pool), {
    approvedBy: requireEnvironment("BOOTSTRAP_APPROVED_BY"),
    changeTicket: requireEnvironment("BOOTSTRAP_CHANGE_TICKET"),
    legalName: requireEnvironment("BOOTSTRAP_ORGANIZATION_LEGAL_NAME"),
    organizationDisplayName: requireEnvironment("BOOTSTRAP_ORGANIZATION_DISPLAY_NAME"),
    ownerDisplayName: requireEnvironment("BOOTSTRAP_OWNER_DISPLAY_NAME"),
    ownerEmail: requireEnvironment("BOOTSTRAP_OWNER_EMAIL"),
    ownerUserId: requireEnvironment("BOOTSTRAP_USER_ID"),
    tenantId: requireEnvironment("BOOTSTRAP_TENANT_ID"),
    timezone: requireEnvironment("BOOTSTRAP_TIMEZONE"),
  });
  console.log(
    `Tenant foundation ${result.replayed ? "was already provisioned" : "was provisioned"}; tenant ${result.tenantId}; owner User ${result.ownerUserId}; audit event ${result.auditEventId}`,
  );
} finally {
  await pool.end();
}
