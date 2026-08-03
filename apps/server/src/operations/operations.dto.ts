import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
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
  @ApiProperty({ maxLength: 100, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  public templateCode!: string;
  @ApiProperty({ maxLength: 200, type: String })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  public name!: string;
  @ApiProperty({ isArray: true, type: ChecklistItemInputDto })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemInputDto)
  public items!: ChecklistItemInputDto[];
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
