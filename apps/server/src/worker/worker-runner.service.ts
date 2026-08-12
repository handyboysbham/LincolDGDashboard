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
  private activePoll: Promise<void> | undefined;
  private pollTimer?: NodeJS.Timeout;
  private shuttingDown = false;

  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(WorkerHeartbeatService) private readonly heartbeat: WorkerHeartbeatService,
    @Inject(OutboxProcessorService) private readonly outbox: OutboxProcessorService,
    @Inject(ScheduledJobProcessorService)
    private readonly scheduledJobs: ScheduledJobProcessorService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    await this.heartbeat.beat();
    await this.startPoll();

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat.beat().catch(() => {
        this.logger.error("Worker heartbeat failed");
      });
    }, this.configuration.value.worker.heartbeatIntervalMs);
    this.heartbeatTimer.unref();

    this.pollTimer = setInterval(() => {
      void this.startPoll();
    }, this.configuration.value.worker.pollIntervalMs);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.activePoll;
  }

  private startPoll(): Promise<void> {
    if (this.shuttingDown) return Promise.resolve();
    this.activePoll ??= this.poll().finally(() => {
      this.activePoll = undefined;
    });
    return this.activePoll;
  }

  private async poll(): Promise<void> {
    try {
      for (const tenantId of this.configuration.value.worker.tenantIds) {
        await this.scheduledJobs.processOnce(tenantId);
        await this.outbox.processOnce(tenantId);
      }
    } catch {
      this.logger.error("Outbox polling cycle failed");
    }
  }
}
