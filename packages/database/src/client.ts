import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>;
export type TenantTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabasePool(
  connectionString: string,
  options: Omit<PoolConfig, "connectionString"> = {},
) {
  if (!connectionString) {
    throw new Error("A PostgreSQL connection string is required");
  }

  return new Pool({ connectionString, ...options });
}

export function createDatabase(pool: Pool) {
  return drizzle({ client: pool, schema });
}
