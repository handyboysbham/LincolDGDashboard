import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { RequestContextService } from "../context/request-context.service.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { SessionDto } from "./session.dto.js";

@ApiTags("Identity")
@Controller("session")
export class SessionController {
  public constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
  ) {}

  @Get()
  @RequirePermissions("session:read")
  @ApiOperation({ operationId: "getCurrentSession" })
  @ApiOkResponse({ type: SessionDto })
  public current(): SessionDto {
    const actor = this.context.actor();
    return {
      permissions: [...actor.permissions].toSorted(),
      tenantId: actor.tenantId,
      userId: actor.userId,
    };
  }
}
