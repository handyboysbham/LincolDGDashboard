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
import { PUBLIC_ROUTE } from "./public.decorator.js";

@Injectable()
export class DevelopmentAuthGuard implements CanActivate {
  public constructor(
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public canActivate(executionContext: ExecutionContext): boolean {
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
    this.context.setActor({
      permissions: new Set(auth.developmentPermissions),
      tenantId: auth.developmentTenantId,
      userId: auth.developmentUserId,
    });
    return true;
  }
}
