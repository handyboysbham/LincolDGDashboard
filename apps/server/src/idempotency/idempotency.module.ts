import { Module } from "@nestjs/common";

import { IdempotentCommandService } from "./idempotent-command.service.js";

@Module({
  exports: [IdempotentCommandService],
  providers: [IdempotentCommandService],
})
export class IdempotencyModule {}
