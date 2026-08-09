import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  assetAssignments,
  assetReservations,
  assets,
  auditEvents,
  checklistInstances,
  checklistItems,
  customerAccounts,
  jobAssignments,
  jobEvents,
  jobs,
  materialDeliveryDetails,
  materialLoadValidations,
  materialLoads,
  operationalHolds,
  outboxEvents,
  projects,
  readinessEvaluations,
  routeStops,
  scheduleBlocks,
  users,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  AssetDto,
  AssetListResponseDto,
  ChecklistDto,
  ChecklistItemDto,
  CompleteChecklistItemDto,
  CreateAssetDto,
  CreateChecklistDto,
  CreateRouteStopDto,
  CreateScheduleBlockDto,
  EvaluateReadinessDto,
  JobDetailDto,
  JobListResponseDto,
  LifecycleActionDto,
  ReadinessEvaluationDto,
  RouteStopDto,
  ScheduleBlockDto,
  ScheduleCalendarResponseDto,
} from "./operations.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

export const jobTransitionActions = [
  "start-planning",
  "request-scheduling",
  "confirm-schedule",
  "mark-dispatch-ready",
  "start",
  "complete-operationally",
  "await-final-invoice",
  "mark-invoiced",
  "complete-financially",
  "close",
  "place-hold",
  "release-hold",
  "cancel",
  "reopen",
] as const;
export type JobTransitionAction = (typeof jobTransitionActions)[number];

@Injectable()
export class JobsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
  ) {}

  public async list(status?: string): Promise<JobListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const where = status
        ? and(eq(jobs.tenantId, actor.tenantId), eq(jobs.status, status))
        : eq(jobs.tenantId, actor.tenantId);
      const records = await transaction
        .select({
          customerName: customerAccounts.displayName,
          job: jobs,
          projectNumber: projects.projectNumber,
        })
        .from(jobs)
        .innerJoin(
          projects,
          and(eq(projects.tenantId, jobs.tenantId), eq(projects.id, jobs.projectId)),
        )
        .innerJoin(
          customerAccounts,
          and(
            eq(customerAccounts.tenantId, projects.tenantId),
            eq(customerAccounts.id, projects.customerAccountId),
          ),
        )
        .where(where)
        .orderBy(desc(jobs.updatedAt))
        .limit(100);
      return {
        items: records.map((record) =>
          jobSummary(record.job, record.projectNumber, record.customerName),
        ),
      };
    });
  }

  public async get(jobId: string): Promise<JobDetailDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.getDetail(transaction, actor.tenantId, jobId),
    );
  }

  public async transition(
    jobId: string,
    action: JobTransitionAction,
    input: LifecycleActionDto,
    key: string,
  ): Promise<JobDetailDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, input, jobId }, scope: `jobs.transition.${action}` },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        if (action === "complete-financially") {
          throw invalidState(
            "JOB_FINANCIAL_COMPLETION_IS_DERIVED",
            "Use the finance completion evaluator; Job financial completion cannot be set directly",
          );
        }
        if (action === "place-hold") {
          requireReason(input.reason);
          if (["closed", "cancelled", "on_hold"].includes(job.status))
            throw invalidState("JOB_HOLD_INVALID", "This Job cannot be placed on hold");
          await transaction.insert(operationalHolds).values({
            createdBy: actor.userId,
            jobId,
            placedBy: actor.userId,
            previousStatus: job.status,
            reason: input.reason.trim(),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          });
          await transaction
            .update(jobs)
            .set({ status: "on_hold", updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await this.emitJobEvent(transaction, actor, jobId, "job.held", "Job placed on hold", {
            previousStatus: job.status,
          });
        } else if (action === "release-hold") {
          const [hold] = await transaction
            .select()
            .from(operationalHolds)
            .where(
              and(
                eq(operationalHolds.tenantId, actor.tenantId),
                eq(operationalHolds.jobId, jobId),
                eq(operationalHolds.status, "active"),
              ),
            )
            .for("update");
          if (!hold || job.status !== "on_hold")
            throw invalidState("JOB_NOT_ON_HOLD", "Job has no active hold");
          await transaction
            .update(operationalHolds)
            .set({
              releaseReason: optionalReason(input.reason, "Hold resolved"),
              releasedAt: new Date(),
              releasedBy: actor.userId,
              status: "released",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(operationalHolds.tenantId, actor.tenantId), eq(operationalHolds.id, hold.id)),
            );
          await transaction
            .update(jobs)
            .set({ status: hold.previousStatus, updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await this.emitJobEvent(
            transaction,
            actor,
            jobId,
            "job.hold_released",
            "Job hold released",
            { restoredStatus: hold.previousStatus },
          );
        } else if (action === "cancel") {
          requireReason(input.reason);
          if (["closed", "cancelled", "financially_complete"].includes(job.status))
            throw invalidState("JOB_CANCELLATION_INVALID", "This Job cannot be cancelled");
          const now = new Date();
          await transaction
            .update(jobs)
            .set({ cancelledAt: now, status: "cancelled", updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await transaction
            .update(assetReservations)
            .set({ releasedAt: now, status: "cancelled", updatedBy: actor.userId })
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.jobId, jobId),
                eq(assetReservations.status, "active"),
              ),
            );
          await transaction
            .update(scheduleBlocks)
            .set({ cancelledAt: now, status: "cancelled", updatedBy: actor.userId })
            .where(
              and(eq(scheduleBlocks.tenantId, actor.tenantId), eq(scheduleBlocks.jobId, jobId)),
            );
          await this.emitJobEvent(transaction, actor, jobId, "job.cancelled", "Job cancelled", {
            reason: input.reason.trim(),
          });
        } else if (action === "confirm-schedule") {
          if (job.status !== "needs_scheduling")
            throw invalidState(
              "JOB_NOT_WAITING_FOR_SCHEDULE",
              "Job must need scheduling before confirmation",
            );
          const readiness = await this.evaluate(transaction, actor, job, "schedule", false);
          if (readiness.result === "not_ready")
            throw new ApiException(
              HttpStatus.CONFLICT,
              "JOB_NOT_READY_TO_SCHEDULE",
              "Job is not ready to schedule",
              { blockers: readiness.blockers },
            );
          const blocks = await transaction
            .select()
            .from(scheduleBlocks)
            .where(
              and(
                eq(scheduleBlocks.tenantId, actor.tenantId),
                eq(scheduleBlocks.jobId, jobId),
                eq(scheduleBlocks.status, "tentative"),
              ),
            )
            .orderBy(asc(scheduleBlocks.startsAt));
          const first = blocks[0];
          const last = blocks.at(-1);
          if (!first || !last)
            throw invalidState(
              "JOB_SCHEDULE_BLOCKS_REQUIRED",
              "At least one Schedule Block is required",
            );
          const now = new Date();
          await transaction
            .update(scheduleBlocks)
            .set({ confirmedAt: now, status: "confirmed", updatedBy: actor.userId })
            .where(
              and(
                eq(scheduleBlocks.tenantId, actor.tenantId),
                eq(scheduleBlocks.jobId, jobId),
                eq(scheduleBlocks.status, "tentative"),
              ),
            );
          await transaction
            .update(jobs)
            .set({
              readiness: readiness.result,
              scheduledEndAt: last.endsAt,
              scheduledStartAt: first.startsAt,
              status: "scheduled",
              updatedBy: actor.userId,
            })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await this.emitJobEvent(
            transaction,
            actor,
            jobId,
            "job.scheduled",
            "Job schedule confirmed",
            {
              scheduledEndAt: last.endsAt.toISOString(),
              scheduledStartAt: first.startsAt.toISOString(),
            },
          );
        } else {
          const transition = jobTransitions[action];
          if (job.status !== transition.from)
            throw invalidState(
              "JOB_TRANSITION_INVALID",
              `Job must be ${transition.from} before ${action}`,
            );
          if (action === "start-planning") {
            const [project] = await transaction
              .select()
              .from(projects)
              .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, job.projectId)))
              .for("update");
            if (!project || !["ready_for_planning", "planning", "active"].includes(project.status))
              throw invalidState(
                "PROJECT_NOT_READY_FOR_PLANNING",
                "Project readiness must be satisfied before Job planning",
              );
          }
          if (action === "mark-dispatch-ready") {
            const readiness = await this.evaluate(transaction, actor, job, "dispatch", false);
            if (readiness.result === "not_ready")
              throw new ApiException(
                HttpStatus.CONFLICT,
                "JOB_NOT_DISPATCH_READY",
                "Job is not dispatch ready",
                { blockers: readiness.blockers },
              );
          }
          if (action === "complete-operationally") {
            const readiness = await this.evaluate(transaction, actor, job, "completion", false);
            if (readiness.result === "not_ready")
              throw new ApiException(
                HttpStatus.CONFLICT,
                "JOB_NOT_READY_TO_COMPLETE",
                "Job is not ready for operational completion",
                { blockers: readiness.blockers },
              );
          }
          if (action === "reopen") requireReason(input.reason);
          const now = new Date();
          const timestamps: Partial<typeof jobs.$inferInsert> = {};
          if (action === "start") timestamps.startedAt = now;
          if (action === "complete-operationally") timestamps.operationallyCompletedAt = now;
          if (action === "close") timestamps.closedAt = now;
          if (action === "reopen") timestamps.reopenedAt = now;
          await transaction
            .update(jobs)
            .set({
              ...timestamps,
              readiness: "evaluation_required",
              status: transition.to,
              updatedBy: actor.userId,
            })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await this.emitJobEvent(
            transaction,
            actor,
            jobId,
            transition.event,
            transition.summary,
            input.reason ? { reason: input.reason.trim() } : {},
          );
        }
        return {
          body: await this.getDetail(transaction, actor.tenantId, jobId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async evaluateReadiness(
    jobId: string,
    input: EvaluateReadinessDto,
    key: string,
  ): Promise<ReadinessEvaluationDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "jobs.evaluate-readiness" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        return {
          body: await this.evaluate(transaction, actor, job, input.readinessType, true),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createAsset(input: CreateAssetDto, key: string): Promise<AssetDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: input, scope: "assets.create" },
      async (transaction) => {
        const [asset] = await transaction
          .insert(assets)
          .values({
            assetNumber: input.assetNumber.trim().toUpperCase(),
            assetType: input.assetType,
            capacityVolumeCubicYards: input.capacityVolumeCubicYards,
            capacityWeight: input.capacityWeight,
            createdBy: actor.userId,
            name: input.name.trim(),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!asset) throw new Error("Asset was not created");
        await this.recordChange(transaction, actor, {
          after: { assetNumber: asset.assetNumber, assetType: asset.assetType },
          commandName: "CreateAsset",
          entityId: asset.id,
          entityType: "Asset",
          eventType: "asset.created",
        });
        return { body: assetDto(asset), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async listAssets(): Promise<AssetListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => ({
      items: (
        await transaction
          .select()
          .from(assets)
          .where(eq(assets.tenantId, actor.tenantId))
          .orderBy(assets.assetNumber)
      ).map(assetDto),
    }));
  }

  public async createScheduleBlock(
    jobId: string,
    input: CreateScheduleBlockDto,
    key: string,
  ): Promise<ScheduleBlockDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "schedule-blocks.create" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        if (!["planning", "needs_scheduling"].includes(job.status))
          throw invalidState("JOB_NOT_SCHEDULABLE", "Job must be in planning or need scheduling");
        const startsAt = parseDate(input.startsAt, "startsAt");
        const endsAt = parseDate(input.endsAt, "endsAt");
        if (endsAt <= startsAt)
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "SCHEDULE_RANGE_INVALID",
            "Schedule end must be after start",
          );
        const uniqueAssetIds = [...new Set(input.assetIds)];
        const uniqueUserIds = [...new Set(input.userIds)];
        const assetRecords = await transaction
          .select()
          .from(assets)
          .where(and(eq(assets.tenantId, actor.tenantId), inArray(assets.id, uniqueAssetIds)));
        if (
          assetRecords.length !== uniqueAssetIds.length ||
          assetRecords.some((asset) => asset.status !== "available")
        )
          throw invalidState(
            "ASSET_UNAVAILABLE",
            "Every assigned asset must exist and be available",
          );
        const userRecords = await transaction
          .select()
          .from(users)
          .where(
            and(
              eq(users.tenantId, actor.tenantId),
              inArray(users.id, uniqueUserIds),
              eq(users.status, "active"),
            ),
          );
        if (userRecords.length !== uniqueUserIds.length)
          throw invalidState(
            "ASSIGNEE_UNAVAILABLE",
            "Every assignee must be an active tenant user",
          );
        try {
          const [block] = await transaction
            .insert(scheduleBlocks)
            .values({
              blockType: input.blockType,
              createdBy: actor.userId,
              endsAt,
              jobId,
              notes: input.notes?.trim(),
              startsAt,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!block) throw new Error("Schedule Block was not created");
          await transaction.insert(assetReservations).values(
            assetRecords.map((asset) => ({
              assetId: asset.id,
              createdBy: actor.userId,
              endsAt,
              jobId,
              scheduleBlockId: block.id,
              startsAt,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })),
          );
          await transaction.insert(assetAssignments).values(
            assetRecords.map((asset) => ({
              assetId: asset.id,
              createdBy: actor.userId,
              jobId,
              role: asset.assetType,
              scheduleBlockId: block.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })),
          );
          await transaction.insert(jobAssignments).values(
            uniqueUserIds.map((userId) => ({
              createdBy: actor.userId,
              jobId,
              role: "driver",
              scheduleBlockId: block.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
              userId,
            })),
          );
          await transaction
            .update(jobs)
            .set({ readiness: "evaluation_required", updatedBy: actor.userId })
            .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)));
          await this.emitJobEvent(
            transaction,
            actor,
            jobId,
            "job.schedule_block_created",
            `${input.blockType} schedule block created`,
            { blockId: block.id },
          );
          return {
            body: scheduleBlockDto(block, job.jobNumber, uniqueAssetIds, uniqueUserIds),
            status: HttpStatus.CREATED,
          };
        } catch (error) {
          if (databaseCode(error) === "23P01")
            throw conflict(
              "ASSET_RESERVATION_CONFLICT",
              "An asset is already reserved during this time window",
            );
          throw error;
        }
      },
    );
    return result.body;
  }

  public async cancelScheduleBlock(
    blockId: string,
    input: LifecycleActionDto,
    key: string,
  ): Promise<ScheduleBlockDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { blockId, input }, scope: "schedule-blocks.cancel" },
      async (transaction) => {
        const [block] = await transaction
          .select()
          .from(scheduleBlocks)
          .where(and(eq(scheduleBlocks.tenantId, actor.tenantId), eq(scheduleBlocks.id, blockId)))
          .for("update");
        if (!block) throw notFound("SCHEDULE_BLOCK_NOT_FOUND", "Schedule Block was not found");
        const [job] = await transaction
          .select()
          .from(jobs)
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, block.jobId)));
        if (!job) throw new Error("Schedule Block Job was not found");
        if (block.status !== "cancelled") {
          const now = new Date();
          await transaction
            .update(scheduleBlocks)
            .set({
              cancelledAt: now,
              notes: input.reason?.trim() ?? block.notes,
              status: "cancelled",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(scheduleBlocks.tenantId, actor.tenantId), eq(scheduleBlocks.id, blockId)),
            );
          await transaction
            .update(assetReservations)
            .set({ releasedAt: now, status: "cancelled", updatedBy: actor.userId })
            .where(
              and(
                eq(assetReservations.tenantId, actor.tenantId),
                eq(assetReservations.scheduleBlockId, blockId),
                eq(assetReservations.status, "active"),
              ),
            );
          await this.emitJobEvent(
            transaction,
            actor,
            block.jobId,
            "job.schedule_block_cancelled",
            "Schedule block cancelled",
            { blockId, reason: input.reason },
          );
        }
        const assetIds = (
          await transaction
            .select()
            .from(assetAssignments)
            .where(
              and(
                eq(assetAssignments.tenantId, actor.tenantId),
                eq(assetAssignments.scheduleBlockId, blockId),
              ),
            )
        ).map((record) => record.assetId);
        const userIds = (
          await transaction
            .select()
            .from(jobAssignments)
            .where(
              and(
                eq(jobAssignments.tenantId, actor.tenantId),
                eq(jobAssignments.scheduleBlockId, blockId),
              ),
            )
        ).map((record) => record.userId);
        return {
          body: scheduleBlockDto(
            { ...block, status: "cancelled" },
            job.jobNumber,
            assetIds,
            userIds,
          ),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async calendar(from: string, to: string): Promise<ScheduleCalendarResponseDto> {
    const actor = this.context.actor();
    const startsAt = parseDate(from, "from");
    const endsAt = parseDate(to, "to");
    if (endsAt <= startsAt)
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "CALENDAR_RANGE_INVALID",
        "Calendar end must be after start",
      );
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const records = await transaction
        .select({ block: scheduleBlocks, jobNumber: jobs.jobNumber })
        .from(scheduleBlocks)
        .innerJoin(
          jobs,
          and(eq(jobs.tenantId, scheduleBlocks.tenantId), eq(jobs.id, scheduleBlocks.jobId)),
        )
        .where(
          and(
            eq(scheduleBlocks.tenantId, actor.tenantId),
            lte(scheduleBlocks.startsAt, endsAt),
            gte(scheduleBlocks.endsAt, startsAt),
          ),
        )
        .orderBy(scheduleBlocks.startsAt);
      const items: ScheduleBlockDto[] = [];
      for (const record of records) {
        const assetIds = (
          await transaction
            .select()
            .from(assetAssignments)
            .where(
              and(
                eq(assetAssignments.tenantId, actor.tenantId),
                eq(assetAssignments.scheduleBlockId, record.block.id),
                eq(assetAssignments.status, "assigned"),
              ),
            )
        ).map((assignment) => assignment.assetId);
        const userIds = (
          await transaction
            .select()
            .from(jobAssignments)
            .where(
              and(
                eq(jobAssignments.tenantId, actor.tenantId),
                eq(jobAssignments.scheduleBlockId, record.block.id),
                eq(jobAssignments.status, "assigned"),
              ),
            )
        ).map((assignment) => assignment.userId);
        items.push(scheduleBlockDto(record.block, record.jobNumber, assetIds, userIds));
      }
      return { items };
    });
  }

  public async createRouteStop(
    jobId: string,
    input: CreateRouteStopDto,
    key: string,
  ): Promise<RouteStopDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "route-stops.create" },
      async (transaction) => {
        await this.assertMutableJob(transaction, actor.tenantId, jobId);
        const [stop] = await transaction
          .insert(routeStops)
          .values({
            createdBy: actor.userId,
            instructions: input.instructions?.trim(),
            jobId,
            label: input.label.trim(),
            locationSnapshot: input.locationSnapshot,
            sequence: input.sequence,
            stopType: input.stopType,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!stop) throw new Error("Route Stop was not created");
        await this.emitJobEvent(
          transaction,
          actor,
          jobId,
          "job.route_stop_created",
          `Route stop ${stop.sequence.toString()} added`,
          { routeStopId: stop.id },
        );
        return { body: routeStopDto(stop), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async createChecklist(
    jobId: string,
    input: CreateChecklistDto,
    key: string,
  ): Promise<ChecklistDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "checklists.create" },
      async (transaction) => {
        await this.assertMutableJob(transaction, actor.tenantId, jobId);
        const [checklist] = await transaction
          .insert(checklistInstances)
          .values({
            createdBy: actor.userId,
            jobId,
            name: input.name.trim(),
            templateCode: input.templateCode.trim(),
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!checklist) throw new Error("Checklist was not created");
        const items = await transaction
          .insert(checklistItems)
          .values(
            input.items.map((item, index) => ({
              checklistInstanceId: checklist.id,
              createdBy: actor.userId,
              label: item.label.trim(),
              sequence: index + 1,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })),
          )
          .returning();
        await this.emitJobEvent(
          transaction,
          actor,
          jobId,
          "job.checklist_created",
          `${checklist.name} checklist created`,
          { checklistId: checklist.id },
        );
        return { body: checklistDto(checklist, items), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async completeChecklistItem(
    itemId: string,
    input: CompleteChecklistItemDto,
    key: string,
  ): Promise<ChecklistItemDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, itemId }, scope: "checklist-items.complete" },
      async (transaction) => {
        const [record] = await transaction
          .select({ checklist: checklistInstances, item: checklistItems })
          .from(checklistItems)
          .innerJoin(
            checklistInstances,
            and(
              eq(checklistInstances.tenantId, checklistItems.tenantId),
              eq(checklistInstances.id, checklistItems.checklistInstanceId),
            ),
          )
          .where(and(eq(checklistItems.tenantId, actor.tenantId), eq(checklistItems.id, itemId)))
          .for("update");
        if (!record) throw notFound("CHECKLIST_ITEM_NOT_FOUND", "Checklist item was not found");
        await this.assertMutableJob(transaction, actor.tenantId, record.checklist.jobId);
        if (record.item.status !== "completed") {
          const completedAt = new Date();
          await transaction
            .update(checklistItems)
            .set({
              completedAt,
              completedBy: actor.userId,
              response: input.response?.trim(),
              status: "completed",
              updatedBy: actor.userId,
            })
            .where(and(eq(checklistItems.tenantId, actor.tenantId), eq(checklistItems.id, itemId)));
          const remaining = await transaction
            .select()
            .from(checklistItems)
            .where(
              and(
                eq(checklistItems.tenantId, actor.tenantId),
                eq(checklistItems.checklistInstanceId, record.checklist.id),
              ),
            );
          if (
            remaining.every(
              (item) => item.id === itemId || ["completed", "not_applicable"].includes(item.status),
            )
          )
            await transaction
              .update(checklistInstances)
              .set({ completedAt, status: "completed", updatedBy: actor.userId })
              .where(
                and(
                  eq(checklistInstances.tenantId, actor.tenantId),
                  eq(checklistInstances.id, record.checklist.id),
                ),
              );
          await this.emitJobEvent(
            transaction,
            actor,
            record.checklist.jobId,
            "job.checklist_item_completed",
            record.item.label,
            { checklistItemId: itemId },
          );
          record.item.status = "completed";
          record.item.response = input.response?.trim() ?? null;
          record.item.completedAt = completedAt;
        }
        return { body: checklistItemDto(record.item), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  private async evaluate(
    transaction: TenantTransaction,
    actor: Actor,
    job: typeof jobs.$inferSelect,
    readinessType: string,
    persist: boolean,
  ): Promise<ReadinessEvaluationDto> {
    const [project] = await transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, job.projectId)));
    if (!project) throw new Error("Job Project was not found");
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (project.contractStatus !== "executed" && project.contractRequirement !== "waived")
      blockers.push("Contract is not executed");
    if (!["satisfied", "waived"].includes(project.depositStatus))
      blockers.push("Deposit readiness is not satisfied");
    if (project.status === "on_hold") blockers.push("Project is on hold");
    const blocks = await transaction
      .select()
      .from(scheduleBlocks)
      .where(
        and(
          eq(scheduleBlocks.tenantId, actor.tenantId),
          eq(scheduleBlocks.jobId, job.id),
          inArray(scheduleBlocks.status, ["tentative", "confirmed"]),
        ),
      );
    if (["schedule", "dispatch"].includes(readinessType)) {
      const required =
        job.serviceType === "dump_trailer_rental" ? ["dropoff", "pickup"] : ["service"];
      for (const type of required)
        if (!blocks.some((block) => block.blockType === type))
          blockers.push(`Required ${type} schedule block is missing`);
      for (const block of blocks) {
        const [driver] = await transaction
          .select()
          .from(jobAssignments)
          .where(
            and(
              eq(jobAssignments.tenantId, actor.tenantId),
              eq(jobAssignments.scheduleBlockId, block.id),
              eq(jobAssignments.status, "assigned"),
            ),
          )
          .limit(1);
        const [asset] = await transaction
          .select()
          .from(assetReservations)
          .where(
            and(
              eq(assetReservations.tenantId, actor.tenantId),
              eq(assetReservations.scheduleBlockId, block.id),
              eq(assetReservations.status, "active"),
            ),
          )
          .limit(1);
        if (!driver) blockers.push(`${block.blockType} block has no driver`);
        if (!asset) blockers.push(`${block.blockType} block has no asset reservation`);
      }
    }
    if (readinessType === "dispatch" && blocks.some((block) => block.status !== "confirmed"))
      blockers.push("Schedule Blocks are not confirmed");
    if (
      job.serviceType === "material_delivery" &&
      ["schedule", "dispatch"].includes(readinessType)
    ) {
      await this.addMaterialDeliverySafetyBlockers(
        transaction,
        actor.tenantId,
        job.id,
        readinessType === "dispatch" ? "dispatch" : "planning",
        blockers,
      );
    }
    if (readinessType === "completion") {
      const requiredChecklists = await transaction
        .select()
        .from(checklistInstances)
        .where(
          and(
            eq(checklistInstances.tenantId, actor.tenantId),
            eq(checklistInstances.jobId, job.id),
            eq(checklistInstances.required, true),
          ),
        );
      if (requiredChecklists.some((checklist) => checklist.status !== "completed"))
        blockers.push("A required checklist is incomplete");
      if (requiredChecklists.length === 0) warnings.push("No required checklist is configured");
      if (job.serviceType === "material_delivery") {
        const [delivery] = await transaction
          .select()
          .from(materialDeliveryDetails)
          .where(
            and(
              eq(materialDeliveryDetails.tenantId, actor.tenantId),
              eq(materialDeliveryDetails.jobId, job.id),
            ),
          );
        if (delivery?.status !== "operationally_complete") {
          blockers.push("Material Delivery loads and quantities are not fully reconciled");
        }
      }
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
      await this.emitJobEvent(
        transaction,
        actor,
        job.id,
        "job.readiness_evaluated",
        `${readinessType} readiness: ${result}`,
        { blockers, warnings },
      );
    }
    return { blockers, evaluatedAt: evaluatedAt.toISOString(), readinessType, result, warnings };
  }

  private async getDetail(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
  ): Promise<JobDetailDto> {
    const [record] = await transaction
      .select({
        customerName: customerAccounts.displayName,
        job: jobs,
        projectNumber: projects.projectNumber,
      })
      .from(jobs)
      .innerJoin(
        projects,
        and(eq(projects.tenantId, jobs.tenantId), eq(projects.id, jobs.projectId)),
      )
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, projects.tenantId),
          eq(customerAccounts.id, projects.customerAccountId),
        ),
      )
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
    if (!record) throw notFound("JOB_NOT_FOUND", "Job was not found");
    const blocks = await transaction
      .select()
      .from(scheduleBlocks)
      .where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.jobId, jobId)))
      .orderBy(scheduleBlocks.startsAt);
    const blockDtos: ScheduleBlockDto[] = [];
    for (const block of blocks) {
      const assetIds = (
        await transaction
          .select()
          .from(assetAssignments)
          .where(
            and(
              eq(assetAssignments.tenantId, tenantId),
              eq(assetAssignments.scheduleBlockId, block.id),
            ),
          )
      ).map((assignment) => assignment.assetId);
      const userIds = (
        await transaction
          .select()
          .from(jobAssignments)
          .where(
            and(
              eq(jobAssignments.tenantId, tenantId),
              eq(jobAssignments.scheduleBlockId, block.id),
            ),
          )
      ).map((assignment) => assignment.userId);
      blockDtos.push(scheduleBlockDto(block, record.job.jobNumber, assetIds, userIds));
    }
    const stops = await transaction
      .select()
      .from(routeStops)
      .where(and(eq(routeStops.tenantId, tenantId), eq(routeStops.jobId, jobId)))
      .orderBy(routeStops.sequence);
    const instances = await transaction
      .select()
      .from(checklistInstances)
      .where(and(eq(checklistInstances.tenantId, tenantId), eq(checklistInstances.jobId, jobId)))
      .orderBy(checklistInstances.createdAt);
    const checklistDtos: ChecklistDto[] = [];
    for (const checklist of instances) {
      const items = await transaction
        .select()
        .from(checklistItems)
        .where(
          and(
            eq(checklistItems.tenantId, tenantId),
            eq(checklistItems.checklistInstanceId, checklist.id),
          ),
        )
        .orderBy(checklistItems.sequence);
      checklistDtos.push(checklistDto(checklist, items));
    }
    const events = await transaction
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.tenantId, tenantId), eq(jobEvents.jobId, jobId)))
      .orderBy(desc(jobEvents.occurredAt))
      .limit(100);
    const holds = await transaction
      .select()
      .from(operationalHolds)
      .where(
        and(
          eq(operationalHolds.tenantId, tenantId),
          eq(operationalHolds.jobId, jobId),
          eq(operationalHolds.status, "active"),
        ),
      );
    return {
      ...jobSummary(record.job, record.projectNumber, record.customerName),
      activeHolds: holds.map((hold) => hold.reason),
      checklists: checklistDtos,
      events: events.map((event) => ({
        eventType: event.eventType,
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        summary: event.summary,
      })),
      routeStops: stops.map(routeStopDto),
      scheduleBlocks: blockDtos,
    };
  }

  private async addMaterialDeliverySafetyBlockers(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
    validationType: "planning" | "dispatch",
    blockers: string[],
  ): Promise<void> {
    const [detail] = await transaction
      .select()
      .from(materialDeliveryDetails)
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, tenantId),
          eq(materialDeliveryDetails.jobId, jobId),
        ),
      );
    if (!detail) {
      blockers.push("Material Delivery plan is missing");
      return;
    }
    const loads = await transaction
      .select()
      .from(materialLoads)
      .where(
        and(
          eq(materialLoads.tenantId, tenantId),
          eq(materialLoads.materialDeliveryDetailId, detail.id),
        ),
      )
      .orderBy(asc(materialLoads.sequence));
    const activeLoads = loads.filter((load) => load.status !== "cancelled");
    if (activeLoads.length !== detail.plannedLoadCount || activeLoads.length === 0) {
      blockers.push("Material Delivery active Loads do not match the planned load count");
    }
    for (const load of activeLoads) {
      const [validation] = await transaction
        .select()
        .from(materialLoadValidations)
        .where(
          and(
            eq(materialLoadValidations.tenantId, tenantId),
            eq(materialLoadValidations.materialLoadId, load.id),
            eq(materialLoadValidations.validationType, validationType),
          ),
        )
        .orderBy(desc(materialLoadValidations.evaluatedAt))
        .limit(1);
      if (!validation || validation.result === "not_ready") {
        blockers.push(
          `Material Load ${load.sequence.toString()} lacks ready ${validationType} safety evidence`,
        );
      }
      if (
        load.capacityResult !== "pass" ||
        !["pass", "not_required"].includes(load.compatibilityResult) ||
        !["pass", "not_required"].includes(load.separationResult)
      ) {
        blockers.push(`Material Load ${load.sequence.toString()} has unresolved safety results`);
      }
    }
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

  private async assertMutableJob(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
  ): Promise<void> {
    const job = await this.lockJob(transaction, tenantId, jobId);
    if (["closed", "cancelled"].includes(job.status))
      throw invalidState("JOB_LOCKED", "Closed or cancelled Jobs cannot be changed");
  }

  private async emitJobEvent(
    transaction: TenantTransaction,
    actor: Actor,
    jobId: string,
    eventType: string,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await transaction.insert(jobEvents).values({
      actorUserId: actor.userId,
      eventType,
      jobId,
      metadata,
      summary,
      tenantId: actor.tenantId,
    });
    await this.recordChange(transaction, actor, {
      after: { summary },
      commandName: eventType.split(".").map(capitalize).join(""),
      entityId: jobId,
      entityType: "Job",
      eventType,
      metadata,
    });
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId: actor.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor.userId,
      eventType: input.eventType,
      payload: { auditEventId: eventId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
      updatedBy: actor.userId,
    });
  }
}

const jobTransitions: Record<
  Exclude<JobTransitionAction, "place-hold" | "release-hold" | "cancel" | "confirm-schedule">,
  { event: string; from: string; summary: string; to: string }
> = {
  "start-planning": {
    event: "job.planning_started",
    from: "new",
    summary: "Job planning started",
    to: "planning",
  },
  "request-scheduling": {
    event: "job.scheduling_requested",
    from: "planning",
    summary: "Job moved to scheduling queue",
    to: "needs_scheduling",
  },
  "mark-dispatch-ready": {
    event: "job.dispatch_ready",
    from: "scheduled",
    summary: "Job marked dispatch ready",
    to: "dispatch_ready",
  },
  start: { event: "job.started", from: "dispatch_ready", summary: "Job started", to: "active" },
  "complete-operationally": {
    event: "job.operationally_completed",
    from: "active",
    summary: "Job completed operationally",
    to: "operationally_complete",
  },
  "await-final-invoice": {
    event: "job.awaiting_final_invoice",
    from: "operationally_complete",
    summary: "Job awaiting final invoice",
    to: "awaiting_final_invoice",
  },
  "mark-invoiced": {
    event: "job.invoiced",
    from: "awaiting_final_invoice",
    summary: "Job marked invoiced",
    to: "invoiced",
  },
  "complete-financially": {
    event: "job.financially_completed",
    from: "invoiced",
    summary: "Job completed financially",
    to: "financially_complete",
  },
  close: { event: "job.closed", from: "financially_complete", summary: "Job closed", to: "closed" },
  reopen: {
    event: "job.reopened",
    from: "closed",
    summary: "Job reopened for planning",
    to: "planning",
  },
};

function jobSummary(job: typeof jobs.$inferSelect, projectNumber: string, customerName: string) {
  return {
    customerName,
    id: job.id,
    jobNumber: job.jobNumber,
    projectId: job.projectId,
    projectNumber,
    readiness: job.readiness,
    scheduledEndAt: job.scheduledEndAt?.toISOString() ?? null,
    scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
    serviceType: job.serviceType,
    status: job.status,
  };
}

function scheduleBlockDto(
  block: typeof scheduleBlocks.$inferSelect,
  jobNumber: string,
  assetIds: string[],
  userIds: string[],
): ScheduleBlockDto {
  return {
    assetIds,
    blockType: block.blockType,
    endsAt: block.endsAt.toISOString(),
    id: block.id,
    jobId: block.jobId,
    jobNumber,
    startsAt: block.startsAt.toISOString(),
    status: block.status,
    userIds,
  };
}

function routeStopDto(stop: typeof routeStops.$inferSelect): RouteStopDto {
  return {
    id: stop.id,
    label: stop.label,
    sequence: stop.sequence,
    status: stop.status,
    stopType: stop.stopType,
  };
}

function checklistItemDto(item: typeof checklistItems.$inferSelect): ChecklistItemDto {
  return {
    id: item.id,
    label: item.label,
    response: item.response,
    sequence: item.sequence,
    status: item.status,
  };
}

function checklistDto(
  checklist: typeof checklistInstances.$inferSelect,
  items: (typeof checklistItems.$inferSelect)[],
): ChecklistDto {
  return {
    id: checklist.id,
    items: items.map(checklistItemDto),
    name: checklist.name,
    required: checklist.required,
    status: checklist.status,
    templateCode: checklist.templateCode,
  };
}

function assetDto(asset: typeof assets.$inferSelect): AssetDto {
  return {
    assetNumber: asset.assetNumber,
    assetType: asset.assetType,
    capacityVolumeCubicYards: asset.capacityVolumeCubicYards,
    capacityWeight: asset.capacityWeight,
    id: asset.id,
    name: asset.name,
    status: asset.status,
  };
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "DATE_INVALID",
      `${field} must be a valid date-time`,
    );
  return date;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return databaseCode(error.cause);
  return undefined;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function optionalReason(value: string | undefined, fallback: string): string {
  const reason = value?.trim();
  return reason?.length ? reason : fallback;
}

function requireReason(value: string | undefined): asserts value is string {
  if (!value?.trim())
    throw new ApiException(HttpStatus.BAD_REQUEST, "REASON_REQUIRED", "A reason is required");
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
