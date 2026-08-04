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
  AssignMaterialLoadAssetDto,
  AttachMaterialEvidenceDto,
  ChecklistDto,
  ChecklistItemDto,
  CompleteChecklistItemDto,
  ConfirmDepositReadinessDto,
  ContractDto,
  CreateAssetDto,
  CreateChecklistDto,
  CreateExpenseAllocationDto,
  CreateExpenseDto,
  CreateJobChargeDto,
  CreateMaterialLoadDto,
  CreateMaterialQuantityVarianceDto,
  CreateRouteStopDto,
  CreateScheduleBlockDto,
  EvaluateReadinessDto,
  EvaluateMaterialLoadSafetyDto,
  ExpenseActionDto,
  ExpenseAllocationDto,
  ExpenseDto,
  InvoiceReadinessDto,
  JobChargeActionDto,
  JobChargeDto,
  JobDetailDto,
  JobListResponseDto,
  LifecycleActionDto,
  MaterialDeliveryDto,
  MaterialEvidenceDto,
  MaterialLoadAssetDto,
  MaterialLoadDto,
  MaterialLoadItemDto,
  MaterialLoadItemInputDto,
  MaterialLoadExecutionDto,
  MaterialLoadTransitionDto,
  MaterialLoadValidationDto,
  MaterialQuantityVarianceDto,
  ProjectDetailDto,
  ProjectListResponseDto,
  PublicContractDto,
  ReadinessEvaluationDto,
  RecordMaterialQuantitiesDto,
  ResolveMaterialQuantityVarianceDto,
  RouteStopDto,
  SaveMaterialDeliveryPlanDto,
  ScheduleBlockDto,
  ScheduleCalendarResponseDto,
  SendContractDto,
  SendContractResponseDto,
  SignContractDto,
} from "./operations.dto.js";
import {
  expenseActions,
  jobChargeActions,
  materialLoadExecutionActions,
  materialVarianceActions,
  MaterialDeliveryExecutionService,
  type ExpenseAction,
  type JobChargeAction,
  type MaterialLoadExecutionAction,
  type MaterialVarianceAction,
} from "./material-delivery-execution.service.js";
import { MaterialDeliveryService } from "./material-delivery.service.js";
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

@ApiTags("Material Delivery")
@Controller()
export class MaterialDeliveryController {
  public constructor(
    @Inject(MaterialDeliveryService) private readonly materialDelivery: MaterialDeliveryService,
    @Inject(MaterialDeliveryExecutionService)
    private readonly execution: MaterialDeliveryExecutionService,
  ) {}

  @Get("jobs/:id/material-delivery")
  @RequirePermissions("projects:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getJobMaterialDelivery" })
  @ApiOkResponse({ type: MaterialDeliveryDto })
  public get(@Param("id", uuidPipe) jobId: string): Promise<MaterialDeliveryDto> {
    return this.materialDelivery.get(jobId);
  }

  @Post("jobs/:id/material-delivery")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SaveMaterialDeliveryPlanDto })
  @ApiOperation({ operationId: "saveJobMaterialDeliveryPlan" })
  @ApiCreatedResponse({ type: MaterialDeliveryDto })
  public savePlan(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: SaveMaterialDeliveryPlanDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialDeliveryDto> {
    return this.materialDelivery.savePlan(jobId, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/material-loads")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateMaterialLoadDto })
  @ApiOperation({ operationId: "createJobMaterialLoad" })
  @ApiCreatedResponse({ type: MaterialLoadDto })
  public createLoad(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateMaterialLoadDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadDto> {
    return this.materialDelivery.createLoad(jobId, body, requireIdempotencyKey(key));
  }

  @Post("material-loads/:id/items")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: MaterialLoadItemInputDto })
  @ApiOperation({ operationId: "createMaterialLoadItem" })
  @ApiCreatedResponse({ type: MaterialLoadItemDto })
  public createItem(
    @Param("id", uuidPipe) loadId: string,
    @Body() body: MaterialLoadItemInputDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadItemDto> {
    return this.materialDelivery.createItem(loadId, body, requireIdempotencyKey(key));
  }

  @Post("material-load-items/:id/actions/revise")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: MaterialLoadItemInputDto })
  @ApiOperation({ operationId: "reviseMaterialLoadItem" })
  @ApiOkResponse({ type: MaterialLoadItemDto })
  public reviseItem(
    @Param("id", uuidPipe) itemId: string,
    @Body() body: MaterialLoadItemInputDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadItemDto> {
    return this.materialDelivery.reviseItem(itemId, body, requireIdempotencyKey(key));
  }

  @Post("material-loads/:id/assets")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: AssignMaterialLoadAssetDto })
  @ApiOperation({ operationId: "assignMaterialLoadAsset" })
  @ApiCreatedResponse({ type: MaterialLoadAssetDto })
  public assignAsset(
    @Param("id", uuidPipe) loadId: string,
    @Body() body: AssignMaterialLoadAssetDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadAssetDto> {
    return this.materialDelivery.assignAsset(loadId, body, requireIdempotencyKey(key));
  }

  @Post("material-loads/:id/actions/evaluate-safety")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: EvaluateMaterialLoadSafetyDto })
  @ApiOperation({ operationId: "evaluateMaterialLoadSafety" })
  @ApiOkResponse({ type: MaterialLoadValidationDto })
  public evaluateSafety(
    @Param("id", uuidPipe) loadId: string,
    @Body() body: EvaluateMaterialLoadSafetyDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadValidationDto> {
    return this.materialDelivery.evaluateSafety(loadId, body, requireIdempotencyKey(key));
  }

  @Post("material-loads/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: materialLoadExecutionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: MaterialLoadTransitionDto })
  @ApiOperation({ operationId: "transitionMaterialLoadExecution" })
  @ApiOkResponse({ type: MaterialLoadExecutionDto })
  public transitionLoad(
    @Param("id", uuidPipe) loadId: string,
    @Param("action") action: string,
    @Body() body: MaterialLoadTransitionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadExecutionDto> {
    if (!isMaterialLoadExecutionAction(action)) throw actionNotFound("Material Load");
    return this.execution.transitionLoad(loadId, action, body, requireIdempotencyKey(key));
  }

  @Post("material-load-items/:id/actions/record-quantities")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RecordMaterialQuantitiesDto })
  @ApiOperation({ operationId: "recordMaterialLoadItemQuantities" })
  @ApiOkResponse({ type: MaterialLoadItemDto })
  public recordQuantities(
    @Param("id", uuidPipe) itemId: string,
    @Body() body: RecordMaterialQuantitiesDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialLoadItemDto> {
    return this.execution.recordQuantities(itemId, body, requireIdempotencyKey(key));
  }

  @Post("material-load-items/:id/documents")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: AttachMaterialEvidenceDto })
  @ApiOperation({ operationId: "attachMaterialDeliveryEvidence" })
  @ApiCreatedResponse({ type: MaterialEvidenceDto })
  public attachEvidence(
    @Param("id", uuidPipe) itemId: string,
    @Body() body: AttachMaterialEvidenceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialEvidenceDto> {
    return this.execution.attachEvidence(itemId, body, requireIdempotencyKey(key));
  }

  @Post("material-load-items/:id/variances")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateMaterialQuantityVarianceDto })
  @ApiOperation({ operationId: "createMaterialQuantityVariance" })
  @ApiCreatedResponse({ type: MaterialQuantityVarianceDto })
  public createVariance(
    @Param("id", uuidPipe) itemId: string,
    @Body() body: CreateMaterialQuantityVarianceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialQuantityVarianceDto> {
    return this.execution.createVariance(itemId, body, requireIdempotencyKey(key));
  }

  @Post("material-quantity-variances/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: materialVarianceActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ResolveMaterialQuantityVarianceDto })
  @ApiOperation({ operationId: "resolveMaterialQuantityVariance" })
  @ApiOkResponse({ type: MaterialQuantityVarianceDto })
  public resolveVariance(
    @Param("id", uuidPipe) varianceId: string,
    @Param("action") action: string,
    @Body() body: ResolveMaterialQuantityVarianceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<MaterialQuantityVarianceDto> {
    if (!isMaterialVarianceAction(action)) throw actionNotFound("Material Quantity Variance");
    return this.execution.resolveVariance(varianceId, action, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/expenses")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateExpenseDto })
  @ApiOperation({ operationId: "createMaterialDeliveryExpense" })
  @ApiCreatedResponse({ type: ExpenseDto })
  public createExpense(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateExpenseDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ExpenseDto> {
    return this.execution.createExpense(jobId, body, requireIdempotencyKey(key));
  }

  @Post("expenses/:id/allocations")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateExpenseAllocationDto })
  @ApiOperation({ operationId: "allocateMaterialDeliveryExpense" })
  @ApiCreatedResponse({ type: ExpenseAllocationDto })
  public allocateExpense(
    @Param("id", uuidPipe) expenseId: string,
    @Body() body: CreateExpenseAllocationDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ExpenseAllocationDto> {
    return this.execution.allocateExpense(expenseId, body, requireIdempotencyKey(key));
  }

  @Post("expenses/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: expenseActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: ExpenseActionDto })
  @ApiOperation({ operationId: "transitionMaterialDeliveryExpense" })
  @ApiOkResponse({ type: ExpenseDto })
  public transitionExpense(
    @Param("id", uuidPipe) expenseId: string,
    @Param("action") action: string,
    @Body() body: ExpenseActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<ExpenseDto> {
    if (!isExpenseAction(action)) throw actionNotFound("Expense");
    return this.execution.transitionExpense(expenseId, action, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/job-charges")
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateJobChargeDto })
  @ApiOperation({ operationId: "createOperationalJobCharge" })
  @ApiCreatedResponse({ type: JobChargeDto })
  public createJobCharge(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: CreateJobChargeDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<JobChargeDto> {
    return this.execution.createJobCharge(jobId, body, requireIdempotencyKey(key));
  }

  @Post("job-charges/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: jobChargeActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: JobChargeActionDto })
  @ApiOperation({ operationId: "transitionOperationalJobCharge" })
  @ApiOkResponse({ type: JobChargeDto })
  public transitionJobCharge(
    @Param("id", uuidPipe) chargeId: string,
    @Param("action") action: string,
    @Body() body: JobChargeActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<JobChargeDto> {
    if (!isJobChargeAction(action)) throw actionNotFound("Job Charge");
    return this.execution.transitionJobCharge(chargeId, action, body, requireIdempotencyKey(key));
  }

  @Post("jobs/:id/actions/evaluate-invoice-readiness")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "evaluateMaterialDeliveryInvoiceReadiness" })
  @ApiOkResponse({ type: InvoiceReadinessDto })
  public evaluateInvoiceReadiness(
    @Param("id", uuidPipe) jobId: string,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<InvoiceReadinessDto> {
    return this.execution.evaluateInvoiceReadiness(jobId, requireIdempotencyKey(key));
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

function isMaterialLoadExecutionAction(value: string): value is MaterialLoadExecutionAction {
  return materialLoadExecutionActions.some((action) => action === value);
}

function isMaterialVarianceAction(value: string): value is MaterialVarianceAction {
  return materialVarianceActions.some((action) => action === value);
}

function isExpenseAction(value: string): value is ExpenseAction {
  return expenseActions.some((action) => action === value);
}

function isJobChargeAction(value: string): value is JobChargeAction {
  return jobChargeActions.some((action) => action === value);
}

function actionNotFound(entity: string): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    `${entity.toUpperCase()}_ACTION_NOT_FOUND`,
    `${entity} action not found`,
  );
}
