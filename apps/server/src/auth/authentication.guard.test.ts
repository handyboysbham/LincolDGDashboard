import { type ExecutionContext, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import type { ServerConfigService } from "../config/server-config.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import type { AuthenticatedActorService } from "./authenticated-actor.service.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import type { JwtVerifierService } from "./jwt-verifier.service.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000201";

describe("AuthenticationGuard", () => {
  it("requires a bearer token in JWT mode", async () => {
    const { context, guard } = fixture();
    await context.run("test", async () => {
      await expect(guard.canActivate(executionContext({}))).rejects.toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
        status: HttpStatus.UNAUTHORIZED,
      });
    });
  });

  it("verifies identity then loads current permissions from the database", async () => {
    const { context, guard, load, verify } = fixture();
    await context.run("test", async () => {
      await expect(
        guard.canActivate(executionContext({ authorization: "Bearer signed-token" })),
      ).resolves.toBe(true);
      expect(verify).toHaveBeenCalledWith("signed-token");
      expect(load).toHaveBeenCalledWith(tenantId, "auth-subject");
      expect(context.actor()).toEqual({
        permissions: new Set(["session:read"]),
        tenantId,
        userId,
      });
    });
  });

  it("does not permit a request header to select tenant context", async () => {
    const { context, guard } = fixture();
    await context.run("test", async () => {
      await expect(
        guard.canActivate(
          executionContext({ authorization: "Bearer signed-token", "x-tenant-id": tenantId }),
        ),
      ).rejects.toMatchObject({ code: "TENANT_HEADER_FORBIDDEN" });
    });
  });

  it("maps token verification failures to a stable response", async () => {
    const { context, guard, verify } = fixture();
    verify.mockRejectedValue(new Error("signature mismatch"));
    await context.run("test", async () => {
      await expect(
        guard.canActivate(executionContext({ authorization: "Bearer bad-token" })),
      ).rejects.toMatchObject({ code: "AUTHENTICATION_INVALID" });
    });
  });
});

function fixture() {
  const context = new RequestContextService();
  const verify = vi.fn().mockResolvedValue({ externalSubject: "auth-subject", tenantId });
  const verifier = {
    verify,
  } as unknown as JwtVerifierService;
  const load = vi.fn().mockResolvedValue({
    permissions: new Set(["session:read"]),
    tenantId,
    userId,
  });
  const actors = {
    load,
  } as unknown as AuthenticatedActorService;
  const configuration = {
    value: {
      auth: {
        audience: "authenticated",
        issuer: "https://example.supabase.co/auth/v1",
        jwksUrl: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
        mode: "jwt",
      },
    },
  } as ServerConfigService;
  const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
  return {
    context,
    guard: new AuthenticationGuard(configuration, context, reflector, verifier, actors),
    load,
    verify,
  };
}

function executionContext(headers: Record<string, string>): ExecutionContext {
  return {
    getClass: () => AuthenticationGuard,
    getHandler: () => (): undefined => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}
