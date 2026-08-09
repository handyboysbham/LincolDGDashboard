import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  contacts,
  customerAccounts,
  customerCreditApplications,
  customerCredits,
  depositApplications,
  invoiceAdjustments,
  invoiceDeliveries,
  invoiceLineItems,
  invoicePublicLinks,
  invoices,
  invoiceVersions,
  jobCharges,
  jobs,
  materialDeliveryDetails,
  outboxEvents,
  paymentAllocations,
  projects,
  quoteLineItems,
  quoteVersions,
  refunds,
  serviceLocations,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  IdempotentCommandService,
  hashCanonicalPayload,
} from "../idempotency/idempotent-command.service.js";
import { allocateCents, calculateInvoice, money } from "./invoice-calculation.js";
import { FinancialCompletionService } from "./financial-completion.service.js";
import { InvoiceTokenService, type ParsedInvoiceToken } from "./invoice-token.service.js";
import type {
  CreateInvoiceAdjustmentDto,
  CreateInvoiceDto,
  CreateInvoicePublicLinkDto,
  InvoiceAdjustmentDto,
  InvoiceCorrectionReasonDto,
  InvoiceDeliveryDto,
  InvoiceDto,
  InvoiceLineItemDto,
  InvoiceListResponseDto,
  InvoicePublicLinkDto,
  InvoiceSummaryDto,
  InvoiceType,
  InvoiceVersionDto,
  PublicInvoiceDto,
  RecordInvoiceDeliveryDto,
  ReplaceInvoiceDto,
} from "./finance.dto.js";

interface Actor {
  tenantId: string;
  userId: string;
}

type InvoiceRecord = typeof invoices.$inferSelect;
type InvoiceAdjustmentRecord = typeof invoiceAdjustments.$inferSelect;
type InvoiceVersionRecord = typeof invoiceVersions.$inferSelect;
type JobRecord = typeof jobs.$inferSelect;
type ProjectRecord = typeof projects.$inferSelect;

interface InvoiceContext {
  contact: typeof contacts.$inferSelect;
  customer: typeof customerAccounts.$inferSelect;
  job: JobRecord | null;
  location: typeof serviceLocations.$inferSelect;
  project: ProjectRecord;
  quote: typeof quoteVersions.$inferSelect;
}

interface DraftLine {
  acceptedQuoteLineItemId?: string;
  customerCreditApplicationId?: string;
  depositApplicationId?: string;
  description: string;
  direction: "credit" | "debit";
  invoiceAdjustmentId?: string;
  jobChargeId?: string;
  lineType:
    | "accepted_quote"
    | "adjustment"
    | "customer_credit"
    | "deposit_application"
    | "job_charge"
    | "rounding"
    | "tax";
  quantity: string | null;
  sequence: number;
  sourceId: string | null;
  sourceSnapshot: Record<string, unknown>;
  sourceType:
    | "accepted_quote_line"
    | "customer_credit_application"
    | "deposit_application"
    | "invoice_adjustment"
    | "job_charge"
    | "rounding_rule"
    | "tax_rule";
  subtotalCents: number;
  taxBehavior: "non_taxable" | "tax_included" | "taxable";
  taxCents: number;
  totalCents: number;
  unit: string | null;
  unitPriceCents: number | null;
}

interface DraftVersion {
  billingIdentitySnapshot: Record<string, unknown>;
  calculationSnapshot: Record<string, unknown>;
  contentHash: string;
  customerCreditApplicationCents: number;
  depositApplicationCents: number;
  discountCents: number;
  lines: DraftLine[];
  subtotalCents: number;
  taxCents: number;
  termsSnapshot: Record<string, unknown>;
  totalCents: number;
  amountDueCents: number;
}

interface InvoiceFinancials {
  appliedTotalCents: number;
  currentTotalCents: number;
  outstandingBalanceCents: number;
  postedVersion: InvoiceVersionRecord;
  rawCurrentTotalCents: number;
}

@Injectable()
export class InvoicesService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(FinancialCompletionService)
    private readonly financialCompletion: FinancialCompletionService,
    @Inject(InvoiceTokenService) private readonly tokens: InvoiceTokenService,
  ) {}

  public async list(status?: string, projectId?: string): Promise<InvoiceListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const conditions = [eq(invoices.tenantId, actor.tenantId)];
      if (status) conditions.push(eq(invoices.status, status));
      if (projectId) conditions.push(eq(invoices.projectId, projectId));
      const records = await transaction
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.updatedAt))
        .limit(100);
      const items: InvoiceSummaryDto[] = [];
      for (const record of records) {
        const invoice = await this.getInTransaction(transaction, actor.tenantId, record.id);
        items.push(summaryDto(invoice));
      }
      return { items };
    });
  }

  public async get(invoiceId: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.getInTransaction(transaction, actor.tenantId, invoiceId),
    );
  }

  public async create(
    projectId: string,
    input: CreateInvoiceDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, projectId }, scope: "invoices.create" },
      async (transaction) => {
        const context = await this.loadProjectContext(
          transaction,
          actor.tenantId,
          projectId,
          input.jobId ?? null,
          true,
        );
        this.assertCreateReady(context, input.invoiceType);
        await this.assertNoConflictingInvoice(
          transaction,
          actor.tenantId,
          context,
          input.invoiceType,
        );
        const invoiceNumber = await allocateBusinessNumber(transaction, {
          entityType: "invoice",
          prefix: "INV",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [invoice] = await transaction
          .insert(invoices)
          .values({
            createdBy: actor.userId,
            customerAccountId: context.project.customerAccountId,
            invoiceNumber,
            invoiceType: input.invoiceType,
            jobId: context.job?.id,
            projectId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!invoice) throw new Error("Invoice was not created");
        const draft = await this.buildDraftVersion(
          transaction,
          invoice,
          context,
          1,
          input.dueInDays ?? 14,
        );
        const version = await this.insertVersion(transaction, actor, invoice, 1, draft);
        await this.recordChange(transaction, actor, {
          after: { invoiceType: invoice.invoiceType, status: invoice.status, versionNumber: 1 },
          commandName: "CreateInvoice",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.created",
          metadata: { invoiceVersionId: version.id, jobId: invoice.jobId, projectId },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async revise(invoiceId: string, key: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { invoiceId }, scope: "invoices.revise" },
      async (transaction) => {
        const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        if (!["draft", "review_required", "ready_to_post"].includes(invoice.status)) {
          throw conflict("INVOICE_NOT_REVISION_READY", "Only an unposted Invoice can be revised");
        }
        const [latest] = await transaction
          .select()
          .from(invoiceVersions)
          .where(
            and(
              eq(invoiceVersions.tenantId, actor.tenantId),
              eq(invoiceVersions.invoiceId, invoiceId),
            ),
          )
          .orderBy(desc(invoiceVersions.versionNumber))
          .limit(1)
          .for("update");
        if (!latest) throw notFound("INVOICE_VERSION_NOT_FOUND", "Invoice Version not found");
        if (latest.status === "posted") {
          throw conflict(
            "INVOICE_VERSION_POSTED",
            "A posted Invoice requires an Adjustment, Credit Memo, or replacement",
          );
        }
        const context = await this.loadProjectContext(
          transaction,
          actor.tenantId,
          invoice.projectId,
          invoice.jobId,
          true,
        );
        this.assertCreateReady(context, asInvoiceType(invoice.invoiceType));
        await transaction
          .update(invoiceVersions)
          .set({ status: "superseded", updatedBy: actor.userId })
          .where(
            and(eq(invoiceVersions.tenantId, actor.tenantId), eq(invoiceVersions.id, latest.id)),
          );
        const nextNumber = latest.versionNumber + 1;
        const draft = await this.buildDraftVersion(
          transaction,
          invoice,
          context,
          nextNumber,
          dueInDays(latest.termsSnapshot),
        );
        const version = await this.insertVersion(
          transaction,
          actor,
          invoice,
          nextNumber,
          draft,
          latest.id,
        );
        await transaction
          .update(invoices)
          .set({ status: "draft", updatedBy: actor.userId })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId)));
        await this.recordChange(transaction, actor, {
          after: { status: "draft", versionNumber: nextNumber },
          before: { status: invoice.status, versionNumber: latest.versionNumber },
          commandName: "ReviseInvoice",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.revised",
          metadata: { invoiceVersionId: version.id, supersededInvoiceVersionId: latest.id },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async prepare(invoiceVersionId: string, key: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { invoiceVersionId }, scope: "invoice-versions.prepare" },
      async (transaction) => {
        const preview = await this.findVersion(transaction, actor.tenantId, invoiceVersionId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const version = await this.lockVersion(transaction, actor.tenantId, invoiceVersionId);
        if (version.status !== "draft" || invoice.status !== "draft") {
          throw conflict(
            "INVOICE_VERSION_NOT_DRAFT",
            "Preparing requires the current Invoice Version to be Draft",
          );
        }
        await this.assertVersionCurrent(transaction, invoice, version);
        await transaction
          .update(invoiceVersions)
          .set({ status: "ready_to_post", updatedBy: actor.userId })
          .where(
            and(
              eq(invoiceVersions.tenantId, actor.tenantId),
              eq(invoiceVersions.id, invoiceVersionId),
            ),
          );
        await transaction
          .update(invoices)
          .set({ status: "ready_to_post", updatedBy: actor.userId })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id)));
        await this.recordChange(transaction, actor, {
          after: { status: "ready_to_post" },
          before: { status: "draft" },
          commandName: "PrepareInvoiceVersion",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.ready_to_post",
          metadata: { invoiceVersionId },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async post(invoiceVersionId: string, key: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { invoiceVersionId }, scope: "invoice-versions.post" },
      async (transaction) => {
        const preview = await this.findVersion(transaction, actor.tenantId, invoiceVersionId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const version = await this.lockVersion(transaction, actor.tenantId, invoiceVersionId);
        if (version.status !== "ready_to_post" || invoice.status !== "ready_to_post") {
          throw conflict(
            "INVOICE_VERSION_NOT_READY",
            "Posting requires the current Invoice Version to be Ready to Post",
          );
        }
        const current = await this.assertVersionCurrent(transaction, invoice, version);
        const postedAt = new Date();
        const issueDate = utcDate(postedAt);
        const dueDate = addUtcDays(issueDate, dueInDays(version.termsSnapshot));
        await transaction
          .update(invoiceVersions)
          .set({ postedAt, postedBy: actor.userId, status: "posted", updatedBy: actor.userId })
          .where(
            and(
              eq(invoiceVersions.tenantId, actor.tenantId),
              eq(invoiceVersions.id, invoiceVersionId),
            ),
          );
        await transaction
          .update(invoices)
          .set({
            dueDate,
            issueDate,
            postedAt,
            status: "posted",
            updatedBy: actor.userId,
          })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id)));

        const chargeIds = current.lines
          .map((line) => line.jobChargeId)
          .filter((id): id is string => Boolean(id));
        if (chargeIds.length > 0) {
          const updatedCharges = await transaction
            .update(jobCharges)
            .set({
              invoicedAmountCents: jobCharges.approvedAmountCents,
              status: "invoiced",
              updatedBy: actor.userId,
            })
            .where(
              and(
                eq(jobCharges.tenantId, actor.tenantId),
                inArray(jobCharges.id, chargeIds),
                eq(jobCharges.status, "ready_to_invoice"),
              ),
            )
            .returning();
          if (updatedCharges.length !== chargeIds.length) {
            throw conflict(
              "INVOICE_JOB_CHARGE_CHANGED",
              "An included Job Charge changed before Invoice posting",
            );
          }
          for (const charge of updatedCharges) {
            await this.recordChange(transaction, actor, {
              after: { invoicedAmountCents: charge.invoicedAmountCents, status: charge.status },
              before: { status: "ready_to_invoice" },
              commandName: "PostInvoiceVersion",
              entityId: charge.id,
              entityType: "JobCharge",
              eventType: "job_charge.invoiced",
              metadata: { invoiceId: invoice.id, invoiceVersionId },
            });
          }
        }

        if (invoice.invoiceType === "final" && invoice.jobId) {
          const [updatedJob] = await transaction
            .update(jobs)
            .set({ status: "invoiced", updatedBy: actor.userId })
            .where(
              and(
                eq(jobs.tenantId, actor.tenantId),
                eq(jobs.id, invoice.jobId),
                eq(jobs.status, "awaiting_final_invoice"),
              ),
            )
            .returning();
          if (!updatedJob) {
            throw conflict(
              "JOB_NOT_AWAITING_FINAL_INVOICE",
              "A Final Invoice requires a Job awaiting its Final Invoice",
            );
          }
          await this.recordChange(transaction, actor, {
            after: { status: "invoiced" },
            before: { status: "awaiting_final_invoice" },
            commandName: "PostFinalInvoice",
            entityId: updatedJob.id,
            entityType: "Job",
            eventType: "job.invoiced",
            metadata: { invoiceId: invoice.id, invoiceVersionId },
          });
        }
        await this.recordChange(transaction, actor, {
          after: { dueDate, issueDate, status: "posted", totalCents: version.totalCents },
          before: { status: "ready_to_post" },
          commandName: "PostInvoiceVersion",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.posted",
          metadata: { invoiceVersionId },
        });
        await this.financialCompletion.reconcileProject(transaction, actor, invoice.projectId);
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async recordDelivery(
    invoiceId: string,
    input: RecordInvoiceDeliveryDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, invoiceId }, scope: "invoices.record-delivery" },
      async (transaction) => {
        if (input.status === "failed" && !input.failureReason?.trim()) {
          throw badRequest(
            "INVOICE_DELIVERY_FAILURE_REASON_REQUIRED",
            "A failed Invoice Delivery requires a reason",
          );
        }
        if (input.status !== "failed" && input.failureReason) {
          throw badRequest(
            "INVOICE_DELIVERY_FAILURE_REASON_FORBIDDEN",
            "Only a failed Invoice Delivery can include a failure reason",
          );
        }
        const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        if (!invoice.postedAt || ["voided", "replaced", "archived"].includes(invoice.status)) {
          throw conflict("INVOICE_NOT_DELIVERABLE", "Delivery evidence requires a posted Invoice");
        }
        const [version] = await transaction
          .select()
          .from(invoiceVersions)
          .where(
            and(
              eq(invoiceVersions.tenantId, actor.tenantId),
              eq(invoiceVersions.invoiceId, invoiceId),
              eq(invoiceVersions.status, "posted"),
            ),
          )
          .limit(1)
          .for("update");
        if (!version) throw conflict("INVOICE_POSTED_VERSION_MISSING", "Posted Version not found");
        const occurredAt = parseOccurredAt(input.occurredAt);
        const [delivery] = await transaction
          .insert(invoiceDeliveries)
          .values({
            attemptedAt: occurredAt,
            channel: input.channel,
            createdBy: actor.userId,
            deliveredAt: input.status === "delivered" ? occurredAt : undefined,
            destinationSnapshot: { destination: input.destination },
            failureReason: input.failureReason,
            invoiceId,
            invoiceVersionId: version.id,
            providerReference: input.providerReference,
            sentAt: ["sent", "delivered"].includes(input.status) ? occurredAt : undefined,
            status: input.status,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!delivery) throw new Error("Invoice Delivery was not recorded");
        if (input.status !== "failed" && invoice.status === "posted") {
          await transaction
            .update(invoices)
            .set({ sentAt: occurredAt, status: "sent", updatedBy: actor.userId })
            .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId)));
        }
        await this.recordChange(transaction, actor, {
          after: { channel: input.channel, status: input.status },
          commandName: "RecordInvoiceDelivery",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: `invoice.delivery_${input.status}`,
          metadata: { invoiceDeliveryId: delivery.id, invoiceVersionId: version.id },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async createPublicLink(
    invoiceId: string,
    input: CreateInvoicePublicLinkDto,
    key: string,
  ): Promise<InvoicePublicLinkDto> {
    const actor = this.context.actor();
    const recipient = input.recipient.trim().toLowerCase();
    const expiresInDays = input.expiresInDays ?? 14;
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const creationKeyHash = this.tokens.creationKeyHash(key);
      const requestHash = hashCanonicalPayload({ expiresInDays, invoiceId, recipient });
      const [existing] = await transaction
        .select()
        .from(invoicePublicLinks)
        .where(
          and(
            eq(invoicePublicLinks.tenantId, actor.tenantId),
            eq(invoicePublicLinks.creationKeyHash, creationKeyHash),
          ),
        )
        .for("update");
      if (existing) {
        if (existing.invoiceId !== invoiceId || existing.requestHash !== requestHash) {
          throw conflict(
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency key was used for another Invoice share",
          );
        }
        const token = this.tokens.create({
          invoiceVersionId: existing.invoiceVersionId,
          linkId: existing.id,
          tenantId: actor.tenantId,
        }).token;
        return {
          customerPath: `/customer/invoices/${token}`,
          expiresAt: existing.expiresAt.toISOString(),
          invoice: await this.getInTransaction(transaction, actor.tenantId, invoiceId),
          linkId: existing.id,
          token,
        };
      }

      const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
      if (!invoice.postedAt || ["archived", "replaced", "voided"].includes(invoice.status)) {
        throw conflict("INVOICE_NOT_SHAREABLE", "A current posted Invoice is required");
      }
      const [version] = await transaction
        .select()
        .from(invoiceVersions)
        .where(
          and(
            eq(invoiceVersions.tenantId, actor.tenantId),
            eq(invoiceVersions.invoiceId, invoiceId),
            eq(invoiceVersions.status, "posted"),
          ),
        )
        .limit(1)
        .for("update");
      if (!version) throw conflict("INVOICE_POSTED_VERSION_MISSING", "Posted Version not found");

      const now = new Date();
      const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000);
      const [delivery] = await transaction
        .insert(invoiceDeliveries)
        .values({
          attemptedAt: now,
          channel: "link",
          createdBy: actor.userId,
          destinationSnapshot: { recipient },
          invoiceId,
          invoiceVersionId: version.id,
          sentAt: now,
          status: "sent",
          tenantId: actor.tenantId,
          updatedBy: actor.userId,
        })
        .returning();
      if (!delivery) throw new Error("Invoice Delivery was not created");
      const linkId = randomUUID();
      const token = this.tokens.create({
        invoiceVersionId: version.id,
        linkId,
        tenantId: actor.tenantId,
      });
      await transaction.insert(invoicePublicLinks).values({
        createdBy: actor.userId,
        creationKeyHash,
        expiresAt,
        id: linkId,
        invoiceDeliveryId: delivery.id,
        invoiceId,
        invoiceVersionId: version.id,
        recipient,
        requestHash,
        tenantId: actor.tenantId,
        tokenHash: token.hash,
        updatedBy: actor.userId,
      });
      if (invoice.status === "posted") {
        await transaction
          .update(invoices)
          .set({ sentAt: now, status: "sent", updatedBy: actor.userId })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId)));
      }
      await this.recordChange(transaction, actor, {
        after: { channel: "link", expiresAt: expiresAt.toISOString(), status: "sent" },
        before: { status: invoice.status },
        commandName: "ShareInvoice",
        entityId: invoiceId,
        entityType: "Invoice",
        eventType: "invoice.sent",
        metadata: { invoiceDeliveryId: delivery.id, invoicePublicLinkId: linkId },
      });
      return {
        customerPath: `/customer/invoices/${token.token}`,
        expiresAt: expiresAt.toISOString(),
        invoice: await this.getInTransaction(transaction, actor.tenantId, invoiceId),
        linkId,
        token: token.token,
      };
    });
  }

  public async revokePublicLink(
    invoiceId: string,
    linkId: string,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { invoiceId, linkId }, scope: "invoices.revoke-public-link" },
      async (transaction) => {
        await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        const [link] = await transaction
          .select()
          .from(invoicePublicLinks)
          .where(
            and(
              eq(invoicePublicLinks.tenantId, actor.tenantId),
              eq(invoicePublicLinks.id, linkId),
              eq(invoicePublicLinks.invoiceId, invoiceId),
            ),
          )
          .for("update");
        if (!link) throw notFound("INVOICE_LINK_NOT_FOUND", "Invoice link not found");
        if (!link.revokedAt) {
          const revokedAt = new Date();
          await transaction
            .update(invoicePublicLinks)
            .set({ revokedAt, updatedBy: actor.userId })
            .where(
              and(
                eq(invoicePublicLinks.tenantId, actor.tenantId),
                eq(invoicePublicLinks.id, linkId),
              ),
            );
          await this.recordChange(transaction, actor, {
            after: { revokedAt: revokedAt.toISOString() },
            commandName: "RevokeInvoiceLink",
            entityId: invoiceId,
            entityType: "Invoice",
            eventType: "invoice.link_revoked",
            metadata: { invoicePublicLinkId: linkId },
          });
        }
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoiceId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async resolvePublic(token: string): Promise<PublicInvoiceDto> {
    const parsed = this.parsePublicToken(token);
    return withTenantTransaction(this.database, parsed.tenantId, async (transaction) => {
      const [link] = await transaction
        .select()
        .from(invoicePublicLinks)
        .where(
          and(
            eq(invoicePublicLinks.tenantId, parsed.tenantId),
            eq(invoicePublicLinks.id, parsed.linkId),
          ),
        )
        .for("update");
      if (!link || !this.tokens.matches(parsed.secret, link.tokenHash)) {
        throw notFound("INVOICE_LINK_INVALID", "Invoice link is invalid");
      }
      if (link.revokedAt) {
        throw new ApiException(HttpStatus.GONE, "INVOICE_LINK_REVOKED", "Invoice link was revoked");
      }
      if (link.expiresAt <= new Date()) {
        throw new ApiException(HttpStatus.GONE, "INVOICE_LINK_EXPIRED", "Invoice link has expired");
      }
      const invoice = await this.lockInvoice(transaction, parsed.tenantId, link.invoiceId);
      if (["archived", "replaced", "voided"].includes(invoice.status)) {
        throw new ApiException(
          HttpStatus.GONE,
          "INVOICE_UNAVAILABLE",
          "This Invoice is no longer current",
        );
      }

      const now = new Date();
      if (!link.lastViewedAt) {
        await transaction
          .update(invoiceDeliveries)
          .set({ status: "viewed", updatedBy: null, viewedAt: now })
          .where(
            and(
              eq(invoiceDeliveries.tenantId, parsed.tenantId),
              eq(invoiceDeliveries.id, link.invoiceDeliveryId),
            ),
          );
        if (invoice.status === "sent") {
          await transaction
            .update(invoices)
            .set({ status: "viewed", updatedBy: null })
            .where(and(eq(invoices.tenantId, parsed.tenantId), eq(invoices.id, invoice.id)));
          invoice.status = "viewed";
        }
        await this.recordChange(transaction, undefined, {
          after: { status: "viewed" },
          before: { status: invoice.status === "viewed" ? "sent" : invoice.status },
          commandName: "ViewInvoice",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.viewed",
          metadata: { invoiceDeliveryId: link.invoiceDeliveryId, invoicePublicLinkId: link.id },
          tenantId: parsed.tenantId,
        });
      }
      await transaction
        .update(invoicePublicLinks)
        .set({ lastViewedAt: now, updatedBy: null, viewCount: link.viewCount + 1 })
        .where(
          and(eq(invoicePublicLinks.tenantId, parsed.tenantId), eq(invoicePublicLinks.id, link.id)),
        );
      return this.publicInvoiceDto(transaction, parsed.tenantId, invoice, link.invoiceVersionId);
    });
  }

  public async createAdjustment(
    invoiceId: string,
    input: CreateInvoiceAdjustmentDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, invoiceId }, scope: "invoice-adjustments.create" },
      async (transaction) => {
        const reason = correctionReason(input.reason);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        await this.invoiceFinancials(transaction, actor.tenantId, invoice);
        const direction = adjustmentDirection(input);
        this.assertAdjustmentInput(invoice, input, direction);
        const adjustmentNumber = await allocateBusinessNumber(transaction, {
          entityType: "invoice_adjustment",
          prefix: "ADJ",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [adjustment] = await transaction
          .insert(invoiceAdjustments)
          .values({
            adjustmentNumber,
            adjustmentType: input.adjustmentType,
            amountCents: input.amountCents,
            createdBy: actor.userId,
            direction,
            effectiveAt: parseEffectiveAt(input.effectiveAt),
            invoiceId,
            newDueDate: input.newDueDate,
            reason,
            sourceId: input.sourceId,
            sourceType: input.sourceType?.trim(),
            status: "pending_approval",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!adjustment) throw new Error("Invoice Adjustment was not created");
        await this.recordChange(transaction, actor, {
          after: {
            adjustmentType: adjustment.adjustmentType,
            amountCents: adjustment.amountCents,
            direction: adjustment.direction,
            status: adjustment.status,
          },
          commandName: "CreateInvoiceAdjustment",
          entityId: adjustment.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.created",
          metadata: { invoiceId },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoiceId),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async approveAdjustment(adjustmentId: string, key: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { adjustmentId }, scope: "invoice-adjustments.approve" },
      async (transaction) => {
        const preview = await this.findAdjustment(transaction, actor.tenantId, adjustmentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        const adjustment = await this.lockAdjustment(transaction, actor.tenantId, adjustmentId);
        if (adjustment.status !== "pending_approval") {
          throw conflict(
            "INVOICE_ADJUSTMENT_NOT_PENDING_APPROVAL",
            "Approving requires a pending Invoice Adjustment",
          );
        }
        const approvedAt = new Date();
        await transaction
          .update(invoiceAdjustments)
          .set({
            approvedAt,
            approvedBy: actor.userId,
            status: "approved",
            updatedBy: actor.userId,
          })
          .where(
            and(
              eq(invoiceAdjustments.tenantId, actor.tenantId),
              eq(invoiceAdjustments.id, adjustmentId),
            ),
          );
        await this.recordChange(transaction, actor, {
          after: { approvedAt, approvedBy: actor.userId, status: "approved" },
          before: { status: adjustment.status },
          commandName: "ApproveInvoiceAdjustment",
          entityId: adjustment.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.approved",
          metadata: { invoiceId: invoice.id },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async postAdjustment(adjustmentId: string, key: string): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { adjustmentId }, scope: "invoice-adjustments.post" },
      async (transaction) => {
        const preview = await this.findAdjustment(transaction, actor.tenantId, adjustmentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        const adjustment = await this.lockAdjustment(transaction, actor.tenantId, adjustmentId);
        if (adjustment.status !== "approved") {
          throw conflict(
            "INVOICE_ADJUSTMENT_NOT_APPROVED",
            "Posting requires an approved Invoice Adjustment",
          );
        }
        this.assertStoredAdjustment(invoice, adjustment);
        const before = await this.invoiceFinancials(transaction, actor.tenantId, invoice);
        await this.resolveAdjustmentCreditForReversal(transaction, actor, adjustment);
        const postedAt = new Date();
        await transaction
          .update(invoiceAdjustments)
          .set({ postedAt, postedBy: actor.userId, status: "posted", updatedBy: actor.userId })
          .where(
            and(
              eq(invoiceAdjustments.tenantId, actor.tenantId),
              eq(invoiceAdjustments.id, adjustmentId),
            ),
          );
        const rawAfterTotal = checkedSignedAdd(
          before.rawCurrentTotalCents,
          adjustment.direction === "debit" ? adjustment.amountCents : -adjustment.amountCents,
        );
        const afterTotal = Math.max(rawAfterTotal, 0);
        const creditBefore = Math.max(before.appliedTotalCents - before.rawCurrentTotalCents, 0);
        const creditAfter = Math.max(before.appliedTotalCents - rawAfterTotal, 0);
        const customerCreditCents = Math.max(creditAfter - creditBefore, 0);
        const customerCredit =
          customerCreditCents > 0
            ? await this.insertAdjustmentCustomerCredit(
                transaction,
                actor,
                invoice,
                adjustment,
                customerCreditCents,
              )
            : null;
        const invoiceStatus = adjustedInvoiceStatus(
          adjustment,
          afterTotal,
          before.appliedTotalCents,
        );
        await transaction
          .update(invoices)
          .set({
            dueDate:
              adjustment.adjustmentType === "due_date_extension"
                ? adjustment.newDueDate
                : invoice.dueDate,
            status: invoiceStatus,
            updatedBy: actor.userId,
          })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id)));
        await this.recordChange(transaction, actor, {
          after: { postedAt, postedBy: actor.userId, status: "posted" },
          before: { status: adjustment.status },
          commandName: "PostInvoiceAdjustment",
          entityId: adjustment.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.posted",
          metadata: { invoiceId: invoice.id },
        });
        if (customerCredit) {
          await this.recordChange(transaction, actor, {
            after: {
              originalAmountCents: customerCredit.originalAmountCents,
              sourceType: customerCredit.sourceType,
              status: customerCredit.status,
            },
            commandName: "PostInvoiceAdjustment",
            entityId: customerCredit.id,
            entityType: "CustomerCredit",
            eventType: "customer_credit.created",
            metadata: { invoiceAdjustmentId: adjustment.id, invoiceId: invoice.id },
          });
        }
        await this.recordChange(transaction, actor, {
          after: {
            currentTotalCents: afterTotal,
            dueDate:
              adjustment.adjustmentType === "due_date_extension"
                ? adjustment.newDueDate
                : invoice.dueDate,
            status: invoiceStatus,
          },
          before: { currentTotalCents: before.currentTotalCents, status: invoice.status },
          commandName: "PostInvoiceAdjustment",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.adjusted",
          metadata: {
            ...(customerCredit ? { customerCreditId: customerCredit.id } : {}),
            invoiceAdjustmentId: adjustment.id,
          },
        });
        await this.financialCompletion.reconcileProject(transaction, actor, invoice.projectId);
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async reverseAdjustment(
    adjustmentId: string,
    input: InvoiceCorrectionReasonDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { adjustmentId, input }, scope: "invoice-adjustments.reverse" },
      async (transaction) => {
        const reason = correctionReason(input.reason);
        const preview = await this.findAdjustment(transaction, actor.tenantId, adjustmentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        const adjustment = await this.lockAdjustment(transaction, actor.tenantId, adjustmentId);
        if (adjustment.status !== "posted") {
          throw conflict(
            "INVOICE_ADJUSTMENT_NOT_POSTED",
            "Only a posted Invoice Adjustment can be reversed",
          );
        }
        if (
          adjustment.amountCents === 0 ||
          ["due_date_extension", "replacement", "void"].includes(adjustment.adjustmentType)
        ) {
          throw conflict(
            "INVOICE_ADJUSTMENT_NOT_REVERSIBLE",
            "This Invoice Adjustment requires a dedicated correction workflow",
          );
        }
        const [existing] = await transaction
          .select({ id: invoiceAdjustments.id })
          .from(invoiceAdjustments)
          .where(
            and(
              eq(invoiceAdjustments.tenantId, actor.tenantId),
              eq(invoiceAdjustments.reversesInvoiceAdjustmentId, adjustment.id),
            ),
          )
          .limit(1);
        if (existing) {
          throw conflict(
            "INVOICE_ADJUSTMENT_ALREADY_REVERSED",
            "A reversal already exists for this Invoice Adjustment",
          );
        }
        const adjustmentNumber = await allocateBusinessNumber(transaction, {
          entityType: "invoice_adjustment",
          prefix: "ADJ",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [reversal] = await transaction
          .insert(invoiceAdjustments)
          .values({
            adjustmentNumber,
            adjustmentType: "charge_reversal",
            amountCents: adjustment.amountCents,
            createdBy: actor.userId,
            direction: adjustment.direction === "debit" ? "credit" : "debit",
            effectiveAt: new Date(),
            invoiceId: invoice.id,
            reason,
            reversesInvoiceAdjustmentId: adjustment.id,
            sourceId: adjustment.id,
            sourceType: "invoice_adjustment",
            status: "pending_approval",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Invoice Adjustment reversal was not created");
        await this.recordChange(transaction, actor, {
          after: {
            amountCents: reversal.amountCents,
            direction: reversal.direction,
            status: reversal.status,
          },
          commandName: "ReverseInvoiceAdjustment",
          entityId: reversal.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.reversal_created",
          metadata: { invoiceId: invoice.id, reversesInvoiceAdjustmentId: adjustment.id },
        });
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async voidInvoice(
    invoiceId: string,
    input: InvoiceCorrectionReasonDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, invoiceId }, scope: "invoices.void" },
      async (transaction) => {
        const reason = correctionReason(input.reason);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        const financials = await this.invoiceFinancials(transaction, actor.tenantId, invoice);
        this.assertNoAppliedValue(financials);
        if (financials.currentTotalCents <= 0) {
          throw conflict("INVOICE_NOT_VOIDABLE", "Invoice has no remaining obligation to void");
        }
        const voidedAt = new Date();
        const adjustment = await this.insertSystemAdjustment(transaction, actor, {
          adjustmentType: "void",
          amountCents: financials.currentTotalCents,
          direction: "credit",
          effectiveAt: voidedAt,
          invoiceId,
          reason,
        });
        await transaction
          .update(invoices)
          .set({
            status: "voided",
            updatedBy: actor.userId,
            voidedAt,
            voidReason: reason,
          })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoiceId)));
        await this.recordChange(transaction, actor, {
          after: { amountCents: adjustment.amountCents, status: "posted" },
          commandName: "VoidInvoice",
          entityId: adjustment.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.posted",
          metadata: { invoiceId },
        });
        await this.recordChange(transaction, actor, {
          after: { status: "voided", voidReason: reason },
          before: { status: invoice.status },
          commandName: "VoidInvoice",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.voided",
          metadata: { invoiceAdjustmentId: adjustment.id },
        });
        await this.financialCompletion.reconcileProject(transaction, actor, invoice.projectId);
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, invoice.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async replaceInvoice(
    invoiceId: string,
    input: ReplaceInvoiceDto,
    key: string,
  ): Promise<InvoiceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, invoiceId }, scope: "invoices.replace" },
      async (transaction) => {
        const reason = correctionReason(input.reason);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, invoiceId);
        this.assertPostPostingCorrectionAllowed(invoice);
        const financials = await this.invoiceFinancials(transaction, actor.tenantId, invoice);
        this.assertNoAppliedValue(financials);
        if (
          financials.currentTotalCents !== financials.postedVersion.totalCents ||
          financials.postedVersion.depositApplicationCents !== 0 ||
          financials.postedVersion.customerCreditApplicationCents !== 0
        ) {
          throw conflict(
            "INVOICE_REPLACEMENT_REQUIRES_CLEAN_TOTAL",
            "Reverse monetary corrections and applied value before replacing this Invoice",
          );
        }
        const sourceLines = await transaction
          .select()
          .from(invoiceLineItems)
          .where(
            and(
              eq(invoiceLineItems.tenantId, actor.tenantId),
              eq(invoiceLineItems.invoiceVersionId, financials.postedVersion.id),
            ),
          )
          .orderBy(asc(invoiceLineItems.sequence));
        if (sourceLines.length === 0) {
          throw conflict("INVOICE_REPLACEMENT_LINES_MISSING", "Posted Invoice lines are missing");
        }
        const postedAt = new Date();
        const issueDate = utcDate(postedAt);
        const replacementDueInDays =
          input.dueInDays ?? dueInDays(financials.postedVersion.termsSnapshot);
        const dueDate = addUtcDays(issueDate, replacementDueInDays);
        const invoiceNumber = await allocateBusinessNumber(transaction, {
          entityType: "invoice",
          prefix: "INV",
          tenantId: actor.tenantId,
          year: postedAt.getUTCFullYear(),
        });
        const [replacement] = await transaction
          .insert(invoices)
          .values({
            createdBy: actor.userId,
            currency: invoice.currency,
            customerAccountId: invoice.customerAccountId,
            dueDate,
            invoiceNumber,
            invoiceType: invoice.invoiceType,
            issueDate,
            jobId: invoice.jobId,
            postedAt,
            projectId: invoice.projectId,
            replacesInvoiceId: invoice.id,
            status: "posted",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!replacement) throw new Error("Replacement Invoice was not created");
        const replacementDraft = replacementDraftVersion(
          invoice,
          replacement,
          financials.postedVersion,
          sourceLines,
          replacementDueInDays,
          reason,
        );
        const replacementVersion = await this.insertVersion(
          transaction,
          actor,
          replacement,
          1,
          replacementDraft,
        );
        await transaction
          .update(invoiceVersions)
          .set({ postedAt, postedBy: actor.userId, status: "posted", updatedBy: actor.userId })
          .where(
            and(
              eq(invoiceVersions.tenantId, actor.tenantId),
              eq(invoiceVersions.id, replacementVersion.id),
            ),
          );
        const adjustment = await this.insertSystemAdjustment(transaction, actor, {
          adjustmentType: "replacement",
          amountCents: financials.currentTotalCents,
          direction: "credit",
          effectiveAt: postedAt,
          invoiceId: invoice.id,
          reason,
          sourceId: replacement.id,
          sourceType: "replacement_invoice",
        });
        await transaction
          .update(invoices)
          .set({
            replacedByInvoiceId: replacement.id,
            status: "replaced",
            updatedBy: actor.userId,
          })
          .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id)));
        await this.recordChange(transaction, actor, {
          after: { amountCents: adjustment.amountCents, status: "posted" },
          commandName: "ReplaceInvoice",
          entityId: adjustment.id,
          entityType: "InvoiceAdjustment",
          eventType: "invoice_adjustment.posted",
          metadata: { invoiceId: invoice.id, replacementInvoiceId: replacement.id },
        });
        await this.recordChange(transaction, actor, {
          after: { replacedByInvoiceId: replacement.id, status: "replaced" },
          before: { status: invoice.status },
          commandName: "ReplaceInvoice",
          entityId: invoice.id,
          entityType: "Invoice",
          eventType: "invoice.replaced",
          metadata: { invoiceAdjustmentId: adjustment.id, replacementInvoiceId: replacement.id },
        });
        await this.recordChange(transaction, actor, {
          after: {
            invoiceNumber: replacement.invoiceNumber,
            replacesInvoiceId: invoice.id,
            status: "posted",
          },
          commandName: "ReplaceInvoice",
          entityId: replacement.id,
          entityType: "Invoice",
          eventType: "invoice.replacement_posted",
          metadata: { invoiceVersionId: replacementVersion.id, replacedInvoiceId: invoice.id },
        });
        await this.financialCompletion.reconcileProject(transaction, actor, invoice.projectId);
        return {
          body: await this.getInTransaction(transaction, actor.tenantId, replacement.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  private async loadProjectContext(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
    jobId: string | null,
    lock: boolean,
  ): Promise<InvoiceContext> {
    let projectQuery = transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1);
    if (lock) projectQuery = projectQuery.for("update") as typeof projectQuery;
    const [project] = await projectQuery;
    if (!project) throw notFound("PROJECT_NOT_FOUND", "Project not found");
    const [customer] = await transaction
      .select()
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.tenantId, tenantId),
          eq(customerAccounts.id, project.customerAccountId),
        ),
      )
      .limit(1);
    const [contact] = await transaction
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, project.primaryContactId)))
      .limit(1);
    const [location] = await transaction
      .select()
      .from(serviceLocations)
      .where(
        and(
          eq(serviceLocations.tenantId, tenantId),
          eq(serviceLocations.id, project.serviceLocationId),
        ),
      )
      .limit(1);
    const [quote] = await transaction
      .select()
      .from(quoteVersions)
      .where(
        and(
          eq(quoteVersions.tenantId, tenantId),
          eq(quoteVersions.id, project.acceptedQuoteVersionId),
        ),
      )
      .limit(1);
    if (!customer || !contact || !location || !quote) {
      throw conflict(
        "INVOICE_PROJECT_CONTEXT_INCOMPLETE",
        "Project billing or accepted Quote context is incomplete",
      );
    }
    let job: JobRecord | null = null;
    if (jobId) {
      let jobQuery = transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId), eq(jobs.projectId, projectId)))
        .limit(1);
      if (lock) jobQuery = jobQuery.for("update") as typeof jobQuery;
      const [foundJob] = await jobQuery;
      if (!foundJob) throw notFound("JOB_NOT_FOUND", "Job not found for Project");
      job = foundJob;
    }
    return { contact, customer, job, location, project, quote };
  }

  private assertCreateReady(context: InvoiceContext, invoiceType: InvoiceType): void {
    if (context.quote.status !== "accepted") {
      throw conflict("INVOICE_QUOTE_NOT_ACCEPTED", "Invoice requires the accepted Quote Version");
    }
    if (context.project.acceptedQuoteContentHash !== context.quote.contentHash) {
      throw conflict(
        "INVOICE_QUOTE_HASH_MISMATCH",
        "Project accepted Quote evidence does not match the Quote Version",
      );
    }
    if (invoiceType === "deposit") {
      if (context.job) {
        throw badRequest(
          "DEPOSIT_INVOICE_JOB_FORBIDDEN",
          "A Deposit Invoice belongs to the Project",
        );
      }
      if (context.project.requiredDepositCents <= 0) {
        throw conflict("DEPOSIT_NOT_REQUIRED", "Project does not require a positive deposit");
      }
      if (
        !["pending_deposit", "ready_for_planning", "planning", "active"].includes(
          context.project.status,
        )
      ) {
        throw conflict(
          "PROJECT_NOT_DEPOSIT_INVOICE_READY",
          "Project is not ready for a Deposit Invoice",
        );
      }
      return;
    }
    if (!context.job) {
      throw badRequest("INVOICE_JOB_REQUIRED", `${invoiceType} Invoice requires a Project Job`);
    }
    if (invoiceType === "final" && context.job.status !== "awaiting_final_invoice") {
      throw conflict(
        "JOB_NOT_AWAITING_FINAL_INVOICE",
        "A Final Invoice requires a Job awaiting its Final Invoice",
      );
    }
  }

  private async assertNoConflictingInvoice(
    transaction: TenantTransaction,
    tenantId: string,
    context: InvoiceContext,
    invoiceType: InvoiceType,
  ): Promise<void> {
    if (!["deposit", "final"].includes(invoiceType)) return;
    const conditions = [
      eq(invoices.tenantId, tenantId),
      eq(invoices.projectId, context.project.id),
      eq(invoices.invoiceType, invoiceType),
      notInArray(invoices.status, ["voided", "replaced", "archived"]),
    ];
    if (invoiceType === "final" && context.job) conditions.push(eq(invoices.jobId, context.job.id));
    const [existing] = await transaction
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(...conditions))
      .limit(1);
    if (existing) {
      throw conflict(
        "INVOICE_ALREADY_EXISTS",
        `An active ${invoiceType.replaceAll("_", " ")} Invoice already exists`,
      );
    }
  }

  private async buildDraftVersion(
    transaction: TenantTransaction,
    invoice: InvoiceRecord,
    context: InvoiceContext,
    versionNumber: number,
    dueDays: number,
  ): Promise<DraftVersion> {
    const invoiceType = asInvoiceType(invoice.invoiceType);
    const acceptedLines = await transaction
      .select()
      .from(quoteLineItems)
      .where(
        and(
          eq(quoteLineItems.tenantId, invoice.tenantId),
          eq(quoteLineItems.quoteVersionId, context.quote.id),
        ),
      )
      .orderBy(asc(quoteLineItems.sequence));
    if (acceptedLines.length === 0) {
      throw conflict("INVOICE_QUOTE_LINES_MISSING", "Accepted Quote has no billable Line Items");
    }
    const acceptedSubtotal = acceptedLines.reduce(
      (total, line) => checkedSignedAdd(total, money(line.totalCents, "Quote Line total")),
      0,
    );
    if (acceptedSubtotal !== context.quote.subtotalCents) {
      throw conflict(
        "INVOICE_QUOTE_TOTAL_MISMATCH",
        "Accepted Quote Line Items do not reconcile to the accepted subtotal",
      );
    }
    const expectedQuoteTotal = checkedSignedAdd(
      checkedSignedAdd(context.quote.subtotalCents, context.quote.adjustmentCents),
      context.quote.taxCents,
    );
    if (expectedQuoteTotal !== context.quote.totalCents) {
      throw conflict(
        "INVOICE_QUOTE_TOTAL_MISMATCH",
        "Accepted Quote calculation does not reconcile",
      );
    }

    const lines: DraftLine[] = [];
    if (invoiceType === "deposit") {
      const allocations = allocateCents(
        money(context.project.requiredDepositCents, "Project required deposit"),
        acceptedLines.map((line) => line.totalCents),
      );
      for (const [index, source] of acceptedLines.entries()) {
        const amount = allocations[index] ?? 0;
        if (amount === 0) continue;
        lines.push({
          acceptedQuoteLineItemId: source.id,
          description: `Deposit toward ${source.description}`,
          direction: "debit",
          lineType: "accepted_quote",
          quantity: null,
          sequence: lines.length + 1,
          sourceId: source.id,
          sourceSnapshot: quoteLineSnapshot(source),
          sourceType: "accepted_quote_line",
          subtotalCents: amount,
          taxBehavior: "non_taxable",
          taxCents: 0,
          totalCents: amount,
          unit: null,
          unitPriceCents: null,
        });
      }
    } else if (invoiceType === "final") {
      const taxAllocations = allocateCents(
        money(context.quote.taxCents, "Quote tax"),
        acceptedLines.map((line) => line.totalCents),
      );
      for (const [index, source] of acceptedLines.entries()) {
        const taxCents = taxAllocations[index] ?? 0;
        lines.push({
          acceptedQuoteLineItemId: source.id,
          description: source.description,
          direction: "debit",
          lineType: "accepted_quote",
          quantity: source.quantity,
          sequence: lines.length + 1,
          sourceId: source.id,
          sourceSnapshot: quoteLineSnapshot(source),
          sourceType: "accepted_quote_line",
          subtotalCents: source.totalCents,
          taxBehavior: taxCents > 0 ? "taxable" : "non_taxable",
          taxCents,
          totalCents: checkedSignedAdd(source.totalCents, taxCents),
          unit: source.unit,
          unitPriceCents: source.unitPriceCents,
        });
      }
      if (context.quote.adjustmentCents > 0) {
        lines.push({
          description: "Accepted Quote adjustment",
          direction: "debit",
          lineType: "rounding",
          quantity: null,
          sequence: lines.length + 1,
          sourceId: null,
          sourceSnapshot: { acceptedQuoteAdjustmentCents: context.quote.adjustmentCents },
          sourceType: "rounding_rule",
          subtotalCents: context.quote.adjustmentCents,
          taxBehavior: "non_taxable",
          taxCents: 0,
          totalCents: context.quote.adjustmentCents,
          unit: null,
          unitPriceCents: null,
        });
      }
    }

    const charges = await this.invoiceReadyCharges(transaction, invoice, context, invoiceType);
    for (const charge of charges) {
      const amount = charge.approvedAmountCents;
      if (amount === null) {
        throw conflict("INVOICE_JOB_CHARGE_UNAPPROVED", "Job Charge lacks an approved amount");
      }
      if (["taxable", "undetermined"].includes(charge.taxBehavior)) {
        throw conflict(
          "INVOICE_JOB_CHARGE_TAX_UNRESOLVED",
          "Every Job Charge requires resolved tax treatment before invoicing",
        );
      }
      const direction = invoiceType === "credit_memo" ? "credit" : "debit";
      lines.push({
        description: charge.customerDescription,
        direction,
        jobChargeId: charge.id,
        lineType: "job_charge",
        quantity: charge.quantity,
        sequence: lines.length + 1,
        sourceId: charge.id,
        sourceSnapshot: {
          approvedAmountCents: amount,
          calculationSnapshot: charge.calculationSnapshot,
          chargeKind: charge.chargeKind,
          chargeNumber: charge.chargeNumber,
          chargeType: charge.chargeType,
          customerDescription: charge.customerDescription,
          quantity: charge.quantity,
          rateCents: charge.rateCents,
          taxBehavior: charge.taxBehavior,
          unit: charge.unit,
        },
        sourceType: "job_charge",
        subtotalCents: money(amount, "Job Charge approved amount"),
        taxBehavior: charge.taxBehavior === "tax_included" ? "tax_included" : "non_taxable",
        taxCents: 0,
        totalCents: amount,
        unit: charge.unit,
        unitPriceCents: charge.rateCents,
      });
    }
    if (lines.length === 0) {
      throw conflict("INVOICE_SOURCES_REQUIRED", "Invoice requires at least one billable source");
    }
    const discountCents =
      invoiceType === "final" && context.quote.adjustmentCents < 0
        ? Math.abs(context.quote.adjustmentCents)
        : 0;
    const calculation = calculateInvoice({ discountCents, lines });
    const billingIdentitySnapshot = {
      contact: {
        displayName: context.contact.displayName,
        email: context.contact.email,
        phone: context.contact.phone,
      },
      customer: {
        customerAccountId: context.customer.id,
        displayName: context.customer.displayName,
        type: context.customer.customerType,
      },
      serviceLocation: {
        addressLine1: context.location.addressLine1,
        addressLine2: context.location.addressLine2,
        city: context.location.city,
        label: context.location.label,
        postalCode: context.location.postalCode,
        region: context.location.region,
      },
    };
    const termsSnapshot = {
      dueInDays: dueDays,
      invoiceType,
      paymentTerm: dueDays === 0 ? "Due on receipt" : `Due within ${dueDays.toString()} days`,
    };
    const calculationSnapshot = {
      acceptedQuoteContentHash: context.quote.contentHash,
      acceptedQuoteVersionId: context.quote.id,
      engineVersion: "invoice-v1",
      invoiceType,
      jobChargeIds: charges.map((charge) => charge.id),
      quoteAdjustmentCents: context.quote.adjustmentCents,
      quoteSubtotalCents: context.quote.subtotalCents,
      quoteTaxCents: context.quote.taxCents,
      quoteTotalCents: context.quote.totalCents,
    };
    const hashPayload = {
      billingIdentitySnapshot,
      calculation,
      calculationSnapshot,
      invoiceNumber: invoice.invoiceNumber,
      lines,
      termsSnapshot,
      versionNumber,
    };
    return {
      ...calculation,
      billingIdentitySnapshot,
      calculationSnapshot,
      contentHash: hashCanonicalPayload(hashPayload),
      lines,
      termsSnapshot,
    };
  }

  private async invoiceReadyCharges(
    transaction: TenantTransaction,
    invoice: InvoiceRecord,
    context: InvoiceContext,
    invoiceType: InvoiceType,
  ) {
    if (invoiceType === "deposit") return [];
    if (!context.job) throw badRequest("INVOICE_JOB_REQUIRED", "Invoice requires a Job");
    const all = await transaction
      .select()
      .from(jobCharges)
      .where(
        and(
          eq(jobCharges.tenantId, invoice.tenantId),
          eq(jobCharges.jobId, context.job.id),
          eq(jobCharges.status, "ready_to_invoice"),
        ),
      )
      .orderBy(asc(jobCharges.occurredAt), asc(jobCharges.id))
      .for("update");
    if (invoiceType === "credit_memo") {
      return all.filter((charge) => ["credit", "reversal"].includes(charge.chargeKind));
    }
    return all.filter((charge) => charge.chargeKind === "charge");
  }

  private async insertVersion(
    transaction: TenantTransaction,
    actor: Actor,
    invoice: InvoiceRecord,
    versionNumber: number,
    draft: DraftVersion,
    supersedesInvoiceVersionId?: string,
  ): Promise<InvoiceVersionRecord> {
    const [version] = await transaction
      .insert(invoiceVersions)
      .values({
        amountDueCents: draft.amountDueCents,
        billingIdentitySnapshot: draft.billingIdentitySnapshot,
        calculationSnapshot: draft.calculationSnapshot,
        contentHash: draft.contentHash,
        createdBy: actor.userId,
        customerCreditApplicationCents: draft.customerCreditApplicationCents,
        depositApplicationCents: draft.depositApplicationCents,
        discountCents: draft.discountCents,
        invoiceId: invoice.id,
        preparedBy: actor.userId,
        subtotalCents: draft.subtotalCents,
        supersedesInvoiceVersionId,
        taxCents: draft.taxCents,
        tenantId: actor.tenantId,
        termsSnapshot: draft.termsSnapshot,
        totalCents: draft.totalCents,
        updatedBy: actor.userId,
        versionNumber,
      })
      .returning();
    if (!version) throw new Error("Invoice Version was not created");
    await transaction.insert(invoiceLineItems).values(
      draft.lines.map((line) => ({
        acceptedQuoteLineItemId: line.acceptedQuoteLineItemId,
        createdBy: actor.userId,
        customerCreditApplicationId: line.customerCreditApplicationId,
        depositApplicationId: line.depositApplicationId,
        description: line.description,
        direction: line.direction,
        invoiceAdjustmentId: line.invoiceAdjustmentId,
        invoiceId: invoice.id,
        invoiceVersionId: version.id,
        jobChargeId: line.jobChargeId,
        lineType: line.lineType,
        quantity: line.quantity,
        sequence: line.sequence,
        sourceId: line.sourceId,
        sourceSnapshot: line.sourceSnapshot,
        sourceType: line.sourceType,
        subtotalCents: line.subtotalCents,
        taxBehavior: line.taxBehavior,
        taxCents: line.taxCents,
        tenantId: actor.tenantId,
        totalCents: line.totalCents,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        updatedBy: actor.userId,
      })),
    );
    return version;
  }

  private async assertVersionCurrent(
    transaction: TenantTransaction,
    invoice: InvoiceRecord,
    version: InvoiceVersionRecord,
  ): Promise<DraftVersion> {
    const context = await this.loadProjectContext(
      transaction,
      invoice.tenantId,
      invoice.projectId,
      invoice.jobId,
      true,
    );
    this.assertCreateReady(context, asInvoiceType(invoice.invoiceType));
    if (invoice.invoiceType === "final" && context.job?.serviceType === "material_delivery") {
      const [detail] = await transaction
        .select({ invoiceReadiness: materialDeliveryDetails.invoiceReadiness })
        .from(materialDeliveryDetails)
        .where(
          and(
            eq(materialDeliveryDetails.tenantId, invoice.tenantId),
            eq(materialDeliveryDetails.jobId, context.job.id),
          ),
        )
        .limit(1)
        .for("update");
      if (detail?.invoiceReadiness !== "ready") {
        throw conflict(
          "JOB_INVOICE_READINESS_REQUIRED",
          "Material Delivery must pass Invoice Readiness before Final Invoice posting",
        );
      }
    }
    const current = await this.buildDraftVersion(
      transaction,
      invoice,
      context,
      version.versionNumber,
      dueInDays(version.termsSnapshot),
    );
    if (current.contentHash !== version.contentHash) {
      throw conflict(
        "INVOICE_SOURCE_CHANGED",
        "Invoice source data changed; create a new Invoice Version before posting",
      );
    }
    return current;
  }

  private async getInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoiceDto> {
    const [record] = await transaction
      .select({
        customerName: customerAccounts.displayName,
        invoice: invoices,
        jobNumber: jobs.jobNumber,
        projectNumber: projects.projectNumber,
      })
      .from(invoices)
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, invoices.tenantId),
          eq(customerAccounts.id, invoices.customerAccountId),
        ),
      )
      .innerJoin(
        projects,
        and(eq(projects.tenantId, invoices.tenantId), eq(projects.id, invoices.projectId)),
      )
      .leftJoin(jobs, and(eq(jobs.tenantId, invoices.tenantId), eq(jobs.id, invoices.jobId)))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1);
    if (!record) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
    const versions = await transaction
      .select()
      .from(invoiceVersions)
      .where(and(eq(invoiceVersions.tenantId, tenantId), eq(invoiceVersions.invoiceId, invoiceId)))
      .orderBy(asc(invoiceVersions.versionNumber));
    const versionDtos: InvoiceVersionDto[] = [];
    for (const version of versions) {
      const lines = await transaction
        .select()
        .from(invoiceLineItems)
        .where(
          and(
            eq(invoiceLineItems.tenantId, tenantId),
            eq(invoiceLineItems.invoiceVersionId, version.id),
          ),
        )
        .orderBy(asc(invoiceLineItems.sequence));
      versionDtos.push(versionDto(version, lines.map(lineDto)));
    }
    const deliveries = await transaction
      .select()
      .from(invoiceDeliveries)
      .where(
        and(eq(invoiceDeliveries.tenantId, tenantId), eq(invoiceDeliveries.invoiceId, invoiceId)),
      )
      .orderBy(asc(invoiceDeliveries.attemptedAt));
    const adjustments = await transaction
      .select()
      .from(invoiceAdjustments)
      .where(
        and(eq(invoiceAdjustments.tenantId, tenantId), eq(invoiceAdjustments.invoiceId, invoiceId)),
      )
      .orderBy(asc(invoiceAdjustments.effectiveAt), asc(invoiceAdjustments.createdAt));
    const publicLinks = await transaction
      .select()
      .from(invoicePublicLinks)
      .where(
        and(eq(invoicePublicLinks.tenantId, tenantId), eq(invoicePublicLinks.invoiceId, invoiceId)),
      )
      .orderBy(desc(invoicePublicLinks.createdAt));
    const currentVersion = versions.at(-1) ?? null;
    const outstandingBalanceCents = await this.outstandingBalance(
      transaction,
      tenantId,
      record.invoice,
    );
    return {
      adjustments: adjustments.map(adjustmentDto),
      currency: record.invoice.currency,
      customerName: record.customerName,
      deliveries: deliveries.map(deliveryDto),
      dueDate: record.invoice.dueDate,
      id: record.invoice.id,
      invoiceNumber: record.invoice.invoiceNumber,
      invoiceType: record.invoice.invoiceType,
      issueDate: record.invoice.issueDate,
      jobId: record.invoice.jobId,
      jobNumber: record.jobNumber,
      outstandingBalanceCents,
      projectId: record.invoice.projectId,
      projectNumber: record.projectNumber,
      publicLinks: publicLinks.map((link) => ({
        expiresAt: link.expiresAt.toISOString(),
        id: link.id,
        invoiceVersionId: link.invoiceVersionId,
        lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
        recipient: link.recipient,
        revokedAt: link.revokedAt?.toISOString() ?? null,
        viewCount: link.viewCount,
      })),
      replacedByInvoiceId: record.invoice.replacedByInvoiceId,
      replacesInvoiceId: record.invoice.replacesInvoiceId,
      status: record.invoice.status,
      totalCents: currentVersion?.totalCents ?? null,
      updatedAt: record.invoice.updatedAt.toISOString(),
      versions: versionDtos,
      voidedAt: record.invoice.voidedAt?.toISOString() ?? null,
      voidReason: record.invoice.voidReason,
    };
  }

  private async outstandingBalance(
    transaction: TenantTransaction,
    tenantId: string,
    invoice: InvoiceRecord,
  ): Promise<number> {
    if (invoice.invoiceType === "credit_memo") return 0;
    const [posted] = await transaction
      .select({ totalCents: invoiceVersions.totalCents })
      .from(invoiceVersions)
      .where(
        and(
          eq(invoiceVersions.tenantId, tenantId),
          eq(invoiceVersions.invoiceId, invoice.id),
          eq(invoiceVersions.status, "posted"),
        ),
      )
      .limit(1);
    if (!posted) return 0;
    const adjustments = await transaction
      .select()
      .from(invoiceAdjustments)
      .where(
        and(
          eq(invoiceAdjustments.tenantId, tenantId),
          eq(invoiceAdjustments.invoiceId, invoice.id),
          eq(invoiceAdjustments.status, "posted"),
        ),
      );
    const payments = await transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.invoiceId, invoice.id),
        ),
      );
    const deposits = await transaction
      .select()
      .from(depositApplications)
      .where(
        and(
          eq(depositApplications.tenantId, tenantId),
          eq(depositApplications.invoiceId, invoice.id),
        ),
      );
    const credits = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.invoiceId, invoice.id),
        ),
      );
    const adjustmentTotal = adjustments.reduce(
      (total, entry) =>
        checkedSignedAdd(
          total,
          entry.direction === "debit" ? entry.amountCents : -entry.amountCents,
        ),
      0,
    );
    const appliedTotal = [...payments, ...deposits, ...credits].reduce(
      (total, entry) =>
        checkedSignedAdd(
          total,
          entry.entryKind === "application" ? entry.amountCents : -entry.amountCents,
        ),
      0,
    );
    return Math.max(checkedSignedAdd(posted.totalCents, adjustmentTotal) - appliedTotal, 0);
  }

  private async lockInvoice(
    transaction: TenantTransaction,
    tenantId: string,
    invoiceId: string,
  ): Promise<InvoiceRecord> {
    const [invoice] = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1)
      .for("update");
    if (!invoice) throw notFound("INVOICE_NOT_FOUND", "Invoice not found");
    return invoice;
  }

  private async findVersion(
    transaction: TenantTransaction,
    tenantId: string,
    invoiceVersionId: string,
  ): Promise<InvoiceVersionRecord> {
    const [version] = await transaction
      .select()
      .from(invoiceVersions)
      .where(and(eq(invoiceVersions.tenantId, tenantId), eq(invoiceVersions.id, invoiceVersionId)))
      .limit(1);
    if (!version) throw notFound("INVOICE_VERSION_NOT_FOUND", "Invoice Version not found");
    return version;
  }

  private async lockVersion(
    transaction: TenantTransaction,
    tenantId: string,
    invoiceVersionId: string,
  ): Promise<InvoiceVersionRecord> {
    const [version] = await transaction
      .select()
      .from(invoiceVersions)
      .where(and(eq(invoiceVersions.tenantId, tenantId), eq(invoiceVersions.id, invoiceVersionId)))
      .limit(1)
      .for("update");
    if (!version) throw notFound("INVOICE_VERSION_NOT_FOUND", "Invoice Version not found");
    return version;
  }

  private async findAdjustment(
    transaction: TenantTransaction,
    tenantId: string,
    adjustmentId: string,
  ): Promise<InvoiceAdjustmentRecord> {
    const [adjustment] = await transaction
      .select()
      .from(invoiceAdjustments)
      .where(
        and(eq(invoiceAdjustments.tenantId, tenantId), eq(invoiceAdjustments.id, adjustmentId)),
      )
      .limit(1);
    if (!adjustment) {
      throw notFound("INVOICE_ADJUSTMENT_NOT_FOUND", "Invoice Adjustment not found");
    }
    return adjustment;
  }

  private async lockAdjustment(
    transaction: TenantTransaction,
    tenantId: string,
    adjustmentId: string,
  ): Promise<InvoiceAdjustmentRecord> {
    const [adjustment] = await transaction
      .select()
      .from(invoiceAdjustments)
      .where(
        and(eq(invoiceAdjustments.tenantId, tenantId), eq(invoiceAdjustments.id, adjustmentId)),
      )
      .limit(1)
      .for("update");
    if (!adjustment) {
      throw notFound("INVOICE_ADJUSTMENT_NOT_FOUND", "Invoice Adjustment not found");
    }
    return adjustment;
  }

  private assertPostPostingCorrectionAllowed(invoice: InvoiceRecord): void {
    if (
      !invoice.postedAt ||
      ["draft", "review_required", "ready_to_post"].includes(invoice.status)
    ) {
      throw conflict("INVOICE_NOT_POSTED", "Post-posting corrections require a posted Invoice");
    }
    if (["voided", "replaced", "archived"].includes(invoice.status)) {
      throw conflict(
        "INVOICE_CORRECTION_NOT_ALLOWED",
        "A voided, replaced, or archived Invoice cannot be corrected",
      );
    }
    if (invoice.invoiceType === "credit_memo") {
      throw conflict(
        "CREDIT_MEMO_CORRECTION_NOT_AVAILABLE",
        "Credit Memo value corrections require the Customer Credit workflow",
      );
    }
  }

  private assertAdjustmentInput(
    invoice: InvoiceRecord,
    input: CreateInvoiceAdjustmentDto,
    direction: "credit" | "debit",
  ): void {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_AMOUNT_INVALID",
        "Adjustment amount must be non-negative integer cents",
      );
    }
    if (Boolean(input.sourceType?.trim()) !== Boolean(input.sourceId)) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_SOURCE_INCOMPLETE",
        "Adjustment source type and source id must be provided together",
      );
    }
    if (input.adjustmentType === "due_date_extension") {
      if (input.amountCents !== 0 || !input.newDueDate) {
        throw badRequest(
          "INVOICE_DUE_DATE_ADJUSTMENT_INVALID",
          "A due-date extension requires a new date and a zero amount",
        );
      }
      this.assertDueDateExtension(invoice, input.newDueDate);
      return;
    }
    if (input.amountCents === 0) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_AMOUNT_REQUIRED",
        "A monetary Invoice Adjustment requires a positive amount",
      );
    }
    if (input.newDueDate) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_DUE_DATE_FORBIDDEN",
        "Only a due-date extension can include a new due date",
      );
    }
    if (input.adjustmentType !== "tax_adjustment" && input.direction) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_DIRECTION_FORBIDDEN",
        "Direction is derived for this Invoice Adjustment type",
      );
    }
    void direction;
  }

  private assertStoredAdjustment(
    invoice: InvoiceRecord,
    adjustment: InvoiceAdjustmentRecord,
  ): void {
    if (adjustment.adjustmentType === "due_date_extension") {
      if (!adjustment.newDueDate || adjustment.amountCents !== 0) {
        throw conflict(
          "INVOICE_DUE_DATE_ADJUSTMENT_INVALID",
          "Stored due-date adjustment is invalid",
        );
      }
      this.assertDueDateExtension(invoice, adjustment.newDueDate);
      return;
    }
    if (adjustment.amountCents <= 0) {
      throw conflict(
        "INVOICE_ADJUSTMENT_AMOUNT_INVALID",
        "Stored monetary Invoice Adjustment has no positive amount",
      );
    }
  }

  private assertDueDateExtension(invoice: InvoiceRecord, newDueDate: string): void {
    if (!invoice.dueDate || newDueDate <= invoice.dueDate) {
      throw conflict(
        "INVOICE_DUE_DATE_NOT_EXTENDED",
        "The new due date must be later than the current due date",
      );
    }
  }

  private async invoiceFinancials(
    transaction: TenantTransaction,
    tenantId: string,
    invoice: InvoiceRecord,
  ): Promise<InvoiceFinancials> {
    const [postedVersion] = await transaction
      .select()
      .from(invoiceVersions)
      .where(
        and(
          eq(invoiceVersions.tenantId, tenantId),
          eq(invoiceVersions.invoiceId, invoice.id),
          eq(invoiceVersions.status, "posted"),
        ),
      )
      .limit(1);
    if (!postedVersion) {
      throw conflict("INVOICE_POSTED_VERSION_MISSING", "Posted Invoice Version not found");
    }
    const adjustments = await transaction
      .select()
      .from(invoiceAdjustments)
      .where(
        and(
          eq(invoiceAdjustments.tenantId, tenantId),
          eq(invoiceAdjustments.invoiceId, invoice.id),
          eq(invoiceAdjustments.status, "posted"),
        ),
      );
    const payments = await transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.invoiceId, invoice.id),
        ),
      );
    const deposits = await transaction
      .select()
      .from(depositApplications)
      .where(
        and(
          eq(depositApplications.tenantId, tenantId),
          eq(depositApplications.invoiceId, invoice.id),
        ),
      );
    const credits = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.invoiceId, invoice.id),
        ),
      );
    const adjustmentTotal = adjustments.reduce(
      (total, entry) =>
        checkedSignedAdd(
          total,
          entry.direction === "debit" ? entry.amountCents : -entry.amountCents,
        ),
      0,
    );
    const appliedTotalCents = [...payments, ...deposits, ...credits].reduce(
      (total, entry) =>
        checkedSignedAdd(
          total,
          entry.entryKind === "application" ? entry.amountCents : -entry.amountCents,
        ),
      0,
    );
    const rawCurrentTotalCents = checkedSignedAdd(postedVersion.totalCents, adjustmentTotal);
    if (appliedTotalCents < 0) {
      throw conflict(
        "INVOICE_FINANCIAL_HISTORY_INVALID",
        "Invoice financial history does not reconcile",
      );
    }
    const currentTotalCents = Math.max(rawCurrentTotalCents, 0);
    return {
      appliedTotalCents,
      currentTotalCents,
      outstandingBalanceCents: Math.max(rawCurrentTotalCents - appliedTotalCents, 0),
      postedVersion,
      rawCurrentTotalCents,
    };
  }

  private async insertAdjustmentCustomerCredit(
    transaction: TenantTransaction,
    actor: Actor,
    invoice: InvoiceRecord,
    adjustment: InvoiceAdjustmentRecord,
    amountCents: number,
  ): Promise<typeof customerCredits.$inferSelect> {
    const [existing] = await transaction
      .select({ id: customerCredits.id })
      .from(customerCredits)
      .where(
        and(
          eq(customerCredits.tenantId, actor.tenantId),
          eq(customerCredits.sourceType, "adjustment"),
          eq(customerCredits.sourceId, adjustment.id),
        ),
      )
      .limit(1);
    if (existing) {
      throw conflict(
        "INVOICE_ADJUSTMENT_CREDIT_ALREADY_CREATED",
        "Invoice Adjustment already created Customer Credit",
      );
    }
    const creditNumber = await allocateBusinessNumber(transaction, {
      entityType: "customer_credit",
      prefix: "CR",
      tenantId: actor.tenantId,
      year: new Date().getUTCFullYear(),
    });
    const [credit] = await transaction
      .insert(customerCredits)
      .values({
        createdBy: actor.userId,
        creditNumber,
        currency: invoice.currency,
        customerAccountId: invoice.customerAccountId,
        description: `Customer value from ${adjustment.adjustmentNumber}`,
        originalAmountCents: amountCents,
        projectId: invoice.projectId,
        sourceId: adjustment.id,
        sourceType: "adjustment",
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!credit) throw new Error("Adjustment Customer Credit was not created");
    return credit;
  }

  private async resolveAdjustmentCreditForReversal(
    transaction: TenantTransaction,
    actor: Actor,
    adjustment: InvoiceAdjustmentRecord,
  ): Promise<void> {
    if (
      adjustment.adjustmentType !== "charge_reversal" ||
      !adjustment.reversesInvoiceAdjustmentId
    ) {
      return;
    }
    const [credit] = await transaction
      .select()
      .from(customerCredits)
      .where(
        and(
          eq(customerCredits.tenantId, actor.tenantId),
          eq(customerCredits.sourceType, "adjustment"),
          eq(customerCredits.sourceId, adjustment.reversesInvoiceAdjustmentId),
        ),
      )
      .limit(1)
      .for("update");
    if (!credit) return;
    const applications = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, actor.tenantId),
          eq(customerCreditApplications.customerCreditId, credit.id),
        ),
      );
    const appliedCents = applications.reduce(
      (total, entry) =>
        checkedSignedAdd(
          total,
          entry.entryKind === "application" ? entry.amountCents : -entry.amountCents,
        ),
      0,
    );
    const activeRefunds = await transaction
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.tenantId, actor.tenantId),
          eq(refunds.customerCreditId, credit.id),
          notInArray(refunds.status, ["cancelled", "failed", "reversed"]),
        ),
      )
      .limit(1);
    if (credit.status !== "available" || appliedCents !== 0 || activeRefunds.length > 0) {
      throw conflict(
        "INVOICE_ADJUSTMENT_CREDIT_IN_USE",
        "Reverse or refund the Customer Credit applications before posting this Adjustment reversal",
      );
    }
    const resolvedAt = new Date();
    await transaction
      .update(customerCredits)
      .set({
        resolutionReason: `Source adjustment reversed by ${adjustment.adjustmentNumber}`,
        resolvedAt,
        status: "reversed",
        updatedBy: actor.userId,
      })
      .where(and(eq(customerCredits.tenantId, actor.tenantId), eq(customerCredits.id, credit.id)));
    await this.recordChange(transaction, actor, {
      after: { resolvedAt, status: "reversed" },
      before: { status: credit.status },
      commandName: "PostInvoiceAdjustment",
      entityId: credit.id,
      entityType: "CustomerCredit",
      eventType: "customer_credit.reversed",
      metadata: {
        invoiceAdjustmentId: adjustment.id,
        reversesInvoiceAdjustmentId: adjustment.reversesInvoiceAdjustmentId,
      },
    });
  }

  private assertNoAppliedValue(financials: InvoiceFinancials): void {
    if (financials.appliedTotalCents !== 0) {
      throw conflict(
        "INVOICE_APPLIED_VALUE_PRESENT",
        "Reverse or transfer applied customer value before voiding or replacing this Invoice",
      );
    }
  }

  private async insertSystemAdjustment(
    transaction: TenantTransaction,
    actor: Actor,
    input: {
      adjustmentType: "replacement" | "void";
      amountCents: number;
      direction: "credit";
      effectiveAt: Date;
      invoiceId: string;
      reason: string;
      sourceId?: string;
      sourceType?: string;
    },
  ): Promise<InvoiceAdjustmentRecord> {
    const adjustmentNumber = await allocateBusinessNumber(transaction, {
      entityType: "invoice_adjustment",
      prefix: "ADJ",
      tenantId: actor.tenantId,
      year: input.effectiveAt.getUTCFullYear(),
    });
    const [adjustment] = await transaction
      .insert(invoiceAdjustments)
      .values({
        adjustmentNumber,
        adjustmentType: input.adjustmentType,
        amountCents: input.amountCents,
        approvedAt: input.effectiveAt,
        approvedBy: actor.userId,
        createdBy: actor.userId,
        direction: input.direction,
        effectiveAt: input.effectiveAt,
        invoiceId: input.invoiceId,
        postedAt: input.effectiveAt,
        postedBy: actor.userId,
        reason: input.reason,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        status: "posted",
        tenantId: actor.tenantId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!adjustment) throw new Error("System Invoice Adjustment was not created");
    return adjustment;
  }

  private parsePublicToken(token: string): ParsedInvoiceToken {
    const parsed = this.tokens.parse(token);
    if (!parsed) throw notFound("INVOICE_LINK_INVALID", "Invoice link is invalid");
    return parsed;
  }

  private async publicInvoiceDto(
    transaction: TenantTransaction,
    tenantId: string,
    invoice: InvoiceRecord,
    invoiceVersionId: string,
  ): Promise<PublicInvoiceDto> {
    const detail = await this.getInTransaction(transaction, tenantId, invoice.id);
    const version = detail.versions.find((candidate) => candidate.id === invoiceVersionId);
    if (version?.status !== "posted") {
      throw new ApiException(
        HttpStatus.GONE,
        "INVOICE_VERSION_UNAVAILABLE",
        "This Invoice Version is no longer available",
      );
    }
    const financials = await this.invoiceFinancials(transaction, tenantId, invoice);
    return {
      adjustments: detail.adjustments
        .filter((adjustment) => ["posted", "reversed"].includes(adjustment.status))
        .map((adjustment) => ({
          adjustmentNumber: adjustment.adjustmentNumber,
          adjustmentType: adjustment.adjustmentType,
          amountCents: adjustment.amountCents,
          direction: adjustment.direction,
          effectiveAt: adjustment.effectiveAt,
          status: adjustment.status,
        })),
      appliedCents: financials.appliedTotalCents,
      currency: detail.currency,
      customerName: detail.customerName,
      deliveries: detail.deliveries.map((delivery) => ({
        attemptedAt: delivery.attemptedAt,
        channel: delivery.channel,
        deliveredAt: delivery.deliveredAt,
        sentAt: delivery.sentAt,
        status: delivery.status,
        viewedAt: delivery.viewedAt,
      })),
      dueDate: detail.dueDate,
      invoiceNumber: detail.invoiceNumber,
      invoiceType: detail.invoiceType,
      issueDate: detail.issueDate,
      jobNumber: detail.jobNumber,
      lines: version.lines,
      outstandingBalanceCents: financials.outstandingBalanceCents,
      projectNumber: detail.projectNumber,
      status: detail.status,
      subtotalCents: version.subtotalCents,
      taxCents: version.taxCents,
      totalCents: financials.currentTotalCents,
      versionNumber: version.versionNumber,
    };
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: Actor | undefined,
    input: {
      after: unknown;
      before?: unknown;
      commandName: string;
      entityId: string;
      entityType: string;
      eventType: string;
      metadata?: Record<string, unknown>;
      tenantId?: string;
    },
  ): Promise<void> {
    const tenantId = actor?.tenantId ?? input.tenantId;
    if (!tenantId) throw new Error("Tenant is required for finance events");
    const eventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor?.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor?.userId,
      eventType: input.eventType,
      payload: { auditEventId: eventId, ...(input.metadata ?? {}) },
      tenantId,
      updatedBy: actor?.userId,
    });
  }
}

function quoteLineSnapshot(source: typeof quoteLineItems.$inferSelect): Record<string, unknown> {
  return {
    description: source.description,
    quantity: source.quantity,
    sequence: source.sequence,
    totalCents: source.totalCents,
    unit: source.unit,
    unitPriceCents: source.unitPriceCents,
  };
}

function asInvoiceType(value: string): InvoiceType {
  if (["deposit", "final", "additional_charge", "credit_memo"].includes(value)) {
    return value as InvoiceType;
  }
  throw new Error(`Unsupported Invoice type ${value}`);
}

function dueInDays(snapshot: Record<string, unknown>): number {
  const value = snapshot.dueInDays;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 365) {
    throw conflict("INVOICE_TERMS_INVALID", "Invoice Version payment terms are invalid");
  }
  return value as number;
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return utcDate(value);
}

function parseOccurredAt(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("INVOICE_DELIVERY_TIME_INVALID", "Delivery time is invalid");
  }
  return parsed;
}

function parseEffectiveAt(value: string | undefined): Date {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest("INVOICE_ADJUSTMENT_TIME_INVALID", "Adjustment effective time is invalid");
  }
  return parsed;
}

function correctionReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 2) {
    throw badRequest("INVOICE_CORRECTION_REASON_REQUIRED", "A correction reason is required");
  }
  return reason;
}

function adjustmentDirection(input: CreateInvoiceAdjustmentDto): "credit" | "debit" {
  if (input.adjustmentType === "tax_adjustment") {
    if (!input.direction) {
      throw badRequest(
        "INVOICE_ADJUSTMENT_DIRECTION_REQUIRED",
        "A tax adjustment requires a debit or credit direction",
      );
    }
    return input.direction;
  }
  if (["credit", "write_off"].includes(input.adjustmentType)) return "credit";
  return "debit";
}

function adjustedInvoiceStatus(
  adjustment: InvoiceAdjustmentRecord,
  afterTotal: number,
  appliedTotal: number,
): string {
  if (adjustment.adjustmentType === "write_off" && afterTotal <= appliedTotal) {
    return "written_off";
  }
  if (adjustment.direction === "credit" && afterTotal <= appliedTotal) return "credited";
  if (adjustment.direction === "debit" && afterTotal <= appliedTotal) return "paid";
  return "adjusted";
}

function replacementDraftVersion(
  originalInvoice: InvoiceRecord,
  replacement: InvoiceRecord,
  sourceVersion: InvoiceVersionRecord,
  sourceLines: (typeof invoiceLineItems.$inferSelect)[],
  replacementDueInDays: number,
  reason: string,
): DraftVersion {
  const lines: DraftLine[] = sourceLines.map((line) => ({
    ...(line.acceptedQuoteLineItemId
      ? { acceptedQuoteLineItemId: line.acceptedQuoteLineItemId }
      : {}),
    ...(line.customerCreditApplicationId
      ? { customerCreditApplicationId: line.customerCreditApplicationId }
      : {}),
    ...(line.depositApplicationId ? { depositApplicationId: line.depositApplicationId } : {}),
    description: line.description,
    direction: asLineDirection(line.direction),
    ...(line.invoiceAdjustmentId ? { invoiceAdjustmentId: line.invoiceAdjustmentId } : {}),
    ...(line.jobChargeId ? { jobChargeId: line.jobChargeId } : {}),
    lineType: asLineType(line.lineType),
    quantity: line.quantity,
    sequence: line.sequence,
    sourceId: line.sourceId,
    sourceSnapshot: line.sourceSnapshot,
    sourceType: asLineSourceType(line.sourceType),
    subtotalCents: line.subtotalCents,
    taxBehavior: asLineTaxBehavior(line.taxBehavior),
    taxCents: line.taxCents,
    totalCents: line.totalCents,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
  }));
  const termsSnapshot = {
    ...sourceVersion.termsSnapshot,
    dueInDays: replacementDueInDays,
    paymentTerm:
      replacementDueInDays === 0
        ? "Due on receipt"
        : `Due within ${replacementDueInDays.toString()} days`,
  };
  const calculationSnapshot = {
    ...sourceVersion.calculationSnapshot,
    engineVersion: "invoice-replacement-v1",
    replacedInvoiceId: originalInvoice.id,
    replacedInvoiceVersionId: sourceVersion.id,
    replacementReason: reason,
  };
  return {
    amountDueCents: sourceVersion.amountDueCents,
    billingIdentitySnapshot: sourceVersion.billingIdentitySnapshot,
    calculationSnapshot,
    contentHash: hashCanonicalPayload({
      billingIdentitySnapshot: sourceVersion.billingIdentitySnapshot,
      calculationSnapshot,
      invoiceNumber: replacement.invoiceNumber,
      lines,
      termsSnapshot,
      versionNumber: 1,
    }),
    customerCreditApplicationCents: sourceVersion.customerCreditApplicationCents,
    depositApplicationCents: sourceVersion.depositApplicationCents,
    discountCents: sourceVersion.discountCents,
    lines,
    subtotalCents: sourceVersion.subtotalCents,
    taxCents: sourceVersion.taxCents,
    termsSnapshot,
    totalCents: sourceVersion.totalCents,
  };
}

function asLineDirection(value: string): DraftLine["direction"] {
  if (value === "credit" || value === "debit") return value;
  throw new Error(`Unsupported Invoice Line direction ${value}`);
}

function asLineType(value: string): DraftLine["lineType"] {
  if (
    [
      "accepted_quote",
      "adjustment",
      "customer_credit",
      "deposit_application",
      "job_charge",
      "rounding",
      "tax",
    ].includes(value)
  ) {
    return value as DraftLine["lineType"];
  }
  throw new Error(`Unsupported Invoice Line type ${value}`);
}

function asLineSourceType(value: string): DraftLine["sourceType"] {
  if (
    [
      "accepted_quote_line",
      "customer_credit_application",
      "deposit_application",
      "invoice_adjustment",
      "job_charge",
      "rounding_rule",
      "tax_rule",
    ].includes(value)
  ) {
    return value as DraftLine["sourceType"];
  }
  throw new Error(`Unsupported Invoice Line source type ${value}`);
}

function asLineTaxBehavior(value: string): DraftLine["taxBehavior"] {
  if (["non_taxable", "tax_included", "taxable"].includes(value)) {
    return value as DraftLine["taxBehavior"];
  }
  throw new Error(`Unsupported Invoice Line tax behavior ${value}`);
}

function checkedSignedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Financial amount exceeds safe integer range");
  return result;
}

function summaryDto(invoice: InvoiceDto): InvoiceSummaryDto {
  return {
    currency: invoice.currency,
    customerName: invoice.customerName,
    dueDate: invoice.dueDate,
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    issueDate: invoice.issueDate,
    jobId: invoice.jobId,
    jobNumber: invoice.jobNumber,
    outstandingBalanceCents: invoice.outstandingBalanceCents,
    projectId: invoice.projectId,
    projectNumber: invoice.projectNumber,
    replacedByInvoiceId: invoice.replacedByInvoiceId,
    replacesInvoiceId: invoice.replacesInvoiceId,
    status: invoice.status,
    totalCents: invoice.totalCents,
    updatedAt: invoice.updatedAt,
  };
}

function adjustmentDto(adjustment: InvoiceAdjustmentRecord): InvoiceAdjustmentDto {
  return {
    adjustmentNumber: adjustment.adjustmentNumber,
    adjustmentType: adjustment.adjustmentType,
    amountCents: adjustment.amountCents,
    approvedAt: adjustment.approvedAt?.toISOString() ?? null,
    direction: adjustment.direction,
    effectiveAt: adjustment.effectiveAt.toISOString(),
    id: adjustment.id,
    newDueDate: adjustment.newDueDate,
    postedAt: adjustment.postedAt?.toISOString() ?? null,
    reason: adjustment.reason,
    reversesInvoiceAdjustmentId: adjustment.reversesInvoiceAdjustmentId,
    sourceId: adjustment.sourceId,
    sourceType: adjustment.sourceType,
    status: adjustment.status,
  };
}

function lineDto(line: typeof invoiceLineItems.$inferSelect): InvoiceLineItemDto {
  return {
    description: line.description,
    direction: line.direction,
    id: line.id,
    lineType: line.lineType,
    quantity: line.quantity,
    sequence: line.sequence,
    sourceId: line.sourceId,
    sourceType: line.sourceType,
    subtotalCents: line.subtotalCents,
    taxBehavior: line.taxBehavior,
    taxCents: line.taxCents,
    totalCents: line.totalCents,
    unit: line.unit,
    unitPriceCents: line.unitPriceCents,
  };
}

function versionDto(version: InvoiceVersionRecord, lines: InvoiceLineItemDto[]): InvoiceVersionDto {
  return {
    amountDueCents: version.amountDueCents,
    billingIdentity: version.billingIdentitySnapshot,
    contentHash: version.contentHash,
    customerCreditApplicationCents: version.customerCreditApplicationCents,
    depositApplicationCents: version.depositApplicationCents,
    discountCents: version.discountCents,
    id: version.id,
    lines,
    postedAt: version.postedAt?.toISOString() ?? null,
    preparedAt: version.preparedAt.toISOString(),
    status: version.status,
    subtotalCents: version.subtotalCents,
    taxCents: version.taxCents,
    terms: version.termsSnapshot,
    totalCents: version.totalCents,
    versionNumber: version.versionNumber,
  };
}

function deliveryDto(delivery: typeof invoiceDeliveries.$inferSelect): InvoiceDeliveryDto {
  return {
    attemptedAt: delivery.attemptedAt.toISOString(),
    channel: delivery.channel,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    destination: delivery.destinationSnapshot,
    failureReason: delivery.failureReason,
    id: delivery.id,
    invoiceVersionId: delivery.invoiceVersionId,
    sentAt: delivery.sentAt?.toISOString() ?? null,
    status: delivery.status,
    viewedAt: delivery.viewedAt?.toISOString() ?? null,
  };
}

function badRequest(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.BAD_REQUEST, code, message);
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
