import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { and, count, eq } from "drizzle-orm";
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accountContacts,
  allocateBusinessNumber,
  auditEvents,
  claimOutboxEvents,
  claimScheduledJobs,
  contacts,
  createDatabase,
  createDatabasePool,
  customerAccounts,
  documentPublicLinks,
  documents,
  executeIdempotent,
  IdempotencyConflictError,
  localSeedIds,
  leads,
  organizations,
  outboxEvents,
  roles,
  runMigrations,
  scheduledJobs,
  serviceLocations,
  seedLocalDevelopment,
  userRoles,
  users,
  withTenantTransaction,
  type Database,
} from "../../src/index.js";

config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const requiredEnvironment = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_ADMIN_USER",
  "POSTGRES_ADMIN_PASSWORD",
  "POSTGRES_MIGRATION_USER",
  "POSTGRES_MIGRATION_PASSWORD",
  "POSTGRES_RUNTIME_USER",
  "POSTGRES_RUNTIME_PASSWORD",
] as const;

function environment(name: (typeof requiredEnvironment)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for database integration tests`);
  }
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

function requireInitialized<T>(value: T | undefined, label: string): T {
  if (!value) {
    throw new Error(`${label} was not initialized`);
  }
  return value;
}

describe("Sprint 1.0.0 platform data foundation", () => {
  const databaseName = `ldg_test_${randomUUID().replaceAll("-", "")}`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const roleA = randomUUID();
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;

  const admin = () => requireInitialized(adminPool, "admin pool");
  const migratorPool = () => requireInitialized(migrationPool, "migration pool");
  const migratorDatabase = () => requireInitialized(migrationDatabase, "migration database");
  const runtime = () => requireInitialized(runtimeDatabase, "runtime database");

  beforeAll(async () => {
    for (const name of requiredEnvironment) {
      environment(name);
    }

    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );

    await admin().query(
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

    await runMigrations(migratorDatabase());

    await createTenant(migratorDatabase(), tenantA, "Tenant A", userA, roleA);
    await createTenant(migratorDatabase(), tenantB, "Tenant B", userB);
  });

  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    if (adminPool && databaseCreated) {
      await adminPool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [databaseName],
      );
      await adminPool.query(`drop database if exists "${databaseName}"`);
    }
    if (adminPool) {
      await adminPool.end();
    }
  });

  it("applies the reviewed migration to an empty PostgreSQL database", async () => {
    const result = await migratorPool().query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "audit_events",
        "account_contacts",
        "asset_assignments",
        "asset_reservations",
        "assets",
        "checklist_instances",
        "checklist_items",
        "contacts",
        "contract_public_links",
        "contract_signatures",
        "contracts",
        "customer_accounts",
        "delivery_zones",
        "document_links",
        "document_public_links",
        "documents",
        "idempotency_keys",
        "estimate_cost_items",
        "estimate_versions",
        "estimates",
        "lead_notes",
        "lead_tasks",
        "leads",
        "location_contacts",
        "job_assignments",
        "job_events",
        "jobs",
        "number_sequences",
        "organizations",
        "operational_holds",
        "outbox_events",
        "materials",
        "pricing_calculation_results",
        "pricing_policies",
        "pricing_rule_tiers",
        "pricing_rules",
        "pricing_versions",
        "projects",
        "quote_acceptances",
        "quote_deliveries",
        "quote_line_items",
        "quote_public_links",
        "quote_terms",
        "quote_versions",
        "quotes",
        "readiness_evaluations",
        "roles",
        "route_stops",
        "scheduled_jobs",
        "schedule_blocks",
        "service_locations",
        "supplier_cost_versions",
        "supplier_locations",
        "supplier_materials",
        "suppliers",
        "user_roles",
        "users",
        "worker_heartbeats",
      ]),
    );
  });

  it("forces RLS on every Sprint 1.5 tenant table", async () => {
    const tenantTables = [
      "asset_assignments",
      "asset_reservations",
      "assets",
      "checklist_instances",
      "checklist_items",
      "contract_public_links",
      "contract_signatures",
      "contracts",
      "job_assignments",
      "job_events",
      "jobs",
      "operational_holds",
      "readiness_evaluations",
      "route_stops",
      "schedule_blocks",
    ];
    const result = await migratorPool().query<{
      relforcerowsecurity: boolean;
      relname: string;
      relrowsecurity: boolean;
    }>(
      `
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname = any($1::text[])
      order by relname
    `,
      [tenantTables],
    );
    expect(result.rows).toHaveLength(tenantTables.length);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("keeps the runtime role non-owning and unable to bypass RLS", async () => {
    const roleResult = await admin().query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      "select rolbypassrls, rolsuper from pg_roles where rolname = $1",
      [environment("POSTGRES_RUNTIME_USER")],
    );
    expect(roleResult.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });

    const ownerResult = await migratorPool().query<{ runtime_owned_tables: string }>(`
      select count(*)::text as runtime_owned_tables
      from pg_class classes
      join pg_roles owners on owners.oid = classes.relowner
      join pg_namespace namespaces on namespaces.oid = classes.relnamespace
      where namespaces.nspname = 'public'
        and classes.relkind = 'r'
        and owners.rolname = '${environment("POSTGRES_RUNTIME_USER")}'
    `);
    expect(ownerResult.rows[0]?.runtime_owned_tables).toBe("0");
  });

  it("isolates tenant reads and rejects cross-tenant writes and relationships", async () => {
    const visibleOrganizations = await withTenantTransaction(
      runtime(),
      tenantA,
      async (transaction) => transaction.select().from(organizations),
    );
    expect(visibleOrganizations.map((organization) => organization.id)).toEqual([tenantA]);

    await expect(
      withTenantTransaction(runtime(), tenantA, async (transaction) =>
        transaction.insert(users).values({
          tenantId: tenantB,
          email: "blocked@example.test",
          displayName: "Blocked",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantTransaction(runtime(), tenantA, async (transaction) =>
        transaction.insert(userRoles).values({ tenantId: tenantA, userId: userB, roleId: roleA }),
      ),
    ).rejects.toThrow();

    const withoutContext = await runtime().select().from(users);
    expect(withoutContext).toEqual([]);

    const documentA = randomUUID();
    const documentB = randomUUID();
    const linkA = randomUUID();
    await withTenantTransaction(migratorDatabase(), tenantA, async (transaction) => {
      await transaction.insert(documents).values({
        id: documentA,
        mediaType: "text/plain",
        objectKey: `${tenantA}/${documentA}`,
        originalFilename: "tenant-a.txt",
        tenantId: tenantA,
      });
      await transaction.insert(documentPublicLinks).values({
        creationKeyHash: "a".repeat(64),
        documentId: documentA,
        expiresAt: new Date(Date.now() + 60_000),
        id: linkA,
        requestHash: "b".repeat(64),
        tenantId: tenantA,
        tokenHash: "c".repeat(64),
      });
    });
    await withTenantTransaction(migratorDatabase(), tenantB, async (transaction) => {
      await transaction.insert(documents).values({
        id: documentB,
        mediaType: "text/plain",
        objectKey: `${tenantB}/${documentB}`,
        originalFilename: "tenant-b.txt",
        tenantId: tenantB,
      });
      await transaction.insert(documentPublicLinks).values({
        creationKeyHash: "d".repeat(64),
        documentId: documentB,
        expiresAt: new Date(Date.now() + 60_000),
        requestHash: "e".repeat(64),
        tenantId: tenantB,
        tokenHash: "f".repeat(64),
      });
    });

    const visiblePublicLinks = await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.select().from(documentPublicLinks),
    );
    expect(visiblePublicLinks.map((link) => link.id)).toEqual([linkA]);
    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(documentPublicLinks).values({
          creationKeyHash: "1".repeat(64),
          documentId: documentB,
          expiresAt: new Date(Date.now() + 60_000),
          requestHash: "2".repeat(64),
          tenantId: tenantB,
          tokenHash: "3".repeat(64),
        }),
      ),
    ).rejects.toThrow();
  });

  it("allocates unique sequential business numbers concurrently", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () =>
        withTenantTransaction(runtime(), tenantA, async (transaction) =>
          allocateBusinessNumber(transaction, {
            tenantId: tenantA,
            entityType: "lead",
            prefix: "LEAD",
            year: 2026,
          }),
        ),
      ),
    );

    expect(new Set(numbers).size).toBe(25);
    expect(numbers.toSorted()).toEqual(
      Array.from(
        { length: 25 },
        (_, index) => `LEAD-2026-${(index + 1).toString().padStart(5, "0")}`,
      ),
    );
  });

  it("isolates intake records and rejects cross-tenant or mixed-service relationships", async () => {
    const customerB = randomUUID();
    const contactB = randomUUID();
    const locationB = randomUUID();
    const leadB = randomUUID();

    await withTenantTransaction(migratorDatabase(), tenantB, async (transaction) => {
      await transaction.insert(customerAccounts).values({
        customerType: "individual",
        displayName: "Tenant B Customer",
        id: customerB,
        normalizedName: "tenant b customer",
        ownerUserId: userB,
        tenantId: tenantB,
      });
      await transaction.insert(contacts).values({
        displayName: "Tenant B Contact",
        email: "tenant-b-contact@example.test",
        firstName: "Tenant",
        id: contactB,
        lastName: "Contact",
        normalizedEmail: "tenant-b-contact@example.test",
        preferredContactMethod: "email",
        tenantId: tenantB,
      });
      await transaction.insert(accountContacts).values({
        contactId: contactB,
        customerAccountId: customerB,
        isPrimary: true,
        tenantId: tenantB,
      });
      await transaction.insert(serviceLocations).values({
        addressLine1: "10 Other Street",
        city: "Lincoln",
        customerAccountId: customerB,
        id: locationB,
        label: "Job site",
        normalizedAddress: "10 other street lincoln ne 68501",
        postalCode: "68501",
        region: "NE",
        tenantId: tenantB,
      });
      await transaction.insert(leads).values({
        customerAccountId: customerB,
        estimatedQuantity: "4.000",
        id: leadB,
        leadNumber: "LEAD-2026-00999",
        materialDescription: "Crushed limestone",
        ownerUserId: userB,
        primaryContactId: contactB,
        quantityUnit: "tons",
        serviceLocationId: locationB,
        serviceType: "material_delivery",
        source: "phone",
        summary: "Tenant B material delivery",
        tenantId: tenantB,
      });
    });

    const visibleToTenantA = await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.select().from(leads).where(eq(leads.id, leadB)),
    );
    expect(visibleToTenantA).toEqual([]);

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(serviceLocations).values({
          addressLine1: "10 Other Street",
          city: "Lincoln",
          customerAccountId: customerB,
          label: "Blocked relationship",
          normalizedAddress: "10 other street lincoln ne 68501",
          postalCode: "68501",
          region: "NE",
          tenantId: tenantA,
        }),
      ),
    ).rejects.toThrow();

    const customerA = randomUUID();
    const contactA = randomUUID();
    const locationA = randomUUID();
    await withTenantTransaction(runtime(), tenantA, async (transaction) => {
      await transaction.insert(customerAccounts).values({
        customerType: "individual",
        displayName: "Tenant A Customer",
        id: customerA,
        normalizedName: "tenant a customer",
        ownerUserId: userA,
        tenantId: tenantA,
      });
      await transaction.insert(contacts).values({
        displayName: "Tenant A Contact",
        firstName: "Tenant",
        id: contactA,
        lastName: "Contact",
        normalizedPhone: "4025550101",
        phone: "402-555-0101",
        preferredContactMethod: "phone",
        tenantId: tenantA,
      });
      await transaction.insert(accountContacts).values({
        contactId: contactA,
        customerAccountId: customerA,
        isPrimary: true,
        tenantId: tenantA,
      });
      await transaction.insert(serviceLocations).values({
        addressLine1: "20 Test Avenue",
        city: "Lincoln",
        customerAccountId: customerA,
        id: locationA,
        label: "Job site",
        normalizedAddress: "20 test avenue lincoln ne 68502",
        postalCode: "68502",
        region: "NE",
        tenantId: tenantA,
      });
    });

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(leads).values({
          customerAccountId: customerA,
          debrisType: "Concrete",
          estimatedQuantity: "3.000",
          leadNumber: "LEAD-2026-01000",
          materialDescription: "Gravel",
          ownerUserId: userA,
          primaryContactId: contactA,
          quantityUnit: "tons",
          rentalEndDate: "2026-08-09",
          rentalStartDate: "2026-08-08",
          serviceLocationId: locationA,
          serviceType: "material_delivery",
          source: "website",
          summary: "Invalid mixed service",
          tenantId: tenantA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("replays completed idempotent commands and rejects a changed request", async () => {
    const key = randomUUID();
    let invocations = 0;
    const command = () =>
      withTenantTransaction(runtime(), tenantA, async (transaction) =>
        executeIdempotent(
          transaction,
          {
            tenantId: tenantA,
            scope: "test-command",
            key,
            requestHash: "request-a",
            expiresAt: new Date(Date.now() + 60_000),
          },
          () => {
            invocations += 1;
            return Promise.resolve({ body: { accepted: true }, status: 201 });
          },
        ),
      );

    await expect(command()).resolves.toMatchObject({ replayed: false, status: 201 });
    await expect(command()).resolves.toMatchObject({ replayed: true, status: 201 });
    expect(invocations).toBe(1);

    await expect(
      withTenantTransaction(runtime(), tenantA, async (transaction) =>
        executeIdempotent(
          transaction,
          {
            tenantId: tenantA,
            scope: "test-command",
            key,
            requestHash: "request-b",
            expiresAt: new Date(Date.now() + 60_000),
          },
          () => Promise.resolve({ body: {}, status: 200 }),
        ),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("rolls business data, Audit Events, and outbox events back atomically", async () => {
    const entityId = randomUUID();

    await expect(
      withTenantTransaction(runtime(), tenantA, async (transaction) => {
        await transaction.insert(documents).values({
          id: entityId,
          tenantId: tenantA,
          objectKey: `${tenantA}/${entityId}`,
          originalFilename: "rollback.txt",
          mediaType: "text/plain",
        });
        await transaction.insert(auditEvents).values({
          tenantId: tenantA,
          commandName: "RollbackTest",
          entityType: "Document",
          entityId,
          eventType: "DocumentCreated",
        });
        await transaction.insert(outboxEvents).values({
          tenantId: tenantA,
          aggregateType: "Document",
          aggregateId: entityId,
          eventType: "DocumentCreated",
          payload: { documentId: entityId },
        });
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");

    const counts = await withTenantTransaction(runtime(), tenantA, async (transaction) => ({
      audit: await transaction
        .select({ value: count() })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, entityId)),
      documents: await transaction
        .select({ value: count() })
        .from(documents)
        .where(eq(documents.id, entityId)),
      outbox: await transaction
        .select({ value: count() })
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, entityId)),
    }));

    expect(counts.documents[0]?.value).toBe(0);
    expect(counts.audit[0]?.value).toBe(0);
    expect(counts.outbox[0]?.value).toBe(0);
  });

  it("enforces append-only Audit Events", async () => {
    const eventId = randomUUID();
    await withTenantTransaction(migratorDatabase(), tenantA, async (transaction) => {
      await transaction.insert(auditEvents).values({
        id: eventId,
        tenantId: tenantA,
        commandName: "AppendOnlyTest",
        entityType: "Organization",
        entityId: tenantA,
        eventType: "Tested",
      });
    });

    const client = await migratorPool().connect();
    let mutationError: unknown;
    try {
      await client.query("begin");
      await client.query("select set_tenant_context($1::uuid)", [tenantA]);
      await client.query("update audit_events set event_type = $1 where id = $2", [
        "Changed",
        eventId,
      ]);
    } catch (error) {
      mutationError = error;
    } finally {
      await client.query("rollback");
      client.release();
    }

    expect(mutationError).toBeInstanceOf(Error);
    expect((mutationError as Error).message).toContain("audit events are append-only");
  });

  it("claims outbox events and scheduled jobs once across two workers", async () => {
    const outboxIds = [randomUUID(), randomUUID()];
    const jobIds = [randomUUID(), randomUUID()];

    await withTenantTransaction(runtime(), tenantA, async (transaction) => {
      await transaction.insert(outboxEvents).values(
        outboxIds.map((id) => ({
          id,
          tenantId: tenantA,
          aggregateType: "Test",
          aggregateId: randomUUID(),
          eventType: "TestCreated",
          payload: { id },
        })),
      );
      await transaction.insert(scheduledJobs).values(
        jobIds.map((id) => ({
          id,
          tenantId: tenantA,
          jobType: "test-job",
          payload: { id },
          runAt: new Date(Date.now() - 1_000),
        })),
      );
    });

    const outboxClaims = await Promise.all(
      ["worker-a", "worker-b"].map((workerId) =>
        withTenantTransaction(runtime(), tenantA, async (transaction) =>
          claimOutboxEvents(transaction, { workerId, limit: 10 }),
        ),
      ),
    );
    const jobClaims = await Promise.all(
      ["worker-a", "worker-b"].map((workerId) =>
        withTenantTransaction(runtime(), tenantA, async (transaction) =>
          claimScheduledJobs(transaction, { workerId, limit: 10 }),
        ),
      ),
    );

    expect(
      outboxClaims
        .flat()
        .map((event) => event.id)
        .toSorted(),
    ).toEqual(outboxIds.toSorted());
    expect(
      jobClaims
        .flat()
        .map((job) => job.id)
        .toSorted(),
    ).toEqual(jobIds.toSorted());
  });

  it("seeds local development idempotently", async () => {
    await seedLocalDevelopment(migratorDatabase());
    await seedLocalDevelopment(migratorDatabase());

    const seeded = await withTenantTransaction(
      migratorDatabase(),
      localSeedIds.organization,
      async (transaction) => ({
        audits: await transaction
          .select({ value: count() })
          .from(auditEvents)
          .where(eq(auditEvents.id, localSeedIds.seedAuditEvent)),
        roles: await transaction
          .select({ value: count() })
          .from(roles)
          .where(eq(roles.tenantId, localSeedIds.organization)),
        users: await transaction
          .select({ value: count() })
          .from(users)
          .where(
            and(
              eq(users.tenantId, localSeedIds.organization),
              eq(users.id, localSeedIds.ownerUser),
            ),
          ),
      }),
    );

    expect(seeded.users[0]?.value).toBe(1);
    expect(seeded.roles[0]?.value).toBe(4);
    expect(seeded.audits[0]?.value).toBe(1);
  });
});

async function createTenant(
  database: Database,
  tenantId: string,
  displayName: string,
  userId: string,
  roleId?: string,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction
      .insert(organizations)
      .values({ id: tenantId, displayName, legalName: displayName });
    await transaction.insert(users).values({
      id: userId,
      tenantId,
      email: `${userId}@example.test`,
      displayName: `${displayName} User`,
    });

    if (roleId) {
      await transaction
        .insert(roles)
        .values({ id: roleId, tenantId, code: "test-role", name: "Test Role" });
    }
  });
}
