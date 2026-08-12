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
  AdministrationAuditEventListDto,
  AdministrationSearchDto,
  AdministrationSupplierDto,
  AdministrationUserDto,
  AdministrationWorkspaceDto,
  AssignUserRoleDto,
  ChecklistTemplateDto,
  CompanyPaymentAccountDto,
  CreateChecklistTemplateDto,
  CreateCompanyPaymentAccountDto,
  CreateSupplierDto,
  CreateSupplierFacilityDto,
  LinkUserIdentityDto,
} from "./administration.dto.js";
import { AdministrationService } from "./administration.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@ApiTags("Administration")
@Controller("administration")
export class AdministrationController {
  public constructor(
    @Inject(AdministrationService) private readonly administration: AdministrationService,
  ) {}

  @Get()
  @RequirePermissions("administration:read")
  @ApiOperation({ operationId: "getAdministrationWorkspace" })
  @ApiOkResponse({ type: AdministrationWorkspaceDto })
  public workspace(): Promise<AdministrationWorkspaceDto> {
    return this.administration.workspace();
  }

  @Get("search")
  @RequirePermissions("administration:read")
  @ApiQuery({ name: "q", required: true, type: String })
  @ApiOperation({ operationId: "searchAdministrationRecords" })
  @ApiOkResponse({ type: AdministrationSearchDto })
  public search(@Query("q") query = ""): Promise<AdministrationSearchDto> {
    return this.administration.search(query);
  }

  @Get("audit-events")
  @RequirePermissions("administration:read")
  @ApiQuery({ name: "entityType", required: false, type: String })
  @ApiQuery({ name: "eventType", required: false, type: String })
  @ApiQuery({ maximum: 100, minimum: 1, name: "limit", required: false, type: Number })
  @ApiOperation({ operationId: "listAdministrationAuditEvents" })
  @ApiOkResponse({ type: AdministrationAuditEventListDto })
  public auditEvents(
    @Query("entityType") entityType?: string,
    @Query("eventType") eventType?: string,
    @Query("limit") limit?: string,
  ): Promise<AdministrationAuditEventListDto> {
    return this.administration.listAuditEvents({
      ...(entityType ? { entityType } : {}),
      ...(eventType ? { eventType } : {}),
      ...(limit ? { limit: parseLimit(limit) } : {}),
    });
  }

  @Post("payment-accounts")
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateCompanyPaymentAccountDto })
  @ApiOperation({ operationId: "createCompanyPaymentAccount" })
  @ApiCreatedResponse({ type: CompanyPaymentAccountDto })
  public createPaymentAccount(
    @Body() body: CreateCompanyPaymentAccountDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CompanyPaymentAccountDto> {
    return this.administration.createPaymentAccount(body, requireIdempotencyKey(key));
  }

  @Post("payment-accounts/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiParam({ enum: ["activate", "deactivate"], name: "action" })
  @ApiOperation({ operationId: "transitionCompanyPaymentAccount" })
  @ApiOkResponse({ type: CompanyPaymentAccountDto })
  public transitionPaymentAccount(
    @Param("id", uuidPipe) accountId: string,
    @Param("action") rawAction: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<CompanyPaymentAccountDto> {
    const action = requireAction(rawAction, ["activate", "deactivate"] as const);
    return this.administration.transitionPaymentAccount(
      accountId,
      action,
      requireIdempotencyKey(key),
    );
  }

  @Post("checklist-templates")
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateChecklistTemplateDto })
  @ApiOperation({ operationId: "createChecklistTemplate" })
  @ApiCreatedResponse({ type: ChecklistTemplateDto })
  public createChecklistTemplate(
    @Body() body: CreateChecklistTemplateDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ChecklistTemplateDto> {
    return this.administration.createChecklistTemplate(body, requireIdempotencyKey(key));
  }

  @Post("checklist-templates/:id/actions/publish")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiOperation({ operationId: "publishChecklistTemplate" })
  @ApiOkResponse({ type: ChecklistTemplateDto })
  public publishChecklistTemplate(
    @Param("id", uuidPipe) templateId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ChecklistTemplateDto> {
    return this.administration.publishChecklistTemplate(templateId, requireIdempotencyKey(key));
  }

  @Post("users/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiParam({ enum: ["activate", "deactivate"], name: "action" })
  @ApiOperation({ operationId: "transitionAdministrationUser" })
  @ApiOkResponse({ type: AdministrationUserDto })
  public transitionUser(
    @Param("id", uuidPipe) userId: string,
    @Param("action") rawAction: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AdministrationUserDto> {
    const action = requireAction(rawAction, ["activate", "deactivate"] as const);
    return this.administration.transitionUser(userId, action, requireIdempotencyKey(key));
  }

  @Post("users/:id/identity")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiBody({ type: LinkUserIdentityDto })
  @ApiOperation({ operationId: "linkAdministrationUserIdentity" })
  @ApiOkResponse({ type: AdministrationUserDto })
  public linkUserIdentity(
    @Param("id", uuidPipe) userId: string,
    @Body() body: LinkUserIdentityDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AdministrationUserDto> {
    return this.administration.linkUserIdentity(userId, body, requireIdempotencyKey(key));
  }

  @Post("users/:id/roles/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiParam({ enum: ["assign", "revoke"], name: "action" })
  @ApiBody({ type: AssignUserRoleDto })
  @ApiOperation({ operationId: "changeAdministrationUserRole" })
  @ApiOkResponse({ type: AdministrationUserDto })
  public changeUserRole(
    @Param("id", uuidPipe) userId: string,
    @Param("action") rawAction: string,
    @Body() body: AssignUserRoleDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AdministrationUserDto> {
    const action = requireAction(rawAction, ["assign", "revoke"] as const);
    return this.administration.changeUserRole(userId, body, action, requireIdempotencyKey(key));
  }

  @Post("suppliers")
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateSupplierDto })
  @ApiOperation({ operationId: "createAdministrationSupplier" })
  @ApiCreatedResponse({ type: AdministrationSupplierDto })
  public createSupplier(
    @Body() body: CreateSupplierDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AdministrationSupplierDto> {
    return this.administration.createSupplier(body, requireIdempotencyKey(key));
  }

  @Post("suppliers/:id/facilities")
  @RequirePermissions("administration:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id" })
  @ApiBody({ type: CreateSupplierFacilityDto })
  @ApiOperation({ operationId: "createAdministrationSupplierFacility" })
  @ApiCreatedResponse({ type: AdministrationSupplierDto })
  public createSupplierFacility(
    @Param("id", uuidPipe) supplierId: string,
    @Body() body: CreateSupplierFacilityDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AdministrationSupplierDto> {
    return this.administration.createSupplierFacility(supplierId, body, requireIdempotencyKey(key));
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (!value?.trim()) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key header is required",
    );
  }
  return value.trim();
}

function requireAction<const T extends readonly string[]>(value: string, allowed: T): T[number] {
  if (allowed.includes(value)) return value;
  throw new ApiException(HttpStatus.NOT_FOUND, "ACTION_NOT_FOUND", "Action was not found");
}

function parseLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "LIMIT_INVALID",
      "Limit must be an integer from 1 through 100",
    );
  }
  return parsed;
}
