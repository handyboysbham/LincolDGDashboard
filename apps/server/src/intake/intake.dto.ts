import { Type } from "class-transformer";
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const customerTypes = ["individual", "business"] as const;
const contactMethods = ["phone", "email", "text"] as const;
const leadSources = ["phone", "website", "email", "referral", "repeat", "other"] as const;
const serviceTypes = ["material_delivery", "dump_trailer_rental"] as const;
const quantityUnits = ["tons", "cubic_yards", "loads"] as const;
const leadStatuses = [
  "new",
  "contacting",
  "qualified",
  "estimating",
  "quoted",
  "accepted",
  "lost",
  "cancelled",
  "duplicate",
  "disqualified",
] as const;

export class NewCustomerAccountDto {
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public displayName!: string;

  @ApiProperty({ enum: customerTypes, type: String })
  @IsIn(customerTypes)
  public customerType!: (typeof customerTypes)[number];

  @ApiPropertyOptional({ enum: contactMethods, type: String })
  @IsOptional()
  @IsIn(contactMethods)
  public preferredContactMethod?: (typeof contactMethods)[number];

  @ApiPropertyOptional({ maxLength: 1_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  public billingContactSummary?: string;
}

export class NewContactDto {
  @ApiProperty({ maxLength: 100, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public firstName!: string;

  @ApiProperty({ maxLength: 100, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public lastName!: string;

  @ApiPropertyOptional({ maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public email?: string;

  @ApiPropertyOptional({ maxLength: 40, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  public phone?: string;

  @ApiProperty({ enum: contactMethods, type: String })
  @IsIn(contactMethods)
  public preferredContactMethod!: (typeof contactMethods)[number];
}

export class NewServiceLocationDto {
  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public label!: string;

  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public addressLine1!: string;

  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public addressLine2?: string;

  @ApiProperty({ maxLength: 120, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  public city!: string;

  @ApiProperty({ maxLength: 80, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  public region!: string;

  @ApiProperty({ maxLength: 20, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  public postalCode!: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public accessNotes?: string;
}

export class MaterialDeliveryLeadInputDto {
  @ApiProperty({ maxLength: 240, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  public materialDescription!: string;

  @ApiProperty({
    description: "Positive decimal with no more than three fractional digits",
    type: String,
  })
  @IsString()
  @Matches(/^\d{1,9}(?:\.\d{1,3})?$/)
  public estimatedQuantity!: string;

  @ApiProperty({ enum: quantityUnits, type: String })
  @IsIn(quantityUnits)
  public quantityUnit!: (typeof quantityUnits)[number];

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public deliveryInstructions?: string;
}

export class DumpTrailerRentalLeadInputDto {
  @ApiProperty({ format: "date", type: String })
  @IsDateString({ strict: true })
  public rentalStartDate!: string;

  @ApiProperty({ format: "date", type: String })
  @IsDateString({ strict: true })
  public rentalEndDate!: string;

  @ApiProperty({ maxLength: 160, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public debrisType!: string;

  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public deliveryInstructions?: string;
}

export class CreateIntakeLeadDto {
  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public customerAccountId?: string;

  @ApiPropertyOptional({ type: NewCustomerAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerAccountDto)
  public customer?: NewCustomerAccountDto;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public primaryContactId?: string;

  @ApiPropertyOptional({ type: NewContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewContactDto)
  public primaryContact?: NewContactDto;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public serviceLocationId?: string;

  @ApiPropertyOptional({ type: NewServiceLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewServiceLocationDto)
  public serviceLocation?: NewServiceLocationDto;

  @ApiProperty({ enum: serviceTypes, type: String })
  @IsIn(serviceTypes)
  public serviceType!: (typeof serviceTypes)[number];

  @ApiProperty({ enum: leadSources, type: String })
  @IsIn(leadSources)
  public source!: (typeof leadSources)[number];

  @ApiProperty({ maxLength: 300, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  public summary!: string;

  @ApiPropertyOptional({ type: MaterialDeliveryLeadInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MaterialDeliveryLeadInputDto)
  public materialDelivery?: MaterialDeliveryLeadInputDto;

  @ApiPropertyOptional({ type: DumpTrailerRentalLeadInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DumpTrailerRentalLeadInputDto)
  public dumpTrailerRental?: DumpTrailerRentalLeadInputDto;
}

export class DuplicateCheckDto {
  @ApiPropertyOptional({ maxLength: 200, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  public customerName?: string;

  @ApiPropertyOptional({ maxLength: 320, type: String })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  public email?: string;

  @ApiPropertyOptional({ maxLength: 40, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  public phone?: string;

  @ApiPropertyOptional({ type: NewServiceLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewServiceLocationDto)
  public serviceLocation?: NewServiceLocationDto;
}

export class DuplicateWarningDto {
  @ApiProperty({
    enum: ["customer_name", "contact_email", "contact_phone", "service_address"],
    type: String,
  })
  public code!: string;

  @ApiProperty({ enum: ["CustomerAccount", "Contact", "ServiceLocation"], type: String })
  public entityType!: string;

  @ApiProperty({ format: "uuid", type: String })
  public entityId!: string;

  @ApiProperty({ type: String })
  public display!: string;
}

export class DuplicateCheckResponseDto {
  @ApiProperty({ isArray: true, type: DuplicateWarningDto })
  public warnings!: DuplicateWarningDto[];
}

export class CustomerAccountDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public displayName!: string;

  @ApiProperty({ enum: customerTypes, type: String })
  public customerType!: string;

  @ApiProperty({ enum: ["active", "inactive"], type: String })
  public status!: string;

  @ApiPropertyOptional({ enum: contactMethods, nullable: true, type: String })
  public preferredContactMethod!: string | null;

  @ApiProperty({ type: String })
  public createdAt!: string;
}

export class ContactDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public displayName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  public email!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  public phone!: string | null;

  @ApiProperty({ enum: contactMethods, type: String })
  public preferredContactMethod!: string;
}

export class ServiceLocationDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public label!: string;

  @ApiProperty({ type: String })
  public addressLine1!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  public addressLine2!: string | null;

  @ApiProperty({ type: String })
  public city!: string;

  @ApiProperty({ type: String })
  public region!: string;

  @ApiProperty({ type: String })
  public postalCode!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  public accessNotes!: string | null;
}

export class LeadDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public leadNumber!: string;

  @ApiProperty({ enum: serviceTypes, type: String })
  public serviceType!: string;

  @ApiProperty({ enum: leadStatuses, type: String })
  public status!: string;

  @ApiProperty({ enum: leadSources, type: String })
  public source!: string;

  @ApiProperty({ type: String })
  public summary!: string;

  @ApiProperty({ type: CustomerAccountDto })
  public customer!: CustomerAccountDto;

  @ApiProperty({ type: ContactDto })
  public primaryContact!: ContactDto;

  @ApiProperty({ type: ServiceLocationDto })
  public serviceLocation!: ServiceLocationDto;

  @ApiPropertyOptional({ type: MaterialDeliveryLeadInputDto, nullable: true })
  public materialDelivery!: MaterialDeliveryLeadInputDto | null;

  @ApiPropertyOptional({ type: DumpTrailerRentalLeadInputDto, nullable: true })
  public dumpTrailerRental!: DumpTrailerRentalLeadInputDto | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  public terminalReason!: string | null;

  @ApiProperty({ type: String })
  public createdAt!: string;

  @ApiProperty({ type: String })
  public updatedAt!: string;
}

export class CreateIntakeLeadResponseDto {
  @ApiProperty({ type: LeadDto })
  public lead!: LeadDto;

  @ApiProperty({ isArray: true, type: DuplicateWarningDto })
  public duplicateWarnings!: DuplicateWarningDto[];
}

export class CustomerListResponseDto {
  @ApiProperty({ isArray: true, type: CustomerAccountDto })
  public items!: CustomerAccountDto[];

  @ApiProperty({ type: Number })
  public total!: number;
}

export class LeadListResponseDto {
  @ApiProperty({ isArray: true, type: LeadDto })
  public items!: LeadDto[];

  @ApiProperty({ type: Number })
  public total!: number;
}

export class LeadNoteDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public body!: string;

  @ApiProperty({ enum: ["internal", "customer"], type: String })
  public visibility!: string;

  @ApiProperty({ type: String })
  public createdAt!: string;
}

export class LeadTaskDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public title!: string;

  @ApiProperty({ enum: ["open", "completed", "cancelled"], type: String })
  public status!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  public dueAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  public completedAt!: string | null;
}

export class LeadDocumentDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public originalFilename!: string;

  @ApiProperty({ type: String })
  public mediaType!: string;

  @ApiProperty({ type: String })
  public purpose!: string;
}

export class LeadTimelineItemDto {
  @ApiProperty({ format: "uuid", type: String })
  public id!: string;

  @ApiProperty({ type: String })
  public eventType!: string;

  @ApiProperty({ type: String })
  public occurredAt!: string;

  @ApiProperty({ additionalProperties: true, type: Object })
  public metadata!: Record<string, unknown>;
}

export class LeadDetailDto extends LeadDto {
  @ApiProperty({ isArray: true, type: LeadNoteDto })
  public notes!: LeadNoteDto[];

  @ApiProperty({ isArray: true, type: LeadTaskDto })
  public tasks!: LeadTaskDto[];

  @ApiProperty({ isArray: true, type: LeadDocumentDto })
  public documents!: LeadDocumentDto[];

  @ApiProperty({ isArray: true, type: LeadTimelineItemDto })
  public timeline!: LeadTimelineItemDto[];
}

export class CustomerDetailDto extends CustomerAccountDto {
  @ApiProperty({ isArray: true, type: ContactDto })
  public contacts!: ContactDto[];

  @ApiProperty({ isArray: true, type: ServiceLocationDto })
  public serviceLocations!: ServiceLocationDto[];

  @ApiProperty({ isArray: true, type: LeadDto })
  public leads!: LeadDto[];
}

export class CreateLeadNoteDto {
  @ApiProperty({ maxLength: 5_000, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  public body!: string;

  @ApiPropertyOptional({ enum: ["internal", "customer"], default: "internal", type: String })
  @IsOptional()
  @IsIn(["internal", "customer"])
  public visibility?: "internal" | "customer";
}

export class CreateLeadTaskDto {
  @ApiProperty({ maxLength: 240, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  public title!: string;

  @ApiPropertyOptional({ format: "date-time", type: String })
  @IsOptional()
  @IsDateString()
  public dueAt?: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public assignedUserId?: string;
}

export class LinkLeadDocumentDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public documentId!: string;

  @ApiProperty({ maxLength: 100, type: String })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public purpose!: string;
}

export class TransitionLeadDto {
  @ApiPropertyOptional({ maxLength: 2_000, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public reason?: string;
}
