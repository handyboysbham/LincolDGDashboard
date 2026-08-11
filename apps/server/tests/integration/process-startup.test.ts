import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import { WorkerHeartbeatService } from "../../src/worker/worker-heartbeat.service.js";
import { WorkerModule } from "../../src/worker/worker.module.js";
import { loadLocalDatabaseEnvironment } from "./local-database-environment.js";

loadLocalDatabaseEnvironment();

describe("process startup", () => {
  it("starts and stops the worker without an HTTP server", async () => {
    const application = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    expect(application.get(WorkerHeartbeatService)).toBeInstanceOf(WorkerHeartbeatService);
    await application.close();
  });
});
