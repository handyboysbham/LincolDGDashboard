import { describe, expect, it } from "vitest";

import { hasValidSignature } from "./object-storage.service.js";

describe("document content signatures", () => {
  it("accepts supported file signatures", () => {
    expect(hasValidSignature("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(hasValidSignature("image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(
      hasValidSignature(
        "image/png",
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(hasValidSignature("text/plain", new TextEncoder().encode("supplier ticket"))).toBe(true);
  });

  it("rejects mismatched or unsupported content", () => {
    expect(hasValidSignature("application/pdf", new TextEncoder().encode("not a pdf"))).toBe(false);
    expect(hasValidSignature("text/plain", Uint8Array.from([65, 0, 66]))).toBe(false);
    expect(hasValidSignature("application/zip", Uint8Array.from([80, 75]))).toBe(false);
  });
});
