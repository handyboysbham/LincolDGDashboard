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
  CreateIntakeLeadDto,
  CreateIntakeLeadResponseDto,
  CreateLeadNoteDto,
  CreateLeadTaskDto,
  CustomerDetailDto,
  CustomerListResponseDto,
  DuplicateCheckDto,
  DuplicateCheckResponseDto,
  LeadDetailDto,
  LeadDocumentDto,
  LeadListResponseDto,
  LeadNoteDto,
  LeadTaskDto,
  LinkLeadDocumentDto,
  TransitionLeadDto,
} from "./intake.dto.js";
import {
  IntakeService,
  leadTransitionActions,
  type LeadTransitionAction,
} from "./intake.service.js";

@ApiTags("Intake")
@Controller("intake")
export class IntakeController {
  public constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

  @Post("actions/check-duplicates")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("customers:read", "leads:write")
  @ApiBody({ type: DuplicateCheckDto })
  @ApiOperation({ operationId: "checkIntakeDuplicates" })
  @ApiOkResponse({ type: DuplicateCheckResponseDto })
  public checkDuplicates(@Body() body: DuplicateCheckDto): Promise<DuplicateCheckResponseDto> {
    return this.intake.checkDuplicates(body);
  }

  @Post("leads")
  @RequirePermissions("customers:write", "leads:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateIntakeLeadDto })
  @ApiOperation({ operationId: "createIntakeLead" })
  @ApiCreatedResponse({ type: CreateIntakeLeadResponseDto })
  public createLead(
    @Body() body: CreateIntakeLeadDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<CreateIntakeLeadResponseDto> {
    return this.intake.createLead(body, requireIdempotencyKey(idempotencyKey));
  }
}

@ApiTags("Customers")
@Controller("customers")
export class CustomersController {
  public constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

  @Get()
  @RequirePermissions("customers:read")
  @ApiQuery({ name: "q", required: false, type: String })
  @ApiQuery({ maximum: 100, minimum: 1, name: "limit", required: false, type: Number })
  @ApiOperation({ operationId: "listCustomers" })
  @ApiOkResponse({ type: CustomerListResponseDto })
  public list(
    @Query("q") query?: string,
    @Query("limit") limit?: string,
  ): Promise<CustomerListResponseDto> {
    return this.intake.listCustomers(query, parseLimit(limit));
  }

  @Get(":id")
  @RequirePermissions("customers:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getCustomer" })
  @ApiOkResponse({ type: CustomerDetailDto })
  public get(
    @Param("id", new ParseUUIDPipe({ version: "4" })) customerId: string,
  ): Promise<CustomerDetailDto> {
    return this.intake.getCustomer(customerId);
  }
}

@ApiTags("Leads")
@Controller("leads")
export class LeadsController {
  public constructor(@Inject(IntakeService) private readonly intake: IntakeService) {}

  @Get()
  @RequirePermissions("leads:read")
  @ApiQuery({ name: "q", required: false, type: String })
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ maximum: 100, minimum: 1, name: "limit", required: false, type: Number })
  @ApiOperation({ operationId: "listLeads" })
  @ApiOkResponse({ type: LeadListResponseDto })
  public list(
    @Query("q") query?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<LeadListResponseDto> {
    return this.intake.listLeads(query, status, parseLimit(limit));
  }

  @Get(":id")
  @RequirePermissions("leads:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getLead" })
  @ApiOkResponse({ type: LeadDetailDto })
  public get(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
  ): Promise<LeadDetailDto> {
    return this.intake.getLead(leadId);
  }

  @Post(":id/notes")
  @RequirePermissions("leads:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateLeadNoteDto })
  @ApiOperation({ operationId: "addLeadNote" })
  @ApiCreatedResponse({ type: LeadNoteDto })
  public addNote(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
    @Body() body: CreateLeadNoteDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<LeadNoteDto> {
    return this.intake.addNote(leadId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/tasks")
  @RequirePermissions("leads:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateLeadTaskDto })
  @ApiOperation({ operationId: "addLeadTask" })
  @ApiCreatedResponse({ type: LeadTaskDto })
  public addTask(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
    @Body() body: CreateLeadTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<LeadTaskDto> {
    return this.intake.addTask(leadId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/tasks/:taskId/actions/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("leads:write")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiParam({ format: "uuid", name: "taskId", type: String })
  @ApiOperation({ operationId: "completeLeadTask" })
  @ApiOkResponse({ type: LeadTaskDto })
  public completeTask(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<LeadTaskDto> {
    return this.intake.completeTask(leadId, taskId, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/documents")
  @RequirePermissions("leads:write", "documents:read")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: LinkLeadDocumentDto })
  @ApiOperation({ operationId: "linkLeadDocument" })
  @ApiCreatedResponse({ type: LeadDocumentDto })
  public linkDocument(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
    @Body() body: LinkLeadDocumentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<LeadDocumentDto> {
    return this.intake.linkDocument(leadId, body, requireIdempotencyKey(idempotencyKey));
  }

  @Post(":id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("leads:transition")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: leadTransitionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: TransitionLeadDto })
  @ApiOperation({ operationId: "transitionLead" })
  @ApiOkResponse({ type: LeadDetailDto })
  public transition(
    @Param("id", new ParseUUIDPipe({ version: "4" })) leadId: string,
    @Param("action") action: string,
    @Body() body: TransitionLeadDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<LeadDetailDto> {
    if (!isLeadTransitionAction(action)) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "LEAD_ACTION_NOT_FOUND",
        "Lead action not found",
      );
    }
    return this.intake.transitionLead(leadId, action, body, requireIdempotencyKey(idempotencyKey));
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

function parseLimit(value: string | undefined): number {
  if (!value) return 50;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 50;
}

function isLeadTransitionAction(value: string): value is LeadTransitionAction {
  return leadTransitionActions.some((action) => action === value);
}
