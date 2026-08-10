import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  accountContacts,
  auditEvents,
  contacts,
  contractPublicLinks,
  contracts,
  invoicePublicLinks,
  invoices,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationPreferences,
  notificationTemplates,
  outboxEvents,
  projectPublicLinks,
  projects,
  quotePublicLinks,
  quoteVersions,
  quotes,
  withTenantTransaction,
  type ClaimedOutboxEvent,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE } from "../database/database.tokens.js";
import { OutboxHandlerRegistry, type OutboxHandler } from "../outbox/outbox-handler.registry.js";
import { NonRetryableOutboxError } from "../outbox/outbox-processor.service.js";
import type { NotificationChannel } from "./communications.dto.js";
import {
  CustomerCapabilityTokenService,
  type CustomerCapabilityReference,
} from "./customer-capability-token.service.js";
import {
  NOTIFICATION_PROVIDER,
  NotificationProviderError,
  type NotificationProvider,
  type SendNotificationInput,
} from "./notification-provider.js";

interface NotificationRequest {
  capability?: Omit<CustomerCapabilityReference, "tenantId">;
  channel: NotificationChannel;
  contactId: string;
  customerAccountId: string;
  notificationType: string;
  projectId?: string;
  sourceEventId?: string;
  templateKey: string;
  variables: Record<string, string>;
}

interface PreparedDelivery {
  attemptId: string;
  deliveryId: string;
  message: SendNotificationInput;
}

const informationalEventTypes = [
  "notification.template_created",
  "notification.template_published",
  "notification.preference_changed",
  "notification.suppressed",
  "notification.delivered",
  "notification.failed",
  "notification.reminder_scheduled",
  "notification.retry_requested",
  "project.public_link_created",
  "project.public_link_revoked",
  "project.public_link_viewed",
] as const;

@Injectable()
export class NotificationOutboxHandler implements OutboxHandler, OnModuleInit {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    @Inject(CustomerCapabilityTokenService)
    private readonly tokens: CustomerCapabilityTokenService,
  ) {}

  public onModuleInit(): void {
    this.registry.register("notification.requested", this);
    const ignore: OutboxHandler = { handle: () => Promise.resolve() };
    for (const eventType of informationalEventTypes) this.registry.register(eventType, ignore);
  }

  public async handle(event: ClaimedOutboxEvent): Promise<void> {
    const request = parseRequest(event.payload);
    const prepared = await withTenantTransaction(this.database, event.tenantId, (transaction) =>
      prepareDelivery(
        transaction,
        event,
        request,
        this.provider.providerName?.(request.channel) ?? this.provider.name,
        this.tokens,
      ),
    );
    if (!prepared) return;

    try {
      const result = await this.provider.send(prepared.message);
      await withTenantTransaction(this.database, event.tenantId, (transaction) =>
        completeDelivery(
          transaction,
          event.tenantId,
          prepared.deliveryId,
          prepared.attemptId,
          result.providerMessageId,
        ),
      );
    } catch (error) {
      const errorCode = providerErrorCode(error);
      await withTenantTransaction(this.database, event.tenantId, (transaction) =>
        failDelivery(
          transaction,
          event.tenantId,
          prepared.deliveryId,
          prepared.attemptId,
          errorCode,
        ),
      );
      if (error instanceof NotificationProviderError && !error.retryable) {
        throw new NonRetryableOutboxError(errorCode);
      }
      throw new NotificationProviderFailure();
    }
  }
}

async function prepareDelivery(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  request: NotificationRequest,
  provider: string,
  tokens: CustomerCapabilityTokenService,
): Promise<PreparedDelivery | null> {
  const dedupeKey = `${request.sourceEventId ?? event.id}:${request.contactId}:${request.notificationType}:${request.channel}`;
  const capability = request.capability
    ? await validateCapability(transaction, event.tenantId, request, tokens)
    : undefined;
  let [delivery] = await transaction
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.tenantId, event.tenantId),
        eq(notificationDeliveries.dedupeKey, dedupeKey),
      ),
    )
    .for("update");

  if (delivery?.status === "delivered" || delivery?.status === "suppressed") return null;

  if (!delivery) {
    const [target] = await transaction
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
          eq(accountContacts.tenantId, event.tenantId),
          eq(accountContacts.customerAccountId, request.customerAccountId),
          eq(accountContacts.contactId, request.contactId),
        ),
      );
    if (!target) throw new InvalidNotificationRequest();

    if (request.projectId) {
      const [project] = await transaction
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.tenantId, event.tenantId),
            eq(projects.id, request.projectId),
            eq(projects.customerAccountId, request.customerAccountId),
          ),
        );
      if (!project) throw new InvalidNotificationRequest();
    }

    const [template] = await transaction
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, event.tenantId),
          eq(notificationTemplates.templateKey, request.templateKey),
          eq(notificationTemplates.channel, request.channel),
          eq(notificationTemplates.status, "published"),
        ),
      );
    if (!template) throw new InvalidNotificationRequest();

    const recipient =
      request.channel === "email" ? target.contact.normalizedEmail : target.contact.normalizedPhone;
    if (!recipient) throw new InvalidNotificationRequest();

    const [preference] = await transaction
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, event.tenantId),
          eq(notificationPreferences.contactId, request.contactId),
          eq(notificationPreferences.notificationType, request.notificationType),
        ),
      );
    const enabled =
      request.channel === "email"
        ? (preference?.emailEnabled ?? true)
        : (preference?.smsEnabled ?? false);
    const subject = template.subjectTemplate
      ? render(template.subjectTemplate, request.variables)
      : null;
    const renderedBody = render(template.bodyTemplate, request.variables);
    const [created] = await transaction
      .insert(notificationDeliveries)
      .values({
        channel: request.channel,
        contactId: request.contactId,
        customerAccountId: request.customerAccountId,
        dedupeKey,
        notificationType: request.notificationType,
        originOutboxEventId: event.id,
        projectId: request.projectId,
        projectPublicLinkId:
          capability?.kind === "project" ? capability.reference.linkId : undefined,
        provider,
        recipient,
        renderedBody,
        status: enabled ? "pending" : "suppressed",
        subject,
        suppressionReason: enabled ? undefined : "customer_preference",
        templateId: template.id,
        tenantId: event.tenantId,
      })
      .returning();
    if (!created) throw new Error("Notification Delivery was not created");
    delivery = created;
    if (!enabled) {
      await recordWorkerChange(transaction, event.tenantId, {
        after: { channel: request.channel, status: "suppressed" },
        commandName: "SuppressNotification",
        entityId: delivery.id,
        eventType: "notification.suppressed",
        metadata: { originOutboxEventId: event.id, reason: "customer_preference" },
      });
      return null;
    }
  }

  const [inFlight] = await transaction
    .select()
    .from(notificationDeliveryAttempts)
    .where(
      and(
        eq(notificationDeliveryAttempts.tenantId, event.tenantId),
        eq(notificationDeliveryAttempts.notificationDeliveryId, delivery.id),
        eq(notificationDeliveryAttempts.status, "sending"),
      ),
    )
    .orderBy(desc(notificationDeliveryAttempts.attemptNumber))
    .limit(1)
    .for("update");

  let attempt = inFlight;
  const attemptedAt = new Date();
  if (!attempt) {
    const [latest] = await transaction
      .select({ attemptNumber: notificationDeliveryAttempts.attemptNumber })
      .from(notificationDeliveryAttempts)
      .where(
        and(
          eq(notificationDeliveryAttempts.tenantId, event.tenantId),
          eq(notificationDeliveryAttempts.notificationDeliveryId, delivery.id),
        ),
      )
      .orderBy(desc(notificationDeliveryAttempts.attemptNumber))
      .limit(1);
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
    [attempt] = await transaction
      .insert(notificationDeliveryAttempts)
      .values({
        attemptNumber,
        notificationDeliveryId: delivery.id,
        provider,
        providerIdempotencyKey: `notification:${delivery.id}`,
        tenantId: event.tenantId,
      })
      .returning();
    if (!attempt) throw new Error("Notification Delivery Attempt was not created");
  }

  await transaction
    .update(notificationDeliveries)
    .set({
      firstAttemptedAt: delivery.firstAttemptedAt ?? attemptedAt,
      lastAttemptedAt: attemptedAt,
      lastErrorCode: null,
      status: "sending",
    })
    .where(
      and(
        eq(notificationDeliveries.tenantId, event.tenantId),
        eq(notificationDeliveries.id, delivery.id),
      ),
    );

  return {
    attemptId: attempt.id,
    deliveryId: delivery.id,
    message: {
      body: capability
        ? delivery.renderedBody.replaceAll(
            secureLinkPlaceholder,
            tokens.customerUrl(capability.reference),
          )
        : delivery.renderedBody,
      channel: delivery.channel as NotificationChannel,
      idempotencyKey: attempt.providerIdempotencyKey,
      recipient: delivery.recipient,
      subject: capability
        ? (delivery.subject?.replaceAll(
            secureLinkPlaceholder,
            tokens.customerUrl(capability.reference),
          ) ?? null)
        : delivery.subject,
    },
  };
}

async function completeDelivery(
  transaction: TenantTransaction,
  tenantId: string,
  deliveryId: string,
  attemptId: string,
  providerMessageId: string,
): Promise<void> {
  const now = new Date();
  const [delivery] = await transaction
    .select()
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, deliveryId)),
    )
    .for("update");
  if (!delivery) throw new Error("Notification Delivery was not found");
  if (delivery.status === "delivered") return;
  if (delivery.status !== "sending") throw new Error("Notification Delivery is not sending");
  await transaction
    .update(notificationDeliveryAttempts)
    .set({ completedAt: now, providerMessageId, status: "delivered" })
    .where(
      and(
        eq(notificationDeliveryAttempts.tenantId, tenantId),
        eq(notificationDeliveryAttempts.id, attemptId),
        eq(notificationDeliveryAttempts.status, "sending"),
      ),
    );
  await transaction
    .update(notificationDeliveries)
    .set({ deliveredAt: now, providerMessageId, status: "delivered" })
    .where(
      and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, deliveryId)),
    );
  await recordWorkerChange(transaction, tenantId, {
    after: { channel: delivery.channel, deliveredAt: now.toISOString(), status: "delivered" },
    commandName: "DeliverNotification",
    entityId: delivery.id,
    eventType: "notification.delivered",
    metadata: { originOutboxEventId: delivery.originOutboxEventId },
  });
}

async function failDelivery(
  transaction: TenantTransaction,
  tenantId: string,
  deliveryId: string,
  attemptId: string,
  errorCode: string,
): Promise<void> {
  const now = new Date();
  const [delivery] = await transaction
    .select()
    .from(notificationDeliveries)
    .where(
      and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, deliveryId)),
    )
    .for("update");
  if (delivery?.status !== "sending") return;
  await transaction
    .update(notificationDeliveryAttempts)
    .set({ completedAt: now, errorCode, status: "failed" })
    .where(
      and(
        eq(notificationDeliveryAttempts.tenantId, tenantId),
        eq(notificationDeliveryAttempts.id, attemptId),
        eq(notificationDeliveryAttempts.status, "sending"),
      ),
    );
  await transaction
    .update(notificationDeliveries)
    .set({ failedAt: now, lastErrorCode: errorCode, status: "failed" })
    .where(
      and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.id, deliveryId)),
    );
  await recordWorkerChange(transaction, tenantId, {
    after: { channel: delivery.channel, errorCode, status: "failed" },
    commandName: "FailNotificationDelivery",
    entityId: delivery.id,
    eventType: "notification.failed",
    metadata: { originOutboxEventId: delivery.originOutboxEventId },
  });
}

async function recordWorkerChange(
  transaction: TenantTransaction,
  tenantId: string,
  input: {
    after: unknown;
    commandName: string;
    entityId: string;
    eventType: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const auditEventId = randomUUID();
  await transaction.insert(auditEvents).values({
    after: input.after,
    commandName: input.commandName,
    entityId: input.entityId,
    entityType: "NotificationDelivery",
    eventType: input.eventType,
    id: auditEventId,
    metadata: input.metadata,
    tenantId,
  });
  await transaction.insert(outboxEvents).values({
    aggregateId: input.entityId,
    aggregateType: "NotificationDelivery",
    eventType: input.eventType,
    payload: { auditEventId, ...input.metadata },
    tenantId,
  });
}

function render(template: string, variables: Record<string, string>): string {
  return template.replace(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) throw new InvalidNotificationRequest();
    return value;
  });
}

function parseRequest(payload: Record<string, unknown>): NotificationRequest {
  const capability = payload.capability;
  const channel = payload.channel;
  const contactId = payload.contactId;
  const customerAccountId = payload.customerAccountId;
  const notificationType = payload.notificationType;
  const projectId = payload.projectId;
  const sourceEventId = payload.sourceEventId;
  const templateKey = payload.templateKey;
  const variables = payload.variables;
  if (
    (channel !== "email" && channel !== "sms") ||
    typeof contactId !== "string" ||
    typeof customerAccountId !== "string" ||
    typeof notificationType !== "string" ||
    (projectId !== undefined && typeof projectId !== "string") ||
    (sourceEventId !== undefined && typeof sourceEventId !== "string") ||
    (capability !== undefined && !isCapability(capability)) ||
    typeof templateKey !== "string" ||
    !isStringRecord(variables)
  ) {
    throw new InvalidNotificationRequest();
  }
  return {
    channel,
    ...(capability ? { capability } : {}),
    contactId,
    customerAccountId,
    notificationType,
    ...(projectId ? { projectId } : {}),
    ...(sourceEventId ? { sourceEventId } : {}),
    templateKey,
    variables,
  };
}

const secureLinkPlaceholder = "[secure customer link]";

function isCapability(value: unknown): value is Omit<CustomerCapabilityReference, "tenantId"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    ["contract", "invoice", "project", "quote"].includes(record.kind as string) &&
    typeof record.linkId === "string" &&
    typeof record.targetId === "string"
  );
}

async function validateCapability(
  transaction: TenantTransaction,
  tenantId: string,
  request: NotificationRequest,
  tokens: CustomerCapabilityTokenService,
): Promise<{ kind: CustomerCapabilityReference["kind"]; reference: CustomerCapabilityReference }> {
  const capability = request.capability;
  if (!capability || request.variables.secureUrl !== secureLinkPlaceholder) {
    throw new InvalidNotificationRequest();
  }
  const reference: CustomerCapabilityReference = { ...capability, tenantId };
  const expectedHash = tokens.create(reference).hash;
  const now = new Date();
  if (capability.kind === "project") {
    const [link] = await transaction
      .select({
        contactId: projects.primaryContactId,
        customerAccountId: projectPublicLinks.customerAccountId,
        expiresAt: projectPublicLinks.expiresAt,
        projectId: projectPublicLinks.projectId,
        revokedAt: projectPublicLinks.revokedAt,
        tokenHash: projectPublicLinks.tokenHash,
      })
      .from(projectPublicLinks)
      .innerJoin(
        projects,
        and(
          eq(projects.tenantId, projectPublicLinks.tenantId),
          eq(projects.id, projectPublicLinks.projectId),
        ),
      )
      .where(
        and(
          eq(projectPublicLinks.tenantId, tenantId),
          eq(projectPublicLinks.id, capability.linkId),
          eq(projectPublicLinks.projectId, capability.targetId),
        ),
      );
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt <= now ||
      link.tokenHash !== expectedHash ||
      link.customerAccountId !== request.customerAccountId ||
      link.contactId !== request.contactId ||
      link.projectId !== request.projectId
    ) {
      throw new InvalidNotificationRequest();
    }
    return { kind: capability.kind, reference };
  }
  if (capability.kind === "quote") {
    const [link] = await transaction
      .select({
        contactId: quotes.primaryContactId,
        customerAccountId: quotes.customerAccountId,
        expiresAt: quotePublicLinks.expiresAt,
        revokedAt: quotePublicLinks.revokedAt,
        tokenHash: quotePublicLinks.tokenHash,
      })
      .from(quotePublicLinks)
      .innerJoin(
        quoteVersions,
        and(
          eq(quoteVersions.tenantId, quotePublicLinks.tenantId),
          eq(quoteVersions.id, quotePublicLinks.quoteVersionId),
        ),
      )
      .innerJoin(
        quotes,
        and(eq(quotes.tenantId, quoteVersions.tenantId), eq(quotes.id, quoteVersions.quoteId)),
      )
      .where(
        and(
          eq(quotePublicLinks.tenantId, tenantId),
          eq(quotePublicLinks.id, capability.linkId),
          eq(quotePublicLinks.quoteVersionId, capability.targetId),
        ),
      );
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt <= now ||
      link.tokenHash !== expectedHash ||
      link.customerAccountId !== request.customerAccountId ||
      link.contactId !== request.contactId ||
      request.projectId
    ) {
      throw new InvalidNotificationRequest();
    }
    return { kind: capability.kind, reference };
  }
  if (capability.kind === "contract") {
    const [link] = await transaction
      .select({
        contactId: projects.primaryContactId,
        customerAccountId: projects.customerAccountId,
        expiresAt: contractPublicLinks.expiresAt,
        projectId: projects.id,
        revokedAt: contractPublicLinks.revokedAt,
        tokenHash: contractPublicLinks.tokenHash,
      })
      .from(contractPublicLinks)
      .innerJoin(
        contracts,
        and(
          eq(contracts.tenantId, contractPublicLinks.tenantId),
          eq(contracts.id, contractPublicLinks.contractId),
        ),
      )
      .innerJoin(
        projects,
        and(eq(projects.tenantId, contracts.tenantId), eq(projects.id, contracts.projectId)),
      )
      .where(
        and(
          eq(contractPublicLinks.tenantId, tenantId),
          eq(contractPublicLinks.id, capability.linkId),
          eq(contractPublicLinks.contractId, capability.targetId),
        ),
      );
    if (
      !link ||
      link.revokedAt ||
      link.expiresAt <= now ||
      link.tokenHash !== expectedHash ||
      link.customerAccountId !== request.customerAccountId ||
      link.contactId !== request.contactId ||
      link.projectId !== request.projectId
    ) {
      throw new InvalidNotificationRequest();
    }
    return { kind: capability.kind, reference };
  }
  const [link] = await transaction
    .select({
      customerAccountId: invoices.customerAccountId,
      expiresAt: invoicePublicLinks.expiresAt,
      projectId: invoices.projectId,
      revokedAt: invoicePublicLinks.revokedAt,
      tokenHash: invoicePublicLinks.tokenHash,
    })
    .from(invoicePublicLinks)
    .innerJoin(
      invoices,
      and(
        eq(invoices.tenantId, invoicePublicLinks.tenantId),
        eq(invoices.id, invoicePublicLinks.invoiceId),
      ),
    )
    .where(
      and(
        eq(invoicePublicLinks.tenantId, tenantId),
        eq(invoicePublicLinks.id, capability.linkId),
        eq(invoicePublicLinks.invoiceVersionId, capability.targetId),
      ),
    );
  const [project] = link
    ? await transaction
        .select({ contactId: projects.primaryContactId })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.id, link.projectId)))
    : [];
  if (
    !link ||
    !project ||
    link.revokedAt ||
    link.expiresAt <= now ||
    link.tokenHash !== expectedHash ||
    link.customerAccountId !== request.customerAccountId ||
    project.contactId !== request.contactId ||
    link.projectId !== request.projectId
  ) {
    throw new InvalidNotificationRequest();
  }
  return { kind: capability.kind, reference };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry) => typeof entry === "string",
  );
}

function providerErrorCode(error: unknown): string {
  if (error instanceof NotificationProviderError) return error.code;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(error.name))
    return error.name;
  return "NotificationProviderError";
}

class InvalidNotificationRequest extends Error {
  public override readonly name = "InvalidNotificationRequest";
}

class NotificationProviderFailure extends Error {
  public override readonly name = "NotificationProviderFailure";
}
