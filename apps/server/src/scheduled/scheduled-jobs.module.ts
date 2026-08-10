import { Module } from "@nestjs/common";

import { ScheduledJobHandlerRegistry } from "./scheduled-job-handler.registry.js";
import { ScheduledJobProcessorService } from "./scheduled-job-processor.service.js";

@Module({
  exports: [ScheduledJobHandlerRegistry, ScheduledJobProcessorService],
  providers: [ScheduledJobHandlerRegistry, ScheduledJobProcessorService],
})
export class ScheduledJobsModule {}
