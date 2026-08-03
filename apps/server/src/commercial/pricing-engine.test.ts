import { describe, expect, it } from "vitest";

import {
  multiplyCentsByDecimal,
  priceDumpTrailerRental,
  priceMaterialDelivery,
  type ControlledPricingRule,
} from "./pricing-engine.js";

describe("controlled pricing engine", () => {
  it("reproduces the canonical multi-material delivery price and deposit", () => {
    const result = priceMaterialDelivery({
      additionalSupplierStops: 1,
      deliveryZoneFeeCents: 12_500,
      deliveryZoneId: "zone-1",
      items: [
        {
          description: "#57 gravel",
          quantity: "4",
          supplierCostVersionId: "cost-1",
          unit: "cubic_yards",
          unitCostCents: 3_200,
        },
        {
          description: "Masonry sand",
          quantity: "2",
          supplierCostVersionId: "cost-2",
          unit: "cubic_yards",
          unitCostCents: 2_800,
        },
      ],
      rules: materialRules(),
      separatePlacements: 1,
    });

    expect(result).toMatchObject({
      depositCents: 18_500,
      marginCents: 23_600,
      purchaseCostCents: 18_400,
      totalCents: 42_000,
    });
    expect(result.calculations.map(({ amountCents, code }) => [code, amountCents])).toEqual([
      ["material_charge", 23_000],
      ["delivery_zone", 12_500],
      ["additional_supplier_stop", 2_500],
      ["separate_placement", 4_000],
      ["deposit", 18_500],
    ]);
  });

  it("reproduces the canonical weekend rental and preserves later-charge rates", () => {
    const result = priceDumpTrailerRental({
      rentalEndDate: "2026-08-10",
      rentalStartDate: "2026-08-07",
      rules: rentalRules(),
    });

    expect(result).toMatchObject({
      acceptedRateSnapshot: {
        additionalDayCents: 5_000,
        includedDays: 3,
        includedWeightPounds: 2_000,
        overageRateCentsPerPound: 8,
        packageAmountCents: 35_000,
        securityDepositCents: 15_000,
      },
      depositCents: 15_000,
      purchaseCostCents: 0,
      totalCents: 35_000,
    });
  });

  it("prices planned additional rental days without using floating point money", () => {
    const result = priceDumpTrailerRental({
      rentalEndDate: "2026-08-11",
      rentalStartDate: "2026-08-07",
      rules: rentalRules(),
    });
    expect(result.totalCents).toBe(40_000);
  });

  it("rounds controlled decimal quantities to the nearest cent", () => {
    expect(multiplyCentsByDecimal(3_333, "1.125")).toBe(3_750);
    expect(() => multiplyCentsByDecimal(3_333, "1.0001")).toThrow(/three fractional/u);
  });

  it("rejects incomplete or untyped Pricing Versions", () => {
    expect(() =>
      priceMaterialDelivery({
        additionalSupplierStops: 0,
        deliveryZoneFeeCents: 0,
        deliveryZoneId: "zone",
        items: [
          {
            description: "Gravel",
            quantity: "1",
            supplierCostVersionId: "cost",
            unit: "tons",
            unitCostCents: 1_000,
          },
        ],
        rules: [],
        separatePlacements: 0,
      }),
    ).toThrow(/controlled rule/u);
  });
});

function materialRules(): ControlledPricingRule[] {
  return [
    rule("material_markup", "percentage_markup", { basisPoints: 2_500 }, "Material markup", 0),
    rule(
      "additional_supplier_stop",
      "fixed_amount",
      { amountCents: 2_500 },
      "Additional supplier stop",
      1,
    ),
    rule("separate_placement", "fixed_amount", { amountCents: 4_000 }, "Separate placement", 2),
    rule(
      "deposit",
      "greater_of",
      { minimumCents: 15_000, roundUpToCents: 500 },
      "Required deposit",
      3,
    ),
  ];
}

function rentalRules(): ControlledPricingRule[] {
  return [
    rule(
      "rental_package",
      "fixed_amount",
      { amountCents: 35_000, includedDays: 3 },
      "Weekend rental",
      0,
    ),
    rule("additional_day", "additional_day", { amountCents: 5_000 }, "Additional rental day", 1),
    rule(
      "weight_overage",
      "allowance_overage",
      { includedWeightPounds: 2_000, rateCentsPerPound: 8 },
      "Weight overage",
      2,
    ),
    rule(
      "security_deposit",
      "fixed_amount",
      { amountCents: 15_000 },
      "Refundable security deposit",
      3,
    ),
  ];
}

function rule(
  code: string,
  calculationType: string,
  parameters: Record<string, unknown>,
  label: string,
  sequence: number,
): ControlledPricingRule {
  return { calculationType, code, id: `${code}-id`, label, parameters, sequence };
}
