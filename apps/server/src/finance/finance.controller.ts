import {
  Body,
  Controller,
  Get,
  Header,
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
import { PublicRoute } from "../auth/public.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  CreateInvoiceAdjustmentDto,
  CreateInvoiceDto,
  CreateInvoicePublicLinkDto,
  InvoiceCorrectionReasonDto,
  InvoiceDto,
  InvoiceListResponseDto,
  InvoicePublicLinkDto,
  PublicInvoiceDto,
  RecordInvoiceDeliveryDto,
  ReplaceInvoiceDto,
} from "./finance.dto.js";
import { InvoicesService } from "./invoices.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });
const optionalUuidPipe = new ParseUUIDPipe({ optional: true, version: "4" });

@ApiTags("Finance")
@Controller()
export class InvoicesController {
  public constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Get("invoices")
  @RequirePermissions("finance:read")
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ format: "uuid", name: "projectId", required: false, type: String })
  @ApiOperation({ operationId: "listInvoices" })
  @ApiOkResponse({ type: InvoiceListResponseDto })
  public list(
    @Query("status") status?: string,
    @Query("projectId", optionalUuidPipe) projectId?: string,
  ): Promise<InvoiceListResponseDto> {
    return this.invoices.list(status, projectId);
  }

  @Get("invoices/:id")
  @RequirePermissions("finance:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getInvoice" })
  @ApiOkResponse({ type: InvoiceDto })
  public get(@Param("id", uuidPipe) invoiceId: string): Promise<InvoiceDto> {
    return this.invoices.get(invoiceId);
  }

  @Post("projects/:id/invoices")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateInvoiceDto })
  @ApiOperation({ operationId: "createProjectInvoice" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public create(
    @Param("id", uuidPipe) projectId: string,
    @Body() body: CreateInvoiceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.create(projectId, body, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/actions/revise")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "reviseInvoice" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public revise(
    @Param("id", uuidPipe) invoiceId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.revise(invoiceId, requireIdempotencyKey(key));
  }

  @Post("invoice-versions/:id/actions/prepare")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "prepareInvoiceVersion" })
  @ApiOkResponse({ type: InvoiceDto })
  public prepare(
    @Param("id", uuidPipe) invoiceVersionId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.prepare(invoiceVersionId, requireIdempotencyKey(key));
  }

  @Post("invoice-versions/:id/actions/post")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "postInvoiceVersion" })
  @ApiOkResponse({ type: InvoiceDto })
  public post(
    @Param("id", uuidPipe) invoiceVersionId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.post(invoiceVersionId, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/deliveries")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RecordInvoiceDeliveryDto })
  @ApiOperation({ operationId: "recordInvoiceDelivery" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public recordDelivery(
    @Param("id", uuidPipe) invoiceId: string,
    @Body() body: RecordInvoiceDeliveryDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.recordDelivery(invoiceId, body, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/public-links")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateInvoicePublicLinkDto })
  @ApiOperation({ operationId: "createInvoicePublicLink" })
  @ApiCreatedResponse({ type: InvoicePublicLinkDto })
  @Header("Cache-Control", "no-store")
  public createPublicLink(
    @Param("id", uuidPipe) invoiceId: string,
    @Body() body: CreateInvoicePublicLinkDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoicePublicLinkDto> {
    return this.invoices.createPublicLink(invoiceId, body, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/public-links/:linkId/actions/revoke")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiParam({ format: "uuid", name: "linkId", type: String })
  @ApiOperation({ operationId: "revokeInvoicePublicLink" })
  @ApiOkResponse({ type: InvoiceDto })
  public revokePublicLink(
    @Param("id", uuidPipe) invoiceId: string,
    @Param("linkId", uuidPipe) linkId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.revokePublicLink(invoiceId, linkId, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/adjustments")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateInvoiceAdjustmentDto })
  @ApiOperation({ operationId: "createInvoiceAdjustment" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public createAdjustment(
    @Param("id", uuidPipe) invoiceId: string,
    @Body() body: CreateInvoiceAdjustmentDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.createAdjustment(invoiceId, body, requireIdempotencyKey(key));
  }

  @Post("invoice-adjustments/:id/actions/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "approveInvoiceAdjustment" })
  @ApiOkResponse({ type: InvoiceDto })
  public approveAdjustment(
    @Param("id", uuidPipe) adjustmentId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.approveAdjustment(adjustmentId, requireIdempotencyKey(key));
  }

  @Post("invoice-adjustments/:id/actions/post")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "postInvoiceAdjustment" })
  @ApiOkResponse({ type: InvoiceDto })
  public postAdjustment(
    @Param("id", uuidPipe) adjustmentId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.postAdjustment(adjustmentId, requireIdempotencyKey(key));
  }

  @Post("invoice-adjustments/:id/actions/reverse")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: InvoiceCorrectionReasonDto })
  @ApiOperation({ operationId: "reverseInvoiceAdjustment" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public reverseAdjustment(
    @Param("id", uuidPipe) adjustmentId: string,
    @Body() body: InvoiceCorrectionReasonDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.reverseAdjustment(adjustmentId, body, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/actions/void")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: InvoiceCorrectionReasonDto })
  @ApiOperation({ operationId: "voidInvoice" })
  @ApiOkResponse({ type: InvoiceDto })
  public voidInvoice(
    @Param("id", uuidPipe) invoiceId: string,
    @Body() body: InvoiceCorrectionReasonDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.voidInvoice(invoiceId, body, requireIdempotencyKey(key));
  }

  @Post("invoices/:id/actions/replace")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ReplaceInvoiceDto })
  @ApiOperation({ operationId: "replaceInvoice" })
  @ApiCreatedResponse({ type: InvoiceDto })
  public replaceInvoice(
    @Param("id", uuidPipe) invoiceId: string,
    @Body() body: ReplaceInvoiceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceDto> {
    return this.invoices.replaceInvoice(invoiceId, body, requireIdempotencyKey(key));
  }
}

@ApiTags("Public Invoices")
@PublicRoute()
@Controller("public/invoices")
export class PublicInvoicesController {
  public constructor(@Inject(InvoicesService) private readonly invoices: InvoicesService) {}

  @Get(":token")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "getPublicInvoice" })
  @ApiOkResponse({ type: PublicInvoiceDto })
  @Header("Cache-Control", "no-store")
  public get(@Param("token") token: string): Promise<PublicInvoiceDto> {
    return this.invoices.resolvePublic(token);
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
