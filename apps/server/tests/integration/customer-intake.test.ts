import {
  accountContacts,
  auditEvents,
  contacts,
  createDatabase,
  createDatabasePool,
  customerAccounts,
  documents,
  leads,
  organizations,
  outboxEvents,
  runMigrations,
  serviceLocations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

interface CreatedLeadResponse {
  duplicateWarnings: { code: string; entityId: string }[];
  lead: {
    customer: { id: string };
    id: string;
    leadNumber: string;
    serviceType: string;
    status: string;
  };
}

describe("Sprint 1.3.0 customer intake", { concurrent: false }, () => {
  const databaseName = `ldg_intake_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  const linkedDocumentId = randomUUID();
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;
  let materialLeadId = "";
  let materialCustomerId = "";
  let rentalLeadId = "";
  let foreignLeadId = "";

  const runtime = () => initialized(runtimeDatabase, "runtime database");
  const migrator = () => initialized(migrationDatabase, "migration database");

  beforeAll(async () => {
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await initialized(adminPool, "admin pool").query(
      `create database "${databaseName}" owner "${environment("POSTGRES_MIGRATION_USER")}"`,
    );
    databaseCreated = true;
    migrationPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_MIGRATION_USER"),
        environment("POSTGRES_MIGRATION_PASSWORD"),
        databaseName,
      ),
    );
    runtimePool = createDatabasePool(
      connectionString(
        environment("POSTGRES_RUNTIME_USER"),
        environment("POSTGRES_RUNTIME_PASSWORD"),
        databaseName,
      ),
    );
    migrationDatabase = createDatabase(migrationPool);
    runtimeDatabase = createDatabase(runtimePool);
    await runMigrations(migrator());
    await seedTenant(migrator(), tenantId, userId, "Intake Test");
    await seedTenant(migrator(), foreignTenantId, foreignUserId, "Foreign Intake Test");
    await withTenantTransaction(migrator(), tenantId, (transaction) =>
      transaction.insert(documents).values({
        availableAt: new Date(),
        id: linkedDocumentId,
        mediaType: "application/pdf",
        objectKey: `tenants/${tenantId}/documents/${linkedDocumentId}`,
        originalFilename: "site-plan.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 1024,
        status: "available",
        tenantId,
      }),
    );
    foreignLeadId = await seedForeignLead(migrator(), foreignTenantId, foreignUserId);

    process.env.DATABASE_URL = connectionString(
      environment("POSTGRES_RUNTIME_USER"),
      environment("POSTGRES_RUNTIME_PASSWORD"),
      databaseName,
    );
    process.env.DEVELOPMENT_TENANT_ID = tenantId;
    process.env.DEVELOPMENT_USER_ID = userId;
    process.env.DEVELOPMENT_PERMISSIONS = "*";
    process.env.WORKER_TENANT_IDS = tenantId;
    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
  }, 30_000);

  afterAll(async () => {
    await api?.application.close();
    await runtimePool?.end();
    await migrationPool?.end();
    if (adminPool && databaseCreated) {
      await adminPool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [databaseName],
      );
      await adminPool.query(`drop database if exists "${databaseName}"`);
    }
    await adminPool?.end();
  });

  it("creates and replays a complete Material Delivery Lead atomically", async () => {
    const payload = materialLeadPayload();
    const create = () =>
      fastify.inject({
        headers: { "idempotency-key": "intake-material-1" },
        method: "POST",
        payload,
        url: "/api/v1/intake/leads",
      });
    const first = await create();
    expect(first.statusCode).toBe(201);
    const body = first.json<CreatedLeadResponse>();
    materialLeadId = body.lead.id;
    materialCustomerId = body.lead.customer.id;
    expect(body).toMatchObject({
      duplicateWarnings: [],
      lead: { serviceType: "material_delivery", status: "new" },
    });
    expect(body.lead.leadNumber).toMatch(/^LEAD-\d{4}-\d{5}$/);

    const replay = (await create()).json<CreatedLeadResponse>();
    expect(replay.lead.id).toBe(materialLeadId);
    expect(replay.lead.customer.id).toBe(materialCustomerId);

    const persisted = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      audits: await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, materialLeadId)),
      customers: await transaction
        .select({ value: count() })
        .from(customerAccounts)
        .where(eq(customerAccounts.id, materialCustomerId)),
      outbox: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, materialLeadId)),
    }));
    expect(persisted.customers[0]?.value).toBe(1);
    expect(persisted.audits.map((event) => event.eventType)).toContain("lead.created");
    expect(persisted.outbox.map((event) => event.eventType)).toContain("lead.created");
  });

  it("creates a Rental Lead, rejects mixed service details, and returns non-destructive warnings", async () => {
    const rental = await fastify.inject({
      headers: { "idempotency-key": "intake-rental-1" },
      method: "POST",
      payload: rentalLeadPayload(),
      url: "/api/v1/intake/leads",
    });
    expect(rental.statusCode).toBe(201);
    rentalLeadId = rental.json<CreatedLeadResponse>().lead.id;
    expect(rental.json()).toMatchObject({
      lead: { serviceType: "dump_trailer_rental", status: "new" },
    });

    const mixedPayload = {
      ...materialLeadPayload(),
      dumpTrailerRental: {
        debrisType: "Concrete",
        rentalEndDate: "2026-08-11",
        rentalStartDate: "2026-08-10",
      },
    };
    const mixed = await fastify.inject({
      headers: { "idempotency-key": "intake-mixed-1" },
      method: "POST",
      payload: mixedPayload,
      url: "/api/v1/intake/leads",
    });
    expect(mixed.statusCode).toBe(422);
    expect(mixed.json()).toMatchObject({ error: { code: "LEAD_SERVICE_DETAILS_INVALID" } });

    const duplicateCheck = await fastify.inject({
      method: "POST",
      payload: {
        customerName: "Santos Residence",
        email: "maya.santos@example.test",
        phone: "402-555-0177",
        serviceLocation: materialLeadPayload().serviceLocation,
      },
      url: "/api/v1/intake/actions/check-duplicates",
    });
    expect(duplicateCheck.statusCode).toBe(200);
    expect(
      duplicateCheck.json<{ warnings: { code: string }[] }>().warnings.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "customer_name",
        "contact_email",
        "contact_phone",
        "service_address",
      ]),
    );

    const warningCreate = await fastify.inject({
      headers: { "idempotency-key": "intake-duplicate-warning-1" },
      method: "POST",
      payload: materialLeadPayload(),
      url: "/api/v1/intake/leads",
    });
    expect(warningCreate.statusCode).toBe(201);
    const warningBody = warningCreate.json<CreatedLeadResponse>();
    expect(warningBody.duplicateWarnings.length).toBeGreaterThan(0);
    expect(warningBody.lead.customer.id).not.toBe(materialCustomerId);
  });

  it("lists customer and Lead read models without exposing another tenant", async () => {
    const customers = await fastify.inject({ method: "GET", url: "/api/v1/customers?q=Santos" });
    expect(customers.statusCode).toBe(200);
    expect(customers.json<{ items: { id: string }[] }>().items.map(({ id }) => id)).toContain(
      materialCustomerId,
    );

    const customer = await fastify.inject({
      method: "GET",
      url: `/api/v1/customers/${materialCustomerId}`,
    });
    expect(customer.statusCode).toBe(200);
    expect(customer.json()).toMatchObject({
      contacts: [{ displayName: "Maya Santos" }],
      id: materialCustomerId,
      serviceLocations: [{ city: "Lincoln" }],
    });

    const leadsResponse = await fastify.inject({
      method: "GET",
      url: "/api/v1/leads?status=new",
    });
    expect(leadsResponse.statusCode).toBe(200);
    const listedLeads = leadsResponse.json<{ items: { id: string }[]; total: number }>();
    expect(listedLeads.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([materialLeadId, rentalLeadId]),
    );
    expect(listedLeads.total).toBeGreaterThanOrEqual(2);

    const foreign = await fastify.inject({
      method: "GET",
      url: `/api/v1/leads/${foreignLeadId}`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: "LEAD_NOT_FOUND" } });
  });

  it("runs controlled lifecycle commands and rejects an invalid state", async () => {
    const transition = (action: string, key: string, payload: Record<string, unknown> = {}) =>
      fastify.inject({
        headers: { "idempotency-key": key },
        method: "POST",
        payload,
        url: `/api/v1/leads/${materialLeadId}/actions/${action}`,
      });

    expect((await transition("start-contacting", "lead-contacting-1")).json()).toMatchObject({
      status: "contacting",
    });
    const qualified = await transition("qualify", "lead-qualify-1");
    expect(qualified.json()).toMatchObject({ status: "qualified" });
    expect((await transition("qualify", "lead-qualify-1")).json()).toMatchObject({
      status: "qualified",
    });
    expect((await transition("start-estimating", "lead-estimating-1")).json()).toMatchObject({
      status: "estimating",
    });
    expect((await transition("mark-lost", "lead-lost-missing-reason", {})).json()).toMatchObject({
      error: { code: "LEAD_REASON_REQUIRED" },
    });
    expect(
      (
        await transition("mark-lost", "lead-lost-1", { reason: "Customer chose another provider" })
      ).json(),
    ).toMatchObject({ status: "lost", terminalReason: "Customer chose another provider" });

    const invalid = await transition("qualify", "lead-qualify-invalid-1");
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json()).toMatchObject({ error: { code: "LEAD_TRANSITION_INVALID" } });

    const events = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.select().from(auditEvents).where(eq(auditEvents.entityId, materialLeadId)),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        "lead.contacting_started",
        "lead.qualified",
        "lead.estimating_started",
        "lead.lost",
      ]),
    );
  });

  it("adds Notes, Tasks, Documents, and an audit-backed timeline", async () => {
    const note = await fastify.inject({
      headers: { "idempotency-key": "lead-note-1" },
      method: "POST",
      payload: { body: "Gate is narrow; call before arrival.", visibility: "internal" },
      url: `/api/v1/leads/${rentalLeadId}/notes`,
    });
    expect(note.statusCode).toBe(201);

    const task = await fastify.inject({
      headers: { "idempotency-key": "lead-task-1" },
      method: "POST",
      payload: { title: "Confirm driveway access" },
      url: `/api/v1/leads/${rentalLeadId}/tasks`,
    });
    expect(task.statusCode).toBe(201);
    const taskId = task.json<{ id: string }>().id;
    const complete = await fastify.inject({
      headers: { "idempotency-key": "lead-task-complete-1" },
      method: "POST",
      url: `/api/v1/leads/${rentalLeadId}/tasks/${taskId}/actions/complete`,
    });
    expect(complete.json()).toMatchObject({ id: taskId, status: "completed" });

    const linked = await fastify.inject({
      headers: { "idempotency-key": "lead-document-1" },
      method: "POST",
      payload: { documentId: linkedDocumentId, purpose: "site_plan" },
      url: `/api/v1/leads/${rentalLeadId}/documents`,
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({ id: linkedDocumentId, purpose: "site_plan" });

    const detail = await fastify.inject({
      method: "GET",
      url: `/api/v1/leads/${rentalLeadId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      documents: [{ id: linkedDocumentId }],
      notes: [{ body: "Gate is narrow; call before arrival." }],
      tasks: [{ id: taskId, status: "completed" }],
    });
    expect(
      detail
        .json<{ timeline: { eventType: string }[] }>()
        .timeline.map(({ eventType }) => eventType),
    ).toEqual(
      expect.arrayContaining([
        "lead.created",
        "lead.note_added",
        "lead.task_added",
        "lead.document_linked",
      ]),
    );
  });

  it("enforces Lead permissions independently of tenant context", async () => {
    const originalPermissions = process.env.DEVELOPMENT_PERMISSIONS;
    process.env.DEVELOPMENT_PERMISSIONS = "customers:read";
    const restrictedApi = await createApiApplication();
    try {
      const restrictedFastify: FastifyInstance = restrictedApi.application
        .getHttpAdapter()
        .getInstance();
      const denied = await restrictedFastify.inject({
        headers: { "idempotency-key": "restricted-create-1" },
        method: "POST",
        payload: materialLeadPayload(),
        url: "/api/v1/intake/leads",
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    } finally {
      await restrictedApi.application.close();
      process.env.DEVELOPMENT_PERMISSIONS = originalPermissions;
    }
  });
});

function materialLeadPayload() {
  return {
    customer: {
      customerType: "individual",
      displayName: "Santos Residence",
      preferredContactMethod: "text",
    },
    materialDelivery: {
      deliveryInstructions: "Place beside the detached garage.",
      estimatedQuantity: "4.500",
      materialDescription: "Crushed limestone",
      quantityUnit: "tons",
    },
    primaryContact: {
      email: "maya.santos@example.test",
      firstName: "Maya",
      lastName: "Santos",
      phone: "402-555-0177",
      preferredContactMethod: "text",
    },
    serviceLocation: {
      accessNotes: "Call before entering the drive.",
      addressLine1: "1840 West Denton Road",
      city: "Lincoln",
      label: "Residence",
      postalCode: "68523",
      region: "NE",
    },
    serviceType: "material_delivery",
    source: "phone",
    summary: "Four and a half tons of crushed limestone",
  };
}

function rentalLeadPayload() {
  return {
    customer: {
      customerType: "business",
      displayName: "Prairie Renovation Co.",
      preferredContactMethod: "email",
    },
    dumpTrailerRental: {
      debrisType: "Construction debris",
      deliveryInstructions: "Set trailer on the east side of the lot.",
      rentalEndDate: "2026-08-10",
      rentalStartDate: "2026-08-07",
    },
    primaryContact: {
      email: "dispatch@prairie-renovation.test",
      firstName: "Jordan",
      lastName: "Lee",
      phone: "402-555-0118",
      preferredContactMethod: "email",
    },
    serviceLocation: {
      addressLine1: "9200 Rokeby Road",
      city: "Roca",
      label: "Renovation site",
      postalCode: "68430",
      region: "NE",
    },
    serviceType: "dump_trailer_rental",
    source: "repeat",
    summary: "Weekend dump trailer rental",
  };
}

async function seedForeignLead(
  database: Database,
  tenantId: string,
  userId: string,
): Promise<string> {
  const customerId = randomUUID();
  const contactId = randomUUID();
  const locationId = randomUUID();
  const leadId = randomUUID();
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(customerAccounts).values({
      customerType: "individual",
      displayName: "Foreign Customer",
      id: customerId,
      normalizedName: "foreign customer",
      ownerUserId: userId,
      tenantId,
    });
    await transaction.insert(contacts).values({
      displayName: "Foreign Contact",
      firstName: "Foreign",
      id: contactId,
      lastName: "Contact",
      normalizedPhone: "4025550190",
      phone: "402-555-0190",
      preferredContactMethod: "phone",
      tenantId,
    });
    await transaction.insert(accountContacts).values({
      contactId,
      customerAccountId: customerId,
      isPrimary: true,
      tenantId,
    });
    await transaction.insert(serviceLocations).values({
      addressLine1: "1 Foreign Road",
      city: "Lincoln",
      customerAccountId: customerId,
      id: locationId,
      label: "Foreign site",
      normalizedAddress: "1 foreign road lincoln ne 68501",
      postalCode: "68501",
      region: "NE",
      tenantId,
    });
    await transaction.insert(leads).values({
      customerAccountId: customerId,
      estimatedQuantity: "2.000",
      id: leadId,
      leadNumber: "LEAD-2026-99999",
      materialDescription: "Gravel",
      ownerUserId: userId,
      primaryContactId: contactId,
      quantityUnit: "tons",
      serviceLocationId: locationId,
      serviceType: "material_delivery",
      source: "phone",
      summary: "Foreign Lead",
      tenantId,
    });
  });
  return leadId;
}

async function seedTenant(
  database: Database,
  tenantId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction
      .insert(organizations)
      .values({ id: tenantId, displayName, legalName: displayName });
    await transaction.insert(users).values({
      displayName: `${displayName} User`,
      email: `${userId}@example.test`,
      id: userId,
      tenantId,
    });
  });
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for customer intake integration tests`);
  return value;
}

function connectionString(user: string, password: string, database: string): string {
  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = password;
  url.hostname = environment("POSTGRES_HOST");
  url.port = environment("POSTGRES_PORT");
  url.pathname = `/${database}`;
  return url.toString();
}

function initialized<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not initialized`);
  return value;
}
