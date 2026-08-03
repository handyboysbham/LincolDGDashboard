export interface ControlledPricingRule {
  calculationType: string;
  code: string;
  id: string;
  label: string;
  parameters: Record<string, unknown>;
  sequence: number;
}

export interface MaterialEstimateItemInput {
  description: string;
  quantity: string;
  supplierCostVersionId: string;
  unit: string;
  unitCostCents: number;
}

export interface PricedCostItem extends MaterialEstimateItemInput {
  sequence: number;
  totalCostCents: number;
}

export interface PricingCalculation {
  amountCents: number;
  calculationType: string;
  code: string;
  details: Record<string, unknown>;
  label: string;
  pricingRuleId?: string;
  sequence: number;
}

export interface PricingResult {
  acceptedRateSnapshot: Record<string, unknown>;
  calculations: PricingCalculation[];
  costItems: PricedCostItem[];
  depositCents: number;
  marginCents: number;
  purchaseCostCents: number;
  totalCents: number;
}

export function priceMaterialDelivery(input: {
  additionalSupplierStops: number;
  deliveryZoneFeeCents: number;
  deliveryZoneId: string;
  items: MaterialEstimateItemInput[];
  rules: ControlledPricingRule[];
  separatePlacements: number;
}): PricingResult {
  if (input.items.length === 0) throw new Error("Material Delivery pricing requires a cost item");
  assertCount(input.additionalSupplierStops, "additionalSupplierStops");
  assertCount(input.separatePlacements, "separatePlacements");
  assertMoney(input.deliveryZoneFeeCents, "deliveryZoneFeeCents");

  const markup = requireRule(input.rules, "material_markup", "percentage_markup");
  const supplierStop = requireRule(input.rules, "additional_supplier_stop", "fixed_amount");
  const placement = requireRule(input.rules, "separate_placement", "fixed_amount");
  const deposit = requireRule(input.rules, "deposit", "greater_of");
  const markupBasisPoints = ruleInteger(markup, "basisPoints", 0, 100_000);
  const supplierStopCents = ruleInteger(supplierStop, "amountCents", 0);
  const placementCents = ruleInteger(placement, "amountCents", 0);
  const depositMinimumCents = ruleInteger(deposit, "minimumCents", 0);
  const depositRoundUpToCents = ruleInteger(deposit, "roundUpToCents", 1);

  const costItems = input.items.map((item, index) => {
    assertMoney(item.unitCostCents, `items[${index.toString()}].unitCostCents`);
    if (!item.description.trim()) throw new Error("Material cost description is required");
    const totalCostCents = multiplyCentsByDecimal(item.unitCostCents, item.quantity);
    return { ...item, sequence: index, totalCostCents };
  });
  const purchaseCostCents = sumMoney(costItems.map(({ totalCostCents }) => totalCostCents));
  const materialChargeCents = applyBasisPoints(purchaseCostCents, 10_000 + markupBasisPoints);
  const additionalSupplierStopCents = supplierStopCents * input.additionalSupplierStops;
  const separatePlacementCents = placementCents * input.separatePlacements;
  const totalCents = sumMoney([
    materialChargeCents,
    input.deliveryZoneFeeCents,
    additionalSupplierStopCents,
    separatePlacementCents,
  ]);
  const depositBaseCents = Math.max(purchaseCostCents, depositMinimumCents);
  const depositCents = roundUpMoney(depositBaseCents, depositRoundUpToCents);
  const calculations: PricingCalculation[] = [
    {
      amountCents: materialChargeCents,
      calculationType: markup.calculationType,
      code: "material_charge",
      details: { markupBasisPoints, purchaseCostCents },
      label: "Materials",
      pricingRuleId: markup.id,
      sequence: 0,
    },
    {
      amountCents: input.deliveryZoneFeeCents,
      calculationType: "fixed_amount",
      code: "delivery_zone",
      details: { deliveryZoneId: input.deliveryZoneId },
      label: "Delivery",
      sequence: 1,
    },
  ];
  if (input.additionalSupplierStops > 0) {
    calculations.push({
      amountCents: additionalSupplierStopCents,
      calculationType: supplierStop.calculationType,
      code: supplierStop.code,
      details: { count: input.additionalSupplierStops, unitAmountCents: supplierStopCents },
      label: supplierStop.label,
      pricingRuleId: supplierStop.id,
      sequence: 2,
    });
  }
  if (input.separatePlacements > 0) {
    calculations.push({
      amountCents: separatePlacementCents,
      calculationType: placement.calculationType,
      code: placement.code,
      details: { count: input.separatePlacements, unitAmountCents: placementCents },
      label: placement.label,
      pricingRuleId: placement.id,
      sequence: 3,
    });
  }
  calculations.push({
    amountCents: depositCents,
    calculationType: deposit.calculationType,
    code: deposit.code,
    details: {
      minimumCents: depositMinimumCents,
      purchaseCostCents,
      roundUpToCents: depositRoundUpToCents,
    },
    label: deposit.label,
    pricingRuleId: deposit.id,
    sequence: 90,
  });

  return {
    acceptedRateSnapshot: {
      additionalSupplierStopCents: supplierStopCents,
      depositMinimumCents,
      depositRoundUpToCents,
      markupBasisPoints,
      separatePlacementCents: placementCents,
      supplierCosts: costItems.map((item) => ({
        quantity: item.quantity,
        supplierCostVersionId: item.supplierCostVersionId,
        unit: item.unit,
        unitCostCents: item.unitCostCents,
      })),
    },
    calculations,
    costItems,
    depositCents,
    marginCents: totalCents - purchaseCostCents,
    purchaseCostCents,
    totalCents,
  };
}

export function priceDumpTrailerRental(input: {
  rentalEndDate: string;
  rentalStartDate: string;
  rules: ControlledPricingRule[];
}): PricingResult {
  const packageRule = requireRule(input.rules, "rental_package", "fixed_amount");
  const additionalDayRule = requireRule(input.rules, "additional_day", "additional_day");
  const overageRule = requireRule(input.rules, "weight_overage", "allowance_overage");
  const depositRule = requireRule(input.rules, "security_deposit", "fixed_amount");
  const packageAmountCents = ruleInteger(packageRule, "amountCents", 0);
  const includedDays = ruleInteger(packageRule, "includedDays", 1, 365);
  const additionalDayCents = ruleInteger(additionalDayRule, "amountCents", 0);
  const includedWeightPounds = ruleInteger(overageRule, "includedWeightPounds", 0);
  const overageRateCentsPerPound = ruleInteger(overageRule, "rateCentsPerPound", 0);
  const securityDepositCents = ruleInteger(depositRule, "amountCents", 0);
  const plannedDays = rentalDays(input.rentalStartDate, input.rentalEndDate);
  const additionalDays = Math.max(0, plannedDays - includedDays);
  const additionalDaysCents = additionalDays * additionalDayCents;
  const totalCents = packageAmountCents + additionalDaysCents;
  const calculations: PricingCalculation[] = [
    {
      amountCents: packageAmountCents,
      calculationType: packageRule.calculationType,
      code: packageRule.code,
      details: { includedDays, plannedDays },
      label: packageRule.label,
      pricingRuleId: packageRule.id,
      sequence: 0,
    },
  ];
  if (additionalDays > 0) {
    calculations.push({
      amountCents: additionalDaysCents,
      calculationType: additionalDayRule.calculationType,
      code: additionalDayRule.code,
      details: { additionalDays, unitAmountCents: additionalDayCents },
      label: additionalDayRule.label,
      pricingRuleId: additionalDayRule.id,
      sequence: 1,
    });
  }
  calculations.push(
    {
      amountCents: 0,
      calculationType: overageRule.calculationType,
      code: overageRule.code,
      details: { includedWeightPounds, rateCentsPerPound: overageRateCentsPerPound },
      label: overageRule.label,
      pricingRuleId: overageRule.id,
      sequence: 80,
    },
    {
      amountCents: securityDepositCents,
      calculationType: depositRule.calculationType,
      code: depositRule.code,
      details: { refundable: true },
      label: depositRule.label,
      pricingRuleId: depositRule.id,
      sequence: 90,
    },
  );
  return {
    acceptedRateSnapshot: {
      additionalDayCents,
      includedDays,
      includedWeightPounds,
      overageRateCentsPerPound,
      packageAmountCents,
      securityDepositCents,
    },
    calculations,
    costItems: [],
    depositCents: securityDepositCents,
    marginCents: totalCents,
    purchaseCostCents: 0,
    totalCents,
  };
}

export function multiplyCentsByDecimal(unitCostCents: number, quantity: string): number {
  assertMoney(unitCostCents, "unitCostCents");
  const milliunits = parsePositiveDecimalToMilliunits(quantity);
  const result = (BigInt(unitCostCents) * milliunits + 500n) / 1_000n;
  return safeMoneyNumber(result, "quantity result");
}

function requireRule(
  rules: ControlledPricingRule[],
  code: string,
  calculationType: string,
): ControlledPricingRule {
  const rule = rules.find((candidate) => candidate.code === code);
  if (rule?.calculationType !== calculationType) {
    throw new Error(`Pricing Version is missing controlled rule ${code}`);
  }
  return rule;
}

function ruleInteger(
  rule: ControlledPricingRule,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = rule.parameters[name];
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Pricing rule ${rule.code}.${name} must be a controlled integer`);
  }
  return value as number;
}

function parsePositiveDecimalToMilliunits(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) {
    throw new Error("Quantity must be a positive decimal with at most three fractional digits");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const milliunits = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
  if (milliunits <= 0n) throw new Error("Quantity must be greater than zero");
  return milliunits;
}

function applyBasisPoints(amountCents: number, basisPoints: number): number {
  assertMoney(amountCents, "basis amount");
  const result = (BigInt(amountCents) * BigInt(basisPoints) + 5_000n) / 10_000n;
  return safeMoneyNumber(result, "basis-point result");
}

function roundUpMoney(amountCents: number, incrementCents: number): number {
  assertMoney(amountCents, "rounding amount");
  assertMoney(incrementCents, "rounding increment");
  if (incrementCents === 0) throw new Error("Rounding increment must be greater than zero");
  const amount = BigInt(amountCents);
  const increment = BigInt(incrementCents);
  return safeMoneyNumber(((amount + increment - 1n) / increment) * increment, "rounded amount");
}

function rentalDays(start: string, end: string): number {
  const startAt = Date.parse(`${start}T00:00:00Z`);
  const endAt = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) {
    throw new Error("Rental dates are invalid");
  }
  return Math.max(1, Math.round((endAt - startAt) / 86_400_000));
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer-cent value`);
  }
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be an integer from 0 through 100`);
  }
}

function sumMoney(values: number[]): number {
  return safeMoneyNumber(
    values.reduce((sum, value) => {
      assertMoney(value, "money value");
      return sum + BigInt(value);
    }, 0n),
    "money total",
  );
}

function safeMoneyNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the supported money range`);
  }
  return Number(value);
}
