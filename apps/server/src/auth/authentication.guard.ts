import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

import { ServerConfigService } from "../config/server-config.service.js";
import { RequestContextService } from "../context/request-context.service.js";
import { ApiException } from "../errors/api.exception.js";
import { AuthenticatedActorService } from "./authenticated-actor.service.js";
import { JwtVerifierService } from "./jwt-verifier.service.js";
import { PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class AuthenticationGuard implements CanActivate {
  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtVerifierService) private readonly jwtVerifier: JwtVerifierService,
    @Inject(AuthenticatedActorService) private readonly actors: AuthenticatedActorService,
  ) {}

  public async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic) return true;

    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    if (request.headers["x-tenant-id"] !== undefined) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "TENANT_HEADER_FORBIDDEN",
        "Tenant context cannot be selected by request header",
      );
    }

    const auth = this.configuration.value.auth;
    if (auth.mode === "development") {
      this.context.setActor({
        permissions: new Set(auth.developmentPermissions),
        tenantId: auth.developmentTenantId,
        userId: auth.developmentUserId,
      });
      return true;
    }

    const token = bearerToken(request.headers.authorization);
    let identity: Awaited<ReturnType<JwtVerifierService["verify"]>>;
    try {
      identity = await this.jwtVerifier.verify(token);
    } catch {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTHENTICATION_INVALID",
        "The access token is invalid or expired",
      );
    }

    const actor = await this.actors.load(identity.tenantId, identity.externalSubject);
    this.context.setActor(actor);
    return true;
  }
}

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
  if (!match?.[1]) {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      "AUTHENTICATION_REQUIRED",
      "A bearer access token is required",
    );
  }
  return match[1];
}
