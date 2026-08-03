import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";

import type { Database } from "./client.js";

export async function runMigrations(database: Database): Promise<void> {
  await migrate(database, {
    migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
    migrationsSchema: "public",
    migrationsTable: "__drizzle_migrations",
  });
}
