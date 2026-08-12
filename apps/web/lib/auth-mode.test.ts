import { afterEach, describe, expect, it } from "vitest";

import { isPublicWebPath, safePostAuthPath, webAuthMode } from "./auth-mode";

const originalMode = process.env.NEXT_PUBLIC_AUTH_MODE;

afterEach(() => {
  process.env.NEXT_PUBLIC_AUTH_MODE = originalMode;
});

describe("web authentication boundaries", () => {
  it("allows only explicit public surfaces", () => {
    expect(isPublicWebPath("/customer/quotes/token")).toBe(true);
    expect(isPublicWebPath("/auth/confirm")).toBe(true);
    expect(isPublicWebPath("/sign-in")).toBe(true);
    expect(isPublicWebPath("/settings")).toBe(false);
    expect(isPublicWebPath("/driver/jobs/123")).toBe(false);
  });

  it("fails closed for unknown auth modes", () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = "disabled";
    expect(() => webAuthMode()).toThrow("NEXT_PUBLIC_AUTH_MODE must be development or supabase");
  });

  it("allows only same-origin post-authentication destinations", () => {
    expect(safePostAuthPath("/jobs?day=today#active")).toBe("/jobs?day=today#active");
    expect(safePostAuthPath("//attacker.test/path")).toBe("/");
    expect(safePostAuthPath("/\\attacker.test/path")).toBe("/");
    expect(safePostAuthPath("https://attacker.test/path")).toBe("/");
  });
});
