import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  auditEvents,
  contacts,
  contractPublicLinks,
  contracts,
  customerAccounts,
  dumpTrailerRentalDetails,
  invoicePublicLinks,
  invoices,
  jobs,
  materialDeliveryDetails,
  materialLoads,
  notificationTemplates,
  outboxEvents,
  payments,
  projects,
  quotePublicLinks,
  quotes,
  refunds,
  scheduledJobs,
  withTenantTransaction,
  type ClaimedOutboxEvent,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE } from "../database/database.tokens.js";
import { ServerConfigService } from "../config/server-config.service.js";
import { OutboxHandlerRegistry, type OutboxHandler } from "../outbox/outbox-handler.registry.js";
import { CustomerCapabilityTokenService } from "./customer-capability-token.service.js";
import { ensureProjectCapability } from "./customer-project.service.js";

interface PolicyRequest {
  capability: {
    kind: "contract" | "invoice" | "project" | "quote";
    linkId: string;
    targetId: string;
  };
  contactId: string;
  customerAccountId: string;
  notificationType: string;
  projectId?: string;
  templateKey: string;
  variables: Record<string, string>;
}

interface ProjectAudience {
  contactId: string;
  customerAccountId: string;
  customerName: string;
  projectId: string;
  projectNumber: string;
}

const secureLinkPlaceholder = "[secure customer link]";

type PolicyResolver = (
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
) => Promise<PolicyRequest>;

const policyRegistry: Record<string, PolicyResolver> = {
  "contract.executed": resolveContractExecuted,
  "contract.sent": resolveContractSent,
  "invoice.sent": resolveInvoiceSent,
  "job.operationally_completed": resolveJobCompleted,
  "job.scheduled": resolveJobScheduled,
  "material_delivery.load_departed_supplier": resolveMaterialOnTheWay,
  "payment.settled": resolvePaymentSettled,
  "quote.sent": resolveQuoteSent,
  "refund.settled": resolveRefundSettled,
  "rental.dropoff_departed": resolveRentalOnTheWay,
};

@Injectable()
export class NotificationPolicyHandler implements OutboxHandler, OnModuleInit {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(CustomerCapabilityTokenService)
    private readonly tokens: CustomerCapabilityTokenService,
    @Inject(ServerConfigService) private readonly configuration: ServerConfigService,
  ) {}

  public onModuleInit(): void {
    for (const eventType of Object.keys(policyRegistry)) this.registry.register(eventType, this);
  }

  public async handle(event: ClaimedOutboxEvent): Promise<void> {
    const resolver = policyRegistry[event.eventType];
    if (!resolver) throw new NotificationPolicyError();
    await withTenantTransaction(this.database, event.tenantId, async (transaction) => {
      const request = await resolver(transaction, event, this.tokens);
      if (event.eventType === "job.scheduled") {
        await scheduleServiceReminder(
          transaction,
          event,
          this.configuration.value.notifications.reminderLeadMinutes,
        );
      }
      const [template] = await transaction
        .select({ allowedVariables: notificationTemplates.allowedVariables })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, event.tenantId),
            eq(notificationTemplates.templateKey, request.templateKey),
            eq(notificationTemplates.channel, "email"),
            eq(notificationTemplates.status, "published"),
          ),
        );
      if (!template || !sameVariables(template.allowedVariables, request.variables)) {
        throw new NotificationPolicyConfigurationError();
      }

      const auditEventId = randomUUID();
      const requestEventId = randomUUID();
      await transaction.insert(auditEvents).values({
        actorUserId: event.createdBy,
        after: {
          channel: "email",
          notificationType: request.notificationType,
          status: "queued",
          templateKey: request.templateKey,
        },
        commandName: "QueueNotificationFromBusinessEvent",
        entityId: requestEventId,
        entityType: "NotificationRequest",
        eventType: "notification.requested",
        id: auditEventId,
        metadata: { sourceEventId: event.id, sourceEventType: event.eventType },
        tenantId: event.tenantId,
      });
      await transaction.insert(outboxEvents).values({
        aggregateId: request.customerAccountId,
        aggregateType: "CustomerAccount",
        createdBy: event.createdBy,
        eventType: "notification.requested",
        id: requestEventId,
        payload: {
          auditEventId,
          capability: request.capability,
          channel: "email",
          contactId: request.contactId,
          customerAccountId: request.customerAccountId,
          notificationType: request.notificationType,
          ...(request.projectId ? { projectId: request.projectId } : {}),
          sourceEventId: event.id,
          templateKey: request.templateKey,
          variables: request.variables,
        },
        tenantId: event.tenantId,
        updatedBy: event.createdBy,
      });
    });
  }
}

async function scheduleServiceReminder(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  leadMinutes: number,
): Promise<void> {
  const job = await requireJob(transaction, event.tenantId, event.aggregateId);
  if (!job.scheduledStartAt) throw new NotificationPolicyTargetError();
  const dedupeKey = `service-reminder:${job.id}:${job.scheduledStartAt.toISOString()}`;
  const desiredRunAt = new Date(job.scheduledStartAt.getTime() - leadMinutes * 60_000);
  const runAt = desiredRunAt > new Date() ? desiredRunAt : new Date();
  const [created] = await transaction
    .insert(scheduledJobs)
    .values({
      createdBy: event.createdBy,
      dedupeKey,
      jobType: "communications.service_reminder",
      payload: {
        actorUserId: event.createdBy,
        jobId: job.id,
        scheduledStartAt: job.scheduledStartAt.toISOString(),
      },
      runAt,
      tenantId: event.tenantId,
      updatedBy: event.createdBy,
    })
    .onConflictDoNothing()
    .returning({ id: scheduledJobs.id });
  if (!created) return;

  const auditEventId = randomUUID();
  await transaction.insert(auditEvents).values({
    actorUserId: event.createdBy,
    after: { jobType: "communications.service_reminder", runAt: runAt.toISOString() },
    commandName: "ScheduleServiceReminder",
    entityId: created.id,
    entityType: "ScheduledJob",
    eventType: "notification.reminder_scheduled",
    id: auditEventId,
    metadata: { jobId: job.id, sourceEventId: event.id },
    tenantId: event.tenantId,
  });
  await transaction.insert(outboxEvents).values({
    aggregateId: created.id,
    aggregateType: "ScheduledJob",
    createdBy: event.createdBy,
    eventType: "notification.reminder_scheduled",
    payload: { auditEventId, jobId: job.id, runAt: runAt.toISOString() },
    tenantId: event.tenantId,
    updatedBy: event.createdBy,
  });
}

async function resolveQuoteSent(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
): Promise<PolicyRequest> {
  const [record] = await transaction
    .select({ contact: contacts, customer: customerAccounts, quote: quotes })
    .from(quotes)
    .innerJoin(
      contacts,
      and(eq(contacts.tenantId, quotes.tenantId), eq(contacts.id, quotes.primaryContactId)),
    )
    .innerJoin(
      customerAccounts,
      and(
        eq(customerAccounts.tenantId, quotes.tenantId),
        eq(customerAccounts.id, quotes.customerAccountId),
      ),
    )
    .where(
      and(eq(quotes.tenantId, event.tenantId), eq(quotes.id, event.payload.quoteId as string)),
    );
  const link = await activeQuoteLink(transaction, event.tenantId, event.aggregateId);
  if (!record || !link) throw new NotificationPolicyTargetError();
  return {
    capability: { kind: "quote", linkId: link.id, targetId: event.aggregateId },
    contactId: record.contact.id,
    customerAccountId: record.customer.id,
    notificationType: "quote",
    templateKey: "quote.sent",
    variables: {
      customerName: record.customer.displayName,
      quoteNumber: record.quote.quoteNumber,
      secureUrl: secureLinkPlaceholder,
    },
  };
}

async function resolveContractSent(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
): Promise<PolicyRequest> {
  const [contract] = await transaction
    .select()
    .from(contracts)
    .where(and(eq(contracts.tenantId, event.tenantId), eq(contracts.id, event.aggregateId)));
  if (!contract) throw new NotificationPolicyTargetError();
  const audience = await projectAudience(transaction, event.tenantId, contract.projectId);
  const [link] = await transaction
    .select()
    .from(contractPublicLinks)
    .where(
      and(
        eq(contractPublicLinks.tenantId, event.tenantId),
        eq(contractPublicLinks.contractId, contract.id),
        isNull(contractPublicLinks.revokedAt),
        gt(contractPublicLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(contractPublicLinks.createdAt))
    .limit(1);
  if (!link) throw new NotificationPolicyTargetError();
  return projectRequest(audience, "contract", "contract.sent", {
    kind: "contract",
    linkId: link.id,
    targetId: contract.id,
  });
}

async function resolveContractExecuted(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const [contract] = await transaction
    .select()
    .from(contracts)
    .where(and(eq(contracts.tenantId, event.tenantId), eq(contracts.id, event.aggregateId)));
  if (!contract) throw new NotificationPolicyTargetError();
  return projectCapabilityRequest(
    transaction,
    event,
    tokens,
    contract.projectId,
    "contract",
    "contract.executed",
  );
}

async function resolveJobScheduled(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const job = await requireJob(transaction, event.tenantId, event.aggregateId);
  const request = await projectCapabilityRequest(
    transaction,
    event,
    tokens,
    job.projectId,
    "schedule",
    "job.scheduled",
  );
  request.variables.scheduledAt = job.scheduledStartAt?.toISOString() ?? "To be confirmed";
  return request;
}

async function resolveMaterialOnTheWay(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const [record] = await transaction
    .select({ projectId: jobs.projectId })
    .from(materialLoads)
    .innerJoin(
      materialDeliveryDetails,
      and(
        eq(materialDeliveryDetails.tenantId, materialLoads.tenantId),
        eq(materialDeliveryDetails.id, materialLoads.materialDeliveryDetailId),
      ),
    )
    .innerJoin(
      jobs,
      and(eq(jobs.tenantId, materialLoads.tenantId), eq(jobs.id, materialDeliveryDetails.jobId)),
    )
    .where(
      and(eq(materialLoads.tenantId, event.tenantId), eq(materialLoads.id, event.aggregateId)),
    );
  if (!record) throw new NotificationPolicyTargetError();
  return projectCapabilityRequest(
    transaction,
    event,
    tokens,
    record.projectId,
    "on_the_way",
    "service.on_the_way",
  );
}

async function resolveRentalOnTheWay(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const [record] = await transaction
    .select({ projectId: jobs.projectId })
    .from(dumpTrailerRentalDetails)
    .innerJoin(
      jobs,
      and(
        eq(jobs.tenantId, dumpTrailerRentalDetails.tenantId),
        eq(jobs.id, dumpTrailerRentalDetails.jobId),
      ),
    )
    .where(
      and(
        eq(dumpTrailerRentalDetails.tenantId, event.tenantId),
        eq(dumpTrailerRentalDetails.id, event.aggregateId),
      ),
    );
  if (!record) throw new NotificationPolicyTargetError();
  return projectCapabilityRequest(
    transaction,
    event,
    tokens,
    record.projectId,
    "on_the_way",
    "service.on_the_way",
  );
}

async function resolveJobCompleted(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const job = await requireJob(transaction, event.tenantId, event.aggregateId);
  return projectCapabilityRequest(
    transaction,
    event,
    tokens,
    job.projectId,
    "completion",
    "job.completed",
  );
}

async function resolveInvoiceSent(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
): Promise<PolicyRequest> {
  const [invoice] = await transaction
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, event.tenantId), eq(invoices.id, event.aggregateId)));
  if (!invoice) throw new NotificationPolicyTargetError();
  const audience = await projectAudience(transaction, event.tenantId, invoice.projectId);
  const [link] = await transaction
    .select()
    .from(invoicePublicLinks)
    .where(
      and(
        eq(invoicePublicLinks.tenantId, event.tenantId),
        eq(invoicePublicLinks.invoiceId, invoice.id),
        isNull(invoicePublicLinks.revokedAt),
        gt(invoicePublicLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invoicePublicLinks.createdAt))
    .limit(1);
  if (!link) throw new NotificationPolicyTargetError();
  return {
    capability: { kind: "invoice", linkId: link.id, targetId: link.invoiceVersionId },
    contactId: audience.contactId,
    customerAccountId: audience.customerAccountId,
    notificationType: "invoice",
    projectId: audience.projectId,
    templateKey: "invoice.sent",
    variables: {
      customerName: audience.customerName,
      invoiceNumber: invoice.invoiceNumber,
      secureUrl: secureLinkPlaceholder,
    },
  };
}

async function resolvePaymentSettled(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const [payment] = await transaction
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, event.tenantId), eq(payments.id, event.aggregateId)));
  if (!payment?.projectId) throw new NotificationPolicyTargetError();
  const request = await projectCapabilityRequest(
    transaction,
    event,
    tokens,
    payment.projectId,
    "receipt",
    "payment.receipt",
  );
  request.variables.amount = formatMoney(payment.amountCents, payment.currency);
  return request;
}

async function resolveRefundSettled(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
): Promise<PolicyRequest> {
  const [refund] = await transaction
    .select()
    .from(refunds)
    .where(and(eq(refunds.tenantId, event.tenantId), eq(refunds.id, event.aggregateId)));
  if (!refund?.projectId) throw new NotificationPolicyTargetError();
  const request = await projectCapabilityRequest(
    transaction,
    event,
    tokens,
    refund.projectId,
    "refund",
    "refund.settled",
  );
  request.variables.amount = formatMoney(refund.amountCents, refund.currency);
  return request;
}

async function projectCapabilityRequest(
  transaction: TenantTransaction,
  event: ClaimedOutboxEvent,
  tokens: CustomerCapabilityTokenService,
  projectId: string,
  notificationType: string,
  templateKey: string,
): Promise<PolicyRequest> {
  const audience = await projectAudience(transaction, event.tenantId, projectId);
  const ensured = await ensureProjectCapability(transaction, tokens, {
    ...(event.createdBy ? { actorUserId: event.createdBy } : {}),
    projectId,
    tenantId: event.tenantId,
  });
  if (ensured.revokedLinkId) {
    await recordAutomatedCapabilityChange(
      transaction,
      event,
      ensured.revokedLinkId,
      projectId,
      true,
    );
  }
  if (ensured.created) {
    await recordAutomatedCapabilityChange(
      transaction,
      event,
      ensured.reference.linkId,
      projectId,
      false,
    );
  }
  return projectRequest(audience, notificationType, templateKey, {
    kind: "project",
    linkId: ensured.reference.linkId,
    targetId: projectId,
  });
}

function projectRequest(
  audience: ProjectAudience,
  notificationType: string,
  templateKey: string,
  capability: PolicyRequest["capability"],
): PolicyRequest {
  return {
    capability,
    contactId: audience.contactId,
    customerAccountId: audience.customerAccountId,
    notificationType,
    projectId: audience.projectId,
    templateKey,
    variables: {
      customerName: audience.customerName,
      projectNumber: audience.projectNumber,
      secureUrl: secureLinkPlaceholder,
    },
  };
}

async function projectAudience(
  transaction: TenantTransaction,
  tenantId: string,
  projectId: string,
): Promise<ProjectAudience> {
  const [record] = await transaction
    .select({ contactId: contacts.id, customer: customerAccounts, project: projects })
    .from(projects)
    .innerJoin(
      customerAccounts,
      and(
        eq(customerAccounts.tenantId, projects.tenantId),
        eq(customerAccounts.id, projects.customerAccountId),
      ),
    )
    .innerJoin(
      contacts,
      and(eq(contacts.tenantId, projects.tenantId), eq(contacts.id, projects.primaryContactId)),
    )
    .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)));
  if (!record) throw new NotificationPolicyTargetError();
  return {
    contactId: record.contactId,
    customerAccountId: record.customer.id,
    customerName: record.customer.displayName,
    projectId: record.project.id,
    projectNumber: record.project.projectNumber,
  };
}

async function requireJob(transaction: TenantTransaction, tenantId: string, jobId: string) {
  const [job] = await transaction
    .select()
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  if (!job) throw new NotificationPolicyTargetError();
  return job;
}

async function activeQuoteLink(
  transaction: TenantTransaction,
  tenantId: string,
  quoteVersionId: string,
) {
  const [link] = await transaction
    .select()
    .from(quotePublicLinks)
    .where(
      and(
        eq(quotePublicLinks.tenantId, tenantId),
        eq(quotePublicLinks.quoteVersionId, quoteVersionId),
        isNull(quotePublicLinks.revokedAt),
        gt(quotePublicLinks.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(quotePublicLinks.createdAt))
    .limit(1);
  return link;
}

async function recordAutomatedCapabilityChange(
  transaction: TenantTransaction,
  source: ClaimedOutboxEvent,
  linkId: string,
  projectId: string,
  revoked: boolean,
): Promise<void> {
  const auditEventId = randomUUID();
  const eventType = revoked ? "project.public_link_revoked" : "project.public_link_created";
  await transaction.insert(auditEvents).values({
    actorUserId: source.createdBy,
    after: revoked ? { reason: "expired" } : { scope: "summary" },
    commandName: revoked
      ? "ExpireCustomerProjectLinkForNotification"
      : "CreateCustomerProjectLinkForNotification",
    entityId: linkId,
    entityType: "ProjectPublicLink",
    eventType,
    id: auditEventId,
    metadata: { projectId, sourceEventId: source.id },
    tenantId: source.tenantId,
  });
  await transaction.insert(outboxEvents).values({
    aggregateId: linkId,
    aggregateType: "ProjectPublicLink",
    createdBy: source.createdBy,
    eventType,
    payload: { auditEventId, projectId, sourceEventId: source.id },
    tenantId: source.tenantId,
    updatedBy: source.createdBy,
  });
}

function sameVariables(allowed: string[], supplied: Record<string, string>): boolean {
  const expected = [...allowed].toSorted();
  const actual = Object.keys(supplied).toSorted();
  return (
    expected.length === actual.length && expected.every((value, index) => value === actual[index])
  );
}

function formatMoney(cents: number, currency: string): string {
  const whole = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100)
    .toString()
    .padStart(2, "0");
  return `${currency} ${whole.toString()}.${remainder}`;
}

export class NotificationPolicyError extends Error {
  public override readonly name = "NotificationPolicyError";
}

export class NotificationPolicyConfigurationError extends Error {
  public override readonly name = "NotificationPolicyConfigurationError";
}

export class NotificationPolicyTargetError extends Error {
  public override readonly name = "NotificationPolicyTargetError";
}
