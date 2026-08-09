import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsIn,
  IsDateString,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const invoiceTypes = ["deposit", "final", "additional_charge", "credit_memo"] as const;
export type InvoiceType = (typeof invoiceTypes)[number];

export const invoiceAdjustmentInputTypes = [
  "additional_charge",
  "credit",
  "tax_adjustment",
  "write_off",
  "due_date_extension",
] as const;
export type InvoiceAdjustmentInputType = (typeof invoiceAdjustmentInputTypes)[number];

export class CreateInvoiceDto {
  @ApiProperty({ enum: invoiceTypes })
  @IsIn(invoiceTypes)
  public invoiceType!: InvoiceType;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public jobId?: string;

  @ApiPropertyOptional({ default: 14, maximum: 365, minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  public dueInDays?: number;
}

export const invoiceDeliveryChannels = ["email", "text", "link", "manual"] as const;
export const invoiceDeliveryStatuses = ["sent", "delivered", "failed"] as const;

export class RecordInvoiceDeliveryDto {
  @ApiProperty({ enum: invoiceDeliveryChannels })
  @IsIn(invoiceDeliveryChannels)
  public channel!: (typeof invoiceDeliveryChannels)[number];

  @ApiProperty({ maxLength: 320, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(320)
  public destination!: string;

  @ApiProperty({ enum: invoiceDeliveryStatuses })
  @IsIn(invoiceDeliveryStatuses)
  public status!: (typeof invoiceDeliveryStatuses)[number];

  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601({ strict: true })
  public occurredAt?: string;

  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public providerReference?: string;

  @ApiPropertyOptional({ maxLength: 1_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public failureReason?: string;
}

export class CreateInvoicePublicLinkDto {
  @ApiProperty({ maxLength: 320, type: String })
  @IsEmail()
  @MaxLength(320)
  public recipient!: string;

  @ApiPropertyOptional({ default: 14, maximum: 30, minimum: 1, type: Number })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  public expiresInDays?: number;
}

export class CreateInvoiceAdjustmentDto {
  @ApiProperty({ enum: invoiceAdjustmentInputTypes })
  @IsIn(invoiceAdjustmentInputTypes)
  public adjustmentType!: InvoiceAdjustmentInputType;

  @ApiPropertyOptional({ enum: ["debit", "credit"] })
  @IsOptional()
  @IsIn(["debit", "credit"])
  public direction?: "debit" | "credit";

  @ApiProperty({ minimum: 0, type: Number })
  @IsInt()
  @Min(0)
  public amountCents!: number;

  @ApiProperty({ maxLength: 1_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public reason!: string;

  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601({ strict: true })
  public effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: 50, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  public sourceType?: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public sourceId?: string;

  @ApiPropertyOptional({ format: "date", type: String })
  @IsOptional()
  @IsDateString()
  public newDueDate?: string;
}

export class InvoiceCorrectionReasonDto {
  @ApiProperty({ maxLength: 1_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public reason!: string;
}

export class ReplaceInvoiceDto extends InvoiceCorrectionReasonDto {
  @ApiPropertyOptional({ maximum: 365, minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  public dueInDays?: number;
}

export class InvoiceLineItemDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public lineType!: string;
  @ApiProperty({ type: String }) public direction!: string;
  @ApiProperty({ type: String }) public sourceType!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public sourceId!: string | null;
  @ApiProperty({ type: String }) public description!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public quantity!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public unit!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) public unitPriceCents!: number | null;
  @ApiProperty({ type: Number }) public subtotalCents!: number;
  @ApiProperty({ type: Number }) public taxCents!: number;
  @ApiProperty({ type: Number }) public totalCents!: number;
  @ApiProperty({ type: String }) public taxBehavior!: string;
}

export class InvoiceVersionDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public versionNumber!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public contentHash!: string;
  @ApiProperty({ type: Number }) public subtotalCents!: number;
  @ApiProperty({ type: Number }) public discountCents!: number;
  @ApiProperty({ type: Number }) public taxCents!: number;
  @ApiProperty({ type: Number }) public totalCents!: number;
  @ApiProperty({ type: Number }) public depositApplicationCents!: number;
  @ApiProperty({ type: Number }) public customerCreditApplicationCents!: number;
  @ApiProperty({ type: Number }) public amountDueCents!: number;
  @ApiProperty({ additionalProperties: true, type: Object })
  public billingIdentity!: Record<string, unknown>;
  @ApiProperty({ additionalProperties: true, type: Object })
  public terms!: Record<string, unknown>;
  @ApiProperty({ format: "date-time", type: String }) public preparedAt!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public postedAt!: string | null;
  @ApiProperty({ isArray: true, type: InvoiceLineItemDto })
  public lines!: InvoiceLineItemDto[];
}

export class InvoiceDeliveryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public invoiceVersionId!: string;
  @ApiProperty({ type: String }) public channel!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ additionalProperties: true, type: Object })
  public destination!: Record<string, unknown>;
  @ApiProperty({ format: "date-time", type: String }) public attemptedAt!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public sentAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public deliveredAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public viewedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public failureReason!: string | null;
}

export class InvoiceAdjustmentDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public adjustmentNumber!: string;
  @ApiProperty({ type: String }) public adjustmentType!: string;
  @ApiProperty({ type: String }) public direction!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public reason!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public sourceType!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public sourceId!: string | null;
  @ApiProperty({ format: "date-time", type: String }) public effectiveAt!: string;
  @ApiPropertyOptional({ format: "date", nullable: true, type: String })
  public newDueDate!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public approvedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public postedAt!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public reversesInvoiceAdjustmentId!: string | null;
}

export class InvoicePublicLinkSummaryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public invoiceVersionId!: string;
  @ApiProperty({ type: String }) public recipient!: string;
  @ApiProperty({ format: "date-time", type: String }) public expiresAt!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public revokedAt!: string | null;
  @ApiProperty({ type: Number }) public viewCount!: number;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public lastViewedAt!: string | null;
}

export class InvoiceSummaryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public invoiceNumber!: string;
  @ApiProperty({ type: String }) public invoiceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ format: "uuid", type: String }) public projectId!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public jobId!: string | null;
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public jobNumber!: string | null;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiPropertyOptional({ nullable: true, type: Number }) public totalCents!: number | null;
  @ApiProperty({ type: Number }) public outstandingBalanceCents!: number;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public replacesInvoiceId!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public replacedByInvoiceId!: string | null;
  @ApiPropertyOptional({ format: "date", nullable: true, type: String })
  public issueDate!: string | null;
  @ApiPropertyOptional({ format: "date", nullable: true, type: String })
  public dueDate!: string | null;
  @ApiProperty({ format: "date-time", type: String }) public updatedAt!: string;
}

export class InvoiceDto extends InvoiceSummaryDto {
  @ApiProperty({ isArray: true, type: InvoiceAdjustmentDto })
  public adjustments!: InvoiceAdjustmentDto[];
  @ApiProperty({ isArray: true, type: InvoiceVersionDto }) public versions!: InvoiceVersionDto[];
  @ApiProperty({ isArray: true, type: InvoiceDeliveryDto })
  public deliveries!: InvoiceDeliveryDto[];
  @ApiProperty({ isArray: true, type: InvoicePublicLinkSummaryDto })
  public publicLinks!: InvoicePublicLinkSummaryDto[];
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public voidedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public voidReason!: string | null;
}

export class InvoiceListResponseDto {
  @ApiProperty({ isArray: true, type: InvoiceSummaryDto }) public items!: InvoiceSummaryDto[];
}

export class InvoicePublicLinkDto {
  @ApiProperty({ type: InvoiceDto }) public invoice!: InvoiceDto;
  @ApiProperty({ format: "uuid", type: String }) public linkId!: string;
  @ApiProperty({ type: String }) public customerPath!: string;
  @ApiProperty({ type: String }) public token!: string;
  @ApiProperty({ format: "date-time", type: String }) public expiresAt!: string;
}

export class PublicInvoiceDeliveryDto {
  @ApiProperty({ type: String }) public channel!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ format: "date-time", type: String }) public attemptedAt!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public sentAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public deliveredAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public viewedAt!: string | null;
}

export class PublicInvoiceAdjustmentDto {
  @ApiProperty({ type: String }) public adjustmentNumber!: string;
  @ApiProperty({ type: String }) public adjustmentType!: string;
  @ApiProperty({ type: String }) public direction!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ format: "date-time", type: String }) public effectiveAt!: string;
}

export class PublicInvoiceDto {
  @ApiProperty({ type: String }) public invoiceNumber!: string;
  @ApiProperty({ type: String }) public invoiceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public jobNumber!: string | null;
  @ApiPropertyOptional({ format: "date", nullable: true, type: String })
  public issueDate!: string | null;
  @ApiPropertyOptional({ format: "date", nullable: true, type: String })
  public dueDate!: string | null;
  @ApiProperty({ type: Number }) public versionNumber!: number;
  @ApiProperty({ type: Number }) public subtotalCents!: number;
  @ApiProperty({ type: Number }) public taxCents!: number;
  @ApiProperty({ type: Number }) public totalCents!: number;
  @ApiProperty({ type: Number }) public appliedCents!: number;
  @ApiProperty({ type: Number }) public outstandingBalanceCents!: number;
  @ApiProperty({ isArray: true, type: InvoiceLineItemDto }) public lines!: InvoiceLineItemDto[];
  @ApiProperty({ isArray: true, type: PublicInvoiceAdjustmentDto })
  public adjustments!: PublicInvoiceAdjustmentDto[];
  @ApiProperty({ isArray: true, type: PublicInvoiceDeliveryDto })
  public deliveries!: PublicInvoiceDeliveryDto[];
}
