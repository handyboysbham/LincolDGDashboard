import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import { FinancialCompletionDto } from "./financial-completion.dto.js";
import { FinancialCompletionService } from "./financial-completion.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@ApiTags("Finance")
@Controller()
export class FinancialCompletionController {
  public constructor(
    @Inject(FinancialCompletionService)
    private readonly financialCompletion: FinancialCompletionService,
  ) {}

  @Post("projects/:id/actions/evaluate-financial-completion")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "evaluateProjectFinancialCompletion" })
  @ApiOkResponse({ type: FinancialCompletionDto })
  public evaluateProject(
    @Param("id", uuidPipe) projectId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<FinancialCompletionDto> {
    return this.financialCompletion.evaluateProject(projectId, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/actions/evaluate-financial-completion")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "evaluateJobFinancialCompletion" })
  @ApiOkResponse({ type: FinancialCompletionDto })
  public evaluateJob(
    @Param("id", uuidPipe) jobId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<FinancialCompletionDto> {
    return this.financialCompletion.evaluateJob(jobId, requireIdempotencyKey(key));
  }
}

function requireIdempotencyKey(key: string | undefined): string {
  if (!key?.trim()) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key header is required",
    );
  }
  return key.trim();
}
