import { bootstrapFirstOwnerIdentity, createDatabase, createDatabasePool } from "../src/index.js";
import { requireEnvironment } from "./environment.js";

if (requireEnvironment("APP_ENV") !== "production") {
  throw new Error("The first-owner bootstrap may run only when APP_ENV=production");
}
if (requireEnvironment("LDG_PROCESS") !== "release") {
  throw new Error("The first-owner bootstrap may run only when LDG_PROCESS=release");
}
if (requireEnvironment("BOOTSTRAP_CONFIRM") !== "LINK_FIRST_OWNER") {
  throw new Error("BOOTSTRAP_CONFIRM must equal LINK_FIRST_OWNER");
}

const pool = createDatabasePool(requireEnvironment("DATABASE_MIGRATION_URL"), {
  application_name: "ldg-first-owner-bootstrap",
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  max: 1,
});

try {
  const result = await bootstrapFirstOwnerIdentity(createDatabase(pool), {
    approvedBy: requireEnvironment("BOOTSTRAP_APPROVED_BY"),
    authUserId: requireEnvironment("BOOTSTRAP_AUTH_USER_ID"),
    changeTicket: requireEnvironment("BOOTSTRAP_CHANGE_TICKET"),
    tenantId: requireEnvironment("BOOTSTRAP_TENANT_ID"),
    userId: requireEnvironment("BOOTSTRAP_USER_ID"),
  });
  console.log(
    `First owner identity ${result.replayed ? "was already linked" : "was linked"}; audit event ${result.auditEventId}`,
  );
} finally {
  await pool.end();
}
