import { describe, expect, it } from "vitest";

import { allocateCents, calculateInvoice } from "./invoice-calculation.js";

describe("invoice calculation", () => {
  it("calculates integer-cent totals and applications authoritatively", () => {
    expect(
      calculateInvoice({
        depositApplicationCents: 18_500,
        lines: [
          { direction: "debit", subtotalCents: 23_000, taxCents: 0 },
          { direction: "debit", subtotalCents: 19_000, taxCents: 0 },
        ],
      }),
    ).toEqual({
      amountDueCents: 23_500,
      customerCreditApplicationCents: 0,
      depositApplicationCents: 18_500,
      discountCents: 0,
      subtotalCents: 42_000,
      taxCents: 0,
      totalCents: 42_000,
    });
  });

  it("allocates cents deterministically without losing a remainder", () => {
    const allocation = allocateCents(18_500, [23_000, 19_000]);
    expect(allocation).toEqual([10_131, 8_369]);
    expect(allocation.reduce((total, value) => total + value, 0)).toBe(18_500);
  });

  it("rejects mixed obligations and credits", () => {
    expect(() =>
      calculateInvoice({
        lines: [
          { direction: "debit", subtotalCents: 100, taxCents: 0 },
          { direction: "credit", subtotalCents: 100, taxCents: 0 },
        ],
      }),
    ).toThrow("cannot mix");
  });

  it("rejects unsafe or over-applied money", () => {
    expect(() =>
      calculateInvoice({
        depositApplicationCents: 101,
        lines: [{ direction: "debit", subtotalCents: 100, taxCents: 0 }],
      }),
    ).toThrow("applications exceed total");
    expect(() => allocateCents(Number.MAX_SAFE_INTEGER + 1, [1])).toThrow("safe integer");
  });
});
