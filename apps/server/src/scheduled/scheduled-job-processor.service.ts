import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  claimScheduledJobs,
  completeScheduledJob,
  failScheduledJob,
  withTenantTransaction,
  type ClaimedScheduledJob,
  type Database,
} from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ScheduledJobHandlerRegistry } from "./scheduled-job-handler.registry.js";

@Injectable()
export class ScheduledJobProcessorService {
  private readonly logger = new Logger(ScheduledJobProcessorService.name);

  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(ScheduledJobHandlerRegistry) private readonly handlers: ScheduledJobHandlerRegistry,
  ) {}

  public async processOnce(tenantId: string): Promise<number> {
    const worker = this.configuration.value.worker;
    const jobs = await withTenantTransaction(this.database, tenantId, (transaction) =>
      claimScheduledJobs(transaction, {
        leaseSeconds: worker.leaseSeconds,
        limit: 25,
        workerId: worker.id,
      }),
    );
    await Promise.all(jobs.map((job) => this.processJob(job)));
    return jobs.length;
  }

  private async processJob(job: ClaimedScheduledJob): Promise<void> {
    const worker = this.configuration.value.worker;
    try {
      await this.handlers.handle(job);
      const completed = await withTenantTransaction(this.database, job.tenantId, (transaction) =>
        completeScheduledJob(transaction, { jobId: job.id, workerId: worker.id }),
      );
      if (!completed) this.logger.warn(`Scheduled Job lease was lost before completion: ${job.id}`);
    } catch (error) {
      const retryDelayMs = Math.min(2 ** Math.max(job.attempts - 1, 0) * 1_000, 300_000);
      const result = await withTenantTransaction(this.database, job.tenantId, (transaction) =>
        failScheduledJob(transaction, {
          attempts: job.attempts,
          error: error instanceof Error ? error.name : "UnknownError",
          jobId: job.id,
          maxAttempts: worker.maxAttempts,
          retryAt: new Date(Date.now() + retryDelayMs),
          workerId: worker.id,
        }),
      );
      this.logger.warn(`Scheduled Job ${job.id} finished as ${result}`);
    }
  }
}
