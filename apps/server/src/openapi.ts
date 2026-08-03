import "reflect-metadata";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createApiApplication } from "./create-api-application.js";
import { loadRootEnvironment } from "./environment.js";

loadRootEnvironment();

const { application, document } = await createApiApplication();
const output = resolve(import.meta.dirname, "../openapi/openapi.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
await application.close();
console.log(`OpenAPI written to ${output}`);
