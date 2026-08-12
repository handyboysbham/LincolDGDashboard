import { describe, expect, it } from "vitest";

import { requestLog } from "./request-logging.js";

describe("operational request logging", () => {
  it("logs a route template and never a capability token URL", () => {
    const capabilityToken = "qv1.secret-capability-value";
    const entry = requestLog(
      {
        id: "request-id",
        method: "GET",
        routeOptions: { url: "/api/v1/public/quotes/:token" },
        url: `/api/v1/public/quotes/${capabilityToken}`,
      } as never,
      {
        elapsedTime: 12.345,
        getHeader: () => "correlation-id",
        statusCode: 200,
      },
    );

    expect(entry).toMatchObject({
      correlationId: "correlation-id",
      durationMs: 12.35,
      route: "/api/v1/public/quotes/:token",
      statusCode: 200,
    });
    expect(JSON.stringify(entry)).not.toContain(capabilityToken);
  });
});
