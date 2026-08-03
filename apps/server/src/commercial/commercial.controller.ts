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
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";

import { PublicRoute } from "../auth/public.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  AcceptQuoteDto,
  AcceptQuoteResponseDto,
  CreateEstimateVersionDto,
  CreatePricingConfigurationDto,
  CreatePricingConfigurationResponseDto,
  DeclineQuoteDto,
  EstimateListResponseDto,
  EstimateVersionDto,
  PricingConfigurationListDto,
  PricingVersionDto,
  PublicQuoteDto,
  QuoteListResponseDto,
  QuoteVersionDto,
  SendQuoteDto,
  SendQuoteResponseDto,
} from "./commercial.dto.js";
import { EstimatesService } from "./estimates.service.js";
import { PricingService } from "./pricing.service.js";
import { QuotesService } from "./quotes.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@ApiTags("Pricing")
@Controller("pricing")
export class PricingController {
  public constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Get("configurations")
  @RequirePermissions("pricing:read")
  @ApiOperation({ operationId: "listPricingConfigurations" })
  @ApiOkResponse({ type: PricingConfigurationListDto })
  public listConfigurations(): Promise<PricingConfigurationListDto> {
    return this.pricing.listConfigurations();
  }

  @Post("configurations")
  @RequirePermissions("pricing:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreatePricingConfigurationDto })
  @ApiOperation({ operationId: "createPricingConfiguration" })
  @ApiCreatedResponse({ type: CreatePricingConfigurationResponseDto })
  public createConfiguration(
    @Body() body: CreatePricingConfigurationDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<CreatePricingConfigurationResponseDto> {
    return this.pricing.createConfiguration(body, requireIdempotencyKey(idempotencyKey));
  }

  @Post("versions/:id/actions/activate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("pricing:approve")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "activatePricingVersion" })
  @ApiOkResponse({ type: PricingVersionDto })
  public activateVersion(
    @Param("id", uuidPipe) pricingVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<PricingVersionDto> {
    return this.pricing.activateVersion(pricingVersionId, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags("Estimates")
@Controller()
export class EstimatesController {
  public constructor(
    @Inject(EstimatesService) private readonly estimates: EstimatesService,
    @Inject(QuotesService) private readonly quotes: QuotesService,
  ) {}

  @Get("estimates")
  @RequirePermissions("estimates:read")
  @ApiOperation({ operationId: "listEstimates" })
  @ApiOkResponse({ type: EstimateListResponseDto })
  public list(): Promise<EstimateListResponseDto> {
    return this.estimates.list();
  }

  @Get("estimate-versions/:id")
  @RequirePermissions("estimates:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getEstimateVersion" })
  @ApiOkResponse({ type: EstimateVersionDto })
  public getVersion(@Param("id", uuidPipe) estimateVersionId: string): Promise<EstimateVersionDto> {
    return this.estimates.getVersion(estimateVersionId);
  }

  @Post("leads/:id/estimate-versions")
  @RequirePermissions("estimates:write", "leads:read")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateEstimateVersionDto })
  @ApiOperation({ operationId: "createEstimateVersionForLead" })
  @ApiCreatedResponse({ type: EstimateVersionDto })
  public createForLead(
    @Param("id", uuidPipe) leadId: string,
    @Body() body: CreateEstimateVersionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<EstimateVersionDto> {
    return this.estimates.createForLead(leadId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post("estimates/:id/actions/revise")
  @RequirePermissions("estimates:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateEstimateVersionDto })
  @ApiOperation({ operationId: "reviseEstimate" })
  @ApiCreatedResponse({ type: EstimateVersionDto })
  public revise(
    @Param("id", uuidPipe) estimateId: string,
    @Body() body: CreateEstimateVersionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<EstimateVersionDto> {
    return this.estimates.revise(estimateId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post("estimate-versions/:id/actions/submit")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("estimates:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "submitEstimateVersion" })
  @ApiOkResponse({ type: EstimateVersionDto })
  public submit(
    @Param("id", uuidPipe) estimateVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<EstimateVersionDto> {
    return this.estimates.submit(estimateVersionId, requireIdempotencyKey(idempotencyKey));
  }

  @Post("estimate-versions/:id/actions/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("estimates:approve")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "approveEstimateVersion" })
  @ApiOkResponse({ type: EstimateVersionDto })
  public approve(
    @Param("id", uuidPipe) estimateVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<EstimateVersionDto> {
    return this.estimates.approve(estimateVersionId, requireIdempotencyKey(idempotencyKey));
  }

  @Post("estimate-versions/:id/actions/create-quote")
  @RequirePermissions("quotes:write", "estimates:read")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "createQuoteFromEstimateVersion" })
  @ApiCreatedResponse({ type: QuoteVersionDto })
  public createQuote(
    @Param("id", uuidPipe) estimateVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<QuoteVersionDto> {
    return this.quotes.createFromEstimate(estimateVersionId, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags("Quotes")
@Controller()
export class QuotesController {
  public constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  @Get("quotes")
  @RequirePermissions("quotes:read")
  @ApiOperation({ operationId: "listQuotes" })
  @ApiOkResponse({ type: QuoteListResponseDto })
  public list(): Promise<QuoteListResponseDto> {
    return this.quotes.list();
  }

  @Get("quotes/:id")
  @RequirePermissions("quotes:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getQuote" })
  @ApiOkResponse({ type: QuoteVersionDto })
  public get(@Param("id", uuidPipe) quoteId: string): Promise<QuoteVersionDto> {
    return this.quotes.get(quoteId);
  }

  @Post("quotes/:id/actions/revise")
  @RequirePermissions("quotes:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "reviseQuote" })
  @ApiCreatedResponse({ type: QuoteVersionDto })
  public revise(
    @Param("id", uuidPipe) quoteId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<QuoteVersionDto> {
    return this.quotes.revise(quoteId, requireIdempotencyKey(idempotencyKey));
  }

  @Post("quote-versions/:id/actions/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("quotes:approve")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "approveQuoteVersion" })
  @ApiOkResponse({ type: QuoteVersionDto })
  public approve(
    @Param("id", uuidPipe) quoteVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<QuoteVersionDto> {
    return this.quotes.approve(quoteVersionId, requireIdempotencyKey(idempotencyKey));
  }

  @Post("quote-versions/:id/actions/send")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("quotes:send")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SendQuoteDto })
  @ApiOperation({ operationId: "sendQuoteVersion" })
  @ApiOkResponse({ type: SendQuoteResponseDto })
  public send(
    @Param("id", uuidPipe) quoteVersionId: string,
    @Body() body: SendQuoteDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<SendQuoteResponseDto> {
    return this.quotes.send(quoteVersionId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post("quote-versions/:id/actions/withdraw")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("quotes:withdraw")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "withdrawQuoteVersion" })
  @ApiOkResponse({ type: QuoteVersionDto })
  public withdraw(
    @Param("id", uuidPipe) quoteVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<QuoteVersionDto> {
    return this.quotes.withdraw(quoteVersionId, requireIdempotencyKey(idempotencyKey));
  }

  @Post("quote-versions/:id/actions/expire")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("quotes:withdraw")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "expireQuoteVersion" })
  @ApiOkResponse({ type: QuoteVersionDto })
  public expire(
    @Param("id", uuidPipe) quoteVersionId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<QuoteVersionDto> {
    return this.quotes.expire(quoteVersionId, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags("Public quotes")
@PublicRoute()
@Controller("public/quotes")
export class PublicQuotesController {
  public constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}

  @Get(":token")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "getPublicQuote" })
  @ApiOkResponse({ type: PublicQuoteDto })
  public get(@Param("token") token: string): Promise<PublicQuoteDto> {
    return this.quotes.resolvePublic(token);
  }

  @Post(":token/actions/accept")
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: "token", type: String })
  @ApiBody({ type: AcceptQuoteDto })
  @ApiOperation({ operationId: "acceptPublicQuote" })
  @ApiOkResponse({ type: AcceptQuoteResponseDto })
  public accept(
    @Param("token") token: string,
    @Body() body: AcceptQuoteDto,
    @Req() request: FastifyRequest,
  ): Promise<AcceptQuoteResponseDto> {
    const userAgent = request.headers["user-agent"];
    return this.quotes.acceptPublic(token, body, {
      ipAddress: firstForwardedIp(request.headers["x-forwarded-for"]) ?? request.ip,
      ...(userAgent ? { userAgent } : {}),
    });
  }

  @Post(":token/actions/decline")
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: "token", type: String })
  @ApiBody({ type: DeclineQuoteDto })
  @ApiOperation({ operationId: "declinePublicQuote" })
  @ApiOkResponse({ type: PublicQuoteDto })
  public decline(
    @Param("token") token: string,
    @Body() body: DeclineQuoteDto,
  ): Promise<PublicQuoteDto> {
    return this.quotes.declinePublic(token, body);
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  }
  return key;
}

function firstForwardedIp(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(",")[0]?.trim();
  return first === "" ? undefined : first;
}
