import { sql } from "drizzle-orm";

import type { Database, TenantTransaction } from "./client.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertTenantId(tenantId: string): void {
  if (!uuidPattern.test(tenantId)) {
    throw new Error("tenantId must be a valid UUID");
  }
}

export async function withTenantTransaction<T>(
  database: Database,
  tenantId: string,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select set_tenant_context(${tenantId}::uuid)`);
    return operation(transaction);
  });
}
