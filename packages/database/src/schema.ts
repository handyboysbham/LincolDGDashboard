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
    unique("supplier_locations_tenant_supplier_id_unique").on(
      table.tenantId,
      table.supplierId,
      table.id,
    ),
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
    unique("projects_tenant_id_customer_unique").on(
      table.tenantId,
      table.id,
      table.customerAccountId,
    ),
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
    unique("jobs_tenant_id_project_unique").on(table.tenantId, table.id, table.projectId),
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
    capacityVolumeCubicYards: numeric("capacity_volume_cubic_yards", {
      precision: 14,
      scale: 3,
    }),
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
    check(
      "assets_volume_capacity_check",
      sql`${table.capacityVolumeCubicYards} is null or ${table.capacityVolumeCubicYards} > 0`,
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
    unique("schedule_blocks_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
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
    unique("asset_reservations_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
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
    unique("route_stops_tenant_job_id_unique").on(table.tenantId, table.jobId, table.id),
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

export const materialDeliveryDetails = pgTable(
  "material_delivery_details",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("planning"),
    deliveryType: varchar("delivery_type", { length: 30 }).notNull().default("bulk"),
    plannedLoadCount: integer("planned_load_count").notNull().default(1),
    plannedVolumeCubicYards: numeric("planned_volume_cubic_yards", {
      precision: 14,
      scale: 3,
    }),
    plannedWeightPounds: numeric("planned_weight_pounds", { precision: 14, scale: 3 }),
    actualDeliveredVolumeCubicYards: numeric("actual_delivered_volume_cubic_yards", {
      precision: 14,
      scale: 3,
    }),
    actualDeliveredWeightPounds: numeric("actual_delivered_weight_pounds", {
      precision: 14,
      scale: 3,
    }),
    capacityStatus: varchar("capacity_status", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    compatibilityStatus: varchar("compatibility_status", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    receiptStatus: varchar("receipt_status", { length: 30 }).notNull().default("missing"),
    placementEvidenceRequired: boolean("placement_evidence_required").notNull().default(true),
    placementEvidenceStatus: varchar("placement_evidence_status", { length: 30 })
      .notNull()
      .default("missing"),
    invoiceReadiness: varchar("invoice_readiness", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    partialDelivery: boolean("partial_delivery").notNull().default(false),
    completionSummary: text("completion_summary"),
    operationallyCompletedAt: timestamp("operationally_completed_at", { withTimezone: true }),
    invoiceReadyAt: timestamp("invoice_ready_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("material_delivery_details_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("material_delivery_details_tenant_job_unique").on(table.tenantId, table.jobId),
    unique("material_delivery_details_tenant_id_job_unique").on(
      table.tenantId,
      table.id,
      table.jobId,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_delivery_details_tenant_job_fk",
    }).onDelete("restrict"),
    check(
      "material_delivery_details_status_check",
      sql`${table.status} in ('planning', 'ready', 'active', 'partially_delivered', 'delivered', 'reconciling', 'operationally_complete', 'cancelled')`,
    ),
    check(
      "material_delivery_details_type_check",
      sql`${table.deliveryType} in ('bulk', 'placed', 'spread')`,
    ),
    check("material_delivery_details_load_count_check", sql`${table.plannedLoadCount} > 0`),
    check(
      "material_delivery_details_planned_volume_check",
      sql`${table.plannedVolumeCubicYards} is null or ${table.plannedVolumeCubicYards} > 0`,
    ),
    check(
      "material_delivery_details_planned_weight_check",
      sql`${table.plannedWeightPounds} is null or ${table.plannedWeightPounds} > 0`,
    ),
    check(
      "material_delivery_details_actual_volume_check",
      sql`${table.actualDeliveredVolumeCubicYards} is null or ${table.actualDeliveredVolumeCubicYards} >= 0`,
    ),
    check(
      "material_delivery_details_actual_weight_check",
      sql`${table.actualDeliveredWeightPounds} is null or ${table.actualDeliveredWeightPounds} >= 0`,
    ),
    check(
      "material_delivery_details_capacity_check",
      sql`${table.capacityStatus} in ('evaluation_required', 'pass', 'fail')`,
    ),
    check(
      "material_delivery_details_compatibility_check",
      sql`${table.compatibilityStatus} in ('evaluation_required', 'pass', 'fail', 'not_required')`,
    ),
    check(
      "material_delivery_details_receipt_check",
      sql`${table.receiptStatus} in ('missing', 'partial', 'complete', 'waived')`,
    ),
    check(
      "material_delivery_details_evidence_check",
      sql`${table.placementEvidenceStatus} in ('not_required', 'missing', 'partial', 'complete', 'waived')`,
    ),
    check(
      "material_delivery_details_invoice_readiness_check",
      sql`${table.invoiceReadiness} in ('evaluation_required', 'ready', 'not_ready')`,
    ),
    index("material_delivery_details_tenant_readiness_idx").on(
      table.tenantId,
      table.invoiceReadiness,
      table.status,
    ),
  ],
);

export const materialLoads = pgTable(
  "material_loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialDeliveryDetailId: uuid("material_delivery_detail_id").notNull(),
    sequence: integer("sequence").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("planned"),
    plannedVolumeCubicYards: numeric("planned_volume_cubic_yards", {
      precision: 14,
      scale: 3,
    }),
    plannedWeightPounds: numeric("planned_weight_pounds", { precision: 14, scale: 3 }),
    actualVolumeCubicYards: numeric("actual_volume_cubic_yards", { precision: 14, scale: 3 }),
    actualWeightPounds: numeric("actual_weight_pounds", { precision: 14, scale: 3 }),
    capacityResult: varchar("capacity_result", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    compatibilityResult: varchar("compatibility_result", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    separationResult: varchar("separation_result", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    loadingStartedAt: timestamp("loading_started_at", { withTimezone: true }),
    loadedAt: timestamp("loaded_at", { withTimezone: true }),
    transitStartedAt: timestamp("transit_started_at", { withTimezone: true }),
    unloadingStartedAt: timestamp("unloading_started_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("material_loads_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("material_loads_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    unique("material_loads_tenant_detail_sequence_unique").on(
      table.tenantId,
      table.materialDeliveryDetailId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_loads_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialDeliveryDetailId, table.jobId],
      foreignColumns: [
        materialDeliveryDetails.tenantId,
        materialDeliveryDetails.id,
        materialDeliveryDetails.jobId,
      ],
      name: "material_loads_tenant_detail_job_fk",
    }).onDelete("restrict"),
    check("material_loads_sequence_check", sql`${table.sequence} > 0`),
    check(
      "material_loads_status_check",
      sql`${table.status} in ('planned', 'ready_for_loading', 'at_supplier', 'loading', 'loaded', 'en_route', 'at_customer', 'unloading', 'partially_delivered', 'delivered', 'reconciling', 'reconciled', 'rejected', 'cancelled')`,
    ),
    check(
      "material_loads_planned_volume_check",
      sql`${table.plannedVolumeCubicYards} is null or ${table.plannedVolumeCubicYards} >= 0`,
    ),
    check(
      "material_loads_planned_weight_check",
      sql`${table.plannedWeightPounds} is null or ${table.plannedWeightPounds} >= 0`,
    ),
    check(
      "material_loads_actual_volume_check",
      sql`${table.actualVolumeCubicYards} is null or ${table.actualVolumeCubicYards} >= 0`,
    ),
    check(
      "material_loads_actual_weight_check",
      sql`${table.actualWeightPounds} is null or ${table.actualWeightPounds} >= 0`,
    ),
    check(
      "material_loads_capacity_check",
      sql`${table.capacityResult} in ('evaluation_required', 'pass', 'fail')`,
    ),
    check(
      "material_loads_compatibility_check",
      sql`${table.compatibilityResult} in ('evaluation_required', 'pass', 'fail', 'not_required')`,
    ),
    check(
      "material_loads_separation_check",
      sql`${table.separationResult} in ('evaluation_required', 'pass', 'fail', 'not_required')`,
    ),
    check(
      "material_loads_loading_time_check",
      sql`${table.loadedAt} is null or ${table.loadingStartedAt} is null or ${table.loadedAt} >= ${table.loadingStartedAt}`,
    ),
    check(
      "material_loads_transit_time_check",
      sql`${table.transitStartedAt} is null or ${table.loadedAt} is null or ${table.transitStartedAt} >= ${table.loadedAt}`,
    ),
    check(
      "material_loads_unloading_time_check",
      sql`${table.unloadingStartedAt} is null or ${table.transitStartedAt} is null or ${table.unloadingStartedAt} >= ${table.transitStartedAt}`,
    ),
    check(
      "material_loads_delivery_time_check",
      sql`${table.deliveredAt} is null or ${table.unloadingStartedAt} is null or ${table.deliveredAt} >= ${table.unloadingStartedAt}`,
    ),
    check(
      "material_loads_reconcile_time_check",
      sql`${table.reconciledAt} is null or ${table.deliveredAt} is null or ${table.reconciledAt} >= ${table.deliveredAt}`,
    ),
    index("material_loads_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
  ],
);

export const materialLoadAssets = pgTable(
  "material_load_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialLoadId: uuid("material_load_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    role: varchar("role", { length: 30 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("planned"),
    capacitySnapshot: jsonb("capacity_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...auditColumns,
  },
  (table) => [
    unique("material_load_assets_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("material_load_assets_tenant_load_asset_unique").on(
      table.tenantId,
      table.materialLoadId,
      table.assetId,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_load_assets_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadId, table.jobId],
      foreignColumns: [materialLoads.tenantId, materialLoads.id, materialLoads.jobId],
      name: "material_load_assets_tenant_load_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.assetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "material_load_assets_tenant_asset_fk",
    }).onDelete("restrict"),
    check(
      "material_load_assets_role_check",
      sql`${table.role} in ('truck', 'trailer', 'equipment')`,
    ),
    check(
      "material_load_assets_status_check",
      sql`${table.status} in ('planned', 'active', 'used', 'released', 'cancelled')`,
    ),
    uniqueIndex("material_load_assets_one_current_role_idx")
      .on(table.tenantId, table.materialLoadId, table.role)
      .where(
        sql`${table.role} in ('truck', 'trailer') and ${table.status} in ('planned', 'active', 'used')`,
      ),
    index("material_load_assets_tenant_asset_status_idx").on(
      table.tenantId,
      table.assetId,
      table.status,
    ),
  ],
);

export const materialLoadItems = pgTable(
  "material_load_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialLoadId: uuid("material_load_id").notNull(),
    acceptedQuoteLineItemId: uuid("accepted_quote_line_item_id"),
    materialId: uuid("material_id").notNull(),
    actualMaterialId: uuid("actual_material_id"),
    plannedSupplierMaterialId: uuid("planned_supplier_material_id"),
    actualSupplierMaterialId: uuid("actual_supplier_material_id"),
    supplierRouteStopId: uuid("supplier_route_stop_id"),
    placementRouteStopId: uuid("placement_route_stop_id"),
    sequence: integer("sequence").notNull(),
    loadingSequence: integer("loading_sequence").notNull(),
    unloadingSequence: integer("unloading_sequence").notNull(),
    quantityUnit: varchar("quantity_unit", { length: 30 }).notNull(),
    plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 3 }).notNull(),
    purchasedQuantity: numeric("purchased_quantity", { precision: 12, scale: 3 }),
    loadedQuantity: numeric("loaded_quantity", { precision: 12, scale: 3 }),
    deliveredQuantity: numeric("delivered_quantity", { precision: 12, scale: 3 }),
    remainingQuantity: numeric("remaining_quantity", { precision: 12, scale: 3 }),
    unitWeightPounds: numeric("unit_weight_pounds", { precision: 14, scale: 3 }),
    unitVolumeCubicYards: numeric("unit_volume_cubic_yards", { precision: 14, scale: 3 }),
    plannedUnitCostCents: bigint("planned_unit_cost_cents", { mode: "number" }),
    actualUnitCostCents: bigint("actual_unit_cost_cents", { mode: "number" }),
    compartment: varchar("compartment", { length: 100 }),
    separationInstructions: text("separation_instructions"),
    deliveryResult: varchar("delivery_result", { length: 30 }).notNull().default("pending"),
    remainingDisposition: varchar("remaining_disposition", { length: 40 }),
    substitutionStatus: varchar("substitution_status", { length: 30 })
      .notNull()
      .default("not_required"),
    varianceStatus: varchar("variance_status", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("material_load_items_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("material_load_items_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    unique("material_load_items_tenant_load_sequence_unique").on(
      table.tenantId,
      table.materialLoadId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_load_items_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadId, table.jobId],
      foreignColumns: [materialLoads.tenantId, materialLoads.id, materialLoads.jobId],
      name: "material_load_items_tenant_load_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.acceptedQuoteLineItemId],
      foreignColumns: [quoteLineItems.tenantId, quoteLineItems.id],
      name: "material_load_items_tenant_quote_line_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialId],
      foreignColumns: [materials.tenantId, materials.id],
      name: "material_load_items_tenant_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actualMaterialId],
      foreignColumns: [materials.tenantId, materials.id],
      name: "material_load_items_tenant_actual_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.plannedSupplierMaterialId],
      foreignColumns: [supplierMaterials.tenantId, supplierMaterials.id],
      name: "material_load_items_tenant_planned_supplier_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actualSupplierMaterialId],
      foreignColumns: [supplierMaterials.tenantId, supplierMaterials.id],
      name: "material_load_items_tenant_actual_supplier_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId, table.supplierRouteStopId],
      foreignColumns: [routeStops.tenantId, routeStops.jobId, routeStops.id],
      name: "material_load_items_tenant_supplier_stop_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId, table.placementRouteStopId],
      foreignColumns: [routeStops.tenantId, routeStops.jobId, routeStops.id],
      name: "material_load_items_tenant_placement_stop_fk",
    }).onDelete("restrict"),
    check("material_load_items_sequence_check", sql`${table.sequence} > 0`),
    check("material_load_items_loading_sequence_check", sql`${table.loadingSequence} > 0`),
    check("material_load_items_unloading_sequence_check", sql`${table.unloadingSequence} > 0`),
    check(
      "material_load_items_unit_check",
      sql`${table.quantityUnit} in ('tons', 'cubic_yards', 'loads')`,
    ),
    check("material_load_items_planned_quantity_check", sql`${table.plannedQuantity} > 0`),
    check(
      "material_load_items_purchased_quantity_check",
      sql`${table.purchasedQuantity} is null or ${table.purchasedQuantity} >= 0`,
    ),
    check(
      "material_load_items_loaded_quantity_check",
      sql`${table.loadedQuantity} is null or ${table.loadedQuantity} >= 0`,
    ),
    check(
      "material_load_items_delivered_quantity_check",
      sql`${table.deliveredQuantity} is null or ${table.deliveredQuantity} >= 0`,
    ),
    check(
      "material_load_items_remaining_quantity_check",
      sql`${table.remainingQuantity} is null or ${table.remainingQuantity} >= 0`,
    ),
    check(
      "material_load_items_weight_conversion_check",
      sql`${table.unitWeightPounds} is null or ${table.unitWeightPounds} > 0`,
    ),
    check(
      "material_load_items_volume_conversion_check",
      sql`${table.unitVolumeCubicYards} is null or ${table.unitVolumeCubicYards} > 0`,
    ),
    check(
      "material_load_items_planned_cost_check",
      sql`${table.plannedUnitCostCents} is null or ${table.plannedUnitCostCents} >= 0`,
    ),
    check(
      "material_load_items_actual_cost_check",
      sql`${table.actualUnitCostCents} is null or ${table.actualUnitCostCents} >= 0`,
    ),
    check(
      "material_load_items_delivery_result_check",
      sql`${table.deliveryResult} in ('pending', 'delivered', 'partially_delivered', 'not_delivered', 'returned', 'cancelled')`,
    ),
    check(
      "material_load_items_remaining_disposition_check",
      sql`${table.remainingDisposition} is null or ${table.remainingDisposition} in ('none', 'returned_to_supplier', 'retained_by_business', 'left_with_customer', 'disposed', 'follow_up_job', 'other')`,
    ),
    check(
      "material_load_items_substitution_check",
      sql`${table.substitutionStatus} in ('not_required', 'pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "material_load_items_variance_check",
      sql`${table.varianceStatus} in ('evaluation_required', 'none', 'open', 'resolved', 'waived')`,
    ),
    index("material_load_items_tenant_job_result_idx").on(
      table.tenantId,
      table.jobId,
      table.deliveryResult,
    ),
    index("material_load_items_tenant_supplier_idx").on(
      table.tenantId,
      table.actualSupplierMaterialId,
    ),
  ],
);

export const materialLoadValidations = pgTable(
  "material_load_validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialLoadId: uuid("material_load_id").notNull(),
    validationType: varchar("validation_type", { length: 30 }).notNull(),
    result: varchar("result", { length: 30 }).notNull(),
    capacityResult: varchar("capacity_result", { length: 30 }).notNull(),
    compatibilityResult: varchar("compatibility_result", { length: 30 }).notNull(),
    separationResult: varchar("separation_result", { length: 30 }).notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    supersedesValidationId: uuid("supersedes_validation_id"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    evaluatedBy: uuid("evaluated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("material_load_validations_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("material_load_validations_tenant_load_type_hash_unique").on(
      table.tenantId,
      table.materialLoadId,
      table.validationType,
      table.inputHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_load_validations_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadId, table.jobId],
      foreignColumns: [materialLoads.tenantId, materialLoads.id, materialLoads.jobId],
      name: "material_load_validations_tenant_load_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supersedesValidationId],
      foreignColumns: [table.tenantId, table.id],
      name: "material_load_validations_tenant_previous_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evaluatedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "material_load_validations_tenant_evaluator_fk",
    }).onDelete("restrict"),
    check(
      "material_load_validations_type_check",
      sql`${table.validationType} in ('planning', 'dispatch', 'actual')`,
    ),
    check(
      "material_load_validations_result_check",
      sql`${table.result} in ('ready', 'ready_with_warnings', 'not_ready')`,
    ),
    check(
      "material_load_validations_capacity_check",
      sql`${table.capacityResult} in ('pass', 'fail')`,
    ),
    check(
      "material_load_validations_compatibility_check",
      sql`${table.compatibilityResult} in ('pass', 'fail', 'not_required')`,
    ),
    check(
      "material_load_validations_separation_check",
      sql`${table.separationResult} in ('pass', 'fail', 'not_required')`,
    ),
    check(
      "material_load_validations_failed_safety_check",
      sql`(${table.capacityResult} <> 'fail' and ${table.compatibilityResult} <> 'fail' and ${table.separationResult} <> 'fail') or ${table.result} = 'not_ready'`,
    ),
    check(
      "material_load_validations_ready_safety_check",
      sql`${table.result} = 'not_ready' or (${table.capacityResult} = 'pass' and ${table.compatibilityResult} in ('pass', 'not_required') and ${table.separationResult} in ('pass', 'not_required'))`,
    ),
    index("material_load_validations_tenant_load_latest_idx").on(
      table.tenantId,
      table.materialLoadId,
      table.validationType,
      table.evaluatedAt,
    ),
  ],
);

export const materialSubstitutions = pgTable(
  "material_substitutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialLoadItemId: uuid("material_load_item_id").notNull(),
    originalMaterialId: uuid("original_material_id").notNull(),
    replacementMaterialId: uuid("replacement_material_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("requested"),
    reason: text("reason").notNull(),
    internalApprovalRequired: boolean("internal_approval_required").notNull().default(true),
    customerApprovalRequired: boolean("customer_approval_required").notNull().default(false),
    quoteRevisionRequired: boolean("quote_revision_required").notNull().default(false),
    capacityRevalidationRequired: boolean("capacity_revalidation_required").notNull().default(true),
    compatibilityRevalidationRequired: boolean("compatibility_revalidation_required")
      .notNull()
      .default(true),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedBy: uuid("requested_by").notNull(),
    customerAuthorizedAt: timestamp("customer_authorized_at", { withTimezone: true }),
    customerAuthorizationReference: varchar("customer_authorization_reference", { length: 240 }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    ...auditColumns,
  },
  (table) => [
    unique("material_substitutions_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_substitutions_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadItemId, table.jobId],
      foreignColumns: [materialLoadItems.tenantId, materialLoadItems.id, materialLoadItems.jobId],
      name: "material_substitutions_tenant_item_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.originalMaterialId],
      foreignColumns: [materials.tenantId, materials.id],
      name: "material_substitutions_tenant_original_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.replacementMaterialId],
      foreignColumns: [materials.tenantId, materials.id],
      name: "material_substitutions_tenant_replacement_material_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "material_substitutions_tenant_requester_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.decidedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "material_substitutions_tenant_decider_fk",
    }).onDelete("restrict"),
    check(
      "material_substitutions_material_check",
      sql`${table.originalMaterialId} <> ${table.replacementMaterialId}`,
    ),
    check(
      "material_substitutions_status_check",
      sql`${table.status} in ('requested', 'pending_internal', 'pending_customer', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "material_substitutions_decision_check",
      sql`${table.status} not in ('approved', 'rejected') or (${table.decidedAt} is not null and ${table.decidedBy} is not null)`,
    ),
    check(
      "material_substitutions_customer_approval_check",
      sql`${table.status} <> 'approved' or not ${table.customerApprovalRequired} or (${table.customerAuthorizedAt} is not null and ${table.customerAuthorizationReference} is not null)`,
    ),
    uniqueIndex("material_substitutions_one_pending_idx")
      .on(table.tenantId, table.materialLoadItemId)
      .where(sql`${table.status} in ('requested', 'pending_internal', 'pending_customer')`),
    index("material_substitutions_tenant_job_status_idx").on(
      table.tenantId,
      table.jobId,
      table.status,
    ),
  ],
);

export const materialQuantityVariances = pgTable(
  "material_quantity_variances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    materialLoadItemId: uuid("material_load_item_id").notNull(),
    varianceType: varchar("variance_type", { length: 30 }).notNull(),
    quantityUnit: varchar("quantity_unit", { length: 30 }).notNull(),
    expectedQuantity: numeric("expected_quantity", { precision: 12, scale: 3 }).notNull(),
    actualQuantity: numeric("actual_quantity", { precision: 12, scale: 3 }).notNull(),
    varianceQuantity: numeric("variance_quantity", { precision: 12, scale: 3 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("open"),
    responsibility: varchar("responsibility", { length: 40 }).notNull().default("unknown"),
    resolutionType: varchar("resolution_type", { length: 40 }),
    resolutionReason: text("resolution_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
    ...auditColumns,
  },
  (table) => [
    unique("material_quantity_variances_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "material_quantity_variances_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadItemId, table.jobId],
      foreignColumns: [materialLoadItems.tenantId, materialLoadItems.id, materialLoadItems.jobId],
      name: "material_quantity_variances_tenant_item_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.resolvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "material_quantity_variances_tenant_resolver_fk",
    }).onDelete("restrict"),
    check(
      "material_quantity_variances_type_check",
      sql`${table.varianceType} in ('purchase', 'loading', 'delivery', 'remaining')`,
    ),
    check(
      "material_quantity_variances_unit_check",
      sql`${table.quantityUnit} in ('tons', 'cubic_yards', 'loads')`,
    ),
    check(
      "material_quantity_variances_quantity_check",
      sql`${table.expectedQuantity} >= 0 and ${table.actualQuantity} >= 0 and ${table.varianceQuantity} = ${table.actualQuantity} - ${table.expectedQuantity}`,
    ),
    check(
      "material_quantity_variances_status_check",
      sql`${table.status} in ('open', 'resolved', 'waived')`,
    ),
    check(
      "material_quantity_variances_responsibility_check",
      sql`${table.responsibility} in ('customer', 'business', 'shared', 'supplier', 'vendor', 'insurance', 'unknown', 'disputed', 'not_applicable')`,
    ),
    check(
      "material_quantity_variances_resolution_type_check",
      sql`${table.resolutionType} is null or ${table.resolutionType} in ('charge', 'credit', 'no_charge', 'follow_up_job', 'supplier_adjustment', 'customer_acceptance', 'other')`,
    ),
    check(
      "material_quantity_variances_resolution_check",
      sql`${table.status} = 'open' or (${table.resolutionType} is not null and ${table.resolutionReason} is not null and ${table.resolvedAt} is not null and ${table.resolvedBy} is not null)`,
    ),
    uniqueIndex("material_quantity_variances_one_open_idx")
      .on(table.tenantId, table.materialLoadItemId, table.varianceType)
      .where(sql`${table.status} = 'open'`),
    index("material_quantity_variances_tenant_job_status_idx").on(
      table.tenantId,
      table.jobId,
      table.status,
    ),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    expenseNumber: varchar("expense_number", { length: 40 }).notNull(),
    expenseKind: varchar("expense_kind", { length: 30 }).notNull().default("expense"),
    expenseType: varchar("expense_type", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    supplierId: uuid("supplier_id"),
    supplierLocationId: uuid("supplier_location_id"),
    receiptDocumentId: uuid("receipt_document_id"),
    receiptStatus: varchar("receipt_status", { length: 30 }).notNull().default("missing"),
    receiptWaiverReason: text("receipt_waiver_reason"),
    receiptWaivedAt: timestamp("receipt_waived_at", { withTimezone: true }),
    receiptWaivedBy: uuid("receipt_waived_by"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    externalReference: varchar("external_reference", { length: 160 }),
    incurredAt: timestamp("incurred_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    reversesExpenseId: uuid("reverses_expense_id"),
    ...auditColumns,
  },
  (table) => [
    unique("expenses_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("expenses_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    unique("expenses_tenant_number_unique").on(table.tenantId, table.expenseNumber),
    unique("expenses_tenant_reversal_unique").on(table.tenantId, table.reversesExpenseId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "expenses_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: "expenses_tenant_supplier_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supplierId, table.supplierLocationId],
      foreignColumns: [
        supplierLocations.tenantId,
        supplierLocations.supplierId,
        supplierLocations.id,
      ],
      name: "expenses_tenant_supplier_location_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.receiptDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "expenses_tenant_receipt_document_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.receiptWaivedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "expenses_tenant_receipt_waiver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "expenses_tenant_approver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesExpenseId],
      foreignColumns: [table.tenantId, table.id],
      name: "expenses_tenant_reversal_fk",
    }).onDelete("restrict"),
    check("expenses_kind_check", sql`${table.expenseKind} in ('expense', 'reversal')`),
    check(
      "expenses_type_check",
      sql`${table.expenseType} in ('material_purchase', 'supplier_fee', 'delivery', 'disposal', 'other')`,
    ),
    check(
      "expenses_status_check",
      sql`${table.status} in ('draft', 'evidence_required', 'pending_review', 'approved', 'reconciled', 'reversed', 'cancelled')`,
    ),
    check(
      "expenses_supplier_location_check",
      sql`${table.supplierLocationId} is null or ${table.supplierId} is not null`,
    ),
    check(
      "expenses_receipt_status_check",
      sql`${table.receiptStatus} in ('missing', 'attached', 'waived', 'not_required')`,
    ),
    check(
      "expenses_receipt_evidence_check",
      sql`(${table.receiptStatus} <> 'attached' or ${table.receiptDocumentId} is not null) and (${table.receiptStatus} <> 'waived' or (${table.receiptWaiverReason} is not null and ${table.receiptWaivedAt} is not null and ${table.receiptWaivedBy} is not null))`,
    ),
    check("expenses_amount_check", sql`${table.amountCents} > 0`),
    check(
      "expenses_approval_check",
      sql`${table.status} not in ('approved', 'reconciled') or (${table.approvedAt} is not null and ${table.approvedBy} is not null and ${table.receiptStatus} in ('attached', 'waived', 'not_required'))`,
    ),
    check(
      "expenses_reversal_check",
      sql`(${table.expenseKind} = 'expense' and ${table.reversesExpenseId} is null) or (${table.expenseKind} = 'reversal' and ${table.reversesExpenseId} is not null and ${table.receiptStatus} = 'not_required')`,
    ),
    index("expenses_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
    index("expenses_tenant_supplier_incurred_idx").on(
      table.tenantId,
      table.supplierId,
      table.incurredAt,
    ),
  ],
);

export const expenseAllocations = pgTable(
  "expense_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    expenseId: uuid("expense_id").notNull(),
    materialLoadItemId: uuid("material_load_item_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reversalReason: text("reversal_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("expense_allocations_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "expense_allocations_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.expenseId, table.jobId],
      foreignColumns: [expenses.tenantId, expenses.id, expenses.jobId],
      name: "expense_allocations_tenant_expense_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.materialLoadItemId, table.jobId],
      foreignColumns: [materialLoadItems.tenantId, materialLoadItems.id, materialLoadItems.jobId],
      name: "expense_allocations_tenant_item_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "expense_allocations_tenant_reverser_fk",
    }).onDelete("restrict"),
    check("expense_allocations_amount_check", sql`${table.amountCents} > 0`),
    check("expense_allocations_status_check", sql`${table.status} in ('active', 'reversed')`),
    check(
      "expense_allocations_reversal_check",
      sql`${table.status} = 'active' or (${table.reversedAt} is not null and ${table.reversedBy} is not null and ${table.reversalReason} is not null)`,
    ),
    uniqueIndex("expense_allocations_one_active_item_idx")
      .on(table.tenantId, table.expenseId, table.materialLoadItemId)
      .where(sql`${table.status} = 'active'`),
    index("expense_allocations_tenant_expense_status_idx").on(
      table.tenantId,
      table.expenseId,
      table.status,
    ),
  ],
);

export const jobCharges = pgTable(
  "job_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    chargeNumber: varchar("charge_number", { length: 40 }).notNull(),
    chargeKind: varchar("charge_kind", { length: 30 }).notNull().default("charge"),
    chargeType: varchar("charge_type", { length: 60 }).notNull(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    sourceId: uuid("source_id"),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    responsibility: varchar("responsibility", { length: 40 }).notNull().default("unknown"),
    evidenceStatus: varchar("evidence_status", { length: 30 }).notNull().default("required"),
    customerAuthorizationStatus: varchar("customer_authorization_status", { length: 30 })
      .notNull()
      .default("not_required"),
    internalApprovalStatus: varchar("internal_approval_status", { length: 30 })
      .notNull()
      .default("required"),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    unit: varchar("unit", { length: 40 }),
    rateCents: bigint("rate_cents", { mode: "number" }),
    calculatedAmountCents: bigint("calculated_amount_cents", { mode: "number" }),
    proposedAmountCents: bigint("proposed_amount_cents", { mode: "number" }),
    approvedAmountCents: bigint("approved_amount_cents", { mode: "number" }),
    invoicedAmountCents: bigint("invoiced_amount_cents", { mode: "number" }).notNull().default(0),
    creditedAmountCents: bigint("credited_amount_cents", { mode: "number" }).notNull().default(0),
    calculationSnapshot: jsonb("calculation_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    customerDescription: varchar("customer_description", { length: 300 }).notNull(),
    taxBehavior: varchar("tax_behavior", { length: 30 }).notNull().default("undetermined"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    reversesJobChargeId: uuid("reverses_job_charge_id"),
    ...auditColumns,
  },
  (table) => [
    unique("job_charges_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("job_charges_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    unique("job_charges_tenant_number_unique").on(table.tenantId, table.chargeNumber),
    unique("job_charges_tenant_reversal_unique").on(table.tenantId, table.reversesJobChargeId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "job_charges_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "job_charges_tenant_approver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesJobChargeId],
      foreignColumns: [table.tenantId, table.id],
      name: "job_charges_tenant_reversal_fk",
    }).onDelete("restrict"),
    check(
      "job_charges_kind_check",
      sql`${table.chargeKind} in ('charge', 'credit', 'no_charge', 'informational', 'reversal')`,
    ),
    check(
      "job_charges_source_type_check",
      sql`${table.sourceType} in ('material_delivery_detail', 'material_load', 'material_load_item', 'material_substitution', 'quantity_variance', 'dump_trailer_rental_detail', 'rental_extension', 'rental_pickup_attempt', 'disposal_load', 'rental_inspection', 'route_stop', 'manual')`,
    ),
    check(
      "job_charges_source_check",
      sql`${table.sourceType} = 'manual' or ${table.sourceId} is not null`,
    ),
    check(
      "job_charges_status_check",
      sql`${table.status} in ('draft', 'calculating', 'evidence_required', 'responsibility_review', 'awaiting_customer_authorization', 'awaiting_internal_approval', 'approved', 'partially_approved', 'rejected', 'waived', 'disputed', 'ready_to_invoice', 'invoiced', 'partially_invoiced', 'credited', 'reversed', 'resolved', 'cancelled')`,
    ),
    check(
      "job_charges_responsibility_check",
      sql`${table.responsibility} in ('customer', 'business', 'shared', 'supplier', 'vendor', 'insurance', 'unknown', 'disputed', 'not_applicable')`,
    ),
    check(
      "job_charges_evidence_check",
      sql`${table.evidenceStatus} in ('required', 'complete', 'waived', 'not_required')`,
    ),
    check(
      "job_charges_customer_authorization_check",
      sql`${table.customerAuthorizationStatus} in ('not_required', 'required', 'pending', 'authorized', 'declined', 'waived')`,
    ),
    check(
      "job_charges_internal_approval_check",
      sql`${table.internalApprovalStatus} in ('not_required', 'required', 'pending', 'approved', 'rejected', 'waived')`,
    ),
    check("job_charges_quantity_check", sql`${table.quantity} is null or ${table.quantity} >= 0`),
    check("job_charges_rate_check", sql`${table.rateCents} is null or ${table.rateCents} >= 0`),
    check(
      "job_charges_amounts_check",
      sql`(${table.calculatedAmountCents} is null or ${table.calculatedAmountCents} >= 0) and (${table.proposedAmountCents} is null or ${table.proposedAmountCents} >= 0) and (${table.approvedAmountCents} is null or ${table.approvedAmountCents} >= 0) and ${table.invoicedAmountCents} >= 0 and ${table.creditedAmountCents} >= 0`,
    ),
    check(
      "job_charges_tax_behavior_check",
      sql`${table.taxBehavior} in ('taxable', 'non_taxable', 'tax_included', 'undetermined')`,
    ),
    check(
      "job_charges_approval_check",
      sql`${table.status} not in ('approved', 'partially_approved', 'ready_to_invoice', 'invoiced', 'partially_invoiced', 'credited', 'resolved') or (${table.approvedAmountCents} is not null and ${table.approvedAt} is not null and ${table.approvedBy} is not null)`,
    ),
    check(
      "job_charges_reversal_check",
      sql`(${table.chargeKind} <> 'reversal' and ${table.reversesJobChargeId} is null) or (${table.chargeKind} = 'reversal' and ${table.reversesJobChargeId} is not null)`,
    ),
    uniqueIndex("job_charges_one_active_dedupe_idx")
      .on(table.tenantId, table.jobId, table.dedupeKey)
      .where(sql`${table.status} not in ('reversed', 'cancelled')`),
    index("job_charges_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
  ],
);

export const dumpTrailerRentalDetails = pgTable(
  "dump_trailer_rental_details",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    acceptedQuoteVersionId: uuid("accepted_quote_version_id").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("planning"),
    rateType: varchar("rate_type", { length: 30 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    acceptedTermsHash: varchar("accepted_terms_hash", { length: 64 }).notNull(),
    acceptedTermsSnapshot: jsonb("accepted_terms_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    includedDays: integer("included_days").notNull(),
    additionalDayRateCents: bigint("additional_day_rate_cents", { mode: "number" }).notNull(),
    includedWeightPounds: numeric("included_weight_pounds", { precision: 14, scale: 3 }).notNull(),
    overageRateCentsPerPound: bigint("overage_rate_cents_per_pound", {
      mode: "number",
    }).notNull(),
    depositAmountCents: bigint("deposit_amount_cents", { mode: "number" }).notNull().default(0),
    depositClassification: varchar("deposit_classification", { length: 40 })
      .notNull()
      .default("none"),
    plannedDropoffAt: timestamp("planned_dropoff_at", { withTimezone: true }).notNull(),
    plannedPickupAt: timestamp("planned_pickup_at", { withTimezone: true }).notNull(),
    trailerAssetId: uuid("trailer_asset_id"),
    trailerSnapshot: jsonb("trailer_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    debrisReviewStatus: varchar("debris_review_status", { length: 30 })
      .notNull()
      .default("pending"),
    accessReviewStatus: varchar("access_review_status", { length: 30 })
      .notNull()
      .default("pending"),
    emptyTrailerStatus: varchar("empty_trailer_status", { length: 30 })
      .notNull()
      .default("unknown"),
    finalCondition: varchar("final_condition", { length: 40 })
      .notNull()
      .default("pending_inspection"),
    invoiceReadiness: varchar("invoice_readiness", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    actualDropoffAt: timestamp("actual_dropoff_at", { withTimezone: true }),
    onRentAt: timestamp("on_rent_at", { withTimezone: true }),
    customerCustodyEndedAt: timestamp("customer_custody_ended_at", { withTimezone: true }),
    actualPickupAt: timestamp("actual_pickup_at", { withTimezone: true }),
    occupancyReleasedAt: timestamp("occupancy_released_at", { withTimezone: true }),
    totalActualWeightPounds: numeric("total_actual_weight_pounds", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    overageWeightPounds: numeric("overage_weight_pounds", { precision: 14, scale: 3 })
      .notNull()
      .default("0"),
    operationallyCompletedAt: timestamp("operationally_completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("rental_details_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("rental_details_tenant_job_unique").on(table.tenantId, table.jobId),
    unique("rental_details_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    foreignKey({
      columns: [table.tenantId, table.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
      name: "rental_details_tenant_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.acceptedQuoteVersionId],
      foreignColumns: [quoteVersions.tenantId, quoteVersions.id],
      name: "rental_details_tenant_quote_version_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.trailerAssetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "rental_details_tenant_trailer_fk",
    }).onDelete("restrict"),
    check(
      "rental_details_status_check",
      sql`${table.status} in ('planning', 'scheduled_dropoff', 'dropoff_preparing', 'en_route_dropoff', 'at_customer_dropoff', 'delivered', 'on_rent', 'pickup_scheduled', 'pickup_preparing', 'en_route_pickup', 'at_customer_pickup', 'picked_up', 'awaiting_disposal', 'at_facility', 'unloading', 'inspection_required', 'returned', 'operationally_complete', 'on_hold', 'cancelled')`,
    ),
    check(
      "rental_details_rate_type_check",
      sql`${table.rateType} in ('daily', 'weekend', 'weekly', 'custom')`,
    ),
    check("rental_details_currency_check", sql`length(${table.currency}) = 3`),
    check("rental_details_terms_hash_check", sql`length(${table.acceptedTermsHash}) = 64`),
    check("rental_details_included_days_check", sql`${table.includedDays} > 0`),
    check("rental_details_additional_rate_check", sql`${table.additionalDayRateCents} >= 0`),
    check("rental_details_included_weight_check", sql`${table.includedWeightPounds} >= 0`),
    check("rental_details_overage_rate_check", sql`${table.overageRateCentsPerPound} >= 0`),
    check("rental_details_deposit_check", sql`${table.depositAmountCents} >= 0`),
    check(
      "rental_details_deposit_classification_check",
      sql`${table.depositClassification} in ('none', 'advance_payment', 'refundable_security')`,
    ),
    check(
      "rental_details_planned_range_check",
      sql`${table.plannedPickupAt} > ${table.plannedDropoffAt}`,
    ),
    check(
      "rental_details_debris_status_check",
      sql`${table.debrisReviewStatus} in ('pending', 'approved', 'hold', 'rejected')`,
    ),
    check(
      "rental_details_access_status_check",
      sql`${table.accessReviewStatus} in ('pending', 'pass', 'fail')`,
    ),
    check(
      "rental_details_empty_status_check",
      sql`${table.emptyTrailerStatus} in ('unknown', 'confirmed_empty', 'not_empty')`,
    ),
    check(
      "rental_details_condition_check",
      sql`${table.finalCondition} in ('pending_inspection', 'acceptable', 'acceptable_after_cleaning', 'maintenance_review', 'damage_review', 'out_of_service', 'undetermined')`,
    ),
    check(
      "rental_details_invoice_readiness_check",
      sql`${table.invoiceReadiness} in ('evaluation_required', 'ready', 'not_ready')`,
    ),
    check(
      "rental_details_weight_check",
      sql`${table.totalActualWeightPounds} >= 0 and ${table.overageWeightPounds} >= 0`,
    ),
    check(
      "rental_details_custody_check",
      sql`${table.customerCustodyEndedAt} is null or (${table.onRentAt} is not null and ${table.customerCustodyEndedAt} >= ${table.onRentAt})`,
    ),
    check(
      "rental_details_release_check",
      sql`${table.occupancyReleasedAt} is null or (${table.customerCustodyEndedAt} is not null and ${table.occupancyReleasedAt} >= ${table.customerCustodyEndedAt})`,
    ),
    index("rental_details_tenant_status_idx").on(table.tenantId, table.status),
    index("rental_details_tenant_readiness_idx").on(
      table.tenantId,
      table.invoiceReadiness,
      table.status,
    ),
  ],
);

export const rentalDebrisReviews = pgTable(
  "rental_debris_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    rentalDetailId: uuid("rental_detail_id").notNull(),
    reviewNumber: integer("review_number").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    primaryDebrisType: varchar("primary_debris_type", { length: 100 }).notNull(),
    secondaryDebrisTypes: jsonb("secondary_debris_types").$type<string[]>().notNull().default([]),
    prohibitedMaterials: jsonb("prohibited_materials").$type<string[]>().notNull().default([]),
    restrictedMaterials: jsonb("restricted_materials").$type<string[]>().notNull().default([]),
    mixedDebris: boolean("mixed_debris").notNull().default(false),
    heavyMaterial: boolean("heavy_material").notNull().default(false),
    customerAttested: boolean("customer_attested").notNull().default(false),
    customerAttestedAt: timestamp("customer_attested_at", { withTimezone: true }),
    customerAttestation: text("customer_attestation"),
    accessStatus: varchar("access_status", { length: 30 }).notNull().default("pending"),
    legalTowingStatus: varchar("legal_towing_status", { length: 30 }).notNull().default("pending"),
    placementInstructions: text("placement_instructions"),
    pickupAccessRequirement: text("pickup_access_requirement"),
    propertyDamageRisk: text("property_damage_risk"),
    outcomeNotes: text("outcome_notes"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by"),
    ...auditColumns,
  },
  (table) => [
    unique("rental_debris_reviews_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("rental_debris_reviews_sequence_unique").on(
      table.tenantId,
      table.rentalDetailId,
      table.reviewNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.rentalDetailId, table.jobId],
      foreignColumns: [
        dumpTrailerRentalDetails.tenantId,
        dumpTrailerRentalDetails.id,
        dumpTrailerRentalDetails.jobId,
      ],
      name: "rental_debris_reviews_tenant_detail_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reviewedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "rental_debris_reviews_tenant_reviewer_fk",
    }).onDelete("restrict"),
    check("rental_debris_reviews_number_check", sql`${table.reviewNumber} > 0`),
    check(
      "rental_debris_reviews_status_check",
      sql`${table.status} in ('pending', 'approved', 'hold', 'rejected', 'superseded')`,
    ),
    check(
      "rental_debris_reviews_access_check",
      sql`${table.accessStatus} in ('pending', 'pass', 'fail') and ${table.legalTowingStatus} in ('pending', 'pass', 'fail')`,
    ),
    check(
      "rental_debris_reviews_attestation_check",
      sql`not ${table.customerAttested} or (${table.customerAttestedAt} is not null and ${table.customerAttestation} is not null)`,
    ),
    check(
      "rental_debris_reviews_decision_check",
      sql`${table.status} = 'pending' or (${table.reviewedAt} is not null and ${table.reviewedBy} is not null and ${table.outcomeNotes} is not null)`,
    ),
    check(
      "rental_debris_reviews_approval_check",
      sql`${table.status} <> 'approved' or (${table.customerAttested} and ${table.accessStatus} = 'pass' and ${table.legalTowingStatus} = 'pass' and jsonb_array_length(${table.prohibitedMaterials}) = 0)`,
    ),
    index("rental_debris_reviews_tenant_job_status_idx").on(
      table.tenantId,
      table.jobId,
      table.status,
    ),
  ],
);

export const rentalExtensions = pgTable(
  "rental_extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    rentalDetailId: uuid("rental_detail_id").notNull(),
    extensionNumber: integer("extension_number").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("requested"),
    previousPickupAt: timestamp("previous_pickup_at", { withTimezone: true }).notNull(),
    requestedPickupAt: timestamp("requested_pickup_at", { withTimezone: true }).notNull(),
    additionalDays: integer("additional_days").notNull(),
    rateCents: bigint("rate_cents", { mode: "number" }).notNull(),
    calculatedAmountCents: bigint("calculated_amount_cents", { mode: "number" }).notNull(),
    conflictStatus: varchar("conflict_status", { length: 30 })
      .notNull()
      .default("evaluation_required"),
    availabilitySnapshot: jsonb("availability_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    customerAuthorizationStatus: varchar("customer_authorization_status", { length: 30 })
      .notNull()
      .default("required"),
    pickupScheduleBlockId: uuid("pickup_schedule_block_id").notNull(),
    occupancyReservationId: uuid("occupancy_reservation_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    requestedBy: uuid("requested_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decisionReason: text("decision_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("rental_extensions_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("rental_extensions_sequence_unique").on(
      table.tenantId,
      table.rentalDetailId,
      table.extensionNumber,
    ),
    unique("rental_extensions_dedupe_unique").on(table.tenantId, table.jobId, table.dedupeKey),
    foreignKey({
      columns: [table.tenantId, table.rentalDetailId, table.jobId],
      foreignColumns: [
        dumpTrailerRentalDetails.tenantId,
        dumpTrailerRentalDetails.id,
        dumpTrailerRentalDetails.jobId,
      ],
      name: "rental_extensions_tenant_detail_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.pickupScheduleBlockId, table.jobId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id, scheduleBlocks.jobId],
      name: "rental_extensions_tenant_pickup_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.occupancyReservationId, table.jobId],
      foreignColumns: [assetReservations.tenantId, assetReservations.id, assetReservations.jobId],
      name: "rental_extensions_tenant_occupancy_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.requestedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "rental_extensions_tenant_requester_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.decidedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "rental_extensions_tenant_decider_fk",
    }).onDelete("restrict"),
    check("rental_extensions_number_check", sql`${table.extensionNumber} > 0`),
    check(
      "rental_extensions_status_check",
      sql`${table.status} in ('requested', 'availability_review', 'awaiting_customer_authorization', 'awaiting_internal_approval', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "rental_extensions_range_check",
      sql`${table.requestedPickupAt} > ${table.previousPickupAt}`,
    ),
    check("rental_extensions_days_check", sql`${table.additionalDays} > 0`),
    check(
      "rental_extensions_amount_check",
      sql`${table.rateCents} >= 0 and ${table.calculatedAmountCents} = ${table.additionalDays} * ${table.rateCents}`,
    ),
    check(
      "rental_extensions_conflict_check",
      sql`${table.conflictStatus} in ('evaluation_required', 'pass', 'fail')`,
    ),
    check(
      "rental_extensions_customer_auth_check",
      sql`${table.customerAuthorizationStatus} in ('not_required', 'required', 'pending', 'authorized', 'declined')`,
    ),
    check(
      "rental_extensions_decision_check",
      sql`${table.status} not in ('approved', 'rejected') or (${table.decidedAt} is not null and ${table.decidedBy} is not null and ${table.decisionReason} is not null)`,
    ),
    check(
      "rental_extensions_approval_check",
      sql`${table.status} <> 'approved' or (${table.conflictStatus} = 'pass' and ${table.customerAuthorizationStatus} in ('authorized', 'not_required') and ${table.availabilitySnapshot} <> '{}'::jsonb)`,
    ),
    index("rental_extensions_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
  ],
);

export const rentalPickupAttempts = pgTable(
  "rental_pickup_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    rentalDetailId: uuid("rental_detail_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    scheduleBlockId: uuid("schedule_block_id").notNull(),
    routeStopId: uuid("route_stop_id"),
    trailerAssetId: uuid("trailer_asset_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("planned"),
    accessStatus: varchar("access_status", { length: 30 }).notNull().default("pending"),
    safeLoadStatus: varchar("safe_load_status", { length: 30 }).notNull().default("pending"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    customerNotifiedAt: timestamp("customer_notified_at", { withTimezone: true }),
    customerCustodyEndedAt: timestamp("customer_custody_ended_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    outcomeNotes: text("outcome_notes"),
    attemptedBy: uuid("attempted_by").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("rental_pickup_attempts_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("rental_pickup_attempts_sequence_unique").on(
      table.tenantId,
      table.rentalDetailId,
      table.attemptNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.rentalDetailId, table.jobId],
      foreignColumns: [
        dumpTrailerRentalDetails.tenantId,
        dumpTrailerRentalDetails.id,
        dumpTrailerRentalDetails.jobId,
      ],
      name: "rental_pickup_attempts_tenant_detail_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.scheduleBlockId, table.jobId],
      foreignColumns: [scheduleBlocks.tenantId, scheduleBlocks.id, scheduleBlocks.jobId],
      name: "rental_pickup_attempts_tenant_block_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.routeStopId, table.jobId],
      foreignColumns: [routeStops.tenantId, routeStops.id, routeStops.jobId],
      name: "rental_pickup_attempts_tenant_stop_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.trailerAssetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "rental_pickup_attempts_tenant_trailer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.attemptedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "rental_pickup_attempts_tenant_driver_fk",
    }).onDelete("restrict"),
    check("rental_pickup_attempts_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "rental_pickup_attempts_status_check",
      sql`${table.status} in ('planned', 'en_route', 'arrived', 'retrieved', 'failed', 'cancelled')`,
    ),
    check(
      "rental_pickup_attempts_access_check",
      sql`${table.accessStatus} in ('pending', 'pass', 'fail') and ${table.safeLoadStatus} in ('pending', 'pass', 'fail')`,
    ),
    check(
      "rental_pickup_attempts_retrieved_check",
      sql`${table.status} <> 'retrieved' or (${table.accessStatus} = 'pass' and ${table.safeLoadStatus} = 'pass' and ${table.customerCustodyEndedAt} is not null and ${table.completedAt} is not null)`,
    ),
    check(
      "rental_pickup_attempts_failure_check",
      sql`${table.status} <> 'failed' or (${table.failureReason} is not null and ${table.attemptedAt} is not null and ${table.completedAt} is not null)`,
    ),
    index("rental_pickup_attempts_tenant_job_status_idx").on(
      table.tenantId,
      table.jobId,
      table.status,
    ),
  ],
);

export const disposalLoads = pgTable(
  "disposal_loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    rentalDetailId: uuid("rental_detail_id").notNull(),
    sequence: integer("sequence").notNull(),
    redirectedFromDisposalLoadId: uuid("redirected_from_disposal_load_id"),
    routeStopId: uuid("route_stop_id"),
    plannedFacilityLocationId: uuid("planned_facility_location_id"),
    actualFacilityLocationId: uuid("actual_facility_location_id"),
    status: varchar("status", { length: 40 }).notNull().default("planned"),
    debrisClassification: varchar("debris_classification", { length: 120 }).notNull(),
    acceptanceResult: varchar("acceptance_result", { length: 30 }).notNull().default("pending"),
    unloadingResult: varchar("unloading_result", { length: 30 }).notNull().default("pending"),
    weightStatus: varchar("weight_status", { length: 30 }).notNull().default("required"),
    sourceWeightUnit: varchar("source_weight_unit", { length: 20 }).notNull().default("pounds"),
    grossWeight: numeric("gross_weight", { precision: 14, scale: 3 }),
    tareWeight: numeric("tare_weight", { precision: 14, scale: 3 }),
    netWeight: numeric("net_weight", { precision: 14, scale: 3 }),
    canonicalNetWeightPounds: numeric("canonical_net_weight_pounds", {
      precision: 14,
      scale: 3,
    }),
    weightExceptionReason: text("weight_exception_reason"),
    ticketStatus: varchar("ticket_status", { length: 30 }).notNull().default("missing"),
    ticketDocumentId: uuid("ticket_document_id"),
    receiptStatus: varchar("receipt_status", { length: 30 }).notNull().default("missing"),
    receiptDocumentId: uuid("receipt_document_id"),
    emptyTrailerStatus: varchar("empty_trailer_status", { length: 30 })
      .notNull()
      .default("pending"),
    emptyTrailerDocumentId: uuid("empty_trailer_document_id"),
    evidenceWaiverReason: text("evidence_waiver_reason"),
    evidenceWaivedAt: timestamp("evidence_waived_at", { withTimezone: true }),
    evidenceWaivedBy: uuid("evidence_waived_by"),
    remainingMaterialStatus: varchar("remaining_material_status", { length: 30 })
      .notNull()
      .default("pending"),
    disposalFeeCents: bigint("disposal_fee_cents", { mode: "number" }),
    expenseId: uuid("expense_id"),
    rejectionReason: text("rejection_reason"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    unloadedAt: timestamp("unloaded_at", { withTimezone: true }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledBy: uuid("reconciled_by"),
    ...auditColumns,
  },
  (table) => [
    unique("disposal_loads_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("disposal_loads_tenant_id_job_unique").on(table.tenantId, table.id, table.jobId),
    unique("disposal_loads_sequence_unique").on(
      table.tenantId,
      table.rentalDetailId,
      table.sequence,
    ),
    unique("disposal_loads_expense_unique").on(table.tenantId, table.expenseId),
    foreignKey({
      columns: [table.tenantId, table.rentalDetailId, table.jobId],
      foreignColumns: [
        dumpTrailerRentalDetails.tenantId,
        dumpTrailerRentalDetails.id,
        dumpTrailerRentalDetails.jobId,
      ],
      name: "disposal_loads_tenant_detail_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.redirectedFromDisposalLoadId, table.jobId],
      foreignColumns: [table.tenantId, table.id, table.jobId],
      name: "disposal_loads_tenant_redirect_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.routeStopId, table.jobId],
      foreignColumns: [routeStops.tenantId, routeStops.id, routeStops.jobId],
      name: "disposal_loads_tenant_stop_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.plannedFacilityLocationId],
      foreignColumns: [supplierLocations.tenantId, supplierLocations.id],
      name: "disposal_loads_tenant_planned_facility_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.actualFacilityLocationId],
      foreignColumns: [supplierLocations.tenantId, supplierLocations.id],
      name: "disposal_loads_tenant_actual_facility_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.ticketDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "disposal_loads_tenant_ticket_document_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.receiptDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "disposal_loads_tenant_receipt_document_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.emptyTrailerDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "disposal_loads_tenant_empty_document_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evidenceWaivedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "disposal_loads_tenant_evidence_waiver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.expenseId, table.jobId],
      foreignColumns: [expenses.tenantId, expenses.id, expenses.jobId],
      name: "disposal_loads_tenant_expense_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reconciledBy],
      foreignColumns: [users.tenantId, users.id],
      name: "disposal_loads_tenant_reconciler_fk",
    }).onDelete("restrict"),
    check("disposal_loads_sequence_check", sql`${table.sequence} > 0`),
    check(
      "disposal_loads_status_check",
      sql`${table.status} in ('planned', 'facility_review', 'ready', 'en_route', 'at_facility', 'acceptance_pending', 'accepted', 'weighed_in', 'unloading', 'partially_unloaded', 'unloaded', 'weighed_out', 'documentation_pending', 'reconciling', 'reconciled', 'rejected', 'redirected', 'cancelled')`,
    ),
    check(
      "disposal_loads_acceptance_check",
      sql`${table.acceptanceResult} in ('pending', 'accepted', 'rejected')`,
    ),
    check(
      "disposal_loads_unloading_check",
      sql`${table.unloadingResult} in ('pending', 'partial', 'unloaded', 'not_unloaded')`,
    ),
    check(
      "disposal_loads_weight_status_check",
      sql`${table.weightStatus} in ('required', 'recorded', 'not_applicable', 'waived') and ${table.sourceWeightUnit} in ('pounds', 'tons')`,
    ),
    check(
      "disposal_loads_weight_values_check",
      sql`(${table.grossWeight} is null or ${table.grossWeight} >= 0) and (${table.tareWeight} is null or ${table.tareWeight} >= 0) and (${table.netWeight} is null or ${table.netWeight} >= 0) and (${table.canonicalNetWeightPounds} is null or ${table.canonicalNetWeightPounds} >= 0)`,
    ),
    check(
      "disposal_loads_recorded_weight_check",
      sql`${table.weightStatus} <> 'recorded' or (${table.grossWeight} is not null and ${table.tareWeight} is not null and ${table.netWeight} = ${table.grossWeight} - ${table.tareWeight} and ${table.grossWeight} >= ${table.tareWeight} and ${table.canonicalNetWeightPounds} is not null)`,
    ),
    check(
      "disposal_loads_weight_exception_check",
      sql`${table.weightStatus} not in ('not_applicable', 'waived') or ${table.weightExceptionReason} is not null`,
    ),
    check(
      "disposal_loads_ticket_status_check",
      sql`${table.ticketStatus} in ('missing', 'attached', 'waived', 'not_required') and (${table.ticketStatus} <> 'attached' or ${table.ticketDocumentId} is not null)`,
    ),
    check(
      "disposal_loads_receipt_status_check",
      sql`${table.receiptStatus} in ('missing', 'attached', 'waived', 'not_required') and (${table.receiptStatus} <> 'attached' or ${table.receiptDocumentId} is not null)`,
    ),
    check(
      "disposal_loads_evidence_waiver_check",
      sql`${table.ticketStatus} <> 'waived' and ${table.receiptStatus} <> 'waived' or (${table.evidenceWaiverReason} is not null and ${table.evidenceWaivedAt} is not null and ${table.evidenceWaivedBy} is not null)`,
    ),
    check(
      "disposal_loads_empty_status_check",
      sql`${table.emptyTrailerStatus} in ('pending', 'confirmed_empty', 'not_empty') and (${table.emptyTrailerStatus} <> 'confirmed_empty' or ${table.emptyTrailerDocumentId} is not null)`,
    ),
    check(
      "disposal_loads_remaining_status_check",
      sql`${table.remainingMaterialStatus} in ('pending', 'none', 'remaining', 'resolved')`,
    ),
    check(
      "disposal_loads_fee_check",
      sql`${table.disposalFeeCents} is null or ${table.disposalFeeCents} >= 0`,
    ),
    check(
      "disposal_loads_rejection_check",
      sql`${table.acceptanceResult} <> 'rejected' or ${table.rejectionReason} is not null`,
    ),
    check(
      "disposal_loads_reconciled_check",
      sql`${table.status} <> 'reconciled' or (${table.actualFacilityLocationId} is not null and ${table.acceptanceResult} = 'accepted' and ${table.unloadingResult} = 'unloaded' and ${table.weightStatus} in ('recorded', 'not_applicable', 'waived') and ${table.ticketStatus} in ('attached', 'waived', 'not_required') and ${table.receiptStatus} in ('attached', 'waived', 'not_required') and ${table.emptyTrailerStatus} = 'confirmed_empty' and ${table.remainingMaterialStatus} in ('none', 'resolved') and (${table.disposalFeeCents} is null or ${table.disposalFeeCents} = 0 or ${table.expenseId} is not null) and ${table.reconciledAt} is not null and ${table.reconciledBy} is not null)`,
    ),
    index("disposal_loads_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
    index("disposal_loads_tenant_facility_status_idx").on(
      table.tenantId,
      table.actualFacilityLocationId,
      table.status,
    ),
  ],
);

export const rentalInspections = pgTable(
  "rental_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").notNull(),
    rentalDetailId: uuid("rental_detail_id").notNull(),
    inspectionNumber: integer("inspection_number").notNull(),
    inspectionType: varchar("inspection_type", { length: 30 }).notNull(),
    trailerAssetId: uuid("trailer_asset_id").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    conditionResult: varchar("condition_result", { length: 40 }).notNull().default("undetermined"),
    cleaningResult: varchar("cleaning_result", { length: 30 }).notNull().default("not_required"),
    damageResult: varchar("damage_result", { length: 30 }).notNull().default("none"),
    releaseDecision: varchar("release_decision", { length: 30 }).notNull().default("pending"),
    safeToRelease: boolean("safe_to_release").notNull().default(false),
    evidenceDocumentId: uuid("evidence_document_id"),
    evidenceSnapshot: jsonb("evidence_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    notes: text("notes"),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    inspectedBy: uuid("inspected_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("rental_inspections_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("rental_inspections_sequence_unique").on(
      table.tenantId,
      table.rentalDetailId,
      table.inspectionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.rentalDetailId, table.jobId],
      foreignColumns: [
        dumpTrailerRentalDetails.tenantId,
        dumpTrailerRentalDetails.id,
        dumpTrailerRentalDetails.jobId,
      ],
      name: "rental_inspections_tenant_detail_job_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.trailerAssetId],
      foreignColumns: [assets.tenantId, assets.id],
      name: "rental_inspections_tenant_trailer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evidenceDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "rental_inspections_tenant_evidence_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.inspectedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "rental_inspections_tenant_inspector_fk",
    }).onDelete("restrict"),
    check("rental_inspections_number_check", sql`${table.inspectionNumber} > 0`),
    check(
      "rental_inspections_type_check",
      sql`${table.inspectionType} in ('pre_dropoff', 'post_rental', 'cleaning_follow_up', 'damage_follow_up', 'maintenance_follow_up')`,
    ),
    check(
      "rental_inspections_status_check",
      sql`${table.status} in ('pending', 'in_progress', 'completed', 'waived')`,
    ),
    check(
      "rental_inspections_condition_check",
      sql`${table.conditionResult} in ('acceptable', 'acceptable_after_cleaning', 'maintenance_review', 'damage_review', 'out_of_service', 'undetermined')`,
    ),
    check(
      "rental_inspections_cleaning_check",
      sql`${table.cleaningResult} in ('not_required', 'normal', 'required', 'completed')`,
    ),
    check(
      "rental_inspections_damage_check",
      sql`${table.damageResult} in ('none', 'review_required', 'damage_confirmed', 'resolved')`,
    ),
    check(
      "rental_inspections_release_check",
      sql`${table.releaseDecision} in ('pending', 'release', 'quarantine', 'out_of_service') and (${table.releaseDecision} <> 'release' or ${table.safeToRelease})`,
    ),
    check(
      "rental_inspections_completion_check",
      sql`${table.status} not in ('completed', 'waived') or (${table.inspectedAt} is not null and ${table.inspectedBy} is not null and ${table.completedAt} is not null and ${table.notes} is not null)`,
    ),
    index("rental_inspections_tenant_job_status_idx").on(table.tenantId, table.jobId, table.status),
    uniqueIndex("rental_inspections_one_open_type_idx")
      .on(table.tenantId, table.rentalDetailId, table.inspectionType)
      .where(sql`${table.status} in ('pending', 'in_progress')`),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    jobId: uuid("job_id"),
    customerAccountId: uuid("customer_account_id").notNull(),
    invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
    invoiceType: varchar("invoice_type", { length: 40 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    replacesInvoiceId: uuid("replaces_invoice_id"),
    replacedByInvoiceId: uuid("replaced_by_invoice_id"),
    disputeSummary: jsonb("dispute_summary").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns,
  },
  (table) => [
    unique("invoices_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("invoices_tenant_id_customer_unique").on(
      table.tenantId,
      table.id,
      table.customerAccountId,
    ),
    unique("invoices_tenant_id_project_customer_unique").on(
      table.tenantId,
      table.id,
      table.projectId,
      table.customerAccountId,
    ),
    unique("invoices_tenant_number_unique").on(table.tenantId, table.invoiceNumber),
    foreignKey({
      columns: [table.tenantId, table.projectId, table.customerAccountId],
      foreignColumns: [projects.tenantId, projects.id, projects.customerAccountId],
      name: "invoices_tenant_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobId, table.projectId],
      foreignColumns: [jobs.tenantId, jobs.id, jobs.projectId],
      name: "invoices_tenant_job_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.replacesInvoiceId],
      foreignColumns: [table.tenantId, table.id],
      name: "invoices_tenant_replaces_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.replacedByInvoiceId],
      foreignColumns: [table.tenantId, table.id],
      name: "invoices_tenant_replaced_by_fk",
    }).onDelete("restrict"),
    check(
      "invoices_type_check",
      sql`${table.invoiceType} in ('deposit', 'final', 'additional_charge', 'credit_memo')`,
    ),
    check("invoices_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "invoices_status_check",
      sql`${table.status} in ('draft', 'review_required', 'ready_to_post', 'posted', 'sent', 'viewed', 'partially_paid', 'paid', 'past_due', 'disputed', 'collection_hold', 'adjusted', 'credited', 'written_off', 'voided', 'replaced', 'resolved', 'archived')`,
    ),
    check(
      "invoices_dates_check",
      sql`${table.issueDate} is null or ${table.dueDate} is null or ${table.dueDate} >= ${table.issueDate}`,
    ),
    check(
      "invoices_posted_check",
      sql`${table.status} not in ('posted', 'sent', 'viewed', 'partially_paid', 'paid', 'past_due', 'disputed', 'collection_hold', 'adjusted', 'credited', 'written_off', 'voided', 'replaced', 'resolved', 'archived') or (${table.issueDate} is not null and ${table.dueDate} is not null and ${table.postedAt} is not null)`,
    ),
    check(
      "invoices_void_check",
      sql`${table.status} <> 'voided' or (${table.voidedAt} is not null and ${table.voidReason} is not null)`,
    ),
    check(
      "invoices_replacement_self_check",
      sql`${table.replacesInvoiceId} is null or ${table.replacesInvoiceId} <> ${table.id}`,
    ),
    index("invoices_tenant_customer_status_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.status,
      table.createdAt,
    ),
    index("invoices_tenant_project_type_idx").on(
      table.tenantId,
      table.projectId,
      table.invoiceType,
      table.createdAt,
    ),
  ],
);

export const invoiceVersions = pgTable(
  "invoice_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    billingIdentitySnapshot: jsonb("billing_identity_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    calculationSnapshot: jsonb("calculation_snapshot").$type<Record<string, unknown>>().notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    depositApplicationCents: bigint("deposit_application_cents", { mode: "number" })
      .notNull()
      .default(0),
    customerCreditApplicationCents: bigint("customer_credit_application_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),
    amountDueCents: bigint("amount_due_cents", { mode: "number" }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
    preparedBy: uuid("prepared_by").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by"),
    supersedesInvoiceVersionId: uuid("supersedes_invoice_version_id"),
    ...auditColumns,
  },
  (table) => [
    unique("invoice_versions_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("invoice_versions_tenant_id_invoice_unique").on(
      table.tenantId,
      table.id,
      table.invoiceId,
    ),
    unique("invoice_versions_tenant_invoice_version_unique").on(
      table.tenantId,
      table.invoiceId,
      table.versionNumber,
    ),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: "invoice_versions_tenant_invoice_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.preparedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "invoice_versions_tenant_preparer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "invoice_versions_tenant_poster_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.supersedesInvoiceVersionId],
      foreignColumns: [table.tenantId, table.id],
      name: "invoice_versions_tenant_supersedes_fk",
    }).onDelete("restrict"),
    check("invoice_versions_number_check", sql`${table.versionNumber} > 0`),
    check(
      "invoice_versions_status_check",
      sql`${table.status} in ('draft', 'review_required', 'ready_to_post', 'posted', 'superseded', 'voided')`,
    ),
    check("invoice_versions_hash_check", sql`length(${table.contentHash}) = 64`),
    check(
      "invoice_versions_amounts_check",
      sql`${table.subtotalCents} >= 0 and ${table.discountCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} >= 0 and ${table.depositApplicationCents} >= 0 and ${table.customerCreditApplicationCents} >= 0 and ${table.amountDueCents} >= 0`,
    ),
    check(
      "invoice_versions_total_check",
      sql`${table.totalCents} = ${table.subtotalCents} - ${table.discountCents} + ${table.taxCents}`,
    ),
    check(
      "invoice_versions_amount_due_check",
      sql`${table.amountDueCents} = ${table.totalCents} - ${table.depositApplicationCents} - ${table.customerCreditApplicationCents}`,
    ),
    check(
      "invoice_versions_posted_check",
      sql`${table.status} <> 'posted' or (${table.postedAt} is not null and ${table.postedBy} is not null)`,
    ),
    uniqueIndex("invoice_versions_one_posted_idx")
      .on(table.tenantId, table.invoiceId)
      .where(sql`${table.status} = 'posted'`),
    index("invoice_versions_tenant_invoice_status_idx").on(
      table.tenantId,
      table.invoiceId,
      table.status,
      table.versionNumber,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    projectId: uuid("project_id"),
    paymentNumber: varchar("payment_number", { length: 40 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paymentMethod: varchar("payment_method", { length: 30 }).notNull(),
    receivingAccountReference: varchar("receiving_account_reference", { length: 160 }).notNull(),
    providerName: varchar("provider_name", { length: 80 }),
    providerTransactionId: varchar("provider_transaction_id", { length: 200 }),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    payerSnapshot: jsonb("payer_snapshot").$type<Record<string, unknown>>().notNull(),
    evidenceDocumentId: uuid("evidence_document_id"),
    receiptStatus: varchar("receipt_status", { length: 30 }).notNull().default("missing"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reversalReason: text("reversal_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("payments_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("payments_tenant_id_customer_unique").on(
      table.tenantId,
      table.id,
      table.customerAccountId,
    ),
    unique("payments_tenant_number_unique").on(table.tenantId, table.paymentNumber),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "payments_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.projectId, table.customerAccountId],
      foreignColumns: [projects.tenantId, projects.id, projects.customerAccountId],
      name: "payments_tenant_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.evidenceDocumentId],
      foreignColumns: [documents.tenantId, documents.id],
      name: "payments_tenant_evidence_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.verifiedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "payments_tenant_verifier_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "payments_tenant_reverser_fk",
    }).onDelete("restrict"),
    check("payments_amount_check", sql`${table.amountCents} > 0`),
    check("payments_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payments_method_check",
      sql`${table.paymentMethod} in ('cash', 'zelle', 'venmo', 'cash_app', 'paypal', 'card', 'bank_transfer', 'check')`,
    ),
    check(
      "payments_status_check",
      sql`${table.status} in ('draft', 'pending', 'verification_required', 'verified', 'processing', 'settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'failed', 'reversed', 'disputed', 'on_hold', 'resolved', 'cancelled')`,
    ),
    check(
      "payments_receipt_check",
      sql`${table.receiptStatus} in ('missing', 'attached', 'issued', 'waived', 'not_required')`,
    ),
    check(
      "payments_verification_check",
      sql`${table.status} not in ('verified', 'processing', 'settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'reversed', 'resolved') or (${table.verifiedAt} is not null and ${table.verifiedBy} is not null)`,
    ),
    check(
      "payments_settlement_check",
      sql`${table.status} not in ('settled', 'partially_allocated', 'fully_allocated', 'partially_refunded', 'refunded', 'reversed', 'resolved') or ${table.settledAt} is not null`,
    ),
    check(
      "payments_reversal_check",
      sql`${table.status} <> 'reversed' or (${table.reversedAt} is not null and ${table.reversedBy} is not null and ${table.reversalReason} is not null)`,
    ),
    uniqueIndex("payments_provider_transaction_unique")
      .on(table.tenantId, table.providerName, table.providerTransactionId)
      .where(sql`${table.providerTransactionId} is not null`),
    index("payments_tenant_customer_received_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.receivedAt,
    ),
    index("payments_tenant_status_idx").on(table.tenantId, table.status, table.receivedAt),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    entryKind: varchar("entry_kind", { length: 20 }).notNull().default("application"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    allocationKey: varchar("allocation_key", { length: 200 }).notNull(),
    reversesPaymentAllocationId: uuid("reverses_payment_allocation_id"),
    reason: text("reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid("applied_by").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("payment_allocations_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("payment_allocations_tenant_key_unique").on(table.tenantId, table.allocationKey),
    unique("payment_allocations_tenant_reversal_unique").on(
      table.tenantId,
      table.reversesPaymentAllocationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.paymentId, table.customerAccountId],
      foreignColumns: [payments.tenantId, payments.id, payments.customerAccountId],
      name: "payment_allocations_tenant_payment_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.invoiceId, table.customerAccountId],
      foreignColumns: [invoices.tenantId, invoices.id, invoices.customerAccountId],
      name: "payment_allocations_tenant_invoice_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesPaymentAllocationId],
      foreignColumns: [table.tenantId, table.id],
      name: "payment_allocations_tenant_reversal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.appliedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "payment_allocations_tenant_actor_fk",
    }).onDelete("restrict"),
    check("payment_allocations_kind_check", sql`${table.entryKind} in ('application', 'reversal')`),
    check("payment_allocations_amount_check", sql`${table.amountCents} > 0`),
    check(
      "payment_allocations_reversal_check",
      sql`(${table.entryKind} = 'application' and ${table.reversesPaymentAllocationId} is null) or (${table.entryKind} = 'reversal' and ${table.reversesPaymentAllocationId} is not null and ${table.reason} is not null)`,
    ),
    index("payment_allocations_tenant_payment_idx").on(
      table.tenantId,
      table.paymentId,
      table.appliedAt,
    ),
    index("payment_allocations_tenant_invoice_idx").on(
      table.tenantId,
      table.invoiceId,
      table.appliedAt,
    ),
  ],
);

export const depositBalances = pgTable(
  "deposit_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    customerAccountId: uuid("customer_account_id").notNull(),
    sourcePaymentAllocationId: uuid("source_payment_allocation_id").notNull(),
    depositType: varchar("deposit_type", { length: 40 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    originalAmountCents: bigint("original_amount_cents", { mode: "number" }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("available"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("deposit_balances_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("deposit_balances_tenant_id_project_customer_unique").on(
      table.tenantId,
      table.id,
      table.projectId,
      table.customerAccountId,
    ),
    unique("deposit_balances_tenant_source_unique").on(
      table.tenantId,
      table.sourcePaymentAllocationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.projectId, table.customerAccountId],
      foreignColumns: [projects.tenantId, projects.id, projects.customerAccountId],
      name: "deposit_balances_tenant_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.sourcePaymentAllocationId],
      foreignColumns: [paymentAllocations.tenantId, paymentAllocations.id],
      name: "deposit_balances_tenant_source_allocation_fk",
    }).onDelete("restrict"),
    check(
      "deposit_balances_type_check",
      sql`${table.depositType} in ('advance_payment', 'refundable_security', 'split_advance', 'split_security')`,
    ),
    check("deposit_balances_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("deposit_balances_amount_check", sql`${table.originalAmountCents} > 0`),
    check(
      "deposit_balances_status_check",
      sql`${table.status} in ('available', 'partially_applied', 'fully_applied', 'partially_refunded', 'refunded', 'retained', 'converted_to_credit', 'on_hold', 'disputed', 'resolved')`,
    ),
    check(
      "deposit_balances_resolution_check",
      sql`${table.status} not in ('refunded', 'retained', 'converted_to_credit', 'resolved') or (${table.resolvedAt} is not null and ${table.resolutionReason} is not null)`,
    ),
    index("deposit_balances_tenant_project_status_idx").on(
      table.tenantId,
      table.projectId,
      table.status,
    ),
  ],
);

export const depositApplications = pgTable(
  "deposit_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").notNull(),
    customerAccountId: uuid("customer_account_id").notNull(),
    depositBalanceId: uuid("deposit_balance_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    entryKind: varchar("entry_kind", { length: 20 }).notNull().default("application"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    applicationKey: varchar("application_key", { length: 200 }).notNull(),
    reversesDepositApplicationId: uuid("reverses_deposit_application_id"),
    reason: text("reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid("applied_by").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("deposit_applications_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("deposit_applications_tenant_key_unique").on(table.tenantId, table.applicationKey),
    unique("deposit_applications_tenant_reversal_unique").on(
      table.tenantId,
      table.reversesDepositApplicationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.depositBalanceId, table.projectId, table.customerAccountId],
      foreignColumns: [
        depositBalances.tenantId,
        depositBalances.id,
        depositBalances.projectId,
        depositBalances.customerAccountId,
      ],
      name: "deposit_applications_tenant_balance_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.invoiceId, table.projectId, table.customerAccountId],
      foreignColumns: [
        invoices.tenantId,
        invoices.id,
        invoices.projectId,
        invoices.customerAccountId,
      ],
      name: "deposit_applications_tenant_invoice_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesDepositApplicationId],
      foreignColumns: [table.tenantId, table.id],
      name: "deposit_applications_tenant_reversal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.appliedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "deposit_applications_tenant_actor_fk",
    }).onDelete("restrict"),
    check(
      "deposit_applications_kind_check",
      sql`${table.entryKind} in ('application', 'reversal')`,
    ),
    check("deposit_applications_amount_check", sql`${table.amountCents} > 0`),
    check(
      "deposit_applications_reversal_check",
      sql`(${table.entryKind} = 'application' and ${table.reversesDepositApplicationId} is null) or (${table.entryKind} = 'reversal' and ${table.reversesDepositApplicationId} is not null and ${table.reason} is not null)`,
    ),
    index("deposit_applications_tenant_balance_idx").on(
      table.tenantId,
      table.depositBalanceId,
      table.appliedAt,
    ),
    index("deposit_applications_tenant_invoice_idx").on(
      table.tenantId,
      table.invoiceId,
      table.appliedAt,
    ),
  ],
);

export const customerCredits = pgTable(
  "customer_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    projectId: uuid("project_id"),
    creditNumber: varchar("credit_number", { length: 40 }).notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceId: uuid("source_id").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    originalAmountCents: bigint("original_amount_cents", { mode: "number" }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("available"),
    description: varchar("description", { length: 300 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionReason: text("resolution_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("customer_credits_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("customer_credits_tenant_id_customer_unique").on(
      table.tenantId,
      table.id,
      table.customerAccountId,
    ),
    unique("customer_credits_tenant_number_unique").on(table.tenantId, table.creditNumber),
    unique("customer_credits_tenant_source_unique").on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "customer_credits_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.projectId, table.customerAccountId],
      foreignColumns: [projects.tenantId, projects.id, projects.customerAccountId],
      name: "customer_credits_tenant_project_customer_fk",
    }).onDelete("restrict"),
    check(
      "customer_credits_source_check",
      sql`${table.sourceType} in ('unapplied_payment', 'overpayment', 'credit_memo', 'released_deposit', 'allocation_reversal', 'adjustment', 'manual')`,
    ),
    check("customer_credits_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("customer_credits_amount_check", sql`${table.originalAmountCents} > 0`),
    check(
      "customer_credits_status_check",
      sql`${table.status} in ('available', 'partially_applied', 'fully_applied', 'on_hold', 'partially_refunded', 'refunded', 'reversed', 'disputed', 'resolved')`,
    ),
    check(
      "customer_credits_resolution_check",
      sql`${table.status} not in ('refunded', 'reversed', 'resolved') or (${table.resolvedAt} is not null and ${table.resolutionReason} is not null)`,
    ),
    index("customer_credits_tenant_customer_status_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.status,
    ),
  ],
);

export const customerCreditApplications = pgTable(
  "customer_credit_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    customerCreditId: uuid("customer_credit_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    entryKind: varchar("entry_kind", { length: 20 }).notNull().default("application"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    applicationKey: varchar("application_key", { length: 200 }).notNull(),
    reversesCustomerCreditApplicationId: uuid("reverses_customer_credit_application_id"),
    reason: text("reason"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid("applied_by").notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("customer_credit_applications_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("customer_credit_applications_tenant_key_unique").on(
      table.tenantId,
      table.applicationKey,
    ),
    unique("customer_credit_applications_tenant_reversal_unique").on(
      table.tenantId,
      table.reversesCustomerCreditApplicationId,
    ),
    foreignKey({
      columns: [table.tenantId, table.customerCreditId, table.customerAccountId],
      foreignColumns: [
        customerCredits.tenantId,
        customerCredits.id,
        customerCredits.customerAccountId,
      ],
      name: "customer_credit_applications_tenant_credit_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.invoiceId, table.customerAccountId],
      foreignColumns: [invoices.tenantId, invoices.id, invoices.customerAccountId],
      name: "customer_credit_applications_tenant_invoice_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesCustomerCreditApplicationId],
      foreignColumns: [table.tenantId, table.id],
      name: "customer_credit_applications_tenant_reversal_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.appliedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "customer_credit_applications_tenant_actor_fk",
    }).onDelete("restrict"),
    check(
      "customer_credit_applications_kind_check",
      sql`${table.entryKind} in ('application', 'reversal')`,
    ),
    check("customer_credit_applications_amount_check", sql`${table.amountCents} > 0`),
    check(
      "customer_credit_applications_reversal_check",
      sql`(${table.entryKind} = 'application' and ${table.reversesCustomerCreditApplicationId} is null) or (${table.entryKind} = 'reversal' and ${table.reversesCustomerCreditApplicationId} is not null and ${table.reason} is not null)`,
    ),
    index("customer_credit_applications_tenant_credit_idx").on(
      table.tenantId,
      table.customerCreditId,
      table.appliedAt,
    ),
    index("customer_credit_applications_tenant_invoice_idx").on(
      table.tenantId,
      table.invoiceId,
      table.appliedAt,
    ),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerAccountId: uuid("customer_account_id").notNull(),
    projectId: uuid("project_id"),
    refundNumber: varchar("refund_number", { length: 40 }).notNull(),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    paymentId: uuid("payment_id"),
    depositBalanceId: uuid("deposit_balance_id"),
    customerCreditId: uuid("customer_credit_id"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    refundMethod: varchar("refund_method", { length: 30 }).notNull(),
    originalMethod: varchar("original_method", { length: 30 }),
    payeeSnapshot: jsonb("payee_snapshot").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 40 }).notNull().default("draft"),
    reason: text("reason").notNull(),
    alternateMethodReason: text("alternate_method_reason"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    providerName: varchar("provider_name", { length: 80 }),
    providerRefundId: varchar("provider_refund_id", { length: 200 }),
    reversesRefundId: uuid("reverses_refund_id"),
    ...auditColumns,
  },
  (table) => [
    unique("refunds_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("refunds_tenant_number_unique").on(table.tenantId, table.refundNumber),
    unique("refunds_tenant_reversal_unique").on(table.tenantId, table.reversesRefundId),
    foreignKey({
      columns: [table.tenantId, table.customerAccountId],
      foreignColumns: [customerAccounts.tenantId, customerAccounts.id],
      name: "refunds_tenant_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.projectId, table.customerAccountId],
      foreignColumns: [projects.tenantId, projects.id, projects.customerAccountId],
      name: "refunds_tenant_project_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.paymentId, table.customerAccountId],
      foreignColumns: [payments.tenantId, payments.id, payments.customerAccountId],
      name: "refunds_tenant_payment_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerCreditId, table.customerAccountId],
      foreignColumns: [
        customerCredits.tenantId,
        customerCredits.id,
        customerCredits.customerAccountId,
      ],
      name: "refunds_tenant_credit_customer_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.depositBalanceId],
      foreignColumns: [depositBalances.tenantId, depositBalances.id],
      name: "refunds_tenant_deposit_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "refunds_tenant_approver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesRefundId],
      foreignColumns: [table.tenantId, table.id],
      name: "refunds_tenant_reversal_fk",
    }).onDelete("restrict"),
    check(
      "refunds_source_check",
      sql`(${table.sourceType} = 'payment' and ${table.paymentId} is not null and ${table.depositBalanceId} is null and ${table.customerCreditId} is null) or (${table.sourceType} = 'deposit' and ${table.paymentId} is null and ${table.depositBalanceId} is not null and ${table.customerCreditId} is null) or (${table.sourceType} = 'customer_credit' and ${table.paymentId} is null and ${table.depositBalanceId} is null and ${table.customerCreditId} is not null)`,
    ),
    check("refunds_amount_check", sql`${table.amountCents} > 0`),
    check("refunds_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "refunds_method_check",
      sql`${table.refundMethod} in ('cash', 'zelle', 'venmo', 'cash_app', 'paypal', 'card', 'bank_transfer', 'check')`,
    ),
    check(
      "refunds_status_check",
      sql`${table.status} in ('draft', 'review_required', 'pending_approval', 'approved', 'processing', 'partially_processed', 'processed', 'settled', 'failed', 'cancelled', 'reversed', 'disputed', 'resolved')`,
    ),
    check(
      "refunds_approval_check",
      sql`${table.status} not in ('approved', 'processing', 'partially_processed', 'processed', 'settled', 'reversed', 'resolved') or (${table.approvedAt} is not null and ${table.approvedBy} is not null)`,
    ),
    check(
      "refunds_alternate_method_check",
      sql`${table.originalMethod} is null or ${table.refundMethod} = ${table.originalMethod} or (${table.alternateMethodReason} is not null and (${table.status} not in ('approved', 'processing', 'partially_processed', 'processed', 'settled', 'reversed', 'resolved') or ${table.approvedBy} is not null))`,
    ),
    check(
      "refunds_settlement_check",
      sql`${table.status} <> 'settled' or (${table.processedAt} is not null and ${table.settledAt} is not null)`,
    ),
    uniqueIndex("refunds_provider_reference_unique")
      .on(table.tenantId, table.providerName, table.providerRefundId)
      .where(sql`${table.providerRefundId} is not null`),
    index("refunds_tenant_customer_status_idx").on(
      table.tenantId,
      table.customerAccountId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const invoiceAdjustments = pgTable(
  "invoice_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    adjustmentNumber: varchar("adjustment_number", { length: 40 }).notNull(),
    adjustmentType: varchar("adjustment_type", { length: 40 }).notNull(),
    direction: varchar("direction", { length: 20 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    reason: text("reason").notNull(),
    sourceType: varchar("source_type", { length: 50 }),
    sourceId: uuid("source_id"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    newDueDate: date("new_due_date"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postedBy: uuid("posted_by"),
    reversesInvoiceAdjustmentId: uuid("reverses_invoice_adjustment_id"),
    ...auditColumns,
  },
  (table) => [
    unique("invoice_adjustments_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("invoice_adjustments_tenant_number_unique").on(table.tenantId, table.adjustmentNumber),
    unique("invoice_adjustments_tenant_reversal_unique").on(
      table.tenantId,
      table.reversesInvoiceAdjustmentId,
    ),
    foreignKey({
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
      name: "invoice_adjustments_tenant_invoice_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "invoice_adjustments_tenant_approver_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.postedBy],
      foreignColumns: [users.tenantId, users.id],
      name: "invoice_adjustments_tenant_poster_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.reversesInvoiceAdjustmentId],
      foreignColumns: [table.tenantId, table.id],
      name: "invoice_adjustments_tenant_reversal_fk",
    }).onDelete("restrict"),
    check(
      "invoice_adjustments_type_check",
      sql`${table.adjustmentType} in ('additional_charge', 'credit', 'tax_adjustment', 'deposit_application_reversal', 'write_off', 'charge_reversal', 'due_date_extension', 'void', 'replacement')`,
    ),
    check("invoice_adjustments_direction_check", sql`${table.direction} in ('debit', 'credit')`),
    check("invoice_adjustments_amount_check", sql`${table.amountCents} >= 0`),
    check(
      "invoice_adjustments_due_date_check",
      sql`${table.adjustmentType} <> 'due_date_extension' or (${table.newDueDate} is not null and ${table.amountCents} = 0)`,
    ),
    check(
      "invoice_adjustments_status_check",
      sql`${table.status} in ('draft', 'pending_approval', 'approved', 'posted', 'reversed', 'cancelled')`,
    ),
    check(
      "invoice_adjustments_approval_check",
      sql`${table.status} not in ('approved', 'posted', 'reversed') or (${table.approvedAt} is not null and ${table.approvedBy} is not null)`,
    ),
    check(
      "invoice_adjustments_posted_check",
      sql`${table.status} <> 'posted' or (${table.postedAt} is not null and ${table.postedBy} is not null)`,
    ),
    index("invoice_adjustments_tenant_invoice_status_idx").on(
      table.tenantId,
      table.invoiceId,
      table.status,
      table.effectiveAt,
    ),
  ],
);

export const invoiceDeliveries = pgTable(
  "invoice_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    destinationSnapshot: jsonb("destination_snapshot").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    providerReference: varchar("provider_reference", { length: 200 }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    ...auditColumns,
  },
  (table) => [
    unique("invoice_deliveries_tenant_id_id_unique").on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.invoiceVersionId, table.invoiceId],
      foreignColumns: [invoiceVersions.tenantId, invoiceVersions.id, invoiceVersions.invoiceId],
      name: "invoice_deliveries_tenant_version_invoice_fk",
    }).onDelete("restrict"),
    check(
      "invoice_deliveries_channel_check",
      sql`${table.channel} in ('email', 'text', 'link', 'manual')`,
    ),
    check(
      "invoice_deliveries_status_check",
      sql`${table.status} in ('pending', 'sent', 'delivered', 'failed', 'viewed')`,
    ),
    check(
      "invoice_deliveries_failure_check",
      sql`${table.status} <> 'failed' or ${table.failureReason} is not null`,
    ),
    index("invoice_deliveries_tenant_invoice_attempt_idx").on(
      table.tenantId,
      table.invoiceId,
      table.attemptedAt,
    ),
  ],
);

export const invoicePublicLinks = pgTable(
  "invoice_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    invoiceDeliveryId: uuid("invoice_delivery_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    creationKeyHash: varchar("creation_key_hash", { length: 64 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    unique("invoice_public_links_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("invoice_public_links_token_hash_unique").on(table.tokenHash),
    unique("invoice_public_links_tenant_creation_key_unique").on(
      table.tenantId,
      table.creationKeyHash,
    ),
    foreignKey({
      columns: [table.tenantId, table.invoiceVersionId, table.invoiceId],
      foreignColumns: [invoiceVersions.tenantId, invoiceVersions.id, invoiceVersions.invoiceId],
      name: "invoice_public_links_tenant_version_invoice_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.invoiceDeliveryId],
      foreignColumns: [invoiceDeliveries.tenantId, invoiceDeliveries.id],
      name: "invoice_public_links_tenant_delivery_fk",
    }).onDelete("restrict"),
    check("invoice_public_links_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    check("invoice_public_links_view_count_check", sql`${table.viewCount} >= 0`),
    index("invoice_public_links_tenant_invoice_idx").on(
      table.tenantId,
      table.invoiceId,
      table.expiresAt,
    ),
  ],
);

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceVersionId: uuid("invoice_version_id").notNull(),
    sequence: integer("sequence").notNull(),
    lineType: varchar("line_type", { length: 40 }).notNull(),
    direction: varchar("direction", { length: 20 }).notNull().default("debit"),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    sourceId: uuid("source_id"),
    acceptedQuoteLineItemId: uuid("accepted_quote_line_item_id"),
    jobChargeId: uuid("job_charge_id"),
    depositApplicationId: uuid("deposit_application_id"),
    customerCreditApplicationId: uuid("customer_credit_application_id"),
    invoiceAdjustmentId: uuid("invoice_adjustment_id"),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3 }),
    unit: varchar("unit", { length: 40 }),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    taxBehavior: varchar("tax_behavior", { length: 30 }).notNull().default("non_taxable"),
    sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>().notNull(),
    ...auditColumns,
  },
  (table) => [
    unique("invoice_line_items_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("invoice_line_items_tenant_version_sequence_unique").on(
      table.tenantId,
      table.invoiceVersionId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.tenantId, table.invoiceVersionId, table.invoiceId],
      foreignColumns: [invoiceVersions.tenantId, invoiceVersions.id, invoiceVersions.invoiceId],
      name: "invoice_line_items_tenant_version_invoice_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.acceptedQuoteLineItemId],
      foreignColumns: [quoteLineItems.tenantId, quoteLineItems.id],
      name: "invoice_line_items_tenant_quote_line_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.jobChargeId],
      foreignColumns: [jobCharges.tenantId, jobCharges.id],
      name: "invoice_line_items_tenant_job_charge_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.depositApplicationId],
      foreignColumns: [depositApplications.tenantId, depositApplications.id],
      name: "invoice_line_items_tenant_deposit_application_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.customerCreditApplicationId],
      foreignColumns: [customerCreditApplications.tenantId, customerCreditApplications.id],
      name: "invoice_line_items_tenant_credit_application_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.tenantId, table.invoiceAdjustmentId],
      foreignColumns: [invoiceAdjustments.tenantId, invoiceAdjustments.id],
      name: "invoice_line_items_tenant_adjustment_fk",
    }).onDelete("restrict"),
    check("invoice_line_items_sequence_check", sql`${table.sequence} > 0`),
    check(
      "invoice_line_items_type_check",
      sql`${table.lineType} in ('accepted_quote', 'job_charge', 'deposit_application', 'customer_credit', 'adjustment', 'tax', 'rounding')`,
    ),
    check("invoice_line_items_direction_check", sql`${table.direction} in ('debit', 'credit')`),
    check(
      "invoice_line_items_source_type_check",
      sql`${table.sourceType} in ('accepted_quote_line', 'job_charge', 'deposit_application', 'customer_credit_application', 'invoice_adjustment', 'tax_rule', 'rounding_rule')`,
    ),
    check(
      "invoice_line_items_source_check",
      sql`(${table.lineType} = 'accepted_quote' and ${table.acceptedQuoteLineItemId} is not null and ${table.jobChargeId} is null and ${table.depositApplicationId} is null and ${table.customerCreditApplicationId} is null and ${table.invoiceAdjustmentId} is null) or (${table.lineType} = 'job_charge' and ${table.acceptedQuoteLineItemId} is null and ${table.jobChargeId} is not null and ${table.depositApplicationId} is null and ${table.customerCreditApplicationId} is null and ${table.invoiceAdjustmentId} is null) or (${table.lineType} = 'deposit_application' and ${table.acceptedQuoteLineItemId} is null and ${table.jobChargeId} is null and ${table.depositApplicationId} is not null and ${table.customerCreditApplicationId} is null and ${table.invoiceAdjustmentId} is null) or (${table.lineType} = 'customer_credit' and ${table.acceptedQuoteLineItemId} is null and ${table.jobChargeId} is null and ${table.depositApplicationId} is null and ${table.customerCreditApplicationId} is not null and ${table.invoiceAdjustmentId} is null) or (${table.lineType} = 'adjustment' and ${table.acceptedQuoteLineItemId} is null and ${table.jobChargeId} is null and ${table.depositApplicationId} is null and ${table.customerCreditApplicationId} is null and ${table.invoiceAdjustmentId} is not null) or (${table.lineType} in ('tax', 'rounding') and ${table.acceptedQuoteLineItemId} is null and ${table.jobChargeId} is null and ${table.depositApplicationId} is null and ${table.customerCreditApplicationId} is null and ${table.invoiceAdjustmentId} is null)`,
    ),
    check(
      "invoice_line_items_quantity_check",
      sql`${table.quantity} is null or ${table.quantity} > 0`,
    ),
    check(
      "invoice_line_items_unit_check",
      sql`(${table.quantity} is null and ${table.unit} is null and ${table.unitPriceCents} is null) or (${table.quantity} is not null and ${table.unit} is not null and ${table.unitPriceCents} is not null and ${table.unitPriceCents} >= 0)`,
    ),
    check(
      "invoice_line_items_amounts_check",
      sql`${table.subtotalCents} >= 0 and ${table.taxCents} >= 0 and ${table.totalCents} = ${table.subtotalCents} + ${table.taxCents}`,
    ),
    check(
      "invoice_line_items_tax_check",
      sql`${table.taxBehavior} in ('taxable', 'non_taxable', 'tax_included')`,
    ),
    uniqueIndex("invoice_line_items_one_source_per_version_idx")
      .on(table.tenantId, table.invoiceVersionId, table.sourceType, table.sourceId)
      .where(sql`${table.sourceId} is not null`),
    index("invoice_line_items_tenant_version_sequence_idx").on(
      table.tenantId,
      table.invoiceVersionId,
      table.sequence,
    ),
  ],
);
