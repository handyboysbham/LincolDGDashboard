import { describe, expect, it } from "vitest";

import { identityFromPayload } from "./jwt-verifier.service.js";

describe("identityFromPayload", () => {
  it("uses only the signed app_metadata tenant claim", () => {
    expect(
      identityFromPayload({
        app_metadata: { tenant_id: "00000000-0000-4000-8000-000000000001" },
        sub: "supabase-user-id",
        user_metadata: { tenant_id: "00000000-0000-4000-8000-000000000099" },
      }),
    ).toEqual({
      externalSubject: "supabase-user-id",
      tenantId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects a tenant claim supplied only through user_metadata", () => {
    expect(() =>
      identityFromPayload({
        sub: "supabase-user-id",
        user_metadata: { tenant_id: "00000000-0000-4000-8000-000000000001" },
      }),
    ).toThrow("JWT app_metadata is missing");
  });

  it("requires a subject and app_metadata tenant", () => {
    expect(() => identityFromPayload({ app_metadata: {} })).toThrow(
      "JWT subject is missing or invalid",
    );
    expect(() => identityFromPayload({ app_metadata: {}, sub: "subject" })).toThrow(
      "JWT tenant claim is missing",
    );
  });
});
