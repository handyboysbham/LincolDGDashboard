import { Global, Module } from "@nestjs/common";

import { ServerConfigService } from "./server-config.service.js";

@Global()
@Module({
  exports: [ServerConfigService],
  providers: [ServerConfigService],
})
export class ConfigurationModule {}
