import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  assets,
  auditEvents,
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
  projects,
  quoteLineItems,
  routeStops,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
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
  AssignMaterialLoadAssetDto,
  CreateMaterialLoadDto,
  EvaluateMaterialLoadSafetyDto,
  ExpenseDto,
  JobChargeDto,
  MaterialCatalogResponseDto,
  MaterialDeliveryDto,
  MaterialLoadAssetDto,
  MaterialLoadDto,
  MaterialLoadItemDto,
  MaterialLoadItemInputDto,
  MaterialLoadValidationDto,
  MaterialQuantityVarianceDto,
  SaveMaterialDeliveryPlanDto,
} from "./operations.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

interface LockedLoad {
  job: typeof jobs.$inferSelect;
  load: typeof materialLoads.$inferSelect;
}

@Injectable()
export class MaterialDeliveryService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  public async get(jobId: string): Promise<MaterialDeliveryDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.getDetail(transaction, actor.tenantId, jobId),
    );
  }

  public async listMaterials(): Promise<MaterialCatalogResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const records = await transaction
        .select({ defaultUnit: materials.defaultUnit, id: materials.id, name: materials.name })
        .from(materials)
        .where(and(eq(materials.tenantId, actor.tenantId), eq(materials.status, "active")))
        .orderBy(asc(materials.name));
      return { items: records };
    });
  }

  public async savePlan(
    jobId: string,
    input: SaveMaterialDeliveryPlanDto,
    key: string,
  ): Promise<MaterialDeliveryDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "material-delivery.save-plan" },
      async (transaction) => {
        const job = await this.lockPlanningJob(transaction, actor.tenantId, jobId);
        this.assertMaterialDeliveryJob(job);
        const [existing] = await transaction
          .select()
          .from(materialDeliveryDetails)
          .where(
            and(
              eq(materialDeliveryDetails.tenantId, actor.tenantId),
              eq(materialDeliveryDetails.jobId, jobId),
            ),
          )
          .for("update");
        if (existing && !["planning", "ready"].includes(existing.status)) {
          throw conflict(
            "MATERIAL_DELIVERY_PLAN_LOCKED",
            "The Material Delivery plan cannot be revised in its current state",
          );
        }
        if (existing) {
          const activeLoads = await transaction
            .select()
            .from(materialLoads)
            .where(
              and(
                eq(materialLoads.tenantId, actor.tenantId),
                eq(materialLoads.materialDeliveryDetailId, existing.id),
                ne(materialLoads.status, "cancelled"),
              ),
            );
          if (activeLoads.length > input.plannedLoadCount) {
            throw conflict(
              "MATERIAL_DELIVERY_LOAD_COUNT_INVALID",
              "Planned load count cannot be less than the active Load count",
            );
          }
          await transaction
            .update(materialDeliveryDetails)
            .set({
              capacityStatus: "evaluation_required",
              compatibilityStatus: "evaluation_required",
              deliveryType: input.deliveryType,
              invoiceReadiness: "evaluation_required",
              placementEvidenceRequired: input.placementEvidenceRequired ?? true,
              plannedLoadCount: input.plannedLoadCount,
              status: "planning",
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(materialDeliveryDetails.tenantId, actor.tenantId),
                eq(materialDeliveryDetails.id, existing.id),
              ),
            );
          await transaction
            .update(materialLoads)
            .set({
              capacityResult: "evaluation_required",
              compatibilityResult: "evaluation_required",
              separationResult: "evaluation_required",
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(materialLoads.tenantId, actor.tenantId),
                eq(materialLoads.materialDeliveryDetailId, existing.id),
                ne(materialLoads.status, "cancelled"),
              ),
            );
          await this.emitChange(transaction, actor, {
            after: {
              deliveryType: input.deliveryType,
              plannedLoadCount: input.plannedLoadCount,
            },
            before: {
              deliveryType: existing.deliveryType,
              plannedLoadCount: existing.plannedLoadCount,
            },
            commandName: "ReviseMaterialDeliveryPlan",
            entityId: existing.id,
            entityType: "MaterialDeliveryDetail",
            eventType: "material_delivery.plan_revised",
            jobId,
            summary: "Material Delivery plan revised",
          });
        } else {
          const [created] = await transaction
            .insert(materialDeliveryDetails)
            .values({
              createdBy: actor.userId,
              deliveryType: input.deliveryType,
              jobId,
              placementEvidenceRequired: input.placementEvidenceRequired ?? true,
              plannedLoadCount: input.plannedLoadCount,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!created) throw new Error("Material Delivery Detail was not created");
          await this.emitChange(transaction, actor, {
            after: {
              deliveryType: created.deliveryType,
              plannedLoadCount: created.plannedLoadCount,
            },
            commandName: "CreateMaterialDeliveryPlan",
            entityId: created.id,
            entityType: "MaterialDeliveryDetail",
            eventType: "material_delivery.plan_created",
            jobId,
            summary: "Material Delivery plan created",
          });
        }
        return {
          body: await this.getDetail(transaction, actor.tenantId, jobId),
          status: existing ? HttpStatus.OK : HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async createLoad(
    jobId: string,
    input: CreateMaterialLoadDto,
    key: string,
  ): Promise<MaterialLoadDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, jobId }, scope: "material-loads.create" },
      async (transaction) => {
        const job = await this.lockPlanningJob(transaction, actor.tenantId, jobId);
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
        if (!detail) {
          throw conflict(
            "MATERIAL_DELIVERY_PLAN_REQUIRED",
            "Create the Material Delivery plan before creating Loads",
          );
        }
        const activeLoads = await transaction
          .select()
          .from(materialLoads)
          .where(
            and(
              eq(materialLoads.tenantId, actor.tenantId),
              eq(materialLoads.materialDeliveryDetailId, detail.id),
              ne(materialLoads.status, "cancelled"),
            ),
          );
        if (activeLoads.length >= detail.plannedLoadCount) {
          throw conflict(
            "MATERIAL_DELIVERY_LOAD_COUNT_EXCEEDED",
            "Active Loads cannot exceed the planned load count",
          );
        }
        try {
          const [load] = await transaction
            .insert(materialLoads)
            .values({
              createdBy: actor.userId,
              jobId,
              materialDeliveryDetailId: detail.id,
              sequence: input.sequence,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!load) throw new Error("Material Load was not created");
          await this.emitChange(transaction, actor, {
            after: { sequence: load.sequence, status: load.status },
            commandName: "CreateMaterialLoad",
            entityId: load.id,
            entityType: "MaterialLoad",
            eventType: "material_delivery.load_created",
            jobId,
            summary: `Material Load ${load.sequence.toString()} created`,
          });
          return {
            body: await this.getLoadDetail(transaction, actor.tenantId, load),
            status: HttpStatus.CREATED,
          };
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "MATERIAL_LOAD_SEQUENCE_CONFLICT",
              "A Material Load already uses this sequence",
            );
          }
          throw error;
        }
      },
    );
    return result.body;
  }

  public createItem(
    loadId: string,
    input: MaterialLoadItemInputDto,
    key: string,
  ): Promise<MaterialLoadItemDto> {
    return this.saveItem(loadId, undefined, input, key);
  }

  public reviseItem(
    itemId: string,
    input: MaterialLoadItemInputDto,
    key: string,
  ): Promise<MaterialLoadItemDto> {
    return this.saveItem(undefined, itemId, input, key);
  }

  public async assignAsset(
    loadId: string,
    input: AssignMaterialLoadAssetDto,
    key: string,
  ): Promise<MaterialLoadAssetDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, loadId }, scope: "material-loads.assign-asset" },
      async (transaction) => {
        const locked = await this.lockPlanningLoad(transaction, actor.tenantId, loadId);
        const [asset] = await transaction
          .select()
          .from(assets)
          .where(and(eq(assets.tenantId, actor.tenantId), eq(assets.id, input.assetId)))
          .for("update");
        if (!asset) throw notFound("ASSET_NOT_FOUND", "Asset was not found");
        if (asset.status !== "available") {
          throw conflict("ASSET_UNAVAILABLE", "The selected Asset is not available");
        }
        if (asset.assetType !== input.role) {
          throw conflict("ASSET_ROLE_INVALID", "Asset role must match the Asset type");
        }
        const capacitySnapshot = {
          assetNumber: asset.assetNumber,
          capacityVolumeCubicYards: asset.capacityVolumeCubicYards,
          capacityWeightPounds: asset.capacityWeight,
          role: input.role,
        };
        const [current] = await transaction
          .select()
          .from(materialLoadAssets)
          .where(
            and(
              eq(materialLoadAssets.tenantId, actor.tenantId),
              eq(materialLoadAssets.materialLoadId, loadId),
              eq(materialLoadAssets.role, input.role),
              inArray(materialLoadAssets.status, ["planned", "active", "used"]),
            ),
          )
          .for("update");
        let assignment: typeof materialLoadAssets.$inferSelect;
        try {
          if (current) {
            const [updated] = await transaction
              .update(materialLoadAssets)
              .set({
                assetId: asset.id,
                capacitySnapshot,
                status: "planned",
                updatedBy: actor.userId,
              })
              .where(
                and(
                  eq(materialLoadAssets.tenantId, actor.tenantId),
                  eq(materialLoadAssets.id, current.id),
                ),
              )
              .returning();
            if (!updated) throw new Error("Material Load Asset was not revised");
            assignment = updated;
          } else {
            const [created] = await transaction
              .insert(materialLoadAssets)
              .values({
                assetId: asset.id,
                capacitySnapshot,
                createdBy: actor.userId,
                jobId: locked.job.id,
                materialLoadId: loadId,
                role: input.role,
                tenantId: actor.tenantId,
                updatedBy: actor.userId,
              })
              .returning();
            if (!created) throw new Error("Material Load Asset was not created");
            assignment = created;
          }
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "MATERIAL_LOAD_ASSET_CONFLICT",
              "The Asset is already configured for this Load",
            );
          }
          throw error;
        }
        await this.resetLoadSafety(transaction, actor, locked.load);
        await this.emitChange(transaction, actor, {
          after: { assetId: asset.id, role: input.role },
          before: current ? { assetId: current.assetId, role: current.role } : undefined,
          commandName: current ? "ReviseMaterialLoadAsset" : "AssignMaterialLoadAsset",
          entityId: assignment.id,
          entityType: "MaterialLoadAsset",
          eventType: current
            ? "material_delivery.load_asset_revised"
            : "material_delivery.load_asset_assigned",
          jobId: locked.job.id,
          summary: `${input.role} configured for Material Load ${locked.load.sequence.toString()}`,
        });
        return {
          body: materialLoadAssetDto(assignment, asset.assetNumber),
          status: current ? HttpStatus.OK : HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async evaluateSafety(
    loadId: string,
    input: EvaluateMaterialLoadSafetyDto,
    key: string,
  ): Promise<MaterialLoadValidationDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, loadId }, scope: "material-loads.evaluate-safety" },
      async (transaction) => {
        const locked = await this.lockLoad(transaction, actor.tenantId, loadId);
        this.assertMaterialDeliveryJob(locked.job);
        if (input.validationType === "planning") {
          if (!["planning", "needs_scheduling"].includes(locked.job.status)) {
            throw conflict(
              "MATERIAL_LOAD_PLANNING_STATE_INVALID",
              "Planning safety can only be evaluated before schedule confirmation",
            );
          }
        } else if (input.validationType === "dispatch" && locked.job.status !== "scheduled") {
          throw conflict(
            "MATERIAL_LOAD_DISPATCH_STATE_INVALID",
            "Dispatch safety requires a scheduled Job",
          );
        } else if (
          input.validationType === "actual" &&
          (locked.job.status !== "active" || locked.load.status !== "loading")
        ) {
          throw conflict(
            "MATERIAL_LOAD_ACTUAL_SAFETY_STATE_INVALID",
            "Actual safety requires an active Job and a Load that is being loaded",
          );
        }
        const items = await transaction
          .select()
          .from(materialLoadItems)
          .where(
            and(
              eq(materialLoadItems.tenantId, actor.tenantId),
              eq(materialLoadItems.materialLoadId, loadId),
              ne(materialLoadItems.deliveryResult, "cancelled"),
            ),
          )
          .orderBy(asc(materialLoadItems.sequence));
        const loadAssetRecords = await transaction
          .select()
          .from(materialLoadAssets)
          .where(
            and(
              eq(materialLoadAssets.tenantId, actor.tenantId),
              eq(materialLoadAssets.materialLoadId, loadId),
              inArray(materialLoadAssets.status, ["planned", "active", "used"]),
            ),
          )
          .orderBy(asc(materialLoadAssets.role));
        const evaluation = evaluateLoadSafety(items, loadAssetRecords, input);
        const inputHash = hashCanonicalPayload(evaluation.inputSnapshot);
        const [existing] = await transaction
          .select()
          .from(materialLoadValidations)
          .where(
            and(
              eq(materialLoadValidations.tenantId, actor.tenantId),
              eq(materialLoadValidations.materialLoadId, loadId),
              eq(materialLoadValidations.validationType, input.validationType),
              eq(materialLoadValidations.inputHash, inputHash),
            ),
          )
          .limit(1);
        if (existing) {
          await this.applySafetyResult(transaction, actor, locked.load, existing);
          return { body: materialLoadValidationDto(existing), status: HttpStatus.OK };
        }
        const [previous] = await transaction
          .select()
          .from(materialLoadValidations)
          .where(
            and(
              eq(materialLoadValidations.tenantId, actor.tenantId),
              eq(materialLoadValidations.materialLoadId, loadId),
              eq(materialLoadValidations.validationType, input.validationType),
            ),
          )
          .orderBy(desc(materialLoadValidations.evaluatedAt))
          .limit(1);
        const [validation] = await transaction
          .insert(materialLoadValidations)
          .values({
            blockers: evaluation.blockers,
            capacityResult: evaluation.capacityResult,
            compatibilityResult: evaluation.compatibilityResult,
            evaluatedBy: actor.userId,
            inputHash,
            inputSnapshot: evaluation.inputSnapshot,
            jobId: locked.job.id,
            materialLoadId: loadId,
            result: evaluation.result,
            separationResult: evaluation.separationResult,
            supersedesValidationId: previous?.id,
            tenantId: actor.tenantId,
            validationType: input.validationType,
            warnings: evaluation.warnings,
          })
          .returning();
        if (!validation) throw new Error("Material Load Validation was not created");
        await this.applySafetyResult(transaction, actor, locked.load, validation);
        await this.emitChange(transaction, actor, {
          after: {
            capacityResult: validation.capacityResult,
            compatibilityResult: validation.compatibilityResult,
            inputHash,
            result: validation.result,
            separationResult: validation.separationResult,
            validationType: validation.validationType,
          },
          commandName: "EvaluateMaterialLoadSafety",
          entityId: validation.id,
          entityType: "MaterialLoadValidation",
          eventType: "material_delivery.load_safety_evaluated",
          jobId: locked.job.id,
          metadata: { loadId },
          summary: `Material Load ${locked.load.sequence.toString()} safety: ${validation.result}`,
        });
        return { body: materialLoadValidationDto(validation), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  private async saveItem(
    loadId: string | undefined,
    itemId: string | undefined,
    input: MaterialLoadItemInputDto,
    key: string,
  ): Promise<MaterialLoadItemDto> {
    const actor = this.context.actor();
    const scope = itemId ? "material-load-items.revise" : "material-load-items.create";
    const result = await this.idempotency.execute(
      { key, payload: { input, itemId, loadId }, scope },
      async (transaction) => {
        let existing: typeof materialLoadItems.$inferSelect | undefined;
        let targetLoadId = loadId;
        if (itemId) {
          [existing] = await transaction
            .select()
            .from(materialLoadItems)
            .where(
              and(eq(materialLoadItems.tenantId, actor.tenantId), eq(materialLoadItems.id, itemId)),
            )
            .for("update");
          if (!existing) {
            throw notFound("MATERIAL_LOAD_ITEM_NOT_FOUND", "Material Load Item was not found");
          }
          targetLoadId = existing.materialLoadId;
          if (
            existing.purchasedQuantity !== null ||
            existing.loadedQuantity !== null ||
            existing.deliveredQuantity !== null
          ) {
            throw conflict(
              "MATERIAL_LOAD_ITEM_FACTS_RECORDED",
              "An Item with actual quantity facts cannot be revised as planning data",
            );
          }
        }
        if (!targetLoadId) throw new Error("Material Load id is required");
        const locked = await this.lockPlanningLoad(transaction, actor.tenantId, targetLoadId);
        await this.validateItemReferences(transaction, actor.tenantId, locked.job, input);
        const values = {
          acceptedQuoteLineItemId: input.acceptedQuoteLineItemId ?? null,
          compartment: trimmedOrNull(input.compartment),
          loadingSequence: input.loadingSequence,
          materialId: input.materialId,
          placementRouteStopId: input.placementRouteStopId,
          plannedQuantity: input.plannedQuantity,
          plannedUnitCostCents: input.plannedUnitCostCents ?? null,
          quantityUnit: input.quantityUnit,
          separationInstructions: trimmedOrNull(input.separationInstructions),
          sequence: input.sequence,
          supplierRouteStopId: input.supplierRouteStopId,
          unitVolumeCubicYards: input.unitVolumeCubicYards,
          unitWeightPounds: input.unitWeightPounds,
          unloadingSequence: input.unloadingSequence,
          updatedBy: actor.userId,
        };
        let item: typeof materialLoadItems.$inferSelect;
        try {
          if (existing) {
            const [updated] = await transaction
              .update(materialLoadItems)
              .set(values)
              .where(
                and(
                  eq(materialLoadItems.tenantId, actor.tenantId),
                  eq(materialLoadItems.id, existing.id),
                ),
              )
              .returning();
            if (!updated) throw new Error("Material Load Item was not revised");
            item = updated;
          } else {
            const [created] = await transaction
              .insert(materialLoadItems)
              .values({
                ...values,
                createdBy: actor.userId,
                jobId: locked.job.id,
                materialLoadId: targetLoadId,
                tenantId: actor.tenantId,
              })
              .returning();
            if (!created) throw new Error("Material Load Item was not created");
            item = created;
          }
        } catch (error) {
          if (databaseCode(error) === "23505") {
            throw conflict(
              "MATERIAL_LOAD_ITEM_SEQUENCE_CONFLICT",
              "A Material Load Item already uses this sequence",
            );
          }
          throw error;
        }
        await this.refreshPlanningTotals(transaction, actor, locked.load.materialDeliveryDetailId);
        await this.emitChange(transaction, actor, {
          after: materialLoadItemAudit(item),
          before: existing ? materialLoadItemAudit(existing) : undefined,
          commandName: existing ? "ReviseMaterialLoadItem" : "CreateMaterialLoadItem",
          entityId: item.id,
          entityType: "MaterialLoadItem",
          eventType: existing
            ? "material_delivery.load_item_revised"
            : "material_delivery.load_item_created",
          jobId: locked.job.id,
          metadata: { loadId: targetLoadId },
          summary: existing
            ? `Material Load Item ${item.sequence.toString()} revised`
            : `Material Load Item ${item.sequence.toString()} created`,
        });
        return {
          body: materialLoadItemDto(item),
          status: existing ? HttpStatus.OK : HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  private async validateItemReferences(
    transaction: TenantTransaction,
    tenantId: string,
    job: typeof jobs.$inferSelect,
    input: MaterialLoadItemInputDto,
  ): Promise<void> {
    const [material] = await transaction
      .select()
      .from(materials)
      .where(and(eq(materials.tenantId, tenantId), eq(materials.id, input.materialId)));
    if (!material) throw notFound("MATERIAL_NOT_FOUND", "Material was not found");
    const stops = await transaction
      .select()
      .from(routeStops)
      .where(
        and(
          eq(routeStops.tenantId, tenantId),
          eq(routeStops.jobId, job.id),
          inArray(routeStops.id, [input.supplierRouteStopId, input.placementRouteStopId]),
        ),
      );
    const supplierStop = stops.find((stop) => stop.id === input.supplierRouteStopId);
    const placementStop = stops.find((stop) => stop.id === input.placementRouteStopId);
    if (supplierStop?.stopType !== "supplier") {
      throw conflict(
        "MATERIAL_SUPPLIER_STOP_INVALID",
        "Supplier stop must be a supplier Route Stop for this Job",
      );
    }
    if (placementStop?.stopType !== "customer") {
      throw conflict(
        "MATERIAL_PLACEMENT_STOP_INVALID",
        "Placement stop must be a customer Route Stop for this Job",
      );
    }
    if (input.acceptedQuoteLineItemId) {
      const [project] = await transaction
        .select()
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.id, job.projectId)));
      if (!project) throw new Error("Material Delivery Project was not found");
      const [line] = await transaction
        .select()
        .from(quoteLineItems)
        .where(
          and(
            eq(quoteLineItems.tenantId, tenantId),
            eq(quoteLineItems.id, input.acceptedQuoteLineItemId),
            eq(quoteLineItems.quoteVersionId, project.acceptedQuoteVersionId),
          ),
        );
      if (!line) {
        throw conflict(
          "ACCEPTED_QUOTE_LINE_INVALID",
          "Accepted Quote Line Item must belong to this Project's accepted Quote Version",
        );
      }
    }
  }

  private async refreshPlanningTotals(
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
      const items = await transaction
        .select()
        .from(materialLoadItems)
        .where(
          and(
            eq(materialLoadItems.tenantId, actor.tenantId),
            eq(materialLoadItems.materialLoadId, load.id),
            ne(materialLoadItems.deliveryResult, "cancelled"),
          ),
        );
      const totals = plannedTotals(items);
      detailVolume += totals.volumeMilli;
      detailWeight += totals.weightMilli;
      await transaction
        .update(materialLoads)
        .set({
          capacityResult: "evaluation_required",
          compatibilityResult: "evaluation_required",
          plannedVolumeCubicYards: formatMilli(totals.volumeMilli),
          plannedWeightPounds: formatMilli(totals.weightMilli),
          separationResult: "evaluation_required",
          updatedBy: actor.userId,
        })
        .where(and(eq(materialLoads.tenantId, actor.tenantId), eq(materialLoads.id, load.id)));
    }
    await transaction
      .update(materialDeliveryDetails)
      .set({
        capacityStatus: "evaluation_required",
        compatibilityStatus: "evaluation_required",
        plannedVolumeCubicYards: detailVolume > 0n ? formatMilli(detailVolume) : null,
        plannedWeightPounds: detailWeight > 0n ? formatMilli(detailWeight) : null,
        status: "planning",
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, detailId),
        ),
      );
  }

  private async resetLoadSafety(
    transaction: TenantTransaction,
    actor: Actor,
    load: typeof materialLoads.$inferSelect,
  ): Promise<void> {
    await transaction
      .update(materialLoads)
      .set({
        capacityResult: "evaluation_required",
        compatibilityResult: "evaluation_required",
        separationResult: "evaluation_required",
        updatedBy: actor.userId,
      })
      .where(and(eq(materialLoads.tenantId, actor.tenantId), eq(materialLoads.id, load.id)));
    await transaction
      .update(materialDeliveryDetails)
      .set({
        capacityStatus: "evaluation_required",
        compatibilityStatus: "evaluation_required",
        status: "planning",
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, load.materialDeliveryDetailId),
        ),
      );
  }

  private async applySafetyResult(
    transaction: TenantTransaction,
    actor: Actor,
    load: typeof materialLoads.$inferSelect,
    validation: typeof materialLoadValidations.$inferSelect,
  ): Promise<void> {
    const snapshot = validation.inputSnapshot;
    const actual = validation.validationType === "actual";
    await transaction
      .update(materialLoads)
      .set({
        actualVolumeCubicYards: actual
          ? snapshotDecimal(snapshot, "actualVolumeCubicYards")
          : load.actualVolumeCubicYards,
        actualWeightPounds: actual
          ? snapshotDecimal(snapshot, "actualWeightPounds")
          : load.actualWeightPounds,
        capacityResult: validation.capacityResult,
        compatibilityResult: validation.compatibilityResult,
        plannedVolumeCubicYards: actual
          ? load.plannedVolumeCubicYards
          : snapshotDecimal(snapshot, "plannedVolumeCubicYards"),
        plannedWeightPounds: actual
          ? load.plannedWeightPounds
          : snapshotDecimal(snapshot, "plannedWeightPounds"),
        separationResult: validation.separationResult,
        updatedBy: actor.userId,
      })
      .where(and(eq(materialLoads.tenantId, actor.tenantId), eq(materialLoads.id, load.id)));
    if (!actual) await this.refreshDetailSafety(transaction, actor, load.materialDeliveryDetailId);
  }

  private async refreshDetailSafety(
    transaction: TenantTransaction,
    actor: Actor,
    detailId: string,
  ): Promise<void> {
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
    const loadCountReady = loads.length === detail.plannedLoadCount && loads.length > 0;
    const capacityStatus = loads.some((load) => load.capacityResult === "fail")
      ? "fail"
      : loadCountReady && loads.every((load) => load.capacityResult === "pass")
        ? "pass"
        : "evaluation_required";
    const compatibilityStatus = loads.some(
      (load) => load.compatibilityResult === "fail" || load.separationResult === "fail",
    )
      ? "fail"
      : loadCountReady &&
          loads.every(
            (load) =>
              ["pass", "not_required"].includes(load.compatibilityResult) &&
              ["pass", "not_required"].includes(load.separationResult),
          )
        ? "pass"
        : "evaluation_required";
    await transaction
      .update(materialDeliveryDetails)
      .set({
        capacityStatus,
        compatibilityStatus,
        status: capacityStatus === "pass" && compatibilityStatus === "pass" ? "ready" : "planning",
        updatedBy: actor.userId,
      })
      .where(
        and(
          eq(materialDeliveryDetails.tenantId, actor.tenantId),
          eq(materialDeliveryDetails.id, detailId),
        ),
      );
  }

  private async lockPlanningJob(transaction: TenantTransaction, tenantId: string, jobId: string) {
    const job = await this.lockJob(transaction, tenantId, jobId);
    if (!["planning", "needs_scheduling"].includes(job.status)) {
      throw conflict(
        "MATERIAL_DELIVERY_PLANNING_STATE_INVALID",
        "Material Delivery planning requires a Job in planning or scheduling preparation",
      );
    }
    return job;
  }

  private async lockPlanningLoad(
    transaction: TenantTransaction,
    tenantId: string,
    loadId: string,
  ): Promise<LockedLoad> {
    const locked = await this.lockLoad(transaction, tenantId, loadId);
    this.assertMaterialDeliveryJob(locked.job);
    if (!["planning", "needs_scheduling"].includes(locked.job.status)) {
      throw conflict(
        "MATERIAL_LOAD_PLANNING_STATE_INVALID",
        "Material Load planning is locked after schedule confirmation",
      );
    }
    if (locked.load.status !== "planned") {
      throw conflict("MATERIAL_LOAD_FACTS_LOCKED", "Only a planned Material Load can be revised");
    }
    return locked;
  }

  private async lockLoad(
    transaction: TenantTransaction,
    tenantId: string,
    loadId: string,
  ): Promise<LockedLoad> {
    const [load] = await transaction
      .select()
      .from(materialLoads)
      .where(and(eq(materialLoads.tenantId, tenantId), eq(materialLoads.id, loadId)))
      .for("update");
    if (!load) throw notFound("MATERIAL_LOAD_NOT_FOUND", "Material Load was not found");
    const job = await this.lockJob(transaction, tenantId, load.jobId);
    return { job, load };
  }

  private async lockJob(transaction: TenantTransaction, tenantId: string, jobId: string) {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)))
      .for("update");
    if (!job) throw notFound("JOB_NOT_FOUND", "Job was not found");
    if (["closed", "cancelled", "financially_complete"].includes(job.status)) {
      throw conflict("JOB_LOCKED", "This Job cannot be changed");
    }
    return job;
  }

  private assertMaterialDeliveryJob(job: typeof jobs.$inferSelect): void {
    if (job.serviceType !== "material_delivery") {
      throw conflict(
        "MATERIAL_DELIVERY_SERVICE_REQUIRED",
        "Material Delivery commands require a Material Delivery Job",
      );
    }
  }

  private async getDetail(
    transaction: TenantTransaction,
    tenantId: string,
    jobId: string,
  ): Promise<MaterialDeliveryDto> {
    const [job] = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
    if (!job) throw notFound("JOB_NOT_FOUND", "Job was not found");
    this.assertMaterialDeliveryJob(job);
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
      throw notFound(
        "MATERIAL_DELIVERY_NOT_FOUND",
        "Material Delivery plan was not found for this Job",
      );
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
    const [variances, expenseRecords, allocations, chargeRecords] = await Promise.all([
      transaction
        .select()
        .from(materialQuantityVariances)
        .where(
          and(
            eq(materialQuantityVariances.tenantId, tenantId),
            eq(materialQuantityVariances.jobId, jobId),
          ),
        )
        .orderBy(asc(materialQuantityVariances.createdAt)),
      transaction
        .select()
        .from(expenses)
        .where(and(eq(expenses.tenantId, tenantId), eq(expenses.jobId, jobId)))
        .orderBy(asc(expenses.incurredAt)),
      transaction
        .select()
        .from(expenseAllocations)
        .where(and(eq(expenseAllocations.tenantId, tenantId), eq(expenseAllocations.jobId, jobId)))
        .orderBy(asc(expenseAllocations.createdAt)),
      transaction
        .select()
        .from(jobCharges)
        .where(and(eq(jobCharges.tenantId, tenantId), eq(jobCharges.jobId, jobId)))
        .orderBy(asc(jobCharges.occurredAt)),
    ]);
    return {
      actualDeliveredVolumeCubicYards: detail.actualDeliveredVolumeCubicYards,
      actualDeliveredWeightPounds: detail.actualDeliveredWeightPounds,
      capacityStatus: detail.capacityStatus,
      compatibilityStatus: detail.compatibilityStatus,
      deliveryType: detail.deliveryType,
      expenses: expenseRecords.map((expense) =>
        expenseDto(
          expense,
          allocations.filter((allocation) => allocation.expenseId === expense.id),
        ),
      ),
      id: detail.id,
      invoiceReadiness: detail.invoiceReadiness,
      jobCharges: chargeRecords.map(jobChargeDto),
      jobId: detail.jobId,
      loads: await Promise.all(
        loads.map((load) => this.getLoadDetail(transaction, tenantId, load)),
      ),
      partialDelivery: detail.partialDelivery,
      placementEvidenceStatus: detail.placementEvidenceStatus,
      plannedLoadCount: detail.plannedLoadCount,
      plannedVolumeCubicYards: detail.plannedVolumeCubicYards,
      plannedWeightPounds: detail.plannedWeightPounds,
      receiptStatus: detail.receiptStatus,
      status: detail.status,
      variances: variances.map(varianceDto),
    };
  }

  private async getLoadDetail(
    transaction: TenantTransaction,
    tenantId: string,
    load: typeof materialLoads.$inferSelect,
  ): Promise<MaterialLoadDto> {
    const configuredAssets = await transaction
      .select({ assetNumber: assets.assetNumber, assignment: materialLoadAssets })
      .from(materialLoadAssets)
      .innerJoin(
        assets,
        and(
          eq(assets.tenantId, materialLoadAssets.tenantId),
          eq(assets.id, materialLoadAssets.assetId),
        ),
      )
      .where(
        and(
          eq(materialLoadAssets.tenantId, tenantId),
          eq(materialLoadAssets.materialLoadId, load.id),
        ),
      )
      .orderBy(asc(materialLoadAssets.role));
    const items = await transaction
      .select()
      .from(materialLoadItems)
      .where(
        and(
          eq(materialLoadItems.tenantId, tenantId),
          eq(materialLoadItems.materialLoadId, load.id),
        ),
      )
      .orderBy(asc(materialLoadItems.sequence));
    const itemMaterialIds = [...new Set(items.map((item) => item.materialId))];
    const itemStopIds = [
      ...new Set(
        items.flatMap((item) =>
          [item.supplierRouteStopId, item.placementRouteStopId].filter(
            (value): value is string => value !== null,
          ),
        ),
      ),
    ];
    const [itemMaterials, itemStops] = await Promise.all([
      itemMaterialIds.length === 0
        ? Promise.resolve([])
        : transaction
            .select({ id: materials.id, name: materials.name })
            .from(materials)
            .where(and(eq(materials.tenantId, tenantId), inArray(materials.id, itemMaterialIds))),
      itemStopIds.length === 0
        ? Promise.resolve([])
        : transaction
            .select({ id: routeStops.id, label: routeStops.label })
            .from(routeStops)
            .where(and(eq(routeStops.tenantId, tenantId), inArray(routeStops.id, itemStopIds))),
    ]);
    const materialNames = new Map(itemMaterials.map((material) => [material.id, material.name]));
    const stopLabels = new Map(itemStops.map((stop) => [stop.id, stop.label]));
    const validations = await transaction
      .select()
      .from(materialLoadValidations)
      .where(
        and(
          eq(materialLoadValidations.tenantId, tenantId),
          eq(materialLoadValidations.materialLoadId, load.id),
        ),
      )
      .orderBy(desc(materialLoadValidations.evaluatedAt));
    return {
      actualVolumeCubicYards: load.actualVolumeCubicYards,
      actualWeightPounds: load.actualWeightPounds,
      assets: configuredAssets.map((record) =>
        materialLoadAssetDto(record.assignment, record.assetNumber),
      ),
      capacityResult: load.capacityResult,
      compatibilityResult: load.compatibilityResult,
      id: load.id,
      items: await Promise.all(
        items.map(async (item) => {
          const evidence = await this.documents.listEntityDocuments(transaction, {
            entityId: item.id,
            entityType: "MaterialLoadItem",
            tenantId,
          });
          return materialLoadItemDto(item, {
            evidence: evidence.map(({ document, purpose }) => ({
              documentId: document.id,
              mediaType: document.mediaType,
              originalFilename: document.originalFilename,
              purpose,
            })),
            materialName: materialNames.get(item.materialId) ?? null,
            placementStopLabel: item.placementRouteStopId
              ? (stopLabels.get(item.placementRouteStopId) ?? null)
              : null,
            supplierStopLabel: item.supplierRouteStopId
              ? (stopLabels.get(item.supplierRouteStopId) ?? null)
              : null,
          });
        }),
      ),
      jobId: load.jobId,
      plannedVolumeCubicYards: load.plannedVolumeCubicYards,
      plannedWeightPounds: load.plannedWeightPounds,
      separationResult: load.separationResult,
      sequence: load.sequence,
      status: load.status,
      validations: validations.map(materialLoadValidationDto),
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

function evaluateLoadSafety(
  items: (typeof materialLoadItems.$inferSelect)[],
  configuredAssets: (typeof materialLoadAssets.$inferSelect)[],
  input: EvaluateMaterialLoadSafetyDto,
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (items.length === 0) blockers.push("Material Load has no active Items");
  const actual = input.validationType === "actual";
  const totals = actual ? actualSafetyTotals(items) : plannedTotals(items);
  const totalLabel = actual ? "Actual" : "Planned";
  const carriers = configuredAssets.filter((asset) => ["truck", "trailer"].includes(asset.role));
  if (carriers.length === 0) blockers.push("Material Load has no truck or trailer configuration");
  const weightCapacities = carriers.map((asset) =>
    snapshotMilli(asset.capacitySnapshot, "capacityWeightPounds"),
  );
  const volumeCapacities = carriers.map((asset) =>
    snapshotMilli(asset.capacitySnapshot, "capacityVolumeCubicYards"),
  );
  if (weightCapacities.some((capacity) => capacity === undefined)) {
    blockers.push("Every hauling Asset requires a weight capacity snapshot");
  }
  if (volumeCapacities.some((capacity) => capacity === undefined)) {
    blockers.push("Every hauling Asset requires a volume capacity snapshot");
  }
  const weightCapacity = minimumDefined(weightCapacities);
  const volumeCapacity = minimumDefined(volumeCapacities);
  if (weightCapacity !== undefined && totals.weightMilli > weightCapacity) {
    blockers.push(
      `${totalLabel} weight ${formatMilli(totals.weightMilli)} exceeds capacity ${formatMilli(weightCapacity)} pounds`,
    );
  }
  if (volumeCapacity !== undefined && totals.volumeMilli > volumeCapacity) {
    blockers.push(
      `${totalLabel} volume ${formatMilli(totals.volumeMilli)} exceeds capacity ${formatMilli(volumeCapacity)} cubic yards`,
    );
  }
  if (
    weightCapacity !== undefined &&
    totals.weightMilli <= weightCapacity &&
    totals.weightMilli * 100n >= weightCapacity * 90n
  ) {
    warnings.push(`${totalLabel} weight uses at least 90% of configured capacity`);
  }
  if (
    volumeCapacity !== undefined &&
    totals.volumeMilli <= volumeCapacity &&
    totals.volumeMilli * 100n >= volumeCapacity * 90n
  ) {
    warnings.push(`${totalLabel} volume uses at least 90% of configured capacity`);
  }
  const distinctMaterials = new Set(items.map((item) => item.materialId));
  const multipleMaterials = distinctMaterials.size > 1;
  const compatibilityResult = multipleMaterials
    ? input.compatibilityConfirmed
      ? "pass"
      : "fail"
    : "not_required";
  if (compatibilityResult === "fail") {
    blockers.push("Multi-material compatibility has not been confirmed");
  }
  const separationDocumented = items.every((item) =>
    [item.compartment, item.separationInstructions].some((value) => Boolean(value?.trim())),
  );
  const separationResult = multipleMaterials
    ? input.separationConfirmed && separationDocumented
      ? "pass"
      : "fail"
    : "not_required";
  if (separationResult === "fail") {
    blockers.push("Multi-material separation is not confirmed and documented");
  }
  const capacityResult = blockers.some(
    (blocker) =>
      blocker.includes("capacity") ||
      blocker.includes("no active Items") ||
      blocker.includes("no truck or trailer"),
  )
    ? "fail"
    : "pass";
  const result =
    capacityResult === "fail" || compatibilityResult === "fail" || separationResult === "fail"
      ? "not_ready"
      : warnings.length > 0
        ? "ready_with_warnings"
        : "ready";
  const inputSnapshot: Record<string, unknown> = {
    assets: configuredAssets.map((asset) => ({
      assetId: asset.assetId,
      capacitySnapshot: asset.capacitySnapshot,
      role: asset.role,
      status: asset.status,
    })),
    compatibilityConfirmed: input.compatibilityConfirmed,
    items: items.map((item) => ({
      compartment: item.compartment,
      materialId: item.materialId,
      quantity: actual ? item.loadedQuantity : item.plannedQuantity,
      separationInstructions: item.separationInstructions,
      sequence: item.sequence,
      unitVolumeCubicYards: item.unitVolumeCubicYards,
      unitWeightPounds: item.unitWeightPounds,
    })),
    [actual ? "actualVolumeCubicYards" : "plannedVolumeCubicYards"]: formatMilli(
      totals.volumeMilli,
    ),
    [actual ? "actualWeightPounds" : "plannedWeightPounds"]: formatMilli(totals.weightMilli),
    safetyModelVersion: 1,
    separationConfirmed: input.separationConfirmed,
    validationType: input.validationType,
  };
  return {
    blockers,
    capacityResult,
    compatibilityResult,
    inputSnapshot,
    result,
    separationResult,
    warnings,
  };
}

function plannedTotals(items: (typeof materialLoadItems.$inferSelect)[]) {
  let volumeMilli = 0n;
  let weightMilli = 0n;
  for (const item of items) {
    if (!item.unitVolumeCubicYards || !item.unitWeightPounds) {
      throw conflict(
        "MATERIAL_LOAD_CONVERSION_REQUIRED",
        "Every Material Load Item requires unit volume and weight snapshots",
      );
    }
    const quantity = parsePositiveMilli(item.plannedQuantity, "planned quantity");
    volumeMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitVolumeCubicYards, "volume"));
    weightMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitWeightPounds, "weight"));
  }
  return { volumeMilli, weightMilli };
}

function actualSafetyTotals(items: (typeof materialLoadItems.$inferSelect)[]) {
  let volumeMilli = 0n;
  let weightMilli = 0n;
  for (const item of items) {
    if (!item.loadedQuantity) {
      throw conflict(
        "MATERIAL_LOAD_LOADED_QUANTITY_REQUIRED",
        "Every Material Load Item requires a loaded quantity before actual safety evaluation",
      );
    }
    if (!item.unitVolumeCubicYards || !item.unitWeightPounds) {
      throw conflict(
        "MATERIAL_LOAD_CONVERSION_REQUIRED",
        "Every Material Load Item requires unit volume and weight snapshots",
      );
    }
    const quantity = parsePositiveMilli(item.loadedQuantity, "loaded quantity");
    volumeMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitVolumeCubicYards, "volume"));
    weightMilli += multiplyMilli(quantity, parsePositiveMilli(item.unitWeightPounds, "weight"));
  }
  return { volumeMilli, weightMilli };
}

function parsePositiveMilli(value: string, label: string): bigint {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "DECIMAL_INVALID",
      `${label} must have at most three decimal places`,
    );
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const parsed = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  if (parsed <= 0n) {
    throw new ApiException(HttpStatus.BAD_REQUEST, "DECIMAL_INVALID", `${label} must be positive`);
  }
  return parsed;
}

function multiplyMilli(left: bigint, right: bigint): bigint {
  return (left * right + 500n) / 1_000n;
}

function formatMilli(value: bigint): string {
  const whole = value / 1_000n;
  const fraction = (value % 1_000n).toString().padStart(3, "0");
  return `${whole.toString()}.${fraction}`;
}

function snapshotMilli(snapshot: Record<string, unknown>, field: string): bigint | undefined {
  const value = snapshot[field];
  return typeof value === "string" ? parsePositiveMilli(value, field) : undefined;
}

function snapshotDecimal(snapshot: Record<string, unknown>, field: string): string | null {
  const value = snapshot[field];
  return typeof value === "string" ? value : null;
}

function minimumDefined(values: (bigint | undefined)[]): bigint | undefined {
  if (values.length === 0 || values.some((value) => value === undefined)) return undefined;
  return (values as bigint[]).reduce((minimum, value) => (value < minimum ? value : minimum));
}

function materialLoadAssetDto(
  assignment: typeof materialLoadAssets.$inferSelect,
  assetNumber: string,
): MaterialLoadAssetDto {
  return {
    assetId: assignment.assetId,
    assetNumber,
    capacitySnapshot: assignment.capacitySnapshot,
    id: assignment.id,
    role: assignment.role,
    status: assignment.status,
  };
}

function materialLoadItemDto(
  item: typeof materialLoadItems.$inferSelect,
  detail: {
    evidence?: MaterialLoadItemDto["evidence"];
    materialName?: string | null;
    placementStopLabel?: string | null;
    supplierStopLabel?: string | null;
  } = {},
): MaterialLoadItemDto {
  if (!item.supplierRouteStopId || !item.placementRouteStopId) {
    throw new Error("Material Load Item Route Stops are incomplete");
  }
  if (!item.unitWeightPounds || !item.unitVolumeCubicYards) {
    throw new Error("Material Load Item conversion snapshots are incomplete");
  }
  return {
    acceptedQuoteLineItemId: item.acceptedQuoteLineItemId,
    actualMaterialId: item.actualMaterialId,
    actualSupplierMaterialId: item.actualSupplierMaterialId,
    actualUnitCostCents: item.actualUnitCostCents,
    compartment: item.compartment,
    deliveredQuantity: item.deliveredQuantity,
    deliveryResult: item.deliveryResult,
    evidence: detail.evidence ?? [],
    id: item.id,
    loadedQuantity: item.loadedQuantity,
    loadingSequence: item.loadingSequence,
    materialId: item.materialId,
    materialName: detail.materialName ?? null,
    placementRouteStopId: item.placementRouteStopId,
    placementStopLabel: detail.placementStopLabel ?? null,
    plannedQuantity: item.plannedQuantity,
    purchasedQuantity: item.purchasedQuantity,
    quantityUnit: item.quantityUnit,
    remainingDisposition: item.remainingDisposition,
    remainingQuantity: item.remainingQuantity,
    separationInstructions: item.separationInstructions,
    sequence: item.sequence,
    supplierRouteStopId: item.supplierRouteStopId,
    supplierStopLabel: detail.supplierStopLabel ?? null,
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

function expenseDto(
  expense: typeof expenses.$inferSelect,
  allocations: (typeof expenseAllocations.$inferSelect)[],
): ExpenseDto {
  return {
    allocations: allocations.map((allocation) => ({
      amountCents: allocation.amountCents,
      id: allocation.id,
      materialLoadItemId: allocation.materialLoadItemId,
      status: allocation.status,
    })),
    amountCents: expense.amountCents,
    expenseNumber: expense.expenseNumber,
    expenseType: expense.expenseType,
    id: expense.id,
    jobId: expense.jobId,
    receiptStatus: expense.receiptStatus,
    status: expense.status,
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

function materialLoadValidationDto(
  validation: typeof materialLoadValidations.$inferSelect,
): MaterialLoadValidationDto {
  return {
    blockers: validation.blockers,
    capacityResult: validation.capacityResult,
    compatibilityResult: validation.compatibilityResult,
    evaluatedAt: validation.evaluatedAt.toISOString(),
    id: validation.id,
    inputHash: validation.inputHash,
    result: validation.result,
    separationResult: validation.separationResult,
    validationType: validation.validationType,
    warnings: validation.warnings,
  };
}

function materialLoadItemAudit(item: typeof materialLoadItems.$inferSelect) {
  return {
    acceptedQuoteLineItemId: item.acceptedQuoteLineItemId,
    materialId: item.materialId,
    plannedQuantity: item.plannedQuantity,
    quantityUnit: item.quantityUnit,
    sequence: item.sequence,
    unitVolumeCubicYards: item.unitVolumeCubicYards,
    unitWeightPounds: item.unitWeightPounds,
  };
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return databaseCode(error.cause);
  return undefined;
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
