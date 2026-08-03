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
  Req,
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
import type { FastifyRequest } from "fastify";

import { PublicRoute } from "../auth/public.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import { JobsService, jobTransitionActions, type JobTransitionAction } from "./jobs.service.js";
import {
  AssetDto,
  AssetListResponseDto,
  ChecklistDto,
  ChecklistItemDto,
  CompleteChecklistItemDto,
  ConfirmDepositReadinessDto,
  ContractDto,
  CreateAssetDto,
  CreateChecklistDto,
  CreateRouteStopDto,
  CreateScheduleBlockDto,
  EvaluateReadinessDto,
  JobDetailDto,
  JobListResponseDto,
  LifecycleActionDto,
  ProjectDetailDto,
  ProjectListResponseDto,
  PublicContractDto,
  ReadinessEvaluationDto,
  RouteStopDto,
  ScheduleBlockDto,
  ScheduleCalendarResponseDto,
  SendContractDto,
  SendContractResponseDto,
  SignContractDto,
} from "./operations.dto.js";
import {
  ProjectsService,
  projectTransitionActions,
  type ProjectTransitionAction,
} from "./projects.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@ApiTags("Projects and Contracts")
@Controller()
export class ProjectsController {
  public constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get("projects")
  @RequirePermissions("projects:read")
  @ApiOperation({ operationId: "listProjects" })
  @ApiOkResponse({ type: ProjectListResponseDto })
  public list(): Promise<ProjectListResponseDto> {
    return this.projects.list();
  }

  @Get("projects/:id")
  @RequirePermissions("projects:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getProject" })
  @ApiOkResponse({ type: ProjectDetailDto })
  public get(@Param("id", uuidPipe) projectId: string): Promise<ProjectDetailDto> {
    return this.projects.get(projectId);
  }

  @Post("projects/:id/actions/generate-contract")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "generateProjectContract" })
  @ApiCreatedResponse({ type: ProjectDetailDto })
  public generateContract(
    @Param("id", uuidPipe) projectId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ProjectDetailDto> {
    return this.projects.generateContract(projectId, requireIdempotencyKey(key));
  }

  @Post("projects/:id/actions/confirm-deposit-readiness")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ConfirmDepositReadinessDto })
  @ApiOperation({ operationId: "confirmProjectDepositReadiness" })
  @ApiOkResponse({ type: ProjectDetailDto })
  public confirmDeposit(
    @Param("id", uuidPipe) projectId: string,
    @Body() body: ConfirmDepositReadinessDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ProjectDetailDto> {
    return this.projects.confirmDeposit(projectId, body, requireIdempotencyKey(key));
  }

  @Post("projects/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: projectTransitionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: LifecycleActionDto })
  @ApiOperation({ operationId: "transitionProject" })
  @ApiOkResponse({ type: ProjectDetailDto })
  public transition(
    @Param("id", uuidPipe) projectId: string,
    @Param("action") action: string,
    @Body() body: LifecycleActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ProjectDetailDto> {
    if (!isProjectAction(action)) throw actionNotFound("Project");
    return this.projects.transition(projectId, action, body, requireIdempotencyKey(key));
  }

  @Post("contracts/:id/actions/sign-business")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SignContractDto })
  @ApiOperation({ operationId: "signContractAsBusiness" })
  @ApiOkResponse({ type: ContractDto })
  public signBusiness(
    @Param("id", uuidPipe) contractId: string,
    @Body() body: SignContractDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ContractDto> {
    return this.projects.signBusiness(contractId, body, requireIdempotencyKey(key));
  }

  @Post("contracts/:id/actions/send")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SendContractDto })
  @ApiOperation({ operationId: "sendContract" })
  @ApiOkResponse({ type: SendContractResponseDto })
  public sendContract(
    @Param("id", uuidPipe) contractId: string,
    @Body() body: SendContractDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<SendContractResponseDto> {
    return this.projects.sendContract(contractId, body, requireIdempotencyKey(key));
  }
}

@ApiTags("Jobs")
@Controller()
export class JobsController {
  public constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get("jobs")
  @RequirePermissions("projects:read")
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiOperation({ operationId: "listJobs" })
  @ApiOkResponse({ type: JobListResponseDto })
  public list(@Query("status") status?: string): Promise<JobListResponseDto> {
    return this.jobs.list(status);
  }

  @Get("jobs/:id")
  @RequirePermissions("projects:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getJob" })
  @ApiOkResponse({ type: JobDetailDto })
  public get(@Param("id", uuidPipe) jobId: string): Promise<JobDetailDto> {
    return this.jobs.get(jobId);
  }

  @Post("jobs/:id/actions/evaluate-readiness")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: EvaluateReadinessDto })
  @ApiOperation({ operationId: "evaluateJobReadiness" })
  @ApiOkResponse({ type: ReadinessEvaluationDto })
  public evaluate(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: EvaluateReadinessDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ReadinessEvaluationDto> {
    return this.jobs.evaluateReadiness(jobId, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: jobTransitionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: LifecycleActionDto })
  @ApiOperation({ operationId: "transitionJob" })
  @ApiOkResponse({ type: JobDetailDto })
  public transition(
    @Param("id", uuidPipe) jobId: string,
    @Param("action") action: string,
    @Body() body: LifecycleActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<JobDetailDto> {
    if (!isJobAction(action)) throw actionNotFound("Job");
    return this.jobs.transition(jobId, action, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/route-stops")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRouteStopDto })
  @ApiOperation({ operationId: "createJobRouteStop" })
  @ApiCreatedResponse({ type: RouteStopDto })
  public createRouteStop(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateRouteStopDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RouteStopDto> {
    return this.jobs.createRouteStop(jobId, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/checklists")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateChecklistDto })
  @ApiOperation({ operationId: "createJobChecklist" })
  @ApiCreatedResponse({ type: ChecklistDto })
  public createChecklist(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateChecklistDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ChecklistDto> {
    return this.jobs.createChecklist(jobId, body, requireIdempotencyKey(key));
  }

  @Post("checklist-items/:id/actions/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CompleteChecklistItemDto })
  @ApiOperation({ operationId: "completeChecklistItem" })
  @ApiOkResponse({ type: ChecklistItemDto })
  public completeChecklistItem(
    @Param("id", uuidPipe) itemId: string,
    @Body() body: CompleteChecklistItemDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ChecklistItemDto> {
    return this.jobs.completeChecklistItem(itemId, body, requireIdempotencyKey(key));
  }
}

@ApiTags("Scheduling and Assets")
@Controller()
export class SchedulingController {
  public constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get("assets")
  @RequirePermissions("projects:read")
  @ApiOperation({ operationId: "listAssets" })
  @ApiOkResponse({ type: AssetListResponseDto })
  public listAssets(): Promise<AssetListResponseDto> {
    return this.jobs.listAssets();
  }

  @Post("assets")
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: CreateAssetDto })
  @ApiOperation({ operationId: "createAsset" })
  @ApiCreatedResponse({ type: AssetDto })
  public createAsset(
    @Body() body: CreateAssetDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<AssetDto> {
    return this.jobs.createAsset(body, requireIdempotencyKey(key));
  }

  @Get("schedule/calendar")
  @RequirePermissions("projects:read")
  @ApiQuery({ format: "date-time", name: "from", type: String })
  @ApiQuery({ format: "date-time", name: "to", type: String })
  @ApiOperation({ operationId: "getScheduleCalendar" })
  @ApiOkResponse({ type: ScheduleCalendarResponseDto })
  public calendar(
    @Query("from") from: string,
    @Query("to") to: string,
  ): Promise<ScheduleCalendarResponseDto> {
    return this.jobs.calendar(from, to);
  }

  @Get("schedule/queue")
  @RequirePermissions("projects:read")
  @ApiOperation({ operationId: "getSchedulingQueue" })
  @ApiOkResponse({ type: JobListResponseDto })
  public queue(): Promise<JobListResponseDto> {
    return this.jobs.list("needs_scheduling");
  }

  @Post("jobs/:id/schedule-blocks")
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateScheduleBlockDto })
  @ApiOperation({ operationId: "createJobScheduleBlock" })
  @ApiCreatedResponse({ type: ScheduleBlockDto })
  public createBlock(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateScheduleBlockDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ScheduleBlockDto> {
    return this.jobs.createScheduleBlock(jobId, body, requireIdempotencyKey(key));
  }

  @Post("schedule-blocks/:id/actions/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: LifecycleActionDto })
  @ApiOperation({ operationId: "cancelScheduleBlock" })
  @ApiOkResponse({ type: ScheduleBlockDto })
  public cancelBlock(
    @Param("id", uuidPipe) blockId: string,
    @Body() body: LifecycleActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ScheduleBlockDto> {
    return this.jobs.cancelScheduleBlock(blockId, body, requireIdempotencyKey(key));
  }
}

@ApiTags("Public Contracts")
@PublicRoute()
@Controller("public/contracts")
export class PublicContractsController {
  public constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get(":token")
  @ApiParam({ name: "token", type: String })
  @ApiOperation({ operationId: "getPublicContract" })
  @ApiOkResponse({ type: PublicContractDto })
  public get(@Param("token") token: string): Promise<PublicContractDto> {
    return this.projects.resolvePublic(token);
  }

  @Post(":token/actions/sign")
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: "token", type: String })
  @ApiBody({ type: SignContractDto })
  @ApiOperation({ operationId: "signPublicContract" })
  @ApiOkResponse({ type: PublicContractDto })
  public sign(
    @Param("token") token: string,
    @Body() body: SignContractDto,
    @Req() request: FastifyRequest,
  ): Promise<PublicContractDto> {
    return this.projects.signPublic(token, body, {
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
    });
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200)
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
    );
  return key;
}

function isProjectAction(value: string): value is ProjectTransitionAction {
  return projectTransitionActions.some((action) => action === value);
}

function isJobAction(value: string): value is JobTransitionAction {
  return jobTransitionActions.some((action) => action === value);
}

function actionNotFound(entity: string): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    `${entity.toUpperCase()}_ACTION_NOT_FOUND`,
    `${entity} action not found`,
  );
}
