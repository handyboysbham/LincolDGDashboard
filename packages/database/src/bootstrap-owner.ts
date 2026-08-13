import { randomUUID } from "node:crypto";

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { auditEvents, outboxEvents, roles, userRoles, users } from "./schema.js";
import { assertTenantId, withTenantTransaction } from "./tenant.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FirstOwnerBootstrapErrorCode =
  | "AUTH_EMAIL_MISMATCH"
  | "AUTH_IDENTITY_ALREADY_LINKED"
  | "AUTH_IDENTITY_NOT_FOUND"
  | "AUTH_TENANT_MISMATCH"
  | "EXISTING_LINKED_OWNER"
  | "OWNER_ROLE_REQUIRED"
  | "USER_ALREADY_LINKED"
  | "USER_ALREADY_LINKED_WITHOUT_BOOTSTRAP_EVIDENCE"
  | "USER_CHANGED"
  | "USER_INACTIVE"
  | "USER_NOT_FOUND";

export class FirstOwnerBootstrapError extends Error {
  public constructor(
    public readonly code: FirstOwnerBootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FirstOwnerBootstrapError";
  }
}

export interface FirstOwnerBootstrapInput {
  approvedBy: string;
  authUserId: string;
  changeTicket: string;
  tenantId: string;
  userId: string;
}

export interface FirstOwnerBootstrapResult {
  auditEventId: string;
  linked: true;
  replayed: boolean;
  tenantId: string;
  userId: string;
}

interface AuthUserRecord {
  email: string | null;
  id: string;
  tenantId: string | null;
}

export async function bootstrapFirstOwnerIdentity(
  database: Database,
  input: FirstOwnerBootstrapInput,
): Promise<FirstOwnerBootstrapResult> {
  const normalized = validateInput(input);

  return withTenantTransaction(database, normalized.tenantId, async (transaction) => {
    await transaction.execute(sql`set local lock_timeout = '5s'`);
    await transaction.execute(sql`set local statement_timeout = '15s'`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${normalized.tenantId}:first-owner-bootstrap`}))`,
    );

    const [user] = await transaction
      .select()
      .from(users)
      .where(and(eq(users.tenantId, normalized.tenantId), eq(users.id, normalized.userId)))
      .for("update");
    if (!user) {
      throw new FirstOwnerBootstrapError("USER_NOT_FOUND", "The bootstrap User was not found");
    }
    if (user.status !== "active") {
      throw new FirstOwnerBootstrapError("USER_INACTIVE", "The bootstrap User must be active");
    }

    const [ownerRole] = await transaction
      .select({ id: roles.id })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .where(
        and(
          eq(userRoles.tenantId, normalized.tenantId),
          eq(userRoles.userId, normalized.userId),
          eq(roles.code, "owner"),
          eq(roles.status, "active"),
        ),
      )
      .limit(1);
    if (!ownerRole) {
      throw new FirstOwnerBootstrapError(
        "OWNER_ROLE_REQUIRED",
        "The bootstrap User must have an active owner Role",
      );
    }

    const authResult = await transaction.execute(sql`
      select
        id::text as id,
        email,
        raw_app_meta_data ->> 'tenant_id' as "tenantId"
      from auth.users
      where id = ${normalized.authUserId}::uuid
      for share
    `);
    const authUser = authResult.rows[0] as AuthUserRecord | undefined;
    if (!authUser) {
      throw new FirstOwnerBootstrapError(
        "AUTH_IDENTITY_NOT_FOUND",
        "The Supabase Auth identity was not found",
      );
    }
    if (authUser.tenantId !== normalized.tenantId) {
      throw new FirstOwnerBootstrapError(
        "AUTH_TENANT_MISMATCH",
        "The Supabase Auth identity app_metadata.tenant_id does not match the tenant",
      );
    }
    if (authUser.email?.toLowerCase() !== user.email.toLowerCase()) {
      throw new FirstOwnerBootstrapError(
        "AUTH_EMAIL_MISMATCH",
        "The Supabase Auth identity email does not match the application User",
      );
    }

    if (user.externalSubject === normalized.authUserId) {
      const [existingAudit] = await transaction
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, normalized.tenantId),
            eq(auditEvents.entityId, normalized.userId),
            eq(auditEvents.commandName, "BootstrapFirstOwnerIdentity"),
            eq(auditEvents.eventType, "administration.user_identity_linked"),
            sql`${auditEvents.metadata} ->> 'authUserId' = ${normalized.authUserId}`,
          ),
        )
        .limit(1);
      if (!existingAudit) {
        throw new FirstOwnerBootstrapError(
          "USER_ALREADY_LINKED_WITHOUT_BOOTSTRAP_EVIDENCE",
          "The User is linked without first-owner bootstrap Audit evidence",
        );
      }
      return {
        auditEventId: existingAudit.id,
        linked: true,
        replayed: true,
        tenantId: normalized.tenantId,
        userId: normalized.userId,
      };
    }
    if (user.externalSubject) {
      throw new FirstOwnerBootstrapError(
        "USER_ALREADY_LINKED",
        "The bootstrap User is already linked to a different authentication identity",
      );
    }

    const [subjectOwner] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, normalized.tenantId),
          eq(users.externalSubject, normalized.authUserId),
        ),
      )
      .limit(1);
    if (subjectOwner) {
      throw new FirstOwnerBootstrapError(
        "AUTH_IDENTITY_ALREADY_LINKED",
        "The Supabase Auth identity is already linked to another User",
      );
    }

    const [existingLinkedOwner] = await transaction
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        userRoles,
        and(eq(userRoles.tenantId, users.tenantId), eq(userRoles.userId, users.id)),
      )
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .where(
        and(
          eq(users.tenantId, normalized.tenantId),
          ne(users.id, normalized.userId),
          eq(users.status, "active"),
          isNotNull(users.externalSubject),
          eq(roles.code, "owner"),
          eq(roles.status, "active"),
        ),
      )
      .limit(1);
    if (existingLinkedOwner) {
      throw new FirstOwnerBootstrapError(
        "EXISTING_LINKED_OWNER",
        "An authenticated owner already exists; use the administration identity-link command",
      );
    }

    const [updated] = await transaction
      .update(users)
      .set({
        externalSubject: normalized.authUserId,
        rowVersion: sql`${users.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.tenantId, normalized.tenantId),
          eq(users.id, normalized.userId),
          sql`${users.externalSubject} is null`,
        ),
      )
      .returning({ id: users.id });
    if (!updated) {
      throw new FirstOwnerBootstrapError(
        "USER_CHANGED",
        "The bootstrap User changed before identity linking completed",
      );
    }

    const auditEventId = randomUUID();
    const correlationId = randomUUID();
    await transaction.insert(auditEvents).values({
      after: { identityLinked: true },
      before: { identityLinked: false },
      commandName: "BootstrapFirstOwnerIdentity",
      correlationId,
      entityId: normalized.userId,
      entityType: "User",
      eventType: "administration.user_identity_linked",
      id: auditEventId,
      metadata: {
        approvedBy: normalized.approvedBy,
        authUserId: normalized.authUserId,
        bootstrap: true,
        changeTicket: normalized.changeTicket,
      },
      tenantId: normalized.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: normalized.userId,
      aggregateType: "User",
      eventType: "administration.user_identity_linked",
      payload: { auditEventId, bootstrap: true, changeTicket: normalized.changeTicket },
      tenantId: normalized.tenantId,
    });

    return {
      auditEventId,
      linked: true,
      replayed: false,
      tenantId: normalized.tenantId,
      userId: normalized.userId,
    };
  });
}

function validateInput(input: FirstOwnerBootstrapInput): FirstOwnerBootstrapInput {
  assertTenantId(input.tenantId);
  requireUuid(input.userId, "userId");
  requireUuid(input.authUserId, "authUserId");
  return {
    approvedBy: requireText(input.approvedBy, "approvedBy"),
    authUserId: input.authUserId,
    changeTicket: requireText(input.changeTicket, "changeTicket"),
    tenantId: input.tenantId,
    userId: input.userId,
  };
}

function requireUuid(value: string, name: string): void {
  if (!uuidPattern.test(value)) throw new Error(`${name} must be a valid UUID`);
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > 200) {
    throw new Error(`${name} must contain from 3 through 200 characters`);
  }
  return normalized;
}
