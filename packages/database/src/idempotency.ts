import { and, eq } from "drizzle-orm";

import type { TenantTransaction } from "./client.js";
import { idempotencyKeys } from "./schema.js";
import { assertTenantId } from "./tenant.js";

export class IdempotencyConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export interface IdempotentResponse<T> {
  body: T;
  replayed: boolean;
  status: number;
}

export async function executeIdempotent<T>(
  transaction: TenantTransaction,
  input: {
    tenantId: string;
    scope: string;
    key: string;
    requestHash: string;
    expiresAt: Date;
  },
  operation: (transaction: TenantTransaction) => Promise<{ body: T; status: number }>,
): Promise<IdempotentResponse<T>> {
  assertTenantId(input.tenantId);

  if (!input.scope || !input.key || !input.requestHash) {
    throw new Error("scope, key, and requestHash are required");
  }

  const inserted = await transaction
    .insert(idempotencyKeys)
    .values({
      tenantId: input.tenantId,
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });

  const [record] = await transaction
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.tenantId, input.tenantId),
        eq(idempotencyKeys.scope, input.scope),
        eq(idempotencyKeys.key, input.key),
      ),
    )
    .for("update");

  if (!record) {
    throw new Error("Idempotency reservation could not be read");
  }

  if (inserted.length === 0 && record.expiresAt <= new Date()) {
    await transaction
      .update(idempotencyKeys)
      .set({
        expiresAt: input.expiresAt,
        requestHash: input.requestHash,
        responseBody: null,
        responseStatus: null,
        status: "in_progress",
      })
      .where(eq(idempotencyKeys.id, record.id));
  } else if (record.requestHash !== input.requestHash) {
    throw new IdempotencyConflictError("Idempotency key was already used for another request");
  } else if (record.status === "completed") {
    return {
      body: record.responseBody as T,
      replayed: true,
      status: record.responseStatus ?? 200,
    };
  } else if (inserted.length === 0) {
    throw new IdempotencyConflictError("Idempotency key is already in progress");
  }

  const response = await operation(transaction);

  await transaction
    .update(idempotencyKeys)
    .set({
      responseBody: response.body,
      responseStatus: response.status,
      status: "completed",
    })
    .where(eq(idempotencyKeys.id, record.id));

  return { ...response, replayed: false };
}
