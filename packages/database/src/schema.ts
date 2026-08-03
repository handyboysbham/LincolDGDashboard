import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  rowVersion: bigint("row_version", { mode: "number" }).notNull().default(1),
};

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull().default("America/Chicago"),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [check("organizations_status_check", sql`${table.status} in ('active', 'inactive')`)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    externalSubject: varchar("external_subject", { length: 255 }),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("users_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("users_tenant_external_subject_unique").on(table.tenantId, table.externalSubject),
    unique("users_tenant_email_unique").on(table.tenantId, table.email),
    check("users_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("roles_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("roles_tenant_code_unique").on(table.tenantId, table.code),
    check("roles_status_check", sql`${table.status} in ('active', 'inactive')`),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId, table.roleId] }),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
      name: "user_roles_tenant_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.roleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: "user_roles_tenant_role_fk",
    }).onDelete("restrict"),
    index("user_roles_tenant_role_idx").on(table.tenantId, table.roleId),
  ],
);

export const numberSequences = pgTable(
  "number_sequences",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    sequenceYear: integer("sequence_year").notNull(),
    nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.entityType, table.sequenceYear] }),
    check("number_sequences_year_check", sql`${table.sequenceYear} between 2000 and 9999`),
    check("number_sequences_next_value_check", sql`${table.nextValue} > 0`),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 100 }).notNull(),
    key: varchar("key", { length: 200 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("in_progress"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("idempotency_keys_tenant_scope_key_unique").on(table.tenantId, table.scope, table.key),
    check("idempotency_keys_status_check", sql`${table.status} in ('in_progress', 'completed')`),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    correlationId: uuid("correlation_id"),
    commandName: varchar("command_name", { length: 150 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    eventType: varchar("event_type", { length: 150 }).notNull(),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_events_tenant_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("audit_events_tenant_occurred_at_idx").on(table.tenantId, table.occurredAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    aggregateType: varchar("aggregate_type", { length: 100 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 150 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lockedBy: varchar("locked_by", { length: 200 }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...auditColumns,
  },
  (table) => [
    unique("outbox_events_tenant_id_id_unique").on(table.tenantId, table.id),
    check(
      "outbox_events_status_check",
      sql`${table.status} in ('pending', 'processing', 'processed', 'dead_letter')`,
    ),
    check("outbox_events_attempts_check", sql`${table.attempts} >= 0`),
    index("outbox_events_claim_idx").on(table.tenantId, table.status, table.availableAt),
  ],
);

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobType: varchar("job_type", { length: 150 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lockedBy: varchar("locked_by", { length: 200 }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...auditColumns,
  },
  (table) => [
    unique("scheduled_jobs_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("scheduled_jobs_tenant_dedupe_key_unique").on(table.tenantId, table.dedupeKey),
    check(
      "scheduled_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'completed', 'cancelled', 'dead_letter')`,
    ),
    check("scheduled_jobs_attempts_check", sql`${table.attempts} >= 0`),
    index("scheduled_jobs_claim_idx").on(table.tenantId, table.status, table.runAt),
  ],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: varchar("worker_id", { length: 200 }).primaryKey(),
  processType: varchar("process_type", { length: 80 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    objectKey: text("object_key").notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    mediaType: varchar("media_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: varchar("sha256", { length: 64 }),
    availableAt: timestamp("available_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("documents_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("documents_object_key_unique").on(table.objectKey),
    check(
      "documents_status_check",
      sql`${table.status} in ('pending', 'available', 'rejected', 'quarantined', 'deleted')`,
    ),
    check("documents_size_bytes_check", sql`${table.sizeBytes} is null or ${table.sizeBytes} >= 0`),
    index("documents_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const documentLinks = pgTable(
  "document_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    documentId: uuid("document_id").notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    purpose: varchar("purpose", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "document_links_tenant_document_fk",
    }).onDelete("restrict"),
    unique("document_links_tenant_document_entity_purpose_unique").on(
      table.tenantId,
      table.documentId,
      table.entityType,
      table.entityId,
      table.purpose,
    ),
    index("document_links_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId),
  ],
);

export const documentPublicLinks = pgTable(
  "document_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    documentId: uuid("document_id").notNull(),
    scope: varchar("scope", { length: 50 }).notNull().default("download"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    creationKeyHash: varchar("creation_key_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "document_public_links_tenant_document_fk",
    }).onDelete("restrict"),
    unique("document_public_links_token_hash_unique").on(table.tokenHash),
    unique("document_public_links_tenant_creation_key_unique").on(
      table.tenantId,
      table.creationKeyHash,
    ),
    check("document_public_links_scope_check", sql`${table.scope} in ('download')`),
    check("document_public_links_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    index("document_public_links_tenant_document_idx").on(
      table.tenantId,
      table.documentId,
      table.scope,
    ),
    index("document_public_links_expiry_idx").on(table.expiresAt),
  ],
);
