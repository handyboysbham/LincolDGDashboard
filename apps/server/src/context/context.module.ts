import { Global, Module } from "@nestjs/common";

import { RequestContextService } from "./request-context.service.js";

@Global()
@Module({
  exports: [RequestContextService],
  providers: [RequestContextService],
})
export class ContextModule {}
