import { Module } from "@nestjs/common";

import { OutboxHandlerRegistry } from "./outbox-handler.registry.js";
import { OutboxProcessorService } from "./outbox-processor.service.js";

@Module({
  exports: [OutboxHandlerRegistry, OutboxProcessorService],
  providers: [OutboxHandlerRegistry, OutboxProcessorService],
})
export class OutboxModule {}
