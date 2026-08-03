import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RequestContextService } from "../context/request-context.service.js";
import { ApiException } from "../errors/api.exception.js";
import { PUBLIC_ROUTE } from "./public.decorator.js";
import { REQUIRED_PERMISSIONS } from "./require-permissions.decorator.js";

@Injectable()
export class PermissionsGuard implements CanActivate {
  public constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public canActivate(executionContext: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const actor = this.context.actor();
    if (
      actor.permissions.has("*") ||
      required.every((permission) => actor.permissions.has(permission))
    ) {
      return true;
    }

    throw new ApiException(
      HttpStatus.FORBIDDEN,
      "PERMISSION_DENIED",
      "The authenticated user does not have the required permission",
    );
  }
}
