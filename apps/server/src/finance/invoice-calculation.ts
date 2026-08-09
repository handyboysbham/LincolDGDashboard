export interface InvoiceCalculationLine {
  direction: "credit" | "debit";
  subtotalCents: number;
  taxCents: number;
}

export interface InvoiceCalculation {
  amountDueCents: number;
  customerCreditApplicationCents: number;
  depositApplicationCents: number;
  discountCents: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function calculateInvoice(input: {
  customerCreditApplicationCents?: number;
  depositApplicationCents?: number;
  discountCents?: number;
  lines: readonly InvoiceCalculationLine[];
}): InvoiceCalculation {
  const discountCents = money(input.discountCents ?? 0, "discountCents");
  const depositApplicationCents = money(
    input.depositApplicationCents ?? 0,
    "depositApplicationCents",
  );
  const customerCreditApplicationCents = money(
    input.customerCreditApplicationCents ?? 0,
    "customerCreditApplicationCents",
  );
  const debitLines = input.lines.filter((line) => line.direction === "debit");
  const creditLines = input.lines.filter((line) => line.direction === "credit");
  if (debitLines.length > 0 && creditLines.length > 0) {
    throw new Error("An Invoice Version cannot mix debit and credit source lines");
  }
  const subtotalCents = sumMoney(
    input.lines.map((line) => money(line.subtotalCents, "line.subtotalCents")),
  );
  const taxCents = sumMoney(input.lines.map((line) => money(line.taxCents, "line.taxCents")));
  if (discountCents > subtotalCents) throw new Error("Invoice discount exceeds subtotal");
  const totalCents = checkedAdd(subtotalCents - discountCents, taxCents);
  const applications = checkedAdd(depositApplicationCents, customerCreditApplicationCents);
  if (applications > totalCents) throw new Error("Invoice applications exceed total");
  return {
    amountDueCents: totalCents - applications,
    customerCreditApplicationCents,
    depositApplicationCents,
    discountCents,
    subtotalCents,
    taxCents,
    totalCents,
  };
}

export function allocateCents(totalCents: number, weights: readonly number[]): number[] {
  money(totalCents, "totalCents");
  const normalized = weights.map((weight) => money(weight, "weight"));
  const weightTotal = sumMoney(normalized);
  if (normalized.length === 0 || weightTotal === 0) {
    if (totalCents === 0) return normalized.map(() => 0);
    throw new Error("Positive cents require at least one positive allocation weight");
  }
  const total = BigInt(totalCents);
  const totalWeight = BigInt(weightTotal);
  const allocations = normalized.map((weight) => Number((total * BigInt(weight)) / totalWeight));
  let remainder = totalCents - sumMoney(allocations);
  const ranked = normalized
    .map((weight, index) => ({
      fraction: (total * BigInt(weight)) % totalWeight,
      index,
    }))
    .toSorted((left, right) => {
      if (left.fraction === right.fraction) return left.index - right.index;
      return left.fraction > right.fraction ? -1 : 1;
    });
  for (const entry of ranked) {
    if (remainder === 0) break;
    allocations[entry.index] = (allocations[entry.index] ?? 0) + 1;
    remainder -= 1;
  }
  return allocations;
}

export function money(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer number of cents`);
  }
  return value;
}

function sumMoney(values: readonly number[]): number {
  return values.reduce((total, value) => checkedAdd(total, value), 0);
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Invoice amount exceeds safe integer range");
  return result;
}
