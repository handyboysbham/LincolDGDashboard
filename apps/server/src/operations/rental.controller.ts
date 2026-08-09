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

import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import { ApiException } from "../errors/api.exception.js";
import {
  CompleteRentalInspectionDto,
  CreateDisposalLoadDto,
  CreateRentalDebrisReviewDto,
  CreateRentalExtensionDto,
  CreateRentalInspectionDto,
  CreateRentalPickupAttemptDto,
  DisposalLoadExecutionDto,
  DumpTrailerRentalDto,
  EvaluateRentalReadinessDto,
  PlanRentalScheduleDto,
  RecordDisposalEvidenceDto,
  RentalDecisionDto,
  RentalExecutionDto,
  RentalExtensionActionDto,
  RentalExtensionDto,
  RentalInspectionDto,
  RentalPickupActionDto,
  RentalReadinessDto,
  SaveRentalPlanDto,
} from "./rental.dto.js";
import {
  RentalService,
  rentalDebrisDecisionActions,
  rentalDropoffActions,
  rentalDisposalActions,
  rentalExtensionActions,
  rentalPickupActions,
  type RentalDebrisDecisionAction,
  type RentalDropoffAction,
  type RentalDisposalAction,
  type RentalExtensionAction,
  type RentalPickupAction,
} from "./rental.service.js";

const uuidPipe = new ParseUUIDPipe({ version: "4" });

@ApiTags("Dump Trailer Rental")
@Controller()
export class RentalController {
  public constructor(@Inject(RentalService) private readonly rentals: RentalService) {}

  @Get("jobs/:id/dump-trailer-rental")
  @RequirePermissions("projects:read")
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiOperation({ operationId: "getJobDumpTrailerRental" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public get(@Param("id", uuidPipe) jobId: string): Promise<DumpTrailerRentalDto> {
    return this.rentals.get(jobId);
  }

  @Post("jobs/:id/dump-trailer-rental")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SaveRentalPlanDto })
  @ApiOperation({ operationId: "saveJobDumpTrailerRentalPlan" })
  @ApiCreatedResponse({ type: DumpTrailerRentalDto })
  public savePlan(
    @Param("id", uuidPipe) jobId: string,
    @Body() body: SaveRentalPlanDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.savePlan(jobId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/actions/revise-plan")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: SaveRentalPlanDto })
  @ApiOperation({ operationId: "reviseDumpTrailerRentalPlan" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public revisePlan(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: SaveRentalPlanDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.revisePlan(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/debris-reviews")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRentalDebrisReviewDto })
  @ApiOperation({ operationId: "createRentalDebrisReview" })
  @ApiCreatedResponse({ type: DumpTrailerRentalDto })
  public createDebrisReview(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: CreateRentalDebrisReviewDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.createDebrisReview(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("rental-debris-reviews/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: rentalDebrisDecisionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalDecisionDto })
  @ApiOperation({ operationId: "decideRentalDebrisReview" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public decideDebrisReview(
    @Param("id", uuidPipe) reviewId: string,
    @Param("action") action: string,
    @Body() body: RentalDecisionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    if (!isDebrisDecisionAction(action)) throw actionNotFound("Rental Debris Review");
    return this.rentals.decideDebrisReview(reviewId, action, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/actions/plan-schedule")
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: PlanRentalScheduleDto })
  @ApiOperation({ operationId: "planDumpTrailerRentalSchedule" })
  @ApiCreatedResponse({ type: DumpTrailerRentalDto })
  public planSchedule(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: PlanRentalScheduleDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.planSchedule(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/actions/evaluate-readiness")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: EvaluateRentalReadinessDto })
  @ApiOperation({ operationId: "evaluateDumpTrailerRentalReadiness" })
  @ApiOkResponse({ type: RentalReadinessDto })
  public evaluateReadiness(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: EvaluateRentalReadinessDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RentalReadinessDto> {
    return this.rentals.evaluateReadiness(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/inspections")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRentalInspectionDto })
  @ApiOperation({ operationId: "createRentalInspection" })
  @ApiCreatedResponse({ type: RentalInspectionDto })
  public createInspection(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: CreateRentalInspectionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RentalInspectionDto> {
    return this.rentals.createInspection(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("rental-inspections/:id/actions/complete")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CompleteRentalInspectionDto })
  @ApiOperation({ operationId: "completeRentalInspection" })
  @ApiOkResponse({ type: RentalInspectionDto })
  public completeInspection(
    @Param("id", uuidPipe) inspectionId: string,
    @Body() body: CompleteRentalInspectionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RentalInspectionDto> {
    return this.rentals.completeInspection(inspectionId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/extensions")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRentalExtensionDto })
  @ApiOperation({ operationId: "createRentalExtension" })
  @ApiCreatedResponse({ type: RentalExtensionDto })
  public createExtension(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: CreateRentalExtensionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<RentalExtensionDto> {
    return this.rentals.createExtension(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("rental-extensions/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: rentalExtensionActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalExtensionActionDto })
  @ApiOperation({ operationId: "transitionRentalExtension" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public transitionExtension(
    @Param("id", uuidPipe) extensionId: string,
    @Param("action") action: string,
    @Body() body: RentalExtensionActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    if (!isExtensionAction(action)) throw actionNotFound("Rental Extension");
    return this.rentals.transitionExtension(extensionId, action, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/pickup-attempts")
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateRentalPickupAttemptDto })
  @ApiOperation({ operationId: "createRentalPickupAttempt" })
  @ApiCreatedResponse({ type: DumpTrailerRentalDto })
  public createPickupAttempt(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: CreateRentalPickupAttemptDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.createPickupAttempt(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("rental-pickup-attempts/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: rentalPickupActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalPickupActionDto })
  @ApiOperation({ operationId: "transitionRentalPickupAttempt" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public transitionPickupAttempt(
    @Param("id", uuidPipe) attemptId: string,
    @Param("action") action: string,
    @Body() body: RentalPickupActionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    if (!isPickupAction(action)) throw actionNotFound("Rental Pickup Attempt");
    return this.rentals.transitionPickupAttempt(
      attemptId,
      action,
      body,
      requireIdempotencyKey(key),
    );
  }

  @Post("dump-trailer-rentals/:id/disposal-loads")
  @RequirePermissions("scheduling:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: CreateDisposalLoadDto })
  @ApiOperation({ operationId: "createRentalDisposalLoad" })
  @ApiCreatedResponse({ type: DumpTrailerRentalDto })
  public createDisposalLoad(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: CreateDisposalLoadDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.createDisposalLoad(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("disposal-loads/:id/actions/record-evidence")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RecordDisposalEvidenceDto })
  @ApiOperation({ operationId: "recordRentalDisposalEvidence" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public recordDisposalEvidence(
    @Param("id", uuidPipe) disposalLoadId: string,
    @Body() body: RecordDisposalEvidenceDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.recordDisposalEvidence(disposalLoadId, body, requireIdempotencyKey(key));
  }

  @Post("disposal-loads/:id/actions/reconcile")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalExecutionDto })
  @ApiOperation({ operationId: "reconcileRentalDisposalLoad" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public reconcileDisposalLoad(
    @Param("id", uuidPipe) disposalLoadId: string,
    @Body() body: RentalExecutionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.reconcileDisposalLoad(disposalLoadId, body, requireIdempotencyKey(key));
  }

  @Post("disposal-loads/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: rentalDisposalActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: DisposalLoadExecutionDto })
  @ApiOperation({ operationId: "transitionRentalDisposalLoad" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public transitionDisposalLoad(
    @Param("id", uuidPipe) disposalLoadId: string,
    @Param("action") action: string,
    @Body() body: DisposalLoadExecutionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    if (!isDisposalAction(action)) throw actionNotFound("Rental Disposal Load");
    return this.rentals.transitionDisposalLoad(
      disposalLoadId,
      action,
      body,
      requireIdempotencyKey(key),
    );
  }

  @Post("dump-trailer-rentals/:id/actions/reconcile")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("finance:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalExecutionDto })
  @ApiOperation({ operationId: "reconcileDumpTrailerRental" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public reconcileRental(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Body() body: RentalExecutionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    return this.rentals.reconcileRental(rentalDetailId, body, requireIdempotencyKey(key));
  }

  @Post("dump-trailer-rentals/:id/actions/:action")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("operations:manage")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiParam({ enum: rentalDropoffActions, name: "action" })
  @ApiParam({ format: "uuid", name: "id", type: String })
  @ApiBody({ type: RentalExecutionDto })
  @ApiOperation({ operationId: "transitionRentalDropoff" })
  @ApiOkResponse({ type: DumpTrailerRentalDto })
  public transitionDropoff(
    @Param("id", uuidPipe) rentalDetailId: string,
    @Param("action") action: string,
    @Body() body: RentalExecutionDto,
    @Headers("idempotency-key") key: string | undefined,
  ): Promise<DumpTrailerRentalDto> {
    if (!isDropoffAction(action)) throw actionNotFound("Rental Drop-off");
    return this.rentals.transitionDropoff(rentalDetailId, action, body, requireIdempotencyKey(key));
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

function isDebrisDecisionAction(value: string): value is RentalDebrisDecisionAction {
  return rentalDebrisDecisionActions.some((action) => action === value);
}

function isDropoffAction(value: string): value is RentalDropoffAction {
  return rentalDropoffActions.some((action) => action === value);
}

function isExtensionAction(value: string): value is RentalExtensionAction {
  return rentalExtensionActions.some((action) => action === value);
}

function isPickupAction(value: string): value is RentalPickupAction {
  return rentalPickupActions.some((action) => action === value);
}

function isDisposalAction(value: string): value is RentalDisposalAction {
  return rentalDisposalActions.some((action) => action === value);
}

function actionNotFound(entity: string): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    `${entity.toUpperCase().replaceAll(" ", "_")}_ACTION_NOT_FOUND`,
    `${entity} action not found`,
  );
}
