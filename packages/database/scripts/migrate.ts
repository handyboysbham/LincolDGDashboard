import { createDatabase, createDatabasePool, runMigrations } from "../src/index.js";
import { requireEnvironment } from "./environment.js";

const pool = createDatabasePool(requireEnvironment("DATABASE_MIGRATION_URL"));

try {
  await runMigrations(createDatabase(pool));
  console.log("Database migrations are current");
} finally {
  await pool.end();
}
