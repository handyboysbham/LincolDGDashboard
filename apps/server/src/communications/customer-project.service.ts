import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  auditEvents,
  contacts,
  customerAccounts,
  documentLinks,
  documentPublicLinks,
  documents,
  invoicePublicLinks,
  invoices,
  invoiceVersions,
  jobEvents,
  jobs,
  outboxEvents,
  payments,
  projectPublicLinks,
  projectPublicLinkViews,
  projects,
  refunds,
  serviceLocations,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  CreateProjectPublicLinkDto,
  ProjectPublicLinkDto,
  PublicProjectDocumentDto,
  PublicProjectDto,
  PublicProjectInvoiceDto,
} from "./communications.dto.js";
import {
  CustomerCapabilityTokenService,
  type CustomerCapabilityReference,
} from "./customer-capability-token.service.js";

export interface EnsuredProjectCapability {
  created: boolean;
  customerAccountId: string;
  reference: CustomerCapabilityReference;
  revokedLinkId?: string;
}

const customerDocumentPurposes = [
  "completion_photo",
  "customer_attachment",
  "delivery_ticket",
  "rental_condition",
] as const;

const milestoneLabels: Record<string, string> = {
  "contract.executed": "Contract completed",
  "job.closed": "Service completed",
  "job.operationally_completed": "Work completed",
  "job.scheduled": "Service scheduled",
  "job.started": "Work started",
  "material_delivery.load_delivered": "Material delivered",
  "payment.settled": "Payment received",
  "project.created_from_quote": "Project created",
  "rental.dropoff_completed": "Trailer delivered",
  "rental.pickup_retrieved": "Trailer retrieved",
};

const publicPaymentStatuses = [
  "settled",
  "partially_allocated",
  "fully_allocated",
  "partially_refunded",
  "refunded",
  "reversed",
  "resolved",
] as const;

const hiddenInvoiceStatuses = ["draft", "review_required", "ready_to_post"] as const;

@Injectable()
export class CustomerProjectService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(CustomerCapabilityTokenService)
    private readonly tokens: CustomerCapabilityTokenService,
  ) {}

  public async createPublicLink(
    projectId: string,
    input: CreateProjectPublicLinkDto,
    key: string,
  ): Promise<ProjectPublicLinkDto> {
    const actor = this.context.actor();
    const expiresInSeconds = input.expiresInSeconds ?? this.tokens.defaultExpiresInSeconds();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { expiresInSeconds, projectId },
        scope: "communications.projects.create-public-link",
      },
      async (transaction) => {
        const project = await lockProject(transaction, actor.tenantId, projectId);
        const now = new Date();
        const active = await currentProjectLink(transaction, actor.tenantId, projectId);
        if (active) {
          await transaction
            .update(projectPublicLinks)
            .set({ revokedAt: now, updatedBy: actor.userId })
            .where(
              and(
                eq(projectPublicLinks.tenantId, actor.tenantId),
                eq(projectPublicLinks.id, active.id),
                isNull(projectPublicLinks.revokedAt),
              ),
            );
          await recordProjectLinkChange(transaction, actor, {
            after: { revokedAt: now.toISOString() },
            commandName: "RotateCustomerProjectLink",
            eventType: "project.public_link_revoked",
            linkId: active.id,
            projectId,
          });
        }
        const linkId = randomUUID();
        const expiresAt = new Date(now.getTime() + expiresInSeconds * 1_000);
        const reference = projectReference(actor.tenantId, projectId, linkId);
        const token = this.tokens.create(reference);
        await transaction.insert(projectPublicLinks).values({
          createdBy: actor.userId,
          customerAccountId: project.customerAccountId,
          expiresAt,
          id: linkId,
          projectId,
          tenantId: actor.tenantId,
          tokenHash: token.hash,
          updatedBy: actor.userId,
        });
        await recordProjectLinkChange(transaction, actor, {
          after: { expiresAt: expiresAt.toISOString(), scope: "summary" },
          commandName: "CreateCustomerProjectLink",
          eventType: "project.public_link_created",
          linkId,
          projectId,
        });
        return {
          body: {
            customerPath: this.tokens.customerPath(reference),
            expiresAt: expiresAt.toISOString(),
            linkId,
          },
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async revokePublicLink(projectId: string, linkId: string, key: string): Promise<void> {
    const actor = this.context.actor();
    await this.idempotency.execute(
      {
        key,
        payload: { linkId, projectId },
        scope: "communications.projects.revoke-public-link",
      },
      async (transaction) => {
        await lockProject(transaction, actor.tenantId, projectId);
        const [link] = await transaction
          .select()
          .from(projectPublicLinks)
          .where(
            and(
              eq(projectPublicLinks.tenantId, actor.tenantId),
              eq(projectPublicLinks.id, linkId),
              eq(projectPublicLinks.projectId, projectId),
            ),
          )
          .for("update");
        if (!link) throw notFound("PROJECT_LINK_NOT_FOUND", "Customer Project link was not found");
        if (!link.revokedAt) {
          const revokedAt = new Date();
          await transaction
            .update(projectPublicLinks)
            .set({ revokedAt, updatedBy: actor.userId })
            .where(
              and(
                eq(projectPublicLinks.tenantId, actor.tenantId),
                eq(projectPublicLinks.id, linkId),
                isNull(projectPublicLinks.revokedAt),
              ),
            );
          await recordProjectLinkChange(transaction, actor, {
            after: { revokedAt: revokedAt.toISOString() },
            commandName: "RevokeCustomerProjectLink",
            eventType: "project.public_link_revoked",
            linkId,
            projectId,
          });
        }
        return { body: {}, status: HttpStatus.OK };
      },
    );
  }

  public async resolvePublic(token: string): Promise<PublicProjectDto> {
    const parsed = this.tokens.parseProject(token);
    if (!parsed) throw invalidProjectLink();
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const [link] = await transaction
        .select()
        .from(projectPublicLinks)
        .where(
          and(
            eq(projectPublicLinks.tenantId, parsed.tenantId),
            eq(projectPublicLinks.id, parsed.linkId),
          ),
        )
        .for("update");
      if (!link || !this.tokens.matches(parsed.secret, link.tokenHash)) throw invalidProjectLink();
      if (link.revokedAt)
        throw gone("PROJECT_LINK_REVOKED", "This Customer Project link was revoked");
      const now = new Date();
      if (link.expiresAt <= now)
        throw gone("PROJECT_LINK_EXPIRED", "This Customer Project link has expired");

      const oneMinuteAgo = new Date(now.getTime() - 60_000);
      const [recent] = await transaction
        .select({ value: count() })
        .from(projectPublicLinkViews)
        .where(
          and(
            eq(projectPublicLinkViews.tenantId, parsed.tenantId),
            eq(projectPublicLinkViews.projectPublicLinkId, link.id),
            gte(projectPublicLinkViews.viewedAt, oneMinuteAgo),
          ),
        );
      if ((recent?.value ?? 0) >= 60) {
        throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          "PROJECT_LINK_RATE_LIMITED",
          "Too many Customer Project requests",
        );
      }

      await transaction.insert(projectPublicLinkViews).values({
        correlationId: this.context.correlationId(),
        projectPublicLinkId: link.id,
        tenantId: parsed.tenantId,
        viewedAt: now,
      });
      await transaction
        .update(projectPublicLinks)
        .set({
          firstViewedAt: link.firstViewedAt ?? now,
          lastViewedAt: now,
          viewCount: link.viewCount + 1,
        })
        .where(
          and(eq(projectPublicLinks.tenantId, parsed.tenantId), eq(projectPublicLinks.id, link.id)),
        );
      await recordProjectLinkChange(
        transaction,
        { tenantId: parsed.tenantId },
        {
          after: { firstView: link.viewCount === 0, viewCount: link.viewCount + 1 },
          commandName: "ViewCustomerProject",
          eventType: "project.public_link_viewed",
          linkId: link.id,
          projectId: link.projectId,
        },
      );
      return this.projectDto(transaction, parsed.tenantId, link.projectId);
    });
  }

  private async projectDto(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<PublicProjectDto> {
    const [record] = await transaction
      .select({
        contact: contacts,
        customer: customerAccounts,
        location: serviceLocations,
        project: projects,
      })
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
      .innerJoin(
        serviceLocations,
        and(
          eq(serviceLocations.tenantId, projects.tenantId),
          eq(serviceLocations.id, projects.serviceLocationId),
        ),
      )
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)));
    if (!record) throw invalidProjectLink();

    const projectJobs = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.projectId, projectId)))
      .orderBy(asc(jobs.createdAt));
    const jobIds = projectJobs.map((job) => job.id);
    const events =
      jobIds.length === 0
        ? []
        : await transaction
            .select()
            .from(jobEvents)
            .where(
              and(
                eq(jobEvents.tenantId, tenantId),
                inArray(jobEvents.jobId, jobIds),
                inArray(jobEvents.eventType, Object.keys(milestoneLabels)),
              ),
            )
            .orderBy(desc(jobEvents.occurredAt))
            .limit(50);
    const projectInvoices = await transaction
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.projectId, projectId),
          notInArray(invoices.status, [...hiddenInvoiceStatuses]),
        ),
      )
      .orderBy(desc(invoices.createdAt));
    const invoiceDtos = await this.invoiceDtos(transaction, tenantId, projectInvoices);
    const projectPayments = await transaction
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.projectId, projectId),
          inArray(payments.status, [...publicPaymentStatuses]),
        ),
      )
      .orderBy(desc(payments.receivedAt));
    const projectRefunds = await transaction
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.projectId, projectId)))
      .orderBy(desc(refunds.createdAt));

    return {
      contact: {
        displayName: record.contact.displayName,
        email: record.contact.email,
        phone: record.contact.phone,
      },
      documents: await this.documentDtos(transaction, tenantId, projectId),
      invoices: invoiceDtos,
      location: {
        addressLine1: record.location.addressLine1,
        addressLine2: record.location.addressLine2,
        city: record.location.city,
        label: record.location.label,
        postalCode: record.location.postalCode,
        region: record.location.region,
      },
      milestones: events.map((event) => ({
        label: milestoneLabels[event.eventType] ?? "Project updated",
        occurredAt: event.occurredAt.toISOString(),
        type: event.eventType,
      })),
      outcomeStatement: record.project.outcomeStatement,
      payments: projectPayments.map((payment) => ({
        amountCents: payment.amountCents,
        currency: payment.currency,
        paymentNumber: payment.paymentNumber,
        receivedAt: payment.receivedAt.toISOString(),
        settledAt: payment.settledAt?.toISOString() ?? null,
        status: payment.status,
      })),
      projectNumber: record.project.projectNumber,
      refunds: projectRefunds
        .filter(
          (refund) => !["draft", "review_required", "pending_approval"].includes(refund.status),
        )
        .map((refund) => ({
          amountCents: refund.amountCents,
          currency: refund.currency,
          refundNumber: refund.refundNumber,
          settledAt: refund.settledAt?.toISOString() ?? null,
          status: refund.status,
        })),
      schedule: projectJobs.map((job) => ({
        jobNumber: job.jobNumber,
        scheduledEndAt: job.scheduledEndAt?.toISOString() ?? null,
        scheduledStartAt: job.scheduledStartAt?.toISOString() ?? null,
        serviceType: job.serviceType,
        status: job.status,
      })),
      serviceType: record.project.serviceType,
      status: record.project.status,
    };
  }

  private async invoiceDtos(
    transaction: TenantTransaction,
    tenantId: string,
    projectInvoices: (typeof invoices.$inferSelect)[],
  ): Promise<PublicProjectInvoiceDto[]> {
    if (projectInvoices.length === 0) return [];
    const ids = projectInvoices.map((invoice) => invoice.id);
    const versions = await transaction
      .select()
      .from(invoiceVersions)
      .where(
        and(
          eq(invoiceVersions.tenantId, tenantId),
          inArray(invoiceVersions.invoiceId, ids),
          eq(invoiceVersions.status, "posted"),
        ),
      );
    const now = new Date();
    const links = await transaction
      .select()
      .from(invoicePublicLinks)
      .where(
        and(
          eq(invoicePublicLinks.tenantId, tenantId),
          inArray(invoicePublicLinks.invoiceId, ids),
          isNull(invoicePublicLinks.revokedAt),
          gt(invoicePublicLinks.expiresAt, now),
        ),
      )
      .orderBy(desc(invoicePublicLinks.createdAt));
    return projectInvoices.map((invoice) => {
      const version = versions.find((candidate) => candidate.invoiceId === invoice.id);
      const link = links.find((candidate) => candidate.invoiceId === invoice.id);
      const reference =
        link && version
          ? {
              kind: "invoice" as const,
              linkId: link.id,
              targetId: link.invoiceVersionId,
              tenantId,
            }
          : undefined;
      const validReference =
        reference && this.tokens.create(reference).hash === link?.tokenHash ? reference : undefined;
      return {
        amountDueCents: version?.amountDueCents ?? null,
        customerPath: validReference ? this.tokens.customerPath(validReference) : null,
        dueDate: invoice.dueDate,
        invoiceNumber: invoice.invoiceNumber,
        invoiceType: invoice.invoiceType,
        issueDate: invoice.issueDate,
        status: invoice.status,
        totalCents: version?.totalCents ?? null,
      };
    });
  }

  private async documentDtos(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<PublicProjectDocumentDto[]> {
    const linked = await transaction
      .select({ document: documents, link: documentLinks })
      .from(documentLinks)
      .innerJoin(
        documents,
        and(
          eq(documents.tenantId, documentLinks.tenantId),
          eq(documents.id, documentLinks.documentId),
        ),
      )
      .where(
        and(
          eq(documentLinks.tenantId, tenantId),
          eq(documentLinks.entityType, "Project"),
          eq(documentLinks.entityId, projectId),
          inArray(documentLinks.purpose, [...customerDocumentPurposes]),
          eq(documents.status, "available"),
        ),
      );
    if (linked.length === 0) return [];
    const now = new Date();
    const links = await transaction
      .select()
      .from(documentPublicLinks)
      .where(
        and(
          eq(documentPublicLinks.tenantId, tenantId),
          inArray(
            documentPublicLinks.documentId,
            linked.map((record) => record.document.id),
          ),
          isNull(documentPublicLinks.revokedAt),
          gt(documentPublicLinks.expiresAt, now),
        ),
      )
      .orderBy(desc(documentPublicLinks.createdAt));
    return linked.flatMap((record) => {
      const link = links.find((candidate) => candidate.documentId === record.document.id);
      if (!link) return [];
      const reference = {
        kind: "document" as const,
        linkId: link.id,
        targetId: record.document.id,
        tenantId,
      };
      if (this.tokens.create(reference).hash !== link.tokenHash) return [];
      return [
        {
          customerPath: this.tokens.customerPath(reference),
          filename: record.document.originalFilename,
          mediaType: record.document.mediaType,
          purpose: record.link.purpose,
        },
      ];
    });
  }
}

export async function ensureProjectCapability(
  transaction: TenantTransaction,
  tokens: CustomerCapabilityTokenService,
  input: { actorUserId?: string; projectId: string; tenantId: string },
): Promise<EnsuredProjectCapability> {
  const project = await lockProject(transaction, input.tenantId, input.projectId);
  const now = new Date();
  const current = await currentProjectLink(transaction, input.tenantId, input.projectId);
  if (current && current.expiresAt > now) {
    return {
      created: false,
      customerAccountId: project.customerAccountId,
      reference: projectReference(input.tenantId, input.projectId, current.id),
    };
  }
  if (current) {
    await transaction
      .update(projectPublicLinks)
      .set({ revokedAt: now, updatedBy: input.actorUserId })
      .where(
        and(
          eq(projectPublicLinks.tenantId, input.tenantId),
          eq(projectPublicLinks.id, current.id),
          isNull(projectPublicLinks.revokedAt),
        ),
      );
  }
  const linkId = randomUUID();
  const reference = projectReference(input.tenantId, input.projectId, linkId);
  const token = tokens.create(reference);
  await transaction.insert(projectPublicLinks).values({
    createdBy: input.actorUserId,
    customerAccountId: project.customerAccountId,
    expiresAt: new Date(now.getTime() + tokens.defaultExpiresInSeconds() * 1_000),
    id: linkId,
    projectId: input.projectId,
    tenantId: input.tenantId,
    tokenHash: token.hash,
    updatedBy: input.actorUserId,
  });
  return {
    created: true,
    customerAccountId: project.customerAccountId,
    reference,
    ...(current ? { revokedLinkId: current.id } : {}),
  };
}

async function lockProject(transaction: TenantTransaction, tenantId: string, projectId: string) {
  const [project] = await transaction
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
    .for("update");
  if (!project) throw notFound("PROJECT_NOT_FOUND", "Project was not found");
  return project;
}

async function currentProjectLink(
  transaction: TenantTransaction,
  tenantId: string,
  projectId: string,
) {
  const [link] = await transaction
    .select()
    .from(projectPublicLinks)
    .where(
      and(
        eq(projectPublicLinks.tenantId, tenantId),
        eq(projectPublicLinks.projectId, projectId),
        eq(projectPublicLinks.scope, "summary"),
        isNull(projectPublicLinks.revokedAt),
      ),
    )
    .limit(1);
  return link;
}

function projectReference(
  tenantId: string,
  projectId: string,
  linkId: string,
): CustomerCapabilityReference {
  return { kind: "project", linkId, targetId: projectId, tenantId };
}

async function recordProjectLinkChange(
  transaction: TenantTransaction,
  actor: { tenantId: string; userId?: string },
  input: {
    after: unknown;
    commandName: string;
    eventType: string;
    linkId: string;
    projectId: string;
  },
): Promise<void> {
  const auditEventId = randomUUID();
  await transaction.insert(auditEvents).values({
    actorUserId: actor.userId,
    after: input.after,
    commandName: input.commandName,
    entityId: input.linkId,
    entityType: "ProjectPublicLink",
    eventType: input.eventType,
    id: auditEventId,
    metadata: { projectId: input.projectId },
    tenantId: actor.tenantId,
  });
  await transaction.insert(outboxEvents).values({
    aggregateId: input.linkId,
    aggregateType: "ProjectPublicLink",
    createdBy: actor.userId,
    eventType: input.eventType,
    payload: { auditEventId, projectId: input.projectId },
    tenantId: actor.tenantId,
    updatedBy: actor.userId,
  });
}

function invalidProjectLink(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, "PROJECT_LINK_INVALID", "Project link is invalid");
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}

function gone(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.GONE, code, message);
}
