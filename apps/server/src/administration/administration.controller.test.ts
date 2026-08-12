import { describe, expect, it } from "vitest";

import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import { AdministrationController } from "./administration.controller.js";

describe("administration controller authorization", () => {
  it.each([
    ["workspace", ["administration:read"]],
    ["search", ["administration:read"]],
    ["auditEvents", ["administration:read"]],
    ["createPaymentAccount", ["administration:manage"]],
    ["transitionPaymentAccount", ["administration:manage"]],
    ["createChecklistTemplate", ["administration:manage"]],
    ["publishChecklistTemplate", ["administration:manage"]],
    ["transitionUser", ["administration:manage"]],
    ["changeUserRole", ["administration:manage"]],
    ["createSupplier", ["administration:manage"]],
    ["createSupplierFacility", ["administration:manage"]],
  ] as const)("requires explicit permissions for %s", (method, expected) => {
    const handler = (AdministrationController.prototype as unknown as Record<string, unknown>)[
      method
    ];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });
});
