import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { ServerConfigService } from "./config/server-config.service.js";
import { loadRootEnvironment } from "./environment.js";
import { WorkerModule } from "./worker/worker.module.js";

loadRootEnvironment();

const application = await NestFactory.createApplicationContext(WorkerModule);
application.enableShutdownHooks();
const configuration = application.get(ServerConfigService).value;
new Logger("WorkerBootstrap").log(`Worker started as ${configuration.worker.id}`);
