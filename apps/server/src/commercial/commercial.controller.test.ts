import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import {
  EstimatesController,
  PricingController,
  PublicQuotesController,
  QuotesController,
} from "./commercial.controller.js";

describe("commercial controller authorization", () => {
  it.each([
    [PricingController, "activateVersion", ["pricing:approve"]],
    [EstimatesController, "createForLead", ["estimates:write", "leads:read"]],
    [EstimatesController, "revise", ["estimates:write"]],
    [EstimatesController, "submit", ["estimates:write"]],
    [EstimatesController, "approve", ["estimates:approve"]],
    [EstimatesController, "createQuote", ["quotes:write", "estimates:read"]],
    [QuotesController, "revise", ["quotes:write"]],
    [QuotesController, "approve", ["quotes:approve"]],
    [QuotesController, "send", ["quotes:send"]],
    [QuotesController, "withdraw", ["quotes:withdraw"]],
    [QuotesController, "expire", ["quotes:withdraw"]],
  ] as const)("requires explicit permissions for %s.%s", (controller, method, expected) => {
    const handler = (controller.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });

  it("keeps capability-authenticated customer Quote actions public", () => {
    expect(Reflect.getMetadata(PUBLIC_ROUTE, PublicQuotesController)).toBe(true);
  });
});
