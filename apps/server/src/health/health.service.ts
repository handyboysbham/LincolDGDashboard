import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Pool } from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE_POOL } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import type { LiveHealthDto, ReadyHealthDto } from "./health.dto.js";

@Injectable()
export class HealthService {
  public constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public live(): LiveHealthDto {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  public async ready(): Promise<ReadyHealthDto> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkMigrations(),
      this.checkObjectStorage(),
      this.checkWorker(),
    ]);
    const names = ["database", "migrations", "objectStorage", "worker"] as const;
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
    const result = await this.pool.query<{
      current_tenant: string | null;
      organizations: string | null;
    }>(
      "select to_regprocedure('current_tenant_id()')::text as current_tenant, to_regclass('public.organizations')::text as organizations",
    );
    if (!result.rows[0]?.current_tenant || !result.rows[0].organizations) {
      throw new Error("Expected database migration is not present");
    }
  }

  private async checkObjectStorage(): Promise<void> {
    const response = await fetch(this.configuration.value.objectStorage.healthUrl, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      throw new Error("Object storage is unavailable");
    }
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
