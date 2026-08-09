import { describe, expect, it } from "vitest";

import { InvoiceTokenService } from "./invoice-token.service.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const linkId = "00000000-0000-4000-8000-000000000002";
const invoiceVersionId = "00000000-0000-4000-8000-000000000003";

describe("InvoiceTokenService", () => {
  const tokens = new InvoiceTokenService({
    value: { objectStorage: { publicLinkSigningKey: "test-signing-key" } },
  } as never);

  it("creates deterministic hash-stored public Invoice capabilities", () => {
    const created = tokens.create({ invoiceVersionId, linkId, tenantId });
    const replay = tokens.create({ invoiceVersionId, linkId, tenantId });
    const parsed = tokens.parse(created.token);

    expect(replay).toEqual(created);
    expect(parsed).toMatchObject({ linkId, tenantId });
    expect(parsed && tokens.matches(parsed.secret, created.hash)).toBe(true);
    expect(created.token).not.toContain(created.hash);
  });

  it("rejects malformed capabilities", () => {
    expect(tokens.parse("not-an-invoice-token")).toBeUndefined();
    expect(tokens.matches("wrong-secret", "0".repeat(64))).toBe(false);
  });
});
