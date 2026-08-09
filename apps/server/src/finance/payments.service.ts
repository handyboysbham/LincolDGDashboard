import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  allocateBusinessNumber,
  auditEvents,
  customerAccounts,
  customerCreditApplications,
  customerCredits,
  depositApplications,
  depositBalances,
  documents,
  invoiceAdjustments,
  invoiceDeliveries,
  invoices,
  invoiceVersions,
  outboxEvents,
  paymentAllocations,
  payments,
  projects,
  refunds,
  withTenantTransaction,
  type Database,
  type TenantTransaction,
} from "@ldg/database";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { RequestContextService } from "../context/request-context.service.js";
import { DATABASE } from "../database/database.tokens.js";
import { ApiException } from "../errors/api.exception.js";
import {
  IdempotentCommandService,
  hashCanonicalPayload,
} from "../idempotency/idempotent-command.service.js";
import type {
  ApplyValueDto,
  CreateCustomerCreditDto,
  CreateDepositBalanceDto,
  CreatePaymentDto,
  CustomerCreditDto,
  CustomerCreditListResponseDto,
  DepositBalanceDto,
  DepositBalanceListResponseDto,
  FinancialReversalDto,
  PaymentDto,
  PaymentListResponseDto,
  ValueApplicationDto,
} from "./payments.dto.js";
import { FinancialCompletionService } from "./financial-completion.service.js";

interface Actor {
  tenantId: string;
  userId: string;
}

type CustomerCreditRecord = typeof customerCredits.$inferSelect;
type DepositBalanceRecord = typeof depositBalances.$inferSelect;
type InvoiceRecord = typeof invoices.$inferSelect;
type PaymentAllocationRecord = typeof paymentAllocations.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;

interface SourceAvailability {
  appliedCents: number;
  availableCents: number;
  creditedCents?: number;
  refundedCents: number;
}

interface RefundLedgerEntry {
  amountCents: number;
  reversesRefundId: string | null;
  status: string;
}

interface InvoiceLedger {
  adjustmentCount: number;
  appliedCents: number;
  currentTotalCents: number;
  outstandingCents: number;
}

@Injectable()
export class PaymentsService {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotentCommandService) private readonly idempotency: IdempotentCommandService,
    @Inject(FinancialCompletionService)
    private readonly financialCompletion: FinancialCompletionService,
  ) {}

  public async listPayments(status?: string, projectId?: string): Promise<PaymentListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      const conditions = [eq(payments.tenantId, actor.tenantId)];
      if (status) conditions.push(eq(payments.status, status));
      if (projectId) conditions.push(eq(payments.projectId, projectId));
      const records = await transaction
        .select({ id: payments.id })
        .from(payments)
        .where(and(...conditions))
        .orderBy(desc(payments.receivedAt))
        .limit(100);
      const items: PaymentDto[] = [];
      for (const record of records) {
        items.push(await this.paymentDto(transaction, actor.tenantId, record.id));
      }
      return { items };
    });
  }

  public async getPayment(paymentId: string): Promise<PaymentDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, (transaction) =>
      this.paymentDto(transaction, actor.tenantId, paymentId),
    );
  }

  public async createProjectPayment(
    projectId: string,
    input: CreatePaymentDto,
    key: string,
  ): Promise<PaymentDto> {
    return this.createPayment({ projectId }, input, key);
  }

  public async createCustomerPayment(
    customerAccountId: string,
    input: CreatePaymentDto,
    key: string,
  ): Promise<PaymentDto> {
    return this.createPayment({ customerAccountId }, input, key);
  }

  private async createPayment(
    owner:
      | { customerAccountId: string; projectId?: never }
      | { customerAccountId?: never; projectId: string },
    input: CreatePaymentDto,
    key: string,
  ): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      {
        key,
        payload: { input, owner },
        scope: owner.projectId ? "payments.create-for-project" : "payments.create-for-customer",
      },
      async (transaction) => {
        assertPositiveCents(input.amountCents, "PAYMENT_AMOUNT_INVALID", "Payment amount");
        const project = owner.projectId
          ? await this.lockProject(transaction, actor.tenantId, owner.projectId)
          : null;
        if (!project && owner.customerAccountId) {
          await this.lockCustomer(transaction, actor.tenantId, owner.customerAccountId);
        }
        const customerAccountId = project?.customerAccountId ?? owner.customerAccountId;
        if (!customerAccountId) throw new Error("Payment Customer was not resolved");
        const projectId = project?.id ?? null;
        const providerName = input.providerName?.trim();
        const providerTransactionId = input.providerTransactionId?.trim();
        if (Boolean(providerName) !== Boolean(providerTransactionId)) {
          throw badRequest(
            "PAYMENT_PROVIDER_REFERENCE_INCOMPLETE",
            "Provider name and transaction id must be provided together",
          );
        }
        const receivingAccountReference = input.receivingAccountReference.trim();
        const payerName = input.payerName.trim();
        if (!receivingAccountReference || !payerName) {
          throw badRequest(
            "PAYMENT_PARTY_DETAILS_REQUIRED",
            "Receiving account and payer name are required",
          );
        }
        if (input.evidenceDocumentId) {
          const [evidence] = await transaction
            .select({ status: documents.status })
            .from(documents)
            .where(
              and(
                eq(documents.tenantId, actor.tenantId),
                eq(documents.id, input.evidenceDocumentId),
              ),
            )
            .limit(1)
            .for("update");
          if (!evidence) throw notFound("PAYMENT_EVIDENCE_NOT_FOUND", "Payment evidence not found");
          if (evidence.status !== "available") {
            throw conflict(
              "PAYMENT_EVIDENCE_NOT_AVAILABLE",
              "Payment evidence must be available before it can be attached",
            );
          }
        }
        const receiptStatus =
          input.receiptStatus ?? (input.evidenceDocumentId ? "attached" : "missing");
        if (receiptStatus === "attached" && !input.evidenceDocumentId) {
          throw badRequest(
            "PAYMENT_RECEIPT_EVIDENCE_REQUIRED",
            "An attached receipt requires an evidence document",
          );
        }
        const receivedAt = parseTimestamp(
          input.receivedAt,
          "PAYMENT_RECEIVED_TIME_INVALID",
          "Payment received time is invalid",
        );
        const paymentNumber = await allocateBusinessNumber(transaction, {
          entityType: "payment",
          prefix: "PAY",
          tenantId: actor.tenantId,
          year: receivedAt.getUTCFullYear(),
        });
        const [payment] = await transaction
          .insert(payments)
          .values({
            amountCents: input.amountCents,
            createdBy: actor.userId,
            currency: input.currency ?? "USD",
            customerAccountId,
            evidenceDocumentId: input.evidenceDocumentId,
            payerSnapshot: {
              ...(input.payerEmail ? { email: input.payerEmail.trim().toLowerCase() } : {}),
              name: payerName,
            },
            paymentMethod: input.paymentMethod,
            paymentNumber,
            projectId,
            providerName,
            providerTransactionId,
            receiptStatus,
            receivedAt,
            receivingAccountReference,
            status: "verification_required",
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!payment) throw new Error("Payment was not recorded");
        await this.recordChange(transaction, actor, {
          after: {
            amountCents: payment.amountCents,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            status: payment.status,
          },
          commandName: "RecordPayment",
          entityId: payment.id,
          entityType: "Payment",
          eventType: "payment.recorded",
          metadata: { ...(projectId ? { projectId } : {}), customerAccountId },
        });
        if (projectId) {
          await this.financialCompletion.reconcileProject(transaction, actor, projectId);
        }
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async verifyPayment(paymentId: string, key: string): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { paymentId }, scope: "payments.verify" },
      async (transaction) => {
        const payment = await this.lockPayment(transaction, actor.tenantId, paymentId);
        if (!["pending", "verification_required"].includes(payment.status)) {
          throw conflict("PAYMENT_NOT_VERIFIABLE", "Payment must be pending verification");
        }
        const verifiedAt = new Date();
        await transaction
          .update(payments)
          .set({
            status: "verified",
            updatedBy: actor.userId,
            verifiedAt,
            verifiedBy: actor.userId,
          })
          .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, paymentId)));
        await this.recordChange(transaction, actor, {
          after: { status: "verified", verifiedAt, verifiedBy: actor.userId },
          before: { status: payment.status },
          commandName: "VerifyPayment",
          entityId: payment.id,
          entityType: "Payment",
          eventType: "payment.verified",
        });
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async settlePayment(paymentId: string, key: string): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { paymentId }, scope: "payments.settle" },
      async (transaction) => {
        const payment = await this.lockPayment(transaction, actor.tenantId, paymentId);
        if (!["processing", "verified"].includes(payment.status)) {
          throw conflict("PAYMENT_NOT_SETTLEABLE", "Payment must be verified before settlement");
        }
        const settledAt = new Date();
        await transaction
          .update(payments)
          .set({ settledAt, status: "settled", updatedBy: actor.userId })
          .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, paymentId)));
        await this.recordChange(transaction, actor, {
          after: { settledAt, status: "settled" },
          before: { status: payment.status },
          commandName: "SettlePayment",
          entityId: payment.id,
          entityType: "Payment",
          eventType: "payment.settled",
        });
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async reversePayment(
    paymentId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, paymentId }, scope: "payments.reverse" },
      async (transaction) => {
        const reason = reversalReason(input.reason);
        const payment = await this.lockPayment(transaction, actor.tenantId, paymentId);
        if (
          !payment.settledAt ||
          !["fully_allocated", "partially_allocated", "partially_refunded", "settled"].includes(
            payment.status,
          )
        ) {
          throw conflict(
            "PAYMENT_NOT_REVERSIBLE",
            "Only an active settled Payment can be reversed",
          );
        }

        const allocationEntries = await transaction
          .select()
          .from(paymentAllocations)
          .where(
            and(
              eq(paymentAllocations.tenantId, actor.tenantId),
              eq(paymentAllocations.paymentId, payment.id),
            ),
          )
          .orderBy(asc(paymentAllocations.createdAt));
        const reversedAllocationIds = new Set(
          allocationEntries
            .map((entry) => entry.reversesPaymentAllocationId)
            .filter((id): id is string => Boolean(id)),
        );
        const activeAllocations = allocationEntries.filter(
          (entry) => entry.entryKind === "application" && !reversedAllocationIds.has(entry.id),
        );
        const allocationIds = activeAllocations.map((allocation) => allocation.id);
        const dependentDeposits =
          allocationIds.length === 0
            ? []
            : await transaction
                .select()
                .from(depositBalances)
                .where(
                  and(
                    eq(depositBalances.tenantId, actor.tenantId),
                    inArray(depositBalances.sourcePaymentAllocationId, allocationIds),
                  ),
                )
                .for("update");
        const dependentCredits = await transaction
          .select()
          .from(customerCredits)
          .where(
            and(
              eq(customerCredits.tenantId, actor.tenantId),
              eq(customerCredits.sourceId, payment.id),
              inArray(customerCredits.sourceType, ["overpayment", "unapplied_payment"]),
            ),
          )
          .for("update");

        const refundEntries = await transaction
          .select({
            amountCents: refunds.amountCents,
            customerCreditId: refunds.customerCreditId,
            depositBalanceId: refunds.depositBalanceId,
            paymentId: refunds.paymentId,
            reversesRefundId: refunds.reversesRefundId,
            status: refunds.status,
          })
          .from(refunds)
          .where(eq(refunds.tenantId, actor.tenantId));
        const dependentDepositIds = new Set(dependentDeposits.map((balance) => balance.id));
        const dependentCreditIds = new Set(dependentCredits.map((credit) => credit.id));
        const dependentRefunds = refundEntries.filter(
          (refund) =>
            refund.paymentId === payment.id ||
            (refund.depositBalanceId !== null &&
              dependentDepositIds.has(refund.depositBalanceId)) ||
            (refund.customerCreditId !== null && dependentCreditIds.has(refund.customerCreditId)),
        );
        const hasCommittedRefund = [
          dependentRefunds.filter((refund) => refund.paymentId === payment.id),
          ...dependentDeposits.map((balance) =>
            dependentRefunds.filter((refund) => refund.depositBalanceId === balance.id),
          ),
          ...dependentCredits.map((credit) =>
            dependentRefunds.filter((refund) => refund.customerCreditId === credit.id),
          ),
        ].some((entries) => committedRefundCents(entries) > 0);
        if (hasCommittedRefund) {
          throw conflict(
            "PAYMENT_REVERSAL_REFUND_EXISTS",
            "Reverse or resolve dependent Refunds before reversing the Payment",
          );
        }

        const depositEntries =
          dependentDeposits.length === 0
            ? []
            : await transaction
                .select()
                .from(depositApplications)
                .where(
                  and(
                    eq(depositApplications.tenantId, actor.tenantId),
                    inArray(
                      depositApplications.depositBalanceId,
                      dependentDeposits.map((balance) => balance.id),
                    ),
                  ),
                )
                .orderBy(asc(depositApplications.createdAt));
        const reversedDepositApplicationIds = new Set(
          depositEntries
            .map((entry) => entry.reversesDepositApplicationId)
            .filter((id): id is string => Boolean(id)),
        );
        const activeDepositApplications = depositEntries.filter(
          (entry) =>
            entry.entryKind === "application" && !reversedDepositApplicationIds.has(entry.id),
        );
        const creditEntries =
          dependentCredits.length === 0
            ? []
            : await transaction
                .select()
                .from(customerCreditApplications)
                .where(
                  and(
                    eq(customerCreditApplications.tenantId, actor.tenantId),
                    inArray(
                      customerCreditApplications.customerCreditId,
                      dependentCredits.map((credit) => credit.id),
                    ),
                  ),
                )
                .orderBy(asc(customerCreditApplications.createdAt));
        const reversedCreditApplicationIds = new Set(
          creditEntries
            .map((entry) => entry.reversesCustomerCreditApplicationId)
            .filter((id): id is string => Boolean(id)),
        );
        const activeCreditApplications = creditEntries.filter(
          (entry) =>
            entry.entryKind === "application" && !reversedCreditApplicationIds.has(entry.id),
        );

        const invoiceIds = [
          ...activeAllocations.map((entry) => entry.invoiceId),
          ...activeDepositApplications.map((entry) => entry.invoiceId),
          ...activeCreditApplications.map((entry) => entry.invoiceId),
        ];
        const uniqueInvoiceIds = [...new Set(invoiceIds)].sort();
        const lockedInvoices: InvoiceRecord[] = [];
        for (const invoiceId of uniqueInvoiceIds) {
          lockedInvoices.push(await this.lockInvoice(transaction, actor.tenantId, invoiceId));
        }

        for (const application of activeDepositApplications) {
          const [reversal] = await transaction
            .insert(depositApplications)
            .values({
              amountCents: application.amountCents,
              applicationKey: ledgerKey(`payment-reversal-deposit-${application.id}`, key),
              appliedBy: actor.userId,
              createdBy: actor.userId,
              customerAccountId: application.customerAccountId,
              depositBalanceId: application.depositBalanceId,
              entryKind: "reversal",
              invoiceId: application.invoiceId,
              projectId: application.projectId,
              reason,
              reversesDepositApplicationId: application.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!reversal) throw new Error("Dependent Deposit Application was not reversed");
          await this.recordChange(transaction, actor, {
            after: { amountCents: reversal.amountCents, entryKind: "reversal", reason },
            commandName: "ReversePayment",
            entityId: reversal.id,
            entityType: "DepositApplication",
            eventType: "deposit_application.reversed_for_payment",
            metadata: {
              paymentId: payment.id,
              reversesDepositApplicationId: application.id,
            },
          });
        }
        for (const application of activeCreditApplications) {
          const [reversal] = await transaction
            .insert(customerCreditApplications)
            .values({
              amountCents: application.amountCents,
              applicationKey: ledgerKey(`payment-reversal-credit-${application.id}`, key),
              appliedBy: actor.userId,
              createdBy: actor.userId,
              customerAccountId: application.customerAccountId,
              customerCreditId: application.customerCreditId,
              entryKind: "reversal",
              invoiceId: application.invoiceId,
              reason,
              reversesCustomerCreditApplicationId: application.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!reversal) throw new Error("Dependent Customer Credit Application was not reversed");
          await this.recordChange(transaction, actor, {
            after: { amountCents: reversal.amountCents, entryKind: "reversal", reason },
            commandName: "ReversePayment",
            entityId: reversal.id,
            entityType: "CustomerCreditApplication",
            eventType: "customer_credit_application.reversed_for_payment",
            metadata: {
              paymentId: payment.id,
              reversesCustomerCreditApplicationId: application.id,
            },
          });
        }
        for (const allocation of activeAllocations) {
          const [reversal] = await transaction
            .insert(paymentAllocations)
            .values({
              allocationKey: ledgerKey(`payment-reversal-allocation-${allocation.id}`, key),
              amountCents: allocation.amountCents,
              appliedBy: actor.userId,
              createdBy: actor.userId,
              customerAccountId: allocation.customerAccountId,
              entryKind: "reversal",
              invoiceId: allocation.invoiceId,
              paymentId: allocation.paymentId,
              reason,
              reversesPaymentAllocationId: allocation.id,
              tenantId: actor.tenantId,
              updatedBy: actor.userId,
            })
            .returning();
          if (!reversal) throw new Error("Dependent Payment Allocation was not reversed");
          await this.recordChange(transaction, actor, {
            after: { amountCents: reversal.amountCents, entryKind: "reversal", reason },
            commandName: "ReversePayment",
            entityId: reversal.id,
            entityType: "PaymentAllocation",
            eventType: "payment_allocation.reversed_for_payment",
            metadata: {
              paymentId: payment.id,
              reversesPaymentAllocationId: allocation.id,
            },
          });
        }

        const resolvedAt = new Date();
        for (const balance of dependentDeposits) {
          await transaction
            .update(depositBalances)
            .set({
              resolutionReason: `Source Payment ${payment.paymentNumber} reversed: ${reason}`,
              resolvedAt,
              status: "resolved",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(depositBalances.tenantId, actor.tenantId), eq(depositBalances.id, balance.id)),
            );
          await this.recordChange(transaction, actor, {
            after: { resolvedAt, status: "resolved" },
            before: { status: balance.status },
            commandName: "ReversePayment",
            entityId: balance.id,
            entityType: "DepositBalance",
            eventType: "deposit_balance.resolved_for_payment_reversal",
            metadata: { paymentId: payment.id },
          });
        }
        for (const credit of dependentCredits) {
          await transaction
            .update(customerCredits)
            .set({
              resolutionReason: `Source Payment ${payment.paymentNumber} reversed: ${reason}`,
              resolvedAt,
              status: "reversed",
              updatedBy: actor.userId,
            })
            .where(
              and(eq(customerCredits.tenantId, actor.tenantId), eq(customerCredits.id, credit.id)),
            );
          await this.recordChange(transaction, actor, {
            after: { resolvedAt, status: "reversed" },
            before: { status: credit.status },
            commandName: "ReversePayment",
            entityId: credit.id,
            entityType: "CustomerCredit",
            eventType: "customer_credit.reversed_with_payment",
            metadata: { paymentId: payment.id },
          });
        }

        const reversedAt = new Date();
        await transaction
          .update(payments)
          .set({
            reversalReason: reason,
            reversedAt,
            reversedBy: actor.userId,
            status: "reversed",
            updatedBy: actor.userId,
          })
          .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, payment.id)));
        await this.recordChange(transaction, actor, {
          after: {
            reversalReason: reason,
            reversedAt,
            reversedBy: actor.userId,
            status: "reversed",
          },
          before: { status: payment.status },
          commandName: "ReversePayment",
          entityId: payment.id,
          entityType: "Payment",
          eventType: "payment.reversed",
          metadata: {
            affectedInvoiceIds: uniqueInvoiceIds,
            reversedAllocationCount: activeAllocations.length,
            reversedCreditApplicationCount: activeCreditApplications.length,
            reversedDepositApplicationCount: activeDepositApplications.length,
          },
        });

        for (const invoice of lockedInvoices) {
          await this.syncInvoiceStatus(transaction, actor, invoice);
        }
        if (lockedInvoices.length === 0 && payment.projectId) {
          await this.financialCompletion.reconcileProject(transaction, actor, payment.projectId);
        }
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.OK,
        };
      },
    );
    return result.body;
  }

  public async allocatePayment(
    paymentId: string,
    input: ApplyValueDto,
    key: string,
  ): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { input, paymentId }, scope: "payment-allocations.create" },
      async (transaction) => {
        assertPositiveCents(
          input.amountCents,
          "PAYMENT_ALLOCATION_AMOUNT_INVALID",
          "Allocation amount",
        );
        const payment = await this.lockPayment(transaction, actor.tenantId, paymentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, input.invoiceId);
        this.assertPaymentAvailable(payment);
        this.assertInvoiceApplication(
          payment.customerAccountId,
          payment.currency,
          invoice,
          "Payment",
        );
        const availability = await this.paymentAvailability(transaction, actor.tenantId, payment);
        const invoiceLedger = await this.invoiceLedger(transaction, actor.tenantId, invoice);
        if (input.amountCents > availability.availableCents) {
          throw conflict(
            "PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE",
            "Payment Allocation exceeds available Payment value",
          );
        }
        if (input.amountCents > invoiceLedger.outstandingCents) {
          throw conflict(
            "PAYMENT_ALLOCATION_EXCEEDS_INVOICE",
            "Payment Allocation exceeds the eligible Invoice balance",
          );
        }
        const [allocation] = await transaction
          .insert(paymentAllocations)
          .values({
            allocationKey: ledgerKey("payment-allocation", key),
            amountCents: input.amountCents,
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: payment.customerAccountId,
            invoiceId: invoice.id,
            paymentId: payment.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!allocation) throw new Error("Payment Allocation was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: allocation.amountCents, entryKind: allocation.entryKind },
          commandName: "AllocatePayment",
          entityId: allocation.id,
          entityType: "PaymentAllocation",
          eventType: "payment_allocation.applied",
          metadata: { invoiceId: invoice.id, paymentId: payment.id },
        });
        await this.syncPaymentStatus(transaction, actor, payment);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async reversePaymentAllocation(
    allocationId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<PaymentDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { allocationId, input }, scope: "payment-allocations.reverse" },
      async (transaction) => {
        const reason = reversalReason(input.reason);
        const preview = await this.findPaymentAllocation(transaction, actor.tenantId, allocationId);
        const payment = await this.lockPayment(transaction, actor.tenantId, preview.paymentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const allocation = await this.lockPaymentAllocation(
          transaction,
          actor.tenantId,
          allocationId,
        );
        if (allocation.entryKind !== "application") {
          throw conflict(
            "PAYMENT_ALLOCATION_NOT_REVERSIBLE",
            "Only an applied Allocation can be reversed",
          );
        }
        await this.assertNoPaymentAllocationReversal(transaction, actor.tenantId, allocation.id);
        const [deposit] = await transaction
          .select({ id: depositBalances.id })
          .from(depositBalances)
          .where(
            and(
              eq(depositBalances.tenantId, actor.tenantId),
              eq(depositBalances.sourcePaymentAllocationId, allocation.id),
            ),
          )
          .limit(1);
        if (deposit) {
          throw conflict(
            "PAYMENT_ALLOCATION_DEPOSIT_EXISTS",
            "Resolve the Deposit Balance before reversing its source Allocation",
          );
        }
        const [reversal] = await transaction
          .insert(paymentAllocations)
          .values({
            allocationKey: ledgerKey("payment-allocation-reversal", key),
            amountCents: allocation.amountCents,
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: allocation.customerAccountId,
            entryKind: "reversal",
            invoiceId: allocation.invoiceId,
            paymentId: allocation.paymentId,
            reason,
            reversesPaymentAllocationId: allocation.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Payment Allocation reversal was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: reversal.amountCents, entryKind: reversal.entryKind, reason },
          commandName: "ReversePaymentAllocation",
          entityId: reversal.id,
          entityType: "PaymentAllocation",
          eventType: "payment_allocation.reversed",
          metadata: {
            invoiceId: invoice.id,
            paymentId: payment.id,
            reversesPaymentAllocationId: allocation.id,
          },
        });
        await this.syncPaymentStatus(transaction, actor, payment);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.paymentDto(transaction, actor.tenantId, payment.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async createDepositBalance(
    allocationId: string,
    input: CreateDepositBalanceDto,
    key: string,
  ): Promise<DepositBalanceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { allocationId, input }, scope: "deposit-balances.create" },
      async (transaction) => {
        const preview = await this.findPaymentAllocation(transaction, actor.tenantId, allocationId);
        const payment = await this.lockPayment(transaction, actor.tenantId, preview.paymentId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const allocation = await this.lockPaymentAllocation(
          transaction,
          actor.tenantId,
          allocationId,
        );
        if (allocation.entryKind !== "application") {
          throw conflict(
            "DEPOSIT_SOURCE_ALLOCATION_INVALID",
            "Deposit Balance requires an applied Payment Allocation",
          );
        }
        await this.assertNoPaymentAllocationReversal(transaction, actor.tenantId, allocation.id);
        if (invoice.invoiceType !== "deposit") {
          throw conflict(
            "DEPOSIT_SOURCE_INVOICE_REQUIRED",
            "Deposit Balance source must be a Deposit Invoice Allocation",
          );
        }
        this.assertPaymentAvailable(payment);
        const [existing] = await transaction
          .select({ id: depositBalances.id })
          .from(depositBalances)
          .where(
            and(
              eq(depositBalances.tenantId, actor.tenantId),
              eq(depositBalances.sourcePaymentAllocationId, allocation.id),
            ),
          )
          .limit(1);
        if (existing) {
          throw conflict(
            "DEPOSIT_BALANCE_ALREADY_CREATED",
            "This Payment Allocation already created a Deposit Balance",
          );
        }
        const [balance] = await transaction
          .insert(depositBalances)
          .values({
            createdBy: actor.userId,
            currency: payment.currency,
            customerAccountId: payment.customerAccountId,
            depositType: input.depositType ?? "advance_payment",
            originalAmountCents: allocation.amountCents,
            projectId: invoice.projectId,
            sourcePaymentAllocationId: allocation.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!balance) throw new Error("Deposit Balance was not created");
        await this.recordChange(transaction, actor, {
          after: {
            depositType: balance.depositType,
            originalAmountCents: balance.originalAmountCents,
            status: balance.status,
          },
          commandName: "CreateDepositBalance",
          entityId: balance.id,
          entityType: "DepositBalance",
          eventType: "deposit_balance.created",
          metadata: { sourcePaymentAllocationId: allocation.id },
        });
        return {
          body: await this.depositBalanceDto(transaction, actor.tenantId, balance.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async listDepositBalances(projectId: string): Promise<DepositBalanceListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      await this.findProject(transaction, actor.tenantId, projectId);
      const records = await transaction
        .select({ id: depositBalances.id })
        .from(depositBalances)
        .where(
          and(
            eq(depositBalances.tenantId, actor.tenantId),
            eq(depositBalances.projectId, projectId),
          ),
        )
        .orderBy(desc(depositBalances.createdAt));
      const items: DepositBalanceDto[] = [];
      for (const record of records) {
        items.push(await this.depositBalanceDto(transaction, actor.tenantId, record.id));
      }
      return { items };
    });
  }

  public async applyDeposit(
    depositBalanceId: string,
    input: ApplyValueDto,
    key: string,
  ): Promise<DepositBalanceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { depositBalanceId, input }, scope: "deposit-applications.create" },
      async (transaction) => {
        assertPositiveCents(
          input.amountCents,
          "DEPOSIT_APPLICATION_AMOUNT_INVALID",
          "Application amount",
        );
        const balance = await this.lockDepositBalance(
          transaction,
          actor.tenantId,
          depositBalanceId,
        );
        const invoice = await this.lockInvoice(transaction, actor.tenantId, input.invoiceId);
        if (!["advance_payment", "split_advance"].includes(balance.depositType)) {
          throw conflict(
            "DEPOSIT_NOT_ADVANCE_PAYMENT",
            "Refundable security value cannot be applied to a service Invoice",
          );
        }
        if (!["available", "partially_applied"].includes(balance.status)) {
          throw conflict(
            "DEPOSIT_NOT_AVAILABLE",
            "Deposit Balance is not available for application",
          );
        }
        if (invoice.projectId !== balance.projectId) {
          throw conflict(
            "DEPOSIT_PROJECT_MISMATCH",
            "Deposit and Invoice must belong to the same Project",
          );
        }
        if (invoice.invoiceType !== "final") {
          throw conflict(
            "DEPOSIT_FINAL_INVOICE_REQUIRED",
            "Advance Payment applies to a Final Invoice",
          );
        }
        this.assertInvoiceApplication(
          balance.customerAccountId,
          balance.currency,
          invoice,
          "Deposit",
        );
        const availability = await this.depositAvailability(transaction, actor.tenantId, balance);
        const invoiceLedger = await this.invoiceLedger(transaction, actor.tenantId, invoice);
        if (input.amountCents > availability.availableCents) {
          throw conflict(
            "DEPOSIT_APPLICATION_EXCEEDS_AVAILABLE",
            "Deposit Application exceeds available Deposit value",
          );
        }
        if (input.amountCents > invoiceLedger.outstandingCents) {
          throw conflict(
            "DEPOSIT_APPLICATION_EXCEEDS_INVOICE",
            "Deposit Application exceeds the eligible Invoice balance",
          );
        }
        const [application] = await transaction
          .insert(depositApplications)
          .values({
            amountCents: input.amountCents,
            applicationKey: ledgerKey("deposit-application", key),
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: balance.customerAccountId,
            depositBalanceId: balance.id,
            invoiceId: invoice.id,
            projectId: balance.projectId,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!application) throw new Error("Deposit Application was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: application.amountCents, entryKind: application.entryKind },
          commandName: "ApplyDepositBalance",
          entityId: application.id,
          entityType: "DepositApplication",
          eventType: "deposit_application.applied",
          metadata: { depositBalanceId: balance.id, invoiceId: invoice.id },
        });
        await this.syncDepositStatus(transaction, actor, balance);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.depositBalanceDto(transaction, actor.tenantId, balance.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async reverseDepositApplication(
    applicationId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<DepositBalanceDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { applicationId, input }, scope: "deposit-applications.reverse" },
      async (transaction) => {
        const reason = reversalReason(input.reason);
        const preview = await this.findDepositApplication(
          transaction,
          actor.tenantId,
          applicationId,
        );
        const balance = await this.lockDepositBalance(
          transaction,
          actor.tenantId,
          preview.depositBalanceId,
        );
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const application = await this.lockDepositApplication(
          transaction,
          actor.tenantId,
          applicationId,
        );
        if (application.entryKind !== "application") {
          throw conflict(
            "DEPOSIT_APPLICATION_NOT_REVERSIBLE",
            "Only an applied Deposit entry can be reversed",
          );
        }
        const [existing] = await transaction
          .select({ id: depositApplications.id })
          .from(depositApplications)
          .where(
            and(
              eq(depositApplications.tenantId, actor.tenantId),
              eq(depositApplications.reversesDepositApplicationId, application.id),
            ),
          )
          .limit(1);
        if (existing) {
          throw conflict(
            "DEPOSIT_APPLICATION_ALREADY_REVERSED",
            "Deposit Application was already reversed",
          );
        }
        const [reversal] = await transaction
          .insert(depositApplications)
          .values({
            amountCents: application.amountCents,
            applicationKey: ledgerKey("deposit-application-reversal", key),
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: application.customerAccountId,
            depositBalanceId: application.depositBalanceId,
            entryKind: "reversal",
            invoiceId: application.invoiceId,
            projectId: application.projectId,
            reason,
            reversesDepositApplicationId: application.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Deposit Application reversal was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: reversal.amountCents, entryKind: reversal.entryKind, reason },
          commandName: "ReverseDepositApplication",
          entityId: reversal.id,
          entityType: "DepositApplication",
          eventType: "deposit_application.reversed",
          metadata: {
            depositBalanceId: balance.id,
            invoiceId: invoice.id,
            reversesDepositApplicationId: application.id,
          },
        });
        await this.syncDepositStatus(transaction, actor, balance);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.depositBalanceDto(transaction, actor.tenantId, balance.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async listCustomerCredits(
    customerAccountId: string,
  ): Promise<CustomerCreditListResponseDto> {
    const actor = this.context.actor();
    return withTenantTransaction(this.database, actor.tenantId, async (transaction) => {
      await this.findCustomer(transaction, actor.tenantId, customerAccountId);
      const records = await transaction
        .select({ id: customerCredits.id })
        .from(customerCredits)
        .where(
          and(
            eq(customerCredits.tenantId, actor.tenantId),
            eq(customerCredits.customerAccountId, customerAccountId),
          ),
        )
        .orderBy(desc(customerCredits.createdAt));
      const items: CustomerCreditDto[] = [];
      for (const record of records) {
        items.push(await this.customerCreditDto(transaction, actor.tenantId, record.id));
      }
      return { items };
    });
  }

  public async createCustomerCredit(
    customerAccountId: string,
    input: CreateCustomerCreditDto,
    key: string,
  ): Promise<CustomerCreditDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { customerAccountId, input }, scope: "customer-credits.create" },
      async (transaction) => {
        await this.findCustomer(transaction, actor.tenantId, customerAccountId);
        const source = await this.customerCreditSource(
          transaction,
          actor,
          customerAccountId,
          input,
        );
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
            currency: source.currency,
            customerAccountId,
            description: input.description?.trim() ?? source.description,
            originalAmountCents: source.amountCents,
            projectId: source.projectId,
            sourceId: input.sourceId,
            sourceType: input.sourceType,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!credit) throw new Error("Customer Credit was not created");
        await this.recordChange(transaction, actor, {
          after: {
            originalAmountCents: credit.originalAmountCents,
            sourceType: credit.sourceType,
            status: credit.status,
          },
          commandName: "CreateCustomerCredit",
          entityId: credit.id,
          entityType: "CustomerCredit",
          eventType: "customer_credit.created",
          metadata: { sourceId: credit.sourceId },
        });
        if (input.sourceType === "credit_memo") {
          const invoice = await this.lockInvoice(transaction, actor.tenantId, input.sourceId);
          await this.updateInvoiceStatus(transaction, actor, invoice, "credited", {
            customerCreditId: credit.id,
          });
        } else {
          const payment = await this.lockPayment(transaction, actor.tenantId, input.sourceId);
          await this.syncPaymentStatus(transaction, actor, payment);
        }
        return {
          body: await this.customerCreditDto(transaction, actor.tenantId, credit.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async applyCustomerCredit(
    customerCreditId: string,
    input: ApplyValueDto,
    key: string,
  ): Promise<CustomerCreditDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { customerCreditId, input }, scope: "customer-credit-applications.create" },
      async (transaction) => {
        assertPositiveCents(
          input.amountCents,
          "CUSTOMER_CREDIT_APPLICATION_AMOUNT_INVALID",
          "Application amount",
        );
        const credit = await this.lockCustomerCredit(transaction, actor.tenantId, customerCreditId);
        const invoice = await this.lockInvoice(transaction, actor.tenantId, input.invoiceId);
        if (!["available", "partially_applied"].includes(credit.status)) {
          throw conflict(
            "CUSTOMER_CREDIT_NOT_AVAILABLE",
            "Customer Credit is not available for application",
          );
        }
        this.assertInvoiceApplication(
          credit.customerAccountId,
          credit.currency,
          invoice,
          "Customer Credit",
        );
        const availability = await this.customerCreditAvailability(
          transaction,
          actor.tenantId,
          credit,
        );
        const invoiceLedger = await this.invoiceLedger(transaction, actor.tenantId, invoice);
        if (input.amountCents > availability.availableCents) {
          throw conflict(
            "CUSTOMER_CREDIT_APPLICATION_EXCEEDS_AVAILABLE",
            "Application exceeds available Customer Credit value",
          );
        }
        if (input.amountCents > invoiceLedger.outstandingCents) {
          throw conflict(
            "CUSTOMER_CREDIT_APPLICATION_EXCEEDS_INVOICE",
            "Application exceeds the eligible Invoice balance",
          );
        }
        const [application] = await transaction
          .insert(customerCreditApplications)
          .values({
            amountCents: input.amountCents,
            applicationKey: ledgerKey("customer-credit-application", key),
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: credit.customerAccountId,
            customerCreditId: credit.id,
            invoiceId: invoice.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!application) throw new Error("Customer Credit Application was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: application.amountCents, entryKind: application.entryKind },
          commandName: "ApplyCustomerCredit",
          entityId: application.id,
          entityType: "CustomerCreditApplication",
          eventType: "customer_credit_application.applied",
          metadata: { customerCreditId: credit.id, invoiceId: invoice.id },
        });
        await this.syncCustomerCreditStatus(transaction, actor, credit);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.customerCreditDto(transaction, actor.tenantId, credit.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  public async reverseCustomerCreditApplication(
    applicationId: string,
    input: FinancialReversalDto,
    key: string,
  ): Promise<CustomerCreditDto> {
    const actor = this.context.actor();
    const result = await this.idempotency.execute(
      { key, payload: { applicationId, input }, scope: "customer-credit-applications.reverse" },
      async (transaction) => {
        const reason = reversalReason(input.reason);
        const preview = await this.findCustomerCreditApplication(
          transaction,
          actor.tenantId,
          applicationId,
        );
        const credit = await this.lockCustomerCredit(
          transaction,
          actor.tenantId,
          preview.customerCreditId,
        );
        const invoice = await this.lockInvoice(transaction, actor.tenantId, preview.invoiceId);
        const application = await this.lockCustomerCreditApplication(
          transaction,
          actor.tenantId,
          applicationId,
        );
        if (application.entryKind !== "application") {
          throw conflict(
            "CUSTOMER_CREDIT_APPLICATION_NOT_REVERSIBLE",
            "Only an applied Customer Credit entry can be reversed",
          );
        }
        const [existing] = await transaction
          .select({ id: customerCreditApplications.id })
          .from(customerCreditApplications)
          .where(
            and(
              eq(customerCreditApplications.tenantId, actor.tenantId),
              eq(customerCreditApplications.reversesCustomerCreditApplicationId, application.id),
            ),
          )
          .limit(1);
        if (existing) {
          throw conflict(
            "CUSTOMER_CREDIT_APPLICATION_ALREADY_REVERSED",
            "Customer Credit Application was already reversed",
          );
        }
        const [reversal] = await transaction
          .insert(customerCreditApplications)
          .values({
            amountCents: application.amountCents,
            applicationKey: ledgerKey("customer-credit-application-reversal", key),
            appliedBy: actor.userId,
            createdBy: actor.userId,
            customerAccountId: application.customerAccountId,
            customerCreditId: application.customerCreditId,
            entryKind: "reversal",
            invoiceId: application.invoiceId,
            reason,
            reversesCustomerCreditApplicationId: application.id,
            tenantId: actor.tenantId,
            updatedBy: actor.userId,
          })
          .returning();
        if (!reversal) throw new Error("Customer Credit Application reversal was not created");
        await this.recordChange(transaction, actor, {
          after: { amountCents: reversal.amountCents, entryKind: reversal.entryKind, reason },
          commandName: "ReverseCustomerCreditApplication",
          entityId: reversal.id,
          entityType: "CustomerCreditApplication",
          eventType: "customer_credit_application.reversed",
          metadata: {
            customerCreditId: credit.id,
            invoiceId: invoice.id,
            reversesCustomerCreditApplicationId: application.id,
          },
        });
        await this.syncCustomerCreditStatus(transaction, actor, credit);
        await this.syncInvoiceStatus(transaction, actor, invoice);
        return {
          body: await this.customerCreditDto(transaction, actor.tenantId, credit.id),
          status: HttpStatus.CREATED,
        };
      },
    );
    return result.body;
  }

  private async customerCreditSource(
    transaction: TenantTransaction,
    actor: Actor,
    customerAccountId: string,
    input: CreateCustomerCreditDto,
  ): Promise<{
    amountCents: number;
    currency: string;
    description: string;
    projectId: string | null;
  }> {
    if (input.sourceType === "credit_memo") {
      const invoice = await this.lockInvoice(transaction, actor.tenantId, input.sourceId);
      await this.assertCustomerCreditSourceUnused(transaction, actor.tenantId, input.sourceId, [
        "credit_memo",
      ]);
      if (
        invoice.customerAccountId !== customerAccountId ||
        invoice.invoiceType !== "credit_memo"
      ) {
        throw conflict(
          "CUSTOMER_CREDIT_MEMO_SOURCE_INVALID",
          "Customer Credit source must be this Customer's Credit Memo",
        );
      }
      if (
        !invoice.postedAt ||
        ["draft", "review_required", "ready_to_post", "voided", "replaced", "archived"].includes(
          invoice.status,
        )
      ) {
        throw conflict(
          "CUSTOMER_CREDIT_MEMO_NOT_POSTED",
          "Credit Memo must be posted before creating Customer Credit",
        );
      }
      const ledger = await this.invoiceLedger(transaction, actor.tenantId, invoice);
      if (ledger.currentTotalCents <= 0) {
        throw conflict("CUSTOMER_CREDIT_SOURCE_EMPTY", "Credit Memo has no value to issue");
      }
      return {
        amountCents: ledger.currentTotalCents,
        currency: invoice.currency,
        description: `Credit from ${invoice.invoiceNumber}`,
        projectId: invoice.projectId,
      };
    }
    const payment = await this.lockPayment(transaction, actor.tenantId, input.sourceId);
    await this.assertCustomerCreditSourceUnused(transaction, actor.tenantId, input.sourceId, [
      "overpayment",
      "unapplied_payment",
    ]);
    if (payment.customerAccountId !== customerAccountId) {
      throw conflict(
        "CUSTOMER_CREDIT_PAYMENT_OWNER_MISMATCH",
        "Payment and Customer Credit must belong to the same Customer",
      );
    }
    this.assertPaymentAvailable(payment);
    const availability = await this.paymentAvailability(transaction, actor.tenantId, payment);
    if (availability.availableCents <= 0) {
      throw conflict("CUSTOMER_CREDIT_SOURCE_EMPTY", "Payment has no unapplied value");
    }
    if (input.sourceType === "unapplied_payment" && availability.appliedCents !== 0) {
      throw conflict(
        "CUSTOMER_CREDIT_SOURCE_TYPE_INVALID",
        "A partially allocated Payment remainder is an overpayment",
      );
    }
    if (input.sourceType === "overpayment" && availability.appliedCents === 0) {
      throw conflict(
        "CUSTOMER_CREDIT_SOURCE_TYPE_INVALID",
        "An unallocated Payment must use the unapplied Payment source",
      );
    }
    return {
      amountCents: availability.availableCents,
      currency: payment.currency,
      description: `${input.sourceType === "overpayment" ? "Overpayment" : "Unapplied payment"} from ${payment.paymentNumber}`,
      projectId: payment.projectId,
    };
  }

  private async assertCustomerCreditSourceUnused(
    transaction: TenantTransaction,
    tenantId: string,
    sourceId: string,
    sourceTypes: string[],
  ): Promise<void> {
    const [existing] = await transaction
      .select({ id: customerCredits.id })
      .from(customerCredits)
      .where(
        and(
          eq(customerCredits.tenantId, tenantId),
          eq(customerCredits.sourceId, sourceId),
          inArray(customerCredits.sourceType, sourceTypes),
        ),
      )
      .limit(1);
    if (existing) {
      throw conflict(
        "CUSTOMER_CREDIT_SOURCE_ALREADY_USED",
        "This source already created a Customer Credit",
      );
    }
  }

  private async paymentDto(
    transaction: TenantTransaction,
    tenantId: string,
    paymentId: string,
  ): Promise<PaymentDto> {
    const [record] = await transaction
      .select({
        customerName: customerAccounts.displayName,
        payment: payments,
        projectNumber: projects.projectNumber,
      })
      .from(payments)
      .innerJoin(
        customerAccounts,
        and(
          eq(customerAccounts.tenantId, payments.tenantId),
          eq(customerAccounts.id, payments.customerAccountId),
        ),
      )
      .leftJoin(
        projects,
        and(eq(projects.tenantId, payments.tenantId), eq(projects.id, payments.projectId)),
      )
      .where(and(eq(payments.tenantId, tenantId), eq(payments.id, paymentId)))
      .limit(1);
    if (!record) throw notFound("PAYMENT_NOT_FOUND", "Payment not found");
    const entries = await transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.paymentId, paymentId)),
      )
      .orderBy(asc(paymentAllocations.appliedAt), asc(paymentAllocations.createdAt));
    const availability = await this.paymentAvailability(transaction, tenantId, record.payment);
    return {
      allocatedCents: availability.appliedCents,
      allocations: entries.map((entry) =>
        valueApplicationDto(entry, entry.reversesPaymentAllocationId),
      ),
      amountCents: record.payment.amountCents,
      availableCents: availability.availableCents,
      currency: record.payment.currency,
      customerAccountId: record.payment.customerAccountId,
      customerCreditCents: availability.creditedCents,
      customerName: record.customerName,
      id: record.payment.id,
      payer: record.payment.payerSnapshot,
      paymentMethod: record.payment.paymentMethod,
      paymentNumber: record.payment.paymentNumber,
      projectId: record.payment.projectId,
      projectNumber: record.projectNumber,
      providerName: record.payment.providerName,
      providerTransactionId: record.payment.providerTransactionId,
      receiptStatus: record.payment.receiptStatus,
      receivedAt: record.payment.receivedAt.toISOString(),
      receivingAccountReference: record.payment.receivingAccountReference,
      refundedCents: availability.refundedCents,
      reversedAt: record.payment.reversedAt?.toISOString() ?? null,
      reversalReason: record.payment.reversalReason,
      settledAt: record.payment.settledAt?.toISOString() ?? null,
      status: record.payment.status,
      verifiedAt: record.payment.verifiedAt?.toISOString() ?? null,
    };
  }

  private async depositBalanceDto(
    transaction: TenantTransaction,
    tenantId: string,
    depositBalanceId: string,
  ): Promise<DepositBalanceDto> {
    const [balance] = await transaction
      .select()
      .from(depositBalances)
      .where(and(eq(depositBalances.tenantId, tenantId), eq(depositBalances.id, depositBalanceId)))
      .limit(1);
    if (!balance) throw notFound("DEPOSIT_BALANCE_NOT_FOUND", "Deposit Balance not found");
    const entries = await transaction
      .select()
      .from(depositApplications)
      .where(
        and(
          eq(depositApplications.tenantId, tenantId),
          eq(depositApplications.depositBalanceId, balance.id),
        ),
      )
      .orderBy(asc(depositApplications.appliedAt), asc(depositApplications.createdAt));
    const availability = await this.depositAvailability(transaction, tenantId, balance);
    return {
      applications: entries.map((entry) =>
        valueApplicationDto(entry, entry.reversesDepositApplicationId),
      ),
      appliedCents: availability.appliedCents,
      availableCents: availability.availableCents,
      currency: balance.currency,
      customerAccountId: balance.customerAccountId,
      depositType: balance.depositType,
      id: balance.id,
      originalAmountCents: balance.originalAmountCents,
      projectId: balance.projectId,
      refundedCents: availability.refundedCents,
      sourcePaymentAllocationId: balance.sourcePaymentAllocationId,
      status: balance.status,
    };
  }

  private async customerCreditDto(
    transaction: TenantTransaction,
    tenantId: string,
    customerCreditId: string,
  ): Promise<CustomerCreditDto> {
    const [credit] = await transaction
      .select()
      .from(customerCredits)
      .where(and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.id, customerCreditId)))
      .limit(1);
    if (!credit) throw notFound("CUSTOMER_CREDIT_NOT_FOUND", "Customer Credit not found");
    const entries = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.customerCreditId, credit.id),
        ),
      )
      .orderBy(
        asc(customerCreditApplications.appliedAt),
        asc(customerCreditApplications.createdAt),
      );
    const availability = await this.customerCreditAvailability(transaction, tenantId, credit);
    return {
      applications: entries.map((entry) =>
        valueApplicationDto(entry, entry.reversesCustomerCreditApplicationId),
      ),
      appliedCents: availability.appliedCents,
      availableCents: availability.availableCents,
      creditNumber: credit.creditNumber,
      currency: credit.currency,
      customerAccountId: credit.customerAccountId,
      description: credit.description,
      id: credit.id,
      originalAmountCents: credit.originalAmountCents,
      projectId: credit.projectId,
      refundedCents: availability.refundedCents,
      sourceId: credit.sourceId,
      sourceType: credit.sourceType,
      status: credit.status,
    };
  }

  private async paymentAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    payment: PaymentRecord,
  ): Promise<SourceAvailability & { creditedCents: number }> {
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
      .where(
        and(
          eq(customerCredits.tenantId, tenantId),
          eq(customerCredits.sourceId, payment.id),
          inArray(customerCredits.sourceType, ["unapplied_payment", "overpayment"]),
        ),
      );
    const refundEntries = await transaction
      .select({
        amountCents: refunds.amountCents,
        reversesRefundId: refunds.reversesRefundId,
        status: refunds.status,
      })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.paymentId, payment.id)));
    const appliedCents = netEntries(allocations);
    const creditedCents = credits.reduce(
      (total, credit) =>
        credit.status === "reversed" ? total : checkedAdd(total, credit.amountCents),
      0,
    );
    const refundLedger = refundTotals(refundEntries);
    const refundedCents = refundLedger.settledCents;
    const committed = checkedAdd(
      checkedAdd(appliedCents, creditedCents),
      refundLedger.committedCents,
    );
    if (committed < 0 || committed > payment.amountCents) {
      throw conflict("PAYMENT_LEDGER_INVALID", "Payment value history does not reconcile");
    }
    return {
      appliedCents,
      availableCents: payment.status === "reversed" ? 0 : payment.amountCents - committed,
      creditedCents,
      refundedCents,
    };
  }

  private async depositAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    balance: DepositBalanceRecord,
  ): Promise<SourceAvailability> {
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
    const refundEntries = await transaction
      .select({
        amountCents: refunds.amountCents,
        reversesRefundId: refunds.reversesRefundId,
        status: refunds.status,
      })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.depositBalanceId, balance.id)));
    return sourceAvailability(
      balance.originalAmountCents,
      applications,
      refundEntries,
      balance.status,
    );
  }

  private async customerCreditAvailability(
    transaction: TenantTransaction,
    tenantId: string,
    credit: CustomerCreditRecord,
  ): Promise<SourceAvailability> {
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
    const refundEntries = await transaction
      .select({
        amountCents: refunds.amountCents,
        reversesRefundId: refunds.reversesRefundId,
        status: refunds.status,
      })
      .from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.customerCreditId, credit.id)));
    return sourceAvailability(
      credit.originalAmountCents,
      applications,
      refundEntries,
      credit.status,
    );
  }

  private async invoiceLedger(
    transaction: TenantTransaction,
    tenantId: string,
    invoice: InvoiceRecord,
  ): Promise<InvoiceLedger> {
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
    if (!version)
      throw conflict("INVOICE_POSTED_VERSION_MISSING", "Posted Invoice Version not found");
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
    const adjustmentTotal = adjustments.reduce(
      (total, adjustment) =>
        checkedSignedAdd(
          total,
          adjustment.direction === "debit" ? adjustment.amountCents : -adjustment.amountCents,
        ),
      0,
    );
    const appliedCents = netEntries([...paymentEntries, ...depositEntries, ...creditEntries]);
    const currentTotalCents = checkedSignedAdd(version.totalCents, adjustmentTotal);
    if (appliedCents < 0) {
      throw conflict("INVOICE_LEDGER_INVALID", "Invoice applied-value history does not reconcile");
    }
    return {
      adjustmentCount: adjustments.length,
      appliedCents,
      currentTotalCents,
      outstandingCents: Math.max(currentTotalCents - appliedCents, 0),
    };
  }

  private async syncPaymentStatus(
    transaction: TenantTransaction,
    actor: Actor,
    payment: PaymentRecord,
  ): Promise<void> {
    if (["cancelled", "failed", "resolved", "reversed"].includes(payment.status)) return;
    const availability = await this.paymentAvailability(transaction, actor.tenantId, payment);
    const nonRefundCommitted = availability.appliedCents + availability.creditedCents;
    const nextStatus =
      availability.refundedCents === payment.amountCents
        ? "refunded"
        : availability.refundedCents > 0
          ? "partially_refunded"
          : nonRefundCommitted === payment.amountCents
            ? "fully_allocated"
            : nonRefundCommitted > 0
              ? "partially_allocated"
              : "settled";
    if (payment.status !== nextStatus) {
      await transaction
        .update(payments)
        .set({ status: nextStatus, updatedBy: actor.userId })
        .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, payment.id)));
      await this.recordChange(transaction, actor, {
        after: { availableCents: availability.availableCents, status: nextStatus },
        before: { status: payment.status },
        commandName: "ReconcilePaymentStatus",
        entityId: payment.id,
        entityType: "Payment",
        eventType: "payment.allocation_status_changed",
      });
    }
  }

  private async syncDepositStatus(
    transaction: TenantTransaction,
    actor: Actor,
    balance: DepositBalanceRecord,
  ): Promise<void> {
    const availability = await this.depositAvailability(transaction, actor.tenantId, balance);
    const nextStatus =
      availability.refundedCents === balance.originalAmountCents
        ? "refunded"
        : availability.refundedCents > 0
          ? "partially_refunded"
          : availability.appliedCents === balance.originalAmountCents
            ? "fully_applied"
            : availability.appliedCents > 0
              ? "partially_applied"
              : "available";
    if (balance.status !== nextStatus) {
      const terminal = nextStatus === "refunded";
      await transaction
        .update(depositBalances)
        .set({
          resolvedAt: terminal ? new Date() : null,
          resolutionReason: terminal ? "Deposit value fully refunded" : null,
          status: nextStatus,
          updatedBy: actor.userId,
        })
        .where(
          and(eq(depositBalances.tenantId, actor.tenantId), eq(depositBalances.id, balance.id)),
        );
      await this.recordChange(transaction, actor, {
        after: { availableCents: availability.availableCents, status: nextStatus },
        before: { status: balance.status },
        commandName: "ReconcileDepositBalanceStatus",
        entityId: balance.id,
        entityType: "DepositBalance",
        eventType: "deposit_balance.application_status_changed",
      });
    }
  }

  private async syncCustomerCreditStatus(
    transaction: TenantTransaction,
    actor: Actor,
    credit: CustomerCreditRecord,
  ): Promise<void> {
    const availability = await this.customerCreditAvailability(transaction, actor.tenantId, credit);
    const nextStatus =
      availability.refundedCents === credit.originalAmountCents
        ? "refunded"
        : availability.refundedCents > 0
          ? "partially_refunded"
          : availability.appliedCents === credit.originalAmountCents
            ? "fully_applied"
            : availability.appliedCents > 0
              ? "partially_applied"
              : "available";
    if (credit.status !== nextStatus) {
      const terminal = nextStatus === "refunded";
      await transaction
        .update(customerCredits)
        .set({
          resolvedAt: terminal ? new Date() : null,
          resolutionReason: terminal ? "Customer Credit fully refunded" : null,
          status: nextStatus,
          updatedBy: actor.userId,
        })
        .where(
          and(eq(customerCredits.tenantId, actor.tenantId), eq(customerCredits.id, credit.id)),
        );
      await this.recordChange(transaction, actor, {
        after: { availableCents: availability.availableCents, status: nextStatus },
        before: { status: credit.status },
        commandName: "ReconcileCustomerCreditStatus",
        entityId: credit.id,
        entityType: "CustomerCredit",
        eventType: "customer_credit.application_status_changed",
      });
    }
  }

  private async syncInvoiceStatus(
    transaction: TenantTransaction,
    actor: Actor,
    invoice: InvoiceRecord,
  ): Promise<void> {
    const ledger = await this.invoiceLedger(transaction, actor.tenantId, invoice);
    const [delivery] = await transaction
      .select({ id: invoiceDeliveries.id })
      .from(invoiceDeliveries)
      .where(
        and(
          eq(invoiceDeliveries.tenantId, actor.tenantId),
          eq(invoiceDeliveries.invoiceId, invoice.id),
          inArray(invoiceDeliveries.status, ["delivered", "sent", "viewed"]),
        ),
      )
      .limit(1);
    const nextStatus =
      ledger.outstandingCents === 0
        ? "paid"
        : ledger.appliedCents > 0
          ? "partially_paid"
          : ledger.adjustmentCount > 0
            ? "adjusted"
            : delivery
              ? "sent"
              : "posted";
    await this.updateInvoiceStatus(transaction, actor, invoice, nextStatus, {
      appliedCents: ledger.appliedCents,
      outstandingCents: ledger.outstandingCents,
    });
    await this.financialCompletion.reconcileProject(transaction, actor, invoice.projectId);
  }

  private async updateInvoiceStatus(
    transaction: TenantTransaction,
    actor: Actor,
    invoice: InvoiceRecord,
    nextStatus: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (invoice.status === nextStatus) return;
    await transaction
      .update(invoices)
      .set({ status: nextStatus, updatedBy: actor.userId })
      .where(and(eq(invoices.tenantId, actor.tenantId), eq(invoices.id, invoice.id)));
    await this.recordChange(transaction, actor, {
      after: { status: nextStatus },
      before: { status: invoice.status },
      commandName: "ReconcileInvoicePaymentStatus",
      entityId: invoice.id,
      entityType: "Invoice",
      eventType: "invoice.payment_status_changed",
      metadata,
    });
  }

  private assertPaymentAvailable(payment: PaymentRecord): void {
    if (
      !payment.settledAt ||
      !["settled", "partially_allocated", "fully_allocated", "partially_refunded"].includes(
        payment.status,
      )
    ) {
      throw conflict("PAYMENT_NOT_SETTLED", "Payment must be settled before value can be applied");
    }
  }

  private assertInvoiceApplication(
    customerAccountId: string,
    currency: string,
    invoice: InvoiceRecord,
    sourceLabel: string,
  ): void {
    if (invoice.customerAccountId !== customerAccountId) {
      throw conflict(
        "FINANCE_CUSTOMER_MISMATCH",
        `${sourceLabel} and Invoice must belong to the same Customer`,
      );
    }
    if (invoice.currency !== currency) {
      throw conflict(
        "FINANCE_CURRENCY_MISMATCH",
        `${sourceLabel} and Invoice must use the same currency`,
      );
    }
    if (
      !invoice.postedAt ||
      invoice.invoiceType === "credit_memo" ||
      ["draft", "review_required", "ready_to_post", "voided", "replaced", "archived"].includes(
        invoice.status,
      )
    ) {
      throw conflict(
        "INVOICE_NOT_ELIGIBLE_FOR_APPLICATION",
        `${sourceLabel} requires an eligible posted Invoice`,
      );
    }
  }

  private async assertNoPaymentAllocationReversal(
    transaction: TenantTransaction,
    tenantId: string,
    allocationId: string,
  ): Promise<void> {
    const [existing] = await transaction
      .select({ id: paymentAllocations.id })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, tenantId),
          eq(paymentAllocations.reversesPaymentAllocationId, allocationId),
        ),
      )
      .limit(1);
    if (existing) {
      throw conflict(
        "PAYMENT_ALLOCATION_ALREADY_REVERSED",
        "Payment Allocation was already reversed",
      );
    }
  }

  private async findCustomer(
    transaction: TenantTransaction,
    tenantId: string,
    customerAccountId: string,
  ): Promise<void> {
    const [customer] = await transaction
      .select({ id: customerAccounts.id })
      .from(customerAccounts)
      .where(
        and(eq(customerAccounts.tenantId, tenantId), eq(customerAccounts.id, customerAccountId)),
      )
      .limit(1);
    if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  }

  private async lockCustomer(
    transaction: TenantTransaction,
    tenantId: string,
    customerAccountId: string,
  ): Promise<void> {
    const [customer] = await transaction
      .select({ id: customerAccounts.id })
      .from(customerAccounts)
      .where(
        and(eq(customerAccounts.tenantId, tenantId), eq(customerAccounts.id, customerAccountId)),
      )
      .limit(1)
      .for("update");
    if (!customer) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
  }

  private async findProject(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<void> {
    const [project] = await transaction
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1);
    if (!project) throw notFound("PROJECT_NOT_FOUND", "Project not found");
  }

  private async lockProject(
    transaction: TenantTransaction,
    tenantId: string,
    projectId: string,
  ): Promise<typeof projects.$inferSelect> {
    const [project] = await transaction
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1)
      .for("update");
    if (!project) throw notFound("PROJECT_NOT_FOUND", "Project not found");
    return project;
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

  private async findPaymentAllocation(
    transaction: TenantTransaction,
    tenantId: string,
    allocationId: string,
  ): Promise<PaymentAllocationRecord> {
    const [allocation] = await transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.id, allocationId)),
      )
      .limit(1);
    if (!allocation) throw notFound("PAYMENT_ALLOCATION_NOT_FOUND", "Payment Allocation not found");
    return allocation;
  }

  private async lockPaymentAllocation(
    transaction: TenantTransaction,
    tenantId: string,
    allocationId: string,
  ): Promise<PaymentAllocationRecord> {
    const [allocation] = await transaction
      .select()
      .from(paymentAllocations)
      .where(
        and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.id, allocationId)),
      )
      .limit(1)
      .for("update");
    if (!allocation) throw notFound("PAYMENT_ALLOCATION_NOT_FOUND", "Payment Allocation not found");
    return allocation;
  }

  private async lockDepositBalance(
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

  private async findDepositApplication(
    transaction: TenantTransaction,
    tenantId: string,
    applicationId: string,
  ): Promise<typeof depositApplications.$inferSelect> {
    const [application] = await transaction
      .select()
      .from(depositApplications)
      .where(
        and(eq(depositApplications.tenantId, tenantId), eq(depositApplications.id, applicationId)),
      )
      .limit(1);
    if (!application)
      throw notFound("DEPOSIT_APPLICATION_NOT_FOUND", "Deposit Application not found");
    return application;
  }

  private async lockDepositApplication(
    transaction: TenantTransaction,
    tenantId: string,
    applicationId: string,
  ): Promise<typeof depositApplications.$inferSelect> {
    const [application] = await transaction
      .select()
      .from(depositApplications)
      .where(
        and(eq(depositApplications.tenantId, tenantId), eq(depositApplications.id, applicationId)),
      )
      .limit(1)
      .for("update");
    if (!application)
      throw notFound("DEPOSIT_APPLICATION_NOT_FOUND", "Deposit Application not found");
    return application;
  }

  private async lockCustomerCredit(
    transaction: TenantTransaction,
    tenantId: string,
    customerCreditId: string,
  ): Promise<CustomerCreditRecord> {
    const [credit] = await transaction
      .select()
      .from(customerCredits)
      .where(and(eq(customerCredits.tenantId, tenantId), eq(customerCredits.id, customerCreditId)))
      .limit(1)
      .for("update");
    if (!credit) throw notFound("CUSTOMER_CREDIT_NOT_FOUND", "Customer Credit not found");
    return credit;
  }

  private async findCustomerCreditApplication(
    transaction: TenantTransaction,
    tenantId: string,
    applicationId: string,
  ): Promise<typeof customerCreditApplications.$inferSelect> {
    const [application] = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.id, applicationId),
        ),
      )
      .limit(1);
    if (!application) {
      throw notFound(
        "CUSTOMER_CREDIT_APPLICATION_NOT_FOUND",
        "Customer Credit Application not found",
      );
    }
    return application;
  }

  private async lockCustomerCreditApplication(
    transaction: TenantTransaction,
    tenantId: string,
    applicationId: string,
  ): Promise<typeof customerCreditApplications.$inferSelect> {
    const [application] = await transaction
      .select()
      .from(customerCreditApplications)
      .where(
        and(
          eq(customerCreditApplications.tenantId, tenantId),
          eq(customerCreditApplications.id, applicationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!application) {
      throw notFound(
        "CUSTOMER_CREDIT_APPLICATION_NOT_FOUND",
        "Customer Credit Application not found",
      );
    }
    return application;
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

function sourceAvailability(
  originalAmountCents: number,
  applications: { amountCents: number; entryKind: string }[],
  refundsForSource: RefundLedgerEntry[],
  status: string,
): SourceAvailability {
  const appliedCents = netEntries(applications);
  const refundLedger = refundTotals(refundsForSource);
  const refundedCents = refundLedger.settledCents;
  const committed = checkedAdd(appliedCents, refundLedger.committedCents);
  if (committed < 0 || committed > originalAmountCents) {
    throw conflict("FINANCE_SOURCE_LEDGER_INVALID", "Financial source history does not reconcile");
  }
  const terminal = ["converted_to_credit", "refunded", "resolved", "retained", "reversed"].includes(
    status,
  );
  return {
    appliedCents,
    availableCents: terminal ? 0 : originalAmountCents - committed,
    refundedCents,
  };
}

function refundTotals(entries: RefundLedgerEntry[]): {
  committedCents: number;
  settledCents: number;
} {
  return entries.reduce(
    (totals, entry) => {
      if (["cancelled", "failed"].includes(entry.status)) return totals;
      const signedAmount = entry.reversesRefundId ? -entry.amountCents : entry.amountCents;
      totals.committedCents = checkedSignedAdd(totals.committedCents, signedAmount);
      if (entry.status === "settled" || entry.reversesRefundId) {
        totals.settledCents = checkedSignedAdd(totals.settledCents, signedAmount);
      }
      return totals;
    },
    { committedCents: 0, settledCents: 0 },
  );
}

function committedRefundCents(entries: RefundLedgerEntry[]): number {
  return refundTotals(entries).committedCents;
}

function valueApplicationDto(
  entry: {
    amountCents: number;
    appliedAt: Date;
    entryKind: string;
    id: string;
    invoiceId: string;
    reason: string | null;
  },
  reversesApplicationId: string | null,
): ValueApplicationDto {
  return {
    amountCents: entry.amountCents,
    appliedAt: entry.appliedAt.toISOString(),
    entryKind: entry.entryKind,
    id: entry.id,
    invoiceId: entry.invoiceId,
    reason: entry.reason,
    reversesApplicationId,
  };
}

function netEntries(entries: { amountCents: number; entryKind: string }[]): number {
  return entries.reduce(
    (total, entry) =>
      checkedSignedAdd(
        total,
        entry.entryKind === "application" ? entry.amountCents : -entry.amountCents,
      ),
    0,
  );
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error("Financial amount exceeds safe integer range");
  return result;
}

function checkedSignedAdd(left: number, right: number): number {
  return checkedAdd(left, right);
}

function assertPositiveCents(value: number, code: string, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(code, `${label} must be positive integer cents`);
  }
}

function ledgerKey(scope: string, key: string): string {
  return `${scope}:${hashCanonicalPayload(key)}`;
}

function reversalReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 2) {
    throw badRequest("FINANCIAL_REVERSAL_REASON_REQUIRED", "A reversal reason is required");
  }
  return reason;
}

function parseTimestamp(value: string | undefined, code: string, message: string): Date {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) throw badRequest(code, message);
  return parsed;
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
