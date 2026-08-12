import {
  contractSignatures,
  contracts,
  createDatabase,
  createDatabasePool,
  customerCreditApplications,
  customerCredits,
  depositApplications,
  depositBalances,
  documentLinks,
  documents,
  expenseAllocations,
  expenses,
  invoiceAdjustments,
  invoiceDeliveries,
  invoiceLineItems,
  invoicePublicLinks,
  invoices,
  invoiceVersions,
  jobCharges,
  jobs,
  materialDeliveryDetails,
  materialLoadItems,
  materialLoads,
  materialLoadValidations,
  materialQuantityVariances,
  materials,
  organizations,
  paymentAllocations,
  payments,
  projects,
  quoteAcceptances,
  quoteLineItems,
  quoteVersions,
  refunds,
  runMigrations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { count, eq } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";

loadRootEnvironment();

interface PricingSetup {
  deliveryZone: { id: string };
  policy: { versions: { id: string }[] };
  supplierCosts: { id: string }[];
}

interface EstimateResponse {
  contentHash: string;
  depositCents: number;
  estimateId: string;
  id: string;
  marginCents: number;
  purchaseCostCents: number;
  recommendedPriceCents: number;
  status: string;
}

interface QuoteResponse {
  contentHash: string;
  id: string;
  quoteId: string;
  status: string;
  totalCents: number;
  versionNumber: number;
}

interface SentQuote {
  quote: QuoteResponse;
  token: string;
}

interface InvoiceResponse {
  adjustments: {
    adjustmentType: string;
    amountCents: number;
    direction: string;
    id: string;
    reversesInvoiceAdjustmentId: string | null;
    status: string;
  }[];
  deliveries: { channel: string; status: string }[];
  dueDate: string | null;
  id: string;
  invoiceType: string;
  issueDate: string | null;
  outstandingBalanceCents: number;
  replacedByInvoiceId: string | null;
  replacesInvoiceId: string | null;
  status: string;
  totalCents: number | null;
  versions: {
    amountDueCents: number;
    id: string;
    lines: { description: string; jobChargeId?: string; subtotalCents: number }[];
    status: string;
    totalCents: number;
    versionNumber: number;
  }[];
}

interface PaymentResponse {
  allocatedCents: number;
  allocations: {
    amountCents: number;
    entryKind: string;
    id: string;
    reversesApplicationId: string | null;
  }[];
  amountCents: number;
  availableCents: number;
  customerAccountId: string;
  customerCreditCents: number;
  id: string;
  status: string;
}

interface DepositBalanceResponse {
  applications: {
    amountCents: number;
    entryKind: string;
    id: string;
    reversesApplicationId: string | null;
  }[];
  appliedCents: number;
  availableCents: number;
  id: string;
  originalAmountCents: number;
  status: string;
}

interface CustomerCreditResponse {
  applications: {
    amountCents: number;
    entryKind: string;
    id: string;
    reversesApplicationId: string | null;
  }[];
  appliedCents: number;
  availableCents: number;
  id: string;
  originalAmountCents: number;
  sourceType: string;
  status: string;
}

interface RefundResponse {
  amountCents: number;
  id: string;
  reversesRefundId: string | null;
  status: string;
}

interface FinancialCompletionResponse {
  activeRefundCount: number;
  blockers: string[];
  financiallyComplete: boolean;
  jobs: { financiallyComplete: boolean; jobId: string; status: string }[];
  outstandingInvoiceCents: number;
  projectStatus: string;
  unresolvedCustomerCreditCents: number;
  unresolvedDepositCents: number;
  unresolvedPaymentCents: number;
}

describe(
  "Sprint 1.4.0 commercial flow through Sprint 1.5.0 operations",
  { concurrent: false },
  () => {
    const databaseName = `ldg_commercial_test_${randomUUID().replaceAll("-", "")}`;
    const tenantId = randomUUID();
    const userId = randomUUID();
    const foreignTenantId = randomUUID();
    const foreignUserId = randomUUID();
    let api: ApiApplication | undefined;
    let fastify: FastifyInstance;
    let adminPool: Pool | undefined;
    let migrationPool: Pool | undefined;
    let runtimePool: Pool | undefined;
    let migrationDatabase: Database | undefined;
    let runtimeDatabase: Database | undefined;
    let databaseCreated = false;
    let pricing: PricingSetup;

    const runtime = () => initialized(runtimeDatabase, "runtime database");
    const migrator = () => initialized(migrationDatabase, "migration database");

    beforeAll(async () => {
      adminPool = createDatabasePool(
        connectionString(
          environment("POSTGRES_ADMIN_USER"),
          environment("POSTGRES_ADMIN_PASSWORD"),
          "postgres",
        ),
      );
      await initialized(adminPool, "admin pool").query(
        `create database "${databaseName}" owner "${environment("POSTGRES_MIGRATION_USER")}"`,
      );
      databaseCreated = true;
      migrationPool = createDatabasePool(
        connectionString(
          environment("POSTGRES_MIGRATION_USER"),
          environment("POSTGRES_MIGRATION_PASSWORD"),
          databaseName,
        ),
      );
      runtimePool = createDatabasePool(
        connectionString(
          environment("POSTGRES_RUNTIME_USER"),
          environment("POSTGRES_RUNTIME_PASSWORD"),
          databaseName,
        ),
      );
      migrationDatabase = createDatabase(migrationPool);
      runtimeDatabase = createDatabase(runtimePool);
      await runMigrations(migrator());
      await seedTenant(migrator(), tenantId, userId, "Commercial Test");
      await seedTenant(migrator(), foreignTenantId, foreignUserId, "Foreign Commercial Test");

      process.env.DATABASE_URL = connectionString(
        environment("POSTGRES_RUNTIME_USER"),
        environment("POSTGRES_RUNTIME_PASSWORD"),
        databaseName,
      );
      process.env.DEVELOPMENT_TENANT_ID = tenantId;
      process.env.DEVELOPMENT_USER_ID = userId;
      process.env.DEVELOPMENT_PERMISSIONS = "*";
      process.env.WORKER_TENANT_IDS = tenantId;
      api = await createApiApplication();
      fastify = api.application.getHttpAdapter().getInstance();

      const created = await command(
        "POST",
        "/api/v1/pricing/configurations",
        "pricing-material-1",
        canonicalPricing(),
      );
      expect(created.statusCode).toBe(201);
      pricing = created.json<PricingSetup>();
      const pricingVersionId = required(pricing.policy.versions[0], "Pricing Version").id;
      const activated = await command(
        "POST",
        `/api/v1/pricing/versions/${pricingVersionId}/actions/activate`,
        "pricing-activate-1",
      );
      expect(activated.statusCode).toBe(200);
      expect(activated.json()).toMatchObject({ status: "active" });
    }, 30_000);

    afterAll(async () => {
      await api?.application.close();
      await runtimePool?.end();
      await migrationPool?.end();
      if (adminPool && databaseCreated) {
        await adminPool.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1",
          [databaseName],
        );
        await adminPool.query(`drop database if exists "${databaseName}"`);
      }
      await adminPool?.end();
    });

    it("MD-E2E-001 executes one immutable Quote through a reconciled multi-material delivery", async () => {
      const leadId = await createEstimatingLead("canonical", "Canonical Customer");
      const estimate = await createEstimate(leadId, "canonical");
      expect(estimate).toMatchObject({
        depositCents: 18_500,
        marginCents: 23_600,
        purchaseCostCents: 18_400,
        recommendedPriceCents: 42_000,
        status: "draft",
      });

      const invalidApproval = await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/approve`,
        "estimate-approve-invalid-1",
      );
      expect(invalidApproval.statusCode).toBe(409);
      expect(invalidApproval.json()).toMatchObject({
        error: { code: "ESTIMATE_NOT_PENDING_APPROVAL" },
      });

      expect(
        (
          await command(
            "POST",
            `/api/v1/estimate-versions/${estimate.id}/actions/submit`,
            "estimate-submit-1",
          )
        ).json(),
      ).toMatchObject({ status: "pending_approval" });
      expect(
        (
          await command(
            "POST",
            `/api/v1/estimate-versions/${estimate.id}/actions/approve`,
            "estimate-approve-1",
          )
        ).json(),
      ).toMatchObject({ status: "approved" });
      const quoteCreated = await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/create-quote`,
        "quote-create-1",
      );
      expect(quoteCreated.statusCode).toBe(201);
      const quote = quoteCreated.json<QuoteResponse>();
      expect(quote).toMatchObject({ status: "draft", totalCents: 42_000, versionNumber: 1 });
      expect(
        (
          await command(
            "POST",
            `/api/v1/quote-versions/${quote.id}/actions/approve`,
            "quote-approve-1",
          )
        ).json(),
      ).toMatchObject({ status: "ready_to_send" });

      const sent = await command(
        "POST",
        `/api/v1/quote-versions/${quote.id}/actions/send`,
        "quote-send-1",
        { channel: "email", expiresInDays: 10, recipient: "canonical@example.test" },
      );
      expect(sent.statusCode).toBe(200);
      const sentBody = sent.json<{ quote: QuoteResponse; token: string }>();
      expect(sentBody.quote.status).toBe("sent");
      expect(sentBody.token).toMatch(/^qv1\./);

      const viewed = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/quotes/${sentBody.token}`,
      });
      expect(viewed.statusCode).toBe(200);
      const publicQuote = viewed.json<
        Record<string, unknown> & { contentHash: string; status: string; totalCents: number }
      >();
      expect(publicQuote).toMatchObject({ status: "viewed", totalCents: 42_000 });
      expect(publicQuote).not.toHaveProperty("purchaseCostCents");
      expect(publicQuote).not.toHaveProperty("marginCents");
      expect(publicQuote).not.toHaveProperty("calculations");

      const acceptancePayload = {
        acceptedName: "Casey Customer",
        consentText: "I accept this exact Quote and its commercial terms.",
        contentHash: publicQuote.contentHash,
      };
      const accept = () =>
        fastify.inject({
          method: "POST",
          payload: acceptancePayload,
          url: `/api/v1/public/quotes/${sentBody.token}/actions/accept`,
        });
      const [first, concurrentReplay] = await Promise.all([accept(), accept()]);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        project: { serviceType: "material_delivery", status: "pending_contract" },
      });
      expect(concurrentReplay.statusCode).toBe(200);
      expect(concurrentReplay.json()).toEqual(first.json());

      const acceptedBody = first.json<{ project: { id: string } }>();
      const projectDetailResponse = await fastify.inject({
        method: "GET",
        url: `/api/v1/projects/${acceptedBody.project.id}`,
      });
      expect(projectDetailResponse.statusCode).toBe(200);
      const projectDetail = projectDetailResponse.json<{
        contract: null | { contentHash: string; id: string; status: string };
        jobs: { id: string; jobNumber: string; status: string }[];
        status: string;
      }>();
      expect(projectDetail).toMatchObject({
        contract: null,
        jobs: [{ status: "new" }],
        status: "pending_contract",
      });
      expect(required(projectDetail.jobs[0], "Initial Job").jobNumber).toMatch(/^MAT-\d{4}-\d{5}$/);

      const blockedPlanning = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/start-planning`,
        "project-planning-too-early",
        {},
      );
      expect(blockedPlanning.statusCode).toBe(409);

      const generated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/generate-contract`,
        "project-contract-generate",
      );
      expect(generated.statusCode).toBe(201);
      const contract = generated.json<{
        contract: null | { contentHash: string; id: string; status: string };
      }>().contract;
      if (!contract) throw new Error("Contract was not generated");
      const businessSigned = await command(
        "POST",
        `/api/v1/contracts/${contract.id}/actions/sign-business`,
        "contract-sign-business",
        {
          consentText: "I approve this exact Contract for Lincoln Dirt and Gravel.",
          contentHash: contract.contentHash,
          typedName: "Operations Owner",
        },
      );
      expect(businessSigned.statusCode).toBe(200);
      expect(businessSigned.json()).toMatchObject({ status: "business_signed" });
      const businessSignatureId = required(
        businessSigned.json<{ signatures: { id: string; signerRole: string }[] }>().signatures[0],
        "Business signature",
      ).id;
      await expect(
        withTenantTransaction(runtime(), tenantId, (transaction) =>
          transaction
            .update(contracts)
            .set({ contentSnapshot: { altered: true } })
            .where(eq(contracts.id, contract.id)),
        ),
      ).rejects.toThrow();
      await expect(
        withTenantTransaction(runtime(), tenantId, (transaction) =>
          transaction
            .update(contractSignatures)
            .set({ typedName: "Altered signer" })
            .where(eq(contractSignatures.id, businessSignatureId)),
        ),
      ).rejects.toThrow();
      const contractSend = await command(
        "POST",
        `/api/v1/contracts/${contract.id}/actions/send`,
        "contract-send-customer",
        { expiresInDays: 10, recipient: "canonical@example.test" },
      );
      expect(contractSend.statusCode).toBe(200);
      const contractToken = contractSend.json<{ token: string }>().token;
      expect(contractToken).toMatch(/^cv1\./);
      const conflictingSendReplay = await command(
        "POST",
        `/api/v1/contracts/${contract.id}/actions/send`,
        "contract-send-customer",
        { expiresInDays: 20, recipient: "canonical@example.test" },
      );
      expect(conflictingSendReplay.statusCode).toBe(409);
      expect(conflictingSendReplay.json()).toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_CONFLICT" },
      });
      const publicContract = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/contracts/${contractToken}`,
      });
      expect(publicContract.statusCode).toBe(200);
      expect(publicContract.json()).not.toHaveProperty("customerAccountId");
      expect(publicContract.json()).not.toHaveProperty("depositEvidenceReference");
      const publicContractBody = publicContract.json<{ terms: string[] }>();
      expect(publicContractBody.terms).toHaveLength(3);
      expect(publicContractBody.terms.every((term) => typeof term === "string")).toBe(true);
      const customerSigned = await fastify.inject({
        method: "POST",
        payload: {
          consentText: "I accept and sign this exact Contract and its terms.",
          contentHash: contract.contentHash,
          typedName: "Casey Customer",
        },
        url: `/api/v1/public/contracts/${contractToken}/actions/sign`,
      });
      expect(customerSigned.statusCode).toBe(200);
      expect(customerSigned.json()).toMatchObject({ status: "executed" });

      const depositInvoiceCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/invoices`,
        "deposit-invoice-create",
        { dueInDays: 0, invoiceType: "deposit" },
      );
      expect(depositInvoiceCreated.statusCode).toBe(201);
      const depositInvoice = depositInvoiceCreated.json<InvoiceResponse>();
      expect(depositInvoice).toMatchObject({
        invoiceType: "deposit",
        outstandingBalanceCents: 0,
        status: "draft",
        totalCents: 18_500,
        versions: [{ amountDueCents: 18_500, status: "draft", totalCents: 18_500 }],
      });
      expect(
        depositInvoice.versions[0]?.lines.reduce((total, line) => total + line.subtotalCents, 0),
      ).toBe(18_500);
      const depositVersionId = required(depositInvoice.versions[0], "Deposit Invoice Version").id;
      const depositPostTooEarly = await command(
        "POST",
        `/api/v1/invoice-versions/${depositVersionId}/actions/post`,
        "deposit-invoice-post-too-early",
      );
      expect(depositPostTooEarly.statusCode).toBe(409);
      expect(depositPostTooEarly.json()).toMatchObject({
        error: { code: "INVOICE_VERSION_NOT_READY" },
      });
      const depositPrepared = await command(
        "POST",
        `/api/v1/invoice-versions/${depositVersionId}/actions/prepare`,
        "deposit-invoice-prepare",
      );
      expect(depositPrepared.json()).toMatchObject({
        status: "ready_to_post",
        versions: [{ status: "ready_to_post" }],
      });
      const depositPosted = await command(
        "POST",
        `/api/v1/invoice-versions/${depositVersionId}/actions/post`,
        "deposit-invoice-post",
      );
      const depositPostedBody = depositPosted.json<InvoiceResponse>();
      expect(depositPostedBody.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(depositPostedBody.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(depositPostedBody).toMatchObject({
        outstandingBalanceCents: 18_500,
        status: "posted",
        versions: [{ status: "posted" }],
      });
      const depositPostReplay = await command(
        "POST",
        `/api/v1/invoice-versions/${depositVersionId}/actions/post`,
        "deposit-invoice-post",
      );
      expect(depositPostReplay.json()).toEqual(depositPosted.json());
      const depositDelivered = await command(
        "POST",
        `/api/v1/invoices/${depositInvoice.id}/deliveries`,
        "deposit-invoice-delivery",
        { channel: "manual", destination: "Casey Customer", status: "delivered" },
      );
      expect(depositDelivered.statusCode).toBe(201);
      expect(depositDelivered.json()).toMatchObject({
        deliveries: [{ channel: "manual", status: "delivered" }],
        status: "sent",
      });
      const voidedDeposit = await command(
        "POST",
        `/api/v1/invoices/${depositInvoice.id}/actions/void`,
        "deposit-invoice-void",
        { reason: "Replace an incorrectly issued deposit request" },
      );
      expect(voidedDeposit.statusCode).toBe(200);
      expect(voidedDeposit.json()).toMatchObject({
        adjustments: [
          { adjustmentType: "void", amountCents: 18_500, direction: "credit", status: "posted" },
        ],
        outstandingBalanceCents: 0,
        status: "voided",
      });
      const voidedDepositReplay = await command(
        "POST",
        `/api/v1/invoices/${depositInvoice.id}/actions/void`,
        "deposit-invoice-void",
        { reason: "Replace an incorrectly issued deposit request" },
      );
      expect(voidedDepositReplay.json()).toEqual(voidedDeposit.json());
      const voidedAdjustmentBlocked = await command(
        "POST",
        `/api/v1/invoices/${depositInvoice.id}/adjustments`,
        "deposit-invoice-adjust-after-void",
        { adjustmentType: "credit", amountCents: 100, reason: "Should be rejected" },
      );
      expect(voidedAdjustmentBlocked.statusCode).toBe(409);
      expect(voidedAdjustmentBlocked.json()).toMatchObject({
        error: { code: "INVOICE_CORRECTION_NOT_ALLOWED" },
      });
      const activeDepositCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/invoices`,
        "deposit-invoice-recreate",
        { dueInDays: 0, invoiceType: "deposit" },
      );
      expect(activeDepositCreated.statusCode).toBe(201);
      const activeDeposit = activeDepositCreated.json<InvoiceResponse>();
      const activeDepositVersionId = required(
        activeDeposit.versions[0],
        "Recreated Deposit Invoice Version",
      ).id;
      await command(
        "POST",
        `/api/v1/invoice-versions/${activeDepositVersionId}/actions/prepare`,
        "deposit-invoice-recreate-prepare",
      );
      const activeDepositPosted = await command(
        "POST",
        `/api/v1/invoice-versions/${activeDepositVersionId}/actions/post`,
        "deposit-invoice-recreate-post",
      );
      expect(activeDepositPosted.json()).toMatchObject({
        outstandingBalanceCents: 18_500,
        status: "posted",
      });

      const companyPaymentAccount = await command(
        "POST",
        "/api/v1/administration/payment-accounts",
        "deposit-company-payment-account",
        {
          accountReference: "Lincoln DG operating account",
          code: "canonical-operating-zelle",
          isDefault: true,
          name: "Canonical operating Zelle",
          paymentMethod: "zelle",
        },
      );
      expect(companyPaymentAccount.statusCode).toBe(201);
      const companyPaymentAccountId = companyPaymentAccount.json<{ id: string }>().id;
      const mismatchedPaymentAccount = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/payments`,
        "deposit-payment-method-mismatch",
        {
          amountCents: 18_500,
          companyPaymentAccountId,
          payerName: "Casey Customer",
          paymentMethod: "check",
        },
      );
      expect(mismatchedPaymentAccount.statusCode).toBe(400);
      expect(mismatchedPaymentAccount.json()).toMatchObject({
        error: { code: "PAYMENT_ACCOUNT_METHOD_MISMATCH" },
      });
      const depositPaymentCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/payments`,
        "deposit-payment-create",
        {
          amountCents: 18_500,
          companyPaymentAccountId,
          payerName: "Casey Customer",
          paymentMethod: "zelle",
          providerName: "Zelle",
          providerTransactionId: "canonical-deposit-payment-001",
        },
      );
      expect(depositPaymentCreated.statusCode).toBe(201);
      const depositPayment = depositPaymentCreated.json<PaymentResponse>();
      expect(depositPayment).toMatchObject({
        amountCents: 18_500,
        availableCents: 18_500,
        companyPaymentAccountId,
        receivingAccountReference: "Lincoln DG operating account",
        status: "verification_required",
      });
      const unsettledAllocation = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/allocations`,
        "deposit-payment-allocate-too-early",
        { amountCents: 18_500, invoiceId: activeDeposit.id },
      );
      expect(unsettledAllocation.statusCode).toBe(409);
      expect(unsettledAllocation.json()).toMatchObject({ error: { code: "PAYMENT_NOT_SETTLED" } });
      const depositPaymentVerified = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/actions/verify`,
        "deposit-payment-verify",
      );
      expect(depositPaymentVerified.json()).toMatchObject({ status: "verified" });
      const depositPaymentSettled = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/actions/settle`,
        "deposit-payment-settle",
      );
      expect(depositPaymentSettled.json()).toMatchObject({ status: "settled" });
      const depositAllocationCreated = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/allocations`,
        "deposit-payment-allocate",
        { amountCents: 18_500, invoiceId: activeDeposit.id },
      );
      expect(depositAllocationCreated.statusCode).toBe(201);
      const allocatedDepositPayment = depositAllocationCreated.json<PaymentResponse>();
      expect(allocatedDepositPayment).toMatchObject({
        allocatedCents: 18_500,
        availableCents: 0,
        status: "fully_allocated",
      });
      const depositAllocation = required(
        allocatedDepositPayment.allocations.find((entry) => entry.entryKind === "application"),
        "Deposit Payment Allocation",
      );
      const depositAllocationReplay = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/allocations`,
        "deposit-payment-allocate",
        { amountCents: 18_500, invoiceId: activeDeposit.id },
      );
      expect(depositAllocationReplay.json()).toEqual(depositAllocationCreated.json());
      const depositBalanceCreated = await command(
        "POST",
        `/api/v1/payment-allocations/${depositAllocation.id}/actions/create-deposit-balance`,
        "deposit-balance-create",
        { depositType: "advance_payment" },
      );
      expect(depositBalanceCreated.statusCode).toBe(201);
      const advanceDepositBalance = depositBalanceCreated.json<DepositBalanceResponse>();
      expect(advanceDepositBalance).toMatchObject({
        appliedCents: 0,
        availableCents: 18_500,
        originalAmountCents: 18_500,
        status: "available",
      });
      const duplicateDepositBalance = await command(
        "POST",
        `/api/v1/payment-allocations/${depositAllocation.id}/actions/create-deposit-balance`,
        "deposit-balance-create-duplicate",
        { depositType: "advance_payment" },
      );
      expect(duplicateDepositBalance.statusCode).toBe(409);
      expect(duplicateDepositBalance.json()).toMatchObject({
        error: { code: "DEPOSIT_BALANCE_ALREADY_CREATED" },
      });
      const depositAllocationReversalBlocked = await command(
        "POST",
        `/api/v1/payment-allocations/${depositAllocation.id}/actions/reverse`,
        "deposit-allocation-reverse-blocked",
        { reason: "Cannot reverse while customer deposit value exists" },
      );
      expect(depositAllocationReversalBlocked.statusCode).toBe(409);
      expect(depositAllocationReversalBlocked.json()).toMatchObject({
        error: { code: "PAYMENT_ALLOCATION_DEPOSIT_EXISTS" },
      });

      const jobId = required(projectDetail.jobs[0], "Initial Job").id;
      const blockedJobPlanning = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/start-planning`,
        "job-planning-too-early",
        {},
      );
      expect(blockedJobPlanning.statusCode).toBe(409);
      const depositReady = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/confirm-deposit-readiness`,
        "project-deposit-ready",
        { evidenceReference: "external-receipt-1001" },
      );
      expect(depositReady.statusCode).toBe(200);
      expect(depositReady.json()).toMatchObject({
        depositStatus: "satisfied",
        status: "ready_for_planning",
      });
      expect(
        (
          await command(
            "POST",
            `/api/v1/projects/${acceptedBody.project.id}/actions/start-planning`,
            "project-planning-start",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "planning" });
      expect(
        (
          await command(
            "POST",
            `/api/v1/projects/${acceptedBody.project.id}/actions/activate`,
            "project-activate",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "active" });
      expect(
        (
          await command(
            "POST",
            `/api/v1/jobs/${jobId}/actions/start-planning`,
            "job-planning-start",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "planning" });

      const planningReferences = await withTenantTransaction(
        runtime(),
        tenantId,
        async (transaction) => ({
          acceptedLine: (
            await transaction
              .select()
              .from(quoteLineItems)
              .where(eq(quoteLineItems.quoteVersionId, quote.id))
              .limit(1)
          )[0],
          limestone: (
            await transaction
              .select()
              .from(materials)
              .where(eq(materials.name, "Canonical limestone"))
              .limit(1)
          )[0],
        }),
      );
      const acceptedLine = required(planningReferences.acceptedLine, "Accepted Quote Line Item");
      const limestone = required(planningReferences.limestone, "Canonical limestone");
      const sandId = randomUUID();
      await withTenantTransaction(migrator(), tenantId, (transaction) =>
        transaction.insert(materials).values({
          defaultUnit: "cubic_yards",
          id: sandId,
          name: "Canonical masonry sand",
          normalizedName: `canonical masonry sand ${sandId}`,
          tenantId,
        }),
      );
      const gravelSupplierStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "material-gravel-supplier-stop",
        {
          label: "Canonical limestone supplier yard",
          locationSnapshot: { city: "Lincoln", region: "NE" },
          sequence: 1,
          stopType: "supplier",
        },
      );
      expect(gravelSupplierStop.statusCode).toBe(201);
      const gravelSupplierStopId = gravelSupplierStop.json<{ id: string }>().id;
      const sandSupplierStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "material-sand-supplier-stop",
        {
          label: "Canonical sand supplier yard",
          locationSnapshot: { city: "Waverly", region: "NE" },
          sequence: 2,
          stopType: "supplier",
        },
      );
      expect(sandSupplierStop.statusCode).toBe(201);
      const sandSupplierStopId = sandSupplierStop.json<{ id: string }>().id;
      const drivewayPlacementStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "material-driveway-placement-stop",
        {
          label: "Customer driveway placement",
          locationSnapshot: { city: "Lincoln", region: "NE" },
          sequence: 3,
          stopType: "customer",
        },
      );
      expect(drivewayPlacementStop.statusCode).toBe(201);
      const drivewayPlacementStopId = drivewayPlacementStop.json<{ id: string }>().id;
      const garagePlacementStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "material-garage-placement-stop",
        {
          label: "Customer garage placement",
          locationSnapshot: { city: "Lincoln", region: "NE" },
          sequence: 4,
          stopType: "customer",
        },
      );
      expect(garagePlacementStop.statusCode).toBe(201);
      const garagePlacementStopId = garagePlacementStop.json<{ id: string }>().id;
      const planPayload = {
        deliveryType: "placed",
        placementEvidenceRequired: true,
        plannedLoadCount: 1,
      };
      const plan = await command(
        "POST",
        `/api/v1/jobs/${jobId}/material-delivery`,
        "material-plan-create",
        planPayload,
      );
      expect(plan.statusCode).toBe(201);
      const planReplay = await command(
        "POST",
        `/api/v1/jobs/${jobId}/material-delivery`,
        "material-plan-create",
        planPayload,
      );
      expect(planReplay.json()).toEqual(plan.json());
      const load = await command(
        "POST",
        `/api/v1/jobs/${jobId}/material-loads`,
        "material-load-create",
        { sequence: 1 },
      );
      expect(load.statusCode).toBe(201);
      const loadId = load.json<{ id: string }>().id;
      const gravelItemPayload = {
        acceptedQuoteLineItemId: acceptedLine.id,
        compartment: "Separated front compartment",
        loadingSequence: 1,
        materialId: limestone.id,
        placementRouteStopId: drivewayPlacementStopId,
        plannedQuantity: "4.000",
        quantityUnit: "cubic_yards",
        separationInstructions: "Keep limestone separated from sand",
        sequence: 1,
        supplierRouteStopId: gravelSupplierStopId,
        unitVolumeCubicYards: "1.000",
        unitWeightPounds: "1500.000",
        unloadingSequence: 1,
      };
      const gravelItem = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/items`,
        "material-gravel-item-create",
        gravelItemPayload,
      );
      expect(gravelItem.statusCode).toBe(201);
      const unsafeSandPayload = {
        compartment: "Separated rear compartment",
        loadingSequence: 2,
        materialId: sandId,
        placementRouteStopId: garagePlacementStopId,
        plannedQuantity: "3.333",
        quantityUnit: "cubic_yards",
        separationInstructions: "Keep masonry sand separated from limestone",
        sequence: 2,
        supplierRouteStopId: sandSupplierStopId,
        unitVolumeCubicYards: "1.000",
        unitWeightPounds: "1500.000",
        unloadingSequence: 2,
      };
      const sandItem = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/items`,
        "material-sand-item-create",
        unsafeSandPayload,
      );
      expect(sandItem.statusCode).toBe(201);
      const sandItemId = sandItem.json<{ id: string }>().id;
      const createdAsset = await command("POST", "/api/v1/assets", "asset-create-truck", {
        assetNumber: "TRK-100",
        assetType: "truck",
        capacityVolumeCubicYards: "7.000",
        capacityWeight: "10000.000",
        name: "Canonical Truck",
      });
      expect(createdAsset.statusCode).toBe(201);
      const assetId = createdAsset.json<{ id: string }>().id;
      const loadAsset = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/assets`,
        "material-load-asset",
        { assetId, role: "truck" },
      );
      expect(loadAsset.statusCode).toBe(201);
      const unsafeSafety = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-planning-safety-unsafe",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "planning",
        },
      );
      expect(unsafeSafety.statusCode).toBe(200);
      expect(unsafeSafety.json()).toMatchObject({ capacityResult: "fail", result: "not_ready" });
      expect(unsafeSafety.json<{ blockers: string[] }>().blockers).toEqual(
        expect.arrayContaining([
          expect.stringContaining("exceeds capacity 10000.000 pounds"),
          expect.stringContaining("exceeds capacity 7.000 cubic yards"),
        ]),
      );
      expect(
        (
          await command(
            "POST",
            `/api/v1/jobs/${jobId}/actions/request-scheduling`,
            "job-request-schedule",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "needs_scheduling" });

      const held = await command("POST", `/api/v1/jobs/${jobId}/actions/place-hold`, "job-hold", {
        reason: "Awaiting site access confirmation",
      });
      expect(held.statusCode).toBe(200);
      expect(held.json()).toMatchObject({ status: "on_hold" });
      const duplicateHold = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/place-hold`,
        "job-hold-again",
        { reason: "Duplicate hold" },
      );
      expect(duplicateHold.statusCode).toBe(409);
      const released = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/release-hold`,
        "job-release-hold",
        { reason: "Site access confirmed" },
      );
      expect(released.statusCode).toBe(200);
      expect(released.json()).toMatchObject({ status: "needs_scheduling" });

      const startsAt = new Date(Date.now() + 86_400_000).toISOString();
      const endsAt = new Date(Date.now() + 90_000_000).toISOString();
      const schedulePayload = {
        assetIds: [assetId],
        blockType: "service",
        endsAt,
        startsAt,
        userIds: [userId],
      };
      const scheduledBlock = await command(
        "POST",
        `/api/v1/jobs/${jobId}/schedule-blocks`,
        "job-schedule-block",
        schedulePayload,
      );
      expect(scheduledBlock.statusCode).toBe(201);
      const overlap = await command(
        "POST",
        `/api/v1/jobs/${jobId}/schedule-blocks`,
        "job-schedule-overlap",
        schedulePayload,
      );
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json()).toMatchObject({ error: { code: "ASSET_RESERVATION_CONFLICT" } });
      const blockedSchedule = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/confirm-schedule`,
        "job-confirm-schedule-unsafe",
        {},
      );
      expect(blockedSchedule.statusCode).toBe(409);
      expect(blockedSchedule.json()).toMatchObject({
        error: { code: "JOB_NOT_READY_TO_SCHEDULE" },
      });
      const earlyDispatchSafety = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-dispatch-safety-too-early",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "dispatch",
        },
      );
      expect(earlyDispatchSafety.statusCode).toBe(409);
      expect(earlyDispatchSafety.json()).toMatchObject({
        error: { code: "MATERIAL_LOAD_DISPATCH_STATE_INVALID" },
      });
      const safeSandPayload = { ...unsafeSandPayload, plannedQuantity: "2.000" };
      const revisedSand = await command(
        "POST",
        `/api/v1/material-load-items/${sandItemId}/actions/revise`,
        "material-sand-item-revise",
        safeSandPayload,
      );
      expect(revisedSand.statusCode).toBe(200);
      const planningSafety = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-planning-safety-ready",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "planning",
        },
      );
      expect(planningSafety.statusCode).toBe(200);
      expect(planningSafety.json()).toMatchObject({
        capacityResult: "pass",
        compatibilityResult: "pass",
        result: "ready_with_warnings",
        separationResult: "pass",
      });
      const planningSafetyReplay = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-planning-safety-ready",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "planning",
        },
      );
      expect(planningSafetyReplay.json()).toEqual(planningSafety.json());
      expect(
        (
          await command(
            "POST",
            `/api/v1/jobs/${jobId}/actions/confirm-schedule`,
            "job-confirm-schedule",
            {},
          )
        ).json(),
      ).toMatchObject({ readiness: "ready", status: "scheduled" });
      const dispatchSafety = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-dispatch-safety-ready",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "dispatch",
        },
      );
      expect(dispatchSafety.statusCode).toBe(200);
      expect(dispatchSafety.json()).toMatchObject({
        capacityResult: "pass",
        result: "ready_with_warnings",
      });
      expect(
        (
          await command(
            "POST",
            `/api/v1/jobs/${jobId}/actions/mark-dispatch-ready`,
            "job-dispatch-ready",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "dispatch_ready" });
      const startedJob = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/start`,
        "job-start",
        {},
      );
      expect(startedJob.statusCode).toBe(200);

      const evidenceDocument = async (filename: string) => {
        const documentId = randomUUID();
        await withTenantTransaction(migrator(), tenantId, (transaction) =>
          transaction.insert(documents).values({
            availableAt: new Date(),
            createdBy: userId,
            id: documentId,
            mediaType: "application/pdf",
            objectKey: `integration/material-delivery/${documentId}`,
            originalFilename: filename,
            sha256: "a".repeat(64),
            sizeBytes: 512,
            status: "available",
            tenantId,
            updatedBy: userId,
          }),
        );
        return documentId;
      };
      const gravelTicketId = await evidenceDocument("gravel-ticket.pdf");
      const sandTicketId = await evidenceDocument("sand-ticket.pdf");
      const gravelReceiptId = await evidenceDocument("gravel-receipt.pdf");
      const sandReceiptId = await evidenceDocument("sand-receipt.pdf");
      const gravelPlacementId = await evidenceDocument("gravel-placement.pdf");
      const sandPlacementId = await evidenceDocument("sand-placement.pdf");

      const transitionLoad = async (action: string, key: string) =>
        command("POST", `/api/v1/material-loads/${loadId}/actions/${action}`, key, {});
      expect(
        (await transitionLoad("ready-for-loading", "load-ready-loading")).json(),
      ).toMatchObject({
        status: "ready_for_loading",
      });
      expect(
        (await transitionLoad("arrive-supplier", "load-arrive-supplier")).json(),
      ).toMatchObject({
        status: "at_supplier",
      });
      expect((await transitionLoad("start-loading", "load-start-loading")).json()).toMatchObject({
        status: "loading",
      });

      const gravelQuantities = await command(
        "POST",
        `/api/v1/material-load-items/${gravelItem.json<{ id: string }>().id}/actions/record-quantities`,
        "gravel-quantities-loaded",
        {
          actualMaterialId: limestone.id,
          actualUnitCostCents: 3_200,
          loadedQuantity: "4.000",
          purchasedQuantity: "4.000",
        },
      );
      expect(gravelQuantities.statusCode).toBe(200);
      const sandQuantities = await command(
        "POST",
        `/api/v1/material-load-items/${sandItemId}/actions/record-quantities`,
        "sand-quantities-loaded",
        {
          actualMaterialId: sandId,
          actualUnitCostCents: 2_800,
          loadedQuantity: "2.000",
          purchasedQuantity: "2.000",
        },
      );
      expect(sandQuantities.statusCode).toBe(200);

      const attachEvidence = async (
        itemId: string,
        documentId: string,
        purpose: string,
        key: string,
      ) =>
        command("POST", `/api/v1/material-load-items/${itemId}/documents`, key, {
          documentId,
          purpose,
        });
      expect(
        (
          await attachEvidence(
            gravelItem.json<{ id: string }>().id,
            gravelTicketId,
            "supplier_ticket",
            "gravel-ticket",
          )
        ).statusCode,
      ).toBe(201);
      expect(
        (await attachEvidence(sandItemId, sandTicketId, "supplier_ticket", "sand-ticket"))
          .statusCode,
      ).toBe(201);

      const actualSafety = await command(
        "POST",
        `/api/v1/material-loads/${loadId}/actions/evaluate-safety`,
        "material-actual-safety-ready",
        {
          compatibilityConfirmed: true,
          separationConfirmed: true,
          validationType: "actual",
        },
      );
      expect(actualSafety.statusCode).toBe(200);
      expect(actualSafety.json()).toMatchObject({
        capacityResult: "pass",
        result: "ready_with_warnings",
      });
      expect((await transitionLoad("mark-loaded", "load-mark-loaded")).json()).toMatchObject({
        status: "loaded",
      });
      expect((await transitionLoad("start-transit", "load-start-transit")).json()).toMatchObject({
        status: "en_route",
      });
      expect(
        (await transitionLoad("arrive-customer", "load-arrive-customer")).json(),
      ).toMatchObject({
        status: "at_customer",
      });
      expect(
        (await transitionLoad("start-unloading", "load-start-unloading")).json(),
      ).toMatchObject({
        status: "unloading",
      });

      await attachEvidence(
        gravelItem.json<{ id: string }>().id,
        gravelPlacementId,
        "placement_evidence",
        "gravel-placement",
      );
      await attachEvidence(sandItemId, sandPlacementId, "placement_evidence", "sand-placement");
      expect(
        (
          await command(
            "POST",
            `/api/v1/material-load-items/${gravelItem.json<{ id: string }>().id}/actions/record-quantities`,
            "gravel-quantities-delivered",
            {
              deliveredQuantity: "4.000",
              deliveryResult: "delivered",
              remainingDisposition: "none",
              remainingQuantity: "0.000",
            },
          )
        ).json(),
      ).toMatchObject({ deliveredQuantity: "4.000", deliveryResult: "delivered" });
      expect(
        (
          await command(
            "POST",
            `/api/v1/material-load-items/${sandItemId}/actions/record-quantities`,
            "sand-quantities-delivered",
            {
              deliveredQuantity: "2.000",
              deliveryResult: "delivered",
              remainingDisposition: "none",
              remainingQuantity: "0.000",
            },
          )
        ).json(),
      ).toMatchObject({ deliveredQuantity: "2.000", deliveryResult: "delivered" });

      const variance = await command(
        "POST",
        `/api/v1/material-load-items/${sandItemId}/variances`,
        "sand-purchase-variance",
        {
          actualQuantity: "2.100",
          expectedQuantity: "2.000",
          responsibility: "customer",
          varianceType: "purchase",
        },
      );
      expect(variance.statusCode).toBe(201);
      expect(variance.json()).toMatchObject({ status: "open", varianceQuantity: "0.100" });
      const duplicateVariance = await command(
        "POST",
        `/api/v1/material-load-items/${sandItemId}/variances`,
        "sand-purchase-variance-duplicate",
        {
          actualQuantity: "2.100",
          expectedQuantity: "2.000",
          responsibility: "customer",
          varianceType: "purchase",
        },
      );
      expect(duplicateVariance.statusCode).toBe(409);
      const varianceId = variance.json<{ id: string }>().id;
      const chargePayload = {
        calculationSnapshot: { acceptedRateSource: "canonical-masonry-sand-line" },
        chargeKind: "charge",
        chargeType: "additional_material",
        customerAuthorizationStatus: "authorized",
        customerDescription: "Additional masonry sand purchased",
        dedupeKey: `purchase-variance:${varianceId}`,
        evidenceStatus: "complete",
        internalApprovalStatus: "approved",
        occurredAt: new Date().toISOString(),
        quantity: "0.100",
        rateCents: 2_800,
        responsibility: "customer",
        sourceId: varianceId,
        sourceType: "quantity_variance",
        taxBehavior: "non_taxable",
        unit: "cubic_yards",
      };
      const charge = await command(
        "POST",
        `/api/v1/jobs/${jobId}/job-charges`,
        "sand-variance-charge",
        chargePayload,
      );
      expect(charge.statusCode).toBe(201);
      expect(charge.json()).toMatchObject({ calculatedAmountCents: 280, status: "draft" });
      const duplicateCharge = await command(
        "POST",
        `/api/v1/jobs/${jobId}/job-charges`,
        "sand-variance-charge-duplicate",
        chargePayload,
      );
      expect(duplicateCharge.statusCode).toBe(409);
      const approvedCharge = await command(
        "POST",
        `/api/v1/job-charges/${charge.json<{ id: string }>().id}/actions/approve`,
        "sand-variance-charge-approve",
        {},
      );
      expect(approvedCharge.json()).toMatchObject({
        approvedAmountCents: 280,
        status: "ready_to_invoice",
      });
      const resolvedVariance = await command(
        "POST",
        `/api/v1/material-quantity-variances/${varianceId}/actions/resolve`,
        "sand-purchase-variance-resolve",
        { reason: "Additional purchase approved as a Job Charge", resolutionType: "charge" },
      );
      expect(resolvedVariance.json()).toMatchObject({ status: "resolved" });

      expect(
        (await transitionLoad("complete-delivery", "load-complete-delivery")).json(),
      ).toMatchObject({
        status: "delivered",
      });
      expect(
        (await transitionLoad("start-reconciliation", "load-start-reconcile")).json(),
      ).toMatchObject({
        status: "reconciling",
      });
      expect((await transitionLoad("reconcile", "load-reconcile")).json()).toMatchObject({
        status: "reconciled",
      });

      const createExpense = async (
        itemId: string,
        receiptDocumentId: string,
        amountCents: number,
        label: string,
      ) => {
        const created = await command(
          "POST",
          `/api/v1/jobs/${jobId}/expenses`,
          `${label}-expense`,
          {
            amountCents,
            description: `${label} material purchase`,
            expenseType: "material_purchase",
            incurredAt: new Date().toISOString(),
            receiptDocumentId,
          },
        );
        expect(created.statusCode).toBe(201);
        const expenseId = created.json<{ id: string }>().id;
        expect(
          (
            await command(
              "POST",
              `/api/v1/expenses/${expenseId}/allocations`,
              `${label}-allocation`,
              { amountCents, materialLoadItemId: itemId },
            )
          ).statusCode,
        ).toBe(201);
        expect(
          (
            await command(
              "POST",
              `/api/v1/expenses/${expenseId}/actions/approve`,
              `${label}-expense-approve`,
              {},
            )
          ).json(),
        ).toMatchObject({ status: "approved" });
        expect(
          (
            await command(
              "POST",
              `/api/v1/expenses/${expenseId}/actions/reconcile`,
              `${label}-expense-reconcile`,
              {},
            )
          ).json(),
        ).toMatchObject({ status: "reconciled" });
        return expenseId;
      };
      await createExpense(gravelItem.json<{ id: string }>().id, gravelReceiptId, 12_800, "gravel");
      await createExpense(sandItemId, sandReceiptId, 5_600, "sand");
      const blockedInvoiceReadiness = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/evaluate-invoice-readiness`,
        "material-invoice-readiness-missing-receipts",
      );
      expect(blockedInvoiceReadiness.json<{ blockers: string[] }>()).toMatchObject({
        result: "not_ready",
      });
      expect(blockedInvoiceReadiness.json<{ blockers: string[] }>().blockers).toEqual(
        expect.arrayContaining([expect.stringContaining("missing a supplier receipt")]),
      );
      await attachEvidence(
        gravelItem.json<{ id: string }>().id,
        gravelReceiptId,
        "supplier_receipt",
        "gravel-item-receipt",
      );
      await attachEvidence(sandItemId, sandReceiptId, "supplier_receipt", "sand-item-receipt");
      const invoiceReadiness = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/evaluate-invoice-readiness`,
        "material-invoice-readiness-ready",
      );
      expect(invoiceReadiness.json()).toMatchObject({ blockers: [], result: "ready" });
      const materialCatalog = await fastify.inject({ method: "GET", url: "/api/v1/materials" });
      expect(materialCatalog.statusCode).toBe(200);
      expect(materialCatalog.json<{ items: { name: string }[] }>().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Canonical limestone" }),
          expect.objectContaining({ name: "Canonical masonry sand" }),
        ]),
      );
      const deliveryReadModel = await fastify.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}/material-delivery`,
      });
      expect(deliveryReadModel.statusCode).toBe(200);
      expect(deliveryReadModel.json()).toMatchObject({
        expenses: [{ amountCents: 12_800 }, { amountCents: 5_600 }],
        invoiceReadiness: "ready",
        jobCharges: [{ calculatedAmountCents: 280, status: "ready_to_invoice" }],
        loads: [
          {
            items: [
              {
                materialName: "Canonical limestone",
                placementStopLabel: "Customer driveway placement",
                supplierStopLabel: "Canonical limestone supplier yard",
              },
              {
                materialName: "Canonical masonry sand",
                placementStopLabel: "Customer garage placement",
                supplierStopLabel: "Canonical sand supplier yard",
              },
            ],
          },
        ],
        variances: [{ status: "resolved", varianceType: "purchase" }],
      });
      const routeStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "job-route-stop",
        {
          label: "Customer exit check",
          locationSnapshot: { city: "Lincoln", region: "NE" },
          sequence: 5,
          stopType: "customer",
        },
      );
      expect(routeStop.statusCode).toBe(201);
      const checklistDraft = await command(
        "POST",
        "/api/v1/administration/checklist-templates",
        "job-checklist-template",
        {
          items: [
            {
              label: "Confirm safe access",
              requiresEvidence: false,
              responseType: "confirmation",
              sequence: 1,
            },
            {
              label: "Capture completion evidence",
              requiresEvidence: true,
              responseType: "photo",
              sequence: 2,
            },
          ],
          name: "Delivery completion",
          required: true,
          serviceType: "material_delivery",
          templateCode: "delivery-completion",
        },
      );
      expect(checklistDraft.statusCode).toBe(201);
      const checklistTemplateId = checklistDraft.json<{ id: string }>().id;
      const checklistPublished = await command(
        "POST",
        `/api/v1/administration/checklist-templates/${checklistTemplateId}/actions/publish`,
        "job-checklist-template-publish",
      );
      expect(checklistPublished.statusCode).toBe(200);
      const checklist = await command("POST", `/api/v1/jobs/${jobId}/checklists`, "job-checklist", {
        checklistTemplateId,
      });
      expect(checklist.statusCode).toBe(201);
      expect(checklist.json()).toMatchObject({
        items: [{ label: "Confirm safe access" }, { label: "Capture completion evidence" }],
        name: "Delivery completion",
        templateCode: "delivery-completion",
      });
      const checklistItems = checklist.json<{ items: { id: string }[] }>().items;
      for (const [index, item] of checklistItems.entries()) {
        const completed = await command(
          "POST",
          `/api/v1/checklist-items/${item.id}/actions/complete`,
          `job-checklist-item-${index.toString()}`,
          {},
        );
        expect(completed.statusCode).toBe(200);
      }
      await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/complete-operationally`,
        "job-complete-operational",
        {},
      );
      await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/await-final-invoice`,
        "job-await-invoice",
        {},
      );
      const projectOperationallyCompleted = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/complete-operationally`,
        "project-complete-operational",
        {},
      );
      expect(projectOperationallyCompleted.json()).toMatchObject({
        status: "operationally_complete",
      });
      const finalInvoiceCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/invoices`,
        "final-invoice-create",
        { dueInDays: 14, invoiceType: "final", jobId },
      );
      expect(finalInvoiceCreated.statusCode).toBe(201);
      const finalInvoice = finalInvoiceCreated.json<InvoiceResponse>();
      expect(finalInvoice).toMatchObject({
        invoiceType: "final",
        status: "draft",
        totalCents: 42_280,
        versions: [{ amountDueCents: 42_280, status: "draft", totalCents: 42_280 }],
      });
      expect(finalInvoice.versions[0]?.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: "Additional masonry sand purchased",
            subtotalCents: 280,
          }),
        ]),
      );
      const finalInvoiceReplay = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/invoices`,
        "final-invoice-create",
        { dueInDays: 14, invoiceType: "final", jobId },
      );
      expect(finalInvoiceReplay.json()).toEqual(finalInvoiceCreated.json());
      const originalFinalVersionId = required(finalInvoice.versions[0], "Final Invoice Version").id;
      const revisedFinal = await command(
        "POST",
        `/api/v1/invoices/${finalInvoice.id}/actions/revise`,
        "final-invoice-revise",
      );
      expect(revisedFinal.statusCode).toBe(201);
      expect(revisedFinal.json()).toMatchObject({
        versions: [
          { id: originalFinalVersionId, status: "superseded", versionNumber: 1 },
          { status: "draft", totalCents: 42_280, versionNumber: 2 },
        ],
      });
      const finalVersionId = required(
        revisedFinal.json<InvoiceResponse>().versions[1],
        "Revised Final Invoice Version",
      ).id;
      const finalPrepared = await command(
        "POST",
        `/api/v1/invoice-versions/${finalVersionId}/actions/prepare`,
        "final-invoice-prepare",
      );
      expect(finalPrepared.json()).toMatchObject({ status: "ready_to_post" });
      const finalPosted = await command(
        "POST",
        `/api/v1/invoice-versions/${finalVersionId}/actions/post`,
        "final-invoice-post",
      );
      expect(finalPosted.statusCode).toBe(200);
      expect(finalPosted.json()).toMatchObject({
        outstandingBalanceCents: 42_280,
        status: "posted",
        versions: [{ status: "superseded" }, { status: "posted", totalCents: 42_280 }],
      });
      const invoicedJob = await fastify.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
      expect(invoicedJob.json()).toMatchObject({ status: "invoiced" });
      const creditCreated = await command(
        "POST",
        `/api/v1/invoices/${finalInvoice.id}/adjustments`,
        "final-invoice-credit-create",
        {
          adjustmentType: "credit",
          amountCents: 280,
          reason: "Customer should not be charged for the extra sand",
        },
      );
      expect(creditCreated.statusCode).toBe(201);
      const creditAdjustment = required(
        creditCreated
          .json<InvoiceResponse>()
          .adjustments.find((adjustment) => adjustment.adjustmentType === "credit"),
        "Final Invoice credit Adjustment",
      );
      expect(creditAdjustment.status).toBe("pending_approval");
      const creditPostTooEarly = await command(
        "POST",
        `/api/v1/invoice-adjustments/${creditAdjustment.id}/actions/post`,
        "final-invoice-credit-post-too-early",
      );
      expect(creditPostTooEarly.statusCode).toBe(409);
      expect(creditPostTooEarly.json()).toMatchObject({
        error: { code: "INVOICE_ADJUSTMENT_NOT_APPROVED" },
      });
      const creditApproved = await command(
        "POST",
        `/api/v1/invoice-adjustments/${creditAdjustment.id}/actions/approve`,
        "final-invoice-credit-approve",
      );
      expect(creditApproved.json()).toMatchObject({
        adjustments: [{ adjustmentType: "credit", status: "approved" }],
      });
      const creditPosted = await command(
        "POST",
        `/api/v1/invoice-adjustments/${creditAdjustment.id}/actions/post`,
        "final-invoice-credit-post",
      );
      expect(creditPosted.json()).toMatchObject({
        outstandingBalanceCents: 42_000,
        status: "adjusted",
      });
      const reversalCreated = await command(
        "POST",
        `/api/v1/invoice-adjustments/${creditAdjustment.id}/actions/reverse`,
        "final-invoice-credit-reverse",
        { reason: "Credit was approved against the wrong delivery evidence" },
      );
      expect(reversalCreated.statusCode).toBe(201);
      const reversal = required(
        reversalCreated
          .json<InvoiceResponse>()
          .adjustments.find(
            (adjustment) => adjustment.reversesInvoiceAdjustmentId === creditAdjustment.id,
          ),
        "Final Invoice Adjustment reversal",
      );
      expect(reversal).toMatchObject({
        adjustmentType: "charge_reversal",
        amountCents: 280,
        direction: "debit",
        status: "pending_approval",
      });
      const reversalReplay = await command(
        "POST",
        `/api/v1/invoice-adjustments/${creditAdjustment.id}/actions/reverse`,
        "final-invoice-credit-reverse",
        { reason: "Credit was approved against the wrong delivery evidence" },
      );
      expect(reversalReplay.json()).toEqual(reversalCreated.json());
      await command(
        "POST",
        `/api/v1/invoice-adjustments/${reversal.id}/actions/approve`,
        "final-invoice-credit-reversal-approve",
      );
      const reversalPosted = await command(
        "POST",
        `/api/v1/invoice-adjustments/${reversal.id}/actions/post`,
        "final-invoice-credit-reversal-post",
      );
      expect(reversalPosted.json()).toMatchObject({
        outstandingBalanceCents: 42_280,
        status: "adjusted",
      });
      const replacementCreated = await command(
        "POST",
        `/api/v1/invoices/${finalInvoice.id}/actions/replace`,
        "final-invoice-replace",
        { dueInDays: 21, reason: "Issue a corrected customer-facing invoice number" },
      );
      expect(replacementCreated.statusCode).toBe(201);
      const replacementInvoice = replacementCreated.json<InvoiceResponse>();
      expect(replacementInvoice).toMatchObject({
        invoiceType: "final",
        outstandingBalanceCents: 42_280,
        replacesInvoiceId: finalInvoice.id,
        status: "posted",
        totalCents: 42_280,
        versions: [{ status: "posted", totalCents: 42_280, versionNumber: 1 }],
      });
      expect(replacementInvoice.id).not.toBe(finalInvoice.id);
      const replacementReplay = await command(
        "POST",
        `/api/v1/invoices/${finalInvoice.id}/actions/replace`,
        "final-invoice-replace",
        { dueInDays: 21, reason: "Issue a corrected customer-facing invoice number" },
      );
      expect(replacementReplay.json()).toEqual(replacementCreated.json());
      const replacedOriginal = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices/${finalInvoice.id}`,
      });
      const replacedOriginalBody = replacedOriginal.json<InvoiceResponse>();
      expect(replacedOriginalBody).toMatchObject({
        outstandingBalanceCents: 0,
        replacedByInvoiceId: replacementInvoice.id,
        status: "replaced",
      });
      expect(replacedOriginalBody.adjustments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ adjustmentType: "replacement", status: "posted" }),
        ]),
      );
      const finalDelivery = await command(
        "POST",
        `/api/v1/invoices/${replacementInvoice.id}/deliveries`,
        "final-invoice-delivery",
        { channel: "email", destination: "canonical@example.test", status: "sent" },
      );
      expect(finalDelivery.json()).toMatchObject({ status: "sent" });

      const finalInvoiceLink = await command(
        "POST",
        `/api/v1/invoices/${replacementInvoice.id}/public-links`,
        "final-invoice-public-link",
        { expiresInDays: 14, recipient: "canonical@example.test" },
      );
      expect(finalInvoiceLink.statusCode).toBe(201);
      const finalInvoiceLinkBody = finalInvoiceLink.json<{
        customerPath: string;
        linkId: string;
        token: string;
      }>();
      expect(finalInvoiceLinkBody.customerPath).toBe(
        `/customer/invoices/${finalInvoiceLinkBody.token}`,
      );
      const publicFinalInvoice = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/invoices/${finalInvoiceLinkBody.token}`,
      });
      expect(publicFinalInvoice.statusCode).toBe(200);
      const publicFinalInvoiceBody = publicFinalInvoice.json<{
        projectNumber: string | null;
      }>();
      expect(publicFinalInvoiceBody).toMatchObject({
        appliedCents: 0,
        customerName: "Canonical Customer",
        invoiceType: "final",
        outstandingBalanceCents: 42_280,
        status: "viewed",
        totalCents: 42_280,
      });
      expect(typeof publicFinalInvoiceBody.projectNumber).toBe("string");
      expect(JSON.stringify(publicFinalInvoiceBody)).not.toContain("Customer should not");

      const revokedFinalInvoiceLink = await command(
        "POST",
        `/api/v1/invoices/${replacementInvoice.id}/public-links/${finalInvoiceLinkBody.linkId}/actions/revoke`,
        "final-invoice-public-link-revoke",
      );
      expect(revokedFinalInvoiceLink.statusCode).toBe(200);
      const revokedPublicFinalInvoice = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/invoices/${finalInvoiceLinkBody.token}`,
      });
      expect(revokedPublicFinalInvoice.statusCode).toBe(410);
      expect(revokedPublicFinalInvoice.json()).toMatchObject({
        error: { code: "INVOICE_LINK_REVOKED" },
      });

      const replacementCreditCreated = await command(
        "POST",
        `/api/v1/invoices/${replacementInvoice.id}/adjustments`,
        "replacement-credit-create",
        {
          adjustmentType: "credit",
          amountCents: 280,
          reason: "Honor the approved material variance credit",
        },
      );
      const replacementCredit = required(
        replacementCreditCreated
          .json<InvoiceResponse>()
          .adjustments.find(
            (adjustment) =>
              adjustment.adjustmentType === "credit" && adjustment.amountCents === 280,
          ),
        "Replacement Invoice credit",
      );
      await command(
        "POST",
        `/api/v1/invoice-adjustments/${replacementCredit.id}/actions/approve`,
        "replacement-credit-approve",
      );
      const replacementCreditPosted = await command(
        "POST",
        `/api/v1/invoice-adjustments/${replacementCredit.id}/actions/post`,
        "replacement-credit-post",
      );
      expect(replacementCreditPosted.json()).toMatchObject({
        outstandingBalanceCents: 42_000,
        status: "adjusted",
      });

      const depositApplicationCreated = await command(
        "POST",
        `/api/v1/deposit-balances/${advanceDepositBalance.id}/applications`,
        "advance-deposit-apply",
        { amountCents: 18_500, invoiceId: replacementInvoice.id },
      );
      expect(depositApplicationCreated.statusCode).toBe(201);
      const appliedDeposit = depositApplicationCreated.json<DepositBalanceResponse>();
      expect(appliedDeposit).toMatchObject({
        appliedCents: 18_500,
        availableCents: 0,
        status: "fully_applied",
      });
      const depositApplication = required(
        appliedDeposit.applications.find((entry) => entry.entryKind === "application"),
        "Advance Deposit Application",
      );
      const duplicateDepositApplication = await command(
        "POST",
        `/api/v1/deposit-balances/${advanceDepositBalance.id}/applications`,
        "advance-deposit-apply-duplicate",
        { amountCents: 18_500, invoiceId: replacementInvoice.id },
      );
      expect(duplicateDepositApplication.statusCode).toBe(409);
      expect(duplicateDepositApplication.json()).toMatchObject({
        error: { code: "DEPOSIT_NOT_AVAILABLE" },
      });
      const depositApplicationReversed = await command(
        "POST",
        `/api/v1/deposit-applications/${depositApplication.id}/actions/reverse`,
        "advance-deposit-reverse",
        { reason: "Exercise attributable deposit correction before final application" },
      );
      expect(depositApplicationReversed.json()).toMatchObject({
        appliedCents: 0,
        availableCents: 18_500,
        status: "available",
      });
      const depositReversalReplay = await command(
        "POST",
        `/api/v1/deposit-applications/${depositApplication.id}/actions/reverse`,
        "advance-deposit-reverse",
        { reason: "Exercise attributable deposit correction before final application" },
      );
      expect(depositReversalReplay.json()).toEqual(depositApplicationReversed.json());
      const depositReapplied = await command(
        "POST",
        `/api/v1/deposit-balances/${advanceDepositBalance.id}/applications`,
        "advance-deposit-reapply",
        { amountCents: 18_500, invoiceId: replacementInvoice.id },
      );
      expect(depositReapplied.json()).toMatchObject({
        appliedCents: 18_500,
        availableCents: 0,
        status: "fully_applied",
      });
      const afterDepositInvoice = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices/${replacementInvoice.id}`,
      });
      expect(afterDepositInvoice.json()).toMatchObject({
        outstandingBalanceCents: 23_500,
        status: "partially_paid",
      });

      const finalPaymentCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/payments`,
        "final-payment-create",
        {
          amountCents: 23_500,
          payerEmail: "canonical@example.test",
          payerName: "Casey Customer",
          paymentMethod: "zelle",
          providerName: "Zelle",
          providerTransactionId: "canonical-final-payment-001",
          receivingAccountReference: "Lincoln DG operating account",
        },
      );
      const finalPayment = finalPaymentCreated.json<PaymentResponse>();
      await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/actions/verify`,
        "final-payment-verify",
      );
      await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/actions/settle`,
        "final-payment-settle",
      );
      const finalAllocationCreated = await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/allocations`,
        "final-payment-allocate",
        { amountCents: 23_000, invoiceId: replacementInvoice.id },
      );
      const partiallyAllocatedFinalPayment = finalAllocationCreated.json<PaymentResponse>();
      expect(partiallyAllocatedFinalPayment).toMatchObject({
        allocatedCents: 23_000,
        availableCents: 500,
        status: "partially_allocated",
      });
      const finalPaymentAllocation = required(
        partiallyAllocatedFinalPayment.allocations.find(
          (entry) => entry.entryKind === "application",
        ),
        "Final Payment Allocation",
      );
      const overpaymentCreditCreated = await command(
        "POST",
        `/api/v1/customers/${finalPayment.customerAccountId}/customer-credits`,
        "overpayment-credit-create",
        {
          description: "Hold the final payment remainder for the open Invoice",
          sourceId: finalPayment.id,
          sourceType: "overpayment",
        },
      );
      expect(overpaymentCreditCreated.statusCode).toBe(201);
      const overpaymentCredit = overpaymentCreditCreated.json<CustomerCreditResponse>();
      expect(overpaymentCredit).toMatchObject({
        appliedCents: 0,
        availableCents: 500,
        originalAmountCents: 500,
        sourceType: "overpayment",
        status: "available",
      });
      const overpaymentCreditReplay = await command(
        "POST",
        `/api/v1/customers/${finalPayment.customerAccountId}/customer-credits`,
        "overpayment-credit-create",
        {
          description: "Hold the final payment remainder for the open Invoice",
          sourceId: finalPayment.id,
          sourceType: "overpayment",
        },
      );
      expect(overpaymentCreditReplay.json()).toEqual(overpaymentCreditCreated.json());
      const duplicateOverpaymentCredit = await command(
        "POST",
        `/api/v1/customers/${finalPayment.customerAccountId}/customer-credits`,
        "overpayment-credit-create-duplicate",
        {
          description: "Attempt to issue the same source value twice",
          sourceId: finalPayment.id,
          sourceType: "overpayment",
        },
      );
      expect(duplicateOverpaymentCredit.statusCode).toBe(409);
      expect(duplicateOverpaymentCredit.json()).toMatchObject({
        error: { code: "CUSTOMER_CREDIT_SOURCE_ALREADY_USED" },
      });
      const finalPaymentRead = await fastify.inject({
        method: "GET",
        url: `/api/v1/payments/${finalPayment.id}`,
      });
      expect(finalPaymentRead.json()).toMatchObject({
        availableCents: 0,
        customerCreditCents: 500,
        status: "fully_allocated",
      });
      const overAppliedCredit = await command(
        "POST",
        `/api/v1/customer-credits/${overpaymentCredit.id}/applications`,
        "overpayment-credit-overapply",
        { amountCents: 501, invoiceId: replacementInvoice.id },
      );
      expect(overAppliedCredit.statusCode).toBe(409);
      expect(overAppliedCredit.json()).toMatchObject({
        error: { code: "CUSTOMER_CREDIT_APPLICATION_EXCEEDS_AVAILABLE" },
      });
      const creditApplicationCreated = await command(
        "POST",
        `/api/v1/customer-credits/${overpaymentCredit.id}/applications`,
        "overpayment-credit-apply",
        { amountCents: 500, invoiceId: replacementInvoice.id },
      );
      const appliedCredit = creditApplicationCreated.json<CustomerCreditResponse>();
      expect(appliedCredit).toMatchObject({
        appliedCents: 500,
        availableCents: 0,
        status: "fully_applied",
      });
      const creditApplication = required(
        appliedCredit.applications.find((entry) => entry.entryKind === "application"),
        "Customer Credit Application",
      );
      const paidByCustomerValue = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices/${replacementInvoice.id}`,
      });
      expect(paidByCustomerValue.json()).toMatchObject({
        outstandingBalanceCents: 0,
        status: "paid",
      });

      const finalAllocationReversed = await command(
        "POST",
        `/api/v1/payment-allocations/${finalPaymentAllocation.id}/actions/reverse`,
        "final-payment-allocation-reverse",
        { reason: "Correct the selected Payment Allocation" },
      );
      expect(finalAllocationReversed.json()).toMatchObject({
        allocatedCents: 0,
        availableCents: 23_000,
        customerCreditCents: 500,
        status: "partially_allocated",
      });
      const finalAllocationReversalReplay = await command(
        "POST",
        `/api/v1/payment-allocations/${finalPaymentAllocation.id}/actions/reverse`,
        "final-payment-allocation-reverse",
        { reason: "Correct the selected Payment Allocation" },
      );
      expect(finalAllocationReversalReplay.json()).toEqual(finalAllocationReversed.json());
      const finalPaymentReallocated = await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/allocations`,
        "final-payment-reallocate",
        { amountCents: 23_000, invoiceId: replacementInvoice.id },
      );
      expect(finalPaymentReallocated.json()).toMatchObject({
        allocatedCents: 23_000,
        availableCents: 0,
        status: "fully_allocated",
      });

      const creditApplicationReversed = await command(
        "POST",
        `/api/v1/customer-credit-applications/${creditApplication.id}/actions/reverse`,
        "overpayment-credit-reverse",
        { reason: "Correct the selected Customer Credit Application" },
      );
      expect(creditApplicationReversed.json()).toMatchObject({
        appliedCents: 0,
        availableCents: 500,
        status: "available",
      });
      const creditApplicationReversalReplay = await command(
        "POST",
        `/api/v1/customer-credit-applications/${creditApplication.id}/actions/reverse`,
        "overpayment-credit-reverse",
        { reason: "Correct the selected Customer Credit Application" },
      );
      expect(creditApplicationReversalReplay.json()).toEqual(creditApplicationReversed.json());
      const creditReapplied = await command(
        "POST",
        `/api/v1/customer-credits/${overpaymentCredit.id}/applications`,
        "overpayment-credit-reapply",
        { amountCents: 500, invoiceId: replacementInvoice.id },
      );
      expect(creditReapplied.json()).toMatchObject({
        appliedCents: 500,
        availableCents: 0,
        status: "fully_applied",
      });

      const overCreditCreated = await command(
        "POST",
        `/api/v1/invoices/${replacementInvoice.id}/adjustments`,
        "paid-invoice-overcredit-create",
        {
          adjustmentType: "credit",
          amountCents: 100,
          reason: "Create customer value from a post-payment correction",
        },
      );
      const overCreditAdjustment = required(
        overCreditCreated
          .json<InvoiceResponse>()
          .adjustments.find((adjustment) => adjustment.amountCents === 100),
        "Paid Invoice over-credit Adjustment",
      );
      await command(
        "POST",
        `/api/v1/invoice-adjustments/${overCreditAdjustment.id}/actions/approve`,
        "paid-invoice-overcredit-approve",
      );
      const overCreditPosted = await command(
        "POST",
        `/api/v1/invoice-adjustments/${overCreditAdjustment.id}/actions/post`,
        "paid-invoice-overcredit-post",
      );
      expect(overCreditPosted.json()).toMatchObject({
        outstandingBalanceCents: 0,
        status: "credited",
      });
      const customerCreditsAfterAdjustment = await fastify.inject({
        method: "GET",
        url: `/api/v1/customers/${finalPayment.customerAccountId}/customer-credits`,
      });
      const adjustmentCredit = required(
        customerCreditsAfterAdjustment
          .json<{ items: CustomerCreditResponse[] }>()
          .items.find((credit) => credit.sourceType === "adjustment"),
        "Adjustment Customer Credit",
      );
      expect(adjustmentCredit).toMatchObject({
        availableCents: 100,
        originalAmountCents: 100,
        status: "available",
      });
      const overCreditReversalCreated = await command(
        "POST",
        `/api/v1/invoice-adjustments/${overCreditAdjustment.id}/actions/reverse`,
        "paid-invoice-overcredit-reverse",
        { reason: "Withdraw the post-payment correction before the credit is used" },
      );
      const overCreditReversal = required(
        overCreditReversalCreated
          .json<InvoiceResponse>()
          .adjustments.find(
            (adjustment) => adjustment.reversesInvoiceAdjustmentId === overCreditAdjustment.id,
          ),
        "Over-credit Adjustment reversal",
      );
      await command(
        "POST",
        `/api/v1/invoice-adjustments/${overCreditReversal.id}/actions/approve`,
        "paid-invoice-overcredit-reversal-approve",
      );
      const overCreditReversalPosted = await command(
        "POST",
        `/api/v1/invoice-adjustments/${overCreditReversal.id}/actions/post`,
        "paid-invoice-overcredit-reversal-post",
      );
      expect(overCreditReversalPosted.json()).toMatchObject({
        outstandingBalanceCents: 0,
        status: "paid",
      });
      const customerCreditsAfterReversal = await fastify.inject({
        method: "GET",
        url: `/api/v1/customers/${finalPayment.customerAccountId}/customer-credits`,
      });
      expect(
        customerCreditsAfterReversal
          .json<{ items: CustomerCreditResponse[] }>()
          .items.find((credit) => credit.id === adjustmentCredit.id),
      ).toMatchObject({ availableCents: 0, status: "reversed" });

      const invoiceList = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices?projectId=${acceptedBody.project.id}`,
      });
      expect(invoiceList.statusCode).toBe(200);
      expect(invoiceList.json<{ items: InvoiceResponse[] }>().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ invoiceType: "deposit", totalCents: 18_500 }),
          expect.objectContaining({ invoiceType: "final", totalCents: 42_280 }),
        ]),
      );
      const directJobFinancialCompletion = await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/complete-financially`,
        "job-complete-financial-directly",
        {},
      );
      expect(directJobFinancialCompletion.statusCode).toBe(409);
      expect(directJobFinancialCompletion.json()).toMatchObject({
        error: { code: "JOB_FINANCIAL_COMPLETION_IS_DERIVED" },
      });
      const directProjectFinancialCompletion = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/complete-financially`,
        "project-complete-financial-directly",
        {},
      );
      expect(directProjectFinancialCompletion.statusCode).toBe(409);
      expect(directProjectFinancialCompletion.json()).toMatchObject({
        error: { code: "PROJECT_FINANCIAL_COMPLETION_IS_DERIVED" },
      });
      const financialCompletion = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/evaluate-financial-completion`,
        "project-financial-completion-evaluate",
        {},
      );
      expect(financialCompletion.statusCode).toBe(200);
      expect(financialCompletion.json<FinancialCompletionResponse>()).toMatchObject({
        activeRefundCount: 0,
        blockers: [],
        financiallyComplete: true,
        jobs: [
          expect.objectContaining({
            financiallyComplete: true,
            jobId,
            status: "financially_complete",
          }),
        ],
        outstandingInvoiceCents: 0,
        projectStatus: "financially_complete",
        unresolvedCustomerCreditCents: 0,
        unresolvedDepositCents: 0,
        unresolvedPaymentCents: 0,
      });
      const completionReplay = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/evaluate-financial-completion`,
        "project-financial-completion-evaluate",
        {},
      );
      expect(completionReplay.json()).toEqual(financialCompletion.json());

      const closed = await command("POST", `/api/v1/jobs/${jobId}/actions/close`, "job-close", {});
      expect(closed.statusCode).toBe(200);
      expect(closed.json()).toMatchObject({ status: "closed" });
      const lockedStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "job-route-after-close",
        { label: "Late stop", locationSnapshot: {}, sequence: 6, stopType: "other" },
      );
      expect(lockedStop.statusCode).toBe(409);

      const refundPaymentCreated = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/payments`,
        "refund-payment-create",
        {
          amountCents: 100,
          payerEmail: "canonical@example.test",
          payerName: "Casey Customer",
          paymentMethod: "zelle",
          providerName: "Zelle",
          providerTransactionId: "canonical-refund-payment-001",
          receivingAccountReference: "Lincoln DG operating account",
        },
      );
      const refundPayment = refundPaymentCreated.json<PaymentResponse>();
      await command(
        "POST",
        `/api/v1/payments/${refundPayment.id}/actions/verify`,
        "refund-payment-verify",
      );
      await command(
        "POST",
        `/api/v1/payments/${refundPayment.id}/actions/settle`,
        "refund-payment-settle",
      );
      const alternateRefundCreated = await command(
        "POST",
        `/api/v1/customers/${refundPayment.customerAccountId}/refunds`,
        "alternate-refund-create",
        {
          alternateMethodReason: "Customer requested a company check after closing Zelle",
          amountCents: 100,
          payeeEmail: "canonical@example.test",
          payeeName: "Casey Customer",
          reason: "Return the duplicate receipt",
          refundMethod: "check",
          sourceId: refundPayment.id,
          sourceType: "payment",
        },
      );
      expect(alternateRefundCreated.statusCode).toBe(201);
      const alternateRefund = alternateRefundCreated.json<RefundResponse>();
      expect(alternateRefund).toMatchObject({ amountCents: 100, status: "review_required" });
      const unverifiedAlternateApproval = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/approve`,
        "alternate-refund-approve-unverified",
        {},
      );
      expect(unverifiedAlternateApproval.statusCode).toBe(400);
      expect(unverifiedAlternateApproval.json()).toMatchObject({
        error: { code: "REFUND_IDENTITY_VERIFICATION_REQUIRED" },
      });
      const alternateRefundApproved = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/approve`,
        "alternate-refund-approve",
        { identityVerificationReference: "verified-customer-contact-001" },
      );
      expect(alternateRefundApproved.json()).toMatchObject({ status: "approved" });
      const alternateRefundProcessed = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/process`,
        "alternate-refund-process",
        { providerName: "Company Check", providerRefundId: "CHECK-REF-001" },
      );
      expect(alternateRefundProcessed.json()).toMatchObject({ status: "processed" });
      const alternateRefundSettled = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/settle`,
        "alternate-refund-settle",
        {},
      );
      expect(alternateRefundSettled.json()).toMatchObject({ status: "settled" });
      const alternateRefundSettlementReplay = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/settle`,
        "alternate-refund-settle",
        {},
      );
      expect(alternateRefundSettlementReplay.json()).toEqual(alternateRefundSettled.json());
      const refundedPaymentRead = await fastify.inject({
        method: "GET",
        url: `/api/v1/payments/${refundPayment.id}`,
      });
      expect(refundedPaymentRead.json()).toMatchObject({
        availableCents: 0,
        refundedCents: 100,
        status: "refunded",
      });

      const refundReversed = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/reverse`,
        "alternate-refund-reverse",
        { reason: "Provider returned the company check before delivery" },
      );
      expect(refundReversed.statusCode).toBe(201);
      expect(refundReversed.json<RefundResponse>()).toMatchObject({
        amountCents: 100,
        reversesRefundId: alternateRefund.id,
        status: "reversed",
      });
      const refundReversalReplay = await command(
        "POST",
        `/api/v1/refunds/${alternateRefund.id}/actions/reverse`,
        "alternate-refund-reverse",
        { reason: "Provider returned the company check before delivery" },
      );
      expect(refundReversalReplay.json()).toEqual(refundReversed.json());
      const restoredRefundPayment = await fastify.inject({
        method: "GET",
        url: `/api/v1/payments/${refundPayment.id}`,
      });
      expect(restoredRefundPayment.json()).toMatchObject({
        availableCents: 100,
        refundedCents: 0,
        status: "settled",
      });
      const replacementRefundCreated = await command(
        "POST",
        `/api/v1/customers/${refundPayment.customerAccountId}/refunds`,
        "replacement-refund-create",
        {
          amountCents: 100,
          payeeEmail: "canonical@example.test",
          payeeName: "Casey Customer",
          reason: "Reissue the returned refund to the original method",
          refundMethod: "zelle",
          sourceId: refundPayment.id,
          sourceType: "payment",
        },
      );
      const replacementRefund = replacementRefundCreated.json<RefundResponse>();
      expect(replacementRefund).toMatchObject({ status: "pending_approval" });
      await command(
        "POST",
        `/api/v1/refunds/${replacementRefund.id}/actions/approve`,
        "replacement-refund-approve",
        {},
      );
      await command(
        "POST",
        `/api/v1/refunds/${replacementRefund.id}/actions/process`,
        "replacement-refund-process",
        { providerName: "Zelle", providerRefundId: "ZELLE-REF-001" },
      );
      await command(
        "POST",
        `/api/v1/refunds/${replacementRefund.id}/actions/settle`,
        "replacement-refund-settle",
        {},
      );
      const completedAfterRefund = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/evaluate-financial-completion`,
        "project-financial-completion-after-refund",
        {},
      );
      expect(completedAfterRefund.json<FinancialCompletionResponse>()).toMatchObject({
        blockers: [],
        financiallyComplete: true,
        projectStatus: "financially_complete",
      });

      const wholeFinalPaymentReversed = await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/actions/reverse`,
        "final-payment-whole-reverse",
        { reason: "Bank reported the final customer receipt reversed" },
      );
      expect(wholeFinalPaymentReversed.json()).toMatchObject({
        allocatedCents: 0,
        availableCents: 0,
        customerCreditCents: 0,
        status: "reversed",
      });
      const wholeFinalPaymentReversalReplay = await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/actions/reverse`,
        "final-payment-whole-reverse",
        { reason: "Bank reported the final customer receipt reversed" },
      );
      expect(wholeFinalPaymentReversalReplay.json()).toEqual(wholeFinalPaymentReversed.json());
      const duplicateWholeFinalPaymentReversal = await command(
        "POST",
        `/api/v1/payments/${finalPayment.id}/actions/reverse`,
        "final-payment-whole-reverse-duplicate",
        { reason: "Attempt a second whole Payment reversal" },
      );
      expect(duplicateWholeFinalPaymentReversal.statusCode).toBe(409);
      expect(duplicateWholeFinalPaymentReversal.json()).toMatchObject({
        error: { code: "PAYMENT_NOT_REVERSIBLE" },
      });
      const jobReopenedByPayment = await fastify.inject({
        method: "GET",
        url: `/api/v1/jobs/${jobId}`,
      });
      expect(jobReopenedByPayment.json()).toMatchObject({ status: "planning" });
      const projectReopenedByPayment = await fastify.inject({
        method: "GET",
        url: `/api/v1/projects/${acceptedBody.project.id}`,
      });
      expect(projectReopenedByPayment.json()).toMatchObject({ status: "operationally_complete" });
      const invoiceReopenedByPayment = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices/${replacementInvoice.id}`,
      });
      expect(invoiceReopenedByPayment.json()).toMatchObject({
        outstandingBalanceCents: 23_500,
        status: "partially_paid",
      });

      const wholeDepositPaymentReversed = await command(
        "POST",
        `/api/v1/payments/${depositPayment.id}/actions/reverse`,
        "deposit-payment-whole-reverse",
        { reason: "Bank reported the advance customer receipt reversed" },
      );
      expect(wholeDepositPaymentReversed.json()).toMatchObject({
        allocatedCents: 0,
        availableCents: 0,
        status: "reversed",
      });
      const resolvedDepositRead = await fastify.inject({
        method: "GET",
        url: `/api/v1/projects/${acceptedBody.project.id}/deposit-balances`,
      });
      expect(
        resolvedDepositRead
          .json<{ items: DepositBalanceResponse[] }>()
          .items.find((balance) => balance.id === advanceDepositBalance.id),
      ).toMatchObject({ appliedCents: 0, availableCents: 0, status: "resolved" });
      const fullyReopenedInvoice = await fastify.inject({
        method: "GET",
        url: `/api/v1/invoices/${replacementInvoice.id}`,
      });
      expect(fullyReopenedInvoice.json()).toMatchObject({
        outstandingBalanceCents: 42_000,
        status: "adjusted",
      });
      const reopenedFinancialCompletion = await command(
        "POST",
        `/api/v1/projects/${acceptedBody.project.id}/actions/evaluate-financial-completion`,
        "project-financial-completion-reopened",
        {},
      );
      expect(reopenedFinancialCompletion.json<FinancialCompletionResponse>()).toMatchObject({
        financiallyComplete: false,
        outstandingInvoiceCents: 42_000,
        projectStatus: "operationally_complete",
      });

      const persisted = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
        acceptances: await transaction
          .select({ value: count() })
          .from(quoteAcceptances)
          .where(eq(quoteAcceptances.quoteVersionId, quote.id)),
        line: (
          await transaction
            .select()
            .from(quoteLineItems)
            .where(eq(quoteLineItems.quoteVersionId, quote.id))
            .limit(1)
        )[0],
        projects: await transaction
          .select({ value: count() })
          .from(projects)
          .where(eq(projects.acceptedQuoteVersionId, quote.id)),
        jobs: await transaction
          .select({ value: count() })
          .from(jobs)
          .where(eq(jobs.projectId, acceptedBody.project.id)),
        materialDeliveryDetails: await transaction
          .select({ value: count() })
          .from(materialDeliveryDetails)
          .where(eq(materialDeliveryDetails.jobId, jobId)),
        materialLoadValidations: await transaction
          .select({ value: count() })
          .from(materialLoadValidations)
          .where(eq(materialLoadValidations.materialLoadId, loadId)),
        materialLoads: await transaction
          .select({ value: count() })
          .from(materialLoads)
          .where(eq(materialLoads.jobId, jobId)),
        materialLoadItems: await transaction
          .select({ value: count() })
          .from(materialLoadItems)
          .where(eq(materialLoadItems.jobId, jobId)),
        materialQuantityVariances: await transaction
          .select({ value: count() })
          .from(materialQuantityVariances)
          .where(eq(materialQuantityVariances.jobId, jobId)),
        expenses: await transaction
          .select({ value: count() })
          .from(expenses)
          .where(eq(expenses.jobId, jobId)),
        expenseAllocations: await transaction
          .select({ value: count() })
          .from(expenseAllocations)
          .where(eq(expenseAllocations.jobId, jobId)),
        customerCreditApplications: await transaction
          .select({ value: count() })
          .from(customerCreditApplications),
        customerCredits: await transaction.select({ value: count() }).from(customerCredits),
        depositApplications: await transaction.select({ value: count() }).from(depositApplications),
        depositBalances: await transaction.select({ value: count() }).from(depositBalances),
        invoiceDeliveries: await transaction.select({ value: count() }).from(invoiceDeliveries),
        invoiceAdjustments: await transaction.select({ value: count() }).from(invoiceAdjustments),
        invoiceLineItems: await transaction.select({ value: count() }).from(invoiceLineItems),
        invoicePublicLinks: await transaction.select({ value: count() }).from(invoicePublicLinks),
        invoices: await transaction.select({ value: count() }).from(invoices),
        invoiceVersions: await transaction.select({ value: count() }).from(invoiceVersions),
        paymentAllocations: await transaction.select({ value: count() }).from(paymentAllocations),
        payments: await transaction.select({ value: count() }).from(payments),
        refunds: await transaction.select({ value: count() }).from(refunds),
        jobCharges: await transaction
          .select({ value: count() })
          .from(jobCharges)
          .where(eq(jobCharges.jobId, jobId)),
        documentLinks: await transaction
          .select({ value: count() })
          .from(documentLinks)
          .where(eq(documentLinks.entityType, "MaterialLoadItem")),
      }));
      expect(persisted.acceptances[0]?.value).toBe(1);
      expect(persisted.projects[0]?.value).toBe(1);
      expect(persisted.jobs[0]?.value).toBe(1);
      expect(persisted.materialDeliveryDetails[0]?.value).toBe(1);
      expect(persisted.materialLoadValidations[0]?.value).toBe(4);
      expect(persisted.materialLoads[0]?.value).toBe(1);
      expect(persisted.materialLoadItems[0]?.value).toBe(2);
      expect(persisted.materialQuantityVariances[0]?.value).toBe(1);
      expect(persisted.expenses[0]?.value).toBe(2);
      expect(persisted.expenseAllocations[0]?.value).toBe(2);
      expect(persisted.customerCreditApplications[0]?.value).toBe(4);
      expect(persisted.customerCredits[0]?.value).toBe(2);
      expect(persisted.depositApplications[0]?.value).toBe(4);
      expect(persisted.depositBalances[0]?.value).toBe(1);
      expect(persisted.invoiceDeliveries[0]?.value).toBe(3);
      expect(persisted.invoiceLineItems[0]?.value).toBeGreaterThanOrEqual(3);
      expect(persisted.invoicePublicLinks[0]?.value).toBe(1);
      expect(persisted.invoiceAdjustments[0]?.value).toBe(7);
      expect(persisted.invoices[0]?.value).toBe(4);
      expect(persisted.invoiceVersions[0]?.value).toBe(5);
      expect(persisted.paymentAllocations[0]?.value).toBe(6);
      expect(persisted.payments[0]?.value).toBe(3);
      expect(persisted.refunds[0]?.value).toBe(3);
      expect(persisted.jobCharges[0]?.value).toBe(1);
      expect(persisted.documentLinks[0]?.value).toBe(6);
      expect(persisted.line).toBeDefined();
      const foreignJobs = await withTenantTransaction(runtime(), foreignTenantId, (transaction) =>
        transaction.select().from(jobs),
      );
      expect(foreignJobs).toEqual([]);
      const foreignMaterialDelivery = await withTenantTransaction(
        runtime(),
        foreignTenantId,
        (transaction) => transaction.select().from(materialDeliveryDetails),
      );
      expect(foreignMaterialDelivery).toEqual([]);
      const foreignFinancialRecords = await withTenantTransaction(
        runtime(),
        foreignTenantId,
        async (transaction) => ({
          customerCredits: await transaction.select().from(customerCredits),
          depositBalances: await transaction.select().from(depositBalances),
          invoicePublicLinks: await transaction.select().from(invoicePublicLinks),
          payments: await transaction.select().from(payments),
          refunds: await transaction.select().from(refunds),
        }),
      );
      expect(foreignFinancialRecords).toEqual({
        customerCredits: [],
        depositBalances: [],
        invoicePublicLinks: [],
        payments: [],
        refunds: [],
      });
      await expect(
        withTenantTransaction(runtime(), tenantId, (transaction) =>
          transaction
            .update(quoteLineItems)
            .set({ description: "Changed after acceptance" })
            .where(eq(quoteLineItems.id, required(persisted.line, "Quote line").id)),
        ),
      ).rejects.toThrow();

      const foreignVisible = await withTenantTransaction(
        runtime(),
        foreignTenantId,
        (transaction) => transaction.select().from(quoteAcceptances),
      );
      expect(foreignVisible).toEqual([]);
    });

    it("supersedes sent versions, rejects old acceptance, and preserves a declined terminal response", async () => {
      const leadId = await createEstimatingLead("revision", "Revision Customer");
      const estimate = await createEstimate(leadId, "revision");
      await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/submit`,
        "revision-estimate-submit",
      );
      await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/approve`,
        "revision-estimate-approve",
      );
      const quote = (
        await command(
          "POST",
          `/api/v1/estimate-versions/${estimate.id}/actions/create-quote`,
          "revision-quote-create",
        )
      ).json<QuoteResponse>();
      await command(
        "POST",
        `/api/v1/quote-versions/${quote.id}/actions/approve`,
        "revision-quote-approve",
      );
      const oldSend = (
        await command(
          "POST",
          `/api/v1/quote-versions/${quote.id}/actions/send`,
          "revision-quote-send",
          { channel: "link", expiresInDays: 10, recipient: "Revision customer" },
        )
      ).json<{ token: string }>();
      const revised = await command(
        "POST",
        `/api/v1/quotes/${quote.quoteId}/actions/revise`,
        "revision-quote-revise",
      );
      expect(revised.statusCode).toBe(201);
      const second = revised.json<QuoteResponse>();
      expect(second).toMatchObject({ status: "draft", versionNumber: 2 });

      const oldView = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/quotes/${oldSend.token}`,
      });
      expect(oldView.statusCode).toBe(410);
      expect(oldView.json()).toMatchObject({ error: { code: "QUOTE_SUPERSEDED" } });
      const oldAccept = await fastify.inject({
        method: "POST",
        payload: {
          acceptedName: "Old Customer",
          consentText: "I accept the superseded commercial Quote.",
          contentHash: quote.contentHash,
        },
        url: `/api/v1/public/quotes/${oldSend.token}/actions/accept`,
      });
      expect(oldAccept.statusCode).toBe(409);

      await command(
        "POST",
        `/api/v1/quote-versions/${second.id}/actions/approve`,
        "revision-second-approve",
      );
      const newSend = (
        await command(
          "POST",
          `/api/v1/quote-versions/${second.id}/actions/send`,
          "revision-second-send",
          { channel: "link", expiresInDays: 10, recipient: "Revision customer" },
        )
      ).json<{ token: string }>();
      const declined = await fastify.inject({
        method: "POST",
        payload: { reason: "Schedule no longer works" },
        url: `/api/v1/public/quotes/${newSend.token}/actions/decline`,
      });
      expect(declined.statusCode).toBe(200);
      expect(declined.json()).toMatchObject({ status: "declined" });
      const terminalAccept = await fastify.inject({
        method: "POST",
        payload: {
          acceptedName: "Late Customer",
          consentText: "I accept after declining the Quote.",
          contentHash: second.contentHash,
        },
        url: `/api/v1/public/quotes/${newSend.token}/actions/accept`,
      });
      expect(terminalAccept.statusCode).toBe(409);
      expect(terminalAccept.json()).toMatchObject({ error: { code: "QUOTE_NOT_ACCEPTABLE" } });
    });

    it("rejects acceptance after withdrawal or elapsed expiration", async () => {
      const withdrawn = await createSentQuote("withdrawal", "Withdrawal Customer");
      const withdrawal = await command(
        "POST",
        `/api/v1/quote-versions/${withdrawn.quote.id}/actions/withdraw`,
        "withdrawal-quote-withdraw",
      );
      expect(withdrawal.statusCode).toBe(200);
      expect(withdrawal.json()).toMatchObject({ status: "withdrawn" });

      const withdrawnView = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/quotes/${withdrawn.token}`,
      });
      expect(withdrawnView.statusCode).toBe(410);
      expect(withdrawnView.json()).toMatchObject({ error: { code: "QUOTE_WITHDRAWN" } });
      const withdrawnAccept = await acceptQuote(withdrawn, "Withdrawal Customer");
      expect(withdrawnAccept.statusCode).toBe(409);
      expect(withdrawnAccept.json()).toMatchObject({ error: { code: "QUOTE_WITHDRAWN" } });

      const expired = await createSentQuote("expiration", "Expiration Customer");
      await withTenantTransaction(migrator(), tenantId, (transaction) =>
        transaction
          .update(quoteVersions)
          .set({ expiresAt: new Date(Date.now() - 1_000) })
          .where(eq(quoteVersions.id, expired.quote.id)),
      );
      const expiration = await command(
        "POST",
        `/api/v1/quote-versions/${expired.quote.id}/actions/expire`,
        "expiration-quote-expire",
      );
      expect(expiration.statusCode).toBe(200);
      expect(expiration.json()).toMatchObject({ status: "expired" });

      const expiredView = await fastify.inject({
        method: "GET",
        url: `/api/v1/public/quotes/${expired.token}`,
      });
      expect(expiredView.statusCode).toBe(410);
      expect(expiredView.json()).toMatchObject({ error: { code: "QUOTE_EXPIRED" } });
      const expiredAccept = await acceptQuote(expired, "Expiration Customer");
      expect(expiredAccept.statusCode).toBe(409);
      expect(expiredAccept.json()).toMatchObject({ error: { code: "QUOTE_EXPIRED" } });
    });

    async function createSentQuote(suffix: string, displayName: string): Promise<SentQuote> {
      const leadId = await createEstimatingLead(suffix, displayName);
      const estimate = await createEstimate(leadId, suffix);
      await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/submit`,
        `${suffix}-estimate-submit`,
      );
      await command(
        "POST",
        `/api/v1/estimate-versions/${estimate.id}/actions/approve`,
        `${suffix}-estimate-approve`,
      );
      const quote = (
        await command(
          "POST",
          `/api/v1/estimate-versions/${estimate.id}/actions/create-quote`,
          `${suffix}-quote-create`,
        )
      ).json<QuoteResponse>();
      await command(
        "POST",
        `/api/v1/quote-versions/${quote.id}/actions/approve`,
        `${suffix}-quote-approve`,
      );
      const sent = (
        await command(
          "POST",
          `/api/v1/quote-versions/${quote.id}/actions/send`,
          `${suffix}-quote-send`,
          { channel: "link", expiresInDays: 10, recipient: displayName },
        )
      ).json<{ token: string }>();
      return { quote, token: sent.token };
    }

    function acceptQuote(sent: SentQuote, acceptedName: string): Promise<LightMyRequestResponse> {
      return fastify.inject({
        method: "POST",
        payload: {
          acceptedName,
          consentText: "I accept this exact Quote and its commercial terms.",
          contentHash: sent.quote.contentHash,
        },
        url: `/api/v1/public/quotes/${sent.token}/actions/accept`,
      });
    }

    async function createEstimatingLead(suffix: string, displayName: string): Promise<string> {
      const created = await command(
        "POST",
        "/api/v1/intake/leads",
        `lead-${suffix}`,
        materialLeadPayload(displayName, suffix),
      );
      expect(created.statusCode).toBe(201);
      const leadId = created.json<{ lead: { id: string } }>().lead.id;
      await command(
        "POST",
        `/api/v1/leads/${leadId}/actions/start-contacting`,
        `lead-${suffix}-contacting`,
      );
      await command("POST", `/api/v1/leads/${leadId}/actions/qualify`, `lead-${suffix}-qualify`);
      await command(
        "POST",
        `/api/v1/leads/${leadId}/actions/start-estimating`,
        `lead-${suffix}-estimating`,
      );
      return leadId;
    }

    async function createEstimate(leadId: string, suffix: string): Promise<EstimateResponse> {
      const response = await command(
        "POST",
        `/api/v1/leads/${leadId}/estimate-versions`,
        `estimate-${suffix}`,
        {
          materialDelivery: {
            additionalSupplierStops: 1,
            deliveryZoneId: pricing.deliveryZone.id,
            items: [
              {
                quantity: "1.000",
                supplierCostVersionId: required(pricing.supplierCosts[0], "Supplier cost").id,
              },
            ],
            separatePlacements: 1,
          },
          operationalAssessment: "Standard driveway access",
          pricingVersionId: required(pricing.policy.versions[0], "Pricing Version").id,
          riskAssessment: "No unusual risk identified",
        },
      );
      expect(response.statusCode).toBe(201);
      return response.json<EstimateResponse>();
    }

    function command(
      method: "POST",
      url: string,
      idempotencyKey: string,
      payload?: Record<string, unknown>,
    ): Promise<LightMyRequestResponse> {
      return fastify.inject({
        headers: { "idempotency-key": idempotencyKey },
        method,
        ...(payload === undefined ? {} : { payload }),
        url,
      });
    }
  },
);

function canonicalPricing() {
  return {
    materialDelivery: {
      additionalSupplierStopCents: 2_500,
      deliveryZone: { baseFeeCents: 12_500, code: "LINCOLN", name: "Lincoln metro" },
      depositMinimumCents: 15_000,
      depositRoundUpToCents: 500,
      markupBasisPoints: 2_500,
      materials: [
        {
          materialName: "Canonical limestone",
          supplierLocationName: "Main yard",
          supplierName: "Canonical Supplier",
          unit: "tons",
          unitCostCents: 18_400,
        },
      ],
      separatePlacementCents: 4_000,
    },
    policyName: "Canonical material pricing",
    serviceType: "material_delivery",
  };
}

function materialLeadPayload(displayName: string, suffix: string) {
  return {
    customer: { customerType: "individual", displayName, preferredContactMethod: "email" },
    materialDelivery: {
      deliveryInstructions: "Place beside the garage.",
      estimatedQuantity: "1.000",
      materialDescription: "Canonical limestone",
      quantityUnit: "tons",
    },
    primaryContact: {
      email: `${suffix}@example.test`,
      firstName: "Casey",
      lastName: "Customer",
      phone: "402-555-0177",
      preferredContactMethod: "email",
    },
    serviceLocation: {
      addressLine1: `${suffix.length.toString()} Test Road`,
      city: "Lincoln",
      label: "Residence",
      postalCode: "68523",
      region: "NE",
    },
    serviceType: "material_delivery",
    source: "phone",
    summary: "One ton canonical material delivery",
  };
}

async function seedTenant(
  database: Database,
  tenantId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction
      .insert(organizations)
      .values({ id: tenantId, displayName, legalName: displayName });
    await transaction.insert(users).values({
      displayName: `${displayName} User`,
      email: `${userId}@example.test`,
      id: userId,
      tenantId,
    });
  });
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for commercial integration tests`);
  return value;
}

function connectionString(user: string, password: string, database: string): string {
  const url = new URL("postgresql://localhost");
  url.username = user;
  url.password = password;
  url.hostname = environment("POSTGRES_HOST");
  url.port = environment("POSTGRES_PORT");
  url.pathname = `/${database}`;
  return url.toString();
}

function initialized<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} was not initialized`);
  return value;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}
