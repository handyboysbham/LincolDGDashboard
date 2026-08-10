import { describe, expect, it } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { CustomerCapabilityTokenService } from "./customer-capability-token.service.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000101";
const linkId = "00000000-0000-4000-8000-000000000201";

function service(): CustomerCapabilityTokenService {
  return new CustomerCapabilityTokenService({
    value: {
      objectStorage: {
        publicLinkDefaultExpiresSeconds: 86_400,
        publicLinkSigningKey: "test-signing-key-that-is-long-enough",
      },
      web: { origin: "https://customer.example.test/" },
    },
  } as ServerConfigService);
}

describe("CustomerCapabilityTokenService", () => {
  it("creates a deterministic hash-only Project capability", () => {
    const tokens = service();
    const reference = { kind: "project" as const, linkId, targetId: projectId, tenantId };
    const first = tokens.create(reference);
    const second = tokens.create(reference);

    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.token).not.toContain(first.hash);
    expect(tokens.customerUrl(reference)).toBe(
      `https://customer.example.test/customer/projects/${first.token}`,
    );
    expect(tokens.parseProject(first.token)).toMatchObject({ linkId, tenantId });
  });

  it("rejects malformed and cross-kind tokens", () => {
    const tokens = service();
    const quote = tokens.create({ kind: "quote", linkId, targetId: projectId, tenantId });

    expect(tokens.parseProject(quote.token)).toBeUndefined();
    expect(tokens.parseProject("pv1.invalid")).toBeUndefined();
    expect(tokens.matches("not-the-secret", quote.hash)).toBe(false);
  });
});
