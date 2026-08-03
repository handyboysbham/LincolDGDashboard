import { Inject, Injectable } from "@nestjs/common";
import {
  executeIdempotent,
  type Database,
  type IdempotentResponse,
  type TenantTransaction,
  withTenantTransaction,
} from "@ldg/database";
import { createHash } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";

@Injectable()
export class IdempotentCommandService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
  ) {}

  public execute<T>(
    input: {
      expiresInMs?: number;
      key: string;
      payload: unknown;
      scope: string;
    },
    operation: (transaction: TenantTransaction) => Promise<{ body: T; status: number }>,
  ): Promise<IdempotentResponse<T>> {
    const actor = this.context.actor();
    const expiresInMs = input.expiresInMs ?? 86_400_000;
    if (!Number.isInteger(expiresInMs) || expiresInMs < 1_000 || expiresInMs > 604_800_000) {
      throw new Error("expiresInMs must be an integer from 1000 through 604800000");
    }

    return withTenantTransaction(this.database, actor.tenantId, async (transaction) =>
      executeIdempotent(
        transaction,
        {
          expiresAt: new Date(Date.now() + expiresInMs),
          key: input.key,
          requestHash: hashCanonicalPayload(input.payload),
          scope: input.scope,
          tenantId: actor.tenantId,
        },
        operation,
      ),
    );
  }
}

export function hashCanonicalPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Idempotency payload numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Idempotency payload must be JSON-compatible");
}
