import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  IsInt,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

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
export type PaymentMethod = (typeof paymentMethods)[number];

export class AdministrationMetricDto {
  @ApiProperty({ type: Number }) public total!: number;
  @ApiProperty({ type: Number }) public attention!: number;
}

export class AdministrationOverviewDto {
  @ApiProperty({ type: AdministrationMetricDto }) public users!: AdministrationMetricDto;
  @ApiProperty({ type: AdministrationMetricDto }) public assets!: AdministrationMetricDto;
  @ApiProperty({ type: AdministrationMetricDto }) public suppliers!: AdministrationMetricDto;
  @ApiProperty({ type: AdministrationMetricDto }) public paymentAccounts!: AdministrationMetricDto;
  @ApiProperty({ type: AdministrationMetricDto })
  public checklistTemplates!: AdministrationMetricDto;
  @ApiProperty({ type: Number }) public openJobs!: number;
  @ApiProperty({ type: Number }) public pastDueInvoices!: number;
}

export class AdministrationRoleDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public code!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: [String] }) public permissions!: string[];
  @ApiProperty({ type: String }) public status!: string;
}

export class AdministrationUserDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public displayName!: string;
  @ApiProperty({ type: String }) public email!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: [AdministrationRoleDto] }) public roles!: AdministrationRoleDto[];
}

export class AdministrationAssetDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public assetNumber!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: String }) public assetType!: string;
  @ApiProperty({ type: String }) public status!: string;
}

export class AdministrationFacilityDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ nullable: true, type: String }) public addressSummary!: string | null;
  @ApiProperty({ type: String }) public status!: string;
}

export class AdministrationSupplierDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: [AdministrationFacilityDto] })
  public facilities!: AdministrationFacilityDto[];
}

export class CompanyPaymentAccountDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public code!: string;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ enum: paymentMethods, type: String }) public paymentMethod!: PaymentMethod;
  @ApiProperty({ type: String }) public accountReference!: string;
  @ApiProperty({ nullable: true, type: String }) public instructions!: string | null;
  @ApiProperty({ type: Boolean }) public isDefault!: boolean;
  @ApiProperty({ type: String }) public status!: string;
}

export class ChecklistTemplateItemDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public sequence!: number;
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ nullable: true, type: String }) public instructions!: string | null;
  @ApiProperty({ enum: ["confirmation", "text", "number", "photo"], type: String })
  public responseType!: string;
  @ApiProperty({ type: Boolean }) public requiresEvidence!: boolean;
}

export class ChecklistTemplateDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public templateCode!: string;
  @ApiProperty({ type: Number }) public version!: number;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ nullable: true, type: String }) public serviceType!: string | null;
  @ApiProperty({ type: Boolean }) public required!: boolean;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ nullable: true, type: String }) public publishedAt!: string | null;
  @ApiProperty({ type: [ChecklistTemplateItemDto] }) public items!: ChecklistTemplateItemDto[];
}

export class AdministrationAuditEventDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public occurredAt!: string;
  @ApiProperty({ type: String }) public eventType!: string;
  @ApiProperty({ type: String }) public entityType!: string;
  @ApiProperty({ format: "uuid", type: String }) public entityId!: string;
  @ApiProperty({ type: String }) public commandName!: string;
  @ApiProperty({ nullable: true, type: String }) public actorDisplayName!: string | null;
}

export class AdministrationAuditEventListDto {
  @ApiProperty({ type: [AdministrationAuditEventDto] })
  public items!: AdministrationAuditEventDto[];
}

export class AdministrationWorkspaceDto {
  @ApiProperty({ type: AdministrationOverviewDto }) public overview!: AdministrationOverviewDto;
  @ApiProperty({ type: [AdministrationUserDto] }) public users!: AdministrationUserDto[];
  @ApiProperty({ type: [AdministrationRoleDto] }) public roles!: AdministrationRoleDto[];
  @ApiProperty({ type: [AdministrationAssetDto] }) public assets!: AdministrationAssetDto[];
  @ApiProperty({ type: [AdministrationSupplierDto] })
  public suppliers!: AdministrationSupplierDto[];
  @ApiProperty({ type: [CompanyPaymentAccountDto] })
  public paymentAccounts!: CompanyPaymentAccountDto[];
  @ApiProperty({ type: [ChecklistTemplateDto] }) public checklistTemplates!: ChecklistTemplateDto[];
  @ApiProperty({ type: [AdministrationAuditEventDto] })
  public recentAuditEvents!: AdministrationAuditEventDto[];
}

export class AdministrationSearchResultDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ enum: ["customer", "project", "job", "invoice", "payment"], type: String })
  public type!: string;
  @ApiProperty({ type: String }) public primaryLabel!: string;
  @ApiProperty({ type: String }) public secondaryLabel!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public path!: string;
}

export class AdministrationSearchDto {
  @ApiProperty({ type: String }) public query!: string;
  @ApiProperty({ type: [AdministrationSearchResultDto] })
  public items!: AdministrationSearchResultDto[];
}

export class CreateCompanyPaymentAccountDto {
  @ApiProperty({ example: "operating-zelle", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,79}$/)
  public code!: string;

  @ApiProperty({ example: "Lincoln DG Zelle", type: String })
  @IsString()
  @MaxLength(160)
  public name!: string;

  @ApiProperty({ enum: paymentMethods, type: String })
  @IsIn(paymentMethods)
  public paymentMethod!: PaymentMethod;

  @ApiProperty({ example: "billing@lincolndg.example", type: String })
  @IsString()
  @MaxLength(160)
  public accountReference!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public instructions?: string;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  public isDefault?: boolean;
}

export class CreateChecklistTemplateItemDto {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  public sequence!: number;

  @ApiProperty({ type: String })
  @IsString()
  @MaxLength(240)
  public label!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public instructions?: string;

  @ApiProperty({ enum: ["confirmation", "text", "number", "photo"], type: String })
  @IsIn(["confirmation", "text", "number", "photo"])
  public responseType!: string;

  @ApiPropertyOptional({ default: false, type: Boolean })
  @IsOptional()
  @IsBoolean()
  public requiresEvidence?: boolean;
}

export class CreateChecklistTemplateDto {
  @ApiProperty({ example: "delivery-completion", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,99}$/)
  public templateCode!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MaxLength(200)
  public name!: string;

  @ApiPropertyOptional({ enum: ["material_delivery", "dump_trailer_rental"], type: String })
  @IsOptional()
  @IsIn(["material_delivery", "dump_trailer_rental"])
  public serviceType?: string;

  @ApiPropertyOptional({ default: true, type: Boolean })
  @IsOptional()
  @IsBoolean()
  public required?: boolean;

  @ApiProperty({ type: [CreateChecklistTemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistTemplateItemDto)
  public items!: CreateChecklistTemplateItemDto[];
}

export class AssignUserRoleDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public roleId!: string;
}

export class CreateSupplierDto {
  @ApiProperty({ type: String })
  @IsString()
  @MaxLength(200)
  public name!: string;
}

export class CreateSupplierFacilityDto {
  @ApiProperty({ type: String })
  @IsString()
  @MaxLength(160)
  public label!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  public addressSummary?: string;
}
