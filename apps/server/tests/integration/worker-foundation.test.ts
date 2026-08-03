import { randomUUID } from "node:crypto";

import {
  createDatabase,
  createDatabasePool,
  outboxEvents,
  organizations,
  runMigrations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadServerConfig, type ServerConfig } from "../../src/config/server-config.js";
import type { ServerConfigService } from "../../src/config/server-config.service.js";
import { RequestContextService } from "../../src/context/request-context.service.js";
import { loadRootEnvironment } from "../../src/environment.js";
import { IdempotentCommandService } from "../../src/idempotency/idempotent-command.service.js";
import { OutboxHandlerRegistry } from "../../src/outbox/outbox-handler.registry.js";
import { OutboxProcessorService } from "../../src/outbox/outbox-processor.service.js";
import { WorkerHeartbeatService } from "../../src/worker/worker-heartbeat.service.js";

loadRootEnvironment();

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for worker integration tests`);
  return value;
}

function connectionString(user: string, password: string, database: string): string {
  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = password;
  url.hostname = environment("POSTGRES_HOST");
  url.port = environment("POSTGRES_PORT");
  url.pathname = `/${database}`;
  return url.toString();
}

function configured(
  base: ServerConfig,
  worker: Partial<ServerConfig["worker"]>,
): ServerConfigService {
  return {
    value: { ...base, worker: { ...base.worker, ...worker } },
  };
}

describe("worker foundation", () => {
  const databaseName = `ldg_server_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;
  let baseConfig: ServerConfig;

  const admin = () => initialized(adminPool, "admin pool");
  const migrator = () => initialized(migrationDatabase, "migration database");
  const runtime = () => initialized(runtimeDatabase, "runtime database");

  beforeAll(async () => {
    baseConfig = loadServerConfig(process.env);
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await admin().query(
      `create database "${databaseName}" owner "${environment("POSTGRES_MIGRATION_USER")}"`,
    );
    databaseCreated = true;

    migrationPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_MIGRATION_USER"),
        environment("POSTGRES_MIGRATION_PASSWORD"),
        databaseName,
      ),
    );
    runtimePool = createDatabasePool(
      connectionString(
        environment("POSTGRES_RUNTIME_USER"),
        environment("POSTGRES_RUNTIME_PASSWORD"),
        databaseName,
      ),
    );
    migrationDatabase = createDatabase(migrationPool);
    runtimeDatabase = createDatabase(runtimePool);
    await runMigrations(migrator());
    await withTenantTransaction(migrator(), tenantId, async (transaction) => {
      await transaction
        .insert(organizations)
        .values({ id: tenantId, displayName: "Worker Test", legalName: "Worker Test" });
      await transaction.insert(users).values({
        id: userId,
        tenantId,
        displayName: "Worker Test User",
        email: "worker-test@example.test",
      });
    });
  });

  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    if (adminPool && databaseCreated) {
      await adminPool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
        [databaseName],
      );
      await adminPool.query(`drop database if exists "${databaseName}"`);
    }
    await adminPool?.end();
  });

  it("processes one outbox event once across two workers", async () => {
    const eventId = randomUUID();
    let handled = 0;
    const registry = new OutboxHandlerRegistry();
    registry.register("test.once", {
      handle: () => {
        handled += 1;
        return Promise.resolve();
      },
    });
    const processorA = new OutboxProcessorService(
      runtime(),
      configured(baseConfig, { id: "worker-a", tenantIds: [tenantId] }),
      registry,
    );
    const processorB = new OutboxProcessorService(
      runtime(),
      configured(baseConfig, { id: "worker-b", tenantIds: [tenantId] }),
      registry,
    );

    await insertOutbox(runtime(), tenantId, eventId, "test.once");
    const claimed = await Promise.all([
      processorA.processOnce(tenantId),
      processorB.processOnce(tenantId),
    ]);

    expect(claimed.reduce((total, value) => total + value, 0)).toBe(1);
    expect(handled).toBe(1);
    await expect(outboxStatus(runtime(), tenantId, eventId)).resolves.toBe("processed");
  });

  it("retries failures and dead-letters at the configured limit", async () => {
    const retryId = randomUUID();
    const deadLetterId = randomUUID();
    const registry = new OutboxHandlerRegistry();
    registry.register("test.failure", {
      handle: () => Promise.reject(new Error("Sensitive provider details are not persisted")),
    });

    await insertOutbox(runtime(), tenantId, retryId, "test.failure");
    await new OutboxProcessorService(
      runtime(),
      configured(baseConfig, { id: "retry-worker", maxAttempts: 2, tenantIds: [tenantId] }),
      registry,
    ).processOnce(tenantId);
    await expect(outboxStatus(runtime(), tenantId, retryId)).resolves.toBe("pending");

    await insertOutbox(runtime(), tenantId, deadLetterId, "test.failure");
    await new OutboxProcessorService(
      runtime(),
      configured(baseConfig, { id: "dead-worker", maxAttempts: 1, tenantIds: [tenantId] }),
      registry,
    ).processOnce(tenantId);
    const deadLetter = await withTenantTransaction(runtime(), tenantId, async (transaction) =>
      transaction.query.outboxEvents.findFirst({
        where: (events, operators) => operators.eq(events.id, deadLetterId),
      }),
    );
    expect(deadLetter?.status).toBe("dead_letter");
    expect(deadLetter?.lastError).toBe("Error");
  });

  it("persists worker heartbeats", async () => {
    const workerId = `heartbeat-${randomUUID()}`;
    const heartbeat = new WorkerHeartbeatService(
      runtime(),
      configured(baseConfig, { id: workerId, tenantIds: [tenantId] }),
    );

    await heartbeat.beat();
    const row = await runtime().query.workerHeartbeats.findFirst({
      where: (heartbeats, operators) => operators.eq(heartbeats.workerId, workerId),
    });
    expect(row?.metadata).toEqual({ tenantCount: 1 });
  });

  it("executes idempotent commands in the authenticated tenant transaction", async () => {
    const context = new RequestContextService();
    const service = new IdempotentCommandService(runtime(), context);
    let invocations = 0;

    await context.run("idempotency-test", async () => {
      context.setActor({ permissions: new Set(["*"]), tenantId, userId });
      const execute = () =>
        service.execute({ key: "command-1", payload: { b: 2, a: 1 }, scope: "server-test" }, () => {
          invocations += 1;
          return Promise.resolve({ body: { ok: true }, status: 201 });
        });

      await expect(execute()).resolves.toMatchObject({ replayed: false, status: 201 });
      await expect(execute()).resolves.toMatchObject({ replayed: true, status: 201 });
    });
    expect(invocations).toBe(1);
  });
});

function initialized<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not initialized`);
  return value;
}

async function insertOutbox(
  database: Database,
  tenantId: string,
  eventId: string,
  eventType: string,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(outboxEvents).values({
      id: eventId,
      tenantId,
      aggregateType: "Test",
      aggregateId: randomUUID(),
      eventType,
      payload: { eventId },
    });
  });
}

async function outboxStatus(
  database: Database,
  tenantId: string,
  eventId: string,
): Promise<string | undefined> {
  const row = await withTenantTransaction(database, tenantId, async (transaction) =>
    transaction.query.outboxEvents.findFirst({
      where: (events, operators) => operators.eq(events.id, eventId),
    }),
  );
  return row?.status;
}
