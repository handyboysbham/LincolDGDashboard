import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./index.js";

describe("createApiClient", () => {
  it("uses the configured base URL with generated operation types", async () => {
    let requestedUrl: string | undefined;
    const fetch = vi.fn((request: Request) => {
      requestedUrl = request.url;
      return Promise.resolve(Response.json({ status: "ok" }));
    });
    const client = createApiClient({
      baseUrl: "https://api.example.test",
      fetch,
    });

    const result = await client.GET("/health/live");

    expect(fetch).toHaveBeenCalledOnce();
    expect(requestedUrl).toBe("https://api.example.test/health/live");
    expect(result.data).toEqual({ status: "ok" });
  });
});
