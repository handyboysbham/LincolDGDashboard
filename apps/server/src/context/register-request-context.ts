import { randomUUID } from "node:crypto";
import type { FastifyInstance, HookHandlerDoneFunction } from "fastify";

import { RequestContextService } from "./request-context.service.js";

const correlationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function registerRequestContext(
  fastify: FastifyInstance,
  context: RequestContextService,
): void {
  fastify.addHook("onRequest", (request, reply, done: HookHandlerDoneFunction) => {
    const header = request.headers["x-request-id"];
    const candidate = Array.isArray(header) ? header[0] : header;
    const correlationId =
      candidate && correlationIdPattern.test(candidate) ? candidate : randomUUID();
    reply.header("x-request-id", correlationId);
    context.run(correlationId, done);
  });
}
