import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export const paymentMethods = [
  "cash",
  "zelle",
  "venmo",
  "cash_app",
  "paypal",
  "card",
  "bank_transfer",
  "check",
] as const;

export const paymentReceiptStatuses = [
  "missing",
  "attached",
  "issued",
  "waived",
  "not_required",
] as const;

export const advanceDepositTypes = ["advance_payment", "split_advance"] as const;

export const customerCreditCreationSources = [
  "unapplied_payment",
  "overpayment",
  "credit_memo",
] as const;

export const refundSourceTypes = ["payment", "deposit", "customer_credit"] as const;

export class CreatePaymentDto {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public amountCents!: number;

  @ApiPropertyOptional({ default: "USD", pattern: "^[A-Z]{3}$", type: String })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  public currency?: string;

  @ApiProperty({ enum: paymentMethods })
  @IsIn(paymentMethods)
  public paymentMethod!: (typeof paymentMethods)[number];

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public companyPaymentAccountId?: string;

  @ApiPropertyOptional({ maxLength: 160, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  public receivingAccountReference?: string;

  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public payerName!: string;

  @ApiPropertyOptional({ maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public payerEmail?: string;

  @ApiPropertyOptional({ maxLength: 80, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  public providerName?: string;

  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public providerTransactionId?: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public evidenceDocumentId?: string;

  @ApiPropertyOptional({ enum: paymentReceiptStatuses })
  @IsOptional()
  @IsIn(paymentReceiptStatuses)
  public receiptStatus?: (typeof paymentReceiptStatuses)[number];

  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsISO8601({ strict: true })
  public receivedAt?: string;
}

export class ApplyValueDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public invoiceId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public amountCents!: number;
}

export class FinancialReversalDto {
  @ApiProperty({ maxLength: 1_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public reason!: string;
}

export class CreateRefundDto {
  @ApiProperty({ enum: refundSourceTypes })
  @IsIn(refundSourceTypes)
  public sourceType!: (typeof refundSourceTypes)[number];

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public sourceId!: string;

  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public amountCents!: number;

  @ApiProperty({ enum: paymentMethods })
  @IsIn(paymentMethods)
  public refundMethod!: (typeof paymentMethods)[number];

  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public payeeName!: string;

  @ApiPropertyOptional({ maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public payeeEmail?: string;

  @ApiProperty({ maxLength: 1_000, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public reason!: string;

  @ApiPropertyOptional({ maxLength: 1_000, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  public alternateMethodReason?: string;
}

export class ApproveRefundDto {
  @ApiPropertyOptional({ maxLength: 300, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  public identityVerificationReference?: string;
}

export class ProcessRefundDto {
  @ApiPropertyOptional({ maxLength: 80, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  public providerName?: string;

  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public providerRefundId?: string;
}

export class CreateDepositBalanceDto {
  @ApiPropertyOptional({ default: "advance_payment", enum: advanceDepositTypes })
  @IsOptional()
  @IsIn(advanceDepositTypes)
  public depositType?: (typeof advanceDepositTypes)[number];
}

export class CreateCustomerCreditDto {
  @ApiProperty({ enum: customerCreditCreationSources })
  @IsIn(customerCreditCreationSources)
  public sourceType!: (typeof customerCreditCreationSources)[number];

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public sourceId!: string;

  @ApiPropertyOptional({ maxLength: 300, type: String })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  public description?: string;
}

export class ValueApplicationDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public invoiceId!: string;
  @ApiProperty({ enum: ["application", "reversal"] }) public entryKind!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public reversesApplicationId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public reason!: string | null;
  @ApiProperty({ format: "date-time", type: String }) public appliedAt!: string;
}

export class PaymentDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public paymentNumber!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiProperty({ type: String }) public customerName!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public projectId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public projectNumber!: string | null;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: Number }) public allocatedCents!: number;
  @ApiProperty({ type: Number }) public customerCreditCents!: number;
  @ApiProperty({ type: Number }) public refundedCents!: number;
  @ApiProperty({ type: Number }) public availableCents!: number;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: String }) public paymentMethod!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public companyPaymentAccountId!: string | null;
  @ApiProperty({ type: String }) public receivingAccountReference!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public providerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public providerTransactionId!: string | null;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ additionalProperties: true, type: Object })
  public payer!: Record<string, unknown>;
  @ApiProperty({ type: String }) public receiptStatus!: string;
  @ApiProperty({ format: "date-time", type: String }) public receivedAt!: string;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public verifiedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public settledAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public reversedAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public reversalReason!: string | null;
  @ApiProperty({ isArray: true, type: ValueApplicationDto })
  public allocations!: ValueApplicationDto[];
}

export class PaymentListResponseDto {
  @ApiProperty({ isArray: true, type: PaymentDto }) public items!: PaymentDto[];
}

export class DepositBalanceDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public projectId!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiProperty({ format: "uuid", type: String }) public sourcePaymentAllocationId!: string;
  @ApiProperty({ type: String }) public depositType!: string;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: Number }) public originalAmountCents!: number;
  @ApiProperty({ type: Number }) public appliedCents!: number;
  @ApiProperty({ type: Number }) public refundedCents!: number;
  @ApiProperty({ type: Number }) public availableCents!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ isArray: true, type: ValueApplicationDto })
  public applications!: ValueApplicationDto[];
}

export class DepositBalanceListResponseDto {
  @ApiProperty({ isArray: true, type: DepositBalanceDto }) public items!: DepositBalanceDto[];
}

export class CustomerCreditDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public creditNumber!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public projectId!: string | null;
  @ApiProperty({ type: String }) public sourceType!: string;
  @ApiProperty({ format: "uuid", type: String }) public sourceId!: string;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: Number }) public originalAmountCents!: number;
  @ApiProperty({ type: Number }) public appliedCents!: number;
  @ApiProperty({ type: Number }) public refundedCents!: number;
  @ApiProperty({ type: Number }) public availableCents!: number;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public description!: string;
  @ApiProperty({ isArray: true, type: ValueApplicationDto })
  public applications!: ValueApplicationDto[];
}

export class CustomerCreditListResponseDto {
  @ApiProperty({ isArray: true, type: CustomerCreditDto }) public items!: CustomerCreditDto[];
}

export class RefundDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public refundNumber!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public projectId!: string | null;
  @ApiProperty({ enum: refundSourceTypes }) public sourceType!: string;
  @ApiProperty({ format: "uuid", type: String }) public sourceId!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: String }) public refundMethod!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) public originalMethod!: string | null;
  @ApiProperty({ additionalProperties: true, type: Object })
  public payee!: Record<string, unknown>;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public reason!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  public alternateMethodReason!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public approvedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public processedAt!: string | null;
  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  public settledAt!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) public providerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  public providerRefundId!: string | null;
  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  public reversesRefundId!: string | null;
}

export class RefundListResponseDto {
  @ApiProperty({ isArray: true, type: RefundDto }) public items!: RefundDto[];
}
