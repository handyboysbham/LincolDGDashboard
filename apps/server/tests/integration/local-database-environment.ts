import { loadRootEnvironment } from "../../src/environment.js";

const requiredDatabaseEnvironment = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_MIGRATION_USER",
  "POSTGRES_MIGRATION_PASSWORD",
  "POSTGRES_RUNTIME_USER",
  "POSTGRES_RUNTIME_PASSWORD",
] as const;

function required(name: (typeof requiredDatabaseEnvironment)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for server integration tests`);
  return value;
}

function connectionString(user: string, password: string): string {
  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = password;
  url.hostname = required("POSTGRES_HOST");
  url.port = required("POSTGRES_PORT");
  url.pathname = `/${required("POSTGRES_DB")}`;
  return url.toString();
}

export function loadLocalDatabaseEnvironment(): void {
  loadRootEnvironment();

  for (const name of requiredDatabaseEnvironment) required(name);

  process.env.DATABASE_MIGRATION_URL = connectionString(
    required("POSTGRES_MIGRATION_USER"),
    required("POSTGRES_MIGRATION_PASSWORD"),
  );
  process.env.DATABASE_URL = connectionString(
    required("POSTGRES_RUNTIME_USER"),
    required("POSTGRES_RUNTIME_PASSWORD"),
  );
}
