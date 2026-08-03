import { describe, expect, it } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { ContractTokenService } from "./contract-token.service.js";

describe("ContractTokenService", () => {
  const service = new ContractTokenService({
    value: {
      objectStorage: { publicLinkSigningKey: "test-signing-key-with-at-least-32-characters" },
    },
  } as ServerConfigService);

  it("creates deterministic scoped capabilities and exposes only a storage hash", () => {
    const input = {
      contractId: "00000000-0000-4000-8000-000000000102",
      linkId: "00000000-0000-4000-8000-000000000101",
      tenantId: "00000000-0000-4000-8000-000000000001",
    };
    const first = service.create(input);
    expect(service.create(input)).toEqual(first);
    expect(first.token).not.toContain(first.hash);
    const parsed = service.parse(first.token);
    expect(parsed).toMatchObject({ linkId: input.linkId, tenantId: input.tenantId });
    expect(service.matches(parsed?.secret ?? "", first.hash)).toBe(true);
  });

  it("rejects malformed or tampered capabilities", () => {
    expect(service.parse("invalid")).toBeUndefined();
    expect(service.matches("different", "a".repeat(64))).toBe(false);
  });
});
