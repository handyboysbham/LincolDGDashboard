import { describe, expect, it } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { DocumentTokenService } from "./document-token.service.js";

function service(signingKey = "test-signing-key-that-is-longer-than-32-characters") {
  return new DocumentTokenService({
    value: { objectStorage: { publicLinkSigningKey: signingKey } },
  } as unknown as ServerConfigService);
}

describe("DocumentTokenService", () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const linkId = "00000000-0000-4000-8000-000000000301";
  const documentId = "00000000-0000-4000-8000-000000000401";

  it("creates a parseable capability while storing only its hash", () => {
    const tokens = service();
    const created = tokens.create({ documentId, linkId, tenantId });
    const parsed = tokens.parse(created.token);

    expect(parsed).toMatchObject({ linkId, tenantId });
    expect(tokens.matches(parsed?.secret ?? "", created.hash)).toBe(true);
    expect(created.hash).not.toContain(parsed?.secret);
    expect(created.token).not.toContain("test-signing-key");
  });

  it("rejects malformed and tampered capabilities", () => {
    const tokens = service();
    const created = tokens.create({ documentId, linkId, tenantId });
    const parsed = tokens.parse(created.token);

    expect(tokens.parse("not-a-document-token")).toBeUndefined();
    expect(tokens.matches(`${parsed?.secret ?? ""}tampered`, created.hash)).toBe(false);
  });
});
