import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ContractTokenService } from "./contract-token.service.js";
import { JobsService } from "./jobs.service.js";
import {
  JobsController,
  ProjectsController,
  PublicContractsController,
  SchedulingController,
} from "./operations.controller.js";
import { ProjectsService } from "./projects.service.js";

@Module({
  controllers: [
    ProjectsController,
    JobsController,
    SchedulingController,
    PublicContractsController,
  ],
  exports: [ProjectsService],
  imports: [IdempotencyModule],
  providers: [ContractTokenService, ProjectsService, JobsService],
})
export class OperationsModule {}
