import { Module } from "@nestjs/common";

import { CommunicationsWorkerModule } from "../communications/communications-worker.module.js";
import { ConfigurationModule } from "../config/configuration.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { ScheduledJobsModule } from "../scheduled/scheduled-jobs.module.js";
import { WorkerHeartbeatService } from "./worker-heartbeat.service.js";
import { WorkerRunnerService } from "./worker-runner.service.js";

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    OutboxModule,
    ScheduledJobsModule,
    CommunicationsWorkerModule,
  ],
  providers: [WorkerHeartbeatService, WorkerRunnerService],
})
export class WorkerModule {}
