import { describe, expect, it } from "vitest";

import {
  assertProductionWebEnvironment,
  productionWebEnvironmentFailures,
} from "./production-environment";

const validProductionEnvironment = {
  APP_ENV: "production",
  LDG_PROCESS: "web",
  NEXT_PUBLIC_API_BASE_URL: "https://api.ldg.test",
  NEXT_PUBLIC_AUTH_MODE: "supabase",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abcdefghijklmnopqrstuvwxyz",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  VERCEL_ENV: "production",
};

describe("production web environment", () => {
  it("does not require deployment values during local development or a Vercel preview", () => {
    expect(productionWebEnvironmentFailures({ APP_ENV: "local" })).toEqual([]);
    expect(productionWebEnvironmentFailures({ VERCEL_ENV: "preview" })).toEqual([]);
  });

  it("accepts an explicit production web environment", () => {
    expect(productionWebEnvironmentFailures(validProductionEnvironment)).toEqual([]);
    expect(() => {
      assertProductionWebEnvironment(validProductionEnvironment);
    }).not.toThrow();
  });

  it("fails closed when a Vercel production build is missing configuration", () => {
    expect(() => {
      assertProductionWebEnvironment({ VERCEL_ENV: "production" });
    }).toThrow(/NEXT_PUBLIC_AUTH_MODE is required/);
  });

  it("rejects development auth and non-origin service URLs", () => {
    const failures = productionWebEnvironmentFailures({
      ...validProductionEnvironment,
      NEXT_PUBLIC_API_BASE_URL: "http://api.ldg.test/v1?token=unsafe",
      NEXT_PUBLIC_AUTH_MODE: "development",
    });

    expect(failures).toContain("NEXT_PUBLIC_AUTH_MODE must be supabase");
    expect(failures).toContain("NEXT_PUBLIC_API_BASE_URL must use HTTPS");
    expect(failures).toContain(
      "NEXT_PUBLIC_API_BASE_URL must be an origin without a path, query, or fragment",
    );
  });
});
