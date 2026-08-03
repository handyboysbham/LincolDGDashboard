import { Module } from "@nestjs/common";

import { DocumentsModule } from "../documents/documents.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { CustomersController, IntakeController, LeadsController } from "./intake.controller.js";
import { IntakeService } from "./intake.service.js";

@Module({
  controllers: [IntakeController, CustomersController, LeadsController],
  exports: [IntakeService],
  imports: [DocumentsModule, IdempotencyModule],
  providers: [IntakeService],
})
export class IntakeModule {}
