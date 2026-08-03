import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
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
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const serviceTypes = ["material_delivery", "dump_trailer_rental"] as const;
const quantityUnits = ["tons", "cubic_yards", "loads"] as const;
const pricingStatuses = ["draft", "active", "retired"] as const;
const estimateStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "quote_generated",
  "superseded",
] as const;
const quoteStatuses = [
  "draft",
  "ready_to_send",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
  "superseded",
] as const;

export class MaterialPricingReferenceInputDto {
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public materialName!: string;

  @ApiProperty({ enum: quantityUnits, type: String })
  @IsIn(quantityUnits)
  public unit!: (typeof quantityUnits)[number];

  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public supplierName!: string;

  @ApiProperty({ maxLength: 160, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public supplierLocationName!: string;

  @ApiPropertyOptional({ maxLength: 400, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  public supplierAddressSummary?: string;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public unitCostCents!: number;
}

export class DeliveryZoneInputDto {
  @ApiProperty({ maxLength: 80, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  public code!: string;

  @ApiProperty({ maxLength: 160, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public name!: string;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public baseFeeCents!: number;
}

export class MaterialPricingConfigurationInputDto {
  @ApiProperty({ isArray: true, type: MaterialPricingReferenceInputDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => MaterialPricingReferenceInputDto)
  public materials!: MaterialPricingReferenceInputDto[];

  @ApiProperty({ type: DeliveryZoneInputDto })
  @ValidateNested()
  @Type(() => DeliveryZoneInputDto)
  public deliveryZone!: DeliveryZoneInputDto;

  @ApiProperty({ maximum: 100_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100_000)
  public markupBasisPoints!: number;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public additionalSupplierStopCents!: number;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public separatePlacementCents!: number;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public depositMinimumCents!: number;

  @ApiProperty({ maximum: 100_000, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(100_000)
  public depositRoundUpToCents!: number;
}

export class RentalPricingConfigurationInputDto {
  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public packageAmountCents!: number;

  @ApiProperty({ maximum: 365, minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(365)
  public includedDays!: number;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public additionalDayCents!: number;

  @ApiProperty({ maximum: 100_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100_000)
  public includedWeightPounds!: number;

  @ApiProperty({ maximum: 100_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100_000)
  public overageRateCentsPerPound!: number;

  @ApiProperty({ maximum: 10_000_000, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  public securityDepositCents!: number;
}

export class CreatePricingConfigurationDto {
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public policyName!: string;

  @ApiProperty({ enum: serviceTypes, type: String })
  @IsIn(serviceTypes)
  public serviceType!: (typeof serviceTypes)[number];

  @ApiPropertyOptional({ type: MaterialPricingConfigurationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MaterialPricingConfigurationInputDto)
  public materialDelivery?: MaterialPricingConfigurationInputDto;

  @ApiPropertyOptional({ type: RentalPricingConfigurationInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RentalPricingConfigurationInputDto)
  public dumpTrailerRental?: RentalPricingConfigurationInputDto;
}

export class PricingRuleDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public code!: string;

  @ApiProperty({ type: String })
  public label!: string;

  @ApiProperty({ type: String })
  public calculationType!: string;

  @ApiProperty({ type: Number })
  public sequence!: number;

  @ApiProperty({ additionalProperties: true, type: Object })
  public parameters!: Record<string, unknown>;
}

export class PricingVersionDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ enum: pricingStatuses, type: String })
  public status!: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public effectiveAt!: string | null;

  @ApiProperty({ isArray: true, type: PricingRuleDto })
  public rules!: PricingRuleDto[];
}

export class PricingPolicyDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public name!: string;

  @ApiProperty({ enum: serviceTypes, type: String })
  public serviceType!: string;

  @ApiProperty({ enum: pricingStatuses, type: String })
  public status!: string;

  @ApiProperty({ isArray: true, type: PricingVersionDto })
  public versions!: PricingVersionDto[];
}

export class SupplierCostDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public materialName!: string;

  @ApiProperty({ type: String })
  public supplierName!: string;

  @ApiProperty({ type: String })
  public supplierLocationName!: string;

  @ApiProperty({ enum: quantityUnits, type: String })
  public unit!: string;

  @ApiProperty({ type: Number })
  public unitCostCents!: number;

  @ApiProperty({ enum: ["active", "superseded"], type: String })
  public status!: string;
}

export class DeliveryZoneDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public code!: string;

  @ApiProperty({ type: String })
  public name!: string;

  @ApiProperty({ type: Number })
  public baseFeeCents!: number;
}

export class PricingConfigurationListDto {
  @ApiProperty({ isArray: true, type: PricingPolicyDto })
  public policies!: PricingPolicyDto[];

  @ApiProperty({ isArray: true, type: SupplierCostDto })
  public supplierCosts!: SupplierCostDto[];

  @ApiProperty({ isArray: true, type: DeliveryZoneDto })
  public deliveryZones!: DeliveryZoneDto[];
}

export class CreatePricingConfigurationResponseDto {
  @ApiProperty({ type: PricingPolicyDto })
  public policy!: PricingPolicyDto;

  @ApiProperty({ isArray: true, type: SupplierCostDto })
  public supplierCosts!: SupplierCostDto[];

  @ApiPropertyOptional({ nullable: true, type: DeliveryZoneDto })
  public deliveryZone!: DeliveryZoneDto | null;
}

export class MaterialEstimateItemInputDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public supplierCostVersionId!: string;

  @ApiProperty({
    description: "Positive decimal with at most three fractional digits",
    type: String,
  })
  @IsString()
  @Matches(/^\d{1,9}(?:\.\d{1,3})?$/)
  public quantity!: string;
}

export class MaterialEstimateInputDto {
  @ApiProperty({ isArray: true, type: MaterialEstimateItemInputDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => MaterialEstimateItemInputDto)
  public items!: MaterialEstimateItemInputDto[];

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public deliveryZoneId!: string;

  @ApiProperty({ maximum: 100, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100)
  public additionalSupplierStops!: number;

  @ApiProperty({ maximum: 100, minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  @Max(100)
  public separatePlacements!: number;
}

export class CreateEstimateVersionDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public pricingVersionId!: string;

  @ApiPropertyOptional({ type: MaterialEstimateInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MaterialEstimateInputDto)
  public materialDelivery?: MaterialEstimateInputDto;

  @ApiPropertyOptional({ maxLength: 5_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  public operationalAssessment?: string;

  @ApiPropertyOptional({ maxLength: 5_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  public riskAssessment?: string;
}

export class EstimateCostItemDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public description!: string;

  @ApiProperty({ type: String })
  public quantity!: string;

  @ApiProperty({ type: String })
  public unit!: string;

  @ApiProperty({ type: Number })
  public unitCostCents!: number;

  @ApiProperty({ type: Number })
  public totalCostCents!: number;
}

export class PricingCalculationResultDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public code!: string;

  @ApiProperty({ type: String })
  public label!: string;

  @ApiProperty({ type: String })
  public calculationType!: string;

  @ApiProperty({ type: Number })
  public amountCents!: number;

  @ApiProperty({ additionalProperties: true, type: Object })
  public details!: Record<string, unknown>;
}

export class EstimateVersionDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ format: "uuid", type: String })
  public estimateId!: string;

  @ApiProperty({ type: String })
  public estimateNumber!: string;

  @ApiProperty({ format: "uuid", type: String })
  public leadId!: string;

  @ApiProperty({ type: String })
  public leadNumber!: string;

  @ApiProperty({ type: String })
  public customerName!: string;

  @ApiProperty({ enum: serviceTypes, type: String })
  public serviceType!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ enum: estimateStatuses, type: String })
  public status!: string;

  @ApiProperty({ type: String })
  public pricingPolicyName!: string;

  @ApiProperty({ format: "uuid", type: String })
  public pricingVersionId!: string;

  @ApiProperty({ type: Number })
  public pricingVersionNumber!: number;

  @ApiProperty({ type: String })
  public readiness!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  public operationalAssessment!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  public riskAssessment!: string | null;

  @ApiProperty({ type: Number })
  public purchaseCostCents!: number;

  @ApiProperty({ type: Number })
  public recommendedPriceCents!: number;

  @ApiPropertyOptional({ nullable: true, type: Number })
  public approvedQuotePriceCents!: number | null;

  @ApiProperty({ type: Number })
  public depositCents!: number;

  @ApiProperty({ type: Number })
  public marginCents!: number;

  @ApiProperty({ type: String })
  public contentHash!: string;

  @ApiProperty({ additionalProperties: true, type: Object })
  public inputSnapshot!: Record<string, unknown>;

  @ApiProperty({ isArray: true, type: EstimateCostItemDto })
  public costItems!: EstimateCostItemDto[];

  @ApiProperty({ isArray: true, type: PricingCalculationResultDto })
  public calculations!: PricingCalculationResultDto[];

  @ApiProperty({ type: String })
  public createdAt!: string;
}

export class EstimateListItemDto {
  @ApiProperty({ format: "uuid", type: String })
  public estimateId!: string;

  @ApiProperty({ format: "uuid", type: String })
  public estimateVersionId!: string;

  @ApiProperty({ type: String })
  public estimateNumber!: string;

  @ApiProperty({ format: "uuid", type: String })
  public leadId!: string;

  @ApiProperty({ type: String })
  public leadNumber!: string;

  @ApiProperty({ type: String })
  public customerName!: string;

  @ApiProperty({ enum: serviceTypes, type: String })
  public serviceType!: string;

  @ApiProperty({ type: String })
  public status!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ type: Number })
  public recommendedPriceCents!: number;

  @ApiProperty({ type: String })
  public updatedAt!: string;
}

export class EstimateListResponseDto {
  @ApiProperty({ isArray: true, type: EstimateListItemDto })
  public items!: EstimateListItemDto[];
}

export class QuoteLineItemDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public description!: string;

  @ApiProperty({ type: String })
  public quantity!: string;

  @ApiProperty({ type: String })
  public unit!: string;

  @ApiProperty({ type: Number })
  public unitPriceCents!: number;

  @ApiProperty({ type: Number })
  public totalCents!: number;
}

export class QuoteTermDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public title!: string;

  @ApiProperty({ type: String })
  public body!: string;
}

export class QuoteDeliveryDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public channel!: string;

  @ApiProperty({ type: String })
  public recipient!: string;

  @ApiProperty({ type: String })
  public sentAt!: string;
}

export class QuoteVersionDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ format: "uuid", type: String })
  public quoteId!: string;

  @ApiProperty({ type: String })
  public quoteNumber!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ enum: quoteStatuses, type: String })
  public status!: string;

  @ApiProperty({ type: String })
  public serviceType!: string;

  @ApiProperty({ type: String })
  public customerName!: string;

  @ApiProperty({ type: String })
  public customerEmail!: string;

  @ApiProperty({ type: String })
  public locationLabel!: string;

  @ApiProperty({ type: String })
  public scope!: string;

  @ApiProperty({ type: Number })
  public subtotalCents!: number;

  @ApiProperty({ type: Number })
  public adjustmentCents!: number;

  @ApiProperty({ type: Number })
  public taxCents!: number;

  @ApiProperty({ type: Number })
  public totalCents!: number;

  @ApiProperty({ type: Number })
  public requiredDepositCents!: number;

  @ApiProperty({ type: String })
  public contentHash!: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public issuedAt!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public expiresAt!: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public viewedAt!: string | null;

  @ApiProperty({ isArray: true, type: QuoteLineItemDto })
  public lineItems!: QuoteLineItemDto[];

  @ApiProperty({ isArray: true, type: QuoteTermDto })
  public terms!: QuoteTermDto[];

  @ApiProperty({ isArray: true, type: QuoteDeliveryDto })
  public deliveries!: QuoteDeliveryDto[];
}

export class QuoteListItemDto {
  @ApiProperty({ format: "uuid", type: String })
  public quoteId!: string;

  @ApiProperty({ format: "uuid", type: String })
  public quoteVersionId!: string;

  @ApiProperty({ type: String })
  public quoteNumber!: string;

  @ApiProperty({ type: String })
  public customerName!: string;

  @ApiProperty({ type: String })
  public serviceType!: string;

  @ApiProperty({ type: String })
  public status!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ type: Number })
  public totalCents!: number;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public expiresAt!: string | null;

  @ApiProperty({ type: String })
  public updatedAt!: string;
}

export class QuoteListResponseDto {
  @ApiProperty({ isArray: true, type: QuoteListItemDto })
  public items!: QuoteListItemDto[];
}

export class SendQuoteDto {
  @ApiProperty({ enum: ["email", "text", "link"], type: String })
  @IsIn(["email", "text", "link"])
  public channel!: "email" | "link" | "text";

  @ApiProperty({ maxLength: 320, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  public recipient!: string;

  @ApiPropertyOptional({ default: 10, maximum: 30, minimum: 1, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  public expiresInDays?: number;
}

export class SendQuoteResponseDto {
  @ApiProperty({ type: QuoteVersionDto })
  public quote!: QuoteVersionDto;

  @ApiProperty({
    description: "Plaintext capability returned only by the send command",
    type: String,
  })
  public token!: string;

  @ApiProperty({ type: String })
  public customerPath!: string;
}

export class PublicQuoteDto {
  @ApiProperty({ type: String })
  public quoteNumber!: string;

  @ApiProperty({ type: Number })
  public versionNumber!: number;

  @ApiProperty({ type: String })
  public status!: string;

  @ApiProperty({ type: String })
  public customerName!: string;

  @ApiProperty({ type: String })
  public serviceType!: string;

  @ApiProperty({ type: String })
  public locationSummary!: string;

  @ApiProperty({ type: String })
  public scope!: string;

  @ApiProperty({ type: Number })
  public subtotalCents!: number;

  @ApiProperty({ type: Number })
  public adjustmentCents!: number;

  @ApiProperty({ type: Number })
  public taxCents!: number;

  @ApiProperty({ type: Number })
  public totalCents!: number;

  @ApiProperty({ type: Number })
  public requiredDepositCents!: number;

  @ApiProperty({ type: String })
  public contentHash!: string;

  @ApiProperty({ format: "date-time", type: String })
  public expiresAt!: string;

  @ApiProperty({ isArray: true, type: QuoteLineItemDto })
  public lineItems!: QuoteLineItemDto[];

  @ApiProperty({ isArray: true, type: QuoteTermDto })
  public terms!: QuoteTermDto[];
}

export class AcceptQuoteDto {
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public acceptedName!: string;

  @ApiProperty({ minLength: 64, type: String })
  @Matches(/^[a-f0-9]{64}$/i)
  public contentHash!: string;

  @ApiProperty({ maxLength: 2_000, type: String })
  @IsString()
  @MinLength(10)
  @MaxLength(2_000)
  public consentText!: string;
}

export class DeclineQuoteDto {
  @ApiProperty({ maxLength: 1_000, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(1_000)
  public reason!: string;
}

export class ProjectDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public projectNumber!: string;

  @ApiProperty({ type: String })
  public status!: string;

  @ApiProperty({ type: String })
  public serviceType!: string;

  @ApiProperty({ type: String })
  public outcomeStatement!: string;
}

export class AcceptQuoteResponseDto {
  @ApiProperty({ format: "uuid", type: String })
  public acceptanceId!: string;

  @ApiProperty({ format: "date-time", type: String })
  public acceptedAt!: string;

  @ApiProperty({ type: ProjectDto })
  public project!: ProjectDto;
}
