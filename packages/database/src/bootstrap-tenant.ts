import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { auditEvents, organizations, outboxEvents, roles, userRoles, users } from "./schema.js";
import { assertTenantId, withTenantTransaction } from "./tenant.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const platformRoleTemplates = [
  {
    code: "owner",
    name: "Owner",
    permissions: ["*"],
  },
  {
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
    code: "driver",
    name: "Driver",
    permissions: ["assignments:read", "operations:execute"],
  },
  {
    code: "financial",
    name: "Financial",
    permissions: ["finance:manage", "finance:read"],
  },
] as const;

export type TenantFoundationBootstrapErrorCode =
  "BOOTSTRAP_EVIDENCE_MISSING" | "FOUNDATION_CONFLICT";

export class TenantFoundationBootstrapError extends Error {
  public constructor(
    public readonly code: TenantFoundationBootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TenantFoundationBootstrapError";
  }
}

export interface TenantFoundationBootstrapInput {
  approvedBy: string;
  changeTicket: string;
  legalName: string;
  organizationDisplayName: string;
  ownerDisplayName: string;
  ownerEmail: string;
  ownerUserId: string;
  tenantId: string;
  timezone: string;
}

export interface TenantFoundationBootstrapResult {
  auditEventId: string;
  ownerUserId: string;
  provisioned: true;
  replayed: boolean;
  tenantId: string;
}

export async function bootstrapTenantFoundation(
  database: Database,
  input: TenantFoundationBootstrapInput,
): Promise<TenantFoundationBootstrapResult> {
  const normalized = validateInput(input);

  return withTenantTransaction(database, normalized.tenantId, async (transaction) => {
    await transaction.execute(sql`set local lock_timeout = '5s'`);
    await transaction.execute(sql`set local statement_timeout = '15s'`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${normalized.tenantId}:tenant-foundation-bootstrap`}))`,
    );

    // The production bootstrap is a release-only operation. Requiring Auth schema read access
    // prevents the restricted application role from being used to create tenant roots.
    await transaction.execute(sql`select 1 from auth.users limit 0`);

    const [existingOrganization] = await transaction
      .select()
      .from(organizations)
      .where(eq(organizations.id, normalized.tenantId))
      .for("update");
    if (existingOrganization) {
      return verifyReplay(transaction, normalized, existingOrganization);
    }

    await transaction.insert(organizations).values({
      createdBy: normalized.ownerUserId,
      displayName: normalized.organizationDisplayName,
      id: normalized.tenantId,
      legalName: normalized.legalName,
      timezone: normalized.timezone,
    });
    await transaction.insert(users).values({
      createdBy: normalized.ownerUserId,
      displayName: normalized.ownerDisplayName,
      email: normalized.ownerEmail,
      id: normalized.ownerUserId,
      tenantId: normalized.tenantId,
    });

    const roleRows = platformRoleTemplates.map((template) => ({
      code: template.code,
      createdBy: normalized.ownerUserId,
      id: randomUUID(),
      name: template.name,
      permissions: [...template.permissions],
      tenantId: normalized.tenantId,
    }));
    await transaction.insert(roles).values(roleRows);
    const ownerRole = roleRows.find((role) => role.code === "owner");
    if (!ownerRole) throw new Error("The owner Role template is required");
    await transaction.insert(userRoles).values({
      createdBy: normalized.ownerUserId,
      roleId: ownerRole.id,
      tenantId: normalized.tenantId,
      userId: normalized.ownerUserId,
    });

    const auditEventId = randomUUID();
    const correlationId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: normalized.ownerUserId,
      after: {
        organizationDisplayName: normalized.organizationDisplayName,
        ownerEmail: normalized.ownerEmail,
        ownerUserId: normalized.ownerUserId,
        roleCodes: platformRoleTemplates.map((role) => role.code),
        status: "active",
      },
      commandName: "BootstrapTenantFoundation",
      correlationId,
      entityId: normalized.tenantId,
      entityType: "Organization",
      eventType: "administration.tenant_foundation_provisioned",
      id: auditEventId,
      metadata: {
        approvedBy: normalized.approvedBy,
        bootstrap: true,
        changeTicket: normalized.changeTicket,
      },
      tenantId: normalized.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: normalized.tenantId,
      aggregateType: "Organization",
      eventType: "administration.tenant_foundation_provisioned",
      payload: {
        auditEventId,
        bootstrap: true,
        changeTicket: normalized.changeTicket,
        ownerUserId: normalized.ownerUserId,
      },
      tenantId: normalized.tenantId,
    });

    return {
      auditEventId,
      ownerUserId: normalized.ownerUserId,
      provisioned: true,
      replayed: false,
      tenantId: normalized.tenantId,
    };
  });
}

type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type OrganizationRow = typeof organizations.$inferSelect;

async function verifyReplay(
  transaction: TenantTransaction,
  input: TenantFoundationBootstrapInput,
  organization: OrganizationRow,
): Promise<TenantFoundationBootstrapResult> {
  const [ownerUser] = await transaction
    .select()
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), eq(users.id, input.ownerUserId)))
    .limit(1);
  const existingRoles = await transaction
    .select({
      code: roles.code,
      id: roles.id,
      name: roles.name,
      permissions: roles.permissions,
      status: roles.status,
    })
    .from(roles)
    .where(eq(roles.tenantId, input.tenantId));
  const ownerRole = existingRoles.find((role) => role.code === "owner");
  const [ownerAssignment] = ownerRole
    ? await transaction
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.tenantId, input.tenantId),
            eq(userRoles.userId, input.ownerUserId),
            eq(userRoles.roleId, ownerRole.id),
          ),
        )
        .limit(1)
    : [];

  const organizationMatches =
    organization.displayName === input.organizationDisplayName &&
    organization.legalName === input.legalName &&
    organization.timezone === input.timezone &&
    organization.status === "active";
  const userMatches =
    ownerUser?.displayName === input.ownerDisplayName &&
    ownerUser.email.toLowerCase() === input.ownerEmail &&
    ownerUser.status === "active";
  const rolesMatch = platformRoleTemplates.every((template) => {
    const role = existingRoles.find((candidate) => candidate.code === template.code);
    return (
      role?.name === template.name &&
      role.status === "active" &&
      JSON.stringify(role.permissions) === JSON.stringify(template.permissions)
    );
  });

  if (!organizationMatches || !userMatches || !rolesMatch || !ownerAssignment) {
    throw new TenantFoundationBootstrapError(
      "FOUNDATION_CONFLICT",
      "The tenant foundation already exists with different or incomplete data",
    );
  }

  const [audit] = await transaction
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.tenantId, input.tenantId),
        eq(auditEvents.entityId, input.tenantId),
        eq(auditEvents.commandName, "BootstrapTenantFoundation"),
        eq(auditEvents.eventType, "administration.tenant_foundation_provisioned"),
        sql`${auditEvents.metadata} ->> 'changeTicket' = ${input.changeTicket}`,
      ),
    )
    .limit(1);
  if (!audit) {
    throw new TenantFoundationBootstrapError(
      "BOOTSTRAP_EVIDENCE_MISSING",
      "The tenant foundation exists without matching bootstrap Audit evidence",
    );
  }

  return {
    auditEventId: audit.id,
    ownerUserId: input.ownerUserId,
    provisioned: true,
    replayed: true,
    tenantId: input.tenantId,
  };
}

function validateInput(input: TenantFoundationBootstrapInput): TenantFoundationBootstrapInput {
  assertTenantId(input.tenantId);
  requireUuid(input.ownerUserId, "ownerUserId");
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (ownerEmail.length > 320 || !emailPattern.test(ownerEmail)) {
    throw new Error("ownerEmail must be a valid email address");
  }
  const timezone = requireText(input.timezone, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("timezone must be a valid IANA time zone");
  }
  return {
    approvedBy: requireText(input.approvedBy, "approvedBy", 200),
    changeTicket: requireText(input.changeTicket, "changeTicket", 200),
    legalName: requireText(input.legalName, "legalName", 200),
    organizationDisplayName: requireText(
      input.organizationDisplayName,
      "organizationDisplayName",
      200,
    ),
    ownerDisplayName: requireText(input.ownerDisplayName, "ownerDisplayName", 200),
    ownerEmail,
    ownerUserId: input.ownerUserId,
    tenantId: input.tenantId,
    timezone,
  };
}

function requireUuid(value: string, name: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${name} must be a valid UUID`);
}

function requireText(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > maximum) {
    throw new Error(`${name} must contain from 2 through ${String(maximum)} characters`);
  }
  return normalized;
}
