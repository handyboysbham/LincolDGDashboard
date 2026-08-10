import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const notificationChannels = ["email", "sms"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

export class CreateNotificationTemplateDto {
  @ApiProperty({ example: "schedule.confirmed", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,99}$/)
  public templateKey!: string;

  @ApiProperty({ enum: notificationChannels, type: String })
  @IsIn(notificationChannels)
  public channel!: NotificationChannel;

  @ApiProperty({ example: "Schedule confirmation", type: String })
  @IsString()
  @MaxLength(160)
  public name!: string;

  @ApiPropertyOptional({ example: "Your Lincoln Dirt and Gravel schedule", type: String })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  public subjectTemplate?: string;

  @ApiProperty({
    example: "Hello {{customerName}}, your service is scheduled for {{scheduledAt}}.",
    type: String,
  })
  @IsString()
  @MaxLength(10_000)
  public bodyTemplate!: string;

  @ApiProperty({ example: ["customerName", "scheduledAt"], type: [String] })
  @IsArray()
  @IsString({ each: true })
  public allowedVariables!: string[];
}

export class NotificationTemplateDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: String }) public templateKey!: string;
  @ApiProperty({ enum: notificationChannels, type: String }) public channel!: NotificationChannel;
  @ApiProperty({ type: Number }) public version!: number;
  @ApiProperty({ type: String }) public name!: string;
  @ApiProperty({ nullable: true, type: String }) public subjectTemplate!: string | null;
  @ApiProperty({ type: String }) public bodyTemplate!: string;
  @ApiProperty({ type: [String] }) public allowedVariables!: string[];
  @ApiProperty({ enum: ["draft", "published", "retired"], type: String })
  public status!: string;
  @ApiProperty({ nullable: true, type: String }) public publishedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) public retiredAt!: string | null;
}

export class NotificationTemplateListDto {
  @ApiProperty({ type: [NotificationTemplateDto] }) public items!: NotificationTemplateDto[];
}

export class UpsertNotificationPreferenceDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public contactId!: string;

  @ApiProperty({ example: "schedule", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,79}$/)
  public notificationType!: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  public emailEnabled!: boolean;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  public smsEnabled!: boolean;
}

export class NotificationPreferenceDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiProperty({ format: "uuid", type: String }) public contactId!: string;
  @ApiProperty({ type: String }) public notificationType!: string;
  @ApiProperty({ type: Boolean }) public emailEnabled!: boolean;
  @ApiProperty({ type: Boolean }) public smsEnabled!: boolean;
}

export class NotificationPreferenceListDto {
  @ApiProperty({ type: [NotificationPreferenceDto] }) public items!: NotificationPreferenceDto[];
}

export class QueueNotificationDto {
  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public customerAccountId!: string;

  @ApiProperty({ format: "uuid", type: String })
  @IsUUID("4")
  public contactId!: string;

  @ApiPropertyOptional({ format: "uuid", type: String })
  @IsOptional()
  @IsUUID("4")
  public projectId?: string;

  @ApiProperty({ example: "schedule", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,79}$/)
  public notificationType!: string;

  @ApiProperty({ example: "schedule.confirmed", type: String })
  @IsString()
  @Matches(/^[a-z][a-z0-9_.-]{2,99}$/)
  public templateKey!: string;

  @ApiProperty({ enum: notificationChannels, type: String })
  @IsIn(notificationChannels)
  public channel!: NotificationChannel;

  @ApiProperty({ additionalProperties: { type: "string" }, type: "object" })
  @IsObject()
  public variables!: Record<string, string>;
}

export class QueuedNotificationDto {
  @ApiProperty({ format: "uuid", type: String }) public outboxEventId!: string;
  @ApiProperty({ enum: ["queued"], type: String }) public status!: "queued";
}

export class NotificationAttemptDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ type: Number }) public attemptNumber!: number;
  @ApiProperty({ type: String }) public provider!: string;
  @ApiProperty({ enum: ["sending", "delivered", "failed"], type: String })
  public status!: string;
  @ApiProperty({ nullable: true, type: String }) public errorCode!: string | null;
  @ApiProperty({ type: String }) public attemptedAt!: string;
  @ApiProperty({ nullable: true, type: String }) public completedAt!: string | null;
}

export class NotificationDeliveryDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ format: "uuid", type: String }) public customerAccountId!: string;
  @ApiProperty({ format: "uuid", type: String }) public contactId!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) public projectId!: string | null;
  @ApiProperty({ type: String }) public notificationType!: string;
  @ApiProperty({ enum: notificationChannels, type: String }) public channel!: NotificationChannel;
  @ApiProperty({ type: String }) public recipient!: string;
  @ApiProperty({ nullable: true, type: String }) public subject!: string | null;
  @ApiProperty({ type: String }) public provider!: string;
  @ApiProperty({
    enum: ["pending", "sending", "delivered", "failed", "suppressed"],
    type: String,
  })
  public status!: string;
  @ApiProperty({ nullable: true, type: String }) public suppressionReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) public lastErrorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) public deliveredAt!: string | null;
  @ApiProperty({ type: String }) public createdAt!: string;
  @ApiProperty({ type: [NotificationAttemptDto] }) public attempts!: NotificationAttemptDto[];
}

export class NotificationDeliveryListDto {
  @ApiProperty({ type: [NotificationDeliveryDto] }) public items!: NotificationDeliveryDto[];
}

export class CommunicationQueueMetricsDto {
  @ApiProperty({ type: Number }) public pending!: number;
  @ApiProperty({ type: Number }) public sending!: number;
  @ApiProperty({ type: Number }) public delivered!: number;
  @ApiProperty({ type: Number }) public failed!: number;
  @ApiProperty({ type: Number }) public suppressed!: number;
}

export class CommunicationDeadLetterDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ enum: ["outbox", "scheduled_job"], type: String })
  public kind!: "outbox" | "scheduled_job";
  @ApiProperty({ type: String }) public operationType!: string;
  @ApiProperty({ type: Number }) public attempts!: number;
  @ApiProperty({ nullable: true, type: String }) public errorCode!: string | null;
  @ApiProperty({ type: String }) public availableAt!: string;
}

export class ScheduledReminderDto {
  @ApiProperty({ format: "uuid", type: String }) public id!: string;
  @ApiProperty({ enum: ["pending", "processing", "completed", "dead_letter"], type: String })
  public status!: string;
  @ApiProperty({ type: String }) public runAt!: string;
  @ApiProperty({ type: Number }) public attempts!: number;
  @ApiProperty({ nullable: true, type: String }) public errorCode!: string | null;
}

export class CommunicationOperationsDto {
  @ApiProperty({ type: CommunicationQueueMetricsDto })
  public metrics!: CommunicationQueueMetricsDto;
  @ApiProperty({ type: [CommunicationDeadLetterDto] })
  public deadLetters!: CommunicationDeadLetterDto[];
  @ApiProperty({ type: [ScheduledReminderDto] }) public reminders!: ScheduledReminderDto[];
}

export class CommunicationRetryDto {
  @ApiProperty({ format: "uuid", type: String }) public operationId!: string;
  @ApiProperty({ enum: ["queued"], type: String }) public status!: "queued";
}

export class CreateProjectPublicLinkDto {
  @ApiPropertyOptional({ default: 86_400, maximum: 604_800, minimum: 300, type: Number })
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(604_800)
  public expiresInSeconds?: number;
}

export class ProjectPublicLinkDto {
  @ApiProperty({ format: "uuid", type: String }) public linkId!: string;
  @ApiProperty({ type: String }) public customerPath!: string;
  @ApiProperty({ type: String }) public expiresAt!: string;
}

export class PublicProjectContactDto {
  @ApiProperty({ type: String }) public displayName!: string;
  @ApiProperty({ nullable: true, type: String }) public email!: string | null;
  @ApiProperty({ nullable: true, type: String }) public phone!: string | null;
}

export class PublicProjectLocationDto {
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ type: String }) public addressLine1!: string;
  @ApiProperty({ nullable: true, type: String }) public addressLine2!: string | null;
  @ApiProperty({ type: String }) public city!: string;
  @ApiProperty({ type: String }) public region!: string;
  @ApiProperty({ type: String }) public postalCode!: string;
}

export class PublicProjectScheduleDto {
  @ApiProperty({ type: String }) public jobNumber!: string;
  @ApiProperty({ type: String }) public serviceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ nullable: true, type: String }) public scheduledStartAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) public scheduledEndAt!: string | null;
}

export class PublicProjectMilestoneDto {
  @ApiProperty({ type: String }) public type!: string;
  @ApiProperty({ type: String }) public label!: string;
  @ApiProperty({ type: String }) public occurredAt!: string;
}

export class PublicProjectInvoiceDto {
  @ApiProperty({ type: String }) public invoiceNumber!: string;
  @ApiProperty({ type: String }) public invoiceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ nullable: true, type: String }) public issueDate!: string | null;
  @ApiProperty({ nullable: true, type: String }) public dueDate!: string | null;
  @ApiProperty({ nullable: true, type: Number }) public totalCents!: number | null;
  @ApiProperty({ nullable: true, type: Number }) public amountDueCents!: number | null;
  @ApiProperty({ nullable: true, type: String }) public customerPath!: string | null;
}

export class PublicProjectPaymentDto {
  @ApiProperty({ type: String }) public paymentNumber!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public receivedAt!: string;
  @ApiProperty({ nullable: true, type: String }) public settledAt!: string | null;
}

export class PublicProjectRefundDto {
  @ApiProperty({ type: String }) public refundNumber!: string;
  @ApiProperty({ type: Number }) public amountCents!: number;
  @ApiProperty({ type: String }) public currency!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ nullable: true, type: String }) public settledAt!: string | null;
}

export class PublicProjectDocumentDto {
  @ApiProperty({ type: String }) public filename!: string;
  @ApiProperty({ type: String }) public mediaType!: string;
  @ApiProperty({ type: String }) public purpose!: string;
  @ApiProperty({ type: String }) public customerPath!: string;
}

export class PublicProjectDto {
  @ApiProperty({ type: String }) public projectNumber!: string;
  @ApiProperty({ type: String }) public serviceType!: string;
  @ApiProperty({ type: String }) public status!: string;
  @ApiProperty({ type: String }) public outcomeStatement!: string;
  @ApiProperty({ type: PublicProjectContactDto }) public contact!: PublicProjectContactDto;
  @ApiProperty({ type: PublicProjectLocationDto }) public location!: PublicProjectLocationDto;
  @ApiProperty({ type: [PublicProjectScheduleDto] }) public schedule!: PublicProjectScheduleDto[];
  @ApiProperty({ type: [PublicProjectMilestoneDto] })
  public milestones!: PublicProjectMilestoneDto[];
  @ApiProperty({ type: [PublicProjectInvoiceDto] }) public invoices!: PublicProjectInvoiceDto[];
  @ApiProperty({ type: [PublicProjectPaymentDto] }) public payments!: PublicProjectPaymentDto[];
  @ApiProperty({ type: [PublicProjectRefundDto] }) public refunds!: PublicProjectRefundDto[];
  @ApiProperty({ type: [PublicProjectDocumentDto] }) public documents!: PublicProjectDocumentDto[];
}
