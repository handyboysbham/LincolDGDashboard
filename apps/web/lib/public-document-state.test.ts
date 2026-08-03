import { describe, expect, it } from "vitest";

import { publicDocumentFailure } from "./public-document-state";

describe("public document failure states", () => {
  it.each([
    ["PUBLIC_LINK_EXPIRED", "This secure link has expired."],
    ["PUBLIC_LINK_REVOKED", "This secure link was revoked."],
    ["DOCUMENT_UNAVAILABLE", "This file isn’t ready to download."],
    ["PUBLIC_LINK_INVALID", "We couldn’t find this document."],
  ])("maps %s to safe customer copy", (code, title) => {
    expect(publicDocumentFailure(code).title).toBe(title);
  });
});
