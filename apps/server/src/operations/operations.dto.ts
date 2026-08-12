import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ProjectSummaryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiProperty({ type: String }) public serviceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public contractStatus!: string;
  @ApiProperty({ type: String }) public depositStatus!: string;
  @ApiProperty({ type: Number }) public acceptedValueCents!: number;
  @ApiProperty({ type: Number }) public requiredDepositCents!: number;
  @ApiProperty({ format: "date-time", type: String }) public updatedAt!: string;
}

export class ProjectListResponseDto {
  @ApiProperty({ isArray: true, type: ProjectSummaryDto }) public items!: ProjectSummaryDto[];
}

export class SignatureDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public signerRole!: string;
  @ApiProperty({ type: String }) public typedName!: string;
  @ApiProperty({ format: "date-time", type: String }) public signedAt!: string;
}

export class ContractDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public contractNumber!: string;
  @ApiProperty({ type: Number }) public versionNumber!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public contentHash!: string;
  @ApiProperty({ additionalProperties: true, type: Object }) public content!: Record<
    string,
    unknown
  >;
  @ApiProperty({ isArray: true, type: SignatureDto }) public signatures!: SignatureDto[];
}

export class JobSummaryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public projectId!: string;
  @ApiProperty({ type: String }) public jobNumber!: string;
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiProperty({ type: String }) public serviceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public readiness!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public scheduledStartAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public scheduledEndAt!: string | null;
}

export class JobListResponseDto {
  @ApiProperty({ isArray: true, type: JobSummaryDto }) public items!: JobSummaryDto[];
}

export class ScheduleBlockDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public jobNumber!: string;
  @ApiProperty({ type: String }) public blockType!: string;
  @ApiProperty({ format: "date-time", type: String }) public startsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) public endsAt!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ isArray: true, type: String }) public assetIds!: string[];
  @ApiProperty({ isArray: true, type: String }) public userIds!: string[];
}

export class RouteStopDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public stopType!: string;
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ type: String }) public status!: string;
}

export class ChecklistItemDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public response!: string | null;
}

export class ChecklistDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public templateCode!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: Boolean }) public required!: boolean;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ isArray: true, type: ChecklistItemDto }) public items!: ChecklistItemDto[];
}

export class JobEventDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public eventType!: string;
  @ApiProperty({ type: String }) public summary!: string;
  @ApiProperty({ format: "date-time", type: String }) public occurredAt!: string;
}

export class JobDetailDto extends JobSummaryDto {
  @ApiProperty({ isArray: true, type: ScheduleBlockDto })
  public scheduleBlocks!: ScheduleBlockDto[];
  @ApiProperty({ isArray: true, type: RouteStopDto }) public routeStops!: RouteStopDto[];
  @ApiProperty({ isArray: true, type: ChecklistDto }) public checklists!: ChecklistDto[];
  @ApiProperty({ isArray: true, type: JobEventDto }) public events!: JobEventDto[];
  @ApiProperty({ isArray: true, type: String }) public activeHolds!: string[];
}

export class ProjectDetailDto extends ProjectSummaryDto {
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiProperty({ type: String }) public contactName!: string;
  @ApiProperty({ type: String }) public serviceLocation!: string;
  @ApiProperty({ type: String }) public outcomeStatement!: string;
  @ApiPropertyOptional({ nullable: true, type: ContractDto }) public contract!: ContractDto | null;
  @ApiProperty({ isArray: true, type: JobSummaryDto }) public jobs!: JobSummaryDto[];
  @ApiProperty({ isArray: true, type: String }) public activeHolds!: string[];
}

export class SignContractDto {
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public typedName!: string;
  @ApiProperty({ maxLength: 2_000, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  public consentText!: string;
  @ApiProperty({ minLength: 64, type: String })
  @Matches(/^[a-f0-9]{64}$/i)
  public contentHash!: string;
}

export class SendContractDto {
  @ApiProperty({ type: String }) @IsEmail() @MaxLength(320) public recipient!: string;
  @ApiPropertyOptional({ default: 10, maximum: 30, minimum: 1, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  public expiresInDays?: number;
}

export class SendContractResponseDto {
  @ApiProperty({ type: ContractDto }) public contract!: ContractDto;
  @ApiProperty({ type: String }) public customerPath!: string;
  @ApiProperty({ type: String }) public token!: string;
}

export class PublicContractDto {
  @ApiProperty({ type: String }) public contractNumber!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public contentHash!: string;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiProperty({ type: String }) public serviceLocation!: string;
  @ApiProperty({ type: String }) public scope!: string;
  @ApiProperty({ type: Number }) public acceptedValueCents!: number;
  @ApiProperty({ type: Number }) public requiredDepositCents!: number;
  @ApiProperty({ isArray: true, type: SignatureDto }) public signatures!: SignatureDto[];
  @ApiProperty({ isArray: true, type: String }) public terms!: string[];
}

export class ConfirmDepositReadinessDto {
  @ApiProperty({ maxLength: 240, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  public evidenceReference!: string;
}

export class LifecycleActionDto {
  @ApiPropertyOptional({ maxLength: 1_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public reason?: string;
}

export class ReadinessEvaluationDto {
  @ApiProperty({ type: String }) public readinessType!: string;
  @ApiProperty({ type: String }) public result!: string;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
  @ApiProperty({ isArray: true, type: String }) public warnings!: string[];
  @ApiProperty({ format: "date-time", type: String }) public evaluatedAt!: string;
}

export class EvaluateReadinessDto {
  @ApiProperty({ enum: ["planning", "schedule", "dispatch", "completion", "invoice", "closure"] })
  @IsIn(["planning", "schedule", "dispatch", "completion", "invoice", "closure"])
  public readinessType!: string;
}

export class AssetDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public assetNumber!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: String }) public assetType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public capacityWeight!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public capacityVolumeCubicYards!: string | null;
}

export class AssetListResponseDto {
  @ApiProperty({ isArray: true, type: AssetDto }) public items!: AssetDto[];
}

export class CreateAssetDto {
  @ApiProperty({ maxLength: 40, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  public assetNumber!: string;
  @ApiProperty({ maxLength: 160, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public name!: string;
  @ApiProperty({ enum: ["truck", "trailer", "equipment"] })
  @IsIn(["truck", "trailer", "equipment"])
  public assetType!: string;
  @ApiPropertyOptional({ pattern: "^\\d+(\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,3})?$/)
  public capacityWeight?: string;
  @ApiPropertyOptional({ pattern: "^\\d+(\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^\d+(\.\d{1,3})?$/)
  public capacityVolumeCubicYards?: string;
}

export class MaterialLoadAssetDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public assetId!: string;
  @ApiProperty({ type: String }) public assetNumber!: string;
  @ApiProperty({ type: String }) public role!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ additionalProperties: true, type: Object })
  public capacitySnapshot!: Record<string, unknown>;
}

export class MaterialLoadItemDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public materialId!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public acceptedQuoteLineItemId!: string | null;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: Number }) public loadingSequence!: number;
  @ApiProperty({ type: Number }) public unloadingSequence!: number;
  @ApiProperty({ type: String }) public quantityUnit!: string;
  @ApiProperty({ type: String }) public plannedQuantity!: string;
  @ApiProperty({ type: String }) public unitWeightPounds!: string;
  @ApiProperty({ type: String }) public unitVolumeCubicYards!: string;
  @ApiProperty({ format: "uuid", type: String }) public supplierRouteStopId!: string;
  @ApiProperty({ format: "uuid", type: String }) public placementRouteStopId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public compartment!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public separationInstructions!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public actualMaterialId!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public actualSupplierMaterialId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public purchasedQuantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public loadedQuantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public deliveredQuantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public remainingQuantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) public actualUnitCostCents!: number | null;
  @ApiProperty({ type: String }) public deliveryResult!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public remainingDisposition!:
    string | null;
  @ApiProperty({ type: String }) public varianceStatus!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public materialName?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public supplierStopLabel?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public placementStopLabel?: string | null;
  @ApiProperty({ isArray: true, type: () => MaterialEvidenceDto })
  public evidence!: MaterialEvidenceDto[];
}

export class MaterialCatalogItemDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: String }) public defaultUnit!: string;
}

export class MaterialCatalogResponseDto {
  @ApiProperty({ isArray: true, type: MaterialCatalogItemDto })
  public items!: MaterialCatalogItemDto[];
}

export class MaterialLoadValidationDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public validationType!: string;
  @ApiProperty({ type: String }) public result!: string;
  @ApiProperty({ type: String }) public capacityResult!: string;
  @ApiProperty({ type: String }) public compatibilityResult!: string;
  @ApiProperty({ type: String }) public separationResult!: string;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
  @ApiProperty({ isArray: true, type: String }) public warnings!: string[];
  @ApiProperty({ type: String }) public inputHash!: string;
  @ApiProperty({ format: "date-time", type: String }) public evaluatedAt!: string;
}

export class MaterialLoadDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  public plannedVolumeCubicYards!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public plannedWeightPounds!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public actualVolumeCubicYards!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public actualWeightPounds!: string | null;
  @ApiProperty({ type: String }) public capacityResult!: string;
  @ApiProperty({ type: String }) public compatibilityResult!: string;
  @ApiProperty({ type: String }) public separationResult!: string;
  @ApiProperty({ isArray: true, type: MaterialLoadAssetDto })
  public assets!: MaterialLoadAssetDto[];
  @ApiProperty({ isArray: true, type: MaterialLoadItemDto }) public items!: MaterialLoadItemDto[];
  @ApiProperty({ isArray: true, type: MaterialLoadValidationDto })
  public validations!: MaterialLoadValidationDto[];
}

export class MaterialDeliveryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public deliveryType!: string;
  @ApiProperty({ type: Number }) public plannedLoadCount!: number;
  @ApiPropertyOptional({ nullable: true, type: String })
  public plannedVolumeCubicYards!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public plannedWeightPounds!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public actualDeliveredVolumeCubicYards!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public actualDeliveredWeightPounds!: string | null;
  @ApiProperty({ type: String }) public capacityStatus!: string;
  @ApiProperty({ type: String }) public compatibilityStatus!: string;
  @ApiProperty({ type: String }) public receiptStatus!: string;
  @ApiProperty({ type: String }) public placementEvidenceStatus!: string;
  @ApiProperty({ type: Boolean }) public partialDelivery!: boolean;
  @ApiProperty({ type: String }) public invoiceReadiness!: string;
  @ApiProperty({ isArray: true, type: MaterialLoadDto }) public loads!: MaterialLoadDto[];
  @ApiProperty({ isArray: true, type: () => MaterialQuantityVarianceDto })
  public variances!: MaterialQuantityVarianceDto[];
  @ApiProperty({ isArray: true, type: () => ExpenseDto }) public expenses!: ExpenseDto[];
  @ApiProperty({ isArray: true, type: () => JobChargeDto }) public jobCharges!: JobChargeDto[];
}

export class SaveMaterialDeliveryPlanDto {
  @ApiProperty({ enum: ["bulk", "placed", "spread"] })
  @IsIn(["bulk", "placed", "spread"])
  public deliveryType!: string;
  @ApiProperty({ maximum: 20, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(20)
  public plannedLoadCount!: number;
  @ApiPropertyOptional({ default: true, type: Boolean })
  @IsOptional()
  @IsBoolean()
  public placementEvidenceRequired?: boolean;
}

export class CreateMaterialLoadDto {
  @ApiProperty({ maximum: 20, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(20)
  public sequence!: number;
}

export class MaterialLoadItemInputDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public acceptedQuoteLineItemId?: string;
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public materialId!: string;
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public supplierRouteStopId!: string;
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public placementRouteStopId!: string;
  @ApiProperty({ maximum: 50, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(50)
  public sequence!: number;
  @ApiProperty({ maximum: 50, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(50)
  public loadingSequence!: number;
  @ApiProperty({ maximum: 50, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(50)
  public unloadingSequence!: number;
  @ApiProperty({ enum: ["tons", "cubic_yards", "loads"] })
  @IsIn(["tons", "cubic_yards", "loads"])
  public quantityUnit!: string;
  @ApiProperty({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public plannedQuantity!: string;
  @ApiProperty({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public unitWeightPounds!: string;
  @ApiProperty({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public unitVolumeCubicYards!: string;
  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  public plannedUnitCostCents?: number;
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  public compartment?: string;
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public separationInstructions?: string;
}

export class AssignMaterialLoadAssetDto {
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public assetId!: string;
  @ApiProperty({ enum: ["truck", "trailer", "equipment"] })
  @IsIn(["truck", "trailer", "equipment"])
  public role!: string;
}

export class EvaluateMaterialLoadSafetyDto {
  @ApiProperty({ enum: ["planning", "dispatch", "actual"] })
  @IsIn(["planning", "dispatch", "actual"])
  public validationType!: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() public compatibilityConfirmed!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() public separationConfirmed!: boolean;
}

export class MaterialLoadTransitionDto {
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

export class MaterialLoadExecutionDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public loadingStartedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public loadedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public transitStartedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public unloadingStartedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public deliveredAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public reconciledAt!: string | null;
}

export class RecordMaterialQuantitiesDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public actualMaterialId?: string;
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public actualSupplierMaterialId?: string;
  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public purchasedQuantity?: string;
  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public loadedQuantity?: string;
  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public deliveredQuantity?: string;
  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public remainingQuantity?: string;
  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  public actualUnitCostCents?: number;
  @ApiPropertyOptional({
    enum: ["pending", "delivered", "partially_delivered", "not_delivered", "returned"],
  })
  @IsOptional()
  @IsIn(["pending", "delivered", "partially_delivered", "not_delivered", "returned"])
  public deliveryResult?: string;
  @ApiPropertyOptional({
    enum: [
      "none",
      "returned_to_supplier",
      "retained_by_business",
      "left_with_customer",
      "disposed",
      "follow_up_job",
      "other",
    ],
  })
  @IsOptional()
  @IsIn([
    "none",
    "returned_to_supplier",
    "retained_by_business",
    "left_with_customer",
    "disposed",
    "follow_up_job",
    "other",
  ])
  public remainingDisposition?: string;
}

export class AttachMaterialEvidenceDto {
  @ApiProperty({ format: "uuid", type: String }) @IsUUID("4") public documentId!: string;
  @ApiProperty({
    enum: ["supplier_ticket", "supplier_receipt", "placement_evidence", "delivery_photo"],
  })
  @IsIn(["supplier_ticket", "supplier_receipt", "placement_evidence", "delivery_photo"])
  public purpose!: string;
}

export class MaterialEvidenceDto {
  @ApiProperty({ format: "uuid", type: String }) public documentId!: string;
  @ApiProperty({ type: String }) public originalFilename!: string;
  @ApiProperty({ type: String }) public mediaType!: string;
  @ApiProperty({ type: String }) public purpose!: string;
}

export class CreateMaterialQuantityVarianceDto {
  @ApiProperty({ enum: ["purchase", "loading", "delivery", "remaining"] })
  @IsIn(["purchase", "loading", "delivery", "remaining"])
  public varianceType!: string;
  @ApiProperty({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public expectedQuantity!: string;
  @ApiProperty({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public actualQuantity!: string;
  @ApiProperty({
    enum: [
      "customer",
      "business",
      "shared",
      "supplier",
      "vendor",
      "insurance",
      "unknown",
      "disputed",
      "not_applicable",
    ],
  })
  @IsIn([
    "customer",
    "business",
    "shared",
    "supplier",
    "vendor",
    "insurance",
    "unknown",
    "disputed",
    "not_applicable",
  ])
  public responsibility!: string;
}

export class ResolveMaterialQuantityVarianceDto {
  @ApiProperty({
    enum: [
      "charge",
      "credit",
      "no_charge",
      "follow_up_job",
      "supplier_adjustment",
      "customer_acceptance",
      "other",
    ],
  })
  @IsIn([
    "charge",
    "credit",
    "no_charge",
    "follow_up_job",
    "supplier_adjustment",
    "customer_acceptance",
    "other",
  ])
  public resolutionType!: string;
  @ApiProperty({ maxLength: 2_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public reason!: string;
}

export class MaterialQuantityVarianceDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public materialLoadItemId!: string;
  @ApiProperty({ type: String }) public varianceType!: string;
  @ApiProperty({ type: String }) public quantityUnit!: string;
  @ApiProperty({ type: String }) public expectedQuantity!: string;
  @ApiProperty({ type: String }) public actualQuantity!: string;
  @ApiProperty({ type: String }) public varianceQuantity!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public responsibility!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public resolutionType!: string | null;
}

export class CreateExpenseDto {
  @ApiProperty({ enum: ["material_purchase", "supplier_fee", "delivery", "disposal", "other"] })
  @IsIn(["material_purchase", "supplier_fee", "delivery", "disposal", "other"])
  public expenseType!: string;
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public supplierId?: string;
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public supplierLocationId?: string;
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public receiptDocumentId?: string;
  @ApiProperty({ minimum: 1, type: Number }) @IsInt() @Min(1) public amountCents!: number;
  @ApiProperty({ maxLength: 300, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  public description!: string;
  @ApiPropertyOptional({ maxLength: 160, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  public externalReference?: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public incurredAt!: string;
}

export class CreateExpenseAllocationDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public materialLoadItemId!: string;
  @ApiProperty({ minimum: 1, type: Number }) @IsInt() @Min(1) public amountCents!: number;
}

export class ExpenseActionDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public receiptDocumentId?: string;
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public reason?: string;
}

export class ExpenseAllocationDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public materialLoadItemId!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public status!: string;
}

export class ExpenseDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public expenseNumber!: string;
  @ApiProperty({ type: String }) public expenseType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public receiptStatus!: string;
  @ApiProperty({ isArray: true, type: ExpenseAllocationDto })
  public allocations!: ExpenseAllocationDto[];
}

export class CreateJobChargeDto {
  @ApiProperty({ enum: ["charge", "credit", "no_charge", "informational"] })
  @IsIn(["charge", "credit", "no_charge", "informational"])
  public chargeKind!: string;
  @ApiProperty({ maxLength: 60, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  public chargeType!: string;
  @ApiProperty({
    enum: [
      "material_delivery_detail",
      "material_load",
      "material_load_item",
      "quantity_variance",
      "route_stop",
      "manual",
    ],
  })
  @IsIn([
    "material_delivery_detail",
    "material_load",
    "material_load_item",
    "quantity_variance",
    "route_stop",
    "manual",
  ])
  public sourceType!: string;
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public sourceId?: string;
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public dedupeKey!: string;
  @ApiProperty({
    enum: ["customer", "business", "shared", "supplier", "vendor", "insurance", "not_applicable"],
  })
  @IsIn(["customer", "business", "shared", "supplier", "vendor", "insurance", "not_applicable"])
  public responsibility!: string;
  @ApiProperty({ enum: ["complete", "waived", "not_required"] })
  @IsIn(["complete", "waived", "not_required"])
  public evidenceStatus!: string;
  @ApiProperty({ enum: ["not_required", "authorized", "waived"] })
  @IsIn(["not_required", "authorized", "waived"])
  public customerAuthorizationStatus!: string;
  @ApiProperty({ enum: ["not_required", "approved", "waived"] })
  @IsIn(["not_required", "approved", "waived"])
  public internalApprovalStatus!: string;
  @ApiPropertyOptional({ pattern: "^(?:0|[1-9]\\d{0,8})(?:\\.\\d{1,3})?$", type: String })
  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  public quantity?: string;
  @ApiPropertyOptional({ maxLength: 40, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  public unit?: string;
  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  public rateCents?: number;
  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  public proposedAmountCents?: number;
  @ApiProperty({ additionalProperties: true, type: Object })
  @IsObject()
  public calculationSnapshot!: Record<string, unknown>;
  @ApiProperty({ maxLength: 300, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  public customerDescription!: string;
  @ApiProperty({ enum: ["taxable", "non_taxable", "tax_included"] })
  @IsIn(["taxable", "non_taxable", "tax_included"])
  public taxBehavior!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsISO8601() public occurredAt!: string;
}

export class JobChargeActionDto {
  @ApiPropertyOptional({ minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  public approvedAmountCents?: number;
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2_000)
  public reason?: string;
}

export class JobChargeDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public chargeNumber!: string;
  @ApiProperty({ type: String }) public chargeKind!: string;
  @ApiProperty({ type: String }) public chargeType!: string;
  @ApiProperty({ type: String }) public sourceType!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public sourceId!: string | null;
  @ApiProperty({ type: String }) public dedupeKey!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public responsibility!: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) public calculatedAmountCents!:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) public proposedAmountCents!: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) public approvedAmountCents!: number | null;
  @ApiProperty({ type: String }) public customerDescription!: string;
}

export class InvoiceReadinessDto {
  @ApiProperty({ type: String }) public result!: string;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
  @ApiProperty({ isArray: true, type: String }) public warnings!: string[];
  @ApiProperty({ format: "date-time", type: String }) public evaluatedAt!: string;
}

export class CreateScheduleBlockDto {
  @ApiProperty({ enum: ["service", "dropoff", "pickup", "disposal", "inspection", "other"] })
  @IsIn(["service", "dropoff", "pickup", "disposal", "inspection", "other"])
  public blockType!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsString() public startsAt!: string;
  @ApiProperty({ format: "date-time", type: String }) @IsString() public endsAt!: string;
  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID("4", { each: true })
  public assetIds!: string[];
  @ApiProperty({ isArray: true, type: String })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID("4", { each: true })
  public userIds!: string[];
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public notes?: string;
}

export class CreateRouteStopDto {
  @ApiProperty({ minimum: 1, type: Number }) @IsInt() @Min(1) public sequence!: number;
  @ApiProperty({
    enum: ["supplier", "customer", "dropoff", "pickup", "disposal", "inspection", "other"],
  })
  @IsIn(["supplier", "customer", "dropoff", "pickup", "disposal", "inspection", "other"])
  public stopType!: string;
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public label!: string;
  @ApiProperty({ additionalProperties: true, type: Object })
  @IsObject()
  public locationSnapshot!: Record<string, unknown>;
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public instructions?: string;
}

export class ChecklistItemInputDto {
  @ApiProperty({ maxLength: 240, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(240)
  public label!: string;
}

export class CreateChecklistDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public checklistTemplateId?: string;
  @ApiPropertyOptional({ maxLength: 100, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  public templateCode?: string;
  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public name?: string;
  @ApiPropertyOptional({ isArray: true, type: ChecklistItemInputDto })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemInputDto)
  public items?: ChecklistItemInputDto[];
}

export class CompleteChecklistItemDto {
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public response?: string;
}

export class ScheduleCalendarResponseDto {
  @ApiProperty({ isArray: true, type: ScheduleBlockDto }) public items!: ScheduleBlockDto[];
}
