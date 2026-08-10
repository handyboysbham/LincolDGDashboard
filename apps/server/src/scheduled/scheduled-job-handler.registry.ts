import { Injectable } from "@nestjs/common";
import type { ClaimedScheduledJob } from "@ldg/database";

export interface ScheduledJobHandler {
  handle(job: ClaimedScheduledJob): Promise<void>;
}

@Injectable()
export class ScheduledJobHandlerRegistry {
  private readonly handlers = new Map<string, ScheduledJobHandler>();

  public register(jobType: string, handler: ScheduledJobHandler): void {
    if (!jobType) throw new Error("Scheduled Job type is required");
    if (this.handlers.has(jobType)) {
      throw new Error(`Scheduled Job handler already registered for ${jobType}`);
    }
    this.handlers.set(jobType, handler);
  }

  public async handle(job: ClaimedScheduledJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) throw new Error("UnregisteredScheduledJob");
    await handler.handle(job);
  }
}
