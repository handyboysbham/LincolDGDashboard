import { auditEvents, organizations, roles, userRoles, users } from "./schema.js";
import type { Database } from "./client.js";
import { withTenantTransaction } from "./tenant.js";

export const localSeedIds = {
  organization: "00000000-0000-4000-8000-000000000001",
  ownerRole: "00000000-0000-4000-8000-000000000101",
  dispatcherRole: "00000000-0000-4000-8000-000000000102",
  driverRole: "00000000-0000-4000-8000-000000000103",
  financialRole: "00000000-0000-4000-8000-000000000104",
  ownerUser: "00000000-0000-4000-8000-000000000201",
  seedAuditEvent: "00000000-0000-4000-8000-000000000301",
} as const;

export async function seedLocalDevelopment(database: Database): Promise<void> {
  const tenantId = localSeedIds.organization;

  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction
      .insert(organizations)
      .values({
        id: tenantId,
        displayName: "Lincoln Dirt and Gravel",
        legalName: "Lincoln Dirt and Gravel",
        timezone: "America/Chicago",
      })
      .onConflictDoNothing();

    await transaction
      .insert(users)
      .values({
        id: localSeedIds.ownerUser,
        tenantId,
        externalSubject: "local-owner",
        email: "owner@lincolndirtandgravel.test",
        displayName: "Local Owner",
      })
      .onConflictDoNothing();

    await transaction
      .insert(roles)
      .values([
        {
          id: localSeedIds.ownerRole,
          tenantId,
          code: "owner",
          name: "Owner",
          permissions: ["*"],
        },
        {
          id: localSeedIds.dispatcherRole,
          tenantId,
          code: "dispatcher",
          name: "Dispatcher",
          permissions: [
            "customers:read",
            "customers:write",
            "documents:read",
            "documents:write",
            "leads:read",
            "leads:transition",
            "leads:write",
            "pricing:read",
            "estimates:read",
            "estimates:write",
            "quotes:read",
            "quotes:write",
            "quotes:send",
            "projects:read",
            "operations:manage",
            "scheduling:manage",
          ],
        },
        {
          id: localSeedIds.driverRole,
          tenantId,
          code: "driver",
          name: "Driver",
          permissions: ["assignments:read", "operations:execute"],
        },
        {
          id: localSeedIds.financialRole,
          tenantId,
          code: "financial",
          name: "Financial",
          permissions: ["finance:manage", "finance:read"],
        },
      ])
      .onConflictDoNothing();

    await transaction
      .insert(userRoles)
      .values({
        tenantId,
        userId: localSeedIds.ownerUser,
        roleId: localSeedIds.ownerRole,
        createdBy: localSeedIds.ownerUser,
      })
      .onConflictDoNothing();

    await transaction
      .insert(auditEvents)
      .values({
        id: localSeedIds.seedAuditEvent,
        tenantId,
        actorUserId: localSeedIds.ownerUser,
        commandName: "SeedLocalDevelopment",
        entityType: "Organization",
        entityId: tenantId,
        eventType: "OrganizationSeeded",
        after: { displayName: "Lincoln Dirt and Gravel", status: "active" },
        metadata: { environment: "local" },
      })
      .onConflictDoNothing();
  });
}
