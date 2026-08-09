import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { ContractTokenService } from "./contract-token.service.js";
import { JobsService } from "./jobs.service.js";
import { MaterialDeliveryExecutionService } from "./material-delivery-execution.service.js";
import { MaterialDeliveryService } from "./material-delivery.service.js";
import {
  JobsController,
  MaterialDeliveryController,
  ProjectsController,
  PublicContractsController,
  SchedulingController,
} from "./operations.controller.js";
import { ProjectsService } from "./projects.service.js";
import { RentalController } from "./rental.controller.js";
import { RentalService } from "./rental.service.js";

@Module({
  controllers: [
    ProjectsController,
    JobsController,
    MaterialDeliveryController,
    SchedulingController,
    PublicContractsController,
    RentalController,
  ],
  exports: [ProjectsService],
  imports: [DocumentsModule, IdempotencyModule],
  providers: [
    ContractTokenService,
    ProjectsService,
    JobsService,
    MaterialDeliveryService,
    MaterialDeliveryExecutionService,
    RentalService,
  ],
})
export class OperationsModule {}
