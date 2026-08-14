import {
  accountContacts,
  assetReservations,
  assets,
  auditEvents,
  contacts,
  createDatabase,
  createDatabasePool,
  customerAccounts,
  disposalLoads,
  documentLinks,
  documents,
  dumpTrailerRentalDetails,
  estimateVersions,
  estimates,
  expenses,
  jobs,
  jobCharges,
  leads,
  organizations,
  outboxEvents,
  pricingPolicies,
  pricingVersions,
  projects,
  quoteVersions,
  quotes,
  rentalExtensions,
  rentalPickupAttempts,
  runMigrations,
  serviceLocations,
  supplierLocations,
  suppliers,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";
import { recoveryAcceptanceEnabled, withRestoredDatabase } from "./support/restored-database.js";

loadRootEnvironment();

interface Fixture {
  disposalLocationId: string;
  emptyTrailerDocumentId: string;
  inspectionDocumentId: string;
  jobId: string;
  quoteVersionId: string;
  receiptDocumentId: string;
  ticketDocumentId: string;
  trailerId: string;
  truckId: string;
}

interface RentalResponse {
  actualPickupAt: string | null;
  customerCustodyEndedAt: string | null;
  debrisReviewStatus: string;
  extensions: {
    additionalDays: number;
    calculatedAmountCents: number;
    conflictStatus: string;
    id: string;
    status: string;
  }[];
  id: string;
  inspections: { id: string; releaseDecision: string; status: string }[];
  disposalLoads: {
    canonicalNetWeightPounds: string | null;
    expenseId: string | null;
    id: string;
    redirectedFromDisposalLoadId: string | null;
    status: string;
  }[];
  jobId: string;
  occupancy: null | { endsAt: string; status: string; trailerAssetId: string };
  pickupAttempts: {
    customerCustodyEndedAt: string | null;
    failureReason: string | null;
    id: string;
    status: string;
  }[];
  operationalCharges: {
    approvedAmountCents: number | null;
    chargeType: string;
    id: string;
    status: string;
  }[];
  overageWeightPounds: string;
  plannedPickupAt: string;
  schedule: { blockType: string; endsAt: string; startsAt: string; status: string }[];
  status: string;
  totalActualWeightPounds: string;
  trailerAssetId: string | null;
}

describe("Sprint 1.8.0 Dump Trailer Rental", { concurrent: false }, () => {
  const databaseName = `ldg_rental_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;
  let fixture: Fixture;
  let foreignFixture: Fixture;
  let foreignRentalId: string;

  const migrator = () => initialized(migrationDatabase, "migration database");
  const runtime = () => initialized(runtimeDatabase, "runtime database");

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
    fixture = await seedRentalFixture(migrator(), tenantId, userId, "canonical");
    foreignFixture = await seedRentalFixture(migrator(), foreignTenantId, foreignUserId, "foreign");
    foreignRentalId = await withTenantTransaction(
      migrator(),
      foreignTenantId,
      async (transaction) => {
        const [rental] = await transaction
          .insert(dumpTrailerRentalDetails)
          .values({
            acceptedQuoteVersionId: foreignFixture.quoteVersionId,
            acceptedTermsHash: "f".repeat(64),
            acceptedTermsSnapshot: { fixture: "foreign" },
            additionalDayRateCents: 5_000,
            depositAmountCents: 15_000,
            depositClassification: "refundable_security",
            includedDays: 3,
            includedWeightPounds: "2000.000",
            jobId: foreignFixture.jobId,
            overageRateCentsPerPound: 8,
            plannedDropoffAt: new Date("2026-08-14T14:00:00.000Z"),
            plannedPickupAt: new Date("2026-08-17T14:00:00.000Z"),
            rateType: "weekend",
            tenantId: foreignTenantId,
            trailerAssetId: foreignFixture.trailerId,
          })
          .returning({ id: dumpTrailerRentalDetails.id });
        if (!rental) throw new Error("Foreign Rental fixture was not created");
        return rental.id;
      },
    );

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

  it("DTR-E2E-001 executes the Rental through disposal, inspection, and operational completion", async () => {
    const planPayload = {
      plannedDropoffAt: "2026-08-14T14:00:00.000Z",
      plannedPickupAt: "2026-08-17T14:00:00.000Z",
      trailerAssetId: fixture.trailerId,
    };
    const create = () =>
      command(
        "POST",
        `/api/v1/jobs/${fixture.jobId}/dump-trailer-rental`,
        "rental-plan-1",
        planPayload,
      );
    const created = await create();
    expect(created.statusCode).toBe(201);
    const rental = created.json<RentalResponse>();
    expect(rental).toMatchObject({
      debrisReviewStatus: "pending",
      jobId: fixture.jobId,
      status: "planning",
      trailerAssetId: fixture.trailerId,
    });
    expect(created.json()).toMatchObject({
      additionalDayRateCents: 5_000,
      depositAmountCents: 15_000,
      depositClassification: "refundable_security",
      includedDays: 3,
      includedWeightPounds: "2000.000",
      overageRateCentsPerPound: 8,
      rateType: "weekend",
    });
    expect((await create()).json()).toEqual(created.json());

    const conflictingReplay = await command(
      "POST",
      `/api/v1/jobs/${fixture.jobId}/dump-trailer-rental`,
      "rental-plan-1",
      { ...planPayload, plannedPickupAt: "2026-08-18T14:00:00.000Z" },
    );
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const prematureRental = await transitionRental(rental.id, "begin-rental", "rental-early-1");
    expect(prematureRental.statusCode).toBe(409);
    expect(prematureRental.json()).toMatchObject({
      error: { code: "RENTAL_DROPOFF_TRANSITION_INVALID" },
    });

    const reviewCreated = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/debris-reviews`,
      "rental-review-1",
      {
        accessStatus: "pass",
        customerAttestation: "Only household renovation debris; no prohibited material.",
        customerAttested: true,
        heavyMaterial: false,
        legalTowingStatus: "pass",
        mixedDebris: true,
        pickupAccessRequirement: "Driveway must remain clear on pickup morning.",
        placementInstructions: "Place behind the driveway marker.",
        primaryDebrisType: "construction_debris",
        prohibitedMaterials: [],
        propertyDamageRisk: "Customer approved driveway placement.",
        restrictedMaterials: [],
        secondaryDebrisTypes: ["wood", "drywall"],
      },
    );
    expect(reviewCreated.statusCode).toBe(201);
    const reviewId = reviewCreated.json<RentalResponse & { debrisReviews: { id: string }[] }>()
      .debrisReviews[0]?.id;
    if (!reviewId) throw new Error("Rental Debris Review was not returned");
    const approved = await command(
      "POST",
      `/api/v1/rental-debris-reviews/${reviewId}/actions/approve`,
      "rental-review-approve-1",
      { reason: "Attestation, access, and legal towing review passed." },
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      accessReviewStatus: "pass",
      debrisReviewStatus: "approved",
    });

    const scheduled = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/actions/plan-schedule`,
      "rental-schedule-1",
      {
        dropoffDriverUserId: userId,
        dropoffEndsAt: "2026-08-14T15:00:00.000Z",
        dropoffStartsAt: "2026-08-14T13:00:00.000Z",
        dropoffTruckAssetId: fixture.truckId,
        pickupDriverUserId: userId,
        pickupEndsAt: "2026-08-17T15:00:00.000Z",
        pickupStartsAt: "2026-08-17T13:00:00.000Z",
        pickupTruckAssetId: fixture.truckId,
      },
    );
    expect(scheduled.statusCode).toBe(201);
    expect(scheduled.json<RentalResponse>()).toMatchObject({
      occupancy: { status: "active", trailerAssetId: fixture.trailerId },
      schedule: [
        { blockType: "dropoff", status: "tentative" },
        { blockType: "pickup", status: "tentative" },
      ],
    });

    const scheduleReady = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/actions/evaluate-readiness`,
      "rental-readiness-schedule-1",
      { readinessType: "schedule" },
    );
    expect(scheduleReady.statusCode).toBe(200);
    expect(scheduleReady.json()).toMatchObject({ blockers: [], result: "ready" });

    const scheduleConfirmed = await transitionJob(
      fixture.jobId,
      "confirm-schedule",
      "rental-confirm-schedule-1",
    );
    expect(scheduleConfirmed.statusCode).toBe(200);
    expect(scheduleConfirmed.json()).toMatchObject({ status: "scheduled" });

    const inspectionCreated = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/inspections`,
      "rental-inspection-1",
      { inspectionType: "pre_dropoff" },
    );
    expect(inspectionCreated.statusCode).toBe(201);
    const inspectionId = inspectionCreated.json<{ id: string }>().id;

    const blockedDispatch = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/actions/evaluate-readiness`,
      "rental-readiness-dispatch-blocked-1",
      { readinessType: "dispatch" },
    );
    expect(blockedDispatch.json<{ blockers: string[]; result: string }>()).toMatchObject({
      result: "not_ready",
    });
    expect(blockedDispatch.json<{ blockers: string[] }>().blockers).toContain(
      "Pre-drop-off inspection does not authorize trailer release",
    );

    const inspectionCompleted = await command(
      "POST",
      `/api/v1/rental-inspections/${inspectionId}/actions/complete`,
      "rental-inspection-complete-1",
      {
        cleaningResult: "normal",
        conditionResult: "acceptable",
        damageResult: "none",
        notes: "Lights, tires, hitch, gate, and body passed inspection.",
        releaseDecision: "release",
        safeToRelease: true,
      },
    );
    expect(inspectionCompleted.statusCode).toBe(200);
    expect(inspectionCompleted.json()).toMatchObject({
      releaseDecision: "release",
      safeToRelease: true,
      status: "completed",
    });

    const dispatchReady = await transitionJob(
      fixture.jobId,
      "mark-dispatch-ready",
      "rental-dispatch-ready-1",
    );
    expect(dispatchReady.statusCode).toBe(200);
    expect(dispatchReady.json()).toMatchObject({ status: "dispatch_ready" });

    expect(
      (await transitionRental(rental.id, "prepare-dropoff", "rental-prepare-1")).json(),
    ).toMatchObject({ status: "dropoff_preparing" });
    expect(
      (await transitionJob(fixture.jobId, "start", "rental-job-start-1")).json(),
    ).toMatchObject({ status: "active" });
    expect(
      (await transitionRental(rental.id, "depart-dropoff", "rental-depart-1")).json(),
    ).toMatchObject({ status: "en_route_dropoff" });
    expect(
      (await transitionRental(rental.id, "arrive-dropoff", "rental-arrive-1")).json(),
    ).toMatchObject({ status: "at_customer_dropoff" });
    expect(
      (await transitionRental(rental.id, "complete-dropoff", "rental-complete-dropoff-1")).json(),
    ).toMatchObject({ status: "delivered" });
    const onRent = await transitionRental(rental.id, "begin-rental", "rental-begin-1");
    expect(onRent.statusCode).toBe(200);
    expect(onRent.json()).toMatchObject({
      occupancy: { status: "active", trailerAssetId: fixture.trailerId },
      status: "on_rent",
    });
    expect((await transitionRental(rental.id, "begin-rental", "rental-begin-1")).json()).toEqual(
      onRent.json(),
    );

    const persisted = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      asset: (await transaction.select().from(assets).where(eq(assets.id, fixture.trailerId)))[0],
      audits: await transaction
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, rental.id)),
      detail: (
        await transaction
          .select()
          .from(dumpTrailerRentalDetails)
          .where(eq(dumpTrailerRentalDetails.id, rental.id))
      )[0],
      outbox: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.aggregateId, rental.id)),
    }));
    expect(persisted.asset?.status).toBe("in_use");
    expect(persisted.detail).toMatchObject({
      status: "on_rent",
      trailerAssetId: fixture.trailerId,
    });
    expect(persisted.audits.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "rental.plan_created",
        "rental.schedule_planned",
        "rental.dropoff_completed",
        "rental.on_rent",
      ]),
    );
    expect(persisted.outbox.map((event) => event.eventType)).toContain("rental.on_rent");

    const extensionRequested = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/extensions`,
      "rental-extension-request-1",
      { customerAuthorized: true, requestedPickupAt: "2026-08-18T14:00:00.000Z" },
    );
    expect(extensionRequested.statusCode).toBe(201);
    expect(extensionRequested.json()).toMatchObject({
      additionalDays: 1,
      calculatedAmountCents: 5_000,
      conflictStatus: "evaluation_required",
      customerAuthorizationStatus: "authorized",
      rateCents: 5_000,
      status: "requested",
    });
    const extensionId = extensionRequested.json<{ id: string }>().id;
    expect(
      (
        await command(
          "POST",
          `/api/v1/dump-trailer-rentals/${rental.id}/extensions`,
          "rental-extension-request-1",
          { customerAuthorized: true, requestedPickupAt: "2026-08-18T14:00:00.000Z" },
        )
      ).json(),
    ).toEqual(extensionRequested.json());

    const evaluatedExtension = await command(
      "POST",
      `/api/v1/rental-extensions/${extensionId}/actions/evaluate`,
      "rental-extension-evaluate-1",
      { reason: "Check Tuesday trailer and tow-vehicle availability." },
    );
    expect(evaluatedExtension.statusCode).toBe(200);
    expect(evaluatedExtension.json<RentalResponse>().extensions[0]).toMatchObject({
      conflictStatus: "pass",
      status: "awaiting_internal_approval",
    });

    const conflictReservationId = await withTenantTransaction(
      runtime(),
      tenantId,
      async (transaction) => {
        const [reservation] = await transaction
          .insert(assetReservations)
          .values({
            assetId: fixture.trailerId,
            createdBy: userId,
            endsAt: new Date("2026-08-18T10:00:00.000Z"),
            jobId: fixture.jobId,
            reservationType: "schedule",
            startsAt: new Date("2026-08-17T20:00:00.000Z"),
            tenantId,
            updatedBy: userId,
          })
          .returning({ id: assetReservations.id });
        if (!reservation) throw new Error("Conflict Reservation was not created");
        return reservation.id;
      },
    );
    const blockedApproval = await command(
      "POST",
      `/api/v1/rental-extensions/${extensionId}/actions/approve`,
      "rental-extension-approve-conflict-1",
      { reason: "Approve one additional day." },
    );
    expect(blockedApproval.statusCode).toBe(409);
    expect(blockedApproval.json()).toMatchObject({
      error: { code: "RENTAL_EXTENSION_ASSET_CONFLICT" },
    });
    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .update(assetReservations)
        .set({ status: "cancelled", updatedBy: userId })
        .where(eq(assetReservations.id, conflictReservationId)),
    );

    const approvedExtension = await command(
      "POST",
      `/api/v1/rental-extensions/${extensionId}/actions/approve`,
      "rental-extension-approve-1",
      { reason: "Tuesday availability and customer authorization confirmed." },
    );
    expect(approvedExtension.statusCode).toBe(200);
    expect(approvedExtension.json<RentalResponse>()).toMatchObject({
      extensions: [
        {
          additionalDays: 1,
          calculatedAmountCents: 5_000,
          conflictStatus: "pass",
          status: "approved",
        },
      ],
      occupancy: { endsAt: "2026-08-18T14:00:00.000Z", status: "active" },
      plannedPickupAt: "2026-08-18T14:00:00.000Z",
    });
    expect(
      approvedExtension
        .json<RentalResponse>()
        .schedule.find((block) => block.blockType === "pickup"),
    ).toMatchObject({
      endsAt: "2026-08-18T15:00:00.000Z",
      startsAt: "2026-08-18T13:00:00.000Z",
    });
    expect(
      (
        await command(
          "POST",
          `/api/v1/rental-extensions/${extensionId}/actions/approve`,
          "rental-extension-approve-1",
          { reason: "Tuesday availability and customer authorization confirmed." },
        )
      ).json(),
    ).toEqual(approvedExtension.json());

    const failedAttemptCreated = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/pickup-attempts`,
      "rental-pickup-attempt-1",
      {
        accessStatus: "pass",
        customerNotifiedAt: "2026-08-18T12:00:00.000Z",
        notes: "Customer confirmed access for Tuesday pickup.",
        safeLoadStatus: "pass",
      },
    );
    expect(failedAttemptCreated.statusCode).toBe(201);
    expect(failedAttemptCreated.json<RentalResponse>()).toMatchObject({
      pickupAttempts: [{ status: "planned" }],
      status: "pickup_scheduled",
    });
    const failedAttemptId = failedAttemptCreated.json<RentalResponse>().pickupAttempts[0]?.id;
    if (!failedAttemptId) throw new Error("First Pickup Attempt was not returned");

    const prematureRetrieval = await transitionPickup(
      failedAttemptId,
      "retrieve",
      "rental-pickup-retrieve-early-1",
      {},
    );
    expect(prematureRetrieval.statusCode).toBe(409);
    expect(prematureRetrieval.json()).toMatchObject({
      error: { code: "RENTAL_PICKUP_TRANSITION_INVALID" },
    });
    expect(
      (await transitionPickup(failedAttemptId, "prepare", "rental-pickup-prepare-1", {})).json(),
    ).toMatchObject({ status: "pickup_preparing" });
    expect(
      (await transitionPickup(failedAttemptId, "depart", "rental-pickup-depart-1", {})).json(),
    ).toMatchObject({ status: "en_route_pickup" });
    expect(
      (await transitionPickup(failedAttemptId, "arrive", "rental-pickup-arrive-1", {})).json(),
    ).toMatchObject({ status: "at_customer_pickup" });
    const failedAttempt = await transitionPickup(failedAttemptId, "fail", "rental-pickup-fail-1", {
      accessStatus: "fail",
      reason: "A parked vehicle blocked safe trailer access.",
    });
    expect(failedAttempt.statusCode).toBe(200);
    expect(failedAttempt.json<RentalResponse>()).toMatchObject({
      customerCustodyEndedAt: null,
      pickupAttempts: [
        {
          customerCustodyEndedAt: null,
          failureReason: "A parked vehicle blocked safe trailer access.",
          status: "failed",
        },
      ],
      status: "on_rent",
    });

    const successfulAttemptCreated = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/pickup-attempts`,
      "rental-pickup-attempt-2",
      {
        accessStatus: "pass",
        customerNotifiedAt: "2026-08-18T13:00:00.000Z",
        notes: "Customer cleared the access route.",
        safeLoadStatus: "pass",
      },
    );
    expect(successfulAttemptCreated.statusCode).toBe(201);
    expect(
      (
        await command(
          "POST",
          `/api/v1/dump-trailer-rentals/${rental.id}/pickup-attempts`,
          "rental-pickup-attempt-2",
          {
            accessStatus: "pass",
            customerNotifiedAt: "2026-08-18T13:00:00.000Z",
            notes: "Customer cleared the access route.",
            safeLoadStatus: "pass",
          },
        )
      ).json(),
    ).toEqual(successfulAttemptCreated.json());
    const successfulAttemptId = successfulAttemptCreated
      .json<RentalResponse>()
      .pickupAttempts.find((attempt) => attempt.status === "planned")?.id;
    if (!successfulAttemptId) throw new Error("Second Pickup Attempt was not returned");
    await transitionPickup(successfulAttemptId, "prepare", "rental-pickup-prepare-2", {});
    await transitionPickup(successfulAttemptId, "depart", "rental-pickup-depart-2", {});
    await transitionPickup(successfulAttemptId, "arrive", "rental-pickup-arrive-2", {});
    const retrieved = await transitionPickup(
      successfulAttemptId,
      "retrieve",
      "rental-pickup-retrieve-2",
      { notes: "Trailer safely connected and removed from the customer site." },
    );
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json<RentalResponse>()).toMatchObject({
      occupancy: { status: "active", trailerAssetId: fixture.trailerId },
      pickupAttempts: [{ status: "failed" }, { failureReason: null, status: "retrieved" }],
      status: "picked_up",
    });
    expect(retrieved.json<RentalResponse>().actualPickupAt).not.toBeNull();
    expect(retrieved.json<RentalResponse>().customerCustodyEndedAt).not.toBeNull();

    const phaseThreePersistence = await withTenantTransaction(
      runtime(),
      tenantId,
      async (transaction) => ({
        asset: (await transaction.select().from(assets).where(eq(assets.id, fixture.trailerId)))[0],
        audits: await transaction.select().from(auditEvents),
        extension: (
          await transaction
            .select()
            .from(rentalExtensions)
            .where(eq(rentalExtensions.id, extensionId))
        )[0],
        pickupAttempts: await transaction
          .select()
          .from(rentalPickupAttempts)
          .where(eq(rentalPickupAttempts.rentalDetailId, rental.id)),
        outbox: await transaction.select().from(outboxEvents),
      }),
    );
    expect(phaseThreePersistence.asset?.status).toBe("in_use");
    expect(phaseThreePersistence.extension).toMatchObject({
      calculatedAmountCents: 5_000,
      status: "approved",
    });
    expect(phaseThreePersistence.audits.map((event) => event.eventType)).toContain(
      "rental.job_charge_created",
    );
    expect(phaseThreePersistence.pickupAttempts).toHaveLength(2);
    expect(phaseThreePersistence.audits.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "rental.extension_requested",
        "rental.extension_availability_evaluated",
        "rental.extension_approved",
        "rental.pickup_failed",
        "rental.pickup_retrieved",
      ]),
    );
    expect(phaseThreePersistence.outbox.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["rental.extension_approved", "rental.pickup_retrieved"]),
    );

    const rejectedLoad = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/disposal-loads`,
      "rental-disposal-create-1",
      {
        debrisClassification: "mixed construction debris",
        driverUserId: userId,
        endsAt: "2026-08-18T16:30:00.000Z",
        plannedFacilityLocationId: fixture.disposalLocationId,
        startsAt: "2026-08-18T15:30:00.000Z",
        truckAssetId: fixture.truckId,
      },
    );
    expect(rejectedLoad.statusCode).toBe(201);
    const rejectedLoadId = rejectedLoad.json<RentalResponse>().disposalLoads[0]?.id;
    if (!rejectedLoadId) throw new Error("Rejected Disposal Load was not returned");
    await transitionDisposal(rejectedLoadId, "depart", "rental-disposal-depart-1", {
      occurredAt: "2026-08-18T15:30:00.000Z",
    });
    await transitionDisposal(rejectedLoadId, "arrive", "rental-disposal-arrive-1", {
      actualFacilityLocationId: fixture.disposalLocationId,
      occurredAt: "2026-08-18T15:45:00.000Z",
    });
    const rejected = await transitionDisposal(
      rejectedLoadId,
      "reject",
      "rental-disposal-reject-1",
      {
        occurredAt: "2026-08-18T15:50:00.000Z",
        rejectionReason: "Facility temporarily stopped accepting mixed construction debris.",
      },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json<RentalResponse>().disposalLoads[0]).toMatchObject({
      status: "rejected",
    });

    const replacementLoad = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/disposal-loads`,
      "rental-disposal-create-2",
      {
        debrisClassification: "mixed construction debris",
        driverUserId: userId,
        endsAt: "2026-08-18T17:30:00.000Z",
        plannedFacilityLocationId: fixture.disposalLocationId,
        redirectedFromDisposalLoadId: rejectedLoadId,
        startsAt: "2026-08-18T16:30:00.000Z",
        truckAssetId: fixture.truckId,
      },
    );
    expect(replacementLoad.statusCode).toBe(201);
    const replacementLoadId = replacementLoad
      .json<RentalResponse>()
      .disposalLoads.find((load) => load.redirectedFromDisposalLoadId === rejectedLoadId)?.id;
    if (!replacementLoadId) throw new Error("Replacement Disposal Load was not returned");
    await transitionDisposal(replacementLoadId, "depart", "rental-disposal-depart-2", {
      occurredAt: "2026-08-18T16:30:00.000Z",
    });
    await transitionDisposal(replacementLoadId, "arrive", "rental-disposal-arrive-2", {
      actualFacilityLocationId: fixture.disposalLocationId,
      occurredAt: "2026-08-18T16:45:00.000Z",
    });
    await transitionDisposal(replacementLoadId, "accept", "rental-disposal-accept-2", {
      occurredAt: "2026-08-18T16:50:00.000Z",
    });
    const weighed = await transitionDisposal(
      replacementLoadId,
      "record-weight",
      "rental-disposal-weight-2",
      {
        grossWeight: "15620",
        occurredAt: "2026-08-18T16:52:00.000Z",
        sourceWeightUnit: "pounds",
        tareWeight: "12940",
      },
    );
    expect(weighed.statusCode).toBe(200);
    expect(
      weighed.json<RentalResponse>().disposalLoads.find((load) => load.id === replacementLoadId),
    ).toMatchObject({ canonicalNetWeightPounds: "2680.000", status: "weighed_in" });
    await transitionDisposal(
      replacementLoadId,
      "start-unloading",
      "rental-disposal-unload-start-2",
      { occurredAt: "2026-08-18T16:55:00.000Z" },
    );
    await transitionDisposal(
      replacementLoadId,
      "complete-unloading",
      "rental-disposal-unload-complete-2",
      {
        occurredAt: "2026-08-18T17:05:00.000Z",
        remainingMaterialStatus: "none",
      },
    );
    const evidence = await command(
      "POST",
      `/api/v1/disposal-loads/${replacementLoadId}/actions/record-evidence`,
      "rental-disposal-evidence-2",
      {
        disposalFeeCents: 10_000,
        emptyTrailerDocumentId: fixture.emptyTrailerDocumentId,
        externalReference: "FAC-2026-0818-22",
        receiptDocumentId: fixture.receiptDocumentId,
        ticketDocumentId: fixture.ticketDocumentId,
      },
    );
    expect(evidence.statusCode).toBe(200);
    const evidencedLoad = evidence
      .json<RentalResponse>()
      .disposalLoads.find((load) => load.id === replacementLoadId);
    expect(evidencedLoad?.expenseId).toBeTypeOf("string");
    expect(evidencedLoad?.status).toBe("documentation_pending");

    const disposalReconciled = await command(
      "POST",
      `/api/v1/disposal-loads/${replacementLoadId}/actions/reconcile`,
      "rental-disposal-reconcile-2",
      { occurredAt: "2026-08-18T17:10:00.000Z" },
    );
    expect(disposalReconciled.statusCode).toBe(200);
    expect(disposalReconciled.json<RentalResponse>()).toMatchObject({
      overageWeightPounds: "680.000",
      status: "inspection_required",
      totalActualWeightPounds: "2680.000",
    });

    const postInspectionCreated = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/inspections`,
      "rental-post-inspection-1",
      {
        evidenceDocumentId: fixture.inspectionDocumentId,
        inspectionType: "post_rental",
      },
    );
    expect(postInspectionCreated.statusCode).toBe(201);
    const postInspectionId = postInspectionCreated.json<{ id: string }>().id;
    const postInspectionCompleted = await command(
      "POST",
      `/api/v1/rental-inspections/${postInspectionId}/actions/complete`,
      "rental-post-inspection-complete-1",
      {
        cleaningResult: "normal",
        conditionResult: "acceptable",
        damageResult: "none",
        notes: "Trailer was empty, clean, roadworthy, and free of customer damage.",
        releaseDecision: "release",
        safeToRelease: true,
      },
    );
    expect(postInspectionCompleted.statusCode).toBe(200);
    expect(postInspectionCompleted.json()).toMatchObject({
      releaseDecision: "release",
      status: "completed",
    });

    const returned = await fastify.inject({
      method: "GET",
      url: `/api/v1/jobs/${fixture.jobId}/dump-trailer-rental`,
    });
    expect(returned.json<RentalResponse>()).toMatchObject({
      occupancy: { status: "released" },
      status: "returned",
    });
    const reconciledRental = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rental.id}/actions/reconcile`,
      "rental-reconcile-1",
      { occurredAt: "2026-08-18T17:20:00.000Z" },
    );
    expect(reconciledRental.statusCode).toBe(200);
    const reconciledRentalBody = reconciledRental.json<RentalResponse>();
    expect(reconciledRentalBody.status).toBe("operationally_complete");
    expect(
      reconciledRentalBody.operationalCharges
        .map((charge) => ({
          approvedAmountCents: charge.approvedAmountCents,
          chargeType: charge.chargeType,
          status: charge.status,
        }))
        .sort((left, right) => left.chargeType.localeCompare(right.chargeType)),
    ).toEqual([
      {
        approvedAmountCents: 5_000,
        chargeType: "additional_day",
        status: "ready_to_invoice",
      },
      {
        approvedAmountCents: 5_440,
        chargeType: "weight_overage",
        status: "ready_to_invoice",
      },
    ]);
    expect(
      (
        await command(
          "POST",
          `/api/v1/dump-trailer-rentals/${rental.id}/actions/reconcile`,
          "rental-reconcile-1",
          { occurredAt: "2026-08-18T17:20:00.000Z" },
        )
      ).json(),
    ).toEqual(reconciledRental.json());

    const jobCompleted = await transitionJob(
      fixture.jobId,
      "complete-operationally",
      "rental-job-complete-1",
    );
    expect(jobCompleted.statusCode).toBe(200);
    expect(jobCompleted.json()).toMatchObject({ status: "operationally_complete" });

    const phaseFourPersistence = await withTenantTransaction(
      runtime(),
      tenantId,
      async (transaction) => ({
        asset: (await transaction.select().from(assets).where(eq(assets.id, fixture.trailerId)))[0],
        charges: await transaction
          .select()
          .from(jobCharges)
          .where(eq(jobCharges.jobId, fixture.jobId)),
        documentLinks: await transaction
          .select()
          .from(documentLinks)
          .where(eq(documentLinks.entityId, replacementLoadId)),
        expenses: await transaction
          .select()
          .from(expenses)
          .where(eq(expenses.jobId, fixture.jobId)),
        loads: await transaction
          .select()
          .from(disposalLoads)
          .where(eq(disposalLoads.rentalDetailId, rental.id)),
      }),
    );
    expect(phaseFourPersistence.asset?.status).toBe("available");
    expect(phaseFourPersistence.charges).toHaveLength(2);
    expect(phaseFourPersistence.documentLinks.map((link) => link.purpose)).toEqual(
      expect.arrayContaining(["scale_ticket", "disposal_receipt", "empty_trailer_evidence"]),
    );
    expect(phaseFourPersistence.expenses).toMatchObject([
      { amountCents: 10_000, expenseType: "disposal", status: "reconciled" },
    ]);
    expect(phaseFourPersistence.loads).toHaveLength(2);

    if (recoveryAcceptanceEnabled()) {
      await withRestoredDatabase(
        {
          adminDatabaseUrl: connectionString(
            environment("POSTGRES_ADMIN_USER"),
            environment("POSTGRES_ADMIN_PASSWORD"),
            "postgres",
          ),
          migrationDatabaseOwner: environment("POSTGRES_MIGRATION_USER"),
          migrationUrl: (name) =>
            connectionString(
              environment("POSTGRES_MIGRATION_USER"),
              environment("POSTGRES_MIGRATION_PASSWORD"),
              name,
            ),
          runtimeUrl: (name) =>
            connectionString(
              environment("POSTGRES_RUNTIME_USER"),
              environment("POSTGRES_RUNTIME_PASSWORD"),
              name,
            ),
          sourceBackupUrl: connectionString(
            environment("POSTGRES_ADMIN_USER"),
            environment("POSTGRES_ADMIN_PASSWORD"),
            databaseName,
          ),
          tenantId,
        },
        async (restored) => {
          const state = await withTenantTransaction(restored, tenantId, async (transaction) => ({
            charges: await transaction.select().from(jobCharges),
            jobs: await transaction.select().from(jobs).where(eq(jobs.id, fixture.jobId)),
            rentals: await transaction
              .select()
              .from(dumpTrailerRentalDetails)
              .where(eq(dumpTrailerRentalDetails.jobId, fixture.jobId)),
          }));
          expect(state.jobs).toMatchObject([{ status: "operationally_complete" }]);
          expect(state.rentals).toMatchObject([{ status: "operationally_complete" }]);
          expect(state.charges).toHaveLength(2);
          expect(
            await withTenantTransaction(restored, foreignTenantId, (transaction) =>
              transaction.select().from(jobs).where(eq(jobs.id, fixture.jobId)),
            ),
          ).toEqual([]);
        },
      );
    }
  });

  it("does not expose another tenant's Rental Job", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: `/api/v1/jobs/${foreignFixture.jobId}/dump-trailer-rental`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "RENTAL_NOT_FOUND" } });

    const extension = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${foreignRentalId}/extensions`,
      "foreign-rental-extension-1",
      { customerAuthorized: true, requestedPickupAt: "2026-08-18T14:00:00.000Z" },
    );
    expect(extension.statusCode).toBe(404);
    expect(extension.json()).toMatchObject({ error: { code: "RENTAL_NOT_FOUND" } });

    const disposal = await command(
      "POST",
      `/api/v1/dump-trailer-rentals/${foreignRentalId}/disposal-loads`,
      "foreign-rental-disposal-1",
      {
        debrisClassification: "construction debris",
        driverUserId: userId,
        endsAt: "2026-08-18T17:30:00.000Z",
        plannedFacilityLocationId: fixture.disposalLocationId,
        startsAt: "2026-08-18T16:30:00.000Z",
        truckAssetId: fixture.truckId,
      },
    );
    expect(disposal.statusCode).toBe(404);
    expect(disposal.json()).toMatchObject({ error: { code: "RENTAL_NOT_FOUND" } });
  });

  function transitionRental(
    rentalId: string,
    action: string,
    idempotencyKey: string,
  ): Promise<LightMyRequestResponse> {
    return command(
      "POST",
      `/api/v1/dump-trailer-rentals/${rentalId}/actions/${action}`,
      idempotencyKey,
      {},
    );
  }

  function transitionJob(
    jobId: string,
    action: string,
    idempotencyKey: string,
  ): Promise<LightMyRequestResponse> {
    return command("POST", `/api/v1/jobs/${jobId}/actions/${action}`, idempotencyKey, {});
  }

  function transitionPickup(
    attemptId: string,
    action: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return command(
      "POST",
      `/api/v1/rental-pickup-attempts/${attemptId}/actions/${action}`,
      idempotencyKey,
      payload,
    );
  }

  function transitionDisposal(
    disposalLoadId: string,
    action: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return command(
      "POST",
      `/api/v1/disposal-loads/${disposalLoadId}/actions/${action}`,
      idempotencyKey,
      payload,
    );
  }

  function command(
    method: "POST",
    url: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return fastify.inject({
      headers: { "idempotency-key": idempotencyKey },
      method,
      payload,
      url,
    });
  }
});

async function seedRentalFixture(
  database: Database,
  tenantId: string,
  userId: string,
  prefix: string,
): Promise<Fixture> {
  const ids = {
    contactId: randomUUID(),
    customerId: randomUUID(),
    disposalLocationId: randomUUID(),
    disposalSupplierId: randomUUID(),
    emptyTrailerDocumentId: randomUUID(),
    estimateId: randomUUID(),
    estimateVersionId: randomUUID(),
    jobId: randomUUID(),
    leadId: randomUUID(),
    locationId: randomUUID(),
    inspectionDocumentId: randomUUID(),
    policyId: randomUUID(),
    pricingVersionId: randomUUID(),
    projectId: randomUUID(),
    quoteId: randomUUID(),
    quoteVersionId: randomUUID(),
    receiptDocumentId: randomUUID(),
    ticketDocumentId: randomUUID(),
    trailerId: randomUUID(),
    truckId: randomUUID(),
  };
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(organizations).values({
      displayName: `${prefix} Rental Test`,
      id: tenantId,
      legalName: `${prefix} Rental Test`,
    });
    await transaction.insert(users).values({
      displayName: `${prefix} Dispatcher Driver`,
      email: `${userId}@example.test`,
      id: userId,
      tenantId,
    });
    await transaction.insert(customerAccounts).values({
      customerType: "individual",
      displayName: `${prefix} Rental Customer`,
      id: ids.customerId,
      normalizedName: `${prefix} rental customer`,
      ownerUserId: userId,
      tenantId,
    });
    await transaction.insert(contacts).values({
      displayName: `${prefix} Rental Customer`,
      email: `${prefix}-${ids.contactId}@example.test`,
      firstName: "Rental",
      id: ids.contactId,
      lastName: "Customer",
      normalizedEmail: `${prefix}-${ids.contactId}@example.test`,
      preferredContactMethod: "email",
      tenantId,
    });
    await transaction.insert(accountContacts).values({
      contactId: ids.contactId,
      customerAccountId: ids.customerId,
      isPrimary: true,
      tenantId,
    });
    await transaction.insert(serviceLocations).values({
      addressLine1: "1800 Rental Road",
      city: "Lincoln",
      customerAccountId: ids.customerId,
      id: ids.locationId,
      label: "Rental site",
      normalizedAddress: `${prefix} 1800 rental road lincoln ne 68502`,
      postalCode: "68502",
      region: "NE",
      tenantId,
    });
    await transaction.insert(leads).values({
      customerAccountId: ids.customerId,
      debrisType: "construction_debris",
      id: ids.leadId,
      leadNumber: `L-${ids.leadId}`,
      ownerUserId: userId,
      primaryContactId: ids.contactId,
      rentalEndDate: "2026-08-17",
      rentalStartDate: "2026-08-14",
      serviceLocationId: ids.locationId,
      serviceType: "dump_trailer_rental",
      source: "phone",
      status: "accepted",
      summary: "Weekend dump trailer rental",
      tenantId,
    });
    await transaction.insert(pricingPolicies).values({
      id: ids.policyId,
      name: `${prefix} Weekend Rental`,
      serviceType: "dump_trailer_rental",
      status: "active",
      tenantId,
    });
    await transaction.insert(pricingVersions).values({
      activatedAt: new Date(),
      effectiveAt: new Date(),
      id: ids.pricingVersionId,
      pricingPolicyId: ids.policyId,
      status: "active",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(estimates).values({
      estimateNumber: `EST-${ids.estimateId}`,
      id: ids.estimateId,
      leadId: ids.leadId,
      ownerUserId: userId,
      status: "quote_generated",
      tenantId,
    });
    await transaction.insert(estimateVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      approvedQuotePriceCents: 35_000,
      contentHash: "a".repeat(64),
      depositCents: 15_000,
      estimateId: ids.estimateId,
      id: ids.estimateVersionId,
      inputSnapshot: {
        acceptedRates: {
          additionalDayCents: 5_000,
          includedDays: 3,
          includedWeightPounds: 2_000,
          overageRateCentsPerPound: 8,
          packageAmountCents: 35_000,
          securityDepositCents: 15_000,
        },
      },
      marginCents: 35_000,
      pricingVersionId: ids.pricingVersionId,
      purchaseCostCents: 0,
      readiness: "ready",
      recommendedPriceCents: 35_000,
      serviceType: "dump_trailer_rental",
      status: "quote_generated",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(quotes).values({
      customerAccountId: ids.customerId,
      estimateId: ids.estimateId,
      id: ids.quoteId,
      leadId: ids.leadId,
      ownerUserId: userId,
      primaryContactId: ids.contactId,
      quoteNumber: `QTE-${ids.quoteId}`,
      serviceLocationId: ids.locationId,
      status: "accepted",
      tenantId,
    });
    await transaction.insert(quoteVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      contentHash: "b".repeat(64),
      customerSnapshot: { displayName: `${prefix} Rental Customer` },
      estimateVersionId: ids.estimateVersionId,
      id: ids.quoteVersionId,
      locationSnapshot: { addressLine1: "1800 Rental Road", city: "Lincoln", region: "NE" },
      quoteId: ids.quoteId,
      requiredDepositCents: 15_000,
      scope: "Weekend dump trailer rental",
      status: "draft",
      subtotalCents: 35_000,
      tenantId,
      totalCents: 35_000,
      versionNumber: 1,
    });
    await transaction
      .update(quoteVersions)
      .set({ status: "accepted", terminalAt: new Date() })
      .where(eq(quoteVersions.id, ids.quoteVersionId));
    await transaction.insert(projects).values({
      acceptedQuoteContentHash: "b".repeat(64),
      acceptedQuoteVersionId: ids.quoteVersionId,
      acceptedValueCents: 35_000,
      contractRequirement: "waived",
      contractStatus: "waived",
      customerAccountId: ids.customerId,
      depositRequirement: "waived",
      depositStatus: "waived",
      id: ids.projectId,
      outcomeStatement: "Deliver, rent, retrieve, and reconcile one dump trailer",
      ownerUserId: userId,
      primaryContactId: ids.contactId,
      projectNumber: `PRJ-${ids.projectId}`,
      requiredDepositCents: 15_000,
      serviceLocationId: ids.locationId,
      serviceType: "dump_trailer_rental",
      status: "planning",
      tenantId,
    });
    await transaction.insert(jobs).values({
      id: ids.jobId,
      jobNumber: `DTR-${ids.jobId}`,
      projectId: ids.projectId,
      serviceType: "dump_trailer_rental",
      status: "planning",
      tenantId,
    });
    await transaction.insert(assets).values([
      {
        assetNumber: `TRL-${ids.trailerId}`,
        assetType: "trailer",
        capacityVolumeCubicYards: "14.000",
        capacityWeight: "14000.000",
        id: ids.trailerId,
        name: "Fourteen yard dump trailer",
        tenantId,
      },
      {
        assetNumber: `TRK-${ids.truckId}`,
        assetType: "truck",
        capacityWeight: "20000.000",
        id: ids.truckId,
        name: "Rental tow truck",
        tenantId,
      },
    ]);
    await transaction.insert(suppliers).values({
      id: ids.disposalSupplierId,
      name: `${prefix} Disposal Facility`,
      normalizedName: `${prefix} disposal facility`,
      tenantId,
    });
    await transaction.insert(supplierLocations).values({
      addressSummary: "2200 Landfill Road, Lincoln, NE",
      id: ids.disposalLocationId,
      label: "Public scale house",
      supplierId: ids.disposalSupplierId,
      tenantId,
    });
    const evidenceDocuments: { filename: string; id: string }[] = [
      { filename: "scale-ticket.pdf", id: ids.ticketDocumentId },
      { filename: "disposal-receipt.pdf", id: ids.receiptDocumentId },
      { filename: "empty-trailer.jpg", id: ids.emptyTrailerDocumentId },
      { filename: "post-rental-inspection.jpg", id: ids.inspectionDocumentId },
    ];
    await transaction.insert(documents).values(
      evidenceDocuments.map(({ filename, id }, index) => ({
        availableAt: new Date(),
        id,
        mediaType: filename.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
        objectKey: `${tenantId}/${id}`,
        storageLocator: `${tenantId}/${id}`,
        originalFilename: filename,
        sha256: String(index + 1).repeat(64),
        sizeBytes: 1_024,
        status: "available",
        tenantId,
      })),
    );
  });
  return {
    disposalLocationId: ids.disposalLocationId,
    emptyTrailerDocumentId: ids.emptyTrailerDocumentId,
    inspectionDocumentId: ids.inspectionDocumentId,
    jobId: ids.jobId,
    quoteVersionId: ids.quoteVersionId,
    receiptDocumentId: ids.receiptDocumentId,
    ticketDocumentId: ids.ticketDocumentId,
    trailerId: ids.trailerId,
    truckId: ids.truckId,
  };
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Rental integration tests`);
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
