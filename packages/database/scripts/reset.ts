import {
  createDatabase,
  createDatabasePool,
  runMigrations,
  seedLocalDevelopment,
} from "../src/index.js";
import { requireEnvironment } from "./environment.js";

if (requireEnvironment("APP_ENV") !== "local") {
  throw new Error("Database reset may run only when APP_ENV=local");
}

const pool = createDatabasePool(requireEnvironment("DATABASE_MIGRATION_URL"));

try {
  await pool.query("drop schema public cascade");
  await pool.query("create schema public authorization current_user");

  const database = createDatabase(pool);
  await runMigrations(database);
  await seedLocalDevelopment(database);
  console.log("Local database reset, migrated, and seeded");
} finally {
  await pool.end();
}
