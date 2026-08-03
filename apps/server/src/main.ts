import "reflect-metadata";

import { Logger } from "@nestjs/common";

import { ServerConfigService } from "./config/server-config.service.js";
import { createApiApplication } from "./create-api-application.js";
import { loadRootEnvironment } from "./environment.js";

loadRootEnvironment();

const { application } = await createApiApplication();
const configuration = application.get(ServerConfigService).value;
await application.listen(configuration.api.port, configuration.api.host);
new Logger("ApiBootstrap").log(
  `API listening on http://${configuration.api.host}:${configuration.api.port.toString()}`,
);
