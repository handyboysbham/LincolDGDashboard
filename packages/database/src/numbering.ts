import { sql } from "drizzle-orm";

import type { TenantTransaction } from "./client.js";
import { numberSequences } from "./schema.js";
import { assertTenantId } from "./tenant.js";

const prefixPattern = /^[A-Z0-9]{2,10}$/;
const entityTypePattern = /^[a-z][a-z0-9_]{1,49}$/;

export async function allocateBusinessNumber(
  transaction: TenantTransaction,
  input: { tenantId: string; entityType: string; year: number; prefix: string },
): Promise<string> {
  assertTenantId(input.tenantId);

  if (!entityTypePattern.test(input.entityType)) {
    throw new Error("entityType must be a lowercase application identifier");
  }

  if (!prefixPattern.test(input.prefix)) {
    throw new Error("prefix must contain 2 to 10 uppercase letters or digits");
  }

  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 9999) {
    throw new Error("year must be an integer from 2000 through 9999");
  }

  const [sequence] = await transaction
    .insert(numberSequences)
    .values({
      tenantId: input.tenantId,
      entityType: input.entityType,
      sequenceYear: input.year,
      nextValue: 2,
    })
    .onConflictDoUpdate({
      target: [numberSequences.tenantId, numberSequences.entityType, numberSequences.sequenceYear],
      set: {
        nextValue: sql`${numberSequences.nextValue} + 1`,
        updatedAt: sql`clock_timestamp()`,
      },
    })
    .returning({ nextValue: numberSequences.nextValue });

  if (!sequence) {
    throw new Error("Business-number allocation did not return a sequence value");
  }

  const allocatedValue = sequence.nextValue - 1;
  const formattedYear = input.year.toString();
  const formattedSequence = allocatedValue.toString().padStart(5, "0");
  return `${input.prefix}-${formattedYear}-${formattedSequence}`;
}
