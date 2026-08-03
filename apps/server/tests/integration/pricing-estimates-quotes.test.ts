import {
  contractSignatures,
  contracts,
  createDatabase,
  createDatabasePool,
  jobs,
  organizations,
  projects,
  quoteAcceptances,
  quoteLineItems,
  quoteVersions,
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

    it("accepts one immutable Quote into one Project and one conflict-safe scheduled Job", async () => {
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
            `/api/v1/jobs/${jobId}/actions/start-planning`,
            "job-planning-start",
            {},
          )
        ).json(),
      ).toMatchObject({ status: "planning" });
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

      const createdAsset = await command("POST", "/api/v1/assets", "asset-create-truck", {
        assetNumber: "TRK-100",
        assetType: "truck",
        capacityWeight: "12.500",
        name: "Canonical Truck",
      });
      expect(createdAsset.statusCode).toBe(201);
      const assetId = createdAsset.json<{ id: string }>().id;
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
      await command("POST", `/api/v1/jobs/${jobId}/actions/start`, "job-start", {});
      const routeStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "job-route-stop",
        {
          label: "Customer driveway",
          locationSnapshot: { city: "Lincoln", region: "NE" },
          sequence: 1,
          stopType: "customer",
        },
      );
      expect(routeStop.statusCode).toBe(201);
      const checklist = await command("POST", `/api/v1/jobs/${jobId}/checklists`, "job-checklist", {
        items: [{ label: "Confirm safe access" }, { label: "Capture completion evidence" }],
        name: "Delivery completion",
        templateCode: "delivery-completion-v1",
      });
      expect(checklist.statusCode).toBe(201);
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
      await command("POST", `/api/v1/jobs/${jobId}/actions/mark-invoiced`, "job-mark-invoiced", {});
      await command(
        "POST",
        `/api/v1/jobs/${jobId}/actions/complete-financially`,
        "job-complete-financial",
        {},
      );
      const closed = await command("POST", `/api/v1/jobs/${jobId}/actions/close`, "job-close", {});
      expect(closed.statusCode).toBe(200);
      expect(closed.json()).toMatchObject({ status: "closed" });
      const lockedStop = await command(
        "POST",
        `/api/v1/jobs/${jobId}/route-stops`,
        "job-route-after-close",
        { label: "Late stop", locationSnapshot: {}, sequence: 2, stopType: "other" },
      );
      expect(lockedStop.statusCode).toBe(409);
      const reopened = await command("POST", `/api/v1/jobs/${jobId}/actions/reopen`, "job-reopen", {
        reason: "Correct schedule evidence",
      });
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json()).toMatchObject({ status: "planning" });

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
      }));
      expect(persisted.acceptances[0]?.value).toBe(1);
      expect(persisted.projects[0]?.value).toBe(1);
      expect(persisted.jobs[0]?.value).toBe(1);
      expect(persisted.line).toBeDefined();
      const foreignJobs = await withTenantTransaction(runtime(), foreignTenantId, (transaction) =>
        transaction.select().from(jobs),
      );
      expect(foreignJobs).toEqual([]);
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
