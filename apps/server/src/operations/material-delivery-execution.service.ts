import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  documentLinks,
  expenseAllocations,
  expenses,
  jobCharges,
  jobEvents,
  jobs,
  materialDeliveryDetails,
  materialLoadAssets,
  materialLoadItems,
  materialLoadValidations,
  materialLoads,
  materialQuantityVariances,
  materials,
  outboxEvents,
  routeStops,
  supplierMaterials,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DocumentsService } from "../documents/documents.service.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  AttachMaterialEvidenceDto,
  CreateExpenseAllocationDto,
  CreateExpenseDto,
  CreateJobChargeDto,
  CreateMaterialQuantityVarianceDto,
  ExpenseActionDto,
  ExpenseAllocationDto,
  ExpenseDto,
  InvoiceReadinessDto,
  JobChargeActionDto,
  JobChargeDto,
  MaterialEvidenceDto,
  MaterialLoadExecutionDto,
  MaterialLoadItemDto,
  MaterialLoadTransitionDto,
  MaterialQuantityVarianceDto,
  RecordMaterialQuantitiesDto,
  ResolveMaterialQuantityVarianceDto,
} from "./operations.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

export const materialLoadExecutionActions = [
  "ready-for-loading",
  "arrive-supplier",
  "start-loading",
  "mark-loaded",
  "start-transit",
  "arrive-customer",
  "start-unloading",
  "complete-delivery",
  "start-reconciliation",
  "reconcile",
] as const;
export type MaterialLoadExecutionAction = (typeof materialLoadExecutionActions)[number];

export const materialVarianceActions = ["resolve", "waive"] as const;
export type MaterialVarianceAction = (typeof materialVarianceActions)[number];

export const expenseActions = [
  "waive-receipt",
  "approve",
  "reconcile",
  "reverse",
  "cancel",
] as const;
export type ExpenseAction = (typeof expenseActions)[number];

export const jobChargeActions = ["approve", "reverse", "cancel"] as const;
export type JobChargeAction = (typeof jobChargeActions)[number];

@Injectable()
export class MaterialDeliveryExecutionService {
  public constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  public async transitionLoad(
    loadId: string,
    action: MaterialLoadExecutionAction,
    input: MaterialLoadTransitionDto,
    key: string,
  ): Promise<MaterialLoadExecutionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, input, loadId }, scope: `material-loads.execute.${action}` },
      async (transaction) => {
        const { detail, job, load } = await this.lockLoad(transaction, actor.tenantId, loadId);
        this.assertExecutionJob(job);
        const transition = loadTransitions[action];
        const allowedSources = Array.isArray(transition.from) ? transition.from : [transition.from];
        if (!allowedSources.includes(load.status)) {
          throw conflict(
            "MATERIAL_LOAD_STATE_INVALID",
            `${action} requires a Material Load in ${allowedSources.join(" or ")}`,
          );
        }
        const occurredAt = parseOccurredAt(input.occurredAt);
        assertTimestampOrder(load, action, occurredAt);
        const items = await this.loadItems(transaction, actor.tenantId, loadId);
        if (items.length === 0) {
          throw conflict("MATERIAL_LOAD_ITEMS_REQUIRED", "Material Load execution requires Items");
        }
        if (action === "mark-loaded") {
          if (
            items.some((item) => item.purchasedQuantity === null || item.loadedQuantity === null)
          ) {
            throw conflict(
              "MATERIAL_LOAD_QUANTITIES_REQUIRED",
              "Purchased and loaded quantities are required before marking a Load loaded",
            );
          }
          await this.requireEvidence(transaction, actor.tenantId, items, "supplier_ticket");
          await this.requireCurrentActualSafety(transaction, actor.tenantId, load, items);
        }
        let nextStatus: string = transition.to;
        if (action === "complete-delivery") {
          await this.assertDeliveryComplete(transaction, actor.tenantId, detail, items);
          nextStatus = items.some((item) => item.deliveryResult === "partially_delivered")
            ? "partially_delivered"
            : "delivered";
        }
        if (action === "reconcile") {
          await this.assertReconciliationComplete(transaction, actor.tenantId, detail, items);
        }
        const timestampValues: Partial<typeof materialLoads.$inferInsert> = {};
        if (transition.timestampField) timestampValues[transition.timestampField] = occurredAt;
        const [updated] = await transaction
          .update(materialLoads)
          .set({ ...timestampValues, status: nextStatus, updatedBy: actor.userId })
          .where(and(eq(materialLoads.tenantId, actor.tenantId), eq(materialLoads.id, loadId)))
          .returning();
        if (!updated) throw new Error("Material Load transition did not return a record");
        if (action === "ready-for-loading") {
          await transaction
            .update(materialLoadAssets)
            .set({ status: "active", updatedBy: actor.userId })
            .where(
              and(
                eq(materialLoadAssets.tenantId, actor.tenantId),
                eq(materialLoadAssets.materialLoadId, loadId),
                eq(materialLoadAssets.status, "planned"),
              ),
            );
          await transaction
            .update(materialDeliveryDetails)
            .set({ status: "active", updatedBy: actor.userId })
            .where(
              and(
                eq(materialDeliveryDetails.tenantId, actor.tenantId),
                eq(materialDeliveryDetails.id, detail.id),
              ),
            );
        }
        if (action === "mark-loaded") {
          await transaction
            .update(materialLoadAssets)
            .set({ status: "used", updatedBy: actor.userId })
            .where(
              and(
                eq(materialLoadAssets.tenantId, actor.tenantId),
                eq(materialLoadAssets.materialLoadId, loadId),
                eq(materialLoadAssets.status, "active"),
              ),
            );
        }
        if (action === "reconcile") {
          await transaction
            .update(materialLoadItems)
            .set({ reconciledAt: occurredAt, updatedBy: actor.userId })
            .where(
              and(
                eq(materialLoadItems.tenantId, actor.tenantId),
                eq(materialLoadItems.materialLoadId, loadId),
                ne(materialLoadItems.deliveryResult, "cancelled"),
              ),
            );
          await transaction
            .update(materialLoadAssets)
            .set({ status: "released", updatedBy: actor.userId })
            .where(
              and(
                eq(materialLoadAssets.tenantId, actor.tenantId),
                eq(materialLoadAssets.materialLoadId, loadId),
                inArray(materialLoadAssets.status, ["active", "used"]),
              ),
            );
        }
        await this.refreshDeliverySummary(transaction, actor, detail.id);
        await this.emitChange(transaction, actor, {
          after: { occurredAt: occurredAt.toISOString(), status: nextStatus },
          before: { status: load.status },
          commandName: action.split("-").map(capitalize).join(""),
          entityId: load.id,
          entityType: "MaterialLoad",
          eventType: `material_delivery.load_${action.replaceAll("-", "_")}`,
          jobId: job.id,
          metadata: { notes: trimmedOrNull(input.notes) },
          summary: `Material Load ${load.sequence.toString()}: ${action.replaceAll("-", " ")}`,
        });
        return { body: loadExecutionDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async recordQuantities(
    itemId: string,
    input: RecordMaterialQuantitiesDto,
    key: string,
  ): Promise<MaterialLoadItemDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, itemId }, scope: "material-load-items.record-quantities" },
      async (transaction) => {
        const locked = await this.lockItem(transaction, actor.tenantId, itemId);
        this.assertExecutionJob(locked.job);
        if (
          ![
            "at_supplier",
            "loading",
            "loaded",
            "en_route",
            "at_customer",
            "unloading",
            "partially_delivered",
            "delivered",
            "reconciling",
          ].includes(locked.load.status)
        ) {
          throw conflict(
            "MATERIAL_QUANTITY_STATE_INVALID",
            "Actual quantities can only be recorded during Load execution or reconciliation",
          );
        }
        if (!hasQuantityUpdate(input)) {
          throw badRequest(
            "MATERIAL_QUANTITY_EMPTY",
            "At least one actual quantity fact is required",
          );
        }
        await this.validateActualReferences(transaction, actor.tenantId, locked.item, input);
        const values = actualQuantityValues(locked.item, input);
        validateQuantityRelationships(values);
        const [updated] = await transaction
          .update(materialLoadItems)
          .set({ ...values, updatedBy: actor.userId })
          .where(
            and(eq(materialLoadItems.tenantId, actor.tenantId), eq(materialLoadItems.id, itemId)),
          )
          .returning();
        if (!updated) throw new Error("Material Load Item quantities were not recorded");
        await this.refreshActualTotals(transaction, actor, locked.load.materialDeliveryDetailId);
        await this.emitChange(transaction, actor, {
          after: quantityAudit(updated),
          before: quantityAudit(locked.item),
          commandName: "RecordMaterialQuantities",
          entityId: itemId,
          entityType: "MaterialLoadItem",
          eventType: "material_delivery.quantities_recorded",
          jobId: locked.job.id,
          summary: `Actual quantities recorded for Material Load Item ${updated.sequence.toString()}`,
        });
        return { body: materialLoadItemDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async attachEvidence(
    itemId: string,
    input: AttachMaterialEvidenceDto,
    key: string,
  ): Promise<MaterialEvidenceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, itemId }, scope: "material-load-items.attach-evidence" },
      async (transaction) => {
        const locked = await this.lockItem(transaction, actor.tenantId, itemId);
        this.assertMutableJob(locked.job);
        const linked = await this.documents.linkAvailableToEntity(transaction, {
          actorUserId: actor.userId,
          documentId: input.documentId,
          entityId: itemId,
          entityType: "MaterialLoadItem",
          purpose: input.purpose,
          tenantId: actor.tenantId,
        });
        await this.refreshDeliverySummary(transaction, actor, locked.load.materialDeliveryDetailId);
        await this.emitChange(transaction, actor, {
          after: { documentId: input.documentId, purpose: input.purpose },
          commandName: "AttachMaterialDeliveryEvidence",
          entityId: itemId,
          entityType: "MaterialLoadItem",
          eventType: "material_delivery.evidence_attached",
          jobId: locked.job.id,
          metadata: { documentId: input.documentId, purpose: input.purpose },
          summary: `${input.purpose.replaceAll("_", " ")} attached`,
        });
        return {
          body: {
            documentId: linked.document.id,
            mediaType: linked.document.mediaType,
            originalFilename: linked.document.originalFilename,
            purpose: linked.purpose,
          },
          status: linked.created ? HttpStatus.CREATED : HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async createVariance(
    itemId: string,
    input: CreateMaterialQuantityVarianceDto,
    key: string,
  ): Promise<MaterialQuantityVarianceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, itemId }, scope: "material-quantity-variances.create" },
      async (transaction) => {
        const locked = await this.lockItem(transaction, actor.tenantId, itemId);
        this.assertMutableJob(locked.job);
        const expected = parseNonnegativeMilli(input.expectedQuantity, "expected quantity");
        const actual = parseNonnegativeMilli(input.actualQuantity, "actual quantity");
        let created: typeof materialQuantityVariances.$inferSelect;
        try {
          const [record] = await transaction
            .insert(materialQuantityVariances)
            .values({
              actualQuantity: formatMilli(actual),
              createdBy: actor.userId,
              expectedQuantity: formatMilli(expected),
              jobId: locked.job.id,
              materialLoadItemId: itemId,
              quantityUnit: locked.item.quantityUnit,
              responsibility: input.responsibility,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
              varianceQuantity: formatSignedMilli(actual - expected),
              varianceType: input.varianceType,
            })
            .returning();
          if (!record) throw new Error("Material Quantity Variance was not created");
          created = record;
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "MATERIAL_VARIANCE_ALREADY_OPEN",
              "An open variance of this type already exists for the Item",
            );
          }
          throw error;
        }
        await transaction
          .update(materialLoadItems)
          .set({ varianceStatus: "open", updatedBy: actor.userId })
          .where(
            and(eq(materialLoadItems.tenantId, actor.tenantId), eq(materialLoadItems.id, itemId)),
          );
        await this.emitChange(transaction, actor, {
          after: varianceDto(created),
          commandName: "CreateMaterialQuantityVariance",
          entityId: created.id,
          entityType: "MaterialQuantityVariance",
          eventType: "material_delivery.quantity_variance_opened",
          jobId: locked.job.id,
          summary: `${input.varianceType} quantity variance opened`,
        });
        return { body: varianceDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async resolveVariance(
    varianceId: string,
    action: MaterialVarianceAction,
    input: ResolveMaterialQuantityVarianceDto,
    key: string,
  ): Promise<MaterialQuantityVarianceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { action, input, varianceId },
        scope: `material-quantity-variances.${action}`,
      },
      async (transaction) => {
        const [variance] = await transaction
          .select()
          .from(materialQuantityVariances)
          .where(
            and(
              eq(materialQuantityVariances.tenantId, actor.tenantId),
              eq(materialQuantityVariances.id, varianceId),
            ),
          )
          .for("update");
        if (!variance) throw notFound("MATERIAL_VARIANCE_NOT_FOUND", "Variance was not found");
        if (variance.status !== "open") {
          throw conflict(
            "MATERIAL_VARIANCE_STATE_INVALID",
            "Only an open Variance can be resolved",
          );
        }
        const job = await this.lockJob(transaction, actor.tenantId, variance.jobId);
        this.assertMutableJob(job);
        const resolvedAt = new Date();
        const [updated] = await transaction
          .update(materialQuantityVariances)
          .set({
            resolutionReason: input.reason.trim(),
            resolutionType: input.resolutionType,
            resolvedAt,
            resolvedBy: actor.userId,
            status: action === "waive" ? "waived" : "resolved",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(materialQuantityVariances.tenantId, actor.tenantId),
              eq(materialQuantityVariances.id, varianceId),
            ),
          )
          .returning();
        if (!updated) throw new Error("Material Quantity Variance was not resolved");
        const open = await transaction
          .select({ id: materialQuantityVariances.id })
          .from(materialQuantityVariances)
          .where(
            and(
              eq(materialQuantityVariances.tenantId, actor.tenantId),
              eq(materialQuantityVariances.materialLoadItemId, variance.materialLoadItemId),
              eq(materialQuantityVariances.status, "open"),
            ),
          );
        await transaction
          .update(materialLoadItems)
          .set({
            varianceStatus: open.length > 0 ? "open" : action === "waive" ? "waived" : "resolved",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(materialLoadItems.tenantId, actor.tenantId),
              eq(materialLoadItems.id, variance.materialLoadItemId),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: varianceDto(updated),
          before: varianceDto(variance),
          commandName:
            action === "waive"
              ? "WaiveMaterialQuantityVariance"
              : "ResolveMaterialQuantityVariance",
          entityId: varianceId,
          entityType: "MaterialQuantityVariance",
          eventType: `material_delivery.quantity_variance_${action === "waive" ? "waived" : "resolved"}`,
          jobId: variance.jobId,
          summary: `Quantity variance ${action === "waive" ? "waived" : "resolved"}`,
        });
        return { body: varianceDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async createExpense(
    jobId: string,
    input: CreateExpenseDto,
    key: string,
  ): Promise<ExpenseDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "material-delivery.expenses.create" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        this.assertMaterialDeliveryJob(job);
        this.assertMutableJob(job);
        const id = randomUUID();
        if (input.receiptDocumentId) {
          await this.documents.linkAvailableToEntity(transaction, {
            actorUserId: actor.userId,
            documentId: input.receiptDocumentId,
            entityId: id,
            entityType: "Expense",
            purpose: "supplier_receipt",
            tenantId: actor.tenantId,
          });
        }
        const expenseNumber = await allocateBusinessNumber(transaction, {
          entityType: "expense",
          prefix: "EXP",
          tenantId: actor.tenantId,
          year: new Date(input.incurredAt).getUTCFullYear(),
        });
        const [created] = await transaction
          .insert(expenses)
          .values({
            amountCents: input.amountCents,
            createdBy: actor.userId,
            description: input.description.trim(),
            expenseNumber,
            expenseType: input.expenseType,
            externalReference: trimmedOrNull(input.externalReference),
            id,
            incurredAt: new Date(input.incurredAt),
            jobId,
            receiptDocumentId: input.receiptDocumentId ?? null,
            receiptStatus: input.receiptDocumentId ? "attached" : "missing",
            status: input.receiptDocumentId ? "pending_review" : "evidence_required",
            supplierId: input.supplierId ?? null,
            supplierLocationId: input.supplierLocationId ?? null,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!created) throw new Error("Expense was not created");
        await this.emitChange(transaction, actor, {
          after: expenseAudit(created),
          commandName: "CreateMaterialDeliveryExpense",
          entityId: created.id,
          entityType: "Expense",
          eventType: "material_delivery.expense_created",
          jobId,
          summary: `Expense ${expenseNumber} created`,
        });
        return {
          body: await this.expenseDto(transaction, actor.tenantId, created),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async allocateExpense(
    expenseId: string,
    input: CreateExpenseAllocationDto,
    key: string,
  ): Promise<ExpenseAllocationDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { expenseId, input }, scope: "material-delivery.expense-allocations.create" },
      async (transaction) => {
        const [expense] = await transaction
          .select()
          .from(expenses)
          .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expenseId)))
          .for("update");
        if (!expense) throw notFound("EXPENSE_NOT_FOUND", "Expense was not found");
        if (!["evidence_required", "pending_review", "draft"].includes(expense.status)) {
          throw conflict(
            "EXPENSE_ALLOCATION_LOCKED",
            "Expense Allocations are locked after approval",
          );
        }
        const job = await this.lockJob(transaction, actor.tenantId, expense.jobId);
        this.assertMutableJob(job);
        const [item] = await transaction
          .select()
          .from(materialLoadItems)
          .where(
            and(
              eq(materialLoadItems.tenantId, actor.tenantId),
              eq(materialLoadItems.id, input.materialLoadItemId),
              eq(materialLoadItems.jobId, expense.jobId),
            ),
          );
        if (!item) {
          throw conflict("EXPENSE_ITEM_INVALID", "Expense Allocation Item must belong to this Job");
        }
        const active = await this.activeAllocations(transaction, actor.tenantId, expenseId);
        if (
          active.reduce((total, allocation) => total + allocation.amountCents, 0) +
            input.amountCents >
          expense.amountCents
        ) {
          throw conflict(
            "EXPENSE_OVERALLOCATED",
            "Active Allocations cannot exceed the Expense amount",
          );
        }
        let created: typeof expenseAllocations.$inferSelect;
        try {
          const [record] = await transaction
            .insert(expenseAllocations)
            .values({
              amountCents: input.amountCents,
              createdBy: actor.userId,
              expenseId,
              jobId: expense.jobId,
              materialLoadItemId: input.materialLoadItemId,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!record) throw new Error("Expense Allocation was not created");
          created = record;
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "EXPENSE_ALLOCATION_DUPLICATE",
              "This Expense already has an active Allocation for the Item",
            );
          }
          throw error;
        }
        await this.emitChange(transaction, actor, {
          after: allocationDto(created),
          commandName: "AllocateMaterialDeliveryExpense",
          entityId: created.id,
          entityType: "ExpenseAllocation",
          eventType: "material_delivery.expense_allocated",
          jobId: expense.jobId,
          metadata: { expenseId },
          summary: `${input.amountCents.toString()} cents allocated from ${expense.expenseNumber}`,
        });
        return { body: allocationDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async transitionExpense(
    expenseId: string,
    action: ExpenseAction,
    input: ExpenseActionDto,
    key: string,
  ): Promise<ExpenseDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { action, expenseId, input }, scope: `material-delivery.expenses.${action}` },
      async (transaction) => {
        const [expense] = await transaction
          .select()
          .from(expenses)
          .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expenseId)))
          .for("update");
        if (!expense) throw notFound("EXPENSE_NOT_FOUND", "Expense was not found");
        const job = await this.lockJob(transaction, actor.tenantId, expense.jobId);
        this.assertMutableJob(job);
        if (action === "approve" || action === "reconcile") {
          let receiptDocumentId = expense.receiptDocumentId;
          let receiptStatus = expense.receiptStatus;
          if (input.receiptDocumentId) {
            await this.documents.linkAvailableToEntity(transaction, {
              actorUserId: actor.userId,
              documentId: input.receiptDocumentId,
              entityId: expenseId,
              entityType: "Expense",
              purpose: "supplier_receipt",
              tenantId: actor.tenantId,
            });
            receiptDocumentId = input.receiptDocumentId;
            receiptStatus = "attached";
          }
          if (!["attached", "waived", "not_required"].includes(receiptStatus)) {
            throw conflict(
              "EXPENSE_RECEIPT_REQUIRED",
              "A supplier receipt is required before approval",
            );
          }
          const active = await this.activeAllocations(transaction, actor.tenantId, expenseId);
          if (
            active.reduce((total, allocation) => total + allocation.amountCents, 0) !==
            expense.amountCents
          ) {
            throw conflict(
              "EXPENSE_ALLOCATION_UNBALANCED",
              "Active Allocations must exactly equal the Expense amount",
            );
          }
          if (
            action === "approve" &&
            !["draft", "evidence_required", "pending_review"].includes(expense.status)
          ) {
            throw conflict("EXPENSE_STATE_INVALID", "Only a reviewable Expense can be approved");
          }
          if (action === "reconcile" && expense.status !== "approved") {
            throw conflict("EXPENSE_STATE_INVALID", "Only an approved Expense can be reconciled");
          }
          const [updated] = await transaction
            .update(expenses)
            .set({
              approvedAt: expense.approvedAt ?? new Date(),
              approvedBy: expense.approvedBy ?? actor.userId,
              receiptDocumentId,
              receiptStatus,
              status: action === "approve" ? "approved" : "reconciled",
              updatedBy: actor.userId,
            })
            .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expenseId)))
            .returning();
          if (!updated) throw new Error("Expense transition did not return a record");
          await this.emitExpenseTransition(transaction, actor, expense, updated, action);
          return {
            body: await this.expenseDto(transaction, actor.tenantId, updated),
            status: HttpStatus.OK,
          };
        }
        requireReason(input.reason);
        if (action === "waive-receipt") {
          if (!["draft", "evidence_required", "pending_review"].includes(expense.status)) {
            throw conflict(
              "EXPENSE_STATE_INVALID",
              "A receipt cannot be waived after Expense approval",
            );
          }
          const [updated] = await transaction
            .update(expenses)
            .set({
              receiptStatus: "waived",
              receiptWaivedAt: new Date(),
              receiptWaivedBy: actor.userId,
              receiptWaiverReason: input.reason?.trim(),
              status: "pending_review",
              updatedBy: actor.userId,
            })
            .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expenseId)))
            .returning();
          if (!updated) throw new Error("Expense receipt was not waived");
          await this.emitExpenseTransition(
            transaction,
            actor,
            expense,
            updated,
            action,
            input.reason,
          );
          return {
            body: await this.expenseDto(transaction, actor.tenantId, updated),
            status: HttpStatus.OK,
          };
        }
        if (action === "cancel") {
          if (!["draft", "evidence_required", "pending_review"].includes(expense.status)) {
            throw conflict("EXPENSE_STATE_INVALID", "An approved Expense cannot be cancelled");
          }
          const [updated] = await transaction
            .update(expenses)
            .set({ status: "cancelled", updatedBy: actor.userId })
            .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expenseId)))
            .returning();
          if (!updated) throw new Error("Expense was not cancelled");
          await this.emitExpenseTransition(
            transaction,
            actor,
            expense,
            updated,
            action,
            input.reason,
          );
          return {
            body: await this.expenseDto(transaction, actor.tenantId, updated),
            status: HttpStatus.OK,
          };
        }
        if (
          !["approved", "reconciled"].includes(expense.status) ||
          expense.expenseKind !== "expense"
        ) {
          throw conflict(
            "EXPENSE_STATE_INVALID",
            "Only an approved original Expense can be reversed",
          );
        }
        const expenseNumber = await allocateBusinessNumber(transaction, {
          entityType: "expense",
          prefix: "EXP",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [reversalDraft] = await transaction
          .insert(expenses)
          .values({
            amountCents: expense.amountCents,
            createdBy: actor.userId,
            description: `Reversal of ${expense.expenseNumber}: ${input.reason?.trim() ?? ""}`,
            expenseKind: "reversal",
            expenseNumber,
            expenseType: expense.expenseType,
            incurredAt: new Date(),
            jobId: expense.jobId,
            receiptStatus: "not_required",
            reversesExpenseId: expense.id,
            status: "pending_review",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversalDraft) throw new Error("Expense reversal was not created");
        const originalAllocations = await this.activeAllocations(
          transaction,
          actor.tenantId,
          expense.id,
        );
        if (originalAllocations.length === 0) {
          throw conflict(
            "EXPENSE_REVERSAL_ALLOCATION_REQUIRED",
            "The original Expense has no active Allocations to reverse",
          );
        }
        await transaction.insert(expenseAllocations).values(
          originalAllocations.map((allocation) => ({
            amountCents: allocation.amountCents,
            createdBy: actor.userId,
            expenseId: reversalDraft.id,
            jobId: allocation.jobId,
            materialLoadItemId: allocation.materialLoadItemId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })),
        );
        const [reversal] = await transaction
          .update(expenses)
          .set({
            approvedAt: new Date(),
            approvedBy: actor.userId,
            status: "reconciled",
            updatedBy: actor.userId,
          })
          .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, reversalDraft.id)))
          .returning();
        if (!reversal) throw new Error("Expense reversal was not reconciled");
        await transaction
          .update(expenses)
          .set({ status: "reversed", updatedBy: actor.userId })
          .where(and(eq(expenses.tenantId, actor.tenantId), eq(expenses.id, expense.id)));
        await this.emitExpenseTransition(
          transaction,
          actor,
          expense,
          reversal,
          action,
          input.reason,
        );
        return {
          body: await this.expenseDto(transaction, actor.tenantId, reversal),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async createJobCharge(
    jobId: string,
    input: CreateJobChargeDto,
    key: string,
  ): Promise<JobChargeDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "material-delivery.job-charges.create" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        this.assertMaterialDeliveryJob(job);
        this.assertMutableJob(job);
        await this.validateChargeSource(
          transaction,
          actor.tenantId,
          jobId,
          input.sourceType,
          input.sourceId,
        );
        const calculatedAmountCents = calculateChargeAmount(input);
        const proposedAmountCents = input.proposedAmountCents ?? calculatedAmountCents;
        if (
          proposedAmountCents === null &&
          !["no_charge", "informational"].includes(input.chargeKind)
        ) {
          throw badRequest(
            "JOB_CHARGE_AMOUNT_REQUIRED",
            "A calculated or proposed amount is required",
          );
        }
        const chargeNumber = await allocateBusinessNumber(transaction, {
          entityType: "job_charge",
          prefix: "CHG",
          tenantId: actor.tenantId,
          year: new Date(input.occurredAt).getUTCFullYear(),
        });
        let created: typeof jobCharges.$inferSelect;
        try {
          const [record] = await transaction
            .insert(jobCharges)
            .values({
              calculatedAmountCents,
              calculationSnapshot: {
                ...input.calculationSnapshot,
                calculationVersion: 1,
                quantity: input.quantity ?? null,
                rateCents: input.rateCents ?? null,
              },
              chargeKind: input.chargeKind,
              chargeNumber,
              chargeType: input.chargeType.trim(),
              createdBy: actor.userId,
              customerAuthorizationStatus: input.customerAuthorizationStatus,
              customerDescription: input.customerDescription.trim(),
              dedupeKey: input.dedupeKey.trim(),
              evidenceStatus: input.evidenceStatus,
              internalApprovalStatus: input.internalApprovalStatus,
              jobId,
              occurredAt: new Date(input.occurredAt),
              proposedAmountCents: proposedAmountCents ?? 0,
              quantity: input.quantity ?? null,
              rateCents: input.rateCents ?? null,
              responsibility: input.responsibility,
              sourceId: input.sourceId ?? null,
              sourceType: input.sourceType,
              taxBehavior: input.taxBehavior,
              tenantId: actor.tenantId,
              unit: trimmedOrNull(input.unit),
              updatedBy: actor.userId,
            })
            .returning();
          if (!record) throw new Error("Job Charge was not created");
          created = record;
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "JOB_CHARGE_DUPLICATE",
              "An active Job Charge already uses this dedupe key",
            );
          }
          throw error;
        }
        await this.emitChange(transaction, actor, {
          after: jobChargeDto(created),
          commandName: "CreateOperationalJobCharge",
          entityId: created.id,
          entityType: "JobCharge",
          eventType: "material_delivery.job_charge_created",
          jobId,
          summary: `Job Charge ${chargeNumber} created`,
        });
        return { body: jobChargeDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async transitionJobCharge(
    chargeId: string,
    action: JobChargeAction,
    input: JobChargeActionDto,
    key: string,
  ): Promise<JobChargeDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { action, chargeId, input },
        scope: `material-delivery.job-charges.${action}`,
      },
      async (transaction) => {
        const [charge] = await transaction
          .select()
          .from(jobCharges)
          .where(and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.id, chargeId)))
          .for("update");
        if (!charge) throw notFound("JOB_CHARGE_NOT_FOUND", "Job Charge was not found");
        const job = await this.lockJob(transaction, actor.tenantId, charge.jobId);
        this.assertMutableJob(job);
        if (action === "approve") {
          if (charge.status !== "draft") {
            throw conflict("JOB_CHARGE_STATE_INVALID", "Only a draft Job Charge can be approved");
          }
          if (!["complete", "waived", "not_required"].includes(charge.evidenceStatus)) {
            throw conflict("JOB_CHARGE_EVIDENCE_REQUIRED", "Job Charge evidence is incomplete");
          }
          if (
            !["authorized", "waived", "not_required"].includes(charge.customerAuthorizationStatus)
          ) {
            throw conflict(
              "JOB_CHARGE_AUTHORIZATION_REQUIRED",
              "Customer authorization is incomplete",
            );
          }
          if (!["approved", "waived", "not_required"].includes(charge.internalApprovalStatus)) {
            throw conflict("JOB_CHARGE_APPROVAL_REQUIRED", "Internal approval is incomplete");
          }
          const approvedAmount = input.approvedAmountCents ?? charge.proposedAmountCents;
          if (approvedAmount === null)
            throw conflict("JOB_CHARGE_AMOUNT_REQUIRED", "Approved amount is required");
          const status = charge.chargeKind === "no_charge" ? "waived" : "ready_to_invoice";
          const [updated] = await transaction
            .update(jobCharges)
            .set({
              approvedAmountCents: approvedAmount,
              approvedAt: new Date(),
              approvedBy: actor.userId,
              status,
              updatedBy: actor.userId,
            })
            .where(and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.id, chargeId)))
            .returning();
          if (!updated) throw new Error("Job Charge was not approved");
          await this.emitChargeTransition(transaction, actor, charge, updated, action);
          return { body: jobChargeDto(updated), status: HttpStatus.OK };
        }
        requireReason(input.reason);
        if (action === "cancel") {
          if (charge.status !== "draft") {
            throw conflict("JOB_CHARGE_STATE_INVALID", "Only a draft Job Charge can be cancelled");
          }
          const [updated] = await transaction
            .update(jobCharges)
            .set({ status: "cancelled", updatedBy: actor.userId })
            .where(and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.id, chargeId)))
            .returning();
          if (!updated) throw new Error("Job Charge was not cancelled");
          await this.emitChargeTransition(
            transaction,
            actor,
            charge,
            updated,
            action,
            input.reason,
          );
          return { body: jobChargeDto(updated), status: HttpStatus.OK };
        }
        if (
          !["ready_to_invoice", "approved", "waived"].includes(charge.status) ||
          charge.chargeKind === "reversal"
        ) {
          throw conflict(
            "JOB_CHARGE_STATE_INVALID",
            "Only an approved original Job Charge can be reversed",
          );
        }
        const chargeNumber = await allocateBusinessNumber(transaction, {
          entityType: "job_charge",
          prefix: "CHG",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [reversal] = await transaction
          .insert(jobCharges)
          .values({
            approvedAmountCents: charge.approvedAmountCents ?? 0,
            approvedAt: new Date(),
            approvedBy: actor.userId,
            calculatedAmountCents: charge.approvedAmountCents ?? 0,
            calculationSnapshot: {
              reason: input.reason?.trim(),
              reversesChargeNumber: charge.chargeNumber,
            },
            chargeKind: "reversal",
            chargeNumber,
            chargeType: charge.chargeType,
            createdBy: actor.userId,
            customerAuthorizationStatus: "not_required",
            customerDescription: `Reversal of ${charge.chargeNumber}`,
            dedupeKey: `reversal:${charge.id}`,
            evidenceStatus: "not_required",
            internalApprovalStatus: "approved",
            jobId: charge.jobId,
            occurredAt: new Date(),
            proposedAmountCents: charge.approvedAmountCents ?? 0,
            responsibility: charge.responsibility,
            reversesJobChargeId: charge.id,
            sourceId: charge.id,
            sourceType: "manual",
            status: "ready_to_invoice",
            taxBehavior: charge.taxBehavior,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Job Charge reversal was not created");
        await transaction
          .update(jobCharges)
          .set({ status: "reversed", updatedBy: actor.userId })
          .where(and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.id, charge.id)));
        await this.emitChargeTransition(transaction, actor, charge, reversal, action, input.reason);
        return { body: jobChargeDto(reversal), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async evaluateInvoiceReadiness(jobId: string, key: string): Promise<InvoiceReadinessDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { jobId }, scope: "material-delivery.evaluate-invoice-readiness" },
      async (transaction) => {
        const job = await this.lockJob(transaction, actor.tenantId, jobId);
        this.assertMaterialDeliveryJob(job);
        const [detail] = await transaction
          .select()
          .from(materialDeliveryDetails)
          .where(
            and(
              eq(materialDeliveryDetails.tenantId, actor.tenantId),
              eq(materialDeliveryDetails.jobId, jobId),
            ),
          )
          .for("update");
        if (!detail)
          throw notFound("MATERIAL_DELIVERY_NOT_FOUND", "Material Delivery plan was not found");
        const blockers: string[] = [];
        const warnings: string[] = [];
        const loads = await transaction
          .select()
          .from(materialLoads)
          .where(
            and(
              eq(materialLoads.tenantId, actor.tenantId),
              eq(materialLoads.materialDeliveryDetailId, detail.id),
              ne(materialLoads.status, "cancelled"),
            ),
          );
        if (
          detail.status !== "operationally_complete" ||
          loads.some((load) => load.status !== "reconciled")
        ) {
          blockers.push("Material Delivery is not operationally complete");
        }
        const items = await transaction
          .select()
          .from(materialLoadItems)
          .where(
            and(
              eq(materialLoadItems.tenantId, actor.tenantId),
              eq(materialLoadItems.jobId, jobId),
              ne(materialLoadItems.deliveryResult, "cancelled"),
            ),
          );
        const evidence = await this.evidencePurposes(
          transaction,
          actor.tenantId,
          items.map((item) => item.id),
        );
        for (const item of items) {
          const purposes = evidence.get(item.id) ?? new Set<string>();
          if (!purposes.has("supplier_receipt"))
            blockers.push(`Item ${item.sequence.toString()} is missing a supplier receipt`);
          if (detail.placementEvidenceRequired && !purposes.has("placement_evidence")) {
            blockers.push(`Item ${item.sequence.toString()} is missing placement evidence`);
          }
        }
        const jobExpenses = await transaction
          .select()
          .from(expenses)
          .where(
            and(
              eq(expenses.tenantId, actor.tenantId),
              eq(expenses.jobId, jobId),
              eq(expenses.expenseKind, "expense"),
              ne(expenses.status, "cancelled"),
              ne(expenses.status, "reversed"),
            ),
          );
        if (jobExpenses.length === 0) blockers.push("Material Delivery has no supplier Expenses");
        if (jobExpenses.some((expense) => expense.status !== "reconciled")) {
          blockers.push("Every supplier Expense must be reconciled");
        }
        const activeAllocations = await transaction
          .select()
          .from(expenseAllocations)
          .where(
            and(
              eq(expenseAllocations.tenantId, actor.tenantId),
              eq(expenseAllocations.jobId, jobId),
              eq(expenseAllocations.status, "active"),
            ),
          );
        for (const item of items) {
          if (!activeAllocations.some((allocation) => allocation.materialLoadItemId === item.id)) {
            blockers.push(`Item ${item.sequence.toString()} has no active Expense Allocation`);
          }
        }
        const openVariances = await transaction
          .select({ id: materialQuantityVariances.id })
          .from(materialQuantityVariances)
          .where(
            and(
              eq(materialQuantityVariances.tenantId, actor.tenantId),
              eq(materialQuantityVariances.jobId, jobId),
              eq(materialQuantityVariances.status, "open"),
            ),
          );
        if (openVariances.length > 0) blockers.push("Open quantity variances remain");
        const charges = await transaction
          .select()
          .from(jobCharges)
          .where(and(eq(jobCharges.tenantId, actor.tenantId), eq(jobCharges.jobId, jobId)));
        if (
          charges.some(
            (charge) =>
              !["ready_to_invoice", "waived", "rejected", "cancelled", "reversed"].includes(
                charge.status,
              ),
          )
        ) {
          blockers.push("An operational Job Charge is unresolved");
        }
        if (charges.length === 0) warnings.push("No operational Job Charges were recorded");
        const evaluatedAt = new Date();
        const readiness = blockers.length > 0 ? "not_ready" : "ready";
        await transaction
          .update(materialDeliveryDetails)
          .set({
            invoiceReadiness: readiness,
            invoiceReadyAt: readiness === "ready" ? evaluatedAt : null,
            placementEvidenceStatus: blockers.some((blocker) =>
              blocker.includes("placement evidence"),
            )
              ? "partial"
              : detail.placementEvidenceRequired
                ? "complete"
                : "not_required",
            receiptStatus: blockers.some((blocker) => blocker.includes("supplier receipt"))
              ? "partial"
              : "complete",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(materialDeliveryDetails.tenantId, actor.tenantId),
              eq(materialDeliveryDetails.id, detail.id),
            ),
          );
        await this.emitChange(transaction, actor, {
          after: { blockers, readiness, warnings },
          commandName: "EvaluateMaterialDeliveryInvoiceReadiness",
          entityId: detail.id,
          entityType: "MaterialDeliveryDetail",
          eventType: "material_delivery.invoice_readiness_evaluated",
          jobId,
          summary: `Material Delivery invoice readiness: ${readiness}`,
        });
        return {
          body: { blockers, evaluatedAt: evaluatedAt.toISOString(), result: readiness, warnings },
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async lockLoad(transaction: TenantTransaction, tenantId: string, loadId: string) {
    const [load] = await transaction
      .select()
      .from(materialLoads)
      .where(and(eq(materialLoads.tenantId, tenantId), eq(materialLoads.id, loadId)))
      .for("update");
    if (!load) throw notFound("MATERIAL_LOAD_NOT_FOUND", "Material Load was not found");
    const job = await this.lockJob(transaction, tenantId, load.jobId);
    const [detail] = await transaction
      .select()
      .from(materialDeliveryDetails)
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, tenantId),
          eq(materialDeliveryDetails.id, load.materialDeliveryDetailId),
        ),
      )
      .for("update");
    if (!detail) throw new Error("Material Delivery Detail was not found");
    return { detail, job, load };
  }

  private async lockItem(transaction: TenantTransaction, tenantId: string, itemId: string) {
    const [item] = await transaction
      .select()
      .from(materialLoadItems)
      .where(and(eq(materialLoadItems.tenantId, tenantId), eq(materialLoadItems.id, itemId)))
      .for("update");
    if (!item) throw notFound("MATERIAL_LOAD_ITEM_NOT_FOUND", "Material Load Item was not found");
    const locked = await this.lockLoad(transaction, tenantId, item.materialLoadId);
    return { ...locked, item };
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

  private assertMaterialDeliveryJob(job: typeof jobs.$inferSelect): void {
    if (job.serviceType !== "material_delivery") {
      throw conflict(
        "MATERIAL_DELIVERY_SERVICE_REQUIRED",
        "This command requires a Material Delivery Job",
      );
    }
  }

  private assertMutableJob(job: typeof jobs.$inferSelect): void {
    this.assertMaterialDeliveryJob(job);
    if (["closed", "cancelled", "financially_complete"].includes(job.status)) {
      throw conflict("JOB_LOCKED", "This Job cannot be changed");
    }
  }

  private assertExecutionJob(job: typeof jobs.$inferSelect): void {
    this.assertMaterialDeliveryJob(job);
    if (job.status !== "active") {
      throw conflict(
        "MATERIAL_DELIVERY_EXECUTION_STATE_INVALID",
        "Driver execution requires an active Job",
      );
    }
  }

  private async loadItems(transaction: TenantTransaction, tenantId: string, loadId: string) {
    return transaction
      .select()
      .from(materialLoadItems)
      .where(
        and(
          eq(materialLoadItems.tenantId, tenantId),
          eq(materialLoadItems.materialLoadId, loadId),
          ne(materialLoadItems.deliveryResult, "cancelled"),
        ),
      )
      .orderBy(asc(materialLoadItems.sequence));
  }

  private async requireEvidence(
    transaction: TenantTransaction,
    tenantId: string,
    items: (typeof materialLoadItems.$inferSelect)[],
    purpose: string,
  ): Promise<void> {
    const purposes = await this.evidencePurposes(
      transaction,
      tenantId,
      items.map((item) => item.id),
    );
    if (items.some((item) => !(purposes.get(item.id) ?? new Set()).has(purpose))) {
      throw conflict(
        "MATERIAL_DELIVERY_EVIDENCE_REQUIRED",
        `Every Material Load Item requires ${purpose.replaceAll("_", " ")} evidence`,
      );
    }
  }

  private async evidencePurposes(
    transaction: TenantTransaction,
    tenantId: string,
    itemIds: string[],
  ) {
    const result = new Map<string, Set<string>>();
    if (itemIds.length === 0) return result;
    const links = await transaction
      .select()
      .from(documentLinks)
      .where(
        and(
          eq(documentLinks.tenantId, tenantId),
          eq(documentLinks.entityType, "MaterialLoadItem"),
          inArray(documentLinks.entityId, itemIds),
        ),
      );
    for (const link of links) {
      const purposes = result.get(link.entityId) ?? new Set<string>();
      purposes.add(link.purpose);
      result.set(link.entityId, purposes);
    }
    return result;
  }

  private async requireCurrentActualSafety(
    transaction: TenantTransaction,
    tenantId: string,
    load: typeof materialLoads.$inferSelect,
    items: (typeof materialLoadItems.$inferSelect)[],
  ): Promise<void> {
    const [validation] = await transaction
      .select()
      .from(materialLoadValidations)
      .where(
        and(
          eq(materialLoadValidations.tenantId, tenantId),
          eq(materialLoadValidations.materialLoadId, load.id),
          eq(materialLoadValidations.validationType, "actual"),
        ),
      )
      .orderBy(desc(materialLoadValidations.evaluatedAt))
      .limit(1);
    const latestFact = items.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      new Date(0),
    );
    if (!validation || validation.evaluatedAt < latestFact || validation.result === "not_ready") {
      throw conflict(
        "MATERIAL_LOAD_ACTUAL_SAFETY_REQUIRED",
        "A current passing actual-load safety evaluation is required before departure",
      );
    }
  }

  private async assertDeliveryComplete(
    transaction: TenantTransaction,
    tenantId: string,
    detail: typeof materialDeliveryDetails.$inferSelect,
    items: (typeof materialLoadItems.$inferSelect)[],
  ): Promise<void> {
    for (const item of items) {
      if (
        item.deliveredQuantity === null ||
        item.remainingQuantity === null ||
        item.deliveryResult === "pending"
      ) {
        throw conflict(
          "MATERIAL_DELIVERY_RESULT_REQUIRED",
          "Every Item requires delivered quantity, remaining quantity, and a delivery result",
        );
      }
      if (
        parseNonnegativeMilli(item.remainingQuantity, "remaining quantity") > 0n &&
        !item.remainingDisposition
      ) {
        throw conflict(
          "MATERIAL_REMAINING_DISPOSITION_REQUIRED",
          "Remaining material requires an explicit disposition",
        );
      }
    }
    if (detail.placementEvidenceRequired) {
      await this.requireEvidence(transaction, tenantId, items, "placement_evidence");
    }
  }

  private async assertReconciliationComplete(
    transaction: TenantTransaction,
    tenantId: string,
    detail: typeof materialDeliveryDetails.$inferSelect,
    items: (typeof materialLoadItems.$inferSelect)[],
  ): Promise<void> {
    await this.assertDeliveryComplete(transaction, tenantId, detail, items);
    await this.requireEvidence(transaction, tenantId, items, "supplier_ticket");
    const open = await transaction
      .select({ id: materialQuantityVariances.id })
      .from(materialQuantityVariances)
      .where(
        and(
          eq(materialQuantityVariances.tenantId, tenantId),
          inArray(
            materialQuantityVariances.materialLoadItemId,
            items.map((item) => item.id),
          ),
          eq(materialQuantityVariances.status, "open"),
        ),
      );
    if (open.length > 0) {
      throw conflict(
        "MATERIAL_VARIANCE_OPEN",
        "Open quantity variances must be resolved before reconciliation",
      );
    }
  }

  private async refreshActualTotals(
    transaction: TenantTransaction,
    actor: Actor,
    detailId: string,
  ): Promise<void> {
    const loads = await transaction
      .select()
      .from(materialLoads)
      .where(
        and(
          eq(materialLoads.tenantId, actor.tenantId),
          eq(materialLoads.materialDeliveryDetailId, detailId),
          ne(materialLoads.status, "cancelled"),
        ),
      );
    let detailVolume = 0n;
    let detailWeight = 0n;
    for (const load of loads) {
      const items = await this.loadItems(transaction, actor.tenantId, load.id);
      const totals = deliveredTotals(items);
      detailVolume += totals.volumeMilli;
      detailWeight += totals.weightMilli;
      await transaction
        .update(materialLoads)
        .set({
          actualVolumeCubicYards: formatMilli(totals.volumeMilli),
          actualWeightPounds: formatMilli(totals.weightMilli),
          updatedBy: actor.userId,
        })
        .where(and(eq(materialLoads.tenantId, actor.tenantId), eq(materialLoads.id, load.id)));
    }
    await transaction
      .update(materialDeliveryDetails)
      .set({
        actualDeliveredVolumeCubicYards: formatMilli(detailVolume),
        actualDeliveredWeightPounds: formatMilli(detailWeight),
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, detailId),
        ),
      );
  }

  private async refreshDeliverySummary(
    transaction: TenantTransaction,
    actor: Actor,
    detailId: string,
  ): Promise<void> {
    await this.refreshActualTotals(transaction, actor, detailId);
    const [detail] = await transaction
      .select()
      .from(materialDeliveryDetails)
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, detailId),
        ),
      );
    if (!detail) throw new Error("Material Delivery Detail was not found");
    const loads = await transaction
      .select()
      .from(materialLoads)
      .where(
        and(
          eq(materialLoads.tenantId, actor.tenantId),
          eq(materialLoads.materialDeliveryDetailId, detailId),
          ne(materialLoads.status, "cancelled"),
        ),
      );
    const items = await transaction
      .select()
      .from(materialLoadItems)
      .where(
        and(
          eq(materialLoadItems.tenantId, actor.tenantId),
          inArray(
            materialLoadItems.materialLoadId,
            loads.map((load) => load.id),
          ),
          ne(materialLoadItems.deliveryResult, "cancelled"),
        ),
      );
    const purposes = await this.evidencePurposes(
      transaction,
      actor.tenantId,
      items.map((item) => item.id),
    );
    const receiptCount = items.filter((item) =>
      (purposes.get(item.id) ?? new Set()).has("supplier_receipt"),
    ).length;
    const placementCount = items.filter((item) =>
      (purposes.get(item.id) ?? new Set()).has("placement_evidence"),
    ).length;
    const partialDelivery = items.some(
      (item) =>
        item.deliveryResult === "partially_delivered" ||
        (item.remainingQuantity !== null &&
          parseNonnegativeMilli(item.remainingQuantity, "remaining quantity") > 0n),
    );
    const operationallyComplete =
      loads.length > 0 && loads.every((load) => load.status === "reconciled");
    const status = operationallyComplete
      ? "operationally_complete"
      : loads.some((load) =>
            ["delivered", "partially_delivered", "reconciling", "reconciled"].includes(load.status),
          )
        ? partialDelivery
          ? "partially_delivered"
          : "reconciling"
        : loads.some((load) => load.status !== "planned")
          ? "active"
          : "ready";
    await transaction
      .update(materialDeliveryDetails)
      .set({
        operationallyCompletedAt: operationallyComplete
          ? (detail.operationallyCompletedAt ?? new Date())
          : null,
        partialDelivery,
        placementEvidenceStatus: !detail.placementEvidenceRequired
          ? "not_required"
          : items.length === 0
            ? "missing"
            : placementCount === items.length
              ? "complete"
              : placementCount > 0
                ? "partial"
                : "missing",
        receiptStatus:
          items.length === 0
            ? "missing"
            : receiptCount === items.length
              ? "complete"
              : receiptCount > 0
                ? "partial"
                : "missing",
        status,
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, detailId),
        ),
      );
  }

  private async validateActualReferences(
    transaction: TenantTransaction,
    tenantId: string,
    item: typeof materialLoadItems.$inferSelect,
    input: RecordMaterialQuantitiesDto,
  ): Promise<void> {
    if (input.actualMaterialId) {
      const [material] = await transaction
        .select({ id: materials.id })
        .from(materials)
        .where(and(eq(materials.tenantId, tenantId), eq(materials.id, input.actualMaterialId)));
      if (!material) throw notFound("MATERIAL_NOT_FOUND", "Actual Material was not found");
      if (input.actualMaterialId !== item.materialId) {
        throw conflict(
          "MATERIAL_SUBSTITUTION_APPROVAL_REQUIRED",
          "A different actual Material requires the controlled substitution workflow",
        );
      }
    }
    if (input.actualSupplierMaterialId) {
      const [supplierMaterial] = await transaction
        .select({ id: supplierMaterials.id })
        .from(supplierMaterials)
        .where(
          and(
            eq(supplierMaterials.tenantId, tenantId),
            eq(supplierMaterials.id, input.actualSupplierMaterialId),
          ),
        );
      if (!supplierMaterial) {
        throw notFound("SUPPLIER_MATERIAL_NOT_FOUND", "Actual Supplier Material was not found");
      }
    }
  }

  private async validateChargeSource(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
    sourceType: string,
    sourceId: string | undefined,
  ): Promise<void> {
    if (sourceType === "manual") {
      if (sourceId)
        throw badRequest("JOB_CHARGE_SOURCE_INVALID", "Manual charges cannot use a source id");
      return;
    }
    if (!sourceId)
      throw badRequest("JOB_CHARGE_SOURCE_REQUIRED", "Operational charges require a source id");
    const tables = {
      material_delivery_detail: materialDeliveryDetails,
      material_load: materialLoads,
      material_load_item: materialLoadItems,
      quantity_variance: materialQuantityVariances,
      route_stop: routeStops,
    } as const;
    if (!Object.hasOwn(tables, sourceType)) {
      throw badRequest("JOB_CHARGE_SOURCE_INVALID", "Unsupported Job Charge source");
    }
    const table = tables[sourceType as keyof typeof tables];
    const [source] = await transaction
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.id, sourceId), eq(table.jobId, jobId)));
    if (!source)
      throw conflict("JOB_CHARGE_SOURCE_INVALID", "Job Charge source must belong to this Job");
  }

  private async activeAllocations(
    transaction: TenantTransaction,
    tenantId: string,
    expenseId: string,
  ) {
    return transaction
      .select()
      .from(expenseAllocations)
      .where(
        and(
          eq(expenseAllocations.tenantId, tenantId),
          eq(expenseAllocations.expenseId, expenseId),
          eq(expenseAllocations.status, "active"),
        ),
      );
  }

  private async expenseDto(
    transaction: TenantTransaction,
    tenantId: string,
    expense: typeof expenses.$inferSelect,
  ): Promise<ExpenseDto> {
    const allocations = await this.activeAllocations(transaction, tenantId, expense.id);
    return {
      allocations: allocations.map(allocationDto),
      amountCents: expense.amountCents,
      expenseNumber: expense.expenseNumber,
      expenseType: expense.expenseType,
      id: expense.id,
      jobId: expense.jobId,
      receiptStatus: expense.receiptStatus,
      status: expense.status,
    };
  }

  private async emitExpenseTransition(
    transaction: TenantTransaction,
    actor: Actor,
    before: typeof expenses.$inferSelect,
    after: typeof expenses.$inferSelect,
    action: ExpenseAction,
    reason?: string,
  ) {
    await this.emitChange(transaction, actor, {
      after: expenseAudit(after),
      before: expenseAudit(before),
      commandName: `${capitalize(action)}MaterialDeliveryExpense`,
      entityId: after.id,
      entityType: "Expense",
      eventType: `material_delivery.expense_${action}d`,
      jobId: before.jobId,
      metadata: { reason: trimmedOrNull(reason) },
      summary: `Expense ${before.expenseNumber} ${action}d`,
    });
  }

  private async emitChargeTransition(
    transaction: TenantTransaction,
    actor: Actor,
    before: typeof jobCharges.$inferSelect,
    after: typeof jobCharges.$inferSelect,
    action: JobChargeAction,
    reason?: string,
  ) {
    await this.emitChange(transaction, actor, {
      after: jobChargeDto(after),
      before: jobChargeDto(before),
      commandName: `${capitalize(action)}OperationalJobCharge`,
      entityId: after.id,
      entityType: "JobCharge",
      eventType: `material_delivery.job_charge_${action}d`,
      jobId: before.jobId,
      metadata: { reason: trimmedOrNull(reason) },
      summary: `Job Charge ${before.chargeNumber} ${action}d`,
    });
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

const loadTransitions: Record<
  MaterialLoadExecutionAction,
  {
    from: string | string[];
    timestampField?:
      | "loadingStartedAt"
      | "loadedAt"
      | "transitStartedAt"
      | "unloadingStartedAt"
      | "deliveredAt"
      | "reconciledAt";
    to: string;
  }
> = {
  "arrive-customer": { from: "en_route", to: "at_customer" },
  "arrive-supplier": { from: "ready_for_loading", to: "at_supplier" },
  "complete-delivery": { from: "unloading", timestampField: "deliveredAt", to: "delivered" },
  "mark-loaded": { from: "loading", timestampField: "loadedAt", to: "loaded" },
  "ready-for-loading": { from: "planned", to: "ready_for_loading" },
  reconcile: { from: "reconciling", timestampField: "reconciledAt", to: "reconciled" },
  "start-loading": { from: "at_supplier", timestampField: "loadingStartedAt", to: "loading" },
  "start-reconciliation": { from: ["delivered", "partially_delivered"], to: "reconciling" },
  "start-transit": { from: "loaded", timestampField: "transitStartedAt", to: "en_route" },
  "start-unloading": { from: "at_customer", timestampField: "unloadingStartedAt", to: "unloading" },
};

function assertTimestampOrder(
  load: typeof materialLoads.$inferSelect,
  action: MaterialLoadExecutionAction,
  occurredAt: Date,
): void {
  const previous =
    action === "mark-loaded"
      ? load.loadingStartedAt
      : action === "start-transit"
        ? load.loadedAt
        : action === "start-unloading"
          ? load.transitStartedAt
          : action === "complete-delivery"
            ? load.unloadingStartedAt
            : action === "reconcile"
              ? load.deliveredAt
              : null;
  if (previous && occurredAt < previous) {
    throw conflict(
      "MATERIAL_LOAD_TIME_ORDER_INVALID",
      "Load lifecycle timestamps must be chronological",
    );
  }
}

function parseOccurredAt(value: string | undefined): Date {
  const occurredAt = value ? new Date(value) : new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    throw badRequest(
      "MATERIAL_LOAD_TIME_INVALID",
      "Execution time cannot be more than five minutes in the future",
    );
  }
  return occurredAt;
}

function actualQuantityValues(
  item: typeof materialLoadItems.$inferSelect,
  input: RecordMaterialQuantitiesDto,
): Partial<typeof materialLoadItems.$inferInsert> {
  return {
    actualMaterialId: input.actualMaterialId ?? item.actualMaterialId ?? item.materialId,
    actualSupplierMaterialId: input.actualSupplierMaterialId ?? item.actualSupplierMaterialId,
    actualUnitCostCents: input.actualUnitCostCents ?? item.actualUnitCostCents,
    deliveredQuantity: input.deliveredQuantity ?? item.deliveredQuantity,
    deliveryResult: input.deliveryResult ?? item.deliveryResult,
    loadedQuantity: input.loadedQuantity ?? item.loadedQuantity,
    purchasedQuantity: input.purchasedQuantity ?? item.purchasedQuantity,
    remainingDisposition: input.remainingDisposition ?? item.remainingDisposition,
    remainingQuantity: input.remainingQuantity ?? item.remainingQuantity,
  };
}

function hasQuantityUpdate(input: RecordMaterialQuantitiesDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function validateQuantityRelationships(
  values: Partial<typeof materialLoadItems.$inferInsert>,
): void {
  const loaded =
    typeof values.loadedQuantity === "string"
      ? parseNonnegativeMilli(values.loadedQuantity, "loaded quantity")
      : undefined;
  const delivered =
    typeof values.deliveredQuantity === "string"
      ? parseNonnegativeMilli(values.deliveredQuantity, "delivered quantity")
      : undefined;
  const remaining =
    typeof values.remainingQuantity === "string"
      ? parseNonnegativeMilli(values.remainingQuantity, "remaining quantity")
      : undefined;
  if (
    loaded !== undefined &&
    delivered !== undefined &&
    remaining !== undefined &&
    delivered + remaining !== loaded
  ) {
    throw conflict(
      "MATERIAL_QUANTITY_RECONCILIATION_INVALID",
      "Delivered quantity plus remaining quantity must equal loaded quantity",
    );
  }
  if (remaining !== undefined && remaining > 0n && !values.remainingDisposition) {
    throw conflict(
      "MATERIAL_REMAINING_DISPOSITION_REQUIRED",
      "Remaining material requires an explicit disposition",
    );
  }
  if (values.deliveryResult === "delivered" && remaining !== 0n) {
    throw conflict(
      "MATERIAL_DELIVERY_RESULT_INVALID",
      "A delivered Item must have zero remaining quantity",
    );
  }
  if (
    values.deliveryResult === "partially_delivered" &&
    (delivered === undefined || delivered <= 0n || remaining === undefined || remaining <= 0n)
  ) {
    throw conflict(
      "MATERIAL_DELIVERY_RESULT_INVALID",
      "A partially delivered Item requires positive delivered and remaining quantities",
    );
  }
}

function deliveredTotals(items: (typeof materialLoadItems.$inferSelect)[]) {
  let volumeMilli = 0n;
  let weightMilli = 0n;
  for (const item of items) {
    if (!item.deliveredQuantity || !item.unitVolumeCubicYards || !item.unitWeightPounds) continue;
    const quantity = parseNonnegativeMilli(item.deliveredQuantity, "delivered quantity");
    volumeMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitVolumeCubicYards, "volume"));
    weightMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitWeightPounds, "weight"));
  }
  return { volumeMilli, weightMilli };
}

function calculateChargeAmount(input: CreateJobChargeDto): number | null {
  if (input.quantity === undefined && input.rateCents === undefined) return null;
  if (input.quantity === undefined || input.rateCents === undefined) {
    throw badRequest(
      "JOB_CHARGE_CALCULATION_INVALID",
      "Quantity and rate must be supplied together",
    );
  }
  const quantity = parseNonnegativeMilli(input.quantity, "charge quantity");
  const amount = (quantity * BigInt(input.rateCents) + 500n) / 1_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw badRequest("JOB_CHARGE_AMOUNT_INVALID", "Calculated amount exceeds the supported range");
  }
  return Number(amount);
}

function loadExecutionDto(load: typeof materialLoads.$inferSelect): MaterialLoadExecutionDto {
  return {
    deliveredAt: load.deliveredAt?.toISOString() ?? null,
    id: load.id,
    jobId: load.jobId,
    loadedAt: load.loadedAt?.toISOString() ?? null,
    loadingStartedAt: load.loadingStartedAt?.toISOString() ?? null,
    reconciledAt: load.reconciledAt?.toISOString() ?? null,
    sequence: load.sequence,
    status: load.status,
    transitStartedAt: load.transitStartedAt?.toISOString() ?? null,
    unloadingStartedAt: load.unloadingStartedAt?.toISOString() ?? null,
  };
}

function materialLoadItemDto(item: typeof materialLoadItems.$inferSelect): MaterialLoadItemDto {
  if (
    !item.supplierRouteStopId ||
    !item.placementRouteStopId ||
    !item.unitWeightPounds ||
    !item.unitVolumeCubicYards
  ) {
    throw new Error("Material Load Item planning references are incomplete");
  }
  return {
    acceptedQuoteLineItemId: item.acceptedQuoteLineItemId,
    actualMaterialId: item.actualMaterialId,
    actualSupplierMaterialId: item.actualSupplierMaterialId,
    actualUnitCostCents: item.actualUnitCostCents,
    compartment: item.compartment,
    deliveredQuantity: item.deliveredQuantity,
    deliveryResult: item.deliveryResult,
    evidence: [],
    id: item.id,
    loadedQuantity: item.loadedQuantity,
    loadingSequence: item.loadingSequence,
    materialId: item.materialId,
    placementRouteStopId: item.placementRouteStopId,
    plannedQuantity: item.plannedQuantity,
    purchasedQuantity: item.purchasedQuantity,
    quantityUnit: item.quantityUnit,
    remainingDisposition: item.remainingDisposition,
    remainingQuantity: item.remainingQuantity,
    separationInstructions: item.separationInstructions,
    sequence: item.sequence,
    supplierRouteStopId: item.supplierRouteStopId,
    unitVolumeCubicYards: item.unitVolumeCubicYards,
    unitWeightPounds: item.unitWeightPounds,
    unloadingSequence: item.unloadingSequence,
    varianceStatus: item.varianceStatus,
  };
}

function varianceDto(
  variance: typeof materialQuantityVariances.$inferSelect,
): MaterialQuantityVarianceDto {
  return {
    actualQuantity: variance.actualQuantity,
    expectedQuantity: variance.expectedQuantity,
    id: variance.id,
    materialLoadItemId: variance.materialLoadItemId,
    quantityUnit: variance.quantityUnit,
    resolutionType: variance.resolutionType,
    responsibility: variance.responsibility,
    status: variance.status,
    varianceQuantity: variance.varianceQuantity,
    varianceType: variance.varianceType,
  };
}

function allocationDto(allocation: typeof expenseAllocations.$inferSelect): ExpenseAllocationDto {
  return {
    amountCents: allocation.amountCents,
    id: allocation.id,
    materialLoadItemId: allocation.materialLoadItemId,
    status: allocation.status,
  };
}

function jobChargeDto(charge: typeof jobCharges.$inferSelect): JobChargeDto {
  return {
    approvedAmountCents: charge.approvedAmountCents,
    calculatedAmountCents: charge.calculatedAmountCents,
    chargeKind: charge.chargeKind,
    chargeNumber: charge.chargeNumber,
    chargeType: charge.chargeType,
    customerDescription: charge.customerDescription,
    dedupeKey: charge.dedupeKey,
    id: charge.id,
    jobId: charge.jobId,
    proposedAmountCents: charge.proposedAmountCents,
    responsibility: charge.responsibility,
    sourceId: charge.sourceId,
    sourceType: charge.sourceType,
    status: charge.status,
  };
}

function quantityAudit(item: typeof materialLoadItems.$inferSelect) {
  return {
    actualMaterialId: item.actualMaterialId,
    actualSupplierMaterialId: item.actualSupplierMaterialId,
    actualUnitCostCents: item.actualUnitCostCents,
    deliveredQuantity: item.deliveredQuantity,
    deliveryResult: item.deliveryResult,
    loadedQuantity: item.loadedQuantity,
    purchasedQuantity: item.purchasedQuantity,
    remainingDisposition: item.remainingDisposition,
    remainingQuantity: item.remainingQuantity,
  };
}

function expenseAudit(expense: typeof expenses.$inferSelect) {
  return {
    amountCents: expense.amountCents,
    expenseKind: expense.expenseKind,
    expenseNumber: expense.expenseNumber,
    receiptStatus: expense.receiptStatus,
    reversesExpenseId: expense.reversesExpenseId,
    status: expense.status,
  };
}

function parsePositiveMilli(value: string, label: string): bigint {
  const parsed = parseNonnegativeMilli(value, label);
  if (parsed <= 0n) throw badRequest("DECIMAL_INVALID", `${label} must be positive`);
  return parsed;
}

function parseNonnegativeMilli(value: string, label: string): bigint {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) {
    throw badRequest("DECIMAL_INVALID", `${label} must have at most three decimal places`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
}

function multiplyMilli(left: bigint, right: bigint): bigint {
  return (left * right + 500n) / 1_000n;
}

function formatMilli(value: bigint): string {
  const whole = value / 1_000n;
  const fraction = (value % 1_000n).toString().padStart(3, "0");
  return `${whole.toString()}.${fraction}`;
}

function formatSignedMilli(value: bigint): string {
  return value < 0n ? `-${formatMilli(-value)}` : formatMilli(value);
}

function requireReason(reason: string | undefined): void {
  if (!reason?.trim()) throw badRequest("REASON_REQUIRED", "A reason is required");
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  return trimmed;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return databaseCode(error.cause);
  return undefined;
}

function badRequest(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.BAD_REQUEST, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
