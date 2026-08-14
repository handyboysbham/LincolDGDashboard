import { createDatabase, createDatabasePool, type Database } from "@ldg/database";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function recoveryAcceptanceEnabled(): boolean {
  return process.env.RUN_RECOVERY_ACCEPTANCE === "true";
}

export async function withRestoredDatabase(
  input: {
    adminDatabaseUrl: string;
    migrationDatabaseOwner: string;
    migrationUrl(databaseName: string): string;
    runtimeUrl(databaseName: string): string;
    sourceBackupUrl: string;
    tenantId: string;
  },
  verify: (database: Database) => Promise<void>,
): Promise<void> {
  const restoredName = `ldg_restore_${crypto.randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "ldg-recovery-"));
  const archive = join(directory, "database.dump");
  const adminPool = createDatabasePool(input.adminDatabaseUrl);
  let created = false;
  try {
    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--extension=btree_gist",
      "--schema=extensions",
      "--schema=public",
      `--file=${archive}`,
      input.sourceBackupUrl,
    ]);
    await run("pg_restore", ["--list", archive]);
    await adminPool.query(
      `create database "${restoredName}" owner "${input.migrationDatabaseOwner}"`,
    );
    created = true;
    const emptyDatabasePool = createDatabasePool(input.migrationUrl(restoredName));
    try {
      await emptyDatabasePool.query("drop schema public");
    } finally {
      await emptyDatabasePool.end();
    }
    await run("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      `--dbname=${input.migrationUrl(restoredName)}`,
      archive,
    ]);

    const migrationPool = createDatabasePool(input.migrationUrl(restoredName));
    const runtimePool = createDatabasePool(input.runtimeUrl(restoredName));
    try {
      const release = await migrationPool.query<{ release: string }>(
        "select public.current_schema_release() as release",
      );
      if (release.rows[0]?.release !== "1.10.0-rc.3") {
        throw new Error("Restored database does not match the release-candidate schema");
      }
      const database = createDatabase(runtimePool);
      const runtimeClient = await runtimePool.connect();
      try {
        await runtimeClient.query("begin");
        await runtimeClient.query("select set_tenant_context($1::uuid)", [input.tenantId]);
        const organization = await runtimeClient.query<{ count: number }>(
          "select count(*)::int as count from organizations where id = current_tenant_id()",
        );
        await runtimeClient.query("rollback");
        if (organization.rows[0]?.count !== 1) {
          throw new Error("Restricted runtime role could not read the restored tenant under RLS");
        }
      } finally {
        await runtimeClient.query("rollback").catch(() => undefined);
        runtimeClient.release();
      }
      await verify(database);
    } finally {
      await runtimePool.end();
      await migrationPool.end();
    }
  } finally {
    if (created) {
      await adminPool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [restoredName],
      );
      await adminPool.query(`drop database if exists "${restoredName}"`);
    }
    await adminPool.end();
    await rm(directory, { force: true, recursive: true });
  }
}

async function run(command: "pg_dump" | "pg_restore", arguments_: string[]): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, "../../../../../");
  const localCommand = resolve(repositoryRoot, ".local/tools/postgres/bin", command);
  await execute(
    process.env.LDG_PG_BIN ? resolve(process.env.LDG_PG_BIN, command) : localCommand,
    arguments_,
    {
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}
