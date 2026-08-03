import { Inject, Injectable } from "@nestjs/common";
import { type Database, workerHeartbeats } from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE } from "../database/database.tokens.js";

@Injectable()
export class WorkerHeartbeatService {
  private readonly startedAt = new Date();

  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public async beat(): Promise<void> {
    const workerId = this.configuration.value.worker.id;
    await this.database
      .insert(workerHeartbeats)
      .values({
        heartbeatAt: new Date(),
        metadata: { tenantCount: this.configuration.value.worker.tenantIds.length },
        processType: "outbox-worker",
        startedAt: this.startedAt,
        workerId,
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: {
          heartbeatAt: new Date(),
          metadata: { tenantCount: this.configuration.value.worker.tenantIds.length },
        },
      });
  }
}
