import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class SaveRentalPlanDto {
  @ApiProperty({ format: "date-time", type: String })
  @IsISO8601()
  public plannedDropoffAt!: string;

  @ApiProperty({ format: "date-time", type: String })
  @IsISO8601()
  public plannedPickupAt!: string;

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public trailerAssetId!: string;
}

export class CreateRentalDebrisReviewDto {
  @ApiProperty({ maxLength: 100, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  public primaryDebrisType!: string;

  @ApiPropertyOptional({ isArray: true, maxItems: 20, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  public secondaryDebrisTypes?: string[];

  @ApiPropertyOptional({ isArray: true, maxItems: 20, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  public prohibitedMaterials?: string[];

  @ApiPropertyOptional({ isArray: true, maxItems: 20, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  public restrictedMaterials?: string[];

  @ApiProperty({ type: Boolean }) @IsBoolean() public mixedDebris!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() public heavyMaterial!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() public customerAttested!: boolean;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public customerAttestation?: string;

  @ApiProperty({ enum: ["pending", "pass", "fail"] })
  @IsIn(["pending", "pass", "fail"])
  public accessStatus!: string;

  @ApiProperty({ enum: ["pending", "pass", "fail"] })
  @IsIn(["pending", "pass", "fail"])
  public legalTowingStatus!: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public placementInstructions?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public pickupAccessRequirement?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public propertyDamageRisk?: string;
}

export class RentalDecisionDto {
  @ApiProperty({ maxLength: 2_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public reason!: string;
}

export class PlanRentalScheduleDto {
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public dropoffStartsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public dropoffEndsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public pickupStartsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public pickupEndsAt!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public dropoffDriverUserId!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public pickupDriverUserId!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public dropoffTruckAssetId!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public pickupTruckAssetId!: string;
}

export class EvaluateRentalReadinessDto {
  @ApiProperty({ enum: ["planning", "schedule", "dispatch"] })
  @IsIn(["planning", "schedule", "dispatch"])
  public readinessType!: string;
}

export class CreateRentalInspectionDto {
  @ApiProperty({ enum: ["pre_dropoff", "post_rental"] })
  @IsIn(["pre_dropoff", "post_rental"])
  public inspectionType!: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public evidenceDocumentId?: string;
}

export class CompleteRentalInspectionDto {
  @ApiProperty({
    enum: [
      "acceptable",
      "acceptable_after_cleaning",
      "maintenance_review",
      "damage_review",
      "out_of_service",
    ],
  })
  @IsIn([
    "acceptable",
    "acceptable_after_cleaning",
    "maintenance_review",
    "damage_review",
    "out_of_service",
  ])
  public conditionResult!: string;

  @ApiProperty({ enum: ["not_required", "normal", "required", "completed"] })
  @IsIn(["not_required", "normal", "required", "completed"])
  public cleaningResult!: string;

  @ApiProperty({ enum: ["none", "review_required", "damage_confirmed", "resolved"] })
  @IsIn(["none", "review_required", "damage_confirmed", "resolved"])
  public damageResult!: string;

  @ApiProperty({ enum: ["release", "quarantine", "out_of_service"] })
  @IsIn(["release", "quarantine", "out_of_service"])
  public releaseDecision!: string;

  @ApiProperty({ type: Boolean }) @IsBoolean() public safeToRelease!: boolean;

  @ApiProperty({ maxLength: 4_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(4_000)
  public notes!: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public evidenceDocumentId?: string;
}

export class RentalExecutionDto {
  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601()
  public occurredAt?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public notes?: string;
}

export class CreateRentalExtensionDto {
  @ApiProperty({ format: "date-time", type: String })
  @IsISO8601()
  public requestedPickupAt!: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  public customerAuthorized!: boolean;
}

export class RentalExtensionActionDto {
  @ApiProperty({ maxLength: 2_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public reason!: string;
}

export class CreateRentalPickupAttemptDto {
  @ApiProperty({ format: "date-time", type: String })
  @IsISO8601()
  public customerNotifiedAt!: string;

  @ApiProperty({ enum: ["pending", "pass", "fail"] })
  @IsIn(["pending", "pass", "fail"])
  public accessStatus!: string;

  @ApiProperty({ enum: ["pending", "pass", "fail"] })
  @IsIn(["pending", "pass", "fail"])
  public safeLoadStatus!: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public notes?: string;
}

export class RentalPickupActionDto {
  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601()
  public occurredAt?: string;

  @ApiPropertyOptional({ enum: ["pending", "pass", "fail"] })
  @IsOptional()
  @IsIn(["pending", "pass", "fail"])
  public accessStatus?: string;

  @ApiPropertyOptional({ enum: ["pending", "pass", "fail"] })
  @IsOptional()
  @IsIn(["pending", "pass", "fail"])
  public safeLoadStatus?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public reason?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public notes?: string;
}

export class CreateDisposalLoadDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public plannedFacilityLocationId!: string;

  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  public debrisClassification!: string;

  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public startsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public endsAt!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public driverUserId!: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public truckAssetId!: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public redirectedFromDisposalLoadId?: string;
}

export class DisposalLoadExecutionDto {
  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601()
  public occurredAt?: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public actualFacilityLocationId?: string;

  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,10})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/)
  public grossWeight?: string;

  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,10})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/)
  public tareWeight?: string;

  @ApiPropertyOptional({ enum: ["pounds", "tons"] })
  @IsOptional()
  @IsIn(["pounds", "tons"])
  public sourceWeightUnit?: string;

  @ApiPropertyOptional({ enum: ["pending", "none", "remaining", "resolved"] })
  @IsOptional()
  @IsIn(["pending", "none", "remaining", "resolved"])
  public remainingMaterialStatus?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public rejectionReason?: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public notes?: string;
}

export class RecordDisposalEvidenceDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public ticketDocumentId?: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public receiptDocumentId?: string;

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public emptyTrailerDocumentId!: string;

  @ApiProperty({ minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  public disposalFeeCents!: number;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public evidenceWaiverReason?: string;

  @ApiPropertyOptional({ maxLength: 160, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  public externalReference?: string;
}

export class RentalDebrisReviewDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public reviewNumber!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public primaryDebrisType!: string;
  @ApiProperty({ isArray: true, type: String }) public prohibitedMaterials!: string[];
  @ApiProperty({ type: Boolean }) public customerAttested!: boolean;
  @ApiProperty({ type: String }) public accessStatus!: string;
  @ApiProperty({ type: String }) public legalTowingStatus!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public outcomeNotes!: string | null;
}

export class RentalInspectionDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public inspectionNumber!: number;
  @ApiProperty({ type: String }) public inspectionType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public conditionResult!: string;
  @ApiProperty({ type: String }) public releaseDecision!: string;
  @ApiProperty({ type: Boolean }) public safeToRelease!: boolean;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public evidenceDocumentId!: string | null;
}

export class RentalScheduleDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public blockType!: string;
  @ApiProperty({ format: "date-time", type: String }) public startsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) public endsAt!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ isArray: true, type: String }) public driverUserIds!: string[];
  @ApiProperty({ isArray: true, type: String }) public assetIds!: string[];
}

export class RentalOccupancyDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public trailerAssetId!: string;
  @ApiProperty({ format: "date-time", type: String }) public startsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) public endsAt!: string;
  @ApiProperty({ type: String }) public status!: string;
}

export class RentalReadinessDto {
  @ApiProperty({ type: String }) public readinessType!: string;
  @ApiProperty({ type: String }) public result!: string;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
  @ApiProperty({ isArray: true, type: String }) public warnings!: string[];
  @ApiProperty({ format: "date-time", type: String }) public evaluatedAt!: string;
}

export class RentalExtensionDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public extensionNumber!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ format: "date-time", type: String }) public previousPickupAt!: string;
  @ApiProperty({ format: "date-time", type: String }) public requestedPickupAt!: string;
  @ApiProperty({ type: Number }) public additionalDays!: number;
  @ApiProperty({ type: Number }) public rateCents!: number;
  @ApiProperty({ type: Number }) public calculatedAmountCents!: number;
  @ApiProperty({ type: String }) public conflictStatus!: string;
  @ApiProperty({ type: String }) public customerAuthorizationStatus!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public decidedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public decisionReason!: string | null;
}

export class RentalPickupAttemptDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public attemptNumber!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public accessStatus!: string;
  @ApiProperty({ type: String }) public safeLoadStatus!: string;
  @ApiProperty({ format: "uuid", type: String }) public scheduleBlockId!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public routeStopId!: string | null;
  @ApiProperty({ format: "uuid", type: String }) public trailerAssetId!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public customerNotifiedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public attemptedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public arrivedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public customerCustodyEndedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public failureReason!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public outcomeNotes!: string | null;
}

export class RentalDisposalLoadDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public debrisClassification!: string;
  @ApiProperty({ type: String }) public acceptanceResult!: string;
  @ApiProperty({ type: String }) public unloadingResult!: string;
  @ApiProperty({ type: String }) public weightStatus!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public grossWeight!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public tareWeight!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public netWeight!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public canonicalNetWeightPounds!: string | null;
  @ApiProperty({ type: String }) public ticketStatus!: string;
  @ApiProperty({ type: String }) public receiptStatus!: string;
  @ApiProperty({ type: String }) public emptyTrailerStatus!: string;
  @ApiProperty({ type: String }) public remainingMaterialStatus!: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) public disposalFeeCents!: number | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public expenseId!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public redirectedFromDisposalLoadId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public rejectionReason!: string | null;
}

export class RentalOperationalChargeDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public chargeNumber!: string;
  @ApiProperty({ type: String }) public chargeType!: string;
  @ApiProperty({ type: String }) public sourceType!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public sourceId!: string | null;
  @ApiProperty({ type: String }) public status!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public quantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) public rateCents!: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  public approvedAmountCents!: number | null;
  @ApiProperty({ type: String }) public customerDescription!: string;
}

export class DumpTrailerRentalDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public rateType!: string;
  @ApiProperty({ type: Number }) public includedDays!: number;
  @ApiProperty({ type: Number }) public additionalDayRateCents!: number;
  @ApiProperty({ type: String }) public includedWeightPounds!: string;
  @ApiProperty({ type: Number }) public overageRateCentsPerPound!: number;
  @ApiProperty({ type: Number }) public depositAmountCents!: number;
  @ApiProperty({ type: String }) public depositClassification!: string;
  @ApiProperty({ format: "date-time", type: String }) public plannedDropoffAt!: string;
  @ApiProperty({ format: "date-time", type: String }) public plannedPickupAt!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public trailerAssetId!: string | null;
  @ApiProperty({ type: String }) public debrisReviewStatus!: string;
  @ApiProperty({ type: String }) public accessReviewStatus!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public actualDropoffAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public onRentAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public customerCustodyEndedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public actualPickupAt!: string | null;
  @ApiProperty({ isArray: true, type: RentalDebrisReviewDto })
  public debrisReviews!: RentalDebrisReviewDto[];
  @ApiProperty({ isArray: true, type: RentalInspectionDto })
  public inspections!: RentalInspectionDto[];
  @ApiProperty({ isArray: true, type: RentalExtensionDto })
  public extensions!: RentalExtensionDto[];
  @ApiProperty({ isArray: true, type: RentalPickupAttemptDto })
  public pickupAttempts!: RentalPickupAttemptDto[];
  @ApiProperty({ isArray: true, type: RentalDisposalLoadDto })
  public disposalLoads!: RentalDisposalLoadDto[];
  @ApiProperty({ isArray: true, type: RentalOperationalChargeDto })
  public operationalCharges!: RentalOperationalChargeDto[];
  @ApiProperty({ type: String }) public emptyTrailerStatus!: string;
  @ApiProperty({ type: String }) public finalCondition!: string;
  @ApiProperty({ type: String }) public totalActualWeightPounds!: string;
  @ApiProperty({ type: String }) public overageWeightPounds!: string;
  @ApiProperty({ type: String }) public invoiceReadiness!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public occupancyReleasedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public operationallyCompletedAt!: string | null;
  @ApiProperty({ isArray: true, type: RentalScheduleDto }) public schedule!: RentalScheduleDto[];
  @ApiPropertyOptional({ nullable: true, type: RentalOccupancyDto })
  public occupancy!: RentalOccupancyDto | null;
  @ApiPropertyOptional({ nullable: true, type: RentalReadinessDto })
  public latestReadiness!: RentalReadinessDto | null;
}
