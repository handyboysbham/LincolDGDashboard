import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const connectionString = process.env.DATABASE_MIGRATION_URL;

if (!connectionString) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}

export default defineConfig({
  dialect: "postgresql",
  migrations: {
    prefix: "index",
    table: "__drizzle_migrations",
    schema: "public",
  },
  out: "./drizzle",
  schema: "./src/schema.ts",
  dbCredentials: { url: connectionString },
  strict: true,
  verbose: true,
});
