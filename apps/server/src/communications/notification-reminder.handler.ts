import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  auditEvents,
  contacts,
  customerAccounts,
  jobs,
  notificationTemplates,
  outboxEvents,
  projects,
  withTenantTransaction,
  type ClaimedScheduledJob,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DATABASE } from "../database/database.tokens.js";
import {
  ScheduledJobHandlerRegistry,
  type ScheduledJobHandler,
} from "../scheduled/scheduled-job-handler.registry.js";
import { CustomerCapabilityTokenService } from "./customer-capability-token.service.js";
import { ensureProjectCapability } from "./customer-project.service.js";

const terminalJobStatuses = new Set([
  "cancelled",
  "closed",
  "financially_complete",
  "operationally_complete",
]);
const secureLinkPlaceholder = "[secure customer link]";

@Injectable()
export class NotificationReminderHandler implements ScheduledJobHandler, OnModuleInit {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ScheduledJobHandlerRegistry) private readonly registry: ScheduledJobHandlerRegistry,
    @Inject(CustomerCapabilityTokenService)
    private readonly tokens: CustomerCapabilityTokenService,
  ) {}

  public onModuleInit(): void {
    this.registry.register("communications.service_reminder", this);
  }

  public async handle(job: ClaimedScheduledJob): Promise<void> {
    const payload = parsePayload(job.payload);
    await withTenantTransaction(this.database, job.tenantId, async (transaction) => {
      const [record] = await transaction
        .select({ contact: contacts, customer: customerAccounts, job: jobs, project: projects })
        .from(jobs)
        .innerJoin(
          projects,
          and(eq(projects.tenantId, jobs.tenantId), eq(projects.id, jobs.projectId)),
        )
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
        .where(and(eq(jobs.tenantId, job.tenantId), eq(jobs.id, payload.jobId)));
      if (!record) throw new NotificationReminderTargetError();
      if (
        record.job.scheduledStartAt?.toISOString() !== payload.scheduledStartAt ||
        terminalJobStatuses.has(record.job.status)
      ) {
        return;
      }

      const variables = {
        customerName: record.customer.displayName,
        projectNumber: record.project.projectNumber,
        scheduledAt: record.job.scheduledStartAt.toISOString(),
        secureUrl: secureLinkPlaceholder,
      };
      const [template] = await transaction
        .select({ allowedVariables: notificationTemplates.allowedVariables })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, job.tenantId),
            eq(notificationTemplates.templateKey, "service.reminder"),
            eq(notificationTemplates.channel, "email"),
            eq(notificationTemplates.status, "published"),
          ),
        );
      if (!template || !sameVariables(template.allowedVariables, variables)) {
        throw new NotificationReminderConfigurationError();
      }

      const capability = await ensureProjectCapability(transaction, this.tokens, {
        ...(payload.actorUserId ? { actorUserId: payload.actorUserId } : {}),
        projectId: record.project.id,
        tenantId: job.tenantId,
      });
      if (capability.revokedLinkId) {
        await recordCapabilityChange(
          transaction,
          job,
          payload.actorUserId,
          capability.revokedLinkId,
          record.project.id,
          true,
        );
      }
      if (capability.created) {
        await recordCapabilityChange(
          transaction,
          job,
          payload.actorUserId,
          capability.reference.linkId,
          record.project.id,
          false,
        );
      }

      const auditEventId = randomUUID();
      const requestEventId = randomUUID();
      await transaction.insert(auditEvents).values({
        actorUserId: payload.actorUserId,
        after: {
          channel: "email",
          notificationType: "reminder",
          status: "queued",
          templateKey: "service.reminder",
        },
        commandName: "QueueScheduledServiceReminder",
        entityId: requestEventId,
        entityType: "NotificationRequest",
        eventType: "notification.requested",
        id: auditEventId,
        metadata: { jobId: record.job.id, scheduledJobId: job.id },
        tenantId: job.tenantId,
      });
      await transaction.insert(outboxEvents).values({
        aggregateId: record.customer.id,
        aggregateType: "CustomerAccount",
        createdBy: payload.actorUserId,
        eventType: "notification.requested",
        id: requestEventId,
        payload: {
          auditEventId,
          capability: {
            kind: "project",
            linkId: capability.reference.linkId,
            targetId: record.project.id,
          },
          channel: "email",
          contactId: record.contact.id,
          customerAccountId: record.customer.id,
          notificationType: "reminder",
          projectId: record.project.id,
          sourceEventId: job.id,
          templateKey: "service.reminder",
          variables,
        },
        tenantId: job.tenantId,
        updatedBy: payload.actorUserId,
      });
    });
  }
}

async function recordCapabilityChange(
  transaction: TenantTransaction,
  source: ClaimedScheduledJob,
  actorUserId: string | null,
  linkId: string,
  projectId: string,
  revoked: boolean,
): Promise<void> {
  const auditEventId = randomUUID();
  const eventType = revoked ? "project.public_link_revoked" : "project.public_link_created";
  await transaction.insert(auditEvents).values({
    actorUserId,
    after: revoked ? { reason: "expired" } : { scope: "summary" },
    commandName: revoked
      ? "ExpireCustomerProjectLinkForReminder"
      : "CreateCustomerProjectLinkForReminder",
    entityId: linkId,
    entityType: "ProjectPublicLink",
    eventType,
    id: auditEventId,
    metadata: { projectId, scheduledJobId: source.id },
    tenantId: source.tenantId,
  });
  await transaction.insert(outboxEvents).values({
    aggregateId: linkId,
    aggregateType: "ProjectPublicLink",
    createdBy: actorUserId,
    eventType,
    payload: { auditEventId, projectId, scheduledJobId: source.id },
    tenantId: source.tenantId,
    updatedBy: actorUserId,
  });
}

function parsePayload(payload: Record<string, unknown>): {
  actorUserId: string | null;
  jobId: string;
  scheduledStartAt: string;
} {
  const actorUserId = payload.actorUserId;
  const jobId = payload.jobId;
  const scheduledStartAt = payload.scheduledStartAt;
  if (
    (actorUserId !== null && actorUserId !== undefined && typeof actorUserId !== "string") ||
    typeof jobId !== "string" ||
    typeof scheduledStartAt !== "string"
  ) {
    throw new NotificationReminderTargetError();
  }
  return {
    actorUserId: typeof actorUserId === "string" ? actorUserId : null,
    jobId,
    scheduledStartAt,
  };
}

function sameVariables(allowed: string[], supplied: Record<string, string>): boolean {
  const expected = [...allowed].toSorted();
  const actual = Object.keys(supplied).toSorted();
  return (
    expected.length === actual.length && expected.every((value, index) => value === actual[index])
  );
}

export class NotificationReminderConfigurationError extends Error {
  public override readonly name = "NotificationReminderConfigurationError";
}

export class NotificationReminderTargetError extends Error {
  public override readonly name = "NotificationReminderTargetError";
}
