import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { ServerConfigService } from "../config/server-config.service.js";
import { OutboxProcessorService } from "../outbox/outbox-processor.service.js";
import { ScheduledJobProcessorService } from "../scheduled/scheduled-job-processor.service.js";
import { WorkerHeartbeatService } from "./worker-heartbeat.service.js";

@Injectable()
export class WorkerRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRunnerService.name);
  private heartbeatTimer?: NodeJS.Timeout;
  private pollTimer?: NodeJS.Timeout;
  private polling = false;

  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(WorkerHeartbeatService) private readonly heartbeat: WorkerHeartbeatService,
    @Inject(OutboxProcessorService) private readonly outbox: OutboxProcessorService,
    @Inject(ScheduledJobProcessorService)
    private readonly scheduledJobs: ScheduledJobProcessorService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.heartbeat.beat();
    await this.poll();

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat.beat().catch(() => {
        this.logger.error("Worker heartbeat failed");
      });
    }, this.configuration.value.worker.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.configuration.value.worker.pollIntervalMs);
  }

  public onApplicationShutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const tenantId of this.configuration.value.worker.tenantIds) {
        await this.scheduledJobs.processOnce(tenantId);
        await this.outbox.processOnce(tenantId);
      }
    } catch {
      this.logger.error("Outbox polling cycle failed");
    } finally {
      this.polling = false;
    }
  }
}
