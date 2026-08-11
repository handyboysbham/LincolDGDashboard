import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { and, count, eq } from "drizzle-orm";
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accountContacts,
  allocateBusinessNumber,
  assetReservations,
  assets,
  auditEvents,
  claimOutboxEvents,
  claimScheduledJobs,
  contacts,
  createDatabase,
  createDatabasePool,
  customerCreditApplications,
  customerCredits,
  customerAccounts,
  depositApplications,
  depositBalances,
  disposalLoads,
  documentPublicLinks,
  documents,
  dumpTrailerRentalDetails,
  estimateVersions,
  estimates,
  expenseAllocations,
  expenses,
  executeIdempotent,
  IdempotencyConflictError,
  invoiceLineItems,
  invoices,
  invoiceVersions,
  jobCharges,
  jobs,
  localSeedIds,
  leads,
  materialDeliveryDetails,
  materialLoadAssets,
  materialLoadItems,
  materialLoadValidations,
  materialLoads,
  materialQuantityVariances,
  materialSubstitutions,
  materials,
  organizations,
  outboxEvents,
  paymentAllocations,
  payments,
  pricingPolicies,
  pricingVersions,
  projects,
  quoteLineItems,
  quoteVersions,
  quotes,
  refunds,
  rentalDebrisReviews,
  rentalExtensions,
  rentalInspections,
  rentalPickupAttempts,
  roles,
  routeStops,
  runMigrations,
  scheduledJobs,
  scheduleBlocks,
  serviceLocations,
  supplierLocations,
  suppliers,
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

function databaseErrorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined
    ? error.message
    : `${error.message}\n${databaseErrorText(error.cause)}`;
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(databaseErrorText(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected database failure containing: ${expectedMessage}`);
}

describe("Sprint 1.0.0 platform data foundation", () => {
  const databaseName = `ldg_test_${randomUUID().replaceAll("-", "")}`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const roleA = randomUUID();
  const materialFixture = createMaterialFixtureIds();
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
    await createMaterialDeliveryFixture(migratorDatabase(), tenantA, userA, materialFixture);
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
        "customer_credit_applications",
        "customer_credits",
        "customer_accounts",
        "delivery_zones",
        "deposit_applications",
        "deposit_balances",
        "disposal_loads",
        "document_links",
        "document_public_links",
        "documents",
        "dump_trailer_rental_details",
        "idempotency_keys",
        "estimate_cost_items",
        "estimate_versions",
        "estimates",
        "expense_allocations",
        "expenses",
        "lead_notes",
        "lead_tasks",
        "leads",
        "location_contacts",
        "job_assignments",
        "job_charges",
        "job_events",
        "jobs",
        "invoice_adjustments",
        "invoice_deliveries",
        "invoice_line_items",
        "invoice_public_links",
        "invoice_versions",
        "invoices",
        "material_delivery_details",
        "material_load_assets",
        "material_load_items",
        "material_load_validations",
        "material_loads",
        "material_quantity_variances",
        "material_substitutions",
        "notification_deliveries",
        "notification_delivery_attempts",
        "notification_preferences",
        "notification_templates",
        "number_sequences",
        "organizations",
        "operational_holds",
        "outbox_events",
        "payment_allocations",
        "payments",
        "materials",
        "pricing_calculation_results",
        "pricing_policies",
        "pricing_rule_tiers",
        "pricing_rules",
        "pricing_versions",
        "project_public_link_views",
        "project_public_links",
        "projects",
        "quote_acceptances",
        "quote_deliveries",
        "quote_line_items",
        "quote_public_links",
        "quote_terms",
        "quote_versions",
        "quotes",
        "readiness_evaluations",
        "refunds",
        "rental_debris_reviews",
        "rental_extensions",
        "rental_inspections",
        "rental_pickup_attempts",
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

  it("forces RLS on every implemented operations tenant table", async () => {
    const tenantTables = [
      "asset_assignments",
      "asset_reservations",
      "assets",
      "checklist_instances",
      "checklist_items",
      "contract_public_links",
      "contract_signatures",
      "contracts",
      "customer_credit_applications",
      "customer_credits",
      "deposit_applications",
      "deposit_balances",
      "disposal_loads",
      "dump_trailer_rental_details",
      "expense_allocations",
      "expenses",
      "job_assignments",
      "job_charges",
      "job_events",
      "jobs",
      "invoice_adjustments",
      "invoice_deliveries",
      "invoice_line_items",
      "invoice_public_links",
      "invoice_versions",
      "invoices",
      "material_delivery_details",
      "material_load_assets",
      "material_load_items",
      "material_load_validations",
      "material_loads",
      "material_quantity_variances",
      "material_substitutions",
      "notification_deliveries",
      "notification_delivery_attempts",
      "notification_preferences",
      "notification_templates",
      "operational_holds",
      "payment_allocations",
      "payments",
      "project_public_link_views",
      "project_public_links",
      "readiness_evaluations",
      "refunds",
      "rental_debris_reviews",
      "rental_extensions",
      "rental_inspections",
      "rental_pickup_attempts",
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

  it("preserves posted obligations and serializes Payment, Deposit, Credit, and Refund value", async () => {
    const createPostedInvoice = async (
      invoiceNumber: string,
      invoiceType: "deposit" | "final",
      totalCents: number,
    ) => {
      const invoiceId = randomUUID();
      const invoiceVersionId = randomUUID();
      const lineItemId = randomUUID();
      await withTenantTransaction(runtime(), tenantA, async (transaction) => {
        await transaction.insert(invoices).values({
          customerAccountId: materialFixture.customerId,
          id: invoiceId,
          invoiceNumber,
          invoiceType,
          jobId: materialFixture.materialJobId,
          projectId: materialFixture.projectId,
          tenantId: tenantA,
        });
        await transaction.insert(invoiceVersions).values({
          amountDueCents: totalCents,
          billingIdentitySnapshot: { customer: "Material Delivery Fixture" },
          calculationSnapshot: { totalCents },
          contentHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          id: invoiceVersionId,
          invoiceId,
          preparedBy: userA,
          subtotalCents: totalCents,
          tenantId: tenantA,
          totalCents,
          versionNumber: 1,
        });
        await transaction.insert(invoiceLineItems).values({
          acceptedQuoteLineItemId: materialFixture.gravelQuoteLineId,
          description: invoiceType === "deposit" ? "Required advance payment" : "Accepted service",
          id: lineItemId,
          invoiceId,
          invoiceVersionId,
          lineType: "accepted_quote",
          sequence: 1,
          sourceId: materialFixture.gravelQuoteLineId,
          sourceSnapshot: { acceptedQuoteVersionId: materialFixture.quoteVersionId },
          sourceType: "accepted_quote_line",
          subtotalCents: totalCents,
          tenantId: tenantA,
          totalCents,
        });
        const postedAt = new Date();
        await transaction
          .update(invoiceVersions)
          .set({ postedAt, postedBy: userA, status: "posted" })
          .where(eq(invoiceVersions.id, invoiceVersionId));
        await transaction
          .update(invoices)
          .set({
            dueDate: "2026-08-14",
            issueDate: "2026-08-04",
            postedAt,
            status: "posted",
          })
          .where(eq(invoices.id, invoiceId));
      });
      return { invoiceId, invoiceVersionId, lineItemId };
    };

    const depositInvoice = await createPostedInvoice("INV-2026-00001", "deposit", 18_500);
    const finalInvoice = await createPostedInvoice("INV-2026-00002", "final", 42_000);

    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction
          .update(invoiceVersions)
          .set({ totalCents: 42_001 })
          .where(eq(invoiceVersions.id, finalInvoice.invoiceVersionId)),
      ),
      "Posted Invoice Versions are immutable",
    );
    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction
          .update(invoiceLineItems)
          .set({ description: "Mutated posted line" })
          .where(eq(invoiceLineItems.id, finalInvoice.lineItemId)),
      ),
      "Posted Invoice Line Items are immutable",
    );

    const paymentId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(payments).values({
        amountCents: 18_500,
        customerAccountId: materialFixture.customerId,
        id: paymentId,
        payerSnapshot: { displayName: "Material Delivery Fixture" },
        paymentMethod: "zelle",
        paymentNumber: "PAY-2026-00001",
        projectId: materialFixture.projectId,
        receivedAt: new Date(),
        receivingAccountReference: "company-zelle-primary",
        settledAt: new Date(),
        status: "settled",
        tenantId: tenantA,
        verifiedAt: new Date(),
        verifiedBy: userA,
      }),
    );

    const paymentAllocationId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(paymentAllocations).values({
        allocationKey: "deposit-payment-application",
        amountCents: 18_500,
        appliedBy: userA,
        customerAccountId: materialFixture.customerId,
        id: paymentAllocationId,
        invoiceId: depositInvoice.invoiceId,
        paymentId,
        tenantId: tenantA,
      }),
    );
    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction
          .update(paymentAllocations)
          .set({ amountCents: 18_499 })
          .where(eq(paymentAllocations.id, paymentAllocationId)),
      ),
      "payment_allocations entries are append-only",
    );

    const depositBalanceId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(depositBalances).values({
        customerAccountId: materialFixture.customerId,
        depositType: "advance_payment",
        id: depositBalanceId,
        originalAmountCents: 18_500,
        projectId: materialFixture.projectId,
        sourcePaymentAllocationId: paymentAllocationId,
        tenantId: tenantA,
      }),
    );
    const depositApplicationId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(depositApplications).values({
        amountCents: 18_500,
        applicationKey: "final-invoice-deposit-application",
        appliedBy: userA,
        customerAccountId: materialFixture.customerId,
        depositBalanceId,
        id: depositApplicationId,
        invoiceId: finalInvoice.invoiceId,
        projectId: materialFixture.projectId,
        tenantId: tenantA,
      }),
    );
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(depositApplications).values({
          amountCents: 1,
          applicationKey: "duplicate-final-invoice-deposit-application",
          appliedBy: userA,
          customerAccountId: materialFixture.customerId,
          depositBalanceId,
          invoiceId: finalInvoice.invoiceId,
          projectId: materialFixture.projectId,
          tenantId: tenantA,
        }),
      ),
      "Deposit Application exceeds available Deposit amount",
    );

    const customerCreditId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(customerCredits).values({
        creditNumber: "CRD-2026-00001",
        customerAccountId: materialFixture.customerId,
        description: "Approved customer accommodation",
        id: customerCreditId,
        originalAmountCents: 1_000,
        projectId: materialFixture.projectId,
        sourceId: randomUUID(),
        sourceType: "manual",
        tenantId: tenantA,
      }),
    );
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(customerCreditApplications).values({
        amountCents: 400,
        applicationKey: "final-invoice-credit-application",
        appliedBy: userA,
        customerAccountId: materialFixture.customerId,
        customerCreditId,
        invoiceId: finalInvoice.invoiceId,
        tenantId: tenantA,
      }),
    );

    const concurrencyCreditId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(customerCredits).values({
        creditNumber: "CRD-2026-00002",
        customerAccountId: materialFixture.customerId,
        description: "Concurrency guard fixture",
        id: concurrencyCreditId,
        originalAmountCents: 1_000,
        projectId: materialFixture.projectId,
        sourceId: randomUUID(),
        sourceType: "manual",
        tenantId: tenantA,
      }),
    );
    const concurrentCreditApplications = await Promise.allSettled([
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(customerCreditApplications).values({
          amountCents: 700,
          applicationKey: "concurrent-credit-application-a",
          appliedBy: userA,
          customerAccountId: materialFixture.customerId,
          customerCreditId: concurrencyCreditId,
          invoiceId: finalInvoice.invoiceId,
          tenantId: tenantA,
        }),
      ),
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(customerCreditApplications).values({
          amountCents: 700,
          applicationKey: "concurrent-credit-application-b",
          appliedBy: userA,
          customerAccountId: materialFixture.customerId,
          customerCreditId: concurrencyCreditId,
          invoiceId: finalInvoice.invoiceId,
          tenantId: tenantA,
        }),
      ),
    ]);
    expect(
      concurrentCreditApplications.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrentCreditApplications.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const refundId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(refunds).values({
        amountCents: 600,
        approvedAt: new Date(),
        approvedBy: userA,
        currency: "USD",
        customerAccountId: materialFixture.customerId,
        customerCreditId,
        id: refundId,
        originalMethod: "check",
        payeeSnapshot: { displayName: "Material Delivery Fixture" },
        processedAt: new Date(),
        projectId: materialFixture.projectId,
        reason: "Return unused customer credit",
        refundMethod: "check",
        refundNumber: "REF-2026-00001",
        settledAt: new Date(),
        sourceType: "customer_credit",
        status: "settled",
        tenantId: tenantA,
      }),
    );
    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction.update(refunds).set({ reason: "Changed" }).where(eq(refunds.id, refundId)),
      ),
      "Settled Refunds are immutable",
    );

    const refundReversalId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(refunds).values({
        alternateMethodReason: null,
        amountCents: 600,
        approvedAt: new Date(),
        approvedBy: userA,
        currency: "USD",
        customerAccountId: materialFixture.customerId,
        customerCreditId,
        id: refundReversalId,
        originalMethod: "check",
        payeeSnapshot: { displayName: "Material Delivery Fixture" },
        projectId: materialFixture.projectId,
        reason: "Provider returned the settled Refund",
        refundMethod: "check",
        refundNumber: "REF-2026-00002",
        reversesRefundId: refundId,
        sourceType: "customer_credit",
        status: "reversed",
        tenantId: tenantA,
      }),
    );
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(refunds).values({
          amountCents: 599,
          approvedAt: new Date(),
          approvedBy: userA,
          currency: "USD",
          customerAccountId: materialFixture.customerId,
          customerCreditId,
          originalMethod: "check",
          payeeSnapshot: { displayName: "Material Delivery Fixture" },
          projectId: materialFixture.projectId,
          reason: "Invalid non-exact reversal",
          refundMethod: "check",
          refundNumber: "REF-2026-INVALID",
          reversesRefundId: randomUUID(),
          sourceType: "customer_credit",
          status: "reversed",
          tenantId: tenantA,
        }),
      ),
      "Refund reversal must exactly match one settled Refund",
    );
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(customerCreditApplications).values({
        amountCents: 600,
        applicationKey: "post-refund-reversal-credit-application",
        appliedBy: userA,
        customerAccountId: materialFixture.customerId,
        customerCreditId,
        invoiceId: finalInvoice.invoiceId,
        tenantId: tenantA,
      }),
    );

    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(refunds).values({
        alternateMethodReason: "Customer closed the original account",
        amountCents: 100,
        currency: "USD",
        customerAccountId: materialFixture.customerId,
        customerCreditId: concurrencyCreditId,
        originalMethod: "zelle",
        payeeSnapshot: { displayName: "Material Delivery Fixture" },
        projectId: materialFixture.projectId,
        reason: "Return remaining accommodation value",
        refundMethod: "check",
        refundNumber: "REF-2026-00003",
        sourceType: "customer_credit",
        status: "review_required",
        tenantId: tenantA,
      }),
    );

    const tenantBInvoices = await withTenantTransaction(runtime(), tenantB, (transaction) =>
      transaction.select().from(invoices),
    );
    expect(tenantBInvoices).toEqual([]);
    await expect(
      withTenantTransaction(runtime(), tenantB, (transaction) =>
        transaction.insert(invoices).values({
          customerAccountId: materialFixture.customerId,
          invoiceNumber: "INV-CROSS-TENANT",
          invoiceType: "final",
          projectId: materialFixture.projectId,
          tenantId: tenantB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("enforces Material Delivery service, tenant, same-Job, stop, and closed-Job boundaries", async () => {
    const visibleToTenantA = await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction
        .select()
        .from(materialDeliveryDetails)
        .where(eq(materialDeliveryDetails.id, materialFixture.detailId)),
    );
    const visibleToTenantB = await withTenantTransaction(runtime(), tenantB, (transaction) =>
      transaction
        .select()
        .from(materialDeliveryDetails)
        .where(eq(materialDeliveryDetails.id, materialFixture.detailId)),
    );
    expect(visibleToTenantA).toHaveLength(1);
    expect(visibleToTenantB).toEqual([]);

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialDeliveryDetails).values({
          jobId: materialFixture.rentalJobId,
          tenantId: tenantA,
        }),
      ),
      "Material Delivery Detail requires a Material Delivery Job",
    );

    await expect(
      withTenantTransaction(runtime(), tenantB, (transaction) =>
        transaction.insert(materialDeliveryDetails).values({
          jobId: materialFixture.materialJobId,
          tenantId: tenantB,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialLoadItems).values({
          jobId: materialFixture.rentalJobId,
          loadingSequence: 3,
          materialId: materialFixture.gravelId,
          materialLoadId: materialFixture.loadId,
          plannedQuantity: "1.000",
          quantityUnit: "cubic_yards",
          sequence: 3,
          tenantId: tenantA,
          unloadingSequence: 3,
        }),
      ),
    ).rejects.toThrow();

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialLoadItems).values({
          jobId: materialFixture.materialJobId,
          loadingSequence: 3,
          materialId: materialFixture.gravelId,
          materialLoadId: materialFixture.loadId,
          plannedQuantity: "1.000",
          quantityUnit: "cubic_yards",
          sequence: 3,
          supplierRouteStopId: materialFixture.placementStopId,
          tenantId: tenantA,
          unloadingSequence: 3,
        }),
      ),
      "supplier stop must be a supplier Route Stop",
    );

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction
          .update(materialDeliveryDetails)
          .set({ completionSummary: "Blocked edit" })
          .where(eq(materialDeliveryDetails.id, materialFixture.closedDetailId)),
      ),
      "closed Job child records reject ordinary edits",
    );

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.delete(materialLoads).where(eq(materialLoads.id, materialFixture.loadId)),
      ),
      "accepted Material Delivery records cannot be deleted",
    );
  });

  it("enforces Dump Trailer Rental service, extension, weight, history, and tenant boundaries", async () => {
    const rentalDetailId = randomUUID();
    const pickupBlockId = randomUUID();
    const occupancyReservationId = randomUUID();
    const extensionId = randomUUID();
    const disposalLoadId = randomUUID();
    const disposalSupplierId = randomUUID();
    const disposalLocationId = randomUUID();
    const disposalExpenseId = randomUUID();
    const plannedDropoffAt = new Date("2026-08-14T14:00:00.000Z");
    const plannedPickupAt = new Date("2026-08-17T14:00:00.000Z");
    const extendedPickupAt = new Date("2026-08-18T14:00:00.000Z");
    const retrievedAt = new Date("2026-08-18T16:00:00.000Z");
    const releasedAt = new Date("2026-08-18T19:00:00.000Z");

    await withTenantTransaction(runtime(), tenantA, async (transaction) => {
      await transaction.insert(dumpTrailerRentalDetails).values({
        acceptedQuoteVersionId: materialFixture.quoteVersionId,
        acceptedTermsHash: "d".repeat(64),
        acceptedTermsSnapshot: {
          additionalDayRateCents: 5_000,
          includedDays: 3,
          includedWeightPounds: "2000.000",
          overageRateCentsPerPound: 8,
        },
        actualDropoffAt: new Date("2026-08-14T15:00:00.000Z"),
        additionalDayRateCents: 5_000,
        depositAmountCents: 15_000,
        depositClassification: "refundable_security",
        id: rentalDetailId,
        includedDays: 3,
        includedWeightPounds: "2000.000",
        jobId: materialFixture.rentalJobId,
        onRentAt: new Date("2026-08-14T15:15:00.000Z"),
        overageRateCentsPerPound: 8,
        plannedDropoffAt,
        plannedPickupAt,
        rateType: "weekend",
        status: "on_rent",
        tenantId: tenantA,
        trailerAssetId: materialFixture.assetId,
        trailerSnapshot: { assetNumber: `TRL-${materialFixture.assetId}` },
      });
      await transaction.insert(rentalDebrisReviews).values({
        accessStatus: "pass",
        customerAttestation: "No prohibited material is present",
        customerAttested: true,
        customerAttestedAt: new Date(),
        jobId: materialFixture.rentalJobId,
        legalTowingStatus: "pass",
        outcomeNotes: "Approved for normal construction debris",
        primaryDebrisType: "construction_debris",
        rentalDetailId,
        reviewNumber: 1,
        reviewedAt: new Date(),
        reviewedBy: userA,
        status: "approved",
        tenantId: tenantA,
      });
      await transaction.insert(scheduleBlocks).values({
        blockType: "pickup",
        endsAt: new Date("2026-08-17T16:00:00.000Z"),
        id: pickupBlockId,
        jobId: materialFixture.rentalJobId,
        startsAt: plannedPickupAt,
        status: "confirmed",
        tenantId: tenantA,
      });
      await transaction.insert(assetReservations).values({
        assetId: materialFixture.assetId,
        endsAt: plannedPickupAt,
        id: occupancyReservationId,
        jobId: materialFixture.rentalJobId,
        reservationType: "occupancy",
        startsAt: plannedDropoffAt,
        status: "active",
        tenantId: tenantA,
      });
      await transaction.insert(rentalExtensions).values({
        additionalDays: 1,
        calculatedAmountCents: 5_000,
        dedupeKey: "weekend-extension-2026-08-18",
        extensionNumber: 1,
        id: extensionId,
        jobId: materialFixture.rentalJobId,
        occupancyReservationId,
        pickupScheduleBlockId: pickupBlockId,
        previousPickupAt: plannedPickupAt,
        rateCents: 5_000,
        rentalDetailId,
        requestedBy: userA,
        requestedPickupAt: extendedPickupAt,
        tenantId: tenantA,
      });
    });

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction
          .update(rentalExtensions)
          .set({
            availabilitySnapshot: { conflictAssetId: materialFixture.assetId },
            conflictStatus: "fail",
            customerAuthorizationStatus: "authorized",
            decidedAt: new Date(),
            decidedBy: userA,
            decisionReason: "Conflict cannot be overridden",
            status: "approved",
          })
          .where(eq(rentalExtensions.id, extensionId)),
      ),
      "rental_extensions_approval_check",
    );

    await withTenantTransaction(runtime(), tenantA, async (transaction) => {
      await transaction
        .update(rentalExtensions)
        .set({
          availabilitySnapshot: { checkedThrough: extendedPickupAt.toISOString(), conflicts: [] },
          conflictStatus: "pass",
          customerAuthorizationStatus: "authorized",
          decidedAt: new Date(),
          decidedBy: userA,
          decisionReason: "Trailer remains available",
          status: "approved",
        })
        .where(eq(rentalExtensions.id, extensionId));
      await transaction.insert(rentalPickupAttempts).values([
        {
          attemptedAt: new Date("2026-08-18T14:00:00.000Z"),
          attemptedBy: userA,
          attemptNumber: 1,
          completedAt: new Date("2026-08-18T14:15:00.000Z"),
          failureReason: "Customer access was blocked",
          id: randomUUID(),
          jobId: materialFixture.rentalJobId,
          rentalDetailId,
          scheduleBlockId: pickupBlockId,
          status: "failed",
          tenantId: tenantA,
          trailerAssetId: materialFixture.assetId,
        },
        {
          accessStatus: "pass",
          attemptedAt: new Date("2026-08-18T15:30:00.000Z"),
          attemptedBy: userA,
          attemptNumber: 2,
          completedAt: retrievedAt,
          customerCustodyEndedAt: retrievedAt,
          id: randomUUID(),
          jobId: materialFixture.rentalJobId,
          rentalDetailId,
          safeLoadStatus: "pass",
          scheduleBlockId: pickupBlockId,
          status: "retrieved",
          tenantId: tenantA,
          trailerAssetId: materialFixture.assetId,
        },
      ]);
      await transaction.insert(suppliers).values({
        id: disposalSupplierId,
        name: "Disposal Facility Fixture",
        normalizedName: `disposal facility ${disposalSupplierId}`,
        tenantId: tenantA,
      });
      await transaction.insert(supplierLocations).values({
        addressSummary: "1800 Disposal Road",
        id: disposalLocationId,
        label: "Scale house",
        supplierId: disposalSupplierId,
        tenantId: tenantA,
      });
      await transaction.insert(expenses).values({
        amountCents: 1_000,
        approvedAt: new Date(),
        approvedBy: userA,
        description: "Rental disposal fee",
        expenseNumber: `EXP-${disposalExpenseId}`,
        expenseType: "disposal",
        id: disposalExpenseId,
        incurredAt: new Date(),
        jobId: materialFixture.rentalJobId,
        receiptDocumentId: materialFixture.receiptDocumentId,
        receiptStatus: "attached",
        status: "approved",
        supplierId: disposalSupplierId,
        supplierLocationId: disposalLocationId,
        tenantId: tenantA,
      });
    });

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(disposalLoads).values({
          canonicalNetWeightPounds: "0.000",
          debrisClassification: "construction_debris",
          grossWeight: "100.000",
          jobId: materialFixture.rentalJobId,
          netWeight: "0.000",
          rentalDetailId,
          sequence: 2,
          tareWeight: "200.000",
          tenantId: tenantA,
          weightStatus: "recorded",
        }),
      ),
    ).rejects.toThrow();

    await withTenantTransaction(runtime(), tenantA, async (transaction) => {
      await transaction.insert(disposalLoads).values({
        acceptanceResult: "accepted",
        actualFacilityLocationId: disposalLocationId,
        canonicalNetWeightPounds: "2680.000",
        debrisClassification: "construction_debris",
        disposalFeeCents: 1_000,
        emptyTrailerDocumentId: materialFixture.receiptDocumentId,
        emptyTrailerStatus: "confirmed_empty",
        expenseId: disposalExpenseId,
        grossWeight: "15620.000",
        id: disposalLoadId,
        jobId: materialFixture.rentalJobId,
        netWeight: "2680.000",
        receiptDocumentId: materialFixture.receiptDocumentId,
        receiptStatus: "attached",
        reconciledAt: new Date(),
        reconciledBy: userA,
        remainingMaterialStatus: "none",
        rentalDetailId,
        sequence: 1,
        status: "reconciled",
        tareWeight: "12940.000",
        tenantId: tenantA,
        ticketDocumentId: materialFixture.receiptDocumentId,
        ticketStatus: "attached",
        unloadingResult: "unloaded",
        weightStatus: "recorded",
      });
      await transaction.insert(rentalInspections).values({
        completedAt: releasedAt,
        conditionResult: "acceptable",
        evidenceDocumentId: materialFixture.receiptDocumentId,
        evidenceSnapshot: { result: "no_damage" },
        inspectedAt: releasedAt,
        inspectedBy: userA,
        inspectionNumber: 1,
        inspectionType: "post_rental",
        jobId: materialFixture.rentalJobId,
        notes: "No damage and normal cleaning",
        releaseDecision: "release",
        rentalDetailId,
        safeToRelease: true,
        status: "completed",
        tenantId: tenantA,
        trailerAssetId: materialFixture.assetId,
      });
      await transaction
        .update(assetReservations)
        .set({ releasedAt, status: "released" })
        .where(eq(assetReservations.id, occupancyReservationId));
      await transaction
        .update(dumpTrailerRentalDetails)
        .set({
          actualPickupAt: retrievedAt,
          customerCustodyEndedAt: retrievedAt,
          emptyTrailerStatus: "confirmed_empty",
          finalCondition: "acceptable",
          invoiceReadiness: "ready",
          occupancyReleasedAt: releasedAt,
          operationallyCompletedAt: releasedAt,
          overageWeightPounds: "680.000",
          status: "operationally_complete",
          totalActualWeightPounds: "2680.000",
        })
        .where(eq(dumpTrailerRentalDetails.id, rentalDetailId));
    });

    const tenantARentals = await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction
        .select()
        .from(dumpTrailerRentalDetails)
        .where(eq(dumpTrailerRentalDetails.id, rentalDetailId)),
    );
    const tenantBRentals = await withTenantTransaction(runtime(), tenantB, (transaction) =>
      transaction
        .select()
        .from(dumpTrailerRentalDetails)
        .where(eq(dumpTrailerRentalDetails.id, rentalDetailId)),
    );
    expect(tenantARentals).toMatchObject([
      {
        overageWeightPounds: "680.000",
        status: "operationally_complete",
        totalActualWeightPounds: "2680.000",
      },
    ]);
    expect(tenantBRentals).toEqual([]);

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction
          .update(rentalExtensions)
          .set({ decisionReason: "Attempted rewrite" })
          .where(eq(rentalExtensions.id, extensionId)),
      ),
      "decided Rental Extensions are immutable",
    );
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.delete(disposalLoads).where(eq(disposalLoads.id, disposalLoadId)),
      ),
      "accepted Dump Trailer Rental records cannot be deleted",
    );
    await expect(
      withTenantTransaction(runtime(), tenantB, (transaction) =>
        transaction.insert(dumpTrailerRentalDetails).values({
          acceptedQuoteVersionId: materialFixture.quoteVersionId,
          acceptedTermsHash: "e".repeat(64),
          acceptedTermsSnapshot: {},
          additionalDayRateCents: 5_000,
          includedDays: 3,
          includedWeightPounds: "2000.000",
          jobId: materialFixture.rentalJobId,
          overageRateCentsPerPound: 8,
          plannedDropoffAt,
          plannedPickupAt,
          rateType: "weekend",
          tenantId: tenantB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps safety evaluations append-only and makes failed safety non-overridable", async () => {
    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialLoadValidations).values({
          blockers: ["Payload exceeds 10,000 pounds"],
          capacityResult: "fail",
          compatibilityResult: "pass",
          evaluatedBy: userA,
          inputHash: "1".repeat(64),
          inputSnapshot: { actualWeightPounds: "11000.000" },
          jobId: materialFixture.materialJobId,
          materialLoadId: materialFixture.loadId,
          result: "ready",
          separationResult: "pass",
          tenantId: tenantA,
          validationType: "dispatch",
        }),
      ),
    ).rejects.toThrow();

    const validationId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(materialLoadValidations).values({
        blockers: ["Payload exceeds 10,000 pounds"],
        capacityResult: "fail",
        compatibilityResult: "pass",
        evaluatedBy: userA,
        id: validationId,
        inputHash: "2".repeat(64),
        inputSnapshot: { actualWeightPounds: "11000.000" },
        jobId: materialFixture.materialJobId,
        materialLoadId: materialFixture.loadId,
        result: "not_ready",
        separationResult: "pass",
        tenantId: tenantA,
        validationType: "dispatch",
      }),
    );

    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction
          .update(materialLoadValidations)
          .set({ result: "ready" })
          .where(eq(materialLoadValidations.id, validationId)),
      ),
      "Material Load Validations are immutable",
    );
    await expectDatabaseFailure(
      withTenantTransaction(migratorDatabase(), tenantA, (transaction) =>
        transaction
          .delete(materialLoadValidations)
          .where(eq(materialLoadValidations.id, validationId)),
      ),
      "Material Load Validations are immutable",
    );
  });

  it("serializes Expense Allocations, requires exact approval, and preserves financial history", async () => {
    const expenseId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(expenses).values({
        amountCents: 18_400,
        description: "Gravel and sand supplier purchase",
        expenseNumber: "EXP-2026-00001",
        expenseType: "material_purchase",
        id: expenseId,
        incurredAt: new Date(),
        jobId: materialFixture.materialJobId,
        receiptDocumentId: materialFixture.receiptDocumentId,
        receiptStatus: "attached",
        tenantId: tenantA,
      }),
    );

    const concurrentAllocations = await Promise.allSettled([
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(expenseAllocations).values({
          amountCents: 12_000,
          expenseId,
          jobId: materialFixture.materialJobId,
          materialLoadItemId: materialFixture.gravelItemId,
          tenantId: tenantA,
        }),
      ),
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(expenseAllocations).values({
          amountCents: 9_000,
          expenseId,
          jobId: materialFixture.materialJobId,
          materialLoadItemId: materialFixture.sandItemId,
          tenantId: tenantA,
        }),
      ),
    ]);
    expect(concurrentAllocations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentAllocations.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [activeAllocation] = await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction
        .select()
        .from(expenseAllocations)
        .where(eq(expenseAllocations.expenseId, expenseId)),
    );
    expect(activeAllocation).toBeDefined();
    if (!activeAllocation) throw new Error("Concurrent Expense Allocation was not stored");
    const remainingItemId =
      activeAllocation.materialLoadItemId === materialFixture.gravelItemId
        ? materialFixture.sandItemId
        : materialFixture.gravelItemId;
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(expenseAllocations).values({
        amountCents: 18_400 - activeAllocation.amountCents,
        expenseId,
        jobId: materialFixture.materialJobId,
        materialLoadItemId: remainingItemId,
        tenantId: tenantA,
      }),
    );

    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction
        .update(expenses)
        .set({ approvedAt: new Date(), approvedBy: userA, status: "approved" })
        .where(eq(expenses.id, expenseId)),
    );

    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.update(expenses).set({ amountCents: 18_401 }).where(eq(expenses.id, expenseId)),
      ),
      "approved Expense facts are immutable",
    );
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.delete(expenses).where(eq(expenses.id, expenseId)),
      ),
      "Expenses cannot be deleted",
    );
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction
          .delete(expenseAllocations)
          .where(eq(expenseAllocations.id, activeAllocation.id)),
      ),
      "Expense Allocations cannot be deleted",
    );
  });

  it("prevents duplicate operational charges and open material resolutions", async () => {
    const chargeId = randomUUID();
    await withTenantTransaction(runtime(), tenantA, (transaction) =>
      transaction.insert(jobCharges).values({
        chargeNumber: "CHG-2026-00001",
        chargeType: "quantity_variance",
        customerDescription: "Additional delivered material review",
        dedupeKey: `delivery-variance:${materialFixture.gravelItemId}`,
        id: chargeId,
        jobId: materialFixture.materialJobId,
        occurredAt: new Date(),
        sourceId: materialFixture.gravelItemId,
        sourceType: "material_load_item",
        tenantId: tenantA,
      }),
    );
    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(jobCharges).values({
          chargeNumber: "CHG-2026-00002",
          chargeType: "quantity_variance",
          customerDescription: "Duplicate operational fact",
          dedupeKey: `delivery-variance:${materialFixture.gravelItemId}`,
          jobId: materialFixture.materialJobId,
          occurredAt: new Date(),
          sourceId: materialFixture.gravelItemId,
          sourceType: "material_load_item",
          tenantId: tenantA,
        }),
      ),
    ).rejects.toThrow();
    await expectDatabaseFailure(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.delete(jobCharges).where(eq(jobCharges.id, chargeId)),
      ),
      "Job Charges cannot be deleted",
    );

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialSubstitutions).values({
          jobId: materialFixture.materialJobId,
          materialLoadItemId: materialFixture.gravelItemId,
          originalMaterialId: materialFixture.gravelId,
          reason: "Invalid self-substitution",
          replacementMaterialId: materialFixture.gravelId,
          requestedBy: userA,
          tenantId: tenantA,
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantTransaction(runtime(), tenantA, (transaction) =>
        transaction.insert(materialQuantityVariances).values({
          actualQuantity: "3.500",
          expectedQuantity: "4.000",
          jobId: materialFixture.materialJobId,
          materialLoadItemId: materialFixture.gravelItemId,
          quantityUnit: "cubic_yards",
          tenantId: tenantA,
          varianceQuantity: "0.500",
          varianceType: "delivery",
        }),
      ),
    ).rejects.toThrow();
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

  it("reconciles least-privilege runtime access without exposing migration history", async () => {
    const privilegeResult = await migratorPool().query<{
      can_delete_finance: boolean;
      can_delete_job: boolean;
      can_execute_tenant_context: boolean;
      can_read_migration_history: boolean;
      can_select_organization: boolean;
      can_update_audit_event: boolean;
    }>(
      `
        select
          has_function_privilege($1, 'public.set_tenant_context(uuid)', 'EXECUTE')
            as can_execute_tenant_context,
          has_table_privilege($1, 'public.organizations', 'SELECT')
            as can_select_organization,
          has_table_privilege($1, 'public.jobs', 'DELETE') as can_delete_job,
          has_table_privilege($1, 'public.payments', 'DELETE') as can_delete_finance,
          has_table_privilege($1, 'public.audit_events', 'UPDATE') as can_update_audit_event,
          has_table_privilege($1, 'public.__drizzle_migrations', 'SELECT')
            as can_read_migration_history
      `,
      [environment("POSTGRES_RUNTIME_USER")],
    );

    expect(privilegeResult.rows[0]).toEqual({
      can_delete_finance: false,
      can_delete_job: true,
      can_execute_tenant_context: true,
      can_read_migration_history: false,
      can_select_organization: true,
      can_update_audit_event: false,
    });
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

function createMaterialFixtureIds() {
  return {
    assetId: randomUUID(),
    closedDetailId: randomUUID(),
    closedJobId: randomUUID(),
    closedLoadId: randomUUID(),
    contactId: randomUUID(),
    customerId: randomUUID(),
    detailId: randomUUID(),
    estimateId: randomUUID(),
    estimateVersionId: randomUUID(),
    gravelId: randomUUID(),
    gravelItemId: randomUUID(),
    gravelQuoteLineId: randomUUID(),
    leadId: randomUUID(),
    loadAssetId: randomUUID(),
    loadId: randomUUID(),
    locationId: randomUUID(),
    materialJobId: randomUUID(),
    placementStopId: randomUUID(),
    pricingPolicyId: randomUUID(),
    pricingVersionId: randomUUID(),
    projectId: randomUUID(),
    quoteId: randomUUID(),
    quoteVersionId: randomUUID(),
    receiptDocumentId: randomUUID(),
    rentalJobId: randomUUID(),
    sandId: randomUUID(),
    sandItemId: randomUUID(),
    sandQuoteLineId: randomUUID(),
    supplierStopId: randomUUID(),
  };
}

async function createMaterialDeliveryFixture(
  database: Database,
  tenantId: string,
  userId: string,
  fixture: ReturnType<typeof createMaterialFixtureIds>,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(customerAccounts).values({
      customerType: "individual",
      displayName: "Material Delivery Fixture",
      id: fixture.customerId,
      normalizedName: `material delivery fixture ${fixture.customerId}`,
      ownerUserId: userId,
      tenantId,
    });
    await transaction.insert(contacts).values({
      displayName: "Material Fixture Contact",
      email: `material-${fixture.contactId}@example.test`,
      firstName: "Material",
      id: fixture.contactId,
      lastName: "Fixture",
      normalizedEmail: `material-${fixture.contactId}@example.test`,
      preferredContactMethod: "email",
      tenantId,
    });
    await transaction.insert(accountContacts).values({
      contactId: fixture.contactId,
      customerAccountId: fixture.customerId,
      isPrimary: true,
      tenantId,
    });
    await transaction.insert(serviceLocations).values({
      addressLine1: "1600 Material Way",
      city: "Lincoln",
      customerAccountId: fixture.customerId,
      id: fixture.locationId,
      label: "Delivery site",
      normalizedAddress: `1600 material way lincoln ne 68502 ${fixture.locationId}`,
      postalCode: "68502",
      region: "NE",
      tenantId,
    });
    await transaction.insert(leads).values({
      customerAccountId: fixture.customerId,
      estimatedQuantity: "6.000",
      id: fixture.leadId,
      leadNumber: `L-${fixture.leadId}`,
      materialDescription: "Gravel and masonry sand",
      ownerUserId: userId,
      primaryContactId: fixture.contactId,
      quantityUnit: "cubic_yards",
      serviceLocationId: fixture.locationId,
      serviceType: "material_delivery",
      source: "phone",
      status: "accepted",
      summary: "Multi-material delivery database fixture",
      tenantId,
    });
    await transaction.insert(pricingPolicies).values({
      id: fixture.pricingPolicyId,
      name: `Material fixture ${fixture.pricingPolicyId}`,
      serviceType: "material_delivery",
      status: "active",
      tenantId,
    });
    await transaction.insert(pricingVersions).values({
      activatedAt: new Date(),
      effectiveAt: new Date(),
      id: fixture.pricingVersionId,
      pricingPolicyId: fixture.pricingPolicyId,
      status: "active",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(estimates).values({
      estimateNumber: `EST-${fixture.estimateId}`,
      id: fixture.estimateId,
      leadId: fixture.leadId,
      ownerUserId: userId,
      status: "quote_generated",
      tenantId,
    });
    await transaction.insert(estimateVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      approvedQuotePriceCents: 42_000,
      contentHash: "a".repeat(64),
      depositCents: 18_500,
      estimateId: fixture.estimateId,
      id: fixture.estimateVersionId,
      inputSnapshot: { plannedLoadCount: 1 },
      marginCents: 23_600,
      pricingVersionId: fixture.pricingVersionId,
      purchaseCostCents: 18_400,
      readiness: "ready",
      recommendedPriceCents: 42_000,
      serviceType: "material_delivery",
      status: "quote_generated",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(quotes).values({
      customerAccountId: fixture.customerId,
      estimateId: fixture.estimateId,
      id: fixture.quoteId,
      leadId: fixture.leadId,
      ownerUserId: userId,
      primaryContactId: fixture.contactId,
      quoteNumber: `QTE-${fixture.quoteId}`,
      serviceLocationId: fixture.locationId,
      status: "accepted",
      tenantId,
    });
    await transaction.insert(quoteVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      contentHash: "b".repeat(64),
      customerSnapshot: { displayName: "Material Delivery Fixture" },
      estimateVersionId: fixture.estimateVersionId,
      id: fixture.quoteVersionId,
      locationSnapshot: { addressLine1: "1600 Material Way" },
      quoteId: fixture.quoteId,
      requiredDepositCents: 18_500,
      scope: "Deliver gravel and masonry sand",
      status: "draft",
      subtotalCents: 42_000,
      tenantId,
      totalCents: 42_000,
      versionNumber: 1,
    });
    await transaction.insert(quoteLineItems).values([
      {
        description: "Four cubic yards of #57 gravel",
        id: fixture.gravelQuoteLineId,
        quantity: "4.000",
        quoteVersionId: fixture.quoteVersionId,
        sequence: 1,
        tenantId,
        totalCents: 23_000,
        unit: "cubic_yards",
        unitPriceCents: 5_750,
      },
      {
        description: "Two cubic yards of masonry sand",
        id: fixture.sandQuoteLineId,
        quantity: "2.000",
        quoteVersionId: fixture.quoteVersionId,
        sequence: 2,
        tenantId,
        totalCents: 19_000,
        unit: "cubic_yards",
        unitPriceCents: 9_500,
      },
    ]);
    await transaction
      .update(quoteVersions)
      .set({ status: "accepted", terminalAt: new Date() })
      .where(eq(quoteVersions.id, fixture.quoteVersionId));
    await transaction.insert(projects).values({
      acceptedQuoteContentHash: "b".repeat(64),
      acceptedQuoteVersionId: fixture.quoteVersionId,
      acceptedValueCents: 42_000,
      contractRequirement: "waived",
      contractStatus: "waived",
      customerAccountId: fixture.customerId,
      depositRequirement: "waived",
      depositStatus: "waived",
      id: fixture.projectId,
      outcomeStatement: "Deliver two materials to two placement areas",
      ownerUserId: userId,
      primaryContactId: fixture.contactId,
      projectNumber: `PRJ-${fixture.projectId}`,
      requiredDepositCents: 18_500,
      serviceLocationId: fixture.locationId,
      serviceType: "material_delivery",
      status: "planning",
      tenantId,
    });
    await transaction.insert(jobs).values([
      {
        id: fixture.materialJobId,
        jobNumber: `MAT-${fixture.materialJobId}`,
        projectId: fixture.projectId,
        serviceType: "material_delivery",
        status: "planning",
        tenantId,
      },
      {
        id: fixture.rentalJobId,
        jobNumber: `DTR-${fixture.rentalJobId}`,
        projectId: fixture.projectId,
        serviceType: "dump_trailer_rental",
        status: "planning",
        tenantId,
      },
      {
        id: fixture.closedJobId,
        jobNumber: `MAT-${fixture.closedJobId}`,
        projectId: fixture.projectId,
        serviceType: "material_delivery",
        status: "planning",
        tenantId,
      },
    ]);
    await transaction.insert(materials).values([
      {
        defaultUnit: "cubic_yards",
        id: fixture.gravelId,
        name: "#57 Gravel Fixture",
        normalizedName: `57 gravel ${fixture.gravelId}`,
        tenantId,
      },
      {
        defaultUnit: "cubic_yards",
        id: fixture.sandId,
        name: "Masonry Sand Fixture",
        normalizedName: `masonry sand ${fixture.sandId}`,
        tenantId,
      },
    ]);
    await transaction.insert(assets).values({
      assetNumber: `TRL-${fixture.assetId}`,
      assetType: "trailer",
      capacityVolumeCubicYards: "7.000",
      capacityWeight: "10000.000",
      id: fixture.assetId,
      name: "Seven yard material trailer",
      tenantId,
    });
    await transaction.insert(routeStops).values([
      {
        id: fixture.supplierStopId,
        jobId: fixture.materialJobId,
        label: "Supplier",
        locationSnapshot: { address: "Supplier yard" },
        sequence: 1,
        stopType: "supplier",
        tenantId,
      },
      {
        id: fixture.placementStopId,
        jobId: fixture.materialJobId,
        label: "Driveway placement",
        locationSnapshot: { address: "1600 Material Way" },
        sequence: 2,
        stopType: "customer",
        tenantId,
      },
    ]);
    await transaction.insert(materialDeliveryDetails).values([
      {
        id: fixture.detailId,
        jobId: fixture.materialJobId,
        plannedLoadCount: 1,
        plannedVolumeCubicYards: "6.000",
        plannedWeightPounds: "9000.000",
        tenantId,
      },
      {
        id: fixture.closedDetailId,
        jobId: fixture.closedJobId,
        plannedLoadCount: 1,
        tenantId,
      },
    ]);
    await transaction.insert(materialLoads).values([
      {
        id: fixture.loadId,
        jobId: fixture.materialJobId,
        materialDeliveryDetailId: fixture.detailId,
        plannedVolumeCubicYards: "6.000",
        plannedWeightPounds: "9000.000",
        sequence: 1,
        tenantId,
      },
      {
        id: fixture.closedLoadId,
        jobId: fixture.closedJobId,
        materialDeliveryDetailId: fixture.closedDetailId,
        sequence: 1,
        tenantId,
      },
    ]);
    await transaction.insert(materialLoadAssets).values({
      assetId: fixture.assetId,
      capacitySnapshot: { capacityVolumeCubicYards: "7.000", capacityWeightPounds: "10000.000" },
      id: fixture.loadAssetId,
      jobId: fixture.materialJobId,
      materialLoadId: fixture.loadId,
      role: "trailer",
      tenantId,
    });
    await transaction.insert(materialLoadItems).values([
      {
        acceptedQuoteLineItemId: fixture.gravelQuoteLineId,
        actualMaterialId: fixture.gravelId,
        id: fixture.gravelItemId,
        jobId: fixture.materialJobId,
        loadingSequence: 1,
        materialId: fixture.gravelId,
        materialLoadId: fixture.loadId,
        placementRouteStopId: fixture.placementStopId,
        plannedQuantity: "4.000",
        quantityUnit: "cubic_yards",
        sequence: 1,
        supplierRouteStopId: fixture.supplierStopId,
        tenantId,
        unitVolumeCubicYards: "1.000",
        unitWeightPounds: "1500.000",
        unloadingSequence: 1,
      },
      {
        acceptedQuoteLineItemId: fixture.sandQuoteLineId,
        actualMaterialId: fixture.sandId,
        compartment: "Separated rear compartment",
        id: fixture.sandItemId,
        jobId: fixture.materialJobId,
        loadingSequence: 2,
        materialId: fixture.sandId,
        materialLoadId: fixture.loadId,
        placementRouteStopId: fixture.placementStopId,
        plannedQuantity: "2.000",
        quantityUnit: "cubic_yards",
        separationInstructions: "Keep sand separated from gravel",
        sequence: 2,
        supplierRouteStopId: fixture.supplierStopId,
        tenantId,
        unitVolumeCubicYards: "1.000",
        unitWeightPounds: "1500.000",
        unloadingSequence: 2,
      },
    ]);
    await transaction.insert(documents).values({
      availableAt: new Date(),
      id: fixture.receiptDocumentId,
      mediaType: "application/pdf",
      objectKey: `${tenantId}/${fixture.receiptDocumentId}`,
      originalFilename: "supplier-receipt.pdf",
      sha256: "c".repeat(64),
      status: "available",
      tenantId,
    });
    await transaction
      .update(jobs)
      .set({ closedAt: new Date(), status: "closed" })
      .where(eq(jobs.id, fixture.closedJobId));
  });
}
