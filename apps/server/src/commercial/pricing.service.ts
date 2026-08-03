import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  auditEvents,
  deliveryZones,
  materials,
  outboxEvents,
  pricingPolicies,
  pricingRules,
  pricingVersions,
  supplierCostVersions,
  supplierLocations,
  supplierMaterials,
  suppliers,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  CreatePricingConfigurationDto,
  CreatePricingConfigurationResponseDto,
  DeliveryZoneDto,
  MaterialPricingReferenceInputDto,
  PricingConfigurationListDto,
  PricingPolicyDto,
  PricingVersionDto,
  SupplierCostDto,
} from "./commercial.dto.js";
import type { ControlledPricingRule } from "./pricing-engine.js";

export interface PricingVersionContext {
  effectiveAt: Date | null;
  id: string;
  policyId: string;
  policyName: string;
  rules: ControlledPricingRule[];
  serviceType: string;
  status: string;
  versionNumber: number;
}

interface Actor {
  tenantId: string;
  userId: string;
}

@Injectable()
export class PricingService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
  ) {}

  public async listConfigurations(): Promise<PricingConfigurationListDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.listConfigurationsInTransaction(transaction, actor.tenantId),
    );
  }

  public async createConfiguration(
    input: CreatePricingConfigurationDto,
    idempotencyKey: string,
  ): Promise<CreatePricingConfigurationResponseDto> {
    this.assertConfiguration(input);
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key: idempotencyKey, payload: input, scope: "pricing.create-configuration" },
      async (transaction) => {
        const existing = await transaction
          .select({ id: pricingPolicies.id })
          .from(pricingPolicies)
          .where(
            and(
              eq(pricingPolicies.tenantId, actor.tenantId),
              eq(pricingPolicies.name, input.policyName.trim()),
              eq(pricingPolicies.serviceType, input.serviceType),
            ),
          );
        if (existing.length > 0) {
          throw conflict(
            "PRICING_POLICY_EXISTS",
            "A Pricing Policy with this name and service type already exists",
          );
        }

        const policyId = randomUUID();
        const versionId = randomUUID();
        await transaction.insert(pricingPolicies).values({
          createdBy: actor.userId,
          id: policyId,
          name: input.policyName.trim(),
          serviceType: input.serviceType,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        });
        await transaction.insert(pricingVersions).values({
          createdBy: actor.userId,
          id: versionId,
          pricingPolicyId: policyId,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
          versionNumber: 1,
        });

        const createdCosts: SupplierCostDto[] = [];
        let deliveryZone: DeliveryZoneDto | null = null;
        if (input.serviceType === "material_delivery") {
          const material = requireValue(input.materialDelivery, "Material Delivery configuration");
          for (const reference of material.materials) {
            createdCosts.push(await this.resolveSupplierCost(transaction, actor, reference));
          }
          deliveryZone = await this.resolveDeliveryZone(transaction, actor, material.deliveryZone);
          await transaction.insert(pricingRules).values([
            ruleValue(
              actor,
              versionId,
              0,
              "material_markup",
              "Material markup",
              "percentage_markup",
              {
                basisPoints: material.markupBasisPoints,
              },
            ),
            ruleValue(
              actor,
              versionId,
              1,
              "additional_supplier_stop",
              "Additional supplier stop",
              "fixed_amount",
              { amountCents: material.additionalSupplierStopCents },
            ),
            ruleValue(
              actor,
              versionId,
              2,
              "separate_placement",
              "Separate placement",
              "fixed_amount",
              { amountCents: material.separatePlacementCents },
            ),
            ruleValue(actor, versionId, 3, "deposit", "Required deposit", "greater_of", {
              minimumCents: material.depositMinimumCents,
              roundUpToCents: material.depositRoundUpToCents,
            }),
          ]);
        } else {
          const rental = requireValue(input.dumpTrailerRental, "Rental configuration");
          await transaction.insert(pricingRules).values([
            ruleValue(actor, versionId, 0, "rental_package", "Rental package", "fixed_amount", {
              amountCents: rental.packageAmountCents,
              includedDays: rental.includedDays,
            }),
            ruleValue(
              actor,
              versionId,
              1,
              "additional_day",
              "Additional rental day",
              "additional_day",
              { amountCents: rental.additionalDayCents },
            ),
            ruleValue(
              actor,
              versionId,
              2,
              "weight_overage",
              "Weight overage",
              "allowance_overage",
              {
                includedWeightPounds: rental.includedWeightPounds,
                rateCentsPerPound: rental.overageRateCentsPerPound,
              },
            ),
            ruleValue(
              actor,
              versionId,
              3,
              "security_deposit",
              "Refundable security deposit",
              "fixed_amount",
              { amountCents: rental.securityDepositCents },
            ),
          ]);
        }
        await this.recordChange(transaction, actor, {
          after: { serviceType: input.serviceType, status: "draft", versionNumber: 1 },
          commandName: "CreatePricingConfiguration",
          entityId: policyId,
          entityType: "PricingPolicy",
          eventType: "pricing.configuration_created",
          metadata: { pricingVersionId: versionId },
        });
        const context = await this.getVersion(transaction, actor.tenantId, versionId);
        return {
          body: {
            deliveryZone,
            policy: toPolicyDto(
              {
                id: policyId,
                name: input.policyName.trim(),
                serviceType: input.serviceType,
                status: "draft",
              },
              [toVersionDto(context)],
            ),
            supplierCosts: createdCosts,
          },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async activateVersion(
    pricingVersionId: string,
    idempotencyKey: string,
  ): Promise<PricingVersionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key: idempotencyKey,
        payload: { pricingVersionId },
        scope: "pricing.activate-version",
      },
      async (transaction) => {
        const context = await this.getVersion(transaction, actor.tenantId, pricingVersionId, true);
        if (context.status === "active") {
          return { body: toVersionDto(context), status: HttpStatus.OK };
        }
        if (context.status !== "draft") {
          throw invalidState(
            "PRICING_VERSION_NOT_DRAFT",
            "Only a draft Pricing Version can be activated",
          );
        }
        const activatedAt = new Date();
        const activeVersions = await transaction
          .select()
          .from(pricingVersions)
          .where(
            and(
              eq(pricingVersions.tenantId, actor.tenantId),
              eq(pricingVersions.pricingPolicyId, context.policyId),
              eq(pricingVersions.status, "active"),
            ),
          )
          .for("update");
        for (const active of activeVersions) {
          await transaction
            .update(pricingVersions)
            .set({ retiredAt: activatedAt, status: "retired", updatedBy: actor.userId })
            .where(
              and(eq(pricingVersions.tenantId, actor.tenantId), eq(pricingVersions.id, active.id)),
            );
        }
        await transaction
          .update(pricingVersions)
          .set({
            activatedAt,
            effectiveAt: activatedAt,
            status: "active",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(pricingVersions.tenantId, actor.tenantId),
              eq(pricingVersions.id, pricingVersionId),
            ),
          );
        await transaction
          .update(pricingPolicies)
          .set({ status: "active", updatedBy: actor.userId })
          .where(
            and(
              eq(pricingPolicies.tenantId, actor.tenantId),
              eq(pricingPolicies.id, context.policyId),
            ),
          );
        await this.recordChange(transaction, actor, {
          after: { status: "active" },
          before: { status: context.status },
          commandName: "ActivatePricingVersion",
          entityId: pricingVersionId,
          entityType: "PricingVersion",
          eventType: "pricing.version_activated",
          metadata: { pricingPolicyId: context.policyId },
        });
        return {
          body: toVersionDto(
            {
              ...context,
              status: "active",
            },
            activatedAt,
          ),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async getVersion(
    transaction: TenantTransaction,
    tenantId: string,
    pricingVersionId: string,
    lock = false,
  ): Promise<PricingVersionContext> {
    const query = transaction
      .select({ policy: pricingPolicies, version: pricingVersions })
      .from(pricingVersions)
      .innerJoin(
        pricingPolicies,
        and(
          eq(pricingPolicies.tenantId, pricingVersions.tenantId),
          eq(pricingPolicies.id, pricingVersions.pricingPolicyId),
        ),
      )
      .where(and(eq(pricingVersions.tenantId, tenantId), eq(pricingVersions.id, pricingVersionId)));
    const records = lock ? await query.for("update") : await query;
    const record = records[0];
    if (!record) throw notFound("PRICING_VERSION_NOT_FOUND", "Pricing Version not found");
    const rules = await transaction
      .select()
      .from(pricingRules)
      .where(
        and(
          eq(pricingRules.tenantId, tenantId),
          eq(pricingRules.pricingVersionId, pricingVersionId),
        ),
      )
      .orderBy(asc(pricingRules.sequence));
    return {
      id: record.version.id,
      policyId: record.policy.id,
      policyName: record.policy.name,
      rules: rules.map((rule) => ({
        calculationType: rule.calculationType,
        code: rule.code,
        id: rule.id,
        label: rule.label,
        parameters: rule.parameters,
        sequence: rule.sequence,
      })),
      serviceType: record.policy.serviceType,
      status: record.version.status,
      effectiveAt: record.version.effectiveAt,
      versionNumber: record.version.versionNumber,
    };
  }

  private assertConfiguration(input: CreatePricingConfigurationDto): void {
    const material = input.materialDelivery;
    const rental = input.dumpTrailerRental;
    if (
      (input.serviceType === "material_delivery" && (!material || rental)) ||
      (input.serviceType === "dump_trailer_rental" && (!rental || material))
    ) {
      throw invalidInput(
        "PRICING_CONFIGURATION_INVALID",
        "A configuration requires exactly one matching service definition",
      );
    }
  }

  private async resolveSupplierCost(
    transaction: TenantTransaction,
    actor: Actor,
    input: MaterialPricingReferenceInputDto,
  ): Promise<SupplierCostDto> {
    const normalizedMaterial = normalizeReference(input.materialName);
    const [existingMaterial] = await transaction
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.tenantId, actor.tenantId),
          eq(materials.normalizedName, normalizedMaterial),
        ),
      );
    let material = existingMaterial;
    if (!material) {
      [material] = await transaction
        .insert(materials)
        .values({
          createdBy: actor.userId,
          defaultUnit: input.unit,
          name: input.materialName.trim(),
          normalizedName: normalizedMaterial,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })
        .returning();
      if (material) {
        await this.recordChange(transaction, actor, {
          after: { name: material.name, unit: material.defaultUnit },
          commandName: "CreateMaterial",
          entityId: material.id,
          entityType: "Material",
          eventType: "material.created",
        });
      }
    }
    if (!material) throw new Error("Material was not resolved");
    if (material.defaultUnit !== input.unit) {
      throw conflict(
        "MATERIAL_UNIT_CONFLICT",
        "The existing Material uses a different quantity unit",
      );
    }

    const normalizedSupplier = normalizeReference(input.supplierName);
    const [existingSupplier] = await transaction
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.tenantId, actor.tenantId),
          eq(suppliers.normalizedName, normalizedSupplier),
        ),
      );
    let supplier = existingSupplier;
    if (!supplier) {
      [supplier] = await transaction
        .insert(suppliers)
        .values({
          createdBy: actor.userId,
          name: input.supplierName.trim(),
          normalizedName: normalizedSupplier,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })
        .returning();
      if (supplier) {
        await this.recordChange(transaction, actor, {
          after: { name: supplier.name },
          commandName: "CreateSupplier",
          entityId: supplier.id,
          entityType: "Supplier",
          eventType: "supplier.created",
        });
      }
    }
    if (!supplier) throw new Error("Supplier was not resolved");

    const [existingLocation] = await transaction
      .select()
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.tenantId, actor.tenantId),
          eq(supplierLocations.supplierId, supplier.id),
          eq(supplierLocations.label, input.supplierLocationName.trim()),
        ),
      );
    let location = existingLocation;
    if (!location) {
      [location] = await transaction
        .insert(supplierLocations)
        .values({
          addressSummary: input.supplierAddressSummary?.trim(),
          createdBy: actor.userId,
          label: input.supplierLocationName.trim(),
          supplierId: supplier.id,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })
        .returning();
    }
    if (!location) throw new Error("Supplier Location was not resolved");

    const [existingSupplierMaterial] = await transaction
      .select()
      .from(supplierMaterials)
      .where(
        and(
          eq(supplierMaterials.tenantId, actor.tenantId),
          eq(supplierMaterials.supplierLocationId, location.id),
          eq(supplierMaterials.materialId, material.id),
        ),
      );
    let supplierMaterial = existingSupplierMaterial;
    if (!supplierMaterial) {
      [supplierMaterial] = await transaction
        .insert(supplierMaterials)
        .values({
          createdBy: actor.userId,
          materialId: material.id,
          supplierLocationId: location.id,
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })
        .returning();
    }
    if (!supplierMaterial) throw new Error("Supplier Material was not resolved");

    const activeCosts = await transaction
      .select()
      .from(supplierCostVersions)
      .where(
        and(
          eq(supplierCostVersions.tenantId, actor.tenantId),
          eq(supplierCostVersions.supplierMaterialId, supplierMaterial.id),
          eq(supplierCostVersions.status, "active"),
        ),
      )
      .for("update");
    const active = activeCosts[0];
    if (active?.unitCostCents === input.unitCostCents && active.unit === input.unit) {
      return toSupplierCostDto(active, material.name, supplier.name, location.label);
    }
    if (active) {
      await transaction
        .update(supplierCostVersions)
        .set({ status: "superseded", supersededAt: new Date(), updatedBy: actor.userId })
        .where(
          and(
            eq(supplierCostVersions.tenantId, actor.tenantId),
            eq(supplierCostVersions.id, active.id),
          ),
        );
    }
    const versions = await transaction
      .select({ versionNumber: supplierCostVersions.versionNumber })
      .from(supplierCostVersions)
      .where(
        and(
          eq(supplierCostVersions.tenantId, actor.tenantId),
          eq(supplierCostVersions.supplierMaterialId, supplierMaterial.id),
        ),
      )
      .orderBy(desc(supplierCostVersions.versionNumber))
      .limit(1);
    const [cost] = await transaction
      .insert(supplierCostVersions)
      .values({
        createdBy: actor.userId,
        supplierMaterialId: supplierMaterial.id,
        tenantId: actor.tenantId,
        unit: input.unit,
        unitCostCents: input.unitCostCents,
        updatedBy: actor.userId,
        versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
      })
      .returning();
    if (!cost) throw new Error("Supplier Cost Version was not created");
    await this.recordChange(transaction, actor, {
      after: {
        supplierMaterialId: supplierMaterial.id,
        unit: cost.unit,
        unitCostCents: cost.unitCostCents,
        versionNumber: cost.versionNumber,
      },
      commandName: "CreateSupplierCostVersion",
      entityId: cost.id,
      entityType: "SupplierCostVersion",
      eventType: "supplier_cost.version_created",
    });
    return toSupplierCostDto(cost, material.name, supplier.name, location.label);
  }

  private async resolveDeliveryZone(
    transaction: TenantTransaction,
    actor: Actor,
    input: { baseFeeCents: number; code: string; name: string },
  ): Promise<DeliveryZoneDto> {
    const code = input.code.trim().toUpperCase();
    const [existing] = await transaction
      .select()
      .from(deliveryZones)
      .where(and(eq(deliveryZones.tenantId, actor.tenantId), eq(deliveryZones.code, code)));
    if (existing) {
      if (existing.baseFeeCents !== input.baseFeeCents || existing.name !== input.name.trim()) {
        throw conflict(
          "DELIVERY_ZONE_CONFLICT",
          "The Delivery Zone code already exists with different pricing",
        );
      }
      return toDeliveryZoneDto(existing);
    }
    const [created] = await transaction
      .insert(deliveryZones)
      .values({
        baseFeeCents: input.baseFeeCents,
        code,
        createdBy: actor.userId,
        name: input.name.trim(),
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!created) throw new Error("Delivery Zone was not created");
    await this.recordChange(transaction, actor, {
      after: { baseFeeCents: created.baseFeeCents, code: created.code },
      commandName: "CreateDeliveryZone",
      entityId: created.id,
      entityType: "DeliveryZone",
      eventType: "delivery_zone.created",
    });
    return toDeliveryZoneDto(created);
  }

  private async listConfigurationsInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<PricingConfigurationListDto> {
    const policies = await transaction
      .select()
      .from(pricingPolicies)
      .where(eq(pricingPolicies.tenantId, tenantId))
      .orderBy(asc(pricingPolicies.serviceType), asc(pricingPolicies.name));
    const versions = await transaction
      .select()
      .from(pricingVersions)
      .where(eq(pricingVersions.tenantId, tenantId))
      .orderBy(desc(pricingVersions.versionNumber));
    const rules = await transaction
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.tenantId, tenantId))
      .orderBy(asc(pricingRules.sequence));
    const costs = await transaction
      .select({
        cost: supplierCostVersions,
        location: supplierLocations,
        material: materials,
        supplier: suppliers,
      })
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
      .innerJoin(
        supplierLocations,
        and(
          eq(supplierLocations.tenantId, supplierMaterials.tenantId),
          eq(supplierLocations.id, supplierMaterials.supplierLocationId),
        ),
      )
      .innerJoin(
        suppliers,
        and(
          eq(suppliers.tenantId, supplierLocations.tenantId),
          eq(suppliers.id, supplierLocations.supplierId),
        ),
      )
      .where(eq(supplierCostVersions.tenantId, tenantId))
      .orderBy(asc(materials.name), desc(supplierCostVersions.versionNumber));
    const zones = await transaction
      .select()
      .from(deliveryZones)
      .where(eq(deliveryZones.tenantId, tenantId))
      .orderBy(asc(deliveryZones.name));
    return {
      deliveryZones: zones.map(toDeliveryZoneDto),
      policies: policies.map((policy) =>
        toPolicyDto(
          policy,
          versions
            .filter((version) => version.pricingPolicyId === policy.id)
            .map((version) => ({
              effectiveAt: version.effectiveAt?.toISOString() ?? null,
              id: version.id,
              rules: rules
                .filter((rule) => rule.pricingVersionId === version.id)
                .map(toPricingRuleDto),
              status: version.status,
              versionNumber: version.versionNumber,
            })),
        ),
      ),
      supplierCosts: costs.map(({ cost, location, material, supplier }) =>
        toSupplierCostDto(cost, material.name, supplier.name, location.label),
      ),
    };
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

function ruleValue(
  actor: Actor,
  pricingVersionId: string,
  sequence: number,
  code: string,
  label: string,
  calculationType: string,
  parameters: Record<string, unknown>,
) {
  return {
    calculationType,
    code,
    createdBy: actor.userId,
    label,
    parameters,
    pricingVersionId,
    sequence,
    tenantId: actor.tenantId,
    updatedBy: actor.userId,
  };
}

function toPolicyDto(
  policy: { id: string; name: string; serviceType: string; status: string },
  versions: PricingVersionDto[],
): PricingPolicyDto {
  return {
    id: policy.id,
    name: policy.name,
    serviceType: policy.serviceType,
    status: policy.status,
    versions,
  };
}

function toVersionDto(context: PricingVersionContext, effectiveAt?: Date): PricingVersionDto {
  return {
    effectiveAt: (effectiveAt ?? context.effectiveAt)?.toISOString() ?? null,
    id: context.id,
    rules: context.rules.map(toPricingRuleDto),
    status: context.status,
    versionNumber: context.versionNumber,
  };
}

function toPricingRuleDto(rule: {
  calculationType: string;
  code: string;
  id: string;
  label: string;
  parameters: Record<string, unknown>;
  sequence: number;
}) {
  return {
    calculationType: rule.calculationType,
    code: rule.code,
    id: rule.id,
    label: rule.label,
    parameters: rule.parameters,
    sequence: rule.sequence,
  };
}

function toSupplierCostDto(
  cost: {
    id: string;
    status: string;
    unit: string;
    unitCostCents: number;
  },
  materialName: string,
  supplierName: string,
  supplierLocationName: string,
): SupplierCostDto {
  return {
    id: cost.id,
    materialName,
    status: cost.status,
    supplierLocationName,
    supplierName,
    unit: cost.unit,
    unitCostCents: cost.unitCostCents,
  };
}

function toDeliveryZoneDto(zone: {
  baseFeeCents: number;
  code: string;
  id: string;
  name: string;
}): DeliveryZoneDto {
  return {
    baseFeeCents: zone.baseFeeCents,
    code: zone.code,
    id: zone.id,
    name: zone.name,
  };
}

function normalizeReference(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (!value) throw invalidInput("PRICING_CONFIGURATION_INVALID", `${label} is required`);
  return value;
}

function invalidInput(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
}

function invalidState(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
