import { describe, expect, it } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { DocumentTransferTokenService } from "./document-transfer-token.service.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const service = new DocumentTransferTokenService({
  value: {
    objectStorage: { publicLinkSigningKey: "test-signing-key-with-at-least-32-characters" },
  },
} as ServerConfigService);

describe("DocumentTransferTokenService", () => {
  it("creates scoped expiring upload capabilities", () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.create({ documentId, expiresAt, purpose: "upload", tenantId });

    expect(service.parse(token, "upload")).toMatchObject({
      documentId,
      purpose: "upload",
      tenantId,
    });
    expect(service.parse(token, "download")).toBeUndefined();
  });

  it("rejects tampered and expired capabilities", () => {
    const valid = service.create({
      documentId,
      expiresAt: new Date(Date.now() + 60_000),
      purpose: "download",
      tenantId,
    });
    expect(service.parse(`${valid.slice(0, -1)}x`, "download")).toBeUndefined();

    const expired = service.create({
      documentId,
      expiresAt: new Date(Date.now() - 1_000),
      purpose: "download",
      tenantId,
    });
    expect(service.parse(expired, "download")).toBeUndefined();
  });
});
