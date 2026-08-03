import { describe, expect, it } from "vitest";

import { hashCanonicalPayload } from "./idempotent-command.service.js";

describe("hashCanonicalPayload", () => {
  it("produces the same hash for objects with different key order", () => {
    expect(hashCanonicalPayload({ a: 1, b: { c: true, d: [1, 2] } })).toBe(
      hashCanonicalPayload({ b: { d: [1, 2], c: true }, a: 1 }),
    );
  });

  it("rejects values that JSON cannot represent safely", () => {
    expect(() => hashCanonicalPayload({ value: Number.NaN })).toThrow(
      "Idempotency payload numbers must be finite",
    );
    expect(() => hashCanonicalPayload(Symbol("invalid"))).toThrow(
      "Idempotency payload must be JSON-compatible",
    );
  });
});
