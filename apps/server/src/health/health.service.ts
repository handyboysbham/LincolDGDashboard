import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE_POOL } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { ObjectStorageService } from "../object-storage/object-storage.service.js";
import type { LiveHealthDto, ReadyHealthDto } from "./health.dto.js";

@Injectable()
export class HealthService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService,
  ) {}

  public live(): LiveHealthDto {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  public async ready(): Promise<ReadyHealthDto> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkMigrations(),
      this.checkObjectStorage(),
      this.checkQueue(),
      this.checkWorker(),
    ]);
    const names = ["database", "migrations", "objectStorage", "queue", "worker"] as const;
    const failed = checks.flatMap((result, index) =>
      result.status === "rejected" ? [names[index]] : [],
    );

    if (failed.length > 0) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "SERVICE_NOT_READY",
        "One or more required dependencies are unavailable",
        { failed },
      );
    }

    return {
      checks: {
        database: "ready",
        migrations: "ready",
        objectStorage: "ready",
        queue: "ready",
        worker: this.configuration.value.worker.readyRequiresHeartbeat ? "ready" : "skipped",
      },
      status: "ready",
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<void> {
    await this.pool.query("select 1");
  }

  private async checkMigrations(): Promise<void> {
    const result = await this.pool.query<{ release: string | null }>(
      "select public.current_schema_release() as release",
    );
    if (result.rows[0]?.release !== this.configuration.value.expectedDatabaseRelease) {
      throw new Error("Expected database migration is not present");
    }
  }

  private async checkQueue(): Promise<void> {
    for (const tenantId of this.configuration.value.worker.tenantIds) {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        await client.query("select set_tenant_context($1::uuid)", [tenantId]);
        const result = await client.query<{ deadLetters: number; oldestAgeSeconds: number }>(
          `with queue as (
             select status, available_at as ready_at, locked_until
             from outbox_events
             union all
             select status, run_at as ready_at, locked_until
             from scheduled_jobs
           )
           select
             count(*) filter (where status = 'dead_letter')::int as "deadLetters",
             coalesce(max(extract(epoch from clock_timestamp() - ready_at)) filter (
               where (status = 'pending' and ready_at <= clock_timestamp())
                 or (status = 'processing' and locked_until < clock_timestamp())
             ), 0)::int as "oldestAgeSeconds"
           from queue`,
        );
        await client.query("rollback");
        const status = result.rows[0];
        if (
          !status ||
          status.deadLetters > this.configuration.value.worker.readyMaxDeadLetterEvents ||
          status.oldestAgeSeconds > this.configuration.value.worker.readyMaxOutboxAgeSeconds
        ) {
          throw new Error("Queue backlog exceeds readiness thresholds");
        }
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  private async checkObjectStorage(): Promise<void> {
    await this.objectStorage.checkHealth();
  }

  private async checkWorker(): Promise<void> {
    if (!this.configuration.value.worker.readyRequiresHeartbeat) return;

    const staleAfterMs = this.configuration.value.worker.heartbeatStaleAfterMs;
    const result = await this.pool.query<{ ready: boolean }>(
      `select exists (
        select 1
        from worker_heartbeats
        where heartbeat_at >= clock_timestamp() - ($1 * interval '1 millisecond')
      ) as ready`,
      [staleAfterMs],
    );
    if (result.rows[0]?.ready !== true) {
      throw new Error("Worker heartbeat is stale or missing");
    }
  }
}
