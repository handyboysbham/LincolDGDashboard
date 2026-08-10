import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  accountContacts,
  auditEvents,
  contacts,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationPreferences,
  notificationTemplates,
  outboxEvents,
  projects,
  scheduledJobs,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  CreateNotificationTemplateDto,
  CommunicationOperationsDto,
  CommunicationRetryDto,
  NotificationChannel,
  NotificationDeliveryDto,
  NotificationDeliveryListDto,
  NotificationPreferenceDto,
  NotificationPreferenceListDto,
  NotificationTemplateDto,
  NotificationTemplateListDto,
  QueueNotificationDto,
  QueuedNotificationDto,
  UpsertNotificationPreferenceDto,
} from "./communications.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

const deliveryStatuses = ["pending", "sending", "delivered", "failed", "suppressed"];
const protectedVariableNames = new Set([
  "approvalDiscussion",
  "cost",
  "internalNote",
  "margin",
  "supplierCost",
]);
const placeholderPattern = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;
const communicationSourceEventTypes = [
  "contract.executed",
  "contract.sent",
  "invoice.sent",
  "job.operationally_completed",
  "job.scheduled",
  "material_delivery.load_departed_supplier",
  "notification.requested",
  "payment.settled",
  "quote.sent",
  "refund.settled",
  "rental.dropoff_departed",
];

@Injectable()
export class CommunicationsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
  ) {}

  public async listTemplates(): Promise<NotificationTemplateListDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => ({
      items: (
        await transaction
          .select()
          .from(notificationTemplates)
          .where(eq(notificationTemplates.tenantId, actor.tenantId))
          .orderBy(
            notificationTemplates.templateKey,
            notificationTemplates.channel,
            desc(notificationTemplates.version),
          )
      ).map(templateDto),
    }));
  }

  public async createTemplate(
    input: CreateNotificationTemplateDto,
    key: string,
  ): Promise<NotificationTemplateDto> {
    const actor = this.context.actor();
    const normalized = normalizeTemplate(input);
    const result = await this.idempotency.execute(
      { key, payload: normalized, scope: "communications.templates.create" },
      async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${actor.tenantId}:${normalized.templateKey}:${normalized.channel}`}))`,
        );
        const [latest] = await transaction
          .select({ version: notificationTemplates.version })
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.tenantId, actor.tenantId),
              eq(notificationTemplates.templateKey, normalized.templateKey),
              eq(notificationTemplates.channel, normalized.channel),
            ),
          )
          .orderBy(desc(notificationTemplates.version))
          .limit(1);
        const [created] = await transaction
          .insert(notificationTemplates)
          .values({
            ...normalized,
            createdBy: actor.userId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
            version: (latest?.version ?? 0) + 1,
          })
          .returning();
        if (!created) throw new Error("Notification Template was not created");
        await this.recordChange(transaction, actor, {
          after: {
            channel: created.channel,
            status: created.status,
            templateKey: created.templateKey,
            version: created.version,
          },
          commandName: "CreateNotificationTemplate",
          entityId: created.id,
          entityType: "NotificationTemplate",
          eventType: "notification.template_created",
        });
        return { body: templateDto(created), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async publishTemplate(templateId: string, key: string): Promise<NotificationTemplateDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { templateId }, scope: "communications.templates.publish" },
      async (transaction) => {
        const [template] = await transaction
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.tenantId, actor.tenantId),
              eq(notificationTemplates.id, templateId),
            ),
          )
          .for("update");
        if (!template)
          throw notFound("NOTIFICATION_TEMPLATE_NOT_FOUND", "Notification Template was not found");
        if (template.status !== "draft") {
          throw conflict(
            "NOTIFICATION_TEMPLATE_NOT_DRAFT",
            "Only a draft Notification Template can be published",
          );
        }
        const now = new Date();
        await transaction
          .update(notificationTemplates)
          .set({ retiredAt: now, status: "retired", updatedBy: actor.userId })
          .where(
            and(
              eq(notificationTemplates.tenantId, actor.tenantId),
              eq(notificationTemplates.templateKey, template.templateKey),
              eq(notificationTemplates.channel, template.channel),
              eq(notificationTemplates.status, "published"),
            ),
          );
        const [published] = await transaction
          .update(notificationTemplates)
          .set({ publishedAt: now, status: "published", updatedBy: actor.userId })
          .where(
            and(
              eq(notificationTemplates.tenantId, actor.tenantId),
              eq(notificationTemplates.id, template.id),
              eq(notificationTemplates.status, "draft"),
            ),
          )
          .returning();
        if (!published)
          throw conflict(
            "NOTIFICATION_TEMPLATE_PUBLISH_CONFLICT",
            "Notification Template changed before publication",
          );
        await this.recordChange(transaction, actor, {
          after: {
            channel: published.channel,
            status: published.status,
            templateKey: published.templateKey,
            version: published.version,
          },
          before: { status: template.status },
          commandName: "PublishNotificationTemplate",
          entityId: published.id,
          entityType: "NotificationTemplate",
          eventType: "notification.template_published",
        });
        return { body: templateDto(published), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async listPreferences(customerAccountId: string): Promise<NotificationPreferenceListDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => ({
      items: (
        await transaction
          .select()
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.tenantId, actor.tenantId),
              eq(notificationPreferences.customerAccountId, customerAccountId),
            ),
          )
          .orderBy(notificationPreferences.notificationType)
      ).map(preferenceDto),
    }));
  }

  public async setPreference(
    customerAccountId: string,
    input: UpsertNotificationPreferenceDto,
    key: string,
  ): Promise<NotificationPreferenceDto> {
    const actor = this.context.actor();
    const notificationType = input.notificationType.trim();
    const result = await this.idempotency.execute(
      {
        key,
        payload: {
          contactId: input.contactId,
          customerAccountId,
          emailEnabled: input.emailEnabled,
          notificationType,
          smsEnabled: input.smsEnabled,
        },
        scope: "communications.preferences.set",
      },
      async (transaction) => {
        await assertAccountContact(transaction, actor.tenantId, customerAccountId, input.contactId);
        const [preference] = await transaction
          .insert(notificationPreferences)
          .values({
            contactId: input.contactId,
            createdBy: actor.userId,
            customerAccountId,
            emailEnabled: input.emailEnabled,
            notificationType,
            smsEnabled: input.smsEnabled,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .onConflictDoUpdate({
            set: {
              emailEnabled: input.emailEnabled,
              smsEnabled: input.smsEnabled,
              updatedBy: actor.userId,
            },
            target: [
              notificationPreferences.tenantId,
              notificationPreferences.contactId,
              notificationPreferences.notificationType,
            ],
          })
          .returning();
        if (!preference) throw new Error("Notification Preference was not saved");
        await this.recordChange(transaction, actor, {
          after: {
            emailEnabled: input.emailEnabled,
            notificationType,
            smsEnabled: input.smsEnabled,
          },
          commandName: "SetNotificationPreference",
          entityId: preference.id,
          entityType: "NotificationPreference",
          eventType: "notification.preference_changed",
          metadata: { contactId: input.contactId, customerAccountId },
        });
        return { body: preferenceDto(preference), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async queueNotification(
    input: QueueNotificationDto,
    key: string,
  ): Promise<QueuedNotificationDto> {
    const actor = this.context.actor();
    const normalized = normalizeQueueInput(input);
    const result = await this.idempotency.execute(
      { key, payload: normalized, scope: "communications.notifications.queue" },
      async (transaction) => {
        const contact = await assertAccountContact(
          transaction,
          actor.tenantId,
          normalized.customerAccountId,
          normalized.contactId,
        );
        requireReachableChannel(contact, normalized.channel);
        if (normalized.projectId) {
          const [project] = await transaction
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.tenantId, actor.tenantId),
                eq(projects.id, normalized.projectId),
                eq(projects.customerAccountId, normalized.customerAccountId),
              ),
            );
          if (!project)
            throw notFound("PROJECT_NOT_FOUND", "Project was not found for this Customer");
        }
        const [template] = await transaction
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.tenantId, actor.tenantId),
              eq(notificationTemplates.templateKey, normalized.templateKey),
              eq(notificationTemplates.channel, normalized.channel),
              eq(notificationTemplates.status, "published"),
            ),
          );
        if (!template)
          throw conflict(
            "NOTIFICATION_TEMPLATE_NOT_PUBLISHED",
            "A published Notification Template is required",
          );
        validateVariables(template.allowedVariables, normalized.variables);

        const auditEventId = randomUUID();
        const outboxEventId = randomUUID();
        await transaction.insert(auditEvents).values({
          actorUserId: actor.userId,
          after: {
            channel: normalized.channel,
            notificationType: normalized.notificationType,
            status: "queued",
            templateKey: normalized.templateKey,
          },
          commandName: "QueueNotification",
          correlationId: this.context.correlationId(),
          entityId: outboxEventId,
          entityType: "NotificationRequest",
          eventType: "notification.requested",
          id: auditEventId,
          metadata: {
            contactId: normalized.contactId,
            customerAccountId: normalized.customerAccountId,
            projectId: normalized.projectId,
          },
          tenantId: actor.tenantId,
        });
        await transaction.insert(outboxEvents).values({
          aggregateId: normalized.customerAccountId,
          aggregateType: "CustomerAccount",
          createdBy: actor.userId,
          eventType: "notification.requested",
          id: outboxEventId,
          payload: { auditEventId, ...normalized },
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        });
        return { body: { outboxEventId, status: "queued" as const }, status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async listDeliveries(input: {
    customerAccountId?: string;
    limit: number;
    projectId?: string;
    status?: string;
  }): Promise<NotificationDeliveryListDto> {
    const actor = this.context.actor();
    if (input.status && !deliveryStatuses.includes(input.status)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "NOTIFICATION_STATUS_INVALID",
        "Notification status is invalid",
      );
    }
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const filters = [eq(notificationDeliveries.tenantId, actor.tenantId)];
      if (input.customerAccountId)
        filters.push(eq(notificationDeliveries.customerAccountId, input.customerAccountId));
      if (input.projectId) filters.push(eq(notificationDeliveries.projectId, input.projectId));
      if (input.status) filters.push(eq(notificationDeliveries.status, input.status));
      const deliveries = await transaction
        .select()
        .from(notificationDeliveries)
        .where(and(...filters))
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(input.limit);
      const items: NotificationDeliveryDto[] = [];
      for (const delivery of deliveries)
        items.push(await deliveryDto(transaction, actor.tenantId, delivery));
      return { items };
    });
  }

  public async getDelivery(deliveryId: string): Promise<NotificationDeliveryDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [delivery] = await transaction
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.tenantId, actor.tenantId),
            eq(notificationDeliveries.id, deliveryId),
          ),
        );
      if (!delivery)
        throw notFound("NOTIFICATION_DELIVERY_NOT_FOUND", "Notification Delivery was not found");
      return deliveryDto(transaction, actor.tenantId, delivery);
    });
  }

  public async getOperations(): Promise<CommunicationOperationsDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const [metrics] = await transaction
        .select({
          delivered:
            sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'delivered')`.mapWith(
              Number,
            ),
          failed:
            sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'failed')`.mapWith(
              Number,
            ),
          pending:
            sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'pending')`.mapWith(
              Number,
            ),
          sending:
            sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'sending')`.mapWith(
              Number,
            ),
          suppressed:
            sql<number>`count(*) filter (where ${notificationDeliveries.status} = 'suppressed')`.mapWith(
              Number,
            ),
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.tenantId, actor.tenantId));
      const deadOutbox = await transaction
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.tenantId, actor.tenantId),
            eq(outboxEvents.status, "dead_letter"),
            inArray(outboxEvents.eventType, communicationSourceEventTypes),
          ),
        )
        .orderBy(desc(outboxEvents.availableAt))
        .limit(50);
      const reminders = await transaction
        .select()
        .from(scheduledJobs)
        .where(
          and(
            eq(scheduledJobs.tenantId, actor.tenantId),
            eq(scheduledJobs.jobType, "communications.service_reminder"),
          ),
        )
        .orderBy(desc(scheduledJobs.runAt))
        .limit(50);
      return {
        deadLetters: [
          ...deadOutbox.map((event) => ({
            attempts: event.attempts,
            availableAt: event.availableAt.toISOString(),
            errorCode: event.lastError,
            id: event.id,
            kind: "outbox" as const,
            operationType: event.eventType,
          })),
          ...reminders
            .filter((reminder) => reminder.status === "dead_letter")
            .map((reminder) => ({
              attempts: reminder.attempts,
              availableAt: reminder.runAt.toISOString(),
              errorCode: reminder.lastError,
              id: reminder.id,
              kind: "scheduled_job" as const,
              operationType: reminder.jobType,
            })),
        ],
        metrics: metrics ?? { delivered: 0, failed: 0, pending: 0, sending: 0, suppressed: 0 },
        reminders: reminders.map((reminder) => ({
          attempts: reminder.attempts,
          errorCode: reminder.lastError,
          id: reminder.id,
          runAt: reminder.runAt.toISOString(),
          status: reminder.status,
        })),
      };
    });
  }

  public retryDelivery(deliveryId: string, key: string): Promise<CommunicationRetryDto> {
    const actor = this.context.actor();
    return this.retryOutboxCommand(
      key,
      "communications.deliveries.retry",
      { deliveryId },
      async (transaction) => {
        const [delivery] = await transaction
          .select()
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.tenantId, actor.tenantId),
              eq(notificationDeliveries.id, deliveryId),
            ),
          )
          .for("update");
        if (!delivery)
          throw notFound("NOTIFICATION_DELIVERY_NOT_FOUND", "Notification Delivery was not found");
        if (delivery.status !== "failed") {
          throw conflict(
            "NOTIFICATION_DELIVERY_NOT_FAILED",
            "Only a failed Notification Delivery can be retried",
          );
        }
        await this.resetOutboxEvent(transaction, actor, delivery.originOutboxEventId);
        return delivery.originOutboxEventId;
      },
    );
  }

  public retryDeadLetter(eventId: string, key: string): Promise<CommunicationRetryDto> {
    const actor = this.context.actor();
    return this.retryOutboxCommand(
      key,
      "communications.dead_letters.retry",
      { eventId },
      async (transaction) => {
        const [event] = await transaction
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.tenantId, actor.tenantId), eq(outboxEvents.id, eventId)))
          .for("update");
        if (!event || !communicationSourceEventTypes.includes(event.eventType)) {
          throw notFound("COMMUNICATION_DEAD_LETTER_NOT_FOUND", "Dead letter was not found");
        }
        if (event.status !== "dead_letter") {
          throw conflict("COMMUNICATION_NOT_DEAD_LETTER", "Only a dead letter can be retried");
        }
        await this.resetOutboxEvent(transaction, actor, event.id, true);
        return event.id;
      },
    );
  }

  public async retryReminder(reminderId: string, key: string): Promise<CommunicationRetryDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { reminderId },
        scope: "communications.reminders.retry",
      },
      async (transaction) => {
        const [reminder] = await transaction
          .select()
          .from(scheduledJobs)
          .where(and(eq(scheduledJobs.tenantId, actor.tenantId), eq(scheduledJobs.id, reminderId)))
          .for("update");
        if (reminder?.jobType !== "communications.service_reminder") {
          throw notFound("COMMUNICATION_REMINDER_NOT_FOUND", "Reminder was not found");
        }
        if (reminder.status !== "dead_letter") {
          throw conflict(
            "COMMUNICATION_REMINDER_NOT_DEAD_LETTER",
            "Only a dead letter can be retried",
          );
        }
        await transaction
          .update(scheduledJobs)
          .set({
            attempts: 0,
            completedAt: null,
            lastError: null,
            lockedBy: null,
            lockedUntil: null,
            runAt: new Date(),
            status: "pending",
            updatedBy: actor.userId,
          })
          .where(
            and(eq(scheduledJobs.tenantId, actor.tenantId), eq(scheduledJobs.id, reminder.id)),
          );
        await this.recordChange(transaction, actor, {
          after: { status: "pending" },
          before: { status: "dead_letter" },
          commandName: "RetryCommunicationReminder",
          entityId: reminder.id,
          entityType: "ScheduledJob",
          eventType: "notification.retry_requested",
          metadata: { operationType: reminder.jobType },
        });
        return {
          body: { operationId: reminder.id, status: "queued" as const },
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  private async retryOutboxCommand(
    key: string,
    scope: string,
    payload: Record<string, string>,
    operation: (transaction: TenantTransaction) => Promise<string>,
  ): Promise<CommunicationRetryDto> {
    const result = await this.idempotency.execute({ key, payload, scope }, async (transaction) => {
      const operationId = await operation(transaction);
      return { body: { operationId, status: "queued" as const }, status: HttpStatus.OK };
    });
    return result.body;
  }

  private async resetOutboxEvent(
    transaction: TenantTransaction,
    actor: Actor,
    eventId: string,
    locked = false,
  ): Promise<void> {
    const [event] = locked
      ? await transaction
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.tenantId, actor.tenantId), eq(outboxEvents.id, eventId)))
      : await transaction
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.tenantId, actor.tenantId), eq(outboxEvents.id, eventId)))
          .for("update");
    if (!event)
      throw notFound("COMMUNICATION_OPERATION_NOT_FOUND", "Communication operation was not found");
    if (event.status !== "pending" && event.status !== "dead_letter") {
      throw conflict(
        "COMMUNICATION_OPERATION_BUSY",
        "Communication operation cannot be retried now",
      );
    }
    await transaction
      .update(outboxEvents)
      .set({
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
        lockedBy: null,
        lockedUntil: null,
        processedAt: null,
        status: "pending",
        updatedBy: actor.userId,
      })
      .where(and(eq(outboxEvents.tenantId, actor.tenantId), eq(outboxEvents.id, event.id)));
    await this.recordChange(transaction, actor, {
      after: { status: "pending" },
      before: { status: event.status },
      commandName: "RetryCommunicationOperation",
      entityId: event.id,
      entityType: "OutboxEvent",
      eventType: "notification.retry_requested",
      metadata: { operationType: event.eventType },
    });
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const auditEventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: auditEventId,
      metadata: input.metadata ?? {},
      tenantId: actor.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor.userId,
      eventType: input.eventType,
      payload: { auditEventId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
      updatedBy: actor.userId,
    });
  }
}

function normalizeTemplate(input: CreateNotificationTemplateDto) {
  const allowedVariables = [
    ...new Set(input.allowedVariables.map((value) => value.trim())),
  ].toSorted();
  if (allowedVariables.some((value) => !/^[A-Za-z][A-Za-z0-9]*$/.test(value))) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_VARIABLE_INVALID",
      "Template variable names must use letters and numbers",
    );
  }
  if (allowedVariables.some((value) => protectedVariableNames.has(value))) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_VARIABLE_PROTECTED",
      "Internal-only information cannot be used in customer notifications",
    );
  }
  const channel = input.channel;
  const subjectTemplate = input.subjectTemplate?.trim() ?? null;
  if (channel === "email" && !subjectTemplate) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_SUBJECT_REQUIRED",
      "Email templates require a subject",
    );
  }
  const bodyTemplate = input.bodyTemplate.trim();
  if (!bodyTemplate)
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_BODY_REQUIRED",
      "Notification body is required",
    );
  validateTemplatePlaceholders([subjectTemplate, bodyTemplate], allowedVariables);
  return {
    allowedVariables,
    bodyTemplate,
    channel,
    name: input.name.trim(),
    subjectTemplate,
    templateKey: input.templateKey.trim(),
  };
}

function normalizeQueueInput(input: QueueNotificationDto) {
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.variables)) {
    if (typeof value !== "string" || value.length > 2_000) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "NOTIFICATION_VARIABLE_VALUE_INVALID",
        "Notification variable values must be strings no longer than 2,000 characters",
      );
    }
    variables[name] = value;
  }
  return {
    channel: input.channel,
    contactId: input.contactId,
    customerAccountId: input.customerAccountId,
    notificationType: input.notificationType.trim(),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    templateKey: input.templateKey.trim(),
    variables,
  };
}

function validateTemplatePlaceholders(
  templates: (string | null)[],
  allowedVariables: string[],
): void {
  const allowed = new Set(allowedVariables);
  for (const template of templates) {
    if (!template) continue;
    for (const match of template.matchAll(placeholderPattern)) {
      const variable = match[1];
      if (variable && !allowed.has(variable)) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "NOTIFICATION_TEMPLATE_VARIABLE_UNKNOWN",
          `Template variable ${variable} is not declared`,
        );
      }
    }
    const withoutPlaceholders = template.replace(placeholderPattern, "");
    if (withoutPlaceholders.includes("{{") || withoutPlaceholders.includes("}}")) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "NOTIFICATION_TEMPLATE_SYNTAX_INVALID",
        "Notification Template contains an invalid placeholder",
      );
    }
  }
}

function validateVariables(allowedVariables: string[], variables: Record<string, string>): void {
  const supplied = Object.keys(variables).toSorted();
  const allowed = [...allowedVariables].toSorted();
  if (
    supplied.length !== allowed.length ||
    supplied.some((value, index) => value !== allowed[index])
  ) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_VARIABLES_MISMATCH",
      "Notification variables must exactly match the published Template",
    );
  }
  if (supplied.some((value) => protectedVariableNames.has(value))) {
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "NOTIFICATION_VARIABLE_PROTECTED",
      "Internal-only information cannot be used in customer notifications",
    );
  }
}

async function assertAccountContact(
  transaction: TenantTransaction,
  tenantId: string,
  customerAccountId: string,
  contactId: string,
) {
  const [record] = await transaction
    .select({ contact: contacts })
    .from(accountContacts)
    .innerJoin(
      contacts,
      and(
        eq(contacts.tenantId, accountContacts.tenantId),
        eq(contacts.id, accountContacts.contactId),
      ),
    )
    .where(
      and(
        eq(accountContacts.tenantId, tenantId),
        eq(accountContacts.customerAccountId, customerAccountId),
        eq(accountContacts.contactId, contactId),
      ),
    );
  if (!record)
    throw notFound("CUSTOMER_CONTACT_NOT_FOUND", "Contact was not found for this Customer");
  return record.contact;
}

function requireReachableChannel(
  contact: typeof contacts.$inferSelect,
  channel: NotificationChannel,
): void {
  if (channel === "email" && !contact.normalizedEmail) {
    throw conflict(
      "NOTIFICATION_EMAIL_UNAVAILABLE",
      "Contact does not have a deliverable email address",
    );
  }
  if (channel === "sms" && !contact.normalizedPhone) {
    throw conflict(
      "NOTIFICATION_PHONE_UNAVAILABLE",
      "Contact does not have a deliverable phone number",
    );
  }
}

function templateDto(template: typeof notificationTemplates.$inferSelect): NotificationTemplateDto {
  return {
    allowedVariables: template.allowedVariables,
    bodyTemplate: template.bodyTemplate,
    channel: template.channel as NotificationChannel,
    id: template.id,
    name: template.name,
    publishedAt: template.publishedAt?.toISOString() ?? null,
    retiredAt: template.retiredAt?.toISOString() ?? null,
    status: template.status,
    subjectTemplate: template.subjectTemplate,
    templateKey: template.templateKey,
    version: template.version,
  };
}

function preferenceDto(
  preference: typeof notificationPreferences.$inferSelect,
): NotificationPreferenceDto {
  return {
    contactId: preference.contactId,
    customerAccountId: preference.customerAccountId,
    emailEnabled: preference.emailEnabled,
    id: preference.id,
    notificationType: preference.notificationType,
    smsEnabled: preference.smsEnabled,
  };
}

async function deliveryDto(
  transaction: TenantTransaction,
  tenantId: string,
  delivery: typeof notificationDeliveries.$inferSelect,
): Promise<NotificationDeliveryDto> {
  const attempts = await transaction
    .select()
    .from(notificationDeliveryAttempts)
    .where(
      and(
        eq(notificationDeliveryAttempts.tenantId, tenantId),
        eq(notificationDeliveryAttempts.notificationDeliveryId, delivery.id),
      ),
    )
    .orderBy(notificationDeliveryAttempts.attemptNumber);
  return {
    attempts: attempts.map((attempt) => ({
      attemptedAt: attempt.attemptedAt.toISOString(),
      attemptNumber: attempt.attemptNumber,
      completedAt: attempt.completedAt?.toISOString() ?? null,
      errorCode: attempt.errorCode,
      id: attempt.id,
      provider: attempt.provider,
      status: attempt.status,
    })),
    channel: delivery.channel as NotificationChannel,
    contactId: delivery.contactId,
    createdAt: delivery.createdAt.toISOString(),
    customerAccountId: delivery.customerAccountId,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    id: delivery.id,
    lastErrorCode: delivery.lastErrorCode,
    notificationType: delivery.notificationType,
    projectId: delivery.projectId,
    provider: delivery.provider,
    recipient: delivery.recipient,
    status: delivery.status,
    subject: delivery.subject,
    suppressionReason: delivery.suppressionReason,
  };
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}
