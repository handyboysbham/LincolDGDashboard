import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE } from "../auth/public.decorator.js";
import { REQUIRED_PERMISSIONS } from "../auth/require-permissions.decorator.js";
import {
  JobsController,
  ProjectsController,
  PublicContractsController,
  SchedulingController,
} from "./operations.controller.js";

describe("operations controller authorization", () => {
  it.each([
    [ProjectsController, "list", ["projects:read"]],
    [ProjectsController, "generateContract", ["operations:manage"]],
    [ProjectsController, "confirmDeposit", ["operations:manage"]],
    [ProjectsController, "transition", ["operations:manage"]],
    [ProjectsController, "signBusiness", ["operations:manage"]],
    [ProjectsController, "sendContract", ["operations:manage"]],
    [JobsController, "list", ["projects:read"]],
    [JobsController, "transition", ["operations:manage"]],
    [JobsController, "evaluate", ["operations:manage"]],
    [SchedulingController, "createAsset", ["scheduling:manage"]],
    [SchedulingController, "createBlock", ["scheduling:manage"]],
  ] as const)("requires explicit permissions for %s.%s", (controller, method, expected) => {
    const handler = (controller.prototype as unknown as Record<string, unknown>)[method];
    expect(handler).toBeTypeOf("function");
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS, handler as object)).toEqual(expected);
  });

  it("keeps capability-authenticated Contract actions public", () => {
    expect(Reflect.getMetadata(PUBLIC_ROUTE, PublicContractsController)).toBe(true);
  });
});
