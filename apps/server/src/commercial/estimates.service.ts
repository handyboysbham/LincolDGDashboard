import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  deliveryZones,
  estimateCostItems,
  estimates,
  estimateVersions,
  materials,
  outboxEvents,
  pricingCalculationResults,
  quoteVersions,
  quotes,
  supplierCostVersions,
  supplierMaterials,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  IdempotentCommandService,
  hashCanonicalPayload,
} from "../idempotency/idempotent-command.service.js";
import { IntakeService, type CommercialLeadContext } from "../intake/intake.service.js";
import type {
  CreateEstimateVersionDto,
  EstimateListResponseDto,
  EstimateVersionDto,
} from "./commercial.dto.js";
import {
  priceDumpTrailerRental,
  priceMaterialDelivery,
  type MaterialEstimateItemInput,
  type PricingResult,
} from "./pricing-engine.js";
import { PricingService, type PricingVersionContext } from "./pricing.service.js";

interface Actor {
  tenantId: string;
  userId: string;
}
type EstimateRecord = typeof estimates.$inferSelect;
type EstimateVersionRecord = typeof estimateVersions.$inferSelect;

export interface EstimateVersionContext {
  dto: EstimateVersionDto;
  estimate: EstimateRecord;
  lead: CommercialLeadContext;
  version: EstimateVersionRecord;
}

@Injectable()
export class EstimatesService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  public async list(): Promise<EstimateListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const parents = await transaction
        .select()
        .from(estimates)
        .where(eq(estimates.tenantId, actor.tenantId))
        .orderBy(desc(estimates.updatedAt))
        .limit(100);
      const items: EstimateListResponseDto["items"] = [];
      for (const parent of parents) {
        const [version] = await transaction
          .select()
          .from(estimateVersions)
          .where(
            and(
              eq(estimateVersions.tenantId, actor.tenantId),
              eq(estimateVersions.estimateId, parent.id),
            ),
          )
          .orderBy(desc(estimateVersions.versionNumber))
          .limit(1);
        if (!version) continue;
        const lead = await this.intake.getCommercialLead(
          transaction,
          actor.tenantId,
          parent.leadId,
        );
        items.push({
          customerName: lead.customer.displayName,
          estimateId: parent.id,
          estimateNumber: parent.estimateNumber,
          estimateVersionId: version.id,
          leadId: lead.id,
          leadNumber: lead.leadNumber,
          recommendedPriceCents: version.recommendedPriceCents,
          serviceType: version.serviceType,
          status: version.status,
          updatedAt: parent.updatedAt.toISOString(),
          versionNumber: version.versionNumber,
        });
      }
      return { items };
    });
  }

  public async getVersion(estimateVersionId: string): Promise<EstimateVersionDto> {
    const actor = this.context.actor();
    return withTenantTransaction(
      this.database,
      actor.tenantId,
      async (transaction) =>
        (await this.getVersionContext(transaction, actor.tenantId, estimateVersionId)).dto,
    );
  }

  public async createForLead(
    leadId: string,
    input: CreateEstimateVersionDto,
    idempotencyKey: string,
  ): Promise<EstimateVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { input, leadId },
        scope: "estimates.create-version",
      },
      async (transaction) => {
        const lead = await this.intake.getCommercialLead(transaction, actor.tenantId, leadId, true);
        if (lead.status !== "estimating") {
          throw invalidState(
            "LEAD_NOT_ESTIMATING",
            "A Lead must be Estimating before an Estimate can be created",
          );
        }
        const existing = await transaction
          .select({ id: estimates.id })
          .from(estimates)
          .where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.leadId, leadId)));
        if (existing.length > 0) {
          throw invalidState(
            "ESTIMATE_ALREADY_EXISTS",
            "Use the Estimate revision command to create another version",
          );
        }
        const estimateNumber = await allocateBusinessNumber(transaction, {
          entityType: "estimate",
          prefix: "EST",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [estimate] = await transaction
          .insert(estimates)
          .values({
            createdBy: actor.userId,
            estimateNumber,
            leadId,
            ownerUserId: actor.userId,
            status: "in_analysis",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!estimate) throw new Error("Estimate was not created");
        const version = await this.createVersionInTransaction(
          transaction,
          actor,
          lead,
          estimate,
          1,
          input,
        );
        await this.recordChange(transaction, actor, {
          after: { status: estimate.status, versionNumber: 1 },
          commandName: "CreateEstimateVersion",
          entityId: estimate.id,
          entityType: "Estimate",
          eventType: "estimate.version_created",
          metadata: { estimateVersionId: version.id, leadId },
        });
        return {
          body: (await this.getVersionContext(transaction, actor.tenantId, version.id)).dto,
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async revise(
    estimateId: string,
    input: CreateEstimateVersionDto,
    idempotencyKey: string,
  ): Promise<EstimateVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { estimateId, input },
        scope: "estimates.revise",
      },
      async (transaction) => {
        const estimate = await this.findEstimate(transaction, actor.tenantId, estimateId, true);
        const acceptedQuotes = await transaction
          .select({ id: quoteVersions.id })
          .from(quotes)
          .innerJoin(
            quoteVersions,
            and(eq(quoteVersions.tenantId, quotes.tenantId), eq(quoteVersions.quoteId, quotes.id)),
          )
          .where(
            and(
              eq(quotes.tenantId, actor.tenantId),
              eq(quotes.estimateId, estimateId),
              eq(quoteVersions.status, "accepted"),
            ),
          );
        if (acceptedQuotes.length > 0) {
          throw invalidState(
            "ESTIMATE_ACCEPTED_QUOTE_EXISTS",
            "An Estimate with an accepted Quote cannot be revised",
          );
        }
        const [latest] = await transaction
          .select()
          .from(estimateVersions)
          .where(
            and(
              eq(estimateVersions.tenantId, actor.tenantId),
              eq(estimateVersions.estimateId, estimateId),
            ),
          )
          .orderBy(desc(estimateVersions.versionNumber))
          .limit(1)
          .for("update");
        if (!latest) throw notFound("ESTIMATE_VERSION_NOT_FOUND", "Estimate Version not found");
        if (!["approved", "quote_generated"].includes(latest.status)) {
          throw invalidState(
            "ESTIMATE_NOT_REVISION_READY",
            "Only an approved or Quote-generated Estimate can be revised",
          );
        }
        await transaction
          .update(estimateVersions)
          .set({ status: "superseded", updatedBy: actor.userId })
          .where(
            and(eq(estimateVersions.tenantId, actor.tenantId), eq(estimateVersions.id, latest.id)),
          );
        await transaction
          .update(estimates)
          .set({ status: "in_analysis", updatedBy: actor.userId })
          .where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, estimateId)));
        const lead = await this.intake.getCommercialLead(
          transaction,
          actor.tenantId,
          estimate.leadId,
          true,
        );
        const version = await this.createVersionInTransaction(
          transaction,
          actor,
          lead,
          { ...estimate, status: "in_analysis" },
          latest.versionNumber + 1,
          input,
        );
        await this.recordChange(transaction, actor, {
          after: { status: "draft", versionNumber: version.versionNumber },
          before: { estimateVersionId: latest.id, status: latest.status },
          commandName: "ReviseEstimate",
          entityId: estimateId,
          entityType: "Estimate",
          eventType: "estimate.revised",
          metadata: { estimateVersionId: version.id, supersededVersionId: latest.id },
        });
        return {
          body: (await this.getVersionContext(transaction, actor.tenantId, version.id)).dto,
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async submit(
    estimateVersionId: string,
    idempotencyKey: string,
  ): Promise<EstimateVersionDto> {
    return this.transitionVersion(
      estimateVersionId,
      idempotencyKey,
      "draft",
      "pending_approval",
      "SubmitEstimateForApproval",
      "estimate.submitted",
    );
  }

  public async approve(
    estimateVersionId: string,
    idempotencyKey: string,
  ): Promise<EstimateVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { estimateVersionId },
        scope: "estimates.approve",
      },
      async (transaction) => {
        const context = await this.getVersionContext(
          transaction,
          actor.tenantId,
          estimateVersionId,
          true,
        );
        if (context.version.status === "approved") {
          return { body: context.dto, status: HttpStatus.OK };
        }
        if (context.version.status !== "pending_approval") {
          throw invalidState(
            "ESTIMATE_NOT_PENDING_APPROVAL",
            "Only a pending Estimate Version can be approved",
          );
        }
        if (context.version.readiness === "not_ready") {
          throw invalidState(
            "ESTIMATE_NOT_READY",
            "A not-ready Estimate Version cannot be approved",
          );
        }
        const approvedAt = new Date();
        await transaction
          .update(estimateVersions)
          .set({
            approvedAt,
            approvedBy: actor.userId,
            approvedQuotePriceCents: context.version.recommendedPriceCents,
            status: "approved",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(estimateVersions.tenantId, actor.tenantId),
              eq(estimateVersions.id, estimateVersionId),
            ),
          );
        await transaction
          .update(estimates)
          .set({ status: "approved", updatedBy: actor.userId })
          .where(
            and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, context.estimate.id)),
          );
        await this.recordChange(transaction, actor, {
          after: {
            approvedQuotePriceCents: context.version.recommendedPriceCents,
            status: "approved",
          },
          before: { status: context.version.status },
          commandName: "ApproveEstimateVersion",
          entityId: estimateVersionId,
          entityType: "EstimateVersion",
          eventType: "estimate.version_approved",
          metadata: { estimateId: context.estimate.id },
        });
        return {
          body: (await this.getVersionContext(transaction, actor.tenantId, estimateVersionId)).dto,
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async getVersionContext(
    transaction: TenantTransaction,
    tenantId: string,
    estimateVersionId: string,
    lock = false,
  ): Promise<EstimateVersionContext> {
    const query = transaction
      .select({ estimate: estimates, version: estimateVersions })
      .from(estimateVersions)
      .innerJoin(
        estimates,
        and(
          eq(estimates.tenantId, estimateVersions.tenantId),
          eq(estimates.id, estimateVersions.estimateId),
        ),
      )
      .where(
        and(eq(estimateVersions.tenantId, tenantId), eq(estimateVersions.id, estimateVersionId)),
      );
    const records = lock ? await query.for("update") : await query;
    const record = records[0];
    if (!record) throw notFound("ESTIMATE_VERSION_NOT_FOUND", "Estimate Version not found");
    const lead = await this.intake.getCommercialLead(transaction, tenantId, record.estimate.leadId);
    const pricing = await this.pricing.getVersion(
      transaction,
      tenantId,
      record.version.pricingVersionId,
    );
    const costs = await transaction
      .select()
      .from(estimateCostItems)
      .where(
        and(
          eq(estimateCostItems.tenantId, tenantId),
          eq(estimateCostItems.estimateVersionId, estimateVersionId),
        ),
      )
      .orderBy(asc(estimateCostItems.sequence));
    const calculations = await transaction
      .select()
      .from(pricingCalculationResults)
      .where(
        and(
          eq(pricingCalculationResults.tenantId, tenantId),
          eq(pricingCalculationResults.estimateVersionId, estimateVersionId),
        ),
      )
      .orderBy(asc(pricingCalculationResults.sequence));
    return {
      dto: {
        approvedQuotePriceCents: record.version.approvedQuotePriceCents,
        calculations: calculations.map((calculation) => ({
          amountCents: calculation.amountCents,
          calculationType: calculation.calculationType,
          code: calculation.code,
          details: calculation.details,
          id: calculation.id,
          label: calculation.label,
        })),
        contentHash: record.version.contentHash,
        costItems: costs.map((cost) => ({
          description: cost.description,
          id: cost.id,
          quantity: cost.quantity,
          totalCostCents: cost.totalCostCents,
          unit: cost.unit,
          unitCostCents: cost.unitCostCents,
        })),
        createdAt: record.version.createdAt.toISOString(),
        customerName: lead.customer.displayName,
        depositCents: record.version.depositCents,
        estimateId: record.estimate.id,
        estimateNumber: record.estimate.estimateNumber,
        id: record.version.id,
        inputSnapshot: record.version.inputSnapshot,
        leadId: lead.id,
        leadNumber: lead.leadNumber,
        marginCents: record.version.marginCents,
        operationalAssessment: record.version.operationalAssessment,
        pricingPolicyName: pricing.policyName,
        pricingVersionId: pricing.id,
        pricingVersionNumber: pricing.versionNumber,
        purchaseCostCents: record.version.purchaseCostCents,
        readiness: record.version.readiness,
        recommendedPriceCents: record.version.recommendedPriceCents,
        riskAssessment: record.version.riskAssessment,
        serviceType: record.version.serviceType,
        status: record.version.status,
        versionNumber: record.version.versionNumber,
      },
      estimate: record.estimate,
      lead,
      version: record.version,
    };
  }

  public async markQuoteGenerated(
    transaction: TenantTransaction,
    actor: Actor,
    estimateVersionId: string,
    quoteVersionId: string,
  ): Promise<void> {
    const context = await this.getVersionContext(
      transaction,
      actor.tenantId,
      estimateVersionId,
      true,
    );
    if (context.version.status === "quote_generated") return;
    if (context.version.status !== "approved") {
      throw invalidState(
        "ESTIMATE_NOT_APPROVED",
        "Only an approved Estimate Version can generate a Quote",
      );
    }
    await transaction
      .update(estimateVersions)
      .set({ status: "quote_generated", updatedBy: actor.userId })
      .where(
        and(
          eq(estimateVersions.tenantId, actor.tenantId),
          eq(estimateVersions.id, estimateVersionId),
        ),
      );
    await transaction
      .update(estimates)
      .set({ status: "quote_generated", updatedBy: actor.userId })
      .where(and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, context.estimate.id)));
    await this.recordChange(transaction, actor, {
      after: { status: "quote_generated" },
      before: { status: context.version.status },
      commandName: "GenerateQuoteFromEstimate",
      entityId: estimateVersionId,
      entityType: "EstimateVersion",
      eventType: "estimate.quote_generated",
      metadata: { quoteVersionId },
    });
  }

  private async createVersionInTransaction(
    transaction: TenantTransaction,
    actor: Actor,
    lead: CommercialLeadContext,
    estimate: EstimateRecord,
    versionNumber: number,
    input: CreateEstimateVersionDto,
  ): Promise<EstimateVersionRecord> {
    const pricing = await this.pricing.getVersion(
      transaction,
      actor.tenantId,
      input.pricingVersionId,
      true,
    );
    if (pricing.status !== "active") {
      throw invalidState(
        "PRICING_VERSION_NOT_ACTIVE",
        "An Estimate must use an active Pricing Version",
      );
    }
    if (pricing.serviceType !== lead.serviceType) {
      throw invalidInput(
        "PRICING_SERVICE_MISMATCH",
        "The Pricing Version does not match the Lead service type",
      );
    }
    const calculation = await this.calculate(transaction, actor.tenantId, lead, pricing, input);
    const inputSnapshot = {
      acceptedRates: calculation.acceptedRateSnapshot,
      lead: {
        leadId: lead.id,
        serviceType: lead.serviceType,
        summary: lead.summary,
      },
      pricingPolicyId: pricing.policyId,
      pricingVersionId: pricing.id,
      pricingVersionNumber: pricing.versionNumber,
      request: {
        materialDelivery: input.materialDelivery,
        operationalAssessment: input.operationalAssessment?.trim(),
        riskAssessment: input.riskAssessment?.trim(),
      },
    };
    const contentHash = hashCanonicalPayload({
      calculations: calculation.calculations,
      costItems: calculation.costItems,
      depositCents: calculation.depositCents,
      inputSnapshot,
      marginCents: calculation.marginCents,
      purchaseCostCents: calculation.purchaseCostCents,
      recommendedPriceCents: calculation.totalCents,
    });
    const [version] = await transaction
      .insert(estimateVersions)
      .values({
        contentHash,
        createdBy: actor.userId,
        depositCents: calculation.depositCents,
        estimateId: estimate.id,
        inputSnapshot,
        marginCents: calculation.marginCents,
        operationalAssessment: input.operationalAssessment?.trim(),
        pricingVersionId: pricing.id,
        purchaseCostCents: calculation.purchaseCostCents,
        readiness: "ready",
        recommendedPriceCents: calculation.totalCents,
        riskAssessment: input.riskAssessment?.trim(),
        serviceType: lead.serviceType,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
        versionNumber,
      })
      .returning();
    if (!version) throw new Error("Estimate Version was not created");
    if (calculation.costItems.length > 0) {
      await transaction.insert(estimateCostItems).values(
        calculation.costItems.map((cost) => ({
          category: "material",
          createdBy: actor.userId,
          description: cost.description,
          estimateVersionId: version.id,
          metadata: {},
          quantity: cost.quantity,
          sequence: cost.sequence,
          supplierCostVersionId: cost.supplierCostVersionId,
          tenantId: actor.tenantId,
          totalCostCents: cost.totalCostCents,
          unit: cost.unit,
          unitCostCents: cost.unitCostCents,
          updatedBy: actor.userId,
        })),
      );
    }
    await transaction.insert(pricingCalculationResults).values(
      calculation.calculations.map((result) => ({
        amountCents: result.amountCents,
        calculationType: result.calculationType,
        code: result.code,
        createdBy: actor.userId,
        details: result.details,
        estimateVersionId: version.id,
        label: result.label,
        pricingRuleId: result.pricingRuleId,
        sequence: result.sequence,
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })),
    );
    return version;
  }

  private async calculate(
    transaction: TenantTransaction,
    tenantId: string,
    lead: CommercialLeadContext,
    pricing: PricingVersionContext,
    input: CreateEstimateVersionDto,
  ): Promise<PricingResult> {
    if (lead.serviceType === "material_delivery") {
      if (!input.materialDelivery) {
        throw invalidInput(
          "MATERIAL_ESTIMATE_INPUT_REQUIRED",
          "Material Delivery Estimate inputs are required",
        );
      }
      const zoneRows = await transaction
        .select()
        .from(deliveryZones)
        .where(
          and(
            eq(deliveryZones.tenantId, tenantId),
            eq(deliveryZones.id, input.materialDelivery.deliveryZoneId),
            eq(deliveryZones.status, "active"),
          ),
        );
      const zone = zoneRows[0];
      if (!zone) throw notFound("DELIVERY_ZONE_NOT_FOUND", "Active Delivery Zone not found");
      const requestedIds = input.materialDelivery.items.map(
        ({ supplierCostVersionId }) => supplierCostVersionId,
      );
      const costRows = await transaction
        .select({ cost: supplierCostVersions, material: materials })
        .from(supplierCostVersions)
        .innerJoin(
          supplierMaterials,
          and(
            eq(supplierMaterials.tenantId, supplierCostVersions.tenantId),
            eq(supplierMaterials.id, supplierCostVersions.supplierMaterialId),
          ),
        )
        .innerJoin(
          materials,
          and(
            eq(materials.tenantId, supplierMaterials.tenantId),
            eq(materials.id, supplierMaterials.materialId),
          ),
        )
        .where(
          and(
            eq(supplierCostVersions.tenantId, tenantId),
            eq(supplierCostVersions.status, "active"),
            inArray(supplierCostVersions.id, requestedIds),
          ),
        );
      const resolved: MaterialEstimateItemInput[] = input.materialDelivery.items.map(
        (requested) => {
          const match = costRows.find(({ cost }) => cost.id === requested.supplierCostVersionId);
          if (!match) {
            throw notFound(
              "SUPPLIER_COST_NOT_FOUND",
              "An active Supplier Cost Version was not found",
            );
          }
          return {
            description: match.material.name,
            quantity: requested.quantity,
            supplierCostVersionId: match.cost.id,
            unit: match.cost.unit,
            unitCostCents: match.cost.unitCostCents,
          };
        },
      );
      try {
        return priceMaterialDelivery({
          additionalSupplierStops: input.materialDelivery.additionalSupplierStops,
          deliveryZoneFeeCents: zone.baseFeeCents,
          deliveryZoneId: zone.id,
          items: resolved,
          rules: pricing.rules,
          separatePlacements: input.materialDelivery.separatePlacements,
        });
      } catch (error) {
        throw pricingFailure(error);
      }
    }
    if (input.materialDelivery) {
      throw invalidInput(
        "RENTAL_ESTIMATE_INPUT_INVALID",
        "Rental Estimates cannot contain Material Delivery inputs",
      );
    }
    const rental = lead.rental;
    if (!rental) throw invalidInput("RENTAL_LEAD_INVALID", "Rental Lead details are unavailable");
    try {
      return priceDumpTrailerRental({
        rentalEndDate: rental.rentalEndDate,
        rentalStartDate: rental.rentalStartDate,
        rules: pricing.rules,
      });
    } catch (error) {
      throw pricingFailure(error);
    }
  }

  private async transitionVersion(
    estimateVersionId: string,
    idempotencyKey: string,
    from: string,
    to: string,
    commandName: string,
    eventType: string,
  ): Promise<EstimateVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { estimateVersionId, to },
        scope: `estimates.${to}`,
      },
      async (transaction) => {
        const context = await this.getVersionContext(
          transaction,
          actor.tenantId,
          estimateVersionId,
          true,
        );
        if (context.version.status === to) {
          return { body: context.dto, status: HttpStatus.OK };
        }
        if (context.version.status !== from) {
          throw invalidState(
            "ESTIMATE_TRANSITION_INVALID",
            `An Estimate Version in ${context.version.status} cannot transition to ${to}`,
          );
        }
        const submittedAt = to === "pending_approval" ? new Date() : undefined;
        await transaction
          .update(estimateVersions)
          .set({ status: to, submittedAt, updatedBy: actor.userId })
          .where(
            and(
              eq(estimateVersions.tenantId, actor.tenantId),
              eq(estimateVersions.id, estimateVersionId),
            ),
          );
        await transaction
          .update(estimates)
          .set({ status: to, updatedBy: actor.userId })
          .where(
            and(eq(estimates.tenantId, actor.tenantId), eq(estimates.id, context.estimate.id)),
          );
        await this.recordChange(transaction, actor, {
          after: { status: to },
          before: { status: from },
          commandName,
          entityId: estimateVersionId,
          entityType: "EstimateVersion",
          eventType,
          metadata: { estimateId: context.estimate.id },
        });
        return {
          body: (await this.getVersionContext(transaction, actor.tenantId, estimateVersionId)).dto,
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async findEstimate(
    transaction: TenantTransaction,
    tenantId: string,
    estimateId: string,
    lock = false,
  ): Promise<EstimateRecord> {
    const query = transaction
      .select()
      .from(estimates)
      .where(and(eq(estimates.tenantId, tenantId), eq(estimates.id, estimateId)));
    const records = lock ? await query.for("update") : await query;
    const estimate = records[0];
    if (!estimate) throw notFound("ESTIMATE_NOT_FOUND", "Estimate not found");
    return estimate;
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

function invalidInput(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function pricingFailure(error: unknown): ApiException {
  return invalidInput(
    "PRICING_CALCULATION_INVALID",
    error instanceof Error ? error.message : "Pricing calculation failed",
  );
}
