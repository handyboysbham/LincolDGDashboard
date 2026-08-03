import { createDatabase, createDatabasePool, seedLocalDevelopment } from "../src/index.js";
import { requireEnvironment } from "./environment.js";

if (requireEnvironment("APP_ENV") !== "local") {
  throw new Error("The development seed may run only when APP_ENV=local");
}

const pool = createDatabasePool(requireEnvironment("DATABASE_MIGRATION_URL"));

try {
  await seedLocalDevelopment(createDatabase(pool));
  console.log("Local development seed is current");
} finally {
  await pool.end();
}
