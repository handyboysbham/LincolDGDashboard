import { ApiProperty } from "@nestjs/swagger";

export class JobFinancialCompletionDto {
  @ApiProperty({ format: "uuid", type: String }) public jobId!: string;
  @ApiProperty({ type: String }) public jobNumber!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: Boolean }) public financiallyComplete!: boolean;
  @ApiProperty({ type: Number }) public postedObligationCount!: number;
  @ApiProperty({ type: Number }) public outstandingCents!: number;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
}

export class FinancialCompletionDto {
  @ApiProperty({ format: "uuid", type: String }) public projectId!: string;
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiProperty({ type: String }) public projectStatus!: string;
  @ApiProperty({ type: Boolean }) public financiallyComplete!: boolean;
  @ApiProperty({ type: Number }) public outstandingInvoiceCents!: number;
  @ApiProperty({ type: Number }) public unresolvedPaymentCents!: number;
  @ApiProperty({ type: Number }) public unresolvedDepositCents!: number;
  @ApiProperty({ type: Number }) public unresolvedCustomerCreditCents!: number;
  @ApiProperty({ type: Number }) public activeRefundCount!: number;
  @ApiProperty({ isArray: true, type: String }) public blockers!: string[];
  @ApiProperty({ isArray: true, type: JobFinancialCompletionDto })
  public jobs!: JobFinancialCompletionDto[];
  @ApiProperty({ format: "date-time", type: String }) public evaluatedAt!: string;
}
