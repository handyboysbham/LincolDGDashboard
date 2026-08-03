import { describe, expect, it } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { QuoteTokenService } from "./quote-token.service.js";

describe("QuoteTokenService", () => {
  const service = new QuoteTokenService({
    value: {
      objectStorage: { publicLinkSigningKey: "test-signing-key-with-at-least-32-characters" },
    },
  } as ServerConfigService);

  it("creates deterministic scoped tokens while exposing only a hash for storage", () => {
    const input = {
      linkId: "00000000-0000-4000-8000-000000000101",
      quoteVersionId: "00000000-0000-4000-8000-000000000102",
      tenantId: "00000000-0000-4000-8000-000000000001",
    };
    const first = service.create(input);
    const second = service.create(input);
    expect(first).toEqual(second);
    expect(first.token).not.toContain(first.hash);
    const parsed = service.parse(first.token);
    expect(parsed).toMatchObject({ linkId: input.linkId, tenantId: input.tenantId });
    expect(service.matches(parsed?.secret ?? "", first.hash)).toBe(true);
  });

  it("rejects malformed and tampered capabilities", () => {
    expect(service.parse("invalid")).toBeUndefined();
    expect(service.matches("different", "a".repeat(64))).toBe(false);
  });
});
