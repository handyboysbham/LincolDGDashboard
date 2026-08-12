import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from "fastify";

export function registerRequestLogging(fastify: FastifyInstance): void {
  fastify.addHook(
    "onResponse",
    (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
      process.stdout.write(`${JSON.stringify(requestLog(request, reply))}\n`);
      done();
    },
  );
}

export function requestLog(
  request: Pick<FastifyRequest, "id" | "method" | "routeOptions">,
  reply: Pick<FastifyReply, "elapsedTime" | "getHeader" | "statusCode">,
) {
  return {
    correlationId: String(reply.getHeader("x-request-id") ?? request.id),
    durationMs: Math.round(reply.elapsedTime * 100) / 100,
    event: "http.request.completed",
    method: request.method,
    route: request.routeOptions.url ?? "unmatched",
    statusCode: reply.statusCode,
  };
}
