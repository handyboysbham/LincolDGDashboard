import { Module } from "@nestjs/common";

import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { AdministrationController } from "./administration.controller.js";
import { AdministrationService } from "./administration.service.js";

@Module({
  controllers: [AdministrationController],
  imports: [IdempotencyModule],
  providers: [AdministrationService],
})
export class AdministrationModule {}
