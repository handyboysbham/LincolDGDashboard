import { Controller, Get, Inject } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { PublicRoute } from "../auth/public.decorator.js";
import { ApiErrorResponseDto } from "../errors/api-error.dto.js";
import { HealthService } from "./health.service.js";
import { LiveHealthDto, ReadyHealthDto } from "./health.dto.js";

@ApiTags("Health")
@PublicRoute()
@Controller("health")
export class HealthController {
  public constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  @ApiOperation({ operationId: "getLiveHealth" })
  @ApiOkResponse({ type: LiveHealthDto })
  public live(): LiveHealthDto {
    return this.health.live();
  }

  @Get("ready")
  @ApiOperation({ operationId: "getReadyHealth" })
  @ApiOkResponse({ type: ReadyHealthDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  public ready(): Promise<ReadyHealthDto> {
    return this.health.ready();
  }
}
