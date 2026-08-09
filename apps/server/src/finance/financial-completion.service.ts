import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  auditEvents,
  customerCreditApplications,
  customerCredits,
  depositApplications,
  depositBalances,
  invoiceAdjustments,
  invoiceVersions,
  invoices,
  jobEvents,
  jobs,
  outboxEvents,
  paymentAllocations,
  payments,
  projects,
  refunds,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import type {
  FinancialCompletionDto,
  JobFinancialCompletionDto,
} from "./financial-completion.dto.js";

export interface FinancialActor {
  tenantId: string;
  userId: string;
}

type InvoiceRecord = typeof invoices.$inferSelect;
type ProjectRecord = typeof projects.$inferSelect;
type RefundRecord = typeof refunds.$inferSelect;

const terminalPaymentStatuses = ["cancelled", "failed", "refunded", "resolved", "reversed"];
const terminalDepositStatuses = ["converted_to_credit", "refunded", "resolved", "retained"];
const terminalCreditStatuses = ["refunded", "resolved", "reversed"];
const terminalRefundStatuses = ["cancelled", "failed", "resolved", "reversed", "settled"];

@Injectable()
export class FinancialCompletionService {
  public constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
  ) {}

  public async evaluateProject(projectId: string, key: string): Promise<FinancialCompletionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { projectId }, scope: "financial-completion.evaluate-project" },
      async (transaction) => ({
        body: await this.reconcileProject(transaction, actor, projectId),
        status: HttpStatus.OK,
      }),
    );
    return result.body;
  }

  public async evaluateJob(jobId: string, key: string): Promise<FinancialCompletionDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { jobId }, scope: "financial-completion.evaluate-job" },
      async (transaction) => {
        const [job] = await transaction
          .select({ projectId: jobs.projectId })
          .from(jobs)
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, jobId)))
          .limit(1)
          .for("update");
        if (!job) throw notFound("JOB_NOT_FOUND", "Job not found");
        return {
          body: await this.reconcileProject(transaction, actor, job.projectId),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async reconcileProject(
    transaction: TenantTransaction,
    actor: FinancialActor,
    projectId: string,
  ): Promise<FinancialCompletionDto> {
    let project = await this.lockProject(transaction, actor.tenantId, projectId);
    const projectJobs = await transaction
      .select()
      .from(jobs)
      .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.projectId, projectId)))
      .orderBy(asc(jobs.jobNumber))
      .for("update");
    const projectInvoices = await transaction
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.projectId, projectId)))
      .for("update");
    const hasPostedFinalInvoice = projectInvoices.some(
      (invoice) => invoice.postedAt !== null && invoice.invoiceType === "final",
    );

    const invoiceOutstanding = new Map<string, number>();
    for (const invoice of projectInvoices) {
      if (!invoice.postedAt || invoice.invoiceType === "credit_memo") continue;
      invoiceOutstanding.set(
        invoice.id,
        await this.invoiceOutstandingCents(transaction, actor.tenantId, invoice),
      );
    }

    const jobReports: JobFinancialCompletionDto[] = [];
    for (const job of projectJobs) {
      const obligationInvoices = projectInvoices.filter(
        (invoice) =>
          invoice.jobId === job.id &&
          invoice.postedAt !== null &&
          invoice.invoiceType !== "deposit" &&
          invoice.invoiceType !== "credit_memo",
      );
      const outstandingCents = sumSafe(
        obligationInvoices.map((invoice) => invoiceOutstanding.get(invoice.id) ?? 0),
      );
      const blockers: string[] = [];
      if (job.status !== "cancelled" && obligationInvoices.length === 0) {
        blockers.push("Job has no posted customer obligation");
      }
      if (outstandingCents > 0) {
        blockers.push(`Job has ${outstandingCents.toString()} cents outstanding`);
      }
      if (
        job.status !== "cancelled" &&
        !["closed", "financially_complete", "invoiced"].includes(job.status)
      ) {
        blockers.push(`Job lifecycle is ${job.status}, not invoiced`);
      }
      const ledgerComplete = job.status === "cancelled" || blockers.length === 0;
      let nextStatus = job.status;
      if (ledgerComplete && job.status === "invoiced") {
        const completedAt = new Date();
        nextStatus = "financially_complete";
        await transaction
          .update(jobs)
          .set({
            financiallyCompletedAt: completedAt,
            readiness: "evaluation_required",
            status: nextStatus,
            updatedBy: actor.userId,
          })
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, job.id)));
        await this.recordJobTransition(transaction, actor, job.id, {
          after: { financiallyCompletedAt: completedAt, status: nextStatus },
          before: { status: job.status },
          commandName: "DeriveJobFinancialCompletion",
          eventType: "job.financially_completed",
          metadata: { outstandingCents: 0, projectId },
          summary: "Job completed financially from authoritative ledgers",
        });
      } else if (!ledgerComplete && job.status === "financially_complete") {
        nextStatus = "invoiced";
        await transaction
          .update(jobs)
          .set({
            financiallyCompletedAt: null,
            readiness: "evaluation_required",
            status: nextStatus,
            updatedBy: actor.userId,
          })
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, job.id)));
        await this.recordJobTransition(transaction, actor, job.id, {
          after: { financiallyCompletedAt: null, status: nextStatus },
          before: { status: job.status },
          commandName: "ReopenJobFinancialCompletion",
          eventType: "job.financial_completion_reopened",
          metadata: { blockers, outstandingCents, projectId },
          summary: "Job financial completion reopened from authoritative ledgers",
        });
      } else if (!ledgerComplete && job.status === "closed") {
        const reopenedAt = new Date();
        nextStatus = "planning";
        await transaction
          .update(jobs)
          .set({
            financiallyCompletedAt: null,
            readiness: "evaluation_required",
            reopenedAt,
            status: nextStatus,
            updatedBy: actor.userId,
          })
          .where(and(eq(jobs.tenantId, actor.tenantId), eq(jobs.id, job.id)));
        await this.recordJobTransition(transaction, actor, job.id, {
          after: { financiallyCompletedAt: null, reopenedAt, status: nextStatus },
          before: { status: job.status },
          commandName: "ReopenClosedJobForFinancialCorrection",
          eventType: "job.reopened_for_financial_correction",
          metadata: { blockers, outstandingCents, projectId },
          summary: "Closed Job reopened for financial correction",
        });
      }
      jobReports.push({
        blockers,
        financiallyComplete:
          job.status === "cancelled" ||
          (ledgerComplete && ["closed", "financially_complete", "invoiced"].includes(nextStatus)),
        jobId: job.id,
        jobNumber: job.jobNumber,
        outstandingCents,
        postedObligationCount: obligationInvoices.length,
        status: nextStatus,
      });
    }

    const outstandingInvoiceCents = sumSafe(
      projectInvoices
        .filter(
          (invoice) =>
            invoiceOutstanding.has(invoice.id) &&
            !(hasPostedFinalInvoice && invoice.invoiceType === "deposit"),
        )
        .map((invoice) => invoiceOutstanding.get(invoice.id) ?? 0),
    );
    const unresolvedPaymentCents = await this.unresolvedPaymentCents(
      transaction,
      actor.tenantId,
      projectId,
    );
    const unresolvedDepositCents = await this.unresolvedDepositCents(
      transaction,
      actor.tenantId,
      projectId,
    );
    const unresolvedCustomerCreditCents = await this.unresolvedCreditCents(
      transaction,
      actor.tenantId,
      projectId,
    );
    const activeRefunds = await transaction
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          eq(refunds.tenantId, actor.tenantId),
          eq(refunds.projectId, projectId),
          notInArray(refunds.status, terminalRefundStatuses),
        ),
      );
    const blockers: string[] = [];
    if (outstandingInvoiceCents > 0) {
      blockers.push(`Project has ${outstandingInvoiceCents.toString()} cents outstanding`);
    }
    if (unresolvedPaymentCents > 0) {
      blockers.push(
        `Project has ${unresolvedPaymentCents.toString()} cents of unapplied Payment value`,
      );
    }
    if (unresolvedDepositCents > 0) {
      blockers.push(
        `Project has ${unresolvedDepositCents.toString()} cents of unresolved Deposit value`,
      );
    }
    if (unresolvedCustomerCreditCents > 0) {
      blockers.push(
        `Project has ${unresolvedCustomerCreditCents.toString()} cents of unresolved Customer Credit`,
      );
    }
    if (activeRefunds.length > 0) {
      blockers.push(`Project has ${activeRefunds.length.toString()} active Refund workflow(s)`);
    }
    if (jobReports.some((job) => !job.financiallyComplete)) {
      blockers.push("Every active Job must be financially complete");
    }
    if (
      !["operationally_complete", "financially_complete", "completed", "closed"].includes(
        project.status,
      )
    ) {
      blockers.push(`Project lifecycle is ${project.status}, not operationally complete`);
    }

    const ledgerComplete = blockers.length === 0;
    if (ledgerComplete && project.status === "operationally_complete") {
      const completedAt = new Date();
      await transaction
        .update(projects)
        .set({
          financiallyCompletedAt: completedAt,
          status: "financially_complete",
          updatedBy: actor.userId,
        })
        .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, project.id)));
      await this.recordChange(transaction, actor, {
        after: { financiallyCompletedAt: completedAt, status: "financially_complete" },
        before: { status: project.status },
        commandName: "DeriveProjectFinancialCompletion",
        entityId: project.id,
        entityType: "Project",
        eventType: "project.financially_completed",
        metadata: { outstandingInvoiceCents: 0 },
      });
      project = { ...project, financiallyCompletedAt: completedAt, status: "financially_complete" };
    } else if (!ledgerComplete && ["financially_complete", "completed"].includes(project.status)) {
      await transaction
        .update(projects)
        .set({
          financiallyCompletedAt: null,
          status: "operationally_complete",
          updatedBy: actor.userId,
        })
        .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, project.id)));
      await this.recordChange(transaction, actor, {
        after: { financiallyCompletedAt: null, status: "operationally_complete" },
        before: { status: project.status },
        commandName: "ReopenProjectFinancialCompletion",
        entityId: project.id,
        entityType: "Project",
        eventType: "project.financial_completion_reopened",
        metadata: { blockers },
      });
      project = { ...project, financiallyCompletedAt: null, status: "operationally_complete" };
    } else if (!ledgerComplete && project.status === "closed") {
      const reopenedAt = new Date();
      await transaction
        .update(projects)
        .set({
          financiallyCompletedAt: null,
          reopenedAt,
          status: "planning",
          updatedBy: actor.userId,
        })
        .where(and(eq(projects.tenantId, actor.tenantId), eq(projects.id, project.id)));
      await this.recordChange(transaction, actor, {
        after: { financiallyCompletedAt: null, reopenedAt, status: "planning" },
        before: { status: project.status },
        commandName: "ReopenClosedProjectForFinancialCorrection",
        entityId: project.id,
        entityType: "Project",
        eventType: "project.reopened_for_financial_correction",
        metadata: { blockers },
      });
      project = { ...project, financiallyCompletedAt: null, reopenedAt, status: "planning" };
    }

    return {
      activeRefundCount: activeRefunds.length,
      blockers,
      evaluatedAt: new Date().toISOString(),
      financiallyComplete:
        ledgerComplete && ["closed", "completed", "financially_complete"].includes(project.status),
      jobs: jobReports,
      outstandingInvoiceCents,
      projectId: project.id,
      projectNumber: project.projectNumber,
      projectStatus: project.status,
      unresolvedCustomerCreditCents,
      unresolvedDepositCents,
      unresolvedPaymentCents,
    };
  }

  private async invoiceOutstandingCents(
    transaction: TenantTransaction,
    tenantId: string,
    invoice: InvoiceRecord,
  ): Promise<number> {
    const [version] = await transaction
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
    if (!version) {
      throw conflict("INVOICE_POSTED_VERSION_MISSING", "Posted Invoice Version not found");
    }
    const adjustments = await transaction
      .select({
        amountCents: invoiceAdjustments.amountCents,
        direction: invoiceAdjustments.direction,
      })
      .from(invoiceAdjustments)
      .where(
        and(
          eq(invoiceAdjustments.tenantId, tenantId),
          eq(invoiceAdjustments.invoiceId, invoice.id),
          eq(invoiceAdjustments.status, "posted"),
        ),
      );
    const paymentEntries = await transaction
      .select({
        amountCents: paymentAllocations.amountCents,
        entryKind: paymentAllocations.entryKind,
      })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.invoiceId, invoice.id),
        ),
      );
    const depositEntries = await transaction
      .select({
        amountCents: depositApplications.amountCents,
        entryKind: depositApplications.entryKind,
      })
      .from(depositApplications)
      .where(
        and(
          eq(depositApplications.tenantId, tenantId),
          eq(depositApplications.invoiceId, invoice.id),
        ),
      );
    const creditEntries = await transaction
      .select({
        amountCents: customerCreditApplications.amountCents,
        entryKind: customerCreditApplications.entryKind,
      })
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.invoiceId, invoice.id),
        ),
      );
    const currentTotal = adjustments.reduce(
      (total, adjustment) =>
        signedAdd(
          total,
          adjustment.direction === "debit" ? adjustment.amountCents : -adjustment.amountCents,
        ),
      version.totalCents,
    );
    const applied = netEntries([...paymentEntries, ...depositEntries, ...creditEntries]);
    if (applied < 0)
      throw conflict("INVOICE_LEDGER_INVALID", "Invoice value history does not reconcile");
    return Math.max(signedAdd(currentTotal, -applied), 0);
  }

  private async unresolvedPaymentCents(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<number> {
    const records = await transaction
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.projectId, projectId)));
    let total = 0;
    for (const payment of records) {
      if (terminalPaymentStatuses.includes(payment.status)) continue;
      const allocations = await transaction
        .select({
          amountCents: paymentAllocations.amountCents,
          entryKind: paymentAllocations.entryKind,
        })
        .from(paymentAllocations)
        .where(
          and(
            eq(paymentAllocations.tenantId, tenantId),
            eq(paymentAllocations.paymentId, payment.id),
          ),
        );
      const credits = await transaction
        .select({
          amountCents: customerCredits.originalAmountCents,
          status: customerCredits.status,
        })
        .from(customerCredits)
        .where(
          and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.sourceId, payment.id)),
        );
      const sourceRefunds = await this.refundsForSource(
        transaction,
        tenantId,
        "payment",
        payment.id,
      );
      const committed = signedAdd(
        signedAdd(
          netEntries(allocations),
          sumSafe(
            credits
              .filter((credit) => credit.status !== "reversed")
              .map((credit) => credit.amountCents),
          ),
        ),
        committedRefundCents(sourceRefunds),
      );
      if (committed < 0 || committed > payment.amountCents) {
        throw conflict("PAYMENT_LEDGER_INVALID", "Payment value history does not reconcile");
      }
      total = signedAdd(total, payment.amountCents - committed);
    }
    return total;
  }

  private async unresolvedDepositCents(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<number> {
    const records = await transaction
      .select()
      .from(depositBalances)
      .where(and(eq(depositBalances.tenantId, tenantId), eq(depositBalances.projectId, projectId)));
    let total = 0;
    for (const balance of records) {
      if (terminalDepositStatuses.includes(balance.status)) continue;
      const applications = await transaction
        .select({
          amountCents: depositApplications.amountCents,
          entryKind: depositApplications.entryKind,
        })
        .from(depositApplications)
        .where(
          and(
            eq(depositApplications.tenantId, tenantId),
            eq(depositApplications.depositBalanceId, balance.id),
          ),
        );
      const committed = signedAdd(
        netEntries(applications),
        committedRefundCents(
          await this.refundsForSource(transaction, tenantId, "deposit", balance.id),
        ),
      );
      if (committed < 0 || committed > balance.originalAmountCents) {
        throw conflict("DEPOSIT_LEDGER_INVALID", "Deposit value history does not reconcile");
      }
      total = signedAdd(total, balance.originalAmountCents - committed);
    }
    return total;
  }

  private async unresolvedCreditCents(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<number> {
    const records = await transaction
      .select()
      .from(customerCredits)
      .where(and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.projectId, projectId)));
    let total = 0;
    for (const credit of records) {
      if (terminalCreditStatuses.includes(credit.status)) continue;
      const applications = await transaction
        .select({
          amountCents: customerCreditApplications.amountCents,
          entryKind: customerCreditApplications.entryKind,
        })
        .from(customerCreditApplications)
        .where(
          and(
            eq(customerCreditApplications.tenantId, tenantId),
            eq(customerCreditApplications.customerCreditId, credit.id),
          ),
        );
      const committed = signedAdd(
        netEntries(applications),
        committedRefundCents(
          await this.refundsForSource(transaction, tenantId, "customer_credit", credit.id),
        ),
      );
      if (committed < 0 || committed > credit.originalAmountCents) {
        throw conflict(
          "CUSTOMER_CREDIT_LEDGER_INVALID",
          "Customer Credit history does not reconcile",
        );
      }
      total = signedAdd(total, credit.originalAmountCents - committed);
    }
    return total;
  }

  private async refundsForSource(
    transaction: TenantTransaction,
    tenantId: string,
    sourceType: "customer_credit" | "deposit" | "payment",
    sourceId: string,
  ): Promise<RefundRecord[]> {
    const sourceCondition =
      sourceType === "payment"
        ? eq(refunds.paymentId, sourceId)
        : sourceType === "deposit"
          ? eq(refunds.depositBalanceId, sourceId)
          : eq(refunds.customerCreditId, sourceId);
    return transaction
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), sourceCondition));
  }

  private async lockProject(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<ProjectRecord> {
    const [project] = await transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1)
      .for("update");
    if (!project) throw notFound("PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  private async recordJobTransition(
    transaction: TenantTransaction,
    actor: FinancialActor,
    jobId: string,
    input: {
      after: unknown;
      before: unknown;
      commandName: string;
      eventType: string;
      metadata: Record<string, unknown>;
      summary: string;
    },
  ): Promise<void> {
    await transaction.insert(jobEvents).values({
      actorUserId: actor.userId,
      eventType: input.eventType,
      jobId,
      metadata: input.metadata,
      summary: input.summary,
      tenantId: actor.tenantId,
    });
    await this.recordChange(transaction, actor, {
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      entityId: jobId,
      entityType: "Job",
      eventType: input.eventType,
      metadata: input.metadata,
    });
  }

  private async recordChange(
    transaction: TenantTransaction,
    actor: FinancialActor,
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
    const eventId = randomUUID();
    await transaction.insert(auditEvents).values({
      actorUserId: actor.userId,
      after: input.after,
      before: input.before,
      commandName: input.commandName,
      correlationId: this.context.correlationId(),
      entityId: input.entityId,
      entityType: input.entityType,
      eventType: input.eventType,
      id: eventId,
      metadata: input.metadata ?? {},
      tenantId: actor.tenantId,
    });
    await transaction.insert(outboxEvents).values({
      aggregateId: input.entityId,
      aggregateType: input.entityType,
      createdBy: actor.userId,
      eventType: input.eventType,
      payload: { auditEventId: eventId, ...(input.metadata ?? {}) },
      tenantId: actor.tenantId,
      updatedBy: actor.userId,
    });
  }
}

function committedRefundCents(entries: RefundRecord[]): number {
  return entries.reduce((total, entry) => {
    if (["cancelled", "failed"].includes(entry.status)) return total;
    return signedAdd(total, entry.reversesRefundId ? -entry.amountCents : entry.amountCents);
  }, 0);
}

function netEntries(entries: { amountCents: number; entryKind: string }[]): number {
  return entries.reduce(
    (total, entry) =>
      signedAdd(total, entry.entryKind === "application" ? entry.amountCents : -entry.amountCents),
    0,
  );
}

function sumSafe(values: number[]): number {
  return values.reduce((total, value) => signedAdd(total, value), 0);
}

function signedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Financial amount exceeds safe integer range");
  return result;
}

function conflict(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.CONFLICT, code, message);
}

function notFound(code: string, message: string): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, code, message);
}
