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
  ApplyValueDto,
  CreateCustomerCreditDto,
  CreateDepositBalanceDto,
  CreatePaymentDto,
  CustomerCreditDto,
  CustomerCreditListResponseDto,
  DepositBalanceDto,
  DepositBalanceListResponseDto,
  FinancialReversalDto,
  PaymentDto,
  PaymentListResponseDto,
} from "./payments.dto.js";
import { PaymentsService } from "./payments.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });
const optionalUuidPipe = new ParseUUIDPipe({ optional: true, version: "4" });

@ApiTags("Finance")
@Controller()
export class PaymentsController {
  public constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get("payments")
  @RequirePermissions("finance:read")
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ format: "uuid", name: "projectId", required: false, type: String })
  @ApiOperation({ operationId: "listPayments" })
  @ApiOkResponse({ type: PaymentListResponseDto })
  public listPayments(
    @Query("status") status?: string,
    @Query("projectId", optionalUuidPipe) projectId?: string,
  ): Promise<PaymentListResponseDto> {
    return this.payments.listPayments(status, projectId);
  }

  @Get("payments/:id")
  @RequirePermissions("finance:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getPayment" })
  @ApiOkResponse({ type: PaymentDto })
  public getPayment(@Param("id", uuidPipe) paymentId: string): Promise<PaymentDto> {
    return this.payments.getPayment(paymentId);
  }

  @Post("projects/:id/payments")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreatePaymentDto })
  @ApiOperation({ operationId: "createProjectPayment" })
  @ApiCreatedResponse({ type: PaymentDto })
  public createProjectPayment(
    @Param("id", uuidPipe) projectId: string,
    @Body() body: CreatePaymentDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.createProjectPayment(projectId, body, requireIdempotencyKey(key));
  }

  @Post("customers/:id/payments")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreatePaymentDto })
  @ApiOperation({ operationId: "createCustomerPayment" })
  @ApiCreatedResponse({ type: PaymentDto })
  public createCustomerPayment(
    @Param("id", uuidPipe) customerAccountId: string,
    @Body() body: CreatePaymentDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.createCustomerPayment(customerAccountId, body, requireIdempotencyKey(key));
  }

  @Post("payments/:id/actions/verify")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "verifyPayment" })
  @ApiOkResponse({ type: PaymentDto })
  public verifyPayment(
    @Param("id", uuidPipe) paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.verifyPayment(paymentId, requireIdempotencyKey(key));
  }

  @Post("payments/:id/actions/settle")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "settlePayment" })
  @ApiOkResponse({ type: PaymentDto })
  public settlePayment(
    @Param("id", uuidPipe) paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.settlePayment(paymentId, requireIdempotencyKey(key));
  }

  @Post("payments/:id/actions/reverse")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "reversePayment" })
  @ApiOkResponse({ type: PaymentDto })
  public reversePayment(
    @Param("id", uuidPipe) paymentId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.reversePayment(paymentId, body, requireIdempotencyKey(key));
  }

  @Post("payments/:id/allocations")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ApplyValueDto })
  @ApiOperation({ operationId: "allocatePayment" })
  @ApiCreatedResponse({ type: PaymentDto })
  public allocatePayment(
    @Param("id", uuidPipe) paymentId: string,
    @Body() body: ApplyValueDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.allocatePayment(paymentId, body, requireIdempotencyKey(key));
  }

  @Post("payment-allocations/:id/actions/reverse")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "reversePaymentAllocation" })
  @ApiCreatedResponse({ type: PaymentDto })
  public reversePaymentAllocation(
    @Param("id", uuidPipe) allocationId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<PaymentDto> {
    return this.payments.reversePaymentAllocation(allocationId, body, requireIdempotencyKey(key));
  }

  @Post("payment-allocations/:id/actions/create-deposit-balance")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateDepositBalanceDto })
  @ApiOperation({ operationId: "createDepositBalance" })
  @ApiCreatedResponse({ type: DepositBalanceDto })
  public createDepositBalance(
    @Param("id", uuidPipe) allocationId: string,
    @Body() body: CreateDepositBalanceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DepositBalanceDto> {
    return this.payments.createDepositBalance(allocationId, body, requireIdempotencyKey(key));
  }

  @Get("projects/:id/deposit-balances")
  @RequirePermissions("finance:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "listProjectDepositBalances" })
  @ApiOkResponse({ type: DepositBalanceListResponseDto })
  public listDepositBalances(
    @Param("id", uuidPipe) projectId: string,
  ): Promise<DepositBalanceListResponseDto> {
    return this.payments.listDepositBalances(projectId);
  }

  @Post("deposit-balances/:id/applications")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ApplyValueDto })
  @ApiOperation({ operationId: "applyDepositBalance" })
  @ApiCreatedResponse({ type: DepositBalanceDto })
  public applyDeposit(
    @Param("id", uuidPipe) depositBalanceId: string,
    @Body() body: ApplyValueDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DepositBalanceDto> {
    return this.payments.applyDeposit(depositBalanceId, body, requireIdempotencyKey(key));
  }

  @Post("deposit-applications/:id/actions/reverse")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "reverseDepositApplication" })
  @ApiCreatedResponse({ type: DepositBalanceDto })
  public reverseDepositApplication(
    @Param("id", uuidPipe) applicationId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DepositBalanceDto> {
    return this.payments.reverseDepositApplication(applicationId, body, requireIdempotencyKey(key));
  }

  @Get("customers/:id/customer-credits")
  @RequirePermissions("finance:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "listCustomerCredits" })
  @ApiOkResponse({ type: CustomerCreditListResponseDto })
  public listCustomerCredits(
    @Param("id", uuidPipe) customerAccountId: string,
  ): Promise<CustomerCreditListResponseDto> {
    return this.payments.listCustomerCredits(customerAccountId);
  }

  @Post("customers/:id/customer-credits")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateCustomerCreditDto })
  @ApiOperation({ operationId: "createCustomerCredit" })
  @ApiCreatedResponse({ type: CustomerCreditDto })
  public createCustomerCredit(
    @Param("id", uuidPipe) customerAccountId: string,
    @Body() body: CreateCustomerCreditDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CustomerCreditDto> {
    return this.payments.createCustomerCredit(customerAccountId, body, requireIdempotencyKey(key));
  }

  @Post("customer-credits/:id/applications")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ApplyValueDto })
  @ApiOperation({ operationId: "applyCustomerCredit" })
  @ApiCreatedResponse({ type: CustomerCreditDto })
  public applyCustomerCredit(
    @Param("id", uuidPipe) customerCreditId: string,
    @Body() body: ApplyValueDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CustomerCreditDto> {
    return this.payments.applyCustomerCredit(customerCreditId, body, requireIdempotencyKey(key));
  }

  @Post("customer-credit-applications/:id/actions/reverse")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: FinancialReversalDto })
  @ApiOperation({ operationId: "reverseCustomerCreditApplication" })
  @ApiCreatedResponse({ type: CustomerCreditDto })
  public reverseCustomerCreditApplication(
    @Param("id", uuidPipe) applicationId: string,
    @Body() body: FinancialReversalDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CustomerCreditDto> {
    return this.payments.reverseCustomerCreditApplication(
      applicationId,
      body,
      requireIdempotencyKey(key),
    );
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
