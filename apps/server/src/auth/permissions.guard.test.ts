import { HttpStatus, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import { RequestContextService } from "../context/request-context.service.js";
import { ApiException } from "../errors/api.exception.js";
import { PermissionsGuard } from "./permissions.guard.js";

const executionContext = {
  getClass: () =>
    class TestController {
      public test(): undefined {
        return undefined;
      }
    },
  getHandler: () => (): void => undefined,
} as unknown as ExecutionContext;

describe("PermissionsGuard", () => {
  it("allows a required permission", () => {
    const context = new RequestContextService();
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === "ldg:required-permissions" ? ["session:read"] : false,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(context, reflector);

    context.run("test", () => {
      context.setActor({
        permissions: new Set(["session:read"]),
        tenantId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000201",
      });
      expect(guard.canActivate(executionContext)).toBe(true);
    });
  });

  it("rejects a missing permission with a stable error", () => {
    const context = new RequestContextService();
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === "ldg:required-permissions" ? ["finance:manage"] : false,
    } as unknown as Reflector;
    const guard = new PermissionsGuard(context, reflector);

    context.run("test", () => {
      context.setActor({
        permissions: new Set(["session:read"]),
        tenantId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000201",
      });

      try {
        guard.canActivate(executionContext);
        throw new Error("Expected permission denial");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiException);
        expect((error as ApiException).code).toBe("PERMISSION_DENIED");
        expect((error as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });
  });
});
