import { describe, expect, it } from "vitest";

import { publicProjectFailure } from "./public-project-state";

describe("publicProjectFailure", () => {
  it.each([
    ["PROJECT_LINK_EXPIRED", "expired"],
    ["PROJECT_LINK_REVOKED", "revoked"],
    ["PROJECT_LINK_INVALID", "invalid"],
    [undefined, "unavailable"],
  ] as const)("maps %s to %s", (code, expected) => {
    expect(publicProjectFailure(code)).toBe(expected);
  });
});
