import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

export const customerAccounts = pgTable(
  "customer_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    customerType: varchar("customer_type", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ownerUserId: uuid("owner_user_id").notNull(),
    preferredContactMethod: varchar("preferred_contact_method", { length: 30 }),
    billingContactSummary: text("billing_contact_summary"),
    ...auditColumns,
  },
  (table) => [
    unique("customer_accounts_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "customer_accounts_tenant_owner_fk",
    }).onDelete("restrict"),
    check("customer_accounts_type_check", sql`${table.customerType} in ('individual', 'business')`),
    check("customer_accounts_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "customer_accounts_contact_method_check",
      sql`${table.preferredContactMethod} is null or ${table.preferredContactMethod} in ('phone', 'email', 'text')`,
    ),
    check("customer_accounts_normalized_name_check", sql`length(${table.normalizedName}) > 0`),
    index("customer_accounts_tenant_name_idx").on(table.tenantId, table.normalizedName),
    index("customer_accounts_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    email: varchar("email", { length: 320 }),
    normalizedEmail: varchar("normalized_email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    normalizedPhone: varchar("normalized_phone", { length: 30 }),
    preferredContactMethod: varchar("preferred_contact_method", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("contacts_tenant_id_id_unique").on(table.tenantId, table.id),
    check("contacts_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "contacts_contact_method_check",
      sql`${table.preferredContactMethod} in ('phone', 'email', 'text')`,
    ),
    check(
      "contacts_reachable_check",
      sql`${table.normalizedEmail} is not null or ${table.normalizedPhone} is not null`,
    ),
    index("contacts_tenant_email_idx").on(table.tenantId, table.normalizedEmail),
    index("contacts_tenant_phone_idx").on(table.tenantId, table.normalizedPhone),
  ],
);

export const accountContacts = pgTable(
  "account_contacts",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    role: varchar("role", { length: 30 }).notNull().default("primary"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.customerAccountId, table.contactId] }),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "account_contacts_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: "account_contacts_tenant_contact_fk",
    }).onDelete("restrict"),
    check(
      "account_contacts_role_check",
      sql`${table.role} in ('primary', 'billing', 'site', 'other')`,
    ),
    uniqueIndex("account_contacts_one_primary_idx")
      .on(table.tenantId, table.customerAccountId)
      .where(sql`${table.isPrimary} = true`),
    index("account_contacts_tenant_contact_idx").on(table.tenantId, table.contactId),
  ],
);

export const serviceLocations = pgTable(
  "service_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    addressLine1: varchar("address_line_1", { length: 200 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 200 }),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 80 }).notNull(),
    postalCode: varchar("postal_code", { length: 20 }).notNull(),
    normalizedAddress: varchar("normalized_address", { length: 600 }).notNull(),
    accessNotes: text("access_notes"),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("service_locations_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("service_locations_tenant_customer_id_unique").on(
      table.tenantId,
      table.customerAccountId,
      table.id,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "service_locations_tenant_customer_fk",
    }).onDelete("restrict"),
    check("service_locations_status_check", sql`${table.status} in ('active', 'inactive')`),
    check("service_locations_address_check", sql`length(${table.normalizedAddress}) > 0`),
    index("service_locations_tenant_customer_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.status,
    ),
    index("service_locations_tenant_address_idx").on(table.tenantId, table.normalizedAddress),
  ],
);

export const locationContacts = pgTable(
  "location_contacts",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    serviceLocationId: uuid("service_location_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    role: varchar("role", { length: 30 }).notNull().default("site"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.serviceLocationId, table.contactId] }),
    foreignKey({
      columns: [table.tenantId, table.serviceLocationId],
      foreignColumns: [serviceLocations.tenantId, serviceLocations.id],
      name: "location_contacts_tenant_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: "location_contacts_tenant_contact_fk",
    }).onDelete("restrict"),
    check("location_contacts_role_check", sql`${table.role} in ('site', 'access', 'other')`),
    index("location_contacts_tenant_contact_idx").on(table.tenantId, table.contactId),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    leadNumber: varchar("lead_number", { length: 40 }).notNull(),
    customerAccountId: uuid("customer_account_id").notNull(),
    primaryContactId: uuid("primary_contact_id").notNull(),
    serviceLocationId: uuid("service_location_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    serviceType: varchar("service_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("new"),
    source: varchar("source", { length: 30 }).notNull(),
    summary: varchar("summary", { length: 300 }).notNull(),
    materialDescription: varchar("material_description", { length: 240 }),
    estimatedQuantity: numeric("estimated_quantity", { precision: 12, scale: 3 }),
    quantityUnit: varchar("quantity_unit", { length: 30 }),
    rentalStartDate: date("rental_start_date", { mode: "string" }),
    rentalEndDate: date("rental_end_date", { mode: "string" }),
    debrisType: varchar("debris_type", { length: 160 }),
    serviceInstructions: text("service_instructions"),
    terminalReason: text("terminal_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("leads_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("leads_tenant_number_unique").on(table.tenantId, table.leadNumber),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "leads_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId, table.primaryContactId],
      foreignColumns: [
        accountContacts.tenantId,
        accountContacts.customerAccountId,
        accountContacts.contactId,
      ],
      name: "leads_tenant_customer_contact_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId, table.serviceLocationId],
      foreignColumns: [
        serviceLocations.tenantId,
        serviceLocations.customerAccountId,
        serviceLocations.id,
      ],
      name: "leads_tenant_customer_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "leads_tenant_owner_fk",
    }).onDelete("restrict"),
    check(
      "leads_service_type_check",
      sql`${table.serviceType} in ('material_delivery', 'dump_trailer_rental')`,
    ),
    check(
      "leads_status_check",
      sql`${table.status} in ('new', 'contacting', 'qualified', 'estimating', 'quoted', 'accepted', 'lost', 'cancelled', 'duplicate', 'disqualified')`,
    ),
    check(
      "leads_source_check",
      sql`${table.source} in ('phone', 'website', 'email', 'referral', 'repeat', 'other')`,
    ),
    check(
      "leads_service_details_check",
      sql`(
        ${table.serviceType} = 'material_delivery'
        and ${table.materialDescription} is not null
        and ${table.estimatedQuantity} is not null
        and ${table.estimatedQuantity} > 0
        and ${table.quantityUnit} in ('tons', 'cubic_yards', 'loads')
        and ${table.rentalStartDate} is null
        and ${table.rentalEndDate} is null
        and ${table.debrisType} is null
      ) or (
        ${table.serviceType} = 'dump_trailer_rental'
        and ${table.materialDescription} is null
        and ${table.estimatedQuantity} is null
        and ${table.quantityUnit} is null
        and ${table.rentalStartDate} is not null
        and ${table.rentalEndDate} is not null
        and ${table.rentalEndDate} >= ${table.rentalStartDate}
        and ${table.debrisType} is not null
      )`,
    ),
    index("leads_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt),
    index("leads_tenant_customer_idx").on(table.tenantId, table.customerAccountId, table.createdAt),
    index("leads_tenant_owner_status_idx").on(table.tenantId, table.ownerUserId, table.status),
  ],
);

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id").notNull(),
    body: text("body").notNull(),
    visibility: varchar("visibility", { length: 30 }).notNull().default("internal"),
    ...auditColumns,
  },
  (table) => [
    unique("lead_notes_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.leadId],
      foreignColumns: [leads.tenantId, leads.id],
      name: "lead_notes_tenant_lead_fk",
    }).onDelete("restrict"),
    check("lead_notes_visibility_check", sql`${table.visibility} in ('internal', 'customer')`),
    index("lead_notes_tenant_lead_created_idx").on(table.tenantId, table.leadId, table.createdAt),
  ],
);

export const leadTasks = pgTable(
  "lead_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    leadId: uuid("lead_id").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    assignedUserId: uuid("assigned_user_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("lead_tasks_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.leadId],
      foreignColumns: [leads.tenantId, leads.id],
      name: "lead_tasks_tenant_lead_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.assignedUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "lead_tasks_tenant_assignee_fk",
    }).onDelete("restrict"),
    check("lead_tasks_status_check", sql`${table.status} in ('open', 'completed', 'cancelled')`),
    index("lead_tasks_tenant_lead_status_idx").on(table.tenantId, table.leadId, table.status),
    index("lead_tasks_tenant_assignee_due_idx").on(
      table.tenantId,
      table.assignedUserId,
      table.status,
      table.dueAt,
    ),
  ],
);

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

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    defaultUnit: varchar("default_unit", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("materials_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("materials_tenant_name_unique").on(table.tenantId, table.normalizedName),
    check("materials_unit_check", sql`${table.defaultUnit} in ('tons', 'cubic_yards', 'loads')`),
    check("materials_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("materials_tenant_status_idx").on(table.tenantId, table.status, table.name),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 200 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("suppliers_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("suppliers_tenant_name_unique").on(table.tenantId, table.normalizedName),
    check("suppliers_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("suppliers_tenant_status_idx").on(table.tenantId, table.status, table.name),
  ],
);

export const supplierLocations = pgTable(
  "supplier_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    addressSummary: varchar("address_summary", { length: 400 }),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("supplier_locations_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: "supplier_locations_tenant_supplier_fk",
    }).onDelete("restrict"),
    unique("supplier_locations_tenant_supplier_label_unique").on(
      table.tenantId,
      table.supplierId,
      table.label,
    ),
    check("supplier_locations_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("supplier_locations_tenant_supplier_idx").on(
      table.tenantId,
      table.supplierId,
      table.status,
    ),
  ],
);

export const supplierMaterials = pgTable(
  "supplier_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    supplierLocationId: uuid("supplier_location_id").notNull(),
    materialId: uuid("material_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("supplier_materials_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.supplierLocationId],
      foreignColumns: [supplierLocations.tenantId, supplierLocations.id],
      name: "supplier_materials_tenant_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialId],
      foreignColumns: [materials.tenantId, materials.id],
      name: "supplier_materials_tenant_material_fk",
    }).onDelete("restrict"),
    unique("supplier_materials_tenant_location_material_unique").on(
      table.tenantId,
      table.supplierLocationId,
      table.materialId,
    ),
    check("supplier_materials_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("supplier_materials_tenant_material_idx").on(
      table.tenantId,
      table.materialId,
      table.status,
    ),
  ],
);

export const supplierCostVersions = pgTable(
  "supplier_cost_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    supplierMaterialId: uuid("supplier_material_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    unit: varchar("unit", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("supplier_cost_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.supplierMaterialId],
      foreignColumns: [supplierMaterials.tenantId, supplierMaterials.id],
      name: "supplier_cost_versions_tenant_material_fk",
    }).onDelete("restrict"),
    unique("supplier_cost_versions_tenant_material_version_unique").on(
      table.tenantId,
      table.supplierMaterialId,
      table.versionNumber,
    ),
    check("supplier_cost_versions_cost_check", sql`${table.unitCostCents} >= 0`),
    check(
      "supplier_cost_versions_unit_check",
      sql`${table.unit} in ('tons', 'cubic_yards', 'loads')`,
    ),
    check("supplier_cost_versions_status_check", sql`${table.status} in ('active', 'superseded')`),
    uniqueIndex("supplier_cost_versions_one_active_idx")
      .on(table.tenantId, table.supplierMaterialId)
      .where(sql`${table.status} = 'active'`),
    index("supplier_cost_versions_tenant_effective_idx").on(
      table.tenantId,
      table.supplierMaterialId,
      table.effectiveAt,
    ),
  ],
);

export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    baseFeeCents: bigint("base_fee_cents", { mode: "number" }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    ...auditColumns,
  },
  (table) => [
    unique("delivery_zones_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("delivery_zones_tenant_code_unique").on(table.tenantId, table.code),
    check("delivery_zones_fee_check", sql`${table.baseFeeCents} >= 0`),
    check("delivery_zones_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("delivery_zones_tenant_status_idx").on(table.tenantId, table.status, table.name),
  ],
);

export const pricingPolicies = pgTable(
  "pricing_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    serviceType: varchar("service_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    ...auditColumns,
  },
  (table) => [
    unique("pricing_policies_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("pricing_policies_tenant_name_service_unique").on(
      table.tenantId,
      table.name,
      table.serviceType,
    ),
    check(
      "pricing_policies_service_check",
      sql`${table.serviceType} in ('material_delivery', 'dump_trailer_rental')`,
    ),
    check("pricing_policies_status_check", sql`${table.status} in ('draft', 'active', 'retired')`),
    index("pricing_policies_tenant_service_status_idx").on(
      table.tenantId,
      table.serviceType,
      table.status,
    ),
  ],
);

export const pricingVersions = pgTable(
  "pricing_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    pricingPolicyId: uuid("pricing_policy_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("pricing_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.pricingPolicyId],
      foreignColumns: [pricingPolicies.tenantId, pricingPolicies.id],
      name: "pricing_versions_tenant_policy_fk",
    }).onDelete("restrict"),
    unique("pricing_versions_tenant_policy_version_unique").on(
      table.tenantId,
      table.pricingPolicyId,
      table.versionNumber,
    ),
    check("pricing_versions_version_check", sql`${table.versionNumber} > 0`),
    check("pricing_versions_status_check", sql`${table.status} in ('draft', 'active', 'retired')`),
    uniqueIndex("pricing_versions_one_active_idx")
      .on(table.tenantId, table.pricingPolicyId)
      .where(sql`${table.status} = 'active'`),
    index("pricing_versions_tenant_status_idx").on(table.tenantId, table.status, table.effectiveAt),
  ],
);

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    pricingVersionId: uuid("pricing_version_id").notNull(),
    code: varchar("code", { length: 100 }).notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    calculationType: varchar("calculation_type", { length: 50 }).notNull(),
    sequence: integer("sequence").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("pricing_rules_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.pricingVersionId],
      foreignColumns: [pricingVersions.tenantId, pricingVersions.id],
      name: "pricing_rules_tenant_version_fk",
    }).onDelete("restrict"),
    unique("pricing_rules_tenant_version_code_unique").on(
      table.tenantId,
      table.pricingVersionId,
      table.code,
    ),
    check(
      "pricing_rules_calculation_type_check",
      sql`${table.calculationType} in ('fixed_amount', 'quantity_rate', 'percentage_markup', 'tiered_distance_rate', 'greater_of', 'minimum_charge', 'cost_plus_markup', 'additional_day', 'allowance_overage', 'controlled_rounding')`,
    ),
    check("pricing_rules_sequence_check", sql`${table.sequence} >= 0`),
    index("pricing_rules_tenant_version_sequence_idx").on(
      table.tenantId,
      table.pricingVersionId,
      table.sequence,
    ),
  ],
);

export const pricingRuleTiers = pgTable(
  "pricing_rule_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    pricingRuleId: uuid("pricing_rule_id").notNull(),
    sequence: integer("sequence").notNull(),
    lowerBound: numeric("lower_bound", { precision: 12, scale: 3 }).notNull(),
    upperBound: numeric("upper_bound", { precision: 12, scale: 3 }),
    fixedAmountCents: bigint("fixed_amount_cents", { mode: "number" }),
    rateCentsPerUnit: bigint("rate_cents_per_unit", { mode: "number" }),
    ...auditColumns,
  },
  (table) => [
    unique("pricing_rule_tiers_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.pricingRuleId],
      foreignColumns: [pricingRules.tenantId, pricingRules.id],
      name: "pricing_rule_tiers_tenant_rule_fk",
    }).onDelete("restrict"),
    unique("pricing_rule_tiers_tenant_rule_sequence_unique").on(
      table.tenantId,
      table.pricingRuleId,
      table.sequence,
    ),
    check(
      "pricing_rule_tiers_bounds_check",
      sql`${table.lowerBound} >= 0 and (${table.upperBound} is null or ${table.upperBound} > ${table.lowerBound})`,
    ),
    check(
      "pricing_rule_tiers_amount_check",
      sql`(${table.fixedAmountCents} is not null and ${table.fixedAmountCents} >= 0) or (${table.rateCentsPerUnit} is not null and ${table.rateCentsPerUnit} >= 0)`,
    ),
    index("pricing_rule_tiers_tenant_rule_idx").on(
      table.tenantId,
      table.pricingRuleId,
      table.sequence,
    ),
  ],
);

export const estimates = pgTable(
  "estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    estimateNumber: varchar("estimate_number", { length: 40 }).notNull(),
    leadId: uuid("lead_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    ...auditColumns,
  },
  (table) => [
    unique("estimates_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.leadId],
      foreignColumns: [leads.tenantId, leads.id],
      name: "estimates_tenant_lead_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "estimates_tenant_owner_fk",
    }).onDelete("restrict"),
    unique("estimates_tenant_number_unique").on(table.tenantId, table.estimateNumber),
    unique("estimates_tenant_lead_unique").on(table.tenantId, table.leadId),
    check(
      "estimates_status_check",
      sql`${table.status} in ('draft', 'in_analysis', 'pending_approval', 'approved', 'quote_generated')`,
    ),
    index("estimates_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);

export const estimateVersions = pgTable(
  "estimate_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    estimateId: uuid("estimate_id").notNull(),
    pricingVersionId: uuid("pricing_version_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    serviceType: varchar("service_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    operationalAssessment: text("operational_assessment"),
    riskAssessment: text("risk_assessment"),
    readiness: varchar("readiness", { length: 40 }).notNull().default("ready"),
    purchaseCostCents: bigint("purchase_cost_cents", { mode: "number" }).notNull(),
    recommendedPriceCents: bigint("recommended_price_cents", { mode: "number" }).notNull(),
    approvedQuotePriceCents: bigint("approved_quote_price_cents", { mode: "number" }),
    depositCents: bigint("deposit_cents", { mode: "number" }).notNull(),
    marginCents: bigint("margin_cents", { mode: "number" }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    ...auditColumns,
  },
  (table) => [
    unique("estimate_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.estimateId],
      foreignColumns: [estimates.tenantId, estimates.id],
      name: "estimate_versions_tenant_estimate_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.pricingVersionId],
      foreignColumns: [pricingVersions.tenantId, pricingVersions.id],
      name: "estimate_versions_tenant_pricing_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "estimate_versions_tenant_approver_fk",
    }).onDelete("restrict"),
    unique("estimate_versions_tenant_estimate_version_unique").on(
      table.tenantId,
      table.estimateId,
      table.versionNumber,
    ),
    check("estimate_versions_version_check", sql`${table.versionNumber} > 0`),
    check(
      "estimate_versions_service_check",
      sql`${table.serviceType} in ('material_delivery', 'dump_trailer_rental')`,
    ),
    check(
      "estimate_versions_status_check",
      sql`${table.status} in ('draft', 'pending_approval', 'approved', 'quote_generated', 'superseded')`,
    ),
    check(
      "estimate_versions_readiness_check",
      sql`${table.readiness} in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required')`,
    ),
    check("estimate_versions_purchase_cost_check", sql`${table.purchaseCostCents} >= 0`),
    check("estimate_versions_recommended_price_check", sql`${table.recommendedPriceCents} >= 0`),
    check(
      "estimate_versions_approved_price_check",
      sql`${table.approvedQuotePriceCents} is null or ${table.approvedQuotePriceCents} >= 0`,
    ),
    check("estimate_versions_deposit_check", sql`${table.depositCents} >= 0`),
    index("estimate_versions_tenant_estimate_status_idx").on(
      table.tenantId,
      table.estimateId,
      table.status,
      table.versionNumber,
    ),
  ],
);

export const estimateCostItems = pgTable(
  "estimate_cost_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    estimateVersionId: uuid("estimate_version_id").notNull(),
    supplierCostVersionId: uuid("supplier_cost_version_id"),
    category: varchar("category", { length: 40 }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 30 }).notNull(),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull(),
    totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull(),
    sequence: integer("sequence").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  },
  (table) => [
    unique("estimate_cost_items_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.estimateVersionId],
      foreignColumns: [estimateVersions.tenantId, estimateVersions.id],
      name: "estimate_cost_items_tenant_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supplierCostVersionId],
      foreignColumns: [supplierCostVersions.tenantId, supplierCostVersions.id],
      name: "estimate_cost_items_tenant_supplier_cost_fk",
    }).onDelete("restrict"),
    check(
      "estimate_cost_items_category_check",
      sql`${table.category} in ('material', 'delivery', 'disposal', 'operational', 'other')`,
    ),
    check("estimate_cost_items_quantity_check", sql`${table.quantity} > 0`),
    check("estimate_cost_items_unit_cost_check", sql`${table.unitCostCents} >= 0`),
    check("estimate_cost_items_total_cost_check", sql`${table.totalCostCents} >= 0`),
    check("estimate_cost_items_sequence_check", sql`${table.sequence} >= 0`),
    index("estimate_cost_items_tenant_version_sequence_idx").on(
      table.tenantId,
      table.estimateVersionId,
      table.sequence,
    ),
  ],
);

export const pricingCalculationResults = pgTable(
  "pricing_calculation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    estimateVersionId: uuid("estimate_version_id").notNull(),
    pricingRuleId: uuid("pricing_rule_id"),
    code: varchar("code", { length: 100 }).notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    calculationType: varchar("calculation_type", { length: 50 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    sequence: integer("sequence").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  },
  (table) => [
    unique("pricing_calculation_results_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.estimateVersionId],
      foreignColumns: [estimateVersions.tenantId, estimateVersions.id],
      name: "pricing_calculation_results_tenant_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.pricingRuleId],
      foreignColumns: [pricingRules.tenantId, pricingRules.id],
      name: "pricing_calculation_results_tenant_rule_fk",
    }).onDelete("restrict"),
    unique("pricing_calculation_results_tenant_version_code_unique").on(
      table.tenantId,
      table.estimateVersionId,
      table.code,
    ),
    check("pricing_calculation_results_amount_check", sql`${table.amountCents} >= 0`),
    check("pricing_calculation_results_sequence_check", sql`${table.sequence} >= 0`),
    index("pricing_calculation_results_tenant_version_sequence_idx").on(
      table.tenantId,
      table.estimateVersionId,
      table.sequence,
    ),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteNumber: varchar("quote_number", { length: 40 }).notNull(),
    estimateId: uuid("estimate_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    customerAccountId: uuid("customer_account_id").notNull(),
    primaryContactId: uuid("primary_contact_id").notNull(),
    serviceLocationId: uuid("service_location_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    ...auditColumns,
  },
  (table) => [
    unique("quotes_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("quotes_tenant_number_unique").on(table.tenantId, table.quoteNumber),
    unique("quotes_tenant_estimate_unique").on(table.tenantId, table.estimateId),
    foreignKey({
      columns: [table.tenantId, table.estimateId],
      foreignColumns: [estimates.tenantId, estimates.id],
      name: "quotes_tenant_estimate_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.leadId],
      foreignColumns: [leads.tenantId, leads.id],
      name: "quotes_tenant_lead_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "quotes_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId, table.primaryContactId],
      foreignColumns: [
        accountContacts.tenantId,
        accountContacts.customerAccountId,
        accountContacts.contactId,
      ],
      name: "quotes_tenant_customer_contact_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId, table.serviceLocationId],
      foreignColumns: [
        serviceLocations.tenantId,
        serviceLocations.customerAccountId,
        serviceLocations.id,
      ],
      name: "quotes_tenant_customer_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "quotes_tenant_owner_fk",
    }).onDelete("restrict"),
    check(
      "quotes_status_check",
      sql`${table.status} in ('draft', 'ready_to_send', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded')`,
    ),
    index("quotes_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt),
    index("quotes_tenant_customer_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.createdAt,
    ),
  ],
);

export const quoteVersions = pgTable(
  "quote_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteId: uuid("quote_id").notNull(),
    estimateVersionId: uuid("estimate_version_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    customerSnapshot: jsonb("customer_snapshot").$type<Record<string, unknown>>().notNull(),
    locationSnapshot: jsonb("location_snapshot").$type<Record<string, unknown>>().notNull(),
    scope: text("scope").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    adjustmentCents: bigint("adjustment_cents", { mode: "number" }).notNull().default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    requiredDepositCents: bigint("required_deposit_cents", { mode: "number" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("quote_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteId],
      foreignColumns: [quotes.tenantId, quotes.id],
      name: "quote_versions_tenant_quote_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.estimateVersionId],
      foreignColumns: [estimateVersions.tenantId, estimateVersions.id],
      name: "quote_versions_tenant_estimate_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "quote_versions_tenant_approver_fk",
    }).onDelete("restrict"),
    unique("quote_versions_tenant_quote_version_unique").on(
      table.tenantId,
      table.quoteId,
      table.versionNumber,
    ),
    check("quote_versions_version_check", sql`${table.versionNumber} > 0`),
    check(
      "quote_versions_status_check",
      sql`${table.status} in ('draft', 'ready_to_send', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded')`,
    ),
    check("quote_versions_subtotal_check", sql`${table.subtotalCents} >= 0`),
    check("quote_versions_tax_check", sql`${table.taxCents} >= 0`),
    check("quote_versions_total_check", sql`${table.totalCents} >= 0`),
    check(
      "quote_versions_deposit_check",
      sql`${table.requiredDepositCents} >= 0 and ${table.requiredDepositCents} <= ${table.totalCents}`,
    ),
    uniqueIndex("quote_versions_one_accepted_idx")
      .on(table.tenantId, table.quoteId)
      .where(sql`${table.status} = 'accepted'`),
    index("quote_versions_tenant_quote_status_idx").on(
      table.tenantId,
      table.quoteId,
      table.status,
      table.versionNumber,
    ),
    index("quote_versions_tenant_expiry_idx").on(table.tenantId, table.status, table.expiresAt),
  ],
);

export const quoteLineItems = pgTable(
  "quote_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteVersionId: uuid("quote_version_id").notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 40 }).notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    sequence: integer("sequence").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("quote_line_items_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "quote_line_items_tenant_version_fk",
    }).onDelete("restrict"),
    check("quote_line_items_quantity_check", sql`${table.quantity} > 0`),
    check("quote_line_items_unit_price_check", sql`${table.unitPriceCents} >= 0`),
    check("quote_line_items_total_check", sql`${table.totalCents} >= 0`),
    check("quote_line_items_sequence_check", sql`${table.sequence} >= 0`),
    index("quote_line_items_tenant_version_sequence_idx").on(
      table.tenantId,
      table.quoteVersionId,
      table.sequence,
    ),
  ],
);

export const quoteTerms = pgTable(
  "quote_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteVersionId: uuid("quote_version_id").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    sequence: integer("sequence").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("quote_terms_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "quote_terms_tenant_version_fk",
    }).onDelete("restrict"),
    check("quote_terms_sequence_check", sql`${table.sequence} >= 0`),
    index("quote_terms_tenant_version_sequence_idx").on(
      table.tenantId,
      table.quoteVersionId,
      table.sequence,
    ),
  ],
);

export const quoteDeliveries = pgTable(
  "quote_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteVersionId: uuid("quote_version_id").notNull(),
    channel: varchar("channel", { length: 30 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("sent"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    providerReference: varchar("provider_reference", { length: 240 }),
    ...auditColumns,
  },
  (table) => [
    unique("quote_deliveries_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "quote_deliveries_tenant_version_fk",
    }).onDelete("restrict"),
    check("quote_deliveries_channel_check", sql`${table.channel} in ('email', 'text', 'link')`),
    check("quote_deliveries_status_check", sql`${table.status} in ('sent', 'failed')`),
    index("quote_deliveries_tenant_version_idx").on(
      table.tenantId,
      table.quoteVersionId,
      table.sentAt,
    ),
  ],
);

export const quotePublicLinks = pgTable(
  "quote_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteVersionId: uuid("quote_version_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    creationKeyHash: varchar("creation_key_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("quote_public_links_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "quote_public_links_tenant_version_fk",
    }).onDelete("restrict"),
    unique("quote_public_links_token_hash_unique").on(table.tokenHash),
    unique("quote_public_links_tenant_creation_key_unique").on(
      table.tenantId,
      table.creationKeyHash,
    ),
    check("quote_public_links_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("quote_public_links_view_count_check", sql`${table.viewCount} >= 0`),
    index("quote_public_links_tenant_version_idx").on(
      table.tenantId,
      table.quoteVersionId,
      table.expiresAt,
    ),
  ],
);

export const quoteAcceptances = pgTable(
  "quote_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    quoteVersionId: uuid("quote_version_id").notNull(),
    acceptingContactId: uuid("accepting_contact_id").notNull(),
    acceptedName: varchar("accepted_name", { length: 200 }).notNull(),
    acceptanceMethod: varchar("acceptance_method", { length: 40 }).notNull(),
    consentText: text("consent_text").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    ...auditColumns,
  },
  (table) => [
    unique("quote_acceptances_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.quoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "quote_acceptances_tenant_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.acceptingContactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: "quote_acceptances_tenant_contact_fk",
    }).onDelete("restrict"),
    unique("quote_acceptances_tenant_version_unique").on(table.tenantId, table.quoteVersionId),
    check(
      "quote_acceptances_method_check",
      sql`${table.acceptanceMethod} in ('typed_name', 'staff_recorded')`,
    ),
    index("quote_acceptances_tenant_accepted_idx").on(table.tenantId, table.acceptedAt),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectNumber: varchar("project_number", { length: 40 }).notNull(),
    customerAccountId: uuid("customer_account_id").notNull(),
    primaryContactId: uuid("primary_contact_id").notNull(),
    serviceLocationId: uuid("service_location_id").notNull(),
    acceptedQuoteVersionId: uuid("accepted_quote_version_id").notNull(),
    acceptedQuoteContentHash: varchar("accepted_quote_content_hash", { length: 64 }).notNull(),
    acceptedValueCents: bigint("accepted_value_cents", { mode: "number" }).notNull(),
    requiredDepositCents: bigint("required_deposit_cents", { mode: "number" }).notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    serviceType: varchar("service_type", { length: 40 }).notNull(),
    outcomeStatement: text("outcome_statement").notNull(),
    contractRequirement: varchar("contract_requirement", { length: 30 })
      .notNull()
      .default("required"),
    contractStatus: varchar("contract_status", { length: 30 }).notNull().default("pending"),
    depositRequirement: varchar("deposit_requirement", { length: 30 })
      .notNull()
      .default("required"),
    depositStatus: varchar("deposit_status", { length: 30 }).notNull().default("pending"),
    depositEvidenceReference: varchar("deposit_evidence_reference", { length: 240 }),
    operationallyCompletedAt: timestamp("operationally_completed_at", { withTimezone: true }),
    financiallyCompletedAt: timestamp("financially_completed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    status: varchar("status", { length: 40 }).notNull().default("pending_contract"),
    ...auditColumns,
  },
  (table) => [
    unique("projects_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("projects_tenant_number_unique").on(table.tenantId, table.projectNumber),
    unique("projects_tenant_accepted_quote_unique").on(
      table.tenantId,
      table.acceptedQuoteVersionId,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "projects_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId, table.serviceLocationId],
      foreignColumns: [
        serviceLocations.tenantId,
        serviceLocations.customerAccountId,
        serviceLocations.id,
      ],
      name: "projects_tenant_customer_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.primaryContactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: "projects_tenant_contact_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.acceptedQuoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "projects_tenant_quote_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ownerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "projects_tenant_owner_fk",
    }).onDelete("restrict"),
    check(
      "projects_service_check",
      sql`${table.serviceType} in ('material_delivery', 'dump_trailer_rental')`,
    ),
    check(
      "projects_status_check",
      sql`${table.status} in ('pending_setup', 'pending_contract', 'pending_deposit', 'ready_for_planning', 'planning', 'active', 'operationally_complete', 'financially_complete', 'completed', 'closed', 'on_hold')`,
    ),
    check(
      "projects_contract_requirement_check",
      sql`${table.contractRequirement} in ('required', 'waived')`,
    ),
    check(
      "projects_contract_status_check",
      sql`${table.contractStatus} in ('pending', 'generated', 'business_signed', 'sent', 'viewed', 'executed', 'waived', 'voided')`,
    ),
    check(
      "projects_deposit_requirement_check",
      sql`${table.depositRequirement} in ('required', 'waived')`,
    ),
    check(
      "projects_deposit_status_check",
      sql`${table.depositStatus} in ('pending', 'satisfied', 'waived')`,
    ),
    check("projects_value_check", sql`${table.acceptedValueCents} >= 0`),
    check("projects_deposit_check", sql`${table.requiredDepositCents} >= 0`),
    index("projects_tenant_customer_status_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.status,
    ),
  ],
);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    contractNumber: varchar("contract_number", { length: 40 }).notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>().notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("contracts_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("contracts_tenant_project_unique").on(table.tenantId, table.projectId),
    unique("contracts_tenant_number_unique").on(table.tenantId, table.contractNumber),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "contracts_tenant_project_fk",
    }).onDelete("restrict"),
    check("contracts_version_check", sql`${table.versionNumber} > 0`),
    check(
      "contracts_status_check",
      sql`${table.status} in ('draft', 'business_signed', 'sent', 'viewed', 'executed', 'voided')`,
    ),
    index("contracts_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);

export const contractSignatures = pgTable(
  "contract_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").notNull(),
    signerRole: varchar("signer_role", { length: 30 }).notNull(),
    signerUserId: uuid("signer_user_id"),
    signerContactId: uuid("signer_contact_id"),
    typedName: varchar("typed_name", { length: 200 }).notNull(),
    consentText: text("consent_text").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    ...auditColumns,
  },
  (table) => [
    unique("contract_signatures_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("contract_signatures_tenant_contract_role_unique").on(
      table.tenantId,
      table.contractId,
      table.signerRole,
    ),
    foreignKey({
      columns: [table.tenantId, table.contractId],
      foreignColumns: [contracts.tenantId, contracts.id],
      name: "contract_signatures_tenant_contract_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.signerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "contract_signatures_tenant_user_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.signerContactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: "contract_signatures_tenant_contact_fk",
    }).onDelete("restrict"),
    check("contract_signatures_role_check", sql`${table.signerRole} in ('business', 'customer')`),
    check(
      "contract_signatures_subject_check",
      sql`(${table.signerRole} = 'business' and ${table.signerUserId} is not null and ${table.signerContactId} is null) or (${table.signerRole} = 'customer' and ${table.signerContactId} is not null and ${table.signerUserId} is null)`,
    ),
    index("contract_signatures_tenant_signed_idx").on(table.tenantId, table.signedAt),
  ],
);

export const contractPublicLinks = pgTable(
  "contract_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    contractId: uuid("contract_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    creationKeyHash: varchar("creation_key_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    ...auditColumns,
  },
  (table) => [
    unique("contract_public_links_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("contract_public_links_token_hash_unique").on(table.tokenHash),
    unique("contract_public_links_tenant_creation_key_unique").on(
      table.tenantId,
      table.creationKeyHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.contractId],
      foreignColumns: [contracts.tenantId, contracts.id],
      name: "contract_public_links_tenant_contract_fk",
    }).onDelete("restrict"),
    check("contract_public_links_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("contract_public_links_view_count_check", sql`${table.viewCount} >= 0`),
    index("contract_public_links_tenant_contract_idx").on(
      table.tenantId,
      table.contractId,
      table.expiresAt,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    jobNumber: varchar("job_number", { length: 40 }).notNull(),
    serviceType: varchar("service_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("new"),
    readiness: varchar("readiness", { length: 40 }).notNull().default("evaluation_required"),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    operationallyCompletedAt: timestamp("operationally_completed_at", { withTimezone: true }),
    financiallyCompletedAt: timestamp("financially_completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("jobs_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("jobs_tenant_number_unique").on(table.tenantId, table.jobNumber),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "jobs_tenant_project_fk",
    }).onDelete("restrict"),
    check(
      "jobs_service_check",
      sql`${table.serviceType} in ('material_delivery', 'dump_trailer_rental')`,
    ),
    check(
      "jobs_status_check",
      sql`${table.status} in ('new', 'planning', 'needs_scheduling', 'scheduled', 'dispatch_ready', 'active', 'operationally_complete', 'awaiting_final_invoice', 'invoiced', 'financially_complete', 'closed', 'on_hold', 'cancelled')`,
    ),
    check(
      "jobs_readiness_check",
      sql`${table.readiness} in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required')`,
    ),
    check(
      "jobs_schedule_range_check",
      sql`${table.scheduledStartAt} is null or ${table.scheduledEndAt} is null or ${table.scheduledEndAt} > ${table.scheduledStartAt}`,
    ),
    index("jobs_tenant_project_status_idx").on(table.tenantId, table.projectId, table.status),
    index("jobs_tenant_schedule_queue_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    assetNumber: varchar("asset_number", { length: 40 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    assetType: varchar("asset_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("available"),
    capacityWeight: numeric("capacity_weight", { precision: 14, scale: 3 }),
    ...auditColumns,
  },
  (table) => [
    unique("assets_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("assets_tenant_number_unique").on(table.tenantId, table.assetNumber),
    check("assets_type_check", sql`${table.assetType} in ('truck', 'trailer', 'equipment')`),
    check(
      "assets_status_check",
      sql`${table.status} in ('available', 'in_use', 'out_of_service', 'retired')`,
    ),
    check(
      "assets_capacity_check",
      sql`${table.capacityWeight} is null or ${table.capacityWeight} > 0`,
    ),
    index("assets_tenant_type_status_idx").on(table.tenantId, table.assetType, table.status),
  ],
);

export const scheduleBlocks = pgTable(
  "schedule_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    blockType: varchar("block_type", { length: 40 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("tentative"),
    notes: text("notes"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("schedule_blocks_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "schedule_blocks_tenant_job_fk",
    }).onDelete("restrict"),
    check(
      "schedule_blocks_type_check",
      sql`${table.blockType} in ('service', 'dropoff', 'pickup', 'disposal', 'inspection', 'other')`,
    ),
    check(
      "schedule_blocks_status_check",
      sql`${table.status} in ('tentative', 'confirmed', 'completed', 'cancelled')`,
    ),
    check("schedule_blocks_range_check", sql`${table.endsAt} > ${table.startsAt}`),
    index("schedule_blocks_tenant_window_idx").on(
      table.tenantId,
      table.startsAt,
      table.endsAt,
      table.status,
    ),
    index("schedule_blocks_tenant_job_idx").on(table.tenantId, table.jobId, table.startsAt),
  ],
);

export const assetReservations = pgTable(
  "asset_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    assetId: uuid("asset_id").notNull(),
    jobId: uuid("job_id").notNull(),
    scheduleBlockId: uuid("schedule_block_id"),
    reservationType: varchar("reservation_type", { length: 30 }).notNull().default("schedule"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("asset_reservations_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "asset_reservations_tenant_asset_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "asset_reservations_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id],
      name: "asset_reservations_tenant_block_fk",
    }).onDelete("restrict"),
    check(
      "asset_reservations_type_check",
      sql`${table.reservationType} in ('schedule', 'occupancy')`,
    ),
    check(
      "asset_reservations_status_check",
      sql`${table.status} in ('active', 'released', 'cancelled')`,
    ),
    check("asset_reservations_range_check", sql`${table.endsAt} > ${table.startsAt}`),
    index("asset_reservations_tenant_asset_window_idx").on(
      table.tenantId,
      table.assetId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export const jobAssignments = pgTable(
  "job_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    scheduleBlockId: uuid("schedule_block_id"),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("assigned"),
    ...auditColumns,
  },
  (table) => [
    unique("job_assignments_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("job_assignments_tenant_job_block_user_role_unique").on(
      table.tenantId,
      table.jobId,
      table.scheduleBlockId,
      table.userId,
      table.role,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "job_assignments_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id],
      name: "job_assignments_tenant_block_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
      name: "job_assignments_tenant_user_fk",
    }).onDelete("restrict"),
    check("job_assignments_role_check", sql`${table.role} in ('driver', 'dispatcher', 'crew')`),
    check(
      "job_assignments_status_check",
      sql`${table.status} in ('assigned', 'declined', 'completed', 'cancelled')`,
    ),
    index("job_assignments_tenant_user_status_idx").on(table.tenantId, table.userId, table.status),
  ],
);

export const assetAssignments = pgTable(
  "asset_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    scheduleBlockId: uuid("schedule_block_id"),
    assetId: uuid("asset_id").notNull(),
    role: varchar("role", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("assigned"),
    ...auditColumns,
  },
  (table) => [
    unique("asset_assignments_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("asset_assignments_tenant_job_block_asset_role_unique").on(
      table.tenantId,
      table.jobId,
      table.scheduleBlockId,
      table.assetId,
      table.role,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "asset_assignments_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id],
      name: "asset_assignments_tenant_block_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "asset_assignments_tenant_asset_fk",
    }).onDelete("restrict"),
    check("asset_assignments_role_check", sql`${table.role} in ('truck', 'trailer', 'equipment')`),
    check(
      "asset_assignments_status_check",
      sql`${table.status} in ('assigned', 'completed', 'cancelled')`,
    ),
    index("asset_assignments_tenant_asset_status_idx").on(
      table.tenantId,
      table.assetId,
      table.status,
    ),
  ],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    scheduleBlockId: uuid("schedule_block_id"),
    sequence: integer("sequence").notNull(),
    stopType: varchar("stop_type", { length: 30 }).notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    locationSnapshot: jsonb("location_snapshot").$type<Record<string, unknown>>().notNull(),
    instructions: text("instructions"),
    status: varchar("status", { length: 30 }).notNull().default("planned"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("route_stops_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("route_stops_tenant_job_sequence_unique").on(
      table.tenantId,
      table.jobId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "route_stops_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id],
      name: "route_stops_tenant_block_fk",
    }).onDelete("restrict"),
    check("route_stops_sequence_check", sql`${table.sequence} > 0`),
    check(
      "route_stops_type_check",
      sql`${table.stopType} in ('supplier', 'customer', 'dropoff', 'pickup', 'disposal', 'inspection', 'other')`,
    ),
    check(
      "route_stops_status_check",
      sql`${table.status} in ('planned', 'arrived', 'completed', 'skipped')`,
    ),
    index("route_stops_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
  ],
);

export const checklistInstances = pgTable(
  "checklist_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    scheduleBlockId: uuid("schedule_block_id"),
    templateCode: varchar("template_code", { length: 100 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    required: boolean("required").notNull().default(true),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("checklist_instances_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("checklist_instances_tenant_job_template_unique").on(
      table.tenantId,
      table.jobId,
      table.templateCode,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "checklist_instances_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id],
      name: "checklist_instances_tenant_block_fk",
    }).onDelete("restrict"),
    check(
      "checklist_instances_status_check",
      sql`${table.status} in ('open', 'in_progress', 'completed', 'waived')`,
    ),
    index("checklist_instances_tenant_job_status_idx").on(
      table.tenantId,
      table.jobId,
      table.status,
    ),
  ],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    checklistInstanceId: uuid("checklist_instance_id").notNull(),
    sequence: integer("sequence").notNull(),
    label: varchar("label", { length: 240 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    response: text("response"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    ...auditColumns,
  },
  (table) => [
    unique("checklist_items_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("checklist_items_tenant_instance_sequence_unique").on(
      table.tenantId,
      table.checklistInstanceId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.tenantId, table.checklistInstanceId],
      foreignColumns: [checklistInstances.tenantId, checklistInstances.id],
      name: "checklist_items_tenant_instance_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.completedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "checklist_items_tenant_completed_by_fk",
    }).onDelete("restrict"),
    check("checklist_items_sequence_check", sql`${table.sequence} > 0`),
    check(
      "checklist_items_status_check",
      sql`${table.status} in ('pending', 'completed', 'failed', 'not_applicable')`,
    ),
    index("checklist_items_tenant_instance_status_idx").on(
      table.tenantId,
      table.checklistInstanceId,
      table.status,
    ),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    summary: varchar("summary", { length: 300 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("job_events_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "job_events_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actorUserId],
      foreignColumns: [users.tenantId, users.id],
      name: "job_events_tenant_actor_fk",
    }).onDelete("restrict"),
    index("job_events_tenant_job_occurred_idx").on(table.tenantId, table.jobId, table.occurredAt),
  ],
);

export const readinessEvaluations = pgTable(
  "readiness_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    jobId: uuid("job_id"),
    readinessType: varchar("readiness_type", { length: 30 }).notNull(),
    result: varchar("result", { length: 40 }).notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    evaluatedBy: uuid("evaluated_by"),
    ...auditColumns,
  },
  (table) => [
    unique("readiness_evaluations_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "readiness_evaluations_tenant_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "readiness_evaluations_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evaluatedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "readiness_evaluations_tenant_evaluator_fk",
    }).onDelete("restrict"),
    check(
      "readiness_evaluations_owner_check",
      sql`(${table.projectId} is not null and ${table.jobId} is null) or (${table.projectId} is null and ${table.jobId} is not null)`,
    ),
    check(
      "readiness_evaluations_type_check",
      sql`${table.readinessType} in ('planning', 'schedule', 'dispatch', 'completion', 'invoice', 'closure')`,
    ),
    check(
      "readiness_evaluations_result_check",
      sql`${table.result} in ('ready', 'ready_with_warnings', 'not_ready', 'evaluation_required')`,
    ),
    index("readiness_evaluations_tenant_project_idx").on(
      table.tenantId,
      table.projectId,
      table.readinessType,
      table.evaluatedAt,
    ),
    index("readiness_evaluations_tenant_job_idx").on(
      table.tenantId,
      table.jobId,
      table.readinessType,
      table.evaluatedAt,
    ),
  ],
);

export const operationalHolds = pgTable(
  "operational_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    jobId: uuid("job_id"),
    reason: text("reason").notNull(),
    previousStatus: varchar("previous_status", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    placedBy: uuid("placed_by").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by"),
    releaseReason: text("release_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("operational_holds_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.projectId],
      foreignColumns: [projects.tenantId, projects.id],
      name: "operational_holds_tenant_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "operational_holds_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.placedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "operational_holds_tenant_placed_by_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.releasedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "operational_holds_tenant_released_by_fk",
    }).onDelete("restrict"),
    check(
      "operational_holds_owner_check",
      sql`(${table.projectId} is not null and ${table.jobId} is null) or (${table.projectId} is null and ${table.jobId} is not null)`,
    ),
    check("operational_holds_status_check", sql`${table.status} in ('active', 'released')`),
    index("operational_holds_tenant_project_status_idx").on(
      table.tenantId,
      table.projectId,
      table.status,
    ),
    index("operational_holds_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
  ],
);
