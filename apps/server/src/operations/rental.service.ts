import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  assetAssignments,
  assetReservations,
  assets,
  auditEvents,
  documents,
  disposalLoads,
  dumpTrailerRentalDetails,
  estimateVersions,
  expenses,
  jobAssignments,
  jobEvents,
  jobCharges,
  jobs,
  operationalHolds,
  outboxEvents,
  projects,
  quoteVersions,
  readinessEvaluations,
  rentalDebrisReviews,
  rentalExtensions,
  rentalInspections,
  rentalPickupAttempts,
  routeStops,
  scheduleBlocks,
  supplierLocations,
  suppliers,
  users,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { DocumentsService } from "../documents/documents.service.js";
import { ApiException } from "../errors/api.exception.js";
import {
  hashCanonicalPayload,
  IdempotentCommandService,
} from "../idempotency/idempotent-command.service.js";
import type {
  CompleteRentalInspectionDto,
  CreateDisposalLoadDto,
  CreateRentalDebrisReviewDto,
  CreateRentalExtensionDto,
  CreateRentalInspectionDto,
  CreateRentalPickupAttemptDto,
  DisposalLoadExecutionDto,
  DumpTrailerRentalDto,
  EvaluateRentalReadinessDto,
  PlanRentalScheduleDto,
  RecordDisposalEvidenceDto,
  RentalDecisionDto,
  RentalExecutionDto,
  RentalExtensionActionDto,
  RentalExtensionDto,
  RentalInspectionDto,
  RentalPickupActionDto,
  RentalReadinessDto,
  SaveRentalPlanDto,
} from "./rental.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

export const rentalDebrisDecisionActions = ["approve", "hold", "reject"] as const;
export type RentalDebrisDecisionAction = (typeof rentalDebrisDecisionActions)[number];

export const rentalDropoffActions = [
  "prepare-dropoff",
  "depart-dropoff",
  "arrive-dropoff",
  "complete-dropoff",
  "begin-rental",
] as const;
export type RentalDropoffAction = (typeof rentalDropoffActions)[number];

export const rentalExtensionActions = [
  "evaluate",
  "authorize",
  "approve",
  "reject",
  "cancel",
] as const;
export type RentalExtensionAction = (typeof rentalExtensionActions)[number];

export const rentalPickupActions = ["prepare", "depart", "arrive", "fail", "retrieve"] as const;
export type RentalPickupAction = (typeof rentalPickupActions)[number];

export const rentalDisposalActions = [
  "depart",
  "arrive",
  "accept",
  "reject",
  "redirect",
  "record-weight",
  "start-unloading",
  "complete-unloading",
  "cancel",
] as const;
export type RentalDisposalAction = (typeof rentalDisposalActions)[number];

@Injectable()
export class RentalService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(DocumentsService) private readonly documentService: DocumentsService,
  ) {}

  public async get(jobId: string): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.getDetail(transaction, actor.tenantId, jobId),
    );
  }

  public async savePlan(
    jobId: string,
    input: SaveRentalPlanDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "rentals.save-plan" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        this.assertRentalJob(job);
        if (!["planning", "needs_scheduling"].includes(job.status)) {
          throw conflict(
            "RENTAL_PLAN_LOCKED",
            "The Rental plan cannot be changed in this Job state",
          );
        }
        const plannedDropoffAt = new Date(input.plannedDropoffAt);
        const plannedPickupAt = new Date(input.plannedPickupAt);
        if (plannedPickupAt <= plannedDropoffAt) {
          throw badRequest(
            "RENTAL_PLAN_RANGE_INVALID",
            "Planned pickup must be after planned drop-off",
          );
        }
        const trailer = await this.requireAvailableAsset(
          transaction,
          actor.tenantId,
          input.trailerAssetId,
          "trailer",
        );
        const [existing] = await transaction
          .select()
          .from(dumpTrailerRentalDetails)
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.jobId, jobId),
            ),
          )
          .for("update");
        if (existing && existing.status !== "planning") {
          throw conflict("RENTAL_PLAN_LOCKED", "The Rental plan is locked after scheduling");
        }
        if (existing) {
          const activeBlock = await transaction
            .select({ id: scheduleBlocks.id })
            .from(scheduleBlocks)
            .where(
              and(
                eq(scheduleBlocks.tenantId, actor.tenantId),
                eq(scheduleBlocks.jobId, jobId),
                inArray(scheduleBlocks.status, ["tentative", "confirmed"]),
              ),
            )
            .limit(1);
          const activeReservation = await transaction
            .select({ id: assetReservations.id })
            .from(assetReservations)
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.jobId, jobId),
                eq(assetReservations.status, "active"),
              ),
            )
            .limit(1);
          if (activeBlock[0] || activeReservation[0]) {
            throw conflict(
              "RENTAL_PLAN_HAS_SCHEDULE",
              "Cancel active Rental scheduling resources before revising the plan",
            );
          }
          await transaction
            .update(dumpTrailerRentalDetails)
            .set({
              accessReviewStatus: "pending",
              debrisReviewStatus: "pending",
              plannedDropoffAt,
              plannedPickupAt,
              trailerAssetId: trailer.id,
              trailerSnapshot: assetSnapshot(trailer),
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
                eq(dumpTrailerRentalDetails.id, existing.id),
              ),
            );
          await this.emitChange(transaction, actor, {
            after: { plannedDropoffAt, plannedPickupAt, trailerAssetId: trailer.id },
            before: {
              plannedDropoffAt: existing.plannedDropoffAt,
              plannedPickupAt: existing.plannedPickupAt,
              trailerAssetId: existing.trailerAssetId,
            },
            commandName: "ReviseRentalPlan",
            entityId: existing.id,
            entityType: "DumpTrailerRentalDetail",
            eventType: "rental.plan_revised",
            jobId,
            summary: "Dump Trailer Rental plan revised",
          });
        } else {
          const terms = await this.acceptedTerms(transaction, actor.tenantId, job);
          const [created] = await transaction
            .insert(dumpTrailerRentalDetails)
            .values({
              acceptedQuoteVersionId: terms.quoteVersionId,
              acceptedTermsHash: terms.hash,
              acceptedTermsSnapshot: terms.snapshot,
              additionalDayRateCents: terms.additionalDayRateCents,
              createdBy: actor.userId,
              depositAmountCents: terms.depositAmountCents,
              depositClassification: terms.depositAmountCents > 0 ? "refundable_security" : "none",
              includedDays: terms.includedDays,
              includedWeightPounds: terms.includedWeightPounds,
              jobId,
              overageRateCentsPerPound: terms.overageRateCentsPerPound,
              plannedDropoffAt,
              plannedPickupAt,
              rateType: rateType(terms.includedDays),
              tenantId: actor.tenantId,
              trailerAssetId: trailer.id,
              trailerSnapshot: assetSnapshot(trailer),
              updatedBy: actor.userId,
            })
            .returning();
          if (!created) throw new Error("Rental Detail was not created");
          await this.emitChange(transaction, actor, {
            after: {
              acceptedTermsHash: created.acceptedTermsHash,
              plannedDropoffAt,
              plannedPickupAt,
              trailerAssetId: trailer.id,
            },
            commandName: "CreateRentalPlan",
            entityId: created.id,
            entityType: "DumpTrailerRentalDetail",
            eventType: "rental.plan_created",
            jobId,
            summary: "Dump Trailer Rental plan created from accepted terms",
          });
        }
        await transaction
          .update(jobs)
          .set({ readiness: "evaluation_required", updatedBy: actor.userId })
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
        return {
          body: await this.getDetail(transaction, actor.tenantId, jobId),
          status: existing ? HttpStatus.OK : HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async revisePlan(
    rentalDetailId: string,
    input: SaveRentalPlanDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const jobId = await withTenantTransaction(
      this.database,
      actor.tenantId,
      async (transaction) => {
        const [detail] = await transaction
          .select({ jobId: dumpTrailerRentalDetails.jobId })
          .from(dumpTrailerRentalDetails)
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, rentalDetailId),
            ),
          );
        if (!detail) throw notFound("RENTAL_NOT_FOUND", "Dump Trailer Rental was not found");
        return detail.jobId;
      },
    );
    return this.savePlan(jobId, input, key);
  }

  public async createDebrisReview(
    rentalDetailId: string,
    input: CreateRentalDebrisReviewDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.create-debris-review" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        if (!["planning", "scheduled_dropoff"].includes(context.detail.status)) {
          throw conflict(
            "RENTAL_DEBRIS_REVIEW_LOCKED",
            "Debris and access review cannot be revised after drop-off execution begins",
          );
        }
        if (input.customerAttested && !input.customerAttestation?.trim()) {
          throw badRequest(
            "RENTAL_ATTESTATION_REQUIRED",
            "Customer attestation text is required when attestation is confirmed",
          );
        }
        const reviews = await transaction
          .select()
          .from(rentalDebrisReviews)
          .where(
            and(
              eq(rentalDebrisReviews.tenantId, actor.tenantId),
              eq(rentalDebrisReviews.rentalDetailId, rentalDetailId),
            ),
          )
          .orderBy(desc(rentalDebrisReviews.reviewNumber));
        const open = reviews.find((review) => review.status === "pending");
        if (open) {
          throw conflict(
            "RENTAL_DEBRIS_REVIEW_OPEN",
            "Decide or supersede the current debris review before creating another",
          );
        }
        const [created] = await transaction
          .insert(rentalDebrisReviews)
          .values({
            accessStatus: input.accessStatus,
            createdBy: actor.userId,
            customerAttestation: optionalTrim(input.customerAttestation),
            customerAttested: input.customerAttested,
            customerAttestedAt: input.customerAttested ? new Date() : null,
            heavyMaterial: input.heavyMaterial,
            jobId: context.job.id,
            legalTowingStatus: input.legalTowingStatus,
            mixedDebris: input.mixedDebris,
            pickupAccessRequirement: optionalTrim(input.pickupAccessRequirement),
            placementInstructions: optionalTrim(input.placementInstructions),
            primaryDebrisType: input.primaryDebrisType.trim(),
            prohibitedMaterials: cleanList(input.prohibitedMaterials),
            propertyDamageRisk: optionalTrim(input.propertyDamageRisk),
            rentalDetailId,
            restrictedMaterials: cleanList(input.restrictedMaterials),
            reviewNumber: (reviews[0]?.reviewNumber ?? 0) + 1,
            secondaryDebrisTypes: cleanList(input.secondaryDebrisTypes),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Rental Debris Review was not created");
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({
            accessReviewStatus: "pending",
            debrisReviewStatus: "pending",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, rentalDetailId),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: { reviewNumber: created.reviewNumber, status: created.status },
          commandName: "CreateRentalDebrisReview",
          entityId: created.id,
          entityType: "RentalDebrisReview",
          eventType: "rental.debris_review_created",
          jobId: context.job.id,
          summary: "Rental debris and access review created",
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async decideDebrisReview(
    reviewId: string,
    action: RentalDebrisDecisionAction,
    input: RentalDecisionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, input, reviewId }, scope: `rentals.debris-review.${action}` },
      async (transaction) => {
        const [reference] = await transaction
          .select({ rentalDetailId: rentalDebrisReviews.rentalDetailId })
          .from(rentalDebrisReviews)
          .where(
            and(
              eq(rentalDebrisReviews.tenantId, actor.tenantId),
              eq(rentalDebrisReviews.id, reviewId),
            ),
          );
        if (!reference)
          throw notFound("RENTAL_DEBRIS_REVIEW_NOT_FOUND", "Debris review was not found");
        const context = await this.lockDetail(
          transaction,
          actor.tenantId,
          reference.rentalDetailId,
        );
        const [review] = await transaction
          .select()
          .from(rentalDebrisReviews)
          .where(
            and(
              eq(rentalDebrisReviews.tenantId, actor.tenantId),
              eq(rentalDebrisReviews.id, reviewId),
            ),
          )
          .for("update");
        if (!review)
          throw notFound("RENTAL_DEBRIS_REVIEW_NOT_FOUND", "Debris review was not found");
        if (review.status !== "pending") {
          throw conflict("RENTAL_DEBRIS_REVIEW_DECIDED", "Debris review has already been decided");
        }
        if (action === "approve") {
          const blockers: string[] = [];
          if (!review.customerAttested) blockers.push("Customer debris attestation is missing");
          if (review.prohibitedMaterials.length > 0)
            blockers.push("Prohibited material is present");
          if (review.accessStatus !== "pass") blockers.push("Placement access is not approved");
          if (review.legalTowingStatus !== "pass")
            blockers.push("Legal towing review is not approved");
          if (blockers.length > 0) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "RENTAL_DEBRIS_REVIEW_NOT_APPROVABLE",
              "Debris review has unresolved blockers",
              { blockers },
            );
          }
        }
        const now = new Date();
        const nextStatus =
          action === "reject" ? "rejected" : action === "hold" ? "hold" : "approved";
        await transaction
          .update(rentalDebrisReviews)
          .set({
            outcomeNotes: input.reason.trim(),
            reviewedAt: now,
            reviewedBy: actor.userId,
            status: nextStatus,
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(rentalDebrisReviews.tenantId, actor.tenantId),
              eq(rentalDebrisReviews.id, reviewId),
            ),
          );
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({
            accessReviewStatus:
              action === "approve" ? "pass" : review.accessStatus === "fail" ? "fail" : "pending",
            debrisReviewStatus: nextStatus,
            status: context.detail.status,
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, review.rentalDetailId),
            ),
          );
        if (action !== "approve") {
          if (context.job.status !== "on_hold") {
            await transaction.insert(operationalHolds).values({
              createdBy: actor.userId,
              jobId: context.job.id,
              placedBy: actor.userId,
              previousStatus: context.job.status,
              reason: input.reason.trim(),
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            });
            await transaction
              .update(jobs)
              .set({ readiness: "not_ready", status: "on_hold", updatedBy: actor.userId })
              .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, context.job.id)));
          }
        } else {
          await transaction
            .update(jobs)
            .set({ readiness: "evaluation_required", updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, context.job.id)));
        }
        await this.emitChange(transaction, actor, {
          after: { outcomeNotes: input.reason.trim(), status: nextStatus },
          before: { status: review.status },
          commandName: `${capitalize(action)}RentalDebrisReview`,
          entityId: review.id,
          entityType: "RentalDebrisReview",
          eventType: `rental.debris_review_${nextStatus}`,
          jobId: context.job.id,
          summary: `Rental debris review ${nextStatus}`,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async planSchedule(
    rentalDetailId: string,
    input: PlanRentalScheduleDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    try {
      const result = await this.idempotency.execute(
        { key, payload: { input, rentalDetailId }, scope: "rentals.plan-schedule" },
        async (transaction) => {
          const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
          if (
            context.detail.status !== "planning" ||
            !["planning", "needs_scheduling"].includes(context.job.status)
          ) {
            throw conflict(
              "RENTAL_SCHEDULE_LOCKED",
              "Rental scheduling is not available in this state",
            );
          }
          if (
            context.detail.debrisReviewStatus !== "approved" ||
            context.detail.accessReviewStatus !== "pass"
          ) {
            throw conflict(
              "RENTAL_REVIEW_REQUIRED",
              "Approved debris, access, and towing review is required before scheduling",
            );
          }
          if (!context.detail.trailerAssetId) {
            throw conflict(
              "RENTAL_TRAILER_REQUIRED",
              "A trailer must be selected before scheduling",
            );
          }
          const times = scheduleTimes(input);
          assertContains(
            times.dropoffStartsAt,
            times.dropoffEndsAt,
            context.detail.plannedDropoffAt,
            "drop-off",
          );
          assertContains(
            times.pickupStartsAt,
            times.pickupEndsAt,
            context.detail.plannedPickupAt,
            "pickup",
          );
          if (times.pickupStartsAt <= times.dropoffEndsAt) {
            throw badRequest(
              "RENTAL_SCHEDULE_RANGE_INVALID",
              "Pickup must begin after drop-off ends",
            );
          }
          const existing = await transaction
            .select({ id: scheduleBlocks.id })
            .from(scheduleBlocks)
            .where(
              and(
                eq(scheduleBlocks.tenantId, actor.tenantId),
                eq(scheduleBlocks.jobId, context.job.id),
                inArray(scheduleBlocks.status, ["tentative", "confirmed"]),
              ),
            )
            .limit(1);
          if (existing[0]) {
            throw conflict(
              "RENTAL_SCHEDULE_EXISTS",
              "Active scheduling already exists for this Rental",
            );
          }
          const dropoffDriver = await this.requireActiveUser(
            transaction,
            actor.tenantId,
            input.dropoffDriverUserId,
          );
          const pickupDriver = await this.requireActiveUser(
            transaction,
            actor.tenantId,
            input.pickupDriverUserId,
          );
          const dropoffTruck = await this.requireAvailableAsset(
            transaction,
            actor.tenantId,
            input.dropoffTruckAssetId,
            "truck",
          );
          const pickupTruck = await this.requireAvailableAsset(
            transaction,
            actor.tenantId,
            input.pickupTruckAssetId,
            "truck",
          );
          const trailer = await this.requireAvailableAsset(
            transaction,
            actor.tenantId,
            context.detail.trailerAssetId,
            "trailer",
          );
          const [acceptedQuote] = await transaction
            .select({ quote: quoteVersions })
            .from(projects)
            .innerJoin(
              quoteVersions,
              and(
                eq(quoteVersions.tenantId, projects.tenantId),
                eq(quoteVersions.id, projects.acceptedQuoteVersionId),
              ),
            )
            .where(
              and(eq(projects.tenantId, actor.tenantId), eq(projects.id, context.job.projectId)),
            );
          if (!acceptedQuote) throw new Error("Accepted Quote Version was not found");
          const quote = acceptedQuote.quote;
          const [dropoffBlock, pickupBlock] = await transaction
            .insert(scheduleBlocks)
            .values([
              {
                blockType: "dropoff",
                createdBy: actor.userId,
                endsAt: times.dropoffEndsAt,
                jobId: context.job.id,
                startsAt: times.dropoffStartsAt,
                tenantId: actor.tenantId,
                updatedBy: actor.userId,
              },
              {
                blockType: "pickup",
                createdBy: actor.userId,
                endsAt: times.pickupEndsAt,
                jobId: context.job.id,
                startsAt: times.pickupStartsAt,
                tenantId: actor.tenantId,
                updatedBy: actor.userId,
              },
            ])
            .returning();
          if (!dropoffBlock || !pickupBlock)
            throw new Error("Rental Schedule Blocks were not created");
          await transaction.insert(assetReservations).values([
            {
              assetId: dropoffTruck.id,
              createdBy: actor.userId,
              endsAt: times.dropoffEndsAt,
              jobId: context.job.id,
              scheduleBlockId: dropoffBlock.id,
              startsAt: times.dropoffStartsAt,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            },
            {
              assetId: pickupTruck.id,
              createdBy: actor.userId,
              endsAt: times.pickupEndsAt,
              jobId: context.job.id,
              scheduleBlockId: pickupBlock.id,
              startsAt: times.pickupStartsAt,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            },
            {
              assetId: trailer.id,
              createdBy: actor.userId,
              endsAt: context.detail.plannedPickupAt,
              jobId: context.job.id,
              reservationType: "occupancy",
              startsAt: context.detail.plannedDropoffAt,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            },
          ]);
          await transaction
            .insert(assetAssignments)
            .values([
              assignment(actor, context.job.id, dropoffBlock.id, dropoffTruck.id, "truck"),
              assignment(actor, context.job.id, dropoffBlock.id, trailer.id, "trailer"),
              assignment(actor, context.job.id, pickupBlock.id, pickupTruck.id, "truck"),
              assignment(actor, context.job.id, pickupBlock.id, trailer.id, "trailer"),
            ]);
          await transaction
            .insert(jobAssignments)
            .values([
              driverAssignment(actor, context.job.id, dropoffBlock.id, dropoffDriver.id),
              driverAssignment(actor, context.job.id, pickupBlock.id, pickupDriver.id),
            ]);
          await transaction.insert(routeStops).values([
            {
              createdBy: actor.userId,
              jobId: context.job.id,
              label: "Customer trailer drop-off",
              locationSnapshot: quote.locationSnapshot,
              scheduleBlockId: dropoffBlock.id,
              sequence: 1,
              stopType: "dropoff",
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            },
            {
              createdBy: actor.userId,
              jobId: context.job.id,
              label: "Customer trailer pickup",
              locationSnapshot: quote.locationSnapshot,
              scheduleBlockId: pickupBlock.id,
              sequence: 2,
              stopType: "pickup",
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            },
          ]);
          await transaction
            .update(jobs)
            .set({
              readiness: "evaluation_required",
              status: "needs_scheduling",
              updatedBy: actor.userId,
            })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, context.job.id)));
          await this.emitChange(transaction, actor, {
            after: {
              dropoffBlockId: dropoffBlock.id,
              occupancyTrailerAssetId: trailer.id,
              pickupBlockId: pickupBlock.id,
            },
            commandName: "PlanRentalSchedule",
            entityId: rentalDetailId,
            entityType: "DumpTrailerRentalDetail",
            eventType: "rental.schedule_planned",
            jobId: context.job.id,
            summary: "Rental drop-off, pickup, and trailer occupancy planned",
          });
          return {
            body: await this.getDetail(transaction, actor.tenantId, context.job.id),
            status: HttpStatus.CREATED,
          };
        },
      );
      return result.body;
    } catch (error) {
      if (databaseCode(error) === "23P01") {
        throw conflict(
          "RENTAL_ASSET_CONFLICT",
          "A selected truck or trailer is unavailable during the requested window",
        );
      }
      throw error;
    }
  }

  public async evaluateReadiness(
    rentalDetailId: string,
    input: EvaluateRentalReadinessDto,
    key: string,
  ): Promise<RentalReadinessDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.evaluate-readiness" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        return {
          body: await this.evaluate(
            transaction,
            actor,
            context.job,
            context.detail,
            input.readinessType,
            true,
          ),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createInspection(
    rentalDetailId: string,
    input: CreateRentalInspectionDto,
    key: string,
  ): Promise<RentalInspectionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.create-inspection" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        if (!context.detail.trailerAssetId) {
          throw conflict("RENTAL_TRAILER_REQUIRED", "A trailer is required before inspection");
        }
        const postRental = input.inspectionType === "post_rental";
        const validState = postRental
          ? context.detail.status === "inspection_required" && context.job.status === "active"
          : ["scheduled_dropoff", "dropoff_preparing"].includes(context.detail.status);
        if (!validState) {
          throw conflict(
            "RENTAL_INSPECTION_INVALID_STATE",
            postRental
              ? "Post-rental inspection requires reconciled disposal and an active Job"
              : "Pre-drop-off inspection requires a scheduled Rental",
          );
        }
        const evidence = input.evidenceDocumentId
          ? await this.requireDocument(transaction, actor.tenantId, input.evidenceDocumentId)
          : null;
        const prior = await transaction
          .select()
          .from(rentalInspections)
          .where(
            and(
              eq(rentalInspections.tenantId, actor.tenantId),
              eq(rentalInspections.rentalDetailId, rentalDetailId),
            ),
          )
          .orderBy(desc(rentalInspections.inspectionNumber));
        if (
          prior.some(
            (inspection) =>
              inspection.inspectionType === input.inspectionType &&
              ["pending", "in_progress"].includes(inspection.status),
          )
        ) {
          throw conflict(
            "RENTAL_INSPECTION_OPEN",
            "Complete the open inspection before creating another of the same type",
          );
        }
        const [created] = await transaction
          .insert(rentalInspections)
          .values({
            createdBy: actor.userId,
            evidenceDocumentId: evidence?.id ?? null,
            evidenceSnapshot: evidence ? documentSnapshot(evidence) : {},
            inspectionNumber: (prior[0]?.inspectionNumber ?? 0) + 1,
            inspectionType: input.inspectionType,
            jobId: context.job.id,
            rentalDetailId,
            tenantId: actor.tenantId,
            trailerAssetId: context.detail.trailerAssetId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Rental Inspection was not created");
        await this.emitChange(transaction, actor, {
          after: {
            inspectionNumber: created.inspectionNumber,
            inspectionType: created.inspectionType,
          },
          commandName: "CreateRentalInspection",
          entityId: created.id,
          entityType: "RentalInspection",
          eventType: "rental.inspection_created",
          jobId: context.job.id,
          summary: `${postRental ? "Post-rental" : "Pre-drop-off"} trailer inspection created`,
        });
        return { body: inspectionDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async completeInspection(
    inspectionId: string,
    input: CompleteRentalInspectionDto,
    key: string,
  ): Promise<RentalInspectionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, inspectionId }, scope: "rentals.complete-inspection" },
      async (transaction) => {
        const [reference] = await transaction
          .select({ rentalDetailId: rentalInspections.rentalDetailId })
          .from(rentalInspections)
          .where(
            and(
              eq(rentalInspections.tenantId, actor.tenantId),
              eq(rentalInspections.id, inspectionId),
            ),
          );
        if (!reference)
          throw notFound("RENTAL_INSPECTION_NOT_FOUND", "Rental inspection was not found");
        const context = await this.lockDetail(
          transaction,
          actor.tenantId,
          reference.rentalDetailId,
        );
        const [inspection] = await transaction
          .select()
          .from(rentalInspections)
          .where(
            and(
              eq(rentalInspections.tenantId, actor.tenantId),
              eq(rentalInspections.id, inspectionId),
            ),
          )
          .for("update");
        if (!inspection)
          throw notFound("RENTAL_INSPECTION_NOT_FOUND", "Rental inspection was not found");
        const postRental = inspection.inspectionType === "post_rental";
        const validState = postRental
          ? context.detail.status === "inspection_required" && context.job.status === "active"
          : ["scheduled", "dispatch_ready"].includes(context.job.status);
        if (!validState) {
          throw conflict(
            "RENTAL_INSPECTION_INVALID_STATE",
            postRental
              ? "Post-rental inspection requires reconciled disposal and an active Job"
              : "Pre-drop-off inspection can only complete before Job execution starts",
          );
        }
        if (!["pending", "in_progress"].includes(inspection.status)) {
          throw conflict("RENTAL_INSPECTION_COMPLETED", "Rental inspection is already complete");
        }
        const acceptableCondition = postRental
          ? input.conditionResult === "acceptable" ||
            (input.conditionResult === "acceptable_after_cleaning" &&
              input.cleaningResult === "completed")
          : input.conditionResult === "acceptable";
        const releasable =
          input.releaseDecision === "release" &&
          input.safeToRelease &&
          acceptableCondition &&
          ["none", "resolved"].includes(input.damageResult) &&
          input.cleaningResult !== "required";
        if (
          (input.releaseDecision === "release") !== releasable ||
          (input.releaseDecision !== "release" && input.safeToRelease)
        ) {
          throw badRequest(
            "RENTAL_INSPECTION_RELEASE_INVALID",
            "Release requires an acceptable, clean, resolved-damage, safe trailer; other outcomes cannot be safe to release",
          );
        }
        const evidence = input.evidenceDocumentId
          ? await this.requireDocument(transaction, actor.tenantId, input.evidenceDocumentId)
          : inspection.evidenceDocumentId
            ? await this.requireDocument(transaction, actor.tenantId, inspection.evidenceDocumentId)
            : null;
        if (postRental && !evidence) {
          throw badRequest(
            "RENTAL_POST_INSPECTION_EVIDENCE_REQUIRED",
            "Post-rental inspection requires condition evidence",
          );
        }
        const completedAt = new Date(
          Math.max(Date.now(), context.detail.customerCustodyEndedAt?.getTime() ?? 0),
        );
        let occupancy: typeof assetReservations.$inferSelect | undefined;
        if (postRental) {
          [occupancy] = await transaction
            .select()
            .from(assetReservations)
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.jobId, context.job.id),
                eq(assetReservations.assetId, inspection.trailerAssetId),
                eq(assetReservations.reservationType, "occupancy"),
                eq(assetReservations.status, "active"),
              ),
            )
            .for("update");
          if (!occupancy) {
            throw conflict(
              "RENTAL_OCCUPANCY_REQUIRED",
              "Active trailer occupancy is required for post-rental release",
            );
          }
        }
        const [updated] = await transaction
          .update(rentalInspections)
          .set({
            cleaningResult: input.cleaningResult,
            completedAt,
            conditionResult: input.conditionResult,
            damageResult: input.damageResult,
            evidenceDocumentId: evidence?.id ?? null,
            evidenceSnapshot: evidence ? documentSnapshot(evidence) : {},
            inspectedAt: completedAt,
            inspectedBy: actor.userId,
            notes: input.notes.trim(),
            releaseDecision: input.releaseDecision,
            safeToRelease: input.safeToRelease,
            status: "completed",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(rentalInspections.tenantId, actor.tenantId),
              eq(rentalInspections.id, inspectionId),
            ),
          )
          .returning();
        if (!updated) throw new Error("Rental Inspection was not completed");
        if (evidence) {
          await this.documentService.linkAvailableToEntity(transaction, {
            actorUserId: actor.userId,
            documentId: evidence.id,
            entityId: inspection.id,
            entityType: "RentalInspection",
            purpose: postRental ? "post_rental_condition" : "pre_dropoff_condition",
            tenantId: actor.tenantId,
          });
        }
        if (postRental && occupancy) {
          await transaction
            .update(assetReservations)
            .set({ releasedAt: completedAt, status: "released", updatedBy: actor.userId })
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.id, occupancy.id),
              ),
            );
          await transaction
            .update(dumpTrailerRentalDetails)
            .set({
              finalCondition: input.conditionResult,
              occupancyReleasedAt: completedAt,
              status: "returned",
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
                eq(dumpTrailerRentalDetails.id, context.detail.id),
              ),
            );
        }
        if (postRental || input.releaseDecision === "out_of_service") {
          await transaction
            .update(assets)
            .set({
              status: input.releaseDecision === "release" ? "available" : "out_of_service",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(assets.tenantId, actor.tenantId), eq(assets.id, inspection.trailerAssetId)),
            );
        }
        if (!postRental) {
          await transaction
            .update(jobs)
            .set({ readiness: "evaluation_required", updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, inspection.jobId)));
        }
        await this.emitChange(transaction, actor, {
          after: {
            conditionResult: input.conditionResult,
            releaseDecision: input.releaseDecision,
            safeToRelease: input.safeToRelease,
          },
          before: { status: inspection.status },
          commandName: "CompleteRentalInspection",
          entityId: inspection.id,
          entityType: "RentalInspection",
          eventType: "rental.inspection_completed",
          jobId: inspection.jobId,
          summary: `${postRental ? "Post-rental" : "Pre-drop-off"} inspection completed: ${input.releaseDecision}`,
        });
        return { body: inspectionDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async transitionDropoff(
    rentalDetailId: string,
    action: RentalDropoffAction,
    input: RentalExecutionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, input, rentalDetailId }, scope: `rentals.dropoff.${action}` },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        const transition = dropoffTransitions[action];
        if (context.detail.status !== transition.from) {
          throw conflict(
            "RENTAL_DROPOFF_TRANSITION_INVALID",
            `Rental must be ${transition.from} before ${action}`,
          );
        }
        if (action === "prepare-dropoff" && context.job.status !== "dispatch_ready") {
          throw conflict(
            "RENTAL_JOB_NOT_DISPATCH_READY",
            "Job must be dispatch ready before preparing drop-off",
          );
        }
        if (action !== "prepare-dropoff" && context.job.status !== "active") {
          throw conflict("RENTAL_JOB_NOT_ACTIVE", "Job must be active for drop-off execution");
        }
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        if (action === "complete-dropoff") {
          const [inspection] = await transaction
            .select()
            .from(rentalInspections)
            .where(
              and(
                eq(rentalInspections.tenantId, actor.tenantId),
                eq(rentalInspections.rentalDetailId, rentalDetailId),
                eq(rentalInspections.inspectionType, "pre_dropoff"),
                eq(rentalInspections.status, "completed"),
                eq(rentalInspections.releaseDecision, "release"),
                eq(rentalInspections.safeToRelease, true),
              ),
            )
            .orderBy(desc(rentalInspections.inspectionNumber))
            .limit(1);
          if (!inspection) {
            throw conflict(
              "RENTAL_PRE_DROPOFF_INSPECTION_REQUIRED",
              "A completed safe-release inspection is required before drop-off completion",
            );
          }
        }
        const timestamps: Partial<typeof dumpTrailerRentalDetails.$inferInsert> = {};
        if (action === "complete-dropoff") timestamps.actualDropoffAt = occurredAt;
        if (action === "begin-rental") timestamps.onRentAt = occurredAt;
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({ ...timestamps, status: transition.to, updatedBy: actor.userId })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, rentalDetailId),
            ),
          );
        const [dropoffStop] = await transaction
          .select()
          .from(routeStops)
          .where(
            and(
              eq(routeStops.tenantId, actor.tenantId),
              eq(routeStops.jobId, context.job.id),
              eq(routeStops.stopType, "dropoff"),
            ),
          )
          .limit(1);
        if (dropoffStop && action === "arrive-dropoff") {
          await transaction
            .update(routeStops)
            .set({ arrivedAt: occurredAt, status: "arrived", updatedBy: actor.userId })
            .where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.id, dropoffStop.id)));
        }
        if (dropoffStop && action === "complete-dropoff") {
          await transaction
            .update(routeStops)
            .set({ completedAt: occurredAt, status: "completed", updatedBy: actor.userId })
            .where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.id, dropoffStop.id)));
          if (dropoffStop.scheduleBlockId) {
            await transaction
              .update(scheduleBlocks)
              .set({ completedAt: occurredAt, status: "completed", updatedBy: actor.userId })
              .where(
                and(
                  eq(scheduleBlocks.tenantId, actor.tenantId),
                  eq(scheduleBlocks.id, dropoffStop.scheduleBlockId),
                ),
              );
          }
        }
        if (action === "begin-rental" && context.detail.trailerAssetId) {
          const [occupancy] = await transaction
            .select()
            .from(assetReservations)
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.jobId, context.job.id),
                eq(assetReservations.assetId, context.detail.trailerAssetId),
                eq(assetReservations.reservationType, "occupancy"),
                eq(assetReservations.status, "active"),
              ),
            )
            .limit(1);
          if (!occupancy) {
            throw conflict(
              "RENTAL_OCCUPANCY_REQUIRED",
              "Active trailer occupancy is required before customer custody begins",
            );
          }
          await transaction
            .update(assets)
            .set({ status: "in_use", updatedBy: actor.userId })
            .where(
              and(
                eq(assets.tenantId, actor.tenantId),
                eq(assets.id, context.detail.trailerAssetId),
              ),
            );
        }
        await this.emitChange(transaction, actor, {
          after: { occurredAt, status: transition.to },
          before: { status: context.detail.status },
          commandName: transition.commandName,
          entityId: rentalDetailId,
          entityType: "DumpTrailerRentalDetail",
          eventType: transition.eventType,
          jobId: context.job.id,
          metadata: input.notes?.trim() ? { notes: input.notes.trim() } : {},
          summary: transition.summary,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createExtension(
    rentalDetailId: string,
    input: CreateRentalExtensionDto,
    key: string,
  ): Promise<RentalExtensionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.create-extension" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        if (context.detail.status !== "on_rent" || context.job.status !== "active") {
          throw conflict(
            "RENTAL_EXTENSION_INVALID_STATE",
            "An extension can only be requested while the Rental is in customer custody",
          );
        }
        if (!context.detail.trailerAssetId) {
          throw conflict("RENTAL_TRAILER_REQUIRED", "Rental trailer is not selected");
        }
        const requestedPickupAt = new Date(input.requestedPickupAt);
        if (requestedPickupAt <= context.detail.plannedPickupAt) {
          throw badRequest(
            "RENTAL_EXTENSION_RANGE_INVALID",
            "Requested pickup must be after the current planned pickup",
          );
        }
        const open = await transaction
          .select({ id: rentalExtensions.id })
          .from(rentalExtensions)
          .where(
            and(
              eq(rentalExtensions.tenantId, actor.tenantId),
              eq(rentalExtensions.rentalDetailId, rentalDetailId),
              inArray(rentalExtensions.status, [
                "requested",
                "availability_review",
                "awaiting_customer_authorization",
                "awaiting_internal_approval",
              ]),
            ),
          )
          .limit(1);
        if (open[0]) {
          throw conflict(
            "RENTAL_EXTENSION_OPEN",
            "Decide the open Rental extension before requesting another",
          );
        }
        const [pickupBlock] = await transaction
          .select()
          .from(scheduleBlocks)
          .where(
            and(
              eq(scheduleBlocks.tenantId, actor.tenantId),
              eq(scheduleBlocks.jobId, context.job.id),
              eq(scheduleBlocks.blockType, "pickup"),
              eq(scheduleBlocks.status, "confirmed"),
            ),
          )
          .limit(1);
        if (!pickupBlock) {
          throw conflict(
            "RENTAL_PICKUP_SCHEDULE_REQUIRED",
            "A confirmed pickup block is required before requesting an extension",
          );
        }
        const [occupancy] = await transaction
          .select()
          .from(assetReservations)
          .where(
            and(
              eq(assetReservations.tenantId, actor.tenantId),
              eq(assetReservations.jobId, context.job.id),
              eq(assetReservations.assetId, context.detail.trailerAssetId),
              eq(assetReservations.reservationType, "occupancy"),
              eq(assetReservations.status, "active"),
            ),
          )
          .limit(1);
        if (!occupancy) {
          throw conflict(
            "RENTAL_OCCUPANCY_REQUIRED",
            "Active trailer occupancy is required before requesting an extension",
          );
        }
        const previous = await transaction
          .select({ extensionNumber: rentalExtensions.extensionNumber })
          .from(rentalExtensions)
          .where(
            and(
              eq(rentalExtensions.tenantId, actor.tenantId),
              eq(rentalExtensions.rentalDetailId, rentalDetailId),
            ),
          )
          .orderBy(desc(rentalExtensions.extensionNumber))
          .limit(1);
        const additionalDays = Math.ceil(
          (requestedPickupAt.getTime() - context.detail.plannedPickupAt.getTime()) /
            MILLISECONDS_PER_DAY,
        );
        const calculatedAmountCents = additionalDays * context.detail.additionalDayRateCents;
        if (!Number.isSafeInteger(calculatedAmountCents)) {
          throw badRequest(
            "RENTAL_EXTENSION_AMOUNT_OUT_OF_RANGE",
            "The calculated Extension amount exceeds the supported money range",
          );
        }
        const [created] = await transaction
          .insert(rentalExtensions)
          .values({
            additionalDays,
            calculatedAmountCents,
            createdBy: actor.userId,
            customerAuthorizationStatus: input.customerAuthorized ? "authorized" : "required",
            dedupeKey: key,
            extensionNumber: (previous[0]?.extensionNumber ?? 0) + 1,
            jobId: context.job.id,
            occupancyReservationId: occupancy.id,
            pickupScheduleBlockId: pickupBlock.id,
            previousPickupAt: context.detail.plannedPickupAt,
            rateCents: context.detail.additionalDayRateCents,
            rentalDetailId,
            requestedBy: actor.userId,
            requestedPickupAt,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Rental Extension was not created");
        await this.emitChange(transaction, actor, {
          after: {
            additionalDays,
            calculatedAmountCents: created.calculatedAmountCents,
            customerAuthorizationStatus: created.customerAuthorizationStatus,
            requestedPickupAt,
            status: created.status,
          },
          commandName: "RequestRentalExtension",
          entityId: created.id,
          entityType: "RentalExtension",
          eventType: "rental.extension_requested",
          jobId: context.job.id,
          summary: `Rental extension ${String(created.extensionNumber)} requested`,
        });
        return { body: extensionDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async transitionExtension(
    extensionId: string,
    action: RentalExtensionAction,
    input: RentalExtensionActionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    try {
      const result = await this.idempotency.execute(
        { key, payload: { action, extensionId, input }, scope: `rentals.extension.${action}` },
        async (transaction) => {
          const [reference] = await transaction
            .select({ rentalDetailId: rentalExtensions.rentalDetailId })
            .from(rentalExtensions)
            .where(
              and(
                eq(rentalExtensions.tenantId, actor.tenantId),
                eq(rentalExtensions.id, extensionId),
              ),
            );
          if (!reference) {
            throw notFound("RENTAL_EXTENSION_NOT_FOUND", "Rental Extension was not found");
          }
          const context = await this.lockDetail(
            transaction,
            actor.tenantId,
            reference.rentalDetailId,
          );
          const [extension] = await transaction
            .select()
            .from(rentalExtensions)
            .where(
              and(
                eq(rentalExtensions.tenantId, actor.tenantId),
                eq(rentalExtensions.id, extensionId),
              ),
            )
            .for("update");
          if (!extension) {
            throw notFound("RENTAL_EXTENSION_NOT_FOUND", "Rental Extension was not found");
          }
          if (["approved", "rejected", "cancelled"].includes(extension.status)) {
            throw conflict(
              "RENTAL_EXTENSION_DECIDED",
              "The Rental Extension has already reached a terminal state",
            );
          }
          if (
            !["reject", "cancel"].includes(action) &&
            (context.detail.status !== "on_rent" || context.job.status !== "active")
          ) {
            throw conflict(
              "RENTAL_EXTENSION_INVALID_STATE",
              "The Rental must be active and in customer custody for this extension action",
            );
          }
          const reason = input.reason.trim();
          let nextStatus: string;
          let eventType = `rental.extension_${action}`;
          let after: Record<string, unknown> = { reason };
          const now = new Date();

          if (action === "evaluate") {
            if (!["requested", "availability_review"].includes(extension.status)) {
              throw conflict(
                "RENTAL_EXTENSION_ACTION_INVALID",
                "Only a requested Extension can be evaluated",
              );
            }
            const availability = await this.evaluateExtensionAvailability(
              transaction,
              actor.tenantId,
              extension,
            );
            nextStatus = availability.conflicts.length
              ? "availability_review"
              : extension.customerAuthorizationStatus === "authorized"
                ? "awaiting_internal_approval"
                : "awaiting_customer_authorization";
            await transaction
              .update(rentalExtensions)
              .set({
                availabilitySnapshot: availability.snapshot,
                conflictStatus: availability.conflicts.length ? "fail" : "pass",
                status: nextStatus,
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(rentalExtensions.tenantId, actor.tenantId),
                  eq(rentalExtensions.id, extension.id),
                ),
              );
            after = {
              ...after,
              conflicts: availability.conflicts,
              conflictStatus: availability.conflicts.length ? "fail" : "pass",
              status: nextStatus,
            };
            eventType = "rental.extension_availability_evaluated";
          } else if (action === "authorize") {
            if (extension.status !== "awaiting_customer_authorization") {
              throw conflict(
                "RENTAL_EXTENSION_ACTION_INVALID",
                "Extension must await customer authorization before authorization is recorded",
              );
            }
            nextStatus = "awaiting_internal_approval";
            await transaction
              .update(rentalExtensions)
              .set({
                customerAuthorizationStatus: "authorized",
                status: nextStatus,
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(rentalExtensions.tenantId, actor.tenantId),
                  eq(rentalExtensions.id, extension.id),
                ),
              );
            after = {
              ...after,
              customerAuthorizationStatus: "authorized",
              status: nextStatus,
            };
            eventType = "rental.extension_authorized";
          } else if (action === "approve") {
            if (extension.status !== "awaiting_internal_approval") {
              throw conflict(
                "RENTAL_EXTENSION_ACTION_INVALID",
                "Extension must pass availability and customer authorization before approval",
              );
            }
            const availability = await this.evaluateExtensionAvailability(
              transaction,
              actor.tenantId,
              extension,
            );
            if (availability.conflicts.length > 0) {
              throw new ApiException(
                HttpStatus.CONFLICT,
                "RENTAL_EXTENSION_ASSET_CONFLICT",
                "The Rental Extension conflicts with another active Asset Reservation",
                { conflicts: availability.conflicts },
              );
            }
            const [pickupBlock] = await transaction
              .select()
              .from(scheduleBlocks)
              .where(
                and(
                  eq(scheduleBlocks.tenantId, actor.tenantId),
                  eq(scheduleBlocks.id, extension.pickupScheduleBlockId),
                  eq(scheduleBlocks.status, "confirmed"),
                ),
              )
              .for("update");
            const [occupancy] = await transaction
              .select()
              .from(assetReservations)
              .where(
                and(
                  eq(assetReservations.tenantId, actor.tenantId),
                  eq(assetReservations.id, extension.occupancyReservationId),
                  eq(assetReservations.status, "active"),
                ),
              )
              .for("update");
            if (!pickupBlock || !occupancy) {
              throw conflict(
                "RENTAL_EXTENSION_SCHEDULE_CHANGED",
                "The pickup schedule or trailer occupancy is no longer active",
              );
            }
            const pickupReservations = await transaction
              .select()
              .from(assetReservations)
              .where(
                and(
                  eq(assetReservations.tenantId, actor.tenantId),
                  eq(assetReservations.scheduleBlockId, pickupBlock.id),
                  eq(assetReservations.status, "active"),
                ),
              )
              .for("update");
            const shiftMilliseconds =
              extension.requestedPickupAt.getTime() - extension.previousPickupAt.getTime();
            const shiftedStartsAt = new Date(pickupBlock.startsAt.getTime() + shiftMilliseconds);
            const shiftedEndsAt = new Date(pickupBlock.endsAt.getTime() + shiftMilliseconds);
            for (const reservation of pickupReservations) {
              await transaction
                .update(assetReservations)
                .set({
                  endsAt: shiftedEndsAt,
                  startsAt: shiftedStartsAt,
                  updatedBy: actor.userId,
                })
                .where(
                  and(
                    eq(assetReservations.tenantId, actor.tenantId),
                    eq(assetReservations.id, reservation.id),
                  ),
                );
            }
            await transaction
              .update(assetReservations)
              .set({ endsAt: extension.requestedPickupAt, updatedBy: actor.userId })
              .where(
                and(
                  eq(assetReservations.tenantId, actor.tenantId),
                  eq(assetReservations.id, occupancy.id),
                ),
              );
            await transaction
              .update(scheduleBlocks)
              .set({
                endsAt: shiftedEndsAt,
                startsAt: shiftedStartsAt,
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(scheduleBlocks.tenantId, actor.tenantId),
                  eq(scheduleBlocks.id, pickupBlock.id),
                ),
              );
            await transaction
              .update(dumpTrailerRentalDetails)
              .set({ plannedPickupAt: extension.requestedPickupAt, updatedBy: actor.userId })
              .where(
                and(
                  eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
                  eq(dumpTrailerRentalDetails.id, context.detail.id),
                ),
              );
            nextStatus = "approved";
            await transaction
              .update(rentalExtensions)
              .set({
                availabilitySnapshot: availability.snapshot,
                conflictStatus: "pass",
                decidedAt: now,
                decidedBy: actor.userId,
                decisionReason: reason,
                status: nextStatus,
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(rentalExtensions.tenantId, actor.tenantId),
                  eq(rentalExtensions.id, extension.id),
                ),
              );
            await this.createAdditionalDayCharge(
              transaction,
              actor,
              context.detail,
              extension,
              now,
            );
            await transaction
              .update(jobs)
              .set({ readiness: "evaluation_required", updatedBy: actor.userId })
              .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, context.job.id)));
            after = {
              ...after,
              calculatedAmountCents: extension.calculatedAmountCents,
              plannedPickupAt: extension.requestedPickupAt,
              status: nextStatus,
            };
            eventType = "rental.extension_approved";
          } else {
            nextStatus = action === "reject" ? "rejected" : "cancelled";
            await transaction
              .update(rentalExtensions)
              .set({
                decidedAt: action === "reject" ? now : null,
                decidedBy: action === "reject" ? actor.userId : null,
                decisionReason: reason,
                status: nextStatus,
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(rentalExtensions.tenantId, actor.tenantId),
                  eq(rentalExtensions.id, extension.id),
                ),
              );
            after = { ...after, status: nextStatus };
          }
          await this.emitChange(transaction, actor, {
            after,
            before: {
              conflictStatus: extension.conflictStatus,
              customerAuthorizationStatus: extension.customerAuthorizationStatus,
              status: extension.status,
            },
            commandName: `${capitalize(action)}RentalExtension`,
            entityId: extension.id,
            entityType: "RentalExtension",
            eventType,
            jobId: context.job.id,
            summary: `Rental extension ${String(extension.extensionNumber)} ${action} completed`,
          });
          return {
            body: await this.getDetail(transaction, actor.tenantId, context.job.id),
            status: HttpStatus.OK,
          };
        },
      );
      return result.body;
    } catch (error) {
      if (databaseCode(error) === "23P01") {
        throw conflict(
          "RENTAL_EXTENSION_ASSET_CONFLICT",
          "An Asset Reservation changed and now conflicts with the requested extension",
        );
      }
      throw error;
    }
  }

  public async createPickupAttempt(
    rentalDetailId: string,
    input: CreateRentalPickupAttemptDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.create-pickup-attempt" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        if (context.detail.status !== "on_rent" || context.job.status !== "active") {
          throw conflict(
            "RENTAL_PICKUP_INVALID_STATE",
            "A pickup attempt can only be planned while the Rental is in customer custody",
          );
        }
        if (!context.detail.trailerAssetId) {
          throw conflict("RENTAL_TRAILER_REQUIRED", "Rental trailer is not selected");
        }
        const existing = await transaction
          .select({ id: rentalPickupAttempts.id })
          .from(rentalPickupAttempts)
          .where(
            and(
              eq(rentalPickupAttempts.tenantId, actor.tenantId),
              eq(rentalPickupAttempts.rentalDetailId, rentalDetailId),
              inArray(rentalPickupAttempts.status, ["planned", "en_route", "arrived"]),
            ),
          )
          .limit(1);
        if (existing[0]) {
          throw conflict(
            "RENTAL_PICKUP_ATTEMPT_OPEN",
            "Complete the open pickup attempt before creating another",
          );
        }
        const [pickupBlock] = await transaction
          .select()
          .from(scheduleBlocks)
          .where(
            and(
              eq(scheduleBlocks.tenantId, actor.tenantId),
              eq(scheduleBlocks.jobId, context.job.id),
              eq(scheduleBlocks.blockType, "pickup"),
              eq(scheduleBlocks.status, "confirmed"),
            ),
          )
          .limit(1);
        if (!pickupBlock) {
          throw conflict(
            "RENTAL_PICKUP_SCHEDULE_REQUIRED",
            "A confirmed pickup block is required before pickup execution",
          );
        }
        const drivers = await transaction
          .select()
          .from(jobAssignments)
          .where(
            and(
              eq(jobAssignments.tenantId, actor.tenantId),
              eq(jobAssignments.scheduleBlockId, pickupBlock.id),
              eq(jobAssignments.role, "driver"),
              eq(jobAssignments.status, "assigned"),
            ),
          );
        const assignedAssets = await transaction
          .select()
          .from(assetAssignments)
          .where(
            and(
              eq(assetAssignments.tenantId, actor.tenantId),
              eq(assetAssignments.scheduleBlockId, pickupBlock.id),
              eq(assetAssignments.status, "assigned"),
            ),
          );
        const driver = drivers.length === 1 ? drivers[0] : undefined;
        if (!driver) {
          throw conflict(
            "RENTAL_PICKUP_DRIVER_REQUIRED",
            "Pickup requires exactly one assigned driver",
          );
        }
        if (!assignedAssets.some((assignmentRecord) => assignmentRecord.role === "truck")) {
          throw conflict("RENTAL_PICKUP_TRUCK_REQUIRED", "Pickup requires an assigned truck");
        }
        if (
          !assignedAssets.some(
            (assignmentRecord) =>
              assignmentRecord.role === "trailer" &&
              assignmentRecord.assetId === context.detail.trailerAssetId,
          )
        ) {
          throw conflict("RENTAL_PICKUP_TRAILER_REQUIRED", "Pickup must assign the Rental trailer");
        }
        const [pickupStop] = await transaction
          .select()
          .from(routeStops)
          .where(
            and(
              eq(routeStops.tenantId, actor.tenantId),
              eq(routeStops.jobId, context.job.id),
              eq(routeStops.scheduleBlockId, pickupBlock.id),
              eq(routeStops.stopType, "pickup"),
            ),
          )
          .limit(1);
        const prior = await transaction
          .select({ attemptNumber: rentalPickupAttempts.attemptNumber })
          .from(rentalPickupAttempts)
          .where(
            and(
              eq(rentalPickupAttempts.tenantId, actor.tenantId),
              eq(rentalPickupAttempts.rentalDetailId, rentalDetailId),
            ),
          )
          .orderBy(desc(rentalPickupAttempts.attemptNumber))
          .limit(1);
        const [created] = await transaction
          .insert(rentalPickupAttempts)
          .values({
            accessStatus: input.accessStatus,
            attemptNumber: (prior[0]?.attemptNumber ?? 0) + 1,
            attemptedBy: driver.userId,
            createdBy: actor.userId,
            customerNotifiedAt: new Date(input.customerNotifiedAt),
            jobId: context.job.id,
            outcomeNotes: optionalTrim(input.notes),
            rentalDetailId,
            routeStopId: pickupStop?.id ?? null,
            safeLoadStatus: input.safeLoadStatus,
            scheduleBlockId: pickupBlock.id,
            tenantId: actor.tenantId,
            trailerAssetId: context.detail.trailerAssetId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Rental Pickup Attempt was not created");
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({ status: "pickup_scheduled", updatedBy: actor.userId })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, rentalDetailId),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: {
            accessStatus: created.accessStatus,
            attemptNumber: created.attemptNumber,
            safeLoadStatus: created.safeLoadStatus,
            status: created.status,
          },
          commandName: "CreateRentalPickupAttempt",
          entityId: created.id,
          entityType: "RentalPickupAttempt",
          eventType: "rental.pickup_attempt_created",
          jobId: context.job.id,
          summary: `Rental pickup attempt ${String(created.attemptNumber)} planned`,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async transitionPickupAttempt(
    attemptId: string,
    action: RentalPickupAction,
    input: RentalPickupActionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, attemptId, input }, scope: `rentals.pickup.${action}` },
      async (transaction) => {
        const [reference] = await transaction
          .select({ rentalDetailId: rentalPickupAttempts.rentalDetailId })
          .from(rentalPickupAttempts)
          .where(
            and(
              eq(rentalPickupAttempts.tenantId, actor.tenantId),
              eq(rentalPickupAttempts.id, attemptId),
            ),
          );
        if (!reference) {
          throw notFound("RENTAL_PICKUP_ATTEMPT_NOT_FOUND", "Rental Pickup Attempt was not found");
        }
        const context = await this.lockDetail(
          transaction,
          actor.tenantId,
          reference.rentalDetailId,
        );
        if (context.job.status !== "active") {
          throw conflict("RENTAL_JOB_NOT_ACTIVE", "Job must be active for pickup execution");
        }
        const [attempt] = await transaction
          .select()
          .from(rentalPickupAttempts)
          .where(
            and(
              eq(rentalPickupAttempts.tenantId, actor.tenantId),
              eq(rentalPickupAttempts.id, attemptId),
            ),
          )
          .for("update");
        if (!attempt) {
          throw notFound("RENTAL_PICKUP_ATTEMPT_NOT_FOUND", "Rental Pickup Attempt was not found");
        }
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        const accessStatus = input.accessStatus ?? attempt.accessStatus;
        const safeLoadStatus = input.safeLoadStatus ?? attempt.safeLoadStatus;
        let nextDetailStatus: string;
        let nextAttemptStatus = attempt.status;
        let eventType = `rental.pickup_${action}`;
        let summary = `Rental pickup ${action} recorded`;

        if (action === "prepare") {
          if (attempt.status !== "planned" || context.detail.status !== "pickup_scheduled") {
            throw conflict(
              "RENTAL_PICKUP_TRANSITION_INVALID",
              "Pickup must be scheduled before preparation begins",
            );
          }
          if (accessStatus !== "pass" || safeLoadStatus !== "pass") {
            throw conflict(
              "RENTAL_PICKUP_NOT_READY",
              "Pickup access and safe-load checks must pass before preparation",
            );
          }
          nextDetailStatus = "pickup_preparing";
          await transaction
            .update(rentalPickupAttempts)
            .set({
              outcomeNotes: optionalTrim(input.notes) ?? attempt.outcomeNotes,
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(rentalPickupAttempts.tenantId, actor.tenantId),
                eq(rentalPickupAttempts.id, attempt.id),
              ),
            );
        } else if (action === "depart") {
          if (attempt.status !== "planned" || context.detail.status !== "pickup_preparing") {
            throw conflict(
              "RENTAL_PICKUP_TRANSITION_INVALID",
              "Pickup must be preparing before departure",
            );
          }
          nextAttemptStatus = "en_route";
          nextDetailStatus = "en_route_pickup";
          await transaction
            .update(rentalPickupAttempts)
            .set({ attemptedAt: occurredAt, status: nextAttemptStatus, updatedBy: actor.userId })
            .where(
              and(
                eq(rentalPickupAttempts.tenantId, actor.tenantId),
                eq(rentalPickupAttempts.id, attempt.id),
              ),
            );
        } else if (action === "arrive") {
          if (attempt.status !== "en_route" || context.detail.status !== "en_route_pickup") {
            throw conflict(
              "RENTAL_PICKUP_TRANSITION_INVALID",
              "Pickup must be en route before arrival",
            );
          }
          nextAttemptStatus = "arrived";
          nextDetailStatus = "at_customer_pickup";
          await transaction
            .update(rentalPickupAttempts)
            .set({
              accessStatus,
              arrivedAt: occurredAt,
              safeLoadStatus,
              status: nextAttemptStatus,
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(rentalPickupAttempts.tenantId, actor.tenantId),
                eq(rentalPickupAttempts.id, attempt.id),
              ),
            );
          if (attempt.routeStopId) {
            await transaction
              .update(routeStops)
              .set({ arrivedAt: occurredAt, status: "arrived", updatedBy: actor.userId })
              .where(
                and(
                  eq(routeStops.tenantId, actor.tenantId),
                  eq(routeStops.id, attempt.routeStopId),
                ),
              );
          }
        } else if (action === "fail") {
          if (
            !["en_route", "arrived"].includes(attempt.status) ||
            !["en_route_pickup", "at_customer_pickup"].includes(context.detail.status)
          ) {
            throw conflict(
              "RENTAL_PICKUP_TRANSITION_INVALID",
              "A pickup attempt can fail only after departure",
            );
          }
          const reason = input.reason?.trim();
          if (!reason) {
            throw badRequest(
              "RENTAL_PICKUP_FAILURE_REASON_REQUIRED",
              "A failure reason is required for a failed pickup attempt",
            );
          }
          nextAttemptStatus = "failed";
          nextDetailStatus = "on_rent";
          eventType = "rental.pickup_failed";
          summary = `Rental pickup attempt ${String(attempt.attemptNumber)} failed`;
          await transaction
            .update(rentalPickupAttempts)
            .set({
              accessStatus,
              completedAt: occurredAt,
              failureReason: reason,
              outcomeNotes: optionalTrim(input.notes) ?? attempt.outcomeNotes,
              safeLoadStatus,
              status: nextAttemptStatus,
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(rentalPickupAttempts.tenantId, actor.tenantId),
                eq(rentalPickupAttempts.id, attempt.id),
              ),
            );
          if (attempt.routeStopId) {
            await transaction
              .update(routeStops)
              .set({ arrivedAt: null, status: "planned", updatedBy: actor.userId })
              .where(
                and(
                  eq(routeStops.tenantId, actor.tenantId),
                  eq(routeStops.id, attempt.routeStopId),
                ),
              );
          }
        } else {
          if (attempt.status !== "arrived" || context.detail.status !== "at_customer_pickup") {
            throw conflict(
              "RENTAL_PICKUP_TRANSITION_INVALID",
              "Pickup retrieval requires arrival at the customer",
            );
          }
          if (accessStatus !== "pass" || safeLoadStatus !== "pass") {
            throw conflict(
              "RENTAL_PICKUP_NOT_RETRIEVABLE",
              "Customer access and safe-load checks must pass before retrieval",
            );
          }
          nextAttemptStatus = "retrieved";
          nextDetailStatus = "picked_up";
          eventType = "rental.pickup_retrieved";
          summary = `Rental pickup attempt ${String(attempt.attemptNumber)} retrieved the trailer`;
          await transaction
            .update(rentalPickupAttempts)
            .set({
              accessStatus,
              completedAt: occurredAt,
              customerCustodyEndedAt: occurredAt,
              outcomeNotes: optionalTrim(input.notes) ?? attempt.outcomeNotes,
              safeLoadStatus,
              status: nextAttemptStatus,
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(rentalPickupAttempts.tenantId, actor.tenantId),
                eq(rentalPickupAttempts.id, attempt.id),
              ),
            );
          if (attempt.routeStopId) {
            await transaction
              .update(routeStops)
              .set({ completedAt: occurredAt, status: "completed", updatedBy: actor.userId })
              .where(
                and(
                  eq(routeStops.tenantId, actor.tenantId),
                  eq(routeStops.id, attempt.routeStopId),
                ),
              );
          }
          await transaction
            .update(scheduleBlocks)
            .set({ completedAt: occurredAt, status: "completed", updatedBy: actor.userId })
            .where(
              and(
                eq(scheduleBlocks.tenantId, actor.tenantId),
                eq(scheduleBlocks.id, attempt.scheduleBlockId),
              ),
            );
        }
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({
            ...(action === "retrieve"
              ? { actualPickupAt: occurredAt, customerCustodyEndedAt: occurredAt }
              : {}),
            status: nextDetailStatus,
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, context.detail.id),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: {
            accessStatus,
            occurredAt,
            rentalStatus: nextDetailStatus,
            safeLoadStatus,
            status: nextAttemptStatus,
          },
          before: { rentalStatus: context.detail.status, status: attempt.status },
          commandName: `${capitalize(action)}RentalPickup`,
          entityId: attempt.id,
          entityType: "RentalPickupAttempt",
          eventType,
          jobId: context.job.id,
          metadata: input.reason?.trim() ? { reason: input.reason.trim() } : {},
          summary,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createDisposalLoad(
    rentalDetailId: string,
    input: CreateDisposalLoadDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    try {
      const result = await this.idempotency.execute(
        { key, payload: { input, rentalDetailId }, scope: "rentals.create-disposal-load" },
        async (transaction) => {
          const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
          if (
            !["picked_up", "awaiting_disposal"].includes(context.detail.status) ||
            context.job.status !== "active"
          ) {
            throw conflict(
              "RENTAL_DISPOSAL_INVALID_STATE",
              "Disposal can only be planned after successful trailer retrieval",
            );
          }
          if (!context.detail.trailerAssetId) {
            throw conflict("RENTAL_TRAILER_REQUIRED", "Rental trailer is not selected");
          }
          const open = await transaction
            .select({ id: disposalLoads.id })
            .from(disposalLoads)
            .where(
              and(
                eq(disposalLoads.tenantId, actor.tenantId),
                eq(disposalLoads.rentalDetailId, rentalDetailId),
                inArray(disposalLoads.status, [
                  "planned",
                  "facility_review",
                  "ready",
                  "en_route",
                  "at_facility",
                  "acceptance_pending",
                  "accepted",
                  "weighed_in",
                  "unloading",
                  "partially_unloaded",
                  "unloaded",
                  "weighed_out",
                  "documentation_pending",
                  "reconciling",
                ]),
              ),
            )
            .limit(1);
          if (open[0]) {
            throw conflict(
              "RENTAL_DISPOSAL_LOAD_OPEN",
              "Resolve the open Disposal Load before creating another",
            );
          }
          if (input.redirectedFromDisposalLoadId) {
            const [source] = await transaction
              .select()
              .from(disposalLoads)
              .where(
                and(
                  eq(disposalLoads.tenantId, actor.tenantId),
                  eq(disposalLoads.id, input.redirectedFromDisposalLoadId),
                  eq(disposalLoads.rentalDetailId, rentalDetailId),
                  inArray(disposalLoads.status, ["rejected", "redirected"]),
                ),
              );
            if (!source) {
              throw conflict(
                "RENTAL_DISPOSAL_REDIRECT_INVALID",
                "A replacement Disposal Load must reference a rejected or redirected Load",
              );
            }
          }
          const startsAt = new Date(input.startsAt);
          const endsAt = new Date(input.endsAt);
          if (endsAt <= startsAt) {
            throw badRequest(
              "RENTAL_DISPOSAL_SCHEDULE_INVALID",
              "Disposal schedule end must be after its start",
            );
          }
          const facility = await this.requireFacility(
            transaction,
            actor.tenantId,
            input.plannedFacilityLocationId,
          );
          const driver = await this.requireActiveUser(
            transaction,
            actor.tenantId,
            input.driverUserId,
          );
          const truck = await this.requireAvailableAsset(
            transaction,
            actor.tenantId,
            input.truckAssetId,
            "truck",
          );
          const previousLoads = await transaction
            .select({ sequence: disposalLoads.sequence })
            .from(disposalLoads)
            .where(
              and(
                eq(disposalLoads.tenantId, actor.tenantId),
                eq(disposalLoads.rentalDetailId, rentalDetailId),
              ),
            )
            .orderBy(desc(disposalLoads.sequence))
            .limit(1);
          const previousStops = await transaction
            .select({ sequence: routeStops.sequence })
            .from(routeStops)
            .where(
              and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.jobId, context.job.id)),
            )
            .orderBy(desc(routeStops.sequence))
            .limit(1);
          const [block] = await transaction
            .insert(scheduleBlocks)
            .values({
              blockType: "disposal",
              confirmedAt: new Date(),
              createdBy: actor.userId,
              endsAt,
              jobId: context.job.id,
              startsAt,
              status: "confirmed",
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!block) throw new Error("Disposal Schedule Block was not created");
          await transaction.insert(assetReservations).values({
            assetId: truck.id,
            createdBy: actor.userId,
            endsAt,
            jobId: context.job.id,
            scheduleBlockId: block.id,
            startsAt,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          });
          await transaction
            .insert(assetAssignments)
            .values([
              assignment(actor, context.job.id, block.id, truck.id, "truck"),
              assignment(actor, context.job.id, block.id, context.detail.trailerAssetId, "trailer"),
            ]);
          await transaction
            .insert(jobAssignments)
            .values(driverAssignment(actor, context.job.id, block.id, driver.id));
          const [stop] = await transaction
            .insert(routeStops)
            .values({
              createdBy: actor.userId,
              jobId: context.job.id,
              label: `Disposal at ${facility.location.label}`,
              locationSnapshot: {
                addressSummary: facility.location.addressSummary,
                label: facility.location.label,
                supplierId: facility.location.supplierId,
                supplierLocationId: facility.location.id,
              },
              scheduleBlockId: block.id,
              sequence: (previousStops[0]?.sequence ?? 0) + 1,
              stopType: "disposal",
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!stop) throw new Error("Disposal Route Stop was not created");
          const [created] = await transaction
            .insert(disposalLoads)
            .values({
              createdBy: actor.userId,
              debrisClassification: input.debrisClassification.trim(),
              jobId: context.job.id,
              plannedFacilityLocationId: facility.location.id,
              redirectedFromDisposalLoadId: input.redirectedFromDisposalLoadId ?? null,
              rentalDetailId,
              routeStopId: stop.id,
              sequence: (previousLoads[0]?.sequence ?? 0) + 1,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!created) throw new Error("Disposal Load was not created");
          await transaction
            .update(dumpTrailerRentalDetails)
            .set({ status: "awaiting_disposal", updatedBy: actor.userId })
            .where(
              and(
                eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
                eq(dumpTrailerRentalDetails.id, rentalDetailId),
              ),
            );
          await this.emitChange(transaction, actor, {
            after: {
              disposalLoadId: created.id,
              plannedFacilityLocationId: facility.location.id,
              redirectedFromDisposalLoadId: created.redirectedFromDisposalLoadId,
              sequence: created.sequence,
            },
            commandName: "CreateRentalDisposalLoad",
            entityId: created.id,
            entityType: "DisposalLoad",
            eventType: "rental.disposal_load_created",
            jobId: context.job.id,
            summary: `Rental Disposal Load ${String(created.sequence)} planned`,
          });
          return {
            body: await this.getDetail(transaction, actor.tenantId, context.job.id),
            status: HttpStatus.CREATED,
          };
        },
      );
      return result.body;
    } catch (error) {
      if (databaseCode(error) === "23P01") {
        throw conflict(
          "RENTAL_DISPOSAL_ASSET_CONFLICT",
          "The disposal truck is unavailable during the requested window",
        );
      }
      throw error;
    }
  }

  public async transitionDisposalLoad(
    disposalLoadId: string,
    action: RentalDisposalAction,
    input: DisposalLoadExecutionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, disposalLoadId, input }, scope: `rentals.disposal.${action}` },
      async (transaction) => {
        const context = await this.lockDisposalLoad(transaction, actor.tenantId, disposalLoadId);
        if (context.job.status !== "active") {
          throw conflict("RENTAL_JOB_NOT_ACTIVE", "Job must be active for disposal execution");
        }
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        let loadStatus: string;
        let rentalStatus = context.detail.status;
        const changes: Partial<typeof disposalLoads.$inferInsert> = { updatedBy: actor.userId };
        if (action === "depart") {
          assertDisposalState(context.load.status, ["planned", "ready"], action);
          loadStatus = "en_route";
          rentalStatus = "awaiting_disposal";
        } else if (action === "arrive") {
          assertDisposalState(context.load.status, ["en_route"], action);
          const facilityId =
            input.actualFacilityLocationId ?? context.load.plannedFacilityLocationId;
          if (!facilityId) {
            throw badRequest(
              "RENTAL_DISPOSAL_FACILITY_REQUIRED",
              "Actual disposal facility is required at arrival",
            );
          }
          await this.requireFacility(transaction, actor.tenantId, facilityId);
          changes.actualFacilityLocationId = facilityId;
          changes.arrivedAt = occurredAt;
          loadStatus = "at_facility";
          rentalStatus = "at_facility";
          if (context.load.routeStopId) {
            await transaction
              .update(routeStops)
              .set({ arrivedAt: occurredAt, status: "arrived", updatedBy: actor.userId })
              .where(
                and(
                  eq(routeStops.tenantId, actor.tenantId),
                  eq(routeStops.id, context.load.routeStopId),
                ),
              );
          }
        } else if (action === "accept") {
          assertDisposalState(context.load.status, ["at_facility", "acceptance_pending"], action);
          changes.acceptanceResult = "accepted";
          loadStatus = "accepted";
          rentalStatus = "at_facility";
        } else if (["reject", "redirect"].includes(action)) {
          assertDisposalState(context.load.status, ["at_facility", "acceptance_pending"], action);
          const reason = input.rejectionReason?.trim();
          if (!reason) {
            throw badRequest(
              "RENTAL_DISPOSAL_REJECTION_REASON_REQUIRED",
              "A rejection or redirection reason is required",
            );
          }
          changes.acceptanceResult = "rejected";
          changes.departedAt = occurredAt;
          changes.rejectionReason = reason;
          changes.unloadingResult = "not_unloaded";
          loadStatus = action === "reject" ? "rejected" : "redirected";
          rentalStatus = "awaiting_disposal";
          await this.finishDisposalRoute(transaction, actor, context.load, occurredAt, "completed");
        } else if (action === "record-weight") {
          assertDisposalState(
            context.load.status,
            ["accepted", "weighed_in", "unloading", "unloaded", "documentation_pending"],
            action,
          );
          if (!input.grossWeight || !input.tareWeight || !input.sourceWeightUnit) {
            throw badRequest(
              "RENTAL_DISPOSAL_WEIGHT_REQUIRED",
              "Gross, tare, and source weight unit are required",
            );
          }
          const weight = disposalWeight(
            input.grossWeight,
            input.tareWeight,
            input.sourceWeightUnit,
          );
          changes.canonicalNetWeightPounds = weight.canonicalNetWeightPounds;
          changes.grossWeight = weight.grossWeight;
          changes.netWeight = weight.netWeight;
          changes.sourceWeightUnit = input.sourceWeightUnit;
          changes.tareWeight = weight.tareWeight;
          changes.weightStatus = "recorded";
          loadStatus = context.load.status === "accepted" ? "weighed_in" : context.load.status;
        } else if (action === "start-unloading") {
          assertDisposalState(context.load.status, ["accepted", "weighed_in"], action);
          loadStatus = "unloading";
          rentalStatus = "unloading";
        } else if (action === "complete-unloading") {
          assertDisposalState(context.load.status, ["unloading", "partially_unloaded"], action);
          if (!input.remainingMaterialStatus) {
            throw badRequest(
              "RENTAL_DISPOSAL_REMAINING_STATUS_REQUIRED",
              "Remaining material status is required after unloading",
            );
          }
          const partial = input.remainingMaterialStatus === "remaining";
          changes.remainingMaterialStatus = input.remainingMaterialStatus;
          changes.unloadedAt = occurredAt;
          changes.unloadingResult = partial ? "partial" : "unloaded";
          loadStatus = partial ? "partially_unloaded" : "documentation_pending";
          rentalStatus = partial ? "awaiting_disposal" : "unloading";
          if (!partial) {
            await this.finishDisposalRoute(
              transaction,
              actor,
              context.load,
              occurredAt,
              "completed",
            );
          }
        } else {
          assertDisposalState(context.load.status, ["planned"], action);
          loadStatus = "cancelled";
          rentalStatus = "picked_up";
          await this.finishDisposalRoute(transaction, actor, context.load, occurredAt, "cancelled");
        }
        const [updated] = await transaction
          .update(disposalLoads)
          .set({ ...changes, status: loadStatus })
          .where(
            and(eq(disposalLoads.tenantId, actor.tenantId), eq(disposalLoads.id, context.load.id)),
          )
          .returning();
        if (!updated) throw new Error("Disposal Load transition did not return a record");
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({ status: rentalStatus, updatedBy: actor.userId })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, context.detail.id),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: { occurredAt, rentalStatus, status: loadStatus, ...changes },
          before: { rentalStatus: context.detail.status, status: context.load.status },
          commandName: `${pascalAction(action)}RentalDisposalLoad`,
          entityId: context.load.id,
          entityType: "DisposalLoad",
          eventType: `rental.disposal_${action.replaceAll("-", "_")}`,
          jobId: context.job.id,
          metadata: input.notes?.trim() ? { notes: input.notes.trim() } : {},
          summary: `Rental Disposal Load ${String(context.load.sequence)} ${action}`,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async recordDisposalEvidence(
    disposalLoadId: string,
    input: RecordDisposalEvidenceDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { disposalLoadId, input }, scope: "rentals.disposal.record-evidence" },
      async (transaction) => {
        const context = await this.lockDisposalLoad(transaction, actor.tenantId, disposalLoadId);
        if (!["unloaded", "weighed_out", "documentation_pending"].includes(context.load.status)) {
          throw conflict(
            "RENTAL_DISPOSAL_EVIDENCE_INVALID_STATE",
            "Disposal evidence can only be recorded after unloading",
          );
        }
        if (
          context.load.expenseId ||
          context.load.ticketStatus !== "missing" ||
          context.load.receiptStatus !== "missing" ||
          context.load.emptyTrailerStatus !== "pending"
        ) {
          throw conflict(
            "RENTAL_DISPOSAL_EVIDENCE_RECORDED",
            "Disposal financial evidence has already been recorded",
          );
        }
        const waiver = optionalTrim(input.evidenceWaiverReason);
        if (!input.ticketDocumentId && !waiver) {
          throw badRequest(
            "RENTAL_DISPOSAL_TICKET_REQUIRED",
            "A scale ticket or approved evidence waiver is required",
          );
        }
        if (input.disposalFeeCents > 0 && !input.receiptDocumentId && !waiver) {
          throw badRequest(
            "RENTAL_DISPOSAL_RECEIPT_REQUIRED",
            "A disposal receipt or approved evidence waiver is required when a fee applies",
          );
        }
        const evidence = [
          input.ticketDocumentId
            ? { documentId: input.ticketDocumentId, purpose: "scale_ticket" }
            : null,
          input.receiptDocumentId
            ? { documentId: input.receiptDocumentId, purpose: "disposal_receipt" }
            : null,
          { documentId: input.emptyTrailerDocumentId, purpose: "empty_trailer_evidence" },
        ].filter((record): record is { documentId: string; purpose: string } => Boolean(record));
        for (const record of evidence) {
          await this.documentService.linkAvailableToEntity(transaction, {
            actorUserId: actor.userId,
            documentId: record.documentId,
            entityId: context.load.id,
            entityType: "DisposalLoad",
            purpose: record.purpose,
            tenantId: actor.tenantId,
          });
        }
        let expenseId: string | null = null;
        if (input.disposalFeeCents > 0) {
          const facility = context.load.actualFacilityLocationId
            ? await this.requireFacility(
                transaction,
                actor.tenantId,
                context.load.actualFacilityLocationId,
              )
            : null;
          if (!facility) {
            throw conflict(
              "RENTAL_DISPOSAL_FACILITY_REQUIRED",
              "Actual facility is required before recording a disposal Expense",
            );
          }
          const expenseNumber = await allocateBusinessNumber(transaction, {
            entityType: "expense",
            prefix: "EXP",
            tenantId: actor.tenantId,
            year: new Date().getUTCFullYear(),
          });
          const [expense] = await transaction
            .insert(expenses)
            .values({
              amountCents: input.disposalFeeCents,
              approvedAt: new Date(),
              approvedBy: actor.userId,
              createdBy: actor.userId,
              description: `Disposal fee for Rental Load ${String(context.load.sequence)}`,
              expenseNumber,
              expenseType: "disposal",
              externalReference: optionalTrim(input.externalReference),
              incurredAt: new Date(),
              jobId: context.job.id,
              receiptDocumentId: input.receiptDocumentId ?? null,
              receiptStatus: input.receiptDocumentId ? "attached" : "waived",
              receiptWaivedAt: input.receiptDocumentId ? null : new Date(),
              receiptWaivedBy: input.receiptDocumentId ? null : actor.userId,
              receiptWaiverReason: input.receiptDocumentId ? null : waiver,
              status: "reconciled",
              supplierId: facility.location.supplierId,
              supplierLocationId: facility.location.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!expense) throw new Error("Disposal Expense was not created");
          expenseId = expense.id;
          await this.emitChange(transaction, actor, {
            after: {
              amountCents: expense.amountCents,
              expenseNumber: expense.expenseNumber,
              status: expense.status,
            },
            commandName: "CreateRentalDisposalExpense",
            entityId: expense.id,
            entityType: "Expense",
            eventType: "rental.disposal_expense_created",
            jobId: context.job.id,
            metadata: { disposalLoadId: context.load.id },
            summary: `Disposal Expense ${expense.expenseNumber} reconciled`,
          });
        }
        await transaction
          .update(disposalLoads)
          .set({
            disposalFeeCents: input.disposalFeeCents,
            emptyTrailerDocumentId: input.emptyTrailerDocumentId,
            emptyTrailerStatus: "confirmed_empty",
            evidenceWaivedAt: waiver ? new Date() : null,
            evidenceWaivedBy: waiver ? actor.userId : null,
            evidenceWaiverReason: waiver,
            expenseId,
            receiptDocumentId: input.receiptDocumentId ?? null,
            receiptStatus: input.receiptDocumentId
              ? "attached"
              : input.disposalFeeCents > 0
                ? "waived"
                : "not_required",
            ticketDocumentId: input.ticketDocumentId ?? null,
            ticketStatus: input.ticketDocumentId ? "attached" : "waived",
            updatedBy: actor.userId,
          })
          .where(
            and(eq(disposalLoads.tenantId, actor.tenantId), eq(disposalLoads.id, context.load.id)),
          );
        await this.emitChange(transaction, actor, {
          after: {
            disposalFeeCents: input.disposalFeeCents,
            emptyTrailerStatus: "confirmed_empty",
            expenseId,
            receiptStatus: input.receiptDocumentId
              ? "attached"
              : input.disposalFeeCents > 0
                ? "waived"
                : "not_required",
            ticketStatus: input.ticketDocumentId ? "attached" : "waived",
          },
          commandName: "RecordRentalDisposalEvidence",
          entityId: context.load.id,
          entityType: "DisposalLoad",
          eventType: "rental.disposal_evidence_recorded",
          jobId: context.job.id,
          summary: `Rental Disposal Load ${String(context.load.sequence)} evidence recorded`,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async reconcileDisposalLoad(
    disposalLoadId: string,
    input: RentalExecutionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { disposalLoadId, input }, scope: "rentals.disposal.reconcile" },
      async (transaction) => {
        const context = await this.lockDisposalLoad(transaction, actor.tenantId, disposalLoadId);
        if (
          !["documentation_pending", "unloaded", "weighed_out", "reconciling"].includes(
            context.load.status,
          )
        ) {
          throw conflict(
            "RENTAL_DISPOSAL_RECONCILE_INVALID_STATE",
            "Disposal Load must be unloaded and documented before reconciliation",
          );
        }
        const blockers = disposalReconciliationBlockers(context.load);
        if (blockers.length > 0) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "RENTAL_DISPOSAL_NOT_RECONCILABLE",
            "Disposal Load has unresolved reconciliation blockers",
            { blockers },
          );
        }
        const reconciledAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        await transaction
          .update(disposalLoads)
          .set({
            reconciledAt,
            reconciledBy: actor.userId,
            status: "reconciled",
            updatedBy: actor.userId,
          })
          .where(
            and(eq(disposalLoads.tenantId, actor.tenantId), eq(disposalLoads.id, context.load.id)),
          );
        const loads = await transaction
          .select()
          .from(disposalLoads)
          .where(
            and(
              eq(disposalLoads.tenantId, actor.tenantId),
              eq(disposalLoads.rentalDetailId, context.detail.id),
            ),
          );
        const totalMilliPounds = loads
          .filter((load) => load.id === context.load.id || load.status === "reconciled")
          .reduce(
            (total, load) => total + decimalToMillis(load.canonicalNetWeightPounds ?? "0"),
            0n,
          );
        const includedMilliPounds = decimalToMillis(context.detail.includedWeightPounds);
        const overageMilliPounds =
          totalMilliPounds > includedMilliPounds ? totalMilliPounds - includedMilliPounds : 0n;
        const unresolved = unresolvedDisposalLoads(loads, context.load.id);
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({
            emptyTrailerStatus: unresolved.length === 0 ? "confirmed_empty" : "not_empty",
            overageWeightPounds: millisToDecimal(overageMilliPounds),
            status: unresolved.length === 0 ? "inspection_required" : "awaiting_disposal",
            totalActualWeightPounds: millisToDecimal(totalMilliPounds),
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, context.detail.id),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: {
            overageWeightPounds: millisToDecimal(overageMilliPounds),
            status: "reconciled",
            totalActualWeightPounds: millisToDecimal(totalMilliPounds),
          },
          before: { status: context.load.status },
          commandName: "ReconcileRentalDisposalLoad",
          entityId: context.load.id,
          entityType: "DisposalLoad",
          eventType: "rental.disposal_reconciled",
          jobId: context.job.id,
          metadata: input.notes?.trim() ? { notes: input.notes.trim() } : {},
          summary: `Rental Disposal Load ${String(context.load.sequence)} reconciled`,
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async reconcileRental(
    rentalDetailId: string,
    input: RentalExecutionDto,
    key: string,
  ): Promise<DumpTrailerRentalDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, rentalDetailId }, scope: "rentals.reconcile" },
      async (transaction) => {
        const context = await this.lockDetail(transaction, actor.tenantId, rentalDetailId);
        if (context.detail.status !== "returned" || context.job.status !== "active") {
          throw conflict(
            "RENTAL_RECONCILE_INVALID_STATE",
            "Rental must be returned and inspected before final reconciliation",
          );
        }
        const loads = await transaction
          .select()
          .from(disposalLoads)
          .where(
            and(
              eq(disposalLoads.tenantId, actor.tenantId),
              eq(disposalLoads.rentalDetailId, rentalDetailId),
            ),
          );
        const unresolved = unresolvedDisposalLoads(loads);
        if (loads.every((load) => load.status !== "reconciled") || unresolved.length > 0) {
          throw conflict(
            "RENTAL_DISPOSAL_UNRESOLVED",
            "Every Disposal Load must be reconciled, cancelled, or resolved by a replacement",
          );
        }
        const [inspection] = await transaction
          .select()
          .from(rentalInspections)
          .where(
            and(
              eq(rentalInspections.tenantId, actor.tenantId),
              eq(rentalInspections.rentalDetailId, rentalDetailId),
              eq(rentalInspections.inspectionType, "post_rental"),
              eq(rentalInspections.status, "completed"),
            ),
          )
          .orderBy(desc(rentalInspections.inspectionNumber))
          .limit(1);
        if (!inspection || !context.detail.occupancyReleasedAt) {
          throw conflict(
            "RENTAL_RETURN_INCOMPLETE",
            "Post-rental inspection and occupancy release are required",
          );
        }
        await this.createWeightOverageCharge(transaction, actor, context.detail);
        const charges = await transaction
          .select()
          .from(jobCharges)
          .where(
            and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.jobId, context.job.id)),
          );
        if (
          charges.some(
            (charge) =>
              !["ready_to_invoice", "waived", "rejected", "cancelled", "reversed"].includes(
                charge.status,
              ),
          )
        ) {
          throw conflict(
            "RENTAL_JOB_CHARGE_UNRESOLVED",
            "Every operational Job Charge must be resolved before Rental completion",
          );
        }
        const completedAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
        await transaction
          .update(dumpTrailerRentalDetails)
          .set({
            invoiceReadiness: "ready",
            operationallyCompletedAt: completedAt,
            status: "operationally_complete",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(dumpTrailerRentalDetails.tenantId, actor.tenantId),
              eq(dumpTrailerRentalDetails.id, rentalDetailId),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: {
            invoiceReadiness: "ready",
            operationallyCompletedAt: completedAt,
            status: "operationally_complete",
          },
          before: {
            invoiceReadiness: context.detail.invoiceReadiness,
            status: context.detail.status,
          },
          commandName: "ReconcileDumpTrailerRental",
          entityId: rentalDetailId,
          entityType: "DumpTrailerRentalDetail",
          eventType: "rental.operationally_completed",
          jobId: context.job.id,
          metadata: input.notes?.trim() ? { notes: input.notes.trim() } : {},
          summary: "Dump Trailer Rental reconciled and operationally complete",
        });
        return {
          body: await this.getDetail(transaction, actor.tenantId, context.job.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async lockDisposalLoad(
    transaction: TenantTransaction,
    tenantId: string,
    disposalLoadId: string,
  ) {
    const [reference] = await transaction
      .select({ rentalDetailId: disposalLoads.rentalDetailId })
      .from(disposalLoads)
      .where(and(eq(disposalLoads.tenantId, tenantId), eq(disposalLoads.id, disposalLoadId)));
    if (!reference) {
      throw notFound("RENTAL_DISPOSAL_LOAD_NOT_FOUND", "Disposal Load was not found");
    }
    const context = await this.lockDetail(transaction, tenantId, reference.rentalDetailId);
    const [load] = await transaction
      .select()
      .from(disposalLoads)
      .where(and(eq(disposalLoads.tenantId, tenantId), eq(disposalLoads.id, disposalLoadId)))
      .for("update");
    if (!load) {
      throw notFound("RENTAL_DISPOSAL_LOAD_NOT_FOUND", "Disposal Load was not found");
    }
    return { ...context, load };
  }

  private async requireFacility(
    transaction: TenantTransaction,
    tenantId: string,
    supplierLocationId: string,
  ) {
    const [facility] = await transaction
      .select({ location: supplierLocations, supplier: suppliers })
      .from(supplierLocations)
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.tenantId, supplierLocations.tenantId),
          eq(suppliers.id, supplierLocations.supplierId),
        ),
      )
      .where(
        and(
          eq(supplierLocations.tenantId, tenantId),
          eq(supplierLocations.id, supplierLocationId),
          eq(supplierLocations.status, "active"),
          eq(suppliers.status, "active"),
        ),
      );
    if (!facility) {
      throw notFound(
        "RENTAL_DISPOSAL_FACILITY_NOT_FOUND",
        "Active disposal facility was not found",
      );
    }
    return facility;
  }

  private async finishDisposalRoute(
    transaction: TenantTransaction,
    actor: Actor,
    load: typeof disposalLoads.$inferSelect,
    occurredAt: Date,
    blockStatus: "cancelled" | "completed",
  ): Promise<void> {
    if (!load.routeStopId) return;
    const [stop] = await transaction
      .select()
      .from(routeStops)
      .where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.id, load.routeStopId)))
      .for("update");
    if (!stop) return;
    await transaction
      .update(routeStops)
      .set({
        completedAt: occurredAt,
        status: blockStatus === "completed" ? "completed" : "skipped",
        updatedBy: actor.userId,
      })
      .where(and(eq(routeStops.tenantId, actor.tenantId), eq(routeStops.id, stop.id)));
    if (!stop.scheduleBlockId) return;
    await transaction
      .update(scheduleBlocks)
      .set({
        ...(blockStatus === "completed"
          ? { completedAt: occurredAt }
          : { cancelledAt: occurredAt }),
        status: blockStatus,
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(scheduleBlocks.tenantId, actor.tenantId),
          eq(scheduleBlocks.id, stop.scheduleBlockId),
        ),
      );
    await transaction
      .update(assetReservations)
      .set({ releasedAt: occurredAt, status: "released", updatedBy: actor.userId })
      .where(
        and(
          eq(assetReservations.tenantId, actor.tenantId),
          eq(assetReservations.scheduleBlockId, stop.scheduleBlockId),
          eq(assetReservations.status, "active"),
        ),
      );
    await transaction
      .update(assetAssignments)
      .set({
        status: blockStatus === "completed" ? "completed" : "cancelled",
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(assetAssignments.tenantId, actor.tenantId),
          eq(assetAssignments.scheduleBlockId, stop.scheduleBlockId),
          eq(assetAssignments.status, "assigned"),
        ),
      );
    await transaction
      .update(jobAssignments)
      .set({
        status: blockStatus === "completed" ? "completed" : "cancelled",
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(jobAssignments.tenantId, actor.tenantId),
          eq(jobAssignments.scheduleBlockId, stop.scheduleBlockId),
          eq(jobAssignments.status, "assigned"),
        ),
      );
  }

  private async createAdditionalDayCharge(
    transaction: TenantTransaction,
    actor: Actor,
    detail: typeof dumpTrailerRentalDetails.$inferSelect,
    extension: typeof rentalExtensions.$inferSelect,
    occurredAt: Date,
  ): Promise<typeof jobCharges.$inferSelect> {
    return this.createDerivedRentalCharge(transaction, actor, {
      amountCents: extension.calculatedAmountCents,
      calculationSnapshot: {
        acceptedTermsHash: detail.acceptedTermsHash,
        additionalDays: extension.additionalDays,
        calculationVersion: 1,
        extensionNumber: extension.extensionNumber,
        rateCents: extension.rateCents,
      },
      chargeType: "additional_day",
      customerDescription: `${String(extension.additionalDays)} additional Rental day${extension.additionalDays === 1 ? "" : "s"}`,
      dedupeKey: `rental-extension:${extension.id}:additional-day`,
      jobId: detail.jobId,
      occurredAt,
      quantity: extension.additionalDays.toFixed(3),
      rateCents: extension.rateCents,
      sourceId: extension.id,
      sourceType: "rental_extension",
      unit: "days",
    });
  }

  private async createWeightOverageCharge(
    transaction: TenantTransaction,
    actor: Actor,
    detail: typeof dumpTrailerRentalDetails.$inferSelect,
  ): Promise<typeof jobCharges.$inferSelect | null> {
    const overageMilliPounds = decimalToMillis(detail.overageWeightPounds);
    if (overageMilliPounds === 0n) return null;
    const amountCents = calculateDecimalRateAmount(
      overageMilliPounds,
      detail.overageRateCentsPerPound,
    );
    return this.createDerivedRentalCharge(transaction, actor, {
      amountCents,
      calculationSnapshot: {
        acceptedTermsHash: detail.acceptedTermsHash,
        calculationVersion: 1,
        includedWeightPounds: detail.includedWeightPounds,
        overageWeightPounds: detail.overageWeightPounds,
        rateCentsPerPound: detail.overageRateCentsPerPound,
        rounding: "nearest_cent_half_up",
        totalActualWeightPounds: detail.totalActualWeightPounds,
      },
      chargeType: "weight_overage",
      customerDescription: `Rental weight overage of ${detail.overageWeightPounds} pounds`,
      dedupeKey: `rental:${detail.id}:weight-overage`,
      jobId: detail.jobId,
      occurredAt: new Date(),
      quantity: detail.overageWeightPounds,
      rateCents: detail.overageRateCentsPerPound,
      sourceId: detail.id,
      sourceType: "dump_trailer_rental_detail",
      unit: "pounds",
    });
  }

  private async createDerivedRentalCharge(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      amountCents: number;
      calculationSnapshot: Record<string, unknown>;
      chargeType: string;
      customerDescription: string;
      dedupeKey: string;
      jobId: string;
      occurredAt: Date;
      quantity: string;
      rateCents: number;
      sourceId: string;
      sourceType: "dump_trailer_rental_detail" | "rental_extension";
      unit: string;
    },
  ): Promise<typeof jobCharges.$inferSelect> {
    const [existing] = await transaction
      .select()
      .from(jobCharges)
      .where(
        and(
          eq(jobCharges.tenantId, actor.tenantId),
          eq(jobCharges.jobId, input.jobId),
          eq(jobCharges.dedupeKey, input.dedupeKey),
          ne(jobCharges.status, "cancelled"),
          ne(jobCharges.status, "reversed"),
        ),
      )
      .for("update");
    if (existing) {
      if (
        existing.approvedAmountCents !== input.amountCents ||
        existing.sourceId !== input.sourceId ||
        existing.sourceType !== input.sourceType
      ) {
        throw conflict(
          "RENTAL_JOB_CHARGE_MISMATCH",
          "The existing derived Rental Job Charge does not match authoritative facts",
        );
      }
      return existing;
    }
    const chargeNumber = await allocateBusinessNumber(transaction, {
      entityType: "job_charge",
      prefix: "CHG",
      tenantId: actor.tenantId,
      year: input.occurredAt.getUTCFullYear(),
    });
    const [created] = await transaction
      .insert(jobCharges)
      .values({
        approvedAmountCents: input.amountCents,
        approvedAt: input.occurredAt,
        approvedBy: actor.userId,
        calculatedAmountCents: input.amountCents,
        calculationSnapshot: input.calculationSnapshot,
        chargeKind: "charge",
        chargeNumber,
        chargeType: input.chargeType,
        createdBy: actor.userId,
        customerAuthorizationStatus: "authorized",
        customerDescription: input.customerDescription,
        dedupeKey: input.dedupeKey,
        evidenceStatus: "complete",
        internalApprovalStatus: "approved",
        jobId: input.jobId,
        occurredAt: input.occurredAt,
        proposedAmountCents: input.amountCents,
        quantity: input.quantity,
        rateCents: input.rateCents,
        responsibility: "customer",
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        status: "ready_to_invoice",
        taxBehavior: "non_taxable",
        tenantId: actor.tenantId,
        unit: input.unit,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Derived Rental Job Charge was not created");
    await this.emitChange(transaction, actor, {
      after: {
        approvedAmountCents: created.approvedAmountCents,
        chargeNumber: created.chargeNumber,
        chargeType: created.chargeType,
        status: created.status,
      },
      commandName: "CreateDerivedRentalJobCharge",
      entityId: created.id,
      entityType: "JobCharge",
      eventType: "rental.job_charge_created",
      jobId: input.jobId,
      metadata: { sourceId: input.sourceId, sourceType: input.sourceType },
      summary: `Rental Job Charge ${created.chargeNumber} created`,
    });
    return created;
  }

  private async evaluateExtensionAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    extension: typeof rentalExtensions.$inferSelect,
  ): Promise<{ conflicts: Record<string, unknown>[]; snapshot: Record<string, unknown> }> {
    const [occupancy] = await transaction
      .select()
      .from(assetReservations)
      .where(
        and(
          eq(assetReservations.tenantId, tenantId),
          eq(assetReservations.id, extension.occupancyReservationId),
          eq(assetReservations.status, "active"),
        ),
      );
    const [pickupBlock] = await transaction
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.tenantId, tenantId),
          eq(scheduleBlocks.id, extension.pickupScheduleBlockId),
          eq(scheduleBlocks.status, "confirmed"),
        ),
      );
    if (!occupancy || !pickupBlock) {
      throw conflict(
        "RENTAL_EXTENSION_SCHEDULE_CHANGED",
        "The pickup schedule or trailer occupancy is no longer active",
      );
    }
    const conflicts: Record<string, unknown>[] = [];
    const trailerConflicts = await transaction
      .select()
      .from(assetReservations)
      .where(
        and(
          eq(assetReservations.tenantId, tenantId),
          eq(assetReservations.assetId, occupancy.assetId),
          eq(assetReservations.status, "active"),
          ne(assetReservations.id, occupancy.id),
          lt(assetReservations.startsAt, extension.requestedPickupAt),
          gt(assetReservations.endsAt, extension.previousPickupAt),
        ),
      );
    for (const reservation of trailerConflicts) {
      conflicts.push({
        assetId: reservation.assetId,
        endsAt: reservation.endsAt.toISOString(),
        reservationId: reservation.id,
        startsAt: reservation.startsAt.toISOString(),
        type: "trailer_occupancy",
      });
    }
    const pickupReservations = await transaction
      .select()
      .from(assetReservations)
      .where(
        and(
          eq(assetReservations.tenantId, tenantId),
          eq(assetReservations.scheduleBlockId, pickupBlock.id),
          eq(assetReservations.status, "active"),
        ),
      );
    const shiftMilliseconds =
      extension.requestedPickupAt.getTime() - extension.previousPickupAt.getTime();
    const shiftedStartsAt = new Date(pickupBlock.startsAt.getTime() + shiftMilliseconds);
    const shiftedEndsAt = new Date(pickupBlock.endsAt.getTime() + shiftMilliseconds);
    for (const reservation of pickupReservations) {
      const scheduleConflicts = await transaction
        .select()
        .from(assetReservations)
        .where(
          and(
            eq(assetReservations.tenantId, tenantId),
            eq(assetReservations.assetId, reservation.assetId),
            eq(assetReservations.status, "active"),
            ne(assetReservations.id, reservation.id),
            lt(assetReservations.startsAt, shiftedEndsAt),
            gt(assetReservations.endsAt, shiftedStartsAt),
          ),
        );
      for (const scheduleConflict of scheduleConflicts) {
        conflicts.push({
          assetId: scheduleConflict.assetId,
          endsAt: scheduleConflict.endsAt.toISOString(),
          reservationId: scheduleConflict.id,
          startsAt: scheduleConflict.startsAt.toISOString(),
          type: "pickup_schedule",
        });
      }
    }
    return {
      conflicts,
      snapshot: {
        conflicts,
        evaluatedAt: new Date().toISOString(),
        occupancyReservationId: occupancy.id,
        pickupScheduleBlockId: pickupBlock.id,
        proposedOccupancyEndsAt: extension.requestedPickupAt.toISOString(),
        proposedPickupEndsAt: shiftedEndsAt.toISOString(),
        proposedPickupStartsAt: shiftedStartsAt.toISOString(),
      },
    };
  }

  private async evaluate(
    transaction: TenantTransaction,
    actor: Actor,
    job: typeof jobs.$inferSelect,
    detail: typeof dumpTrailerRentalDetails.$inferSelect,
    readinessType: string,
    persist: boolean,
  ): Promise<RentalReadinessDto> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const [project] = await transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, job.projectId)));
    if (!project) throw new Error("Rental Project was not found");
    if (project.contractStatus !== "executed" && project.contractRequirement !== "waived") {
      blockers.push("Contract is not executed");
    }
    if (!["satisfied", "waived"].includes(project.depositStatus)) {
      blockers.push("Deposit readiness is not satisfied");
    }
    if (!detail.trailerAssetId) blockers.push("Rental trailer is not selected");
    if (detail.debrisReviewStatus !== "approved") blockers.push("Debris review is not approved");
    if (detail.accessReviewStatus !== "pass")
      blockers.push("Access and towing review is not approved");
    if (["schedule", "dispatch"].includes(readinessType)) {
      await this.addScheduleBlockers(transaction, actor.tenantId, detail, readinessType, blockers);
    }
    if (readinessType === "dispatch") {
      const [inspection] = await transaction
        .select()
        .from(rentalInspections)
        .where(
          and(
            eq(rentalInspections.tenantId, actor.tenantId),
            eq(rentalInspections.rentalDetailId, detail.id),
            eq(rentalInspections.inspectionType, "pre_dropoff"),
            eq(rentalInspections.status, "completed"),
            eq(rentalInspections.releaseDecision, "release"),
            eq(rentalInspections.safeToRelease, true),
          ),
        )
        .orderBy(desc(rentalInspections.inspectionNumber))
        .limit(1);
      if (!inspection) blockers.push("Pre-drop-off inspection does not authorize trailer release");
    }
    const result =
      blockers.length > 0 ? "not_ready" : warnings.length > 0 ? "ready_with_warnings" : "ready";
    const evaluatedAt = new Date();
    if (persist) {
      await transaction.insert(readinessEvaluations).values({
        blockers,
        createdBy: actor.userId,
        evaluatedAt,
        evaluatedBy: actor.userId,
        jobId: job.id,
        readinessType,
        result,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
        warnings,
      });
      await transaction
        .update(jobs)
        .set({ readiness: result, updatedBy: actor.userId })
        .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, job.id)));
      await this.emitChange(transaction, actor, {
        after: { blockers, readinessType, result, warnings },
        commandName: "EvaluateRentalReadiness",
        entityId: detail.id,
        entityType: "DumpTrailerRentalDetail",
        eventType: "rental.readiness_evaluated",
        jobId: job.id,
        summary: `${readinessType} Rental readiness: ${result}`,
      });
    }
    return { blockers, evaluatedAt: evaluatedAt.toISOString(), readinessType, result, warnings };
  }

  private async addScheduleBlockers(
    transaction: TenantTransaction,
    tenantId: string,
    detail: typeof dumpTrailerRentalDetails.$inferSelect,
    readinessType: string,
    blockers: string[],
  ): Promise<void> {
    const blocks = await transaction
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.tenantId, tenantId),
          eq(scheduleBlocks.jobId, detail.jobId),
          inArray(scheduleBlocks.status, ["tentative", "confirmed"]),
        ),
      );
    for (const blockType of ["dropoff", "pickup"]) {
      const block = blocks.find((candidate) => candidate.blockType === blockType);
      if (!block) {
        blockers.push(`Required ${blockType} schedule block is missing`);
        continue;
      }
      if (readinessType === "dispatch" && block.status !== "confirmed") {
        blockers.push(`${capitalize(blockType)} schedule block is not confirmed`);
      }
      const drivers = await transaction
        .select()
        .from(jobAssignments)
        .where(
          and(
            eq(jobAssignments.tenantId, tenantId),
            eq(jobAssignments.scheduleBlockId, block.id),
            eq(jobAssignments.role, "driver"),
            eq(jobAssignments.status, "assigned"),
          ),
        );
      const assignments = await transaction
        .select()
        .from(assetAssignments)
        .where(
          and(
            eq(assetAssignments.tenantId, tenantId),
            eq(assetAssignments.scheduleBlockId, block.id),
            eq(assetAssignments.status, "assigned"),
          ),
        );
      if (drivers.length === 0) blockers.push(`${capitalize(blockType)} has no assigned driver`);
      if (!assignments.some((assignmentRecord) => assignmentRecord.role === "truck")) {
        blockers.push(`${capitalize(blockType)} has no assigned truck`);
      }
      if (
        !assignments.some(
          (assignmentRecord) =>
            assignmentRecord.role === "trailer" &&
            assignmentRecord.assetId === detail.trailerAssetId,
        )
      ) {
        blockers.push(`${capitalize(blockType)} does not assign the Rental trailer`);
      }
    }
    const [occupancy] = detail.trailerAssetId
      ? await transaction
          .select()
          .from(assetReservations)
          .where(
            and(
              eq(assetReservations.tenantId, tenantId),
              eq(assetReservations.jobId, detail.jobId),
              eq(assetReservations.assetId, detail.trailerAssetId),
              eq(assetReservations.reservationType, "occupancy"),
              eq(assetReservations.status, "active"),
            ),
          )
          .limit(1)
      : [];
    if (
      !occupancy ||
      occupancy.startsAt > detail.plannedDropoffAt ||
      occupancy.endsAt < detail.plannedPickupAt
    ) {
      blockers.push("Continuous trailer occupancy does not cover the Rental term");
    }
  }

  private async acceptedTerms(
    transaction: TenantTransaction,
    tenantId: string,
    job: typeof jobs.$inferSelect,
  ) {
    const [record] = await transaction
      .select({ estimate: estimateVersions, project: projects, quote: quoteVersions })
      .from(projects)
      .innerJoin(
        quoteVersions,
        and(
          eq(quoteVersions.tenantId, projects.tenantId),
          eq(quoteVersions.id, projects.acceptedQuoteVersionId),
        ),
      )
      .innerJoin(
        estimateVersions,
        and(
          eq(estimateVersions.tenantId, quoteVersions.tenantId),
          eq(estimateVersions.id, quoteVersions.estimateVersionId),
        ),
      )
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, job.projectId)));
    if (!record) throw new Error("Accepted Rental commercial terms were not found");
    if (
      record.quote.status !== "accepted" ||
      record.estimate.serviceType !== "dump_trailer_rental"
    ) {
      throw conflict(
        "RENTAL_ACCEPTED_TERMS_INVALID",
        "Rental planning requires an accepted Dump Trailer Rental Quote Version",
      );
    }
    const acceptedRates = objectValue(record.estimate.inputSnapshot.acceptedRates);
    const includedDays = integerValue(acceptedRates.includedDays, "includedDays");
    if (includedDays < 1) {
      throw conflict(
        "RENTAL_ACCEPTED_TERMS_INVALID",
        "Accepted Rental includedDays must be positive",
      );
    }
    const additionalDayRateCents = integerValue(
      acceptedRates.additionalDayCents,
      "additionalDayCents",
    );
    const includedWeightPounds = integerValue(
      acceptedRates.includedWeightPounds,
      "includedWeightPounds",
    ).toFixed(3);
    const overageRateCentsPerPound = integerValue(
      acceptedRates.overageRateCentsPerPound,
      "overageRateCentsPerPound",
    );
    const depositAmountCents = integerValue(
      acceptedRates.securityDepositCents,
      "securityDepositCents",
    );
    const snapshot = {
      acceptedRates,
      estimateContentHash: record.estimate.contentHash,
      quoteContentHash: record.quote.contentHash,
      quoteTotalCents: record.quote.totalCents,
      quoteVersionId: record.quote.id,
    };
    return {
      additionalDayRateCents,
      depositAmountCents,
      hash: hashCanonicalPayload(snapshot),
      includedDays,
      includedWeightPounds,
      overageRateCentsPerPound,
      quoteVersionId: record.quote.id,
      snapshot,
    };
  }

  private async lockJob(transaction: TenantTransaction, tenantId: string, jobId: string) {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)))
      .for("update");
    if (!job) throw notFound("JOB_NOT_FOUND", "Job was not found");
    return job;
  }

  private async lockDetail(transaction: TenantTransaction, tenantId: string, detailId: string) {
    const [reference] = await transaction
      .select({ jobId: dumpTrailerRentalDetails.jobId })
      .from(dumpTrailerRentalDetails)
      .where(
        and(
          eq(dumpTrailerRentalDetails.tenantId, tenantId),
          eq(dumpTrailerRentalDetails.id, detailId),
        ),
      );
    if (!reference) throw notFound("RENTAL_NOT_FOUND", "Dump Trailer Rental was not found");
    const job = await this.lockJob(transaction, tenantId, reference.jobId);
    this.assertRentalJob(job);
    const [detail] = await transaction
      .select()
      .from(dumpTrailerRentalDetails)
      .where(
        and(
          eq(dumpTrailerRentalDetails.tenantId, tenantId),
          eq(dumpTrailerRentalDetails.id, detailId),
        ),
      )
      .for("update");
    if (!detail) throw notFound("RENTAL_NOT_FOUND", "Dump Trailer Rental was not found");
    return { detail, job };
  }

  private assertRentalJob(job: typeof jobs.$inferSelect): void {
    if (job.serviceType !== "dump_trailer_rental") {
      throw conflict("JOB_SERVICE_MISMATCH", "Job is not a Dump Trailer Rental");
    }
    if (["closed", "cancelled"].includes(job.status)) {
      throw conflict("JOB_LOCKED", "Closed or cancelled Jobs cannot be changed");
    }
  }

  private async requireAvailableAsset(
    transaction: TenantTransaction,
    tenantId: string,
    assetId: string,
    type: "truck" | "trailer",
  ) {
    const [asset] = await transaction
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.id, assetId)));
    if (!asset) throw notFound("ASSET_NOT_FOUND", "Asset was not found");
    if (asset.assetType !== type || asset.status !== "available") {
      throw conflict("RENTAL_ASSET_UNAVAILABLE", `Selected ${type} must be available`);
    }
    return asset;
  }

  private async requireActiveUser(
    transaction: TenantTransaction,
    tenantId: string,
    userId: string,
  ) {
    const [user] = await transaction
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId), eq(users.status, "active")));
    if (!user) throw notFound("DRIVER_NOT_FOUND", "Active driver was not found");
    return user;
  }

  private async requireDocument(
    transaction: TenantTransaction,
    tenantId: string,
    documentId: string,
  ) {
    const [document] = await transaction
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)));
    if (!document) throw notFound("DOCUMENT_NOT_FOUND", "Evidence Document was not found");
    if (document.status !== "available") {
      throw conflict("DOCUMENT_NOT_AVAILABLE", "Evidence Document is not available");
    }
    return document;
  }

  private async getDetail(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
  ): Promise<DumpTrailerRentalDto> {
    const [detail] = await transaction
      .select()
      .from(dumpTrailerRentalDetails)
      .where(
        and(
          eq(dumpTrailerRentalDetails.tenantId, tenantId),
          eq(dumpTrailerRentalDetails.jobId, jobId),
        ),
      );
    if (!detail) throw notFound("RENTAL_NOT_FOUND", "Dump Trailer Rental was not found");
    const reviews = await transaction
      .select()
      .from(rentalDebrisReviews)
      .where(
        and(
          eq(rentalDebrisReviews.tenantId, tenantId),
          eq(rentalDebrisReviews.rentalDetailId, detail.id),
        ),
      )
      .orderBy(asc(rentalDebrisReviews.reviewNumber));
    const inspections = await transaction
      .select()
      .from(rentalInspections)
      .where(
        and(
          eq(rentalInspections.tenantId, tenantId),
          eq(rentalInspections.rentalDetailId, detail.id),
        ),
      )
      .orderBy(asc(rentalInspections.inspectionNumber));
    const extensions = await transaction
      .select()
      .from(rentalExtensions)
      .where(
        and(
          eq(rentalExtensions.tenantId, tenantId),
          eq(rentalExtensions.rentalDetailId, detail.id),
        ),
      )
      .orderBy(asc(rentalExtensions.extensionNumber));
    const pickupAttempts = await transaction
      .select()
      .from(rentalPickupAttempts)
      .where(
        and(
          eq(rentalPickupAttempts.tenantId, tenantId),
          eq(rentalPickupAttempts.rentalDetailId, detail.id),
        ),
      )
      .orderBy(asc(rentalPickupAttempts.attemptNumber));
    const rentalDisposalLoads = await transaction
      .select()
      .from(disposalLoads)
      .where(and(eq(disposalLoads.tenantId, tenantId), eq(disposalLoads.rentalDetailId, detail.id)))
      .orderBy(asc(disposalLoads.sequence));
    const operationalCharges = await transaction
      .select()
      .from(jobCharges)
      .where(
        and(
          eq(jobCharges.tenantId, tenantId),
          eq(jobCharges.jobId, jobId),
          inArray(jobCharges.sourceType, [
            "dump_trailer_rental_detail",
            "rental_extension",
            "rental_pickup_attempt",
            "disposal_load",
            "rental_inspection",
          ]),
        ),
      )
      .orderBy(asc(jobCharges.createdAt));
    const blocks = await transaction
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.tenantId, tenantId),
          eq(scheduleBlocks.jobId, jobId),
          inArray(scheduleBlocks.blockType, ["dropoff", "pickup", "disposal", "inspection"]),
        ),
      )
      .orderBy(asc(scheduleBlocks.startsAt));
    const occupancyRecords = await transaction
      .select()
      .from(assetReservations)
      .where(
        and(
          eq(assetReservations.tenantId, tenantId),
          eq(assetReservations.jobId, jobId),
          eq(assetReservations.reservationType, "occupancy"),
        ),
      )
      .orderBy(desc(assetReservations.createdAt));
    const readiness = await transaction
      .select()
      .from(readinessEvaluations)
      .where(
        and(eq(readinessEvaluations.tenantId, tenantId), eq(readinessEvaluations.jobId, jobId)),
      )
      .orderBy(desc(readinessEvaluations.evaluatedAt))
      .limit(1);
    const schedule: DumpTrailerRentalDto["schedule"] = [];
    for (const block of blocks) {
      const drivers = await transaction
        .select({ userId: jobAssignments.userId })
        .from(jobAssignments)
        .where(
          and(
            eq(jobAssignments.tenantId, tenantId),
            eq(jobAssignments.scheduleBlockId, block.id),
            ne(jobAssignments.status, "cancelled"),
          ),
        );
      const assignedAssets = await transaction
        .select({ assetId: assetAssignments.assetId })
        .from(assetAssignments)
        .where(
          and(
            eq(assetAssignments.tenantId, tenantId),
            eq(assetAssignments.scheduleBlockId, block.id),
            ne(assetAssignments.status, "cancelled"),
          ),
        );
      schedule.push({
        assetIds: assignedAssets.map((assignmentRecord) => assignmentRecord.assetId),
        blockType: block.blockType,
        driverUserIds: drivers.map((driver) => driver.userId),
        endsAt: block.endsAt.toISOString(),
        id: block.id,
        startsAt: block.startsAt.toISOString(),
        status: block.status,
      });
    }
    const occupancy = occupancyRecords[0];
    const latestReadiness = readiness[0];
    return {
      accessReviewStatus: detail.accessReviewStatus,
      actualDropoffAt: detail.actualDropoffAt?.toISOString() ?? null,
      actualPickupAt: detail.actualPickupAt?.toISOString() ?? null,
      additionalDayRateCents: detail.additionalDayRateCents,
      customerCustodyEndedAt: detail.customerCustodyEndedAt?.toISOString() ?? null,
      debrisReviews: reviews.map((review) => ({
        accessStatus: review.accessStatus,
        customerAttested: review.customerAttested,
        id: review.id,
        legalTowingStatus: review.legalTowingStatus,
        outcomeNotes: review.outcomeNotes,
        primaryDebrisType: review.primaryDebrisType,
        prohibitedMaterials: review.prohibitedMaterials,
        reviewNumber: review.reviewNumber,
        status: review.status,
      })),
      debrisReviewStatus: detail.debrisReviewStatus,
      depositAmountCents: detail.depositAmountCents,
      depositClassification: detail.depositClassification,
      disposalLoads: rentalDisposalLoads.map(disposalLoadDto),
      emptyTrailerStatus: detail.emptyTrailerStatus,
      extensions: extensions.map(extensionDto),
      finalCondition: detail.finalCondition,
      id: detail.id,
      includedDays: detail.includedDays,
      includedWeightPounds: detail.includedWeightPounds,
      inspections: inspections.map(inspectionDto),
      invoiceReadiness: detail.invoiceReadiness,
      jobId: detail.jobId,
      latestReadiness: latestReadiness
        ? {
            blockers: latestReadiness.blockers,
            evaluatedAt: latestReadiness.evaluatedAt.toISOString(),
            readinessType: latestReadiness.readinessType,
            result: latestReadiness.result,
            warnings: latestReadiness.warnings,
          }
        : null,
      occupancy: occupancy
        ? {
            endsAt: occupancy.endsAt.toISOString(),
            id: occupancy.id,
            startsAt: occupancy.startsAt.toISOString(),
            status: occupancy.status,
            trailerAssetId: occupancy.assetId,
          }
        : null,
      occupancyReleasedAt: detail.occupancyReleasedAt?.toISOString() ?? null,
      operationalCharges: operationalCharges.map(operationalChargeDto),
      operationallyCompletedAt: detail.operationallyCompletedAt?.toISOString() ?? null,
      overageRateCentsPerPound: detail.overageRateCentsPerPound,
      overageWeightPounds: detail.overageWeightPounds,
      onRentAt: detail.onRentAt?.toISOString() ?? null,
      pickupAttempts: pickupAttempts.map(pickupAttemptDto),
      plannedDropoffAt: detail.plannedDropoffAt.toISOString(),
      plannedPickupAt: detail.plannedPickupAt.toISOString(),
      rateType: detail.rateType,
      schedule,
      status: detail.status,
      totalActualWeightPounds: detail.totalActualWeightPounds,
      trailerAssetId: detail.trailerAssetId,
    };
  }

  private async emitChange(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      jobId: string;
      metadata?: Record<string, unknown>;
      summary: string;
    },
  ): Promise<void> {
    const metadata = { entityId: input.entityId, ...(input.metadata ?? {}) };
    await transaction.insert(jobEvents).values({
      actorUserId: actor.userId,
      eventType: input.eventType,
      jobId: input.jobId,
      metadata,
      summary: input.summary,
      tenantId: actor.tenantId,
    });
    const auditEventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: auditEventId,
      metadata: { jobId: input.jobId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor.userId,
      eventType: input.eventType,
      payload: { auditEventId, jobId: input.jobId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
      updatedBy: actor.userId,
    });
  }
}

const dropoffTransitions: Record<
  RentalDropoffAction,
  { commandName: string; eventType: string; from: string; summary: string; to: string }
> = {
  "arrive-dropoff": {
    commandName: "ArriveRentalDropoff",
    eventType: "rental.dropoff_arrived",
    from: "en_route_dropoff",
    summary: "Driver arrived for trailer drop-off",
    to: "at_customer_dropoff",
  },
  "begin-rental": {
    commandName: "BeginRentalCustody",
    eventType: "rental.on_rent",
    from: "delivered",
    summary: "Trailer entered customer custody",
    to: "on_rent",
  },
  "complete-dropoff": {
    commandName: "CompleteRentalDropoff",
    eventType: "rental.dropoff_completed",
    from: "at_customer_dropoff",
    summary: "Trailer drop-off completed",
    to: "delivered",
  },
  "depart-dropoff": {
    commandName: "DepartForRentalDropoff",
    eventType: "rental.dropoff_departed",
    from: "dropoff_preparing",
    summary: "Driver departed for trailer drop-off",
    to: "en_route_dropoff",
  },
  "prepare-dropoff": {
    commandName: "PrepareRentalDropoff",
    eventType: "rental.dropoff_preparing",
    from: "scheduled_dropoff",
    summary: "Trailer drop-off preparation started",
    to: "dropoff_preparing",
  },
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

function assignment(actor: Actor, jobId: string, blockId: string, assetId: string, role: string) {
  return {
    assetId,
    createdBy: actor.userId,
    jobId,
    role,
    scheduleBlockId: blockId,
    tenantId: actor.tenantId,
    updatedBy: actor.userId,
  };
}

function driverAssignment(actor: Actor, jobId: string, blockId: string, userId: string) {
  return {
    createdBy: actor.userId,
    jobId,
    role: "driver",
    scheduleBlockId: blockId,
    tenantId: actor.tenantId,
    updatedBy: actor.userId,
    userId,
  };
}

function scheduleTimes(input: PlanRentalScheduleDto) {
  const times = {
    dropoffEndsAt: new Date(input.dropoffEndsAt),
    dropoffStartsAt: new Date(input.dropoffStartsAt),
    pickupEndsAt: new Date(input.pickupEndsAt),
    pickupStartsAt: new Date(input.pickupStartsAt),
  };
  if (times.dropoffEndsAt <= times.dropoffStartsAt || times.pickupEndsAt <= times.pickupStartsAt) {
    throw badRequest(
      "RENTAL_SCHEDULE_RANGE_INVALID",
      "Each schedule block must have a positive duration",
    );
  }
  return times;
}

function assertContains(startsAt: Date, endsAt: Date, plannedAt: Date, label: string): void {
  if (plannedAt < startsAt || plannedAt > endsAt) {
    throw badRequest(
      "RENTAL_SCHEDULE_WINDOW_INVALID",
      `The planned ${label} time must be inside its schedule block`,
    );
  }
}

function rateType(includedDays: number): string {
  if (includedDays === 1) return "daily";
  if (includedDays === 3) return "weekend";
  if (includedDays === 7) return "weekly";
  return "custom";
}

function assetSnapshot(asset: typeof assets.$inferSelect): Record<string, unknown> {
  return {
    assetId: asset.id,
    assetNumber: asset.assetNumber,
    capacityVolumeCubicYards: asset.capacityVolumeCubicYards,
    capacityWeightPounds: asset.capacityWeight,
    name: asset.name,
  };
}

function documentSnapshot(document: typeof documents.$inferSelect): Record<string, unknown> {
  return {
    documentId: document.id,
    mediaType: document.mediaType,
    originalFilename: document.originalFilename,
    sha256: document.sha256,
    sizeBytes: document.sizeBytes,
  };
}

function inspectionDto(inspection: typeof rentalInspections.$inferSelect): RentalInspectionDto {
  return {
    conditionResult: inspection.conditionResult,
    evidenceDocumentId: inspection.evidenceDocumentId,
    id: inspection.id,
    inspectionNumber: inspection.inspectionNumber,
    inspectionType: inspection.inspectionType,
    releaseDecision: inspection.releaseDecision,
    safeToRelease: inspection.safeToRelease,
    status: inspection.status,
  };
}

function extensionDto(extension: typeof rentalExtensions.$inferSelect): RentalExtensionDto {
  return {
    additionalDays: extension.additionalDays,
    calculatedAmountCents: extension.calculatedAmountCents,
    conflictStatus: extension.conflictStatus,
    customerAuthorizationStatus: extension.customerAuthorizationStatus,
    decidedAt: extension.decidedAt?.toISOString() ?? null,
    decisionReason: extension.decisionReason,
    extensionNumber: extension.extensionNumber,
    id: extension.id,
    previousPickupAt: extension.previousPickupAt.toISOString(),
    rateCents: extension.rateCents,
    requestedPickupAt: extension.requestedPickupAt.toISOString(),
    status: extension.status,
  };
}

function pickupAttemptDto(
  attempt: typeof rentalPickupAttempts.$inferSelect,
): DumpTrailerRentalDto["pickupAttempts"][number] {
  return {
    accessStatus: attempt.accessStatus,
    arrivedAt: attempt.arrivedAt?.toISOString() ?? null,
    attemptedAt: attempt.attemptedAt?.toISOString() ?? null,
    attemptNumber: attempt.attemptNumber,
    completedAt: attempt.completedAt?.toISOString() ?? null,
    customerCustodyEndedAt: attempt.customerCustodyEndedAt?.toISOString() ?? null,
    customerNotifiedAt: attempt.customerNotifiedAt?.toISOString() ?? null,
    failureReason: attempt.failureReason,
    id: attempt.id,
    outcomeNotes: attempt.outcomeNotes,
    routeStopId: attempt.routeStopId,
    safeLoadStatus: attempt.safeLoadStatus,
    scheduleBlockId: attempt.scheduleBlockId,
    status: attempt.status,
    trailerAssetId: attempt.trailerAssetId,
  };
}

function disposalLoadDto(
  load: typeof disposalLoads.$inferSelect,
): DumpTrailerRentalDto["disposalLoads"][number] {
  return {
    acceptanceResult: load.acceptanceResult,
    canonicalNetWeightPounds: load.canonicalNetWeightPounds,
    debrisClassification: load.debrisClassification,
    disposalFeeCents: load.disposalFeeCents,
    emptyTrailerStatus: load.emptyTrailerStatus,
    expenseId: load.expenseId,
    grossWeight: load.grossWeight,
    id: load.id,
    netWeight: load.netWeight,
    receiptStatus: load.receiptStatus,
    redirectedFromDisposalLoadId: load.redirectedFromDisposalLoadId,
    rejectionReason: load.rejectionReason,
    remainingMaterialStatus: load.remainingMaterialStatus,
    sequence: load.sequence,
    status: load.status,
    tareWeight: load.tareWeight,
    ticketStatus: load.ticketStatus,
    unloadingResult: load.unloadingResult,
    weightStatus: load.weightStatus,
  };
}

function operationalChargeDto(
  charge: typeof jobCharges.$inferSelect,
): DumpTrailerRentalDto["operationalCharges"][number] {
  return {
    approvedAmountCents: charge.approvedAmountCents,
    chargeNumber: charge.chargeNumber,
    chargeType: charge.chargeType,
    customerDescription: charge.customerDescription,
    id: charge.id,
    quantity: charge.quantity,
    rateCents: charge.rateCents,
    sourceId: charge.sourceId,
    sourceType: charge.sourceType,
    status: charge.status,
  };
}

function assertDisposalState(status: string, allowed: string[], action: string): void {
  if (allowed.includes(status)) return;
  throw conflict(
    "RENTAL_DISPOSAL_TRANSITION_INVALID",
    `Disposal Load cannot ${action} while it is ${status}`,
  );
}

function disposalWeight(grossValue: string, tareValue: string, unit: string) {
  const grossMillis = decimalToMillis(grossValue);
  const tareMillis = decimalToMillis(tareValue);
  if (grossMillis < tareMillis) {
    throw badRequest(
      "RENTAL_DISPOSAL_WEIGHT_INVALID",
      "Gross disposal weight must be at least the tare weight",
    );
  }
  const netMillis = grossMillis - tareMillis;
  const canonicalMilliPounds = unit === "tons" ? netMillis * 2_000n : netMillis;
  if (canonicalMilliPounds > MAX_DECIMAL_MILLIS) {
    throw badRequest(
      "RENTAL_DISPOSAL_WEIGHT_OUT_OF_RANGE",
      "Canonical disposal weight exceeds the supported range",
    );
  }
  return {
    canonicalNetWeightPounds: millisToDecimal(canonicalMilliPounds),
    grossWeight: millisToDecimal(grossMillis),
    netWeight: millisToDecimal(netMillis),
    tareWeight: millisToDecimal(tareMillis),
  };
}

function disposalReconciliationBlockers(load: typeof disposalLoads.$inferSelect): string[] {
  const blockers: string[] = [];
  if (!load.actualFacilityLocationId) blockers.push("Actual disposal facility is missing");
  if (load.acceptanceResult !== "accepted") blockers.push("Facility acceptance is incomplete");
  if (load.unloadingResult !== "unloaded") blockers.push("Unloading is incomplete");
  if (!["recorded", "not_applicable", "waived"].includes(load.weightStatus)) {
    blockers.push("Weight reconciliation is incomplete");
  }
  if (!["attached", "waived", "not_required"].includes(load.ticketStatus)) {
    blockers.push("Scale ticket evidence is incomplete");
  }
  if (!["attached", "waived", "not_required"].includes(load.receiptStatus)) {
    blockers.push("Receipt evidence is incomplete");
  }
  if (load.emptyTrailerStatus !== "confirmed_empty" || !load.emptyTrailerDocumentId) {
    blockers.push("Empty-trailer evidence is incomplete");
  }
  if (!["none", "resolved"].includes(load.remainingMaterialStatus)) {
    blockers.push("Remaining material is unresolved");
  }
  if ((load.disposalFeeCents ?? 0) > 0 && !load.expenseId) {
    blockers.push("Disposal Expense is missing");
  }
  return blockers;
}

function unresolvedDisposalLoads(
  loads: (typeof disposalLoads.$inferSelect)[],
  newlyReconciledId?: string,
): (typeof disposalLoads.$inferSelect)[] {
  const replacements = new Map<string, (typeof disposalLoads.$inferSelect)[]>();
  for (const load of loads) {
    if (!load.redirectedFromDisposalLoadId) continue;
    const children = replacements.get(load.redirectedFromDisposalLoadId) ?? [];
    children.push(load);
    replacements.set(load.redirectedFromDisposalLoadId, children);
  }
  const effectiveStatus = (load: typeof disposalLoads.$inferSelect) =>
    load.id === newlyReconciledId ? "reconciled" : load.status;
  const resolved = (load: typeof disposalLoads.$inferSelect, visiting: Set<string>): boolean => {
    const status = effectiveStatus(load);
    if (["reconciled", "cancelled"].includes(status)) return true;
    if (!["rejected", "redirected"].includes(status) || visiting.has(load.id)) return false;
    const nextVisiting = new Set(visiting).add(load.id);
    return (replacements.get(load.id) ?? []).some((replacement) =>
      resolved(replacement, nextVisiting),
    );
  };
  return loads.filter((load) => !resolved(load, new Set()));
}

const MAX_DECIMAL_MILLIS = 99_999_999_999_999n;

function decimalToMillis(value: string): bigint {
  const match = /^(\d{1,11})(?:\.(\d{1,3}))?$/.exec(value);
  if (!match?.[1]) {
    throw badRequest(
      "RENTAL_DECIMAL_INVALID",
      "Rental quantity must be a non-negative decimal with at most three decimal places",
    );
  }
  const millis = BigInt(match[1]) * 1_000n + BigInt((match[2] ?? "").padEnd(3, "0"));
  if (millis > MAX_DECIMAL_MILLIS) {
    throw badRequest("RENTAL_DECIMAL_OUT_OF_RANGE", "Rental quantity exceeds the supported range");
  }
  return millis;
}

function millisToDecimal(millis: bigint): string {
  const whole = millis / 1_000n;
  const fraction = (millis % 1_000n).toString().padStart(3, "0");
  return `${whole.toString()}.${fraction}`;
}

function calculateDecimalRateAmount(quantityMillis: bigint, rateCents: number): number {
  const amount = (quantityMillis * BigInt(rateCents) + 500n) / 1_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw badRequest(
      "RENTAL_CHARGE_AMOUNT_OUT_OF_RANGE",
      "Derived Rental charge exceeds the supported money range",
    );
  }
  return Number(amount);
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function optionalTrim(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw conflict("RENTAL_ACCEPTED_TERMS_INVALID", "Accepted Rental rate snapshot is missing");
  }
  return value as Record<string, unknown>;
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw conflict(
      "RENTAL_ACCEPTED_TERMS_INVALID",
      `Accepted Rental ${field} must be a non-negative integer`,
    );
  }
  return value;
}

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { cause?: unknown; code?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return databaseCode(candidate.cause);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pascalAction(value: string): string {
  return value.split("-").map(capitalize).join("");
}

function badRequest(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.BAD_REQUEST, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
