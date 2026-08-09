import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  customerCreditApplications,
  customerCredits,
  depositApplications,
  depositBalances,
  outboxEvents,
  paymentAllocations,
  payments,
  refunds,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import { IdempotentCommandService } from "../idempotency/idempotent-command.service.js";
import { FinancialCompletionService, type FinancialActor } from "./financial-completion.service.js";
import type {
  ApproveRefundDto,
  CreateRefundDto,
  FinancialReversalDto,
  ProcessRefundDto,
  RefundDto,
  RefundListResponseDto,
} from "./payments.dto.js";

type CustomerCreditRecord = typeof customerCredits.$inferSelect;
type DepositBalanceRecord = typeof depositBalances.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;
type RefundRecord = typeof refunds.$inferSelect;

interface RefundSource {
  availableCents: number;
  currency: string;
  customerAccountId: string;
  originalMethod: string | null;
  projectId: string | null;
  sourceId: string;
  sourceType: "customer_credit" | "deposit" | "payment";
}

interface RefundTotals {
  committedCents: number;
  settledCents: number;
}

@Injectable()
export class RefundsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(FinancialCompletionService)
    private readonly financialCompletion: FinancialCompletionService,
  ) {}

  public async list(status?: string, projectId?: string): Promise<RefundListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const conditions = [eq(refunds.tenantId, actor.tenantId)];
      if (status) conditions.push(eq(refunds.status, status));
      if (projectId) conditions.push(eq(refunds.projectId, projectId));
      const records = await transaction
        .select()
        .from(refunds)
        .where(and(...conditions))
        .orderBy(desc(refunds.createdAt))
        .limit(100);
      return { items: records.map(refundDto) };
    });
  }

  public async get(refundId: string): Promise<RefundDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) =>
      refundDto(await this.findRefund(transaction, actor.tenantId, refundId)),
    );
  }

  public async create(
    customerAccountId: string,
    input: CreateRefundDto,
    key: string,
  ): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { customerAccountId, input }, scope: "refunds.create" },
      async (transaction) => {
        assertPositiveCents(input.amountCents, "REFUND_AMOUNT_INVALID", "Refund amount");
        const source = await this.lockRefundSource(transaction, actor.tenantId, input);
        if (source.customerAccountId !== customerAccountId) {
          throw conflict(
            "REFUND_CUSTOMER_MISMATCH",
            "Refund source and Customer must belong to the same account",
          );
        }
        if (input.amountCents > source.availableCents) {
          throw conflict(
            "REFUND_EXCEEDS_AVAILABLE",
            "Refund exceeds the source's available customer value",
          );
        }
        const reason = requiredReason(input.reason, "REFUND_REASON_REQUIRED", "Refund reason");
        const alternateMethod =
          source.originalMethod !== null && input.refundMethod !== source.originalMethod;
        const alternateMethodReason = input.alternateMethodReason?.trim() ?? null;
        if (alternateMethod && !alternateMethodReason) {
          throw badRequest(
            "REFUND_ALTERNATE_METHOD_REASON_REQUIRED",
            "An alternate refund method requires an attributable reason",
          );
        }
        const payeeName = input.payeeName.trim();
        if (!payeeName) throw badRequest("REFUND_PAYEE_REQUIRED", "Refund payee is required");
        const refundNumber = await allocateBusinessNumber(transaction, {
          entityType: "refund",
          prefix: "REF",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const [refund] = await transaction
          .insert(refunds)
          .values({
            alternateMethodReason,
            amountCents: input.amountCents,
            createdBy: actor.userId,
            currency: source.currency,
            customerAccountId,
            customerCreditId: source.sourceType === "customer_credit" ? source.sourceId : null,
            depositBalanceId: source.sourceType === "deposit" ? source.sourceId : null,
            originalMethod: source.originalMethod,
            payeeSnapshot: {
              ...(input.payeeEmail ? { email: input.payeeEmail.trim().toLowerCase() } : {}),
              name: payeeName,
            },
            paymentId: source.sourceType === "payment" ? source.sourceId : null,
            projectId: source.projectId,
            reason,
            refundMethod: input.refundMethod,
            refundNumber,
            sourceType: source.sourceType,
            status: alternateMethod ? "review_required" : "pending_approval",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!refund) throw new Error("Refund was not created");
        await this.recordChange(transaction, actor, {
          after: {
            amountCents: refund.amountCents,
            refundMethod: refund.refundMethod,
            sourceType: refund.sourceType,
            status: refund.status,
          },
          commandName: "CreateRefund",
          entityId: refund.id,
          entityType: "Refund",
          eventType: "refund.created",
          metadata: { sourceId: source.sourceId },
        });
        await this.reconcileSourceAndProject(transaction, actor, refund);
        return { body: refundDto(refund), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  public async approve(refundId: string, input: ApproveRefundDto, key: string): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, refundId }, scope: "refunds.approve" },
      async (transaction) => {
        const refund = await this.lockRefund(transaction, actor.tenantId, refundId);
        if (!["pending_approval", "review_required"].includes(refund.status)) {
          throw conflict("REFUND_NOT_APPROVABLE", "Refund must be pending approval or review");
        }
        const alternateMethod =
          refund.originalMethod !== null && refund.refundMethod !== refund.originalMethod;
        const identityVerificationReference = input.identityVerificationReference?.trim();
        if (alternateMethod && !identityVerificationReference) {
          throw badRequest(
            "REFUND_IDENTITY_VERIFICATION_REQUIRED",
            "Alternate-method Refund approval requires identity verification evidence",
          );
        }
        const approvedAt = new Date();
        const payeeSnapshot = {
          ...refund.payeeSnapshot,
          ...(identityVerificationReference ? { identityVerificationReference } : {}),
        };
        const [approved] = await transaction
          .update(refunds)
          .set({
            approvedAt,
            approvedBy: actor.userId,
            payeeSnapshot,
            status: "approved",
            updatedBy: actor.userId,
          })
          .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refund.id)))
          .returning();
        if (!approved) throw new Error("Refund approval was not persisted");
        await this.recordChange(transaction, actor, {
          after: { approvedAt, approvedBy: actor.userId, status: "approved" },
          before: { status: refund.status },
          commandName: "ApproveRefund",
          entityId: refund.id,
          entityType: "Refund",
          eventType: "refund.approved",
          metadata: { alternateMethod, identityVerified: Boolean(identityVerificationReference) },
        });
        return { body: refundDto(approved), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async process(refundId: string, input: ProcessRefundDto, key: string): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, refundId }, scope: "refunds.process" },
      async (transaction) => {
        const refund = await this.lockRefund(transaction, actor.tenantId, refundId);
        if (refund.status !== "approved") {
          throw conflict("REFUND_NOT_PROCESSABLE", "Refund must be approved before processing");
        }
        const providerName = input.providerName?.trim();
        const providerRefundId = input.providerRefundId?.trim();
        if (Boolean(providerName) !== Boolean(providerRefundId)) {
          throw badRequest(
            "REFUND_PROVIDER_REFERENCE_INCOMPLETE",
            "Provider name and refund id must be provided together",
          );
        }
        const processedAt = new Date();
        const [processed] = await transaction
          .update(refunds)
          .set({
            processedAt,
            providerName,
            providerRefundId,
            status: "processed",
            updatedBy: actor.userId,
          })
          .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refund.id)))
          .returning();
        if (!processed) throw new Error("Refund processing was not persisted");
        await this.recordChange(transaction, actor, {
          after: { processedAt, providerName, providerRefundId, status: "processed" },
          before: { status: refund.status },
          commandName: "ProcessRefund",
          entityId: refund.id,
          entityType: "Refund",
          eventType: "refund.processed",
        });
        return { body: refundDto(processed), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async settle(refundId: string, key: string): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { refundId }, scope: "refunds.settle" },
      async (transaction) => {
        const refund = await this.lockRefund(transaction, actor.tenantId, refundId);
        if (!refund.processedAt || !["partially_processed", "processed"].includes(refund.status)) {
          throw conflict("REFUND_NOT_SETTLEABLE", "Refund must be processed before settlement");
        }
        const settledAt = new Date();
        const [settled] = await transaction
          .update(refunds)
          .set({ settledAt, status: "settled", updatedBy: actor.userId })
          .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refund.id)))
          .returning();
        if (!settled) throw new Error("Refund settlement was not persisted");
        await this.recordChange(transaction, actor, {
          after: { settledAt, status: "settled" },
          before: { status: refund.status },
          commandName: "SettleRefund",
          entityId: refund.id,
          entityType: "Refund",
          eventType: "refund.settled",
        });
        await this.reconcileSourceAndProject(transaction, actor, settled);
        return { body: refundDto(settled), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async fail(
    refundId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<RefundDto> {
    return this.releaseReservation(refundId, input, key, "failed");
  }

  public async cancel(
    refundId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<RefundDto> {
    return this.releaseReservation(refundId, input, key, "cancelled");
  }

  private async releaseReservation(
    refundId: string,
    input: FinancialReversalDto,
    key: string,
    target: "cancelled" | "failed",
  ): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, refundId }, scope: `refunds.${target}` },
      async (transaction) => {
        const reason = requiredReason(input.reason, "REFUND_TRANSITION_REASON_REQUIRED", "Reason");
        const refund = await this.lockRefund(transaction, actor.tenantId, refundId);
        const allowed =
          target === "cancelled"
            ? ["approved", "pending_approval", "review_required"]
            : ["approved", "partially_processed", "processed", "processing"];
        if (!allowed.includes(refund.status)) {
          throw conflict(
            target === "cancelled" ? "REFUND_NOT_CANCELLABLE" : "REFUND_NOT_FAILABLE",
            `Refund cannot be ${target} from its current state`,
          );
        }
        const [updated] = await transaction
          .update(refunds)
          .set({ status: target, updatedBy: actor.userId })
          .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.id, refund.id)))
          .returning();
        if (!updated) throw new Error("Refund transition was not persisted");
        await this.recordChange(transaction, actor, {
          after: { reason, status: target },
          before: { status: refund.status },
          commandName: target === "cancelled" ? "CancelRefund" : "FailRefund",
          entityId: refund.id,
          entityType: "Refund",
          eventType: target === "cancelled" ? "refund.cancelled" : "refund.failed",
        });
        await this.reconcileSourceAndProject(transaction, actor, updated);
        return { body: refundDto(updated), status: HttpStatus.OK };
      },
    );
    return result.body;
  }

  public async reverse(
    refundId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<RefundDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, refundId }, scope: "refunds.reverse" },
      async (transaction) => {
        const reason = requiredReason(input.reason, "REFUND_REVERSAL_REASON_REQUIRED", "Reason");
        const preview = await this.findRefund(transaction, actor.tenantId, refundId);
        await this.lockRefundSourceFromRecord(transaction, actor.tenantId, preview);
        const refund = await this.lockRefund(transaction, actor.tenantId, refundId);
        if (refund.status !== "settled") {
          throw conflict("REFUND_NOT_REVERSIBLE", "Only a settled Refund can be reversed");
        }
        const [existing] = await transaction
          .select({ id: refunds.id })
          .from(refunds)
          .where(and(eq(refunds.tenantId, actor.tenantId), eq(refunds.reversesRefundId, refund.id)))
          .limit(1);
        if (existing) {
          throw conflict("REFUND_ALREADY_REVERSED", "Refund was already reversed");
        }
        const refundNumber = await allocateBusinessNumber(transaction, {
          entityType: "refund",
          prefix: "REF",
          tenantId: actor.tenantId,
          year: new Date().getUTCFullYear(),
        });
        const reversedAt = new Date();
        const [reversal] = await transaction
          .insert(refunds)
          .values({
            alternateMethodReason: refund.alternateMethodReason,
            amountCents: refund.amountCents,
            approvedAt: reversedAt,
            approvedBy: actor.userId,
            createdBy: actor.userId,
            currency: refund.currency,
            customerAccountId: refund.customerAccountId,
            customerCreditId: refund.customerCreditId,
            depositBalanceId: refund.depositBalanceId,
            originalMethod: refund.originalMethod,
            payeeSnapshot: refund.payeeSnapshot,
            paymentId: refund.paymentId,
            projectId: refund.projectId,
            reason: `Reversal of ${refund.refundNumber}: ${reason}`,
            refundMethod: refund.refundMethod,
            refundNumber,
            reversesRefundId: refund.id,
            sourceType: refund.sourceType,
            status: "reversed",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Refund reversal was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: reversal.amountCents, reason, status: reversal.status },
          commandName: "ReverseRefund",
          entityId: reversal.id,
          entityType: "Refund",
          eventType: "refund.reversed",
          metadata: { reversesRefundId: refund.id },
        });
        await this.reconcileSourceAndProject(transaction, actor, reversal);
        return { body: refundDto(reversal), status: HttpStatus.CREATED };
      },
    );
    return result.body;
  }

  private async lockRefundSource(
    transaction: TenantTransaction,
    tenantId: string,
    input: Pick<CreateRefundDto, "sourceId" | "sourceType">,
  ): Promise<RefundSource> {
    if (input.sourceType === "payment") {
      const payment = await this.lockPayment(transaction, tenantId, input.sourceId);
      if (
        !payment.settledAt ||
        ![
          "fully_allocated",
          "partially_allocated",
          "partially_refunded",
          "refunded",
          "settled",
        ].includes(payment.status)
      ) {
        throw conflict("REFUND_PAYMENT_NOT_SETTLED", "Refund Payment source must be settled");
      }
      return {
        availableCents: (await this.paymentAvailability(transaction, tenantId, payment))
          .availableCents,
        currency: payment.currency,
        customerAccountId: payment.customerAccountId,
        originalMethod: payment.paymentMethod,
        projectId: payment.projectId,
        sourceId: payment.id,
        sourceType: "payment",
      };
    }
    if (input.sourceType === "deposit") {
      const balance = await this.lockDeposit(transaction, tenantId, input.sourceId);
      const [source] = await transaction
        .select({ paymentMethod: payments.paymentMethod })
        .from(paymentAllocations)
        .innerJoin(
          payments,
          and(
            eq(payments.tenantId, paymentAllocations.tenantId),
            eq(payments.id, paymentAllocations.paymentId),
          ),
        )
        .where(
          and(
            eq(paymentAllocations.tenantId, tenantId),
            eq(paymentAllocations.id, balance.sourcePaymentAllocationId),
          ),
        )
        .limit(1);
      if (!source)
        throw conflict("REFUND_DEPOSIT_SOURCE_INVALID", "Deposit Payment source is missing");
      return {
        availableCents: (await this.depositAvailability(transaction, tenantId, balance))
          .availableCents,
        currency: balance.currency,
        customerAccountId: balance.customerAccountId,
        originalMethod: source.paymentMethod,
        projectId: balance.projectId,
        sourceId: balance.id,
        sourceType: "deposit",
      };
    }
    const credit = await this.lockCredit(transaction, tenantId, input.sourceId);
    let originalMethod: string | null = null;
    if (["overpayment", "unapplied_payment"].includes(credit.sourceType)) {
      const [sourcePayment] = await transaction
        .select({ paymentMethod: payments.paymentMethod })
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.id, credit.sourceId)))
        .limit(1);
      originalMethod = sourcePayment?.paymentMethod ?? null;
    }
    return {
      availableCents: (await this.creditAvailability(transaction, tenantId, credit)).availableCents,
      currency: credit.currency,
      customerAccountId: credit.customerAccountId,
      originalMethod,
      projectId: credit.projectId,
      sourceId: credit.id,
      sourceType: "customer_credit",
    };
  }

  private async lockRefundSourceFromRecord(
    transaction: TenantTransaction,
    tenantId: string,
    refund: RefundRecord,
  ): Promise<void> {
    const sourceId = refund.paymentId ?? refund.depositBalanceId ?? refund.customerCreditId;
    if (!sourceId) throw conflict("REFUND_SOURCE_INVALID", "Refund source is missing");
    await this.lockRefundSource(transaction, tenantId, {
      sourceId,
      sourceType: refund.sourceType as CreateRefundDto["sourceType"],
    });
  }

  private async paymentAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    payment: PaymentRecord,
  ): Promise<{
    allocatedCents: number;
    availableCents: number;
    creditedCents: number;
    refunds: RefundTotals;
  }> {
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
      .select({ amountCents: customerCredits.originalAmountCents, status: customerCredits.status })
      .from(customerCredits)
      .where(and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.sourceId, payment.id)));
    const allocatedCents = netEntries(allocations);
    const creditedCents = sumSafe(
      credits.filter((credit) => credit.status !== "reversed").map((credit) => credit.amountCents),
    );
    const sourceRefunds = await this.refundTotals(transaction, tenantId, "payment", payment.id);
    const committed = sumSafe([allocatedCents, creditedCents, sourceRefunds.committedCents]);
    if (committed < 0 || committed > payment.amountCents) {
      throw conflict("PAYMENT_LEDGER_INVALID", "Payment value history does not reconcile");
    }
    return {
      allocatedCents,
      availableCents: payment.status === "reversed" ? 0 : payment.amountCents - committed,
      creditedCents,
      refunds: sourceRefunds,
    };
  }

  private async depositAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    balance: DepositBalanceRecord,
  ): Promise<{ appliedCents: number; availableCents: number; refunds: RefundTotals }> {
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
    const appliedCents = netEntries(applications);
    const sourceRefunds = await this.refundTotals(transaction, tenantId, "deposit", balance.id);
    const committed = sumSafe([appliedCents, sourceRefunds.committedCents]);
    if (committed < 0 || committed > balance.originalAmountCents) {
      throw conflict("DEPOSIT_LEDGER_INVALID", "Deposit value history does not reconcile");
    }
    return {
      appliedCents,
      availableCents: terminalSourceStatus(balance.status)
        ? 0
        : balance.originalAmountCents - committed,
      refunds: sourceRefunds,
    };
  }

  private async creditAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    credit: CustomerCreditRecord,
  ): Promise<{ appliedCents: number; availableCents: number; refunds: RefundTotals }> {
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
    const appliedCents = netEntries(applications);
    const sourceRefunds = await this.refundTotals(
      transaction,
      tenantId,
      "customer_credit",
      credit.id,
    );
    const committed = sumSafe([appliedCents, sourceRefunds.committedCents]);
    if (committed < 0 || committed > credit.originalAmountCents) {
      throw conflict(
        "CUSTOMER_CREDIT_LEDGER_INVALID",
        "Customer Credit history does not reconcile",
      );
    }
    return {
      appliedCents,
      availableCents: terminalSourceStatus(credit.status)
        ? 0
        : credit.originalAmountCents - committed,
      refunds: sourceRefunds,
    };
  }

  private async refundTotals(
    transaction: TenantTransaction,
    tenantId: string,
    sourceType: "customer_credit" | "deposit" | "payment",
    sourceId: string,
  ): Promise<RefundTotals> {
    const sourceCondition =
      sourceType === "payment"
        ? eq(refunds.paymentId, sourceId)
        : sourceType === "deposit"
          ? eq(refunds.depositBalanceId, sourceId)
          : eq(refunds.customerCreditId, sourceId);
    const entries = await transaction
      .select({
        amountCents: refunds.amountCents,
        reversesRefundId: refunds.reversesRefundId,
        status: refunds.status,
      })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), sourceCondition));
    return entries.reduce<RefundTotals>(
      (totals, entry) => {
        if (["cancelled", "failed"].includes(entry.status)) return totals;
        const signedAmount = entry.reversesRefundId ? -entry.amountCents : entry.amountCents;
        totals.committedCents = signedAdd(totals.committedCents, signedAmount);
        if (entry.status === "settled" || entry.reversesRefundId) {
          totals.settledCents = signedAdd(totals.settledCents, signedAmount);
        }
        return totals;
      },
      { committedCents: 0, settledCents: 0 },
    );
  }

  private async reconcileSourceAndProject(
    transaction: TenantTransaction,
    actor: FinancialActor,
    refund: RefundRecord,
  ): Promise<void> {
    if (refund.paymentId) {
      await this.syncPaymentStatus(
        transaction,
        actor,
        await this.lockPayment(transaction, actor.tenantId, refund.paymentId),
      );
    } else if (refund.depositBalanceId) {
      await this.syncDepositStatus(
        transaction,
        actor,
        await this.lockDeposit(transaction, actor.tenantId, refund.depositBalanceId),
      );
    } else if (refund.customerCreditId) {
      await this.syncCreditStatus(
        transaction,
        actor,
        await this.lockCredit(transaction, actor.tenantId, refund.customerCreditId),
      );
    }
    if (refund.projectId) {
      await this.financialCompletion.reconcileProject(transaction, actor, refund.projectId);
    }
  }

  private async syncPaymentStatus(
    transaction: TenantTransaction,
    actor: FinancialActor,
    payment: PaymentRecord,
  ): Promise<void> {
    if (["cancelled", "failed", "resolved", "reversed"].includes(payment.status)) return;
    const availability = await this.paymentAvailability(transaction, actor.tenantId, payment);
    const nonRefundCommitted = availability.allocatedCents + availability.creditedCents;
    const nextStatus =
      availability.refunds.settledCents === payment.amountCents
        ? "refunded"
        : availability.refunds.settledCents > 0
          ? "partially_refunded"
          : nonRefundCommitted === payment.amountCents
            ? "fully_allocated"
            : nonRefundCommitted > 0
              ? "partially_allocated"
              : "settled";
    if (nextStatus === payment.status) return;
    await transaction
      .update(payments)
      .set({ status: nextStatus, updatedBy: actor.userId })
      .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, payment.id)));
    await this.recordChange(transaction, actor, {
      after: { refundedCents: availability.refunds.settledCents, status: nextStatus },
      before: { status: payment.status },
      commandName: "ReconcilePaymentRefundStatus",
      entityId: payment.id,
      entityType: "Payment",
      eventType: "payment.refund_status_changed",
    });
  }

  private async syncDepositStatus(
    transaction: TenantTransaction,
    actor: FinancialActor,
    balance: DepositBalanceRecord,
  ): Promise<void> {
    const availability = await this.depositAvailability(transaction, actor.tenantId, balance);
    const nextStatus =
      availability.refunds.settledCents === balance.originalAmountCents
        ? "refunded"
        : availability.refunds.settledCents > 0
          ? "partially_refunded"
          : availability.appliedCents === balance.originalAmountCents
            ? "fully_applied"
            : availability.appliedCents > 0
              ? "partially_applied"
              : "available";
    if (nextStatus === balance.status) return;
    const terminal = nextStatus === "refunded";
    await transaction
      .update(depositBalances)
      .set({
        resolvedAt: terminal ? new Date() : null,
        resolutionReason: terminal ? "Deposit value fully refunded" : null,
        status: nextStatus,
        updatedBy: actor.userId,
      })
      .where(and(eq(depositBalances.tenantId, actor.tenantId), eq(depositBalances.id, balance.id)));
    await this.recordChange(transaction, actor, {
      after: { refundedCents: availability.refunds.settledCents, status: nextStatus },
      before: { status: balance.status },
      commandName: "ReconcileDepositRefundStatus",
      entityId: balance.id,
      entityType: "DepositBalance",
      eventType: "deposit_balance.refund_status_changed",
    });
  }

  private async syncCreditStatus(
    transaction: TenantTransaction,
    actor: FinancialActor,
    credit: CustomerCreditRecord,
  ): Promise<void> {
    const availability = await this.creditAvailability(transaction, actor.tenantId, credit);
    const nextStatus =
      availability.refunds.settledCents === credit.originalAmountCents
        ? "refunded"
        : availability.refunds.settledCents > 0
          ? "partially_refunded"
          : availability.appliedCents === credit.originalAmountCents
            ? "fully_applied"
            : availability.appliedCents > 0
              ? "partially_applied"
              : "available";
    if (nextStatus === credit.status) return;
    const terminal = nextStatus === "refunded";
    await transaction
      .update(customerCredits)
      .set({
        resolvedAt: terminal ? new Date() : null,
        resolutionReason: terminal ? "Customer Credit fully refunded" : null,
        status: nextStatus,
        updatedBy: actor.userId,
      })
      .where(and(eq(customerCredits.tenantId, actor.tenantId), eq(customerCredits.id, credit.id)));
    await this.recordChange(transaction, actor, {
      after: { refundedCents: availability.refunds.settledCents, status: nextStatus },
      before: { status: credit.status },
      commandName: "ReconcileCustomerCreditRefundStatus",
      entityId: credit.id,
      entityType: "CustomerCredit",
      eventType: "customer_credit.refund_status_changed",
    });
  }

  private async findRefund(
    transaction: TenantTransaction,
    tenantId: string,
    refundId: string,
  ): Promise<RefundRecord> {
    const [refund] = await transaction
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.id, refundId)))
      .limit(1);
    if (!refund) throw notFound("REFUND_NOT_FOUND", "Refund not found");
    return refund;
  }

  private async lockRefund(
    transaction: TenantTransaction,
    tenantId: string,
    refundId: string,
  ): Promise<RefundRecord> {
    const [refund] = await transaction
      .select()
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.id, refundId)))
      .limit(1)
      .for("update");
    if (!refund) throw notFound("REFUND_NOT_FOUND", "Refund not found");
    return refund;
  }

  private async lockPayment(
    transaction: TenantTransaction,
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentRecord> {
    const [payment] = await transaction
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.id, paymentId)))
      .limit(1)
      .for("update");
    if (!payment) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
    return payment;
  }

  private async lockDeposit(
    transaction: TenantTransaction,
    tenantId: string,
    depositBalanceId: string,
  ): Promise<DepositBalanceRecord> {
    const [balance] = await transaction
      .select()
      .from(depositBalances)
      .where(and(eq(depositBalances.tenantId, tenantId), eq(depositBalances.id, depositBalanceId)))
      .limit(1)
      .for("update");
    if (!balance) throw notFound("DEPOSIT_BALANCE_NOT_FOUND", "Deposit Balance not found");
    return balance;
  }

  private async lockCredit(
    transaction: TenantTransaction,
    tenantId: string,
    creditId: string,
  ): Promise<CustomerCreditRecord> {
    const [credit] = await transaction
      .select()
      .from(customerCredits)
      .where(and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.id, creditId)))
      .limit(1)
      .for("update");
    if (!credit) throw notFound("CUSTOMER_CREDIT_NOT_FOUND", "Customer Credit not found");
    return credit;
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

function refundDto(refund: RefundRecord): RefundDto {
  const sourceId = refund.paymentId ?? refund.depositBalanceId ?? refund.customerCreditId;
  if (!sourceId) throw new Error("Refund source is missing");
  return {
    alternateMethodReason: refund.alternateMethodReason,
    amountCents: refund.amountCents,
    approvedAt: refund.approvedAt?.toISOString() ?? null,
    currency: refund.currency,
    customerAccountId: refund.customerAccountId,
    id: refund.id,
    originalMethod: refund.originalMethod,
    payee: refund.payeeSnapshot,
    processedAt: refund.processedAt?.toISOString() ?? null,
    projectId: refund.projectId,
    providerName: refund.providerName,
    providerRefundId: refund.providerRefundId,
    reason: refund.reason,
    refundMethod: refund.refundMethod,
    refundNumber: refund.refundNumber,
    reversesRefundId: refund.reversesRefundId,
    settledAt: refund.settledAt?.toISOString() ?? null,
    sourceId,
    sourceType: refund.sourceType,
    status: refund.status,
  };
}

function terminalSourceStatus(status: string): boolean {
  return ["converted_to_credit", "refunded", "resolved", "retained", "reversed"].includes(status);
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

function assertPositiveCents(value: number, code: string, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw badRequest(code, `${label} must be positive integer cents`);
}

function requiredReason(value: string, code: string, label: string): string {
  const reason = value.trim();
  if (reason.length < 2) throw badRequest(code, `${label} is required`);
  return reason;
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
