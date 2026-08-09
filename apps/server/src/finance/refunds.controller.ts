import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";

import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  ApproveRefundDto,
  CreateRefundDto,
  FinancialReversalDto,
  ProcessRefundDto,
  RefundDto,
  RefundListResponseDto,
} from "./payments.dto.js";
import { RefundsService } from "./refunds.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });
const optionalUuidPipe = new ParseUUIDPipe({ optional: true, version: "4" });

@ApiTags("Finance")
@Controller()
export class RefundsController {
  public constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get("refunds")
  @RequirePermissions("finance:read")
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ format: "uuid", name: "projectId", required: false, type: String })
  @ApiOperation({ operationId: "listRefunds" })
  @ApiOkResponse({ type: RefundListResponseDto })
  public list(
    @Query("status") status?: string,
    @Query("projectId", optionalUuidPipe) projectId?: string,
  ): Promise<RefundListResponseDto> {
    return this.refunds.list(status, projectId);
  }

  @Get("refunds/:id")
  @RequirePermissions("finance:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getRefund" })
  @ApiOkResponse({ type: RefundDto })
  public get(@Param("id", uuidPipe) refundId: string): Promise<RefundDto> {
    return this.refunds.get(refundId);
  }

  @Post("customers/:id/refunds")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRefundDto })
  @ApiOperation({ operationId: "createRefund" })
  @ApiCreatedResponse({ type: RefundDto })
  public create(
    @Param("id", uuidPipe) customerAccountId: string,
    @Body() body: CreateRefundDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.create(customerAccountId, body, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ApproveRefundDto })
  @ApiOperation({ operationId: "approveRefund" })
  @ApiOkResponse({ type: RefundDto })
  public approve(
    @Param("id", uuidPipe) refundId: string,
    @Body() body: ApproveRefundDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.approve(refundId, body, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/process")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ProcessRefundDto })
  @ApiOperation({ operationId: "processRefund" })
  @ApiOkResponse({ type: RefundDto })
  public process(
    @Param("id", uuidPipe) refundId: string,
    @Body() body: ProcessRefundDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.process(refundId, body, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/settle")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "settleRefund" })
  @ApiOkResponse({ type: RefundDto })
  public settle(
    @Param("id", uuidPipe) refundId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.settle(refundId, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/fail")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "failRefund" })
  @ApiOkResponse({ type: RefundDto })
  public fail(
    @Param("id", uuidPipe) refundId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.fail(refundId, body, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "cancelRefund" })
  @ApiOkResponse({ type: RefundDto })
  public cancel(
    @Param("id", uuidPipe) refundId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.cancel(refundId, body, requireIdempotencyKey(key));
  }

  @Post("refunds/:id/actions/reverse")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "reverseRefund" })
  @ApiCreatedResponse({ type: RefundDto })
  public reverse(
    @Param("id", uuidPipe) refundId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RefundDto> {
    return this.refunds.reverse(refundId, body, requireIdempotencyKey(key));
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
