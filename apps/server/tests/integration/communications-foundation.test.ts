import {
  accountContacts,
  contacts,
  createDatabase,
  createDatabasePool,
  customerAccounts,
  estimateVersions,
  estimates,
  jobs,
  leads,
  notificationDeliveries,
  notificationDeliveryAttempts,
  organizations,
  outboxEvents,
  pricingPolicies,
  pricingVersions,
  projectPublicLinks,
  projectPublicLinkViews,
  projects,
  quoteVersions,
  quotes,
  scheduledJobs,
  serviceLocations,
  runMigrations,
  users,
  withTenantTransaction,
  type Database,
  type Pool,
} from "@ldg/database";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotificationOutboxHandler } from "../../src/communications/notification-outbox.handler.js";
import { NotificationPolicyHandler } from "../../src/communications/notification-policy.handler.js";
import { CustomerCapabilityTokenService } from "../../src/communications/customer-capability-token.service.js";
import {
  CaptureNotificationProvider,
  NotificationProviderError,
  type SendNotificationInput,
  type NotificationProvider,
} from "../../src/communications/notification-provider.js";
import { NotificationReminderHandler } from "../../src/communications/notification-reminder.handler.js";
import { loadServerConfig, type ServerConfig } from "../../src/config/server-config.js";
import type { ServerConfigService } from "../../src/config/server-config.service.js";
import { createApiApplication, type ApiApplication } from "../../src/create-api-application.js";
import { loadRootEnvironment } from "../../src/environment.js";
import { OutboxHandlerRegistry } from "../../src/outbox/outbox-handler.registry.js";
import { OutboxProcessorService } from "../../src/outbox/outbox-processor.service.js";
import { ScheduledJobHandlerRegistry } from "../../src/scheduled/scheduled-job-handler.registry.js";
import { ScheduledJobProcessorService } from "../../src/scheduled/scheduled-job-processor.service.js";

loadRootEnvironment();

interface TemplateResponse {
  id: string;
  status: string;
  version: number;
}

interface QueuedResponse {
  outboxEventId: string;
  status: string;
}

describe("Sprint 1.9.0 communications foundation", { concurrent: false }, () => {
  const databaseName = `ldg_communications_test_${randomUUID().replaceAll("-", "")}`;
  const tenantId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const contactId = randomUUID();
  const projectId = randomUUID();
  const jobId = randomUUID();
  const foreignTenantId = randomUUID();
  const foreignUserId = randomUUID();
  const foreignCustomerId = randomUUID();
  const foreignContactId = randomUUID();
  let api: ApiApplication | undefined;
  let fastify: FastifyInstance;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let migrationDatabase: Database | undefined;
  let runtimeDatabase: Database | undefined;
  let databaseCreated = false;
  let baseConfig: ServerConfig;

  const admin = () => initialized(adminPool, "admin pool");
  const migrator = () => initialized(migrationDatabase, "migration database");
  const runtime = () => initialized(runtimeDatabase, "runtime database");

  beforeAll(async () => {
    adminPool = createDatabasePool(
      connectionString(
        environment("POSTGRES_ADMIN_USER"),
        environment("POSTGRES_ADMIN_PASSWORD"),
        "postgres",
      ),
    );
    await admin().query(
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
    await seedCustomer(migrator(), tenantId, userId, customerId, contactId, "Primary");
    await seedProjectFixture(migrator(), tenantId, userId, customerId, contactId, projectId, jobId);
    await seedCustomer(
      migrator(),
      foreignTenantId,
      foreignUserId,
      foreignCustomerId,
      foreignContactId,
      "Foreign",
    );

    process.env.DATABASE_URL = connectionString(
      environment("POSTGRES_RUNTIME_USER"),
      environment("POSTGRES_RUNTIME_PASSWORD"),
      databaseName,
    );
    process.env.DEVELOPMENT_TENANT_ID = tenantId;
    process.env.DEVELOPMENT_USER_ID = userId;
    process.env.DEVELOPMENT_PERMISSIONS = "*";
    process.env.WORKER_TENANT_IDS = tenantId;
    baseConfig = loadServerConfig(process.env);
    api = await createApiApplication();
    fastify = api.application.getHttpAdapter().getInstance();
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

  it("publishes an immutable Template and delivers one idempotent outbox request", async () => {
    const template = await createAndPublishTemplate(
      "schedule.confirmed",
      "communications-template-1",
    );
    expect(template).toMatchObject({ status: "published", version: 1 });

    const preference = await fastify.inject({
      headers: { "idempotency-key": "communications-preference-1" },
      method: "POST",
      payload: {
        contactId,
        emailEnabled: true,
        notificationType: "schedule",
        smsEnabled: false,
      },
      url: `/api/v1/customers/${customerId}/notification-preferences`,
    });
    expect(preference.statusCode).toBe(200);

    const queue = () =>
      fastify.inject({
        headers: { "idempotency-key": "communications-queue-1" },
        method: "POST",
        payload: notificationPayload("schedule.confirmed", "schedule"),
        url: "/api/v1/notifications",
      });
    const first = await queue();
    expect(first.statusCode).toBe(201);
    const queued = first.json<QueuedResponse>();
    expect(queued.status).toBe("queued");
    expect((await queue()).json<QueuedResponse>().outboxEventId).toBe(queued.outboxEventId);

    await processOutbox(new CaptureNotificationProvider());

    const deliveries = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      attempts: await transaction.select().from(notificationDeliveryAttempts),
      deliveries: await transaction.select().from(notificationDeliveries),
    }));
    expect(deliveries.deliveries).toHaveLength(1);
    expect(deliveries.deliveries[0]).toMatchObject({
      channel: "email",
      notificationType: "schedule",
      recipient: "primary@example.test",
      status: "delivered",
    });
    expect(deliveries.deliveries[0]?.renderedBody).toContain("Primary Customer");
    expect(deliveries.attempts).toHaveLength(1);
    expect(deliveries.attempts[0]?.status).toBe("delivered");
    const foreignVisible = await withTenantTransaction(runtime(), foreignTenantId, (transaction) =>
      transaction.select().from(notificationDeliveries),
    );
    expect(foreignVisible).toHaveLength(0);

    const history = await fastify.inject({ method: "GET", url: "/api/v1/notifications" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      items: [{ attempts: [{ status: "delivered" }], status: "delivered" }],
    });
  });

  it("suppresses disabled channels without invoking a provider", async () => {
    const preference = await fastify.inject({
      headers: { "idempotency-key": "communications-preference-2" },
      method: "POST",
      payload: {
        contactId,
        emailEnabled: false,
        notificationType: "schedule",
        smsEnabled: false,
      },
      url: `/api/v1/customers/${customerId}/notification-preferences`,
    });
    expect(preference.statusCode).toBe(200);
    const queued = await fastify.inject({
      headers: { "idempotency-key": "communications-queue-2" },
      method: "POST",
      payload: notificationPayload("schedule.confirmed", "schedule"),
      url: "/api/v1/notifications",
    });
    expect(queued.statusCode).toBe(201);

    const provider = new CountingProvider();
    await processOutbox(provider);
    expect(provider.calls).toBe(0);
    const [suppressed] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(notificationDeliveries)
        .where(
          eq(
            notificationDeliveries.originOutboxEventId,
            queued.json<QueuedResponse>().outboxEventId,
          ),
        ),
    );
    expect(suppressed).toMatchObject({
      status: "suppressed",
      suppressionReason: "customer_preference",
    });
  });

  it("records provider failure and retries without duplicating the Delivery", async () => {
    await fastify.inject({
      headers: { "idempotency-key": "communications-preference-3" },
      method: "POST",
      payload: {
        contactId,
        emailEnabled: true,
        notificationType: "schedule",
        smsEnabled: false,
      },
      url: `/api/v1/customers/${customerId}/notification-preferences`,
    });
    const response = await fastify.inject({
      headers: { "idempotency-key": "communications-queue-3" },
      method: "POST",
      payload: notificationPayload("schedule.confirmed", "schedule"),
      url: "/api/v1/notifications",
    });
    const outboxEventId = response.json<QueuedResponse>().outboxEventId;
    const provider = new FailsOnceProvider();
    await processOutbox(provider);
    const failedState = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      delivery: await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.originOutboxEventId, outboxEventId)),
      event: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outboxEventId)),
    }));
    expect(failedState.delivery[0]).toMatchObject({
      lastErrorCode: "TemporaryProviderFailure",
      status: "failed",
    });
    expect(failedState.event[0]).toMatchObject({
      lastError: "NotificationProviderFailure",
      status: "pending",
    });
    expect(JSON.stringify(failedState)).not.toContain("provider-token-must-not-be-persisted");
    await withTenantTransaction(migrator(), tenantId, (transaction) =>
      transaction
        .update(outboxEvents)
        .set({ availableAt: new Date(0) })
        .where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.id, outboxEventId))),
    );
    await processOutbox(provider);

    const result = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      attempts: await transaction
        .select()
        .from(notificationDeliveryAttempts)
        .orderBy(notificationDeliveryAttempts.attemptNumber),
      deliveries: await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.originOutboxEventId, outboxEventId)),
      event: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, outboxEventId)),
    }));
    expect(provider.calls).toBe(2);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.status).toBe("delivered");
    const deliveryAttempts = result.attempts.filter(
      (attempt) => attempt.notificationDeliveryId === result.deliveries[0]?.id,
    );
    expect(deliveryAttempts.map((attempt) => attempt.status)).toEqual(["failed", "delivered"]);
    expect(new Set(deliveryAttempts.map((attempt) => attempt.providerIdempotencyKey)).size).toBe(1);
    expect(result.event[0]).toMatchObject({ lastError: null, status: "processed" });
  });

  it("rejects protected Template variables and foreign-tenant recipients", async () => {
    const protectedTemplate = await fastify.inject({
      headers: { "idempotency-key": "communications-template-protected" },
      method: "POST",
      payload: {
        allowedVariables: ["customerName", "margin"],
        bodyTemplate: "Hello {{customerName}}: {{margin}}",
        channel: "email",
        name: "Unsafe template",
        subjectTemplate: "Unsafe",
        templateKey: "unsafe.template",
      },
      url: "/api/v1/notification-templates",
    });
    expect(protectedTemplate.statusCode).toBe(422);
    expect(protectedTemplate.json()).toMatchObject({
      error: { code: "NOTIFICATION_VARIABLE_PROTECTED" },
    });

    const foreign = await fastify.inject({
      headers: { "idempotency-key": "communications-foreign" },
      method: "POST",
      payload: {
        ...notificationPayload("schedule.confirmed", "schedule"),
        contactId: foreignContactId,
        customerAccountId: foreignCustomerId,
      },
      url: "/api/v1/notifications",
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("serves a redacted Project capability and derives one notification from a business event", async () => {
    const createdLink = await fastify.inject({
      headers: { "idempotency-key": "communications-project-link" },
      method: "POST",
      payload: { expiresInSeconds: 3_600 },
      url: `/api/v1/projects/${projectId}/public-links`,
    });
    expect(createdLink.statusCode).toBe(201);
    const link = createdLink.json<{ customerPath: string; linkId: string }>();
    const token = link.customerPath.split("/").at(-1);
    if (!token) throw new Error("Project public link response did not contain a token");
    expect(token).toMatch(/^pv1\./);

    const firstView = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/projects/${token}`,
    });
    expect(firstView.statusCode).toBe(200);
    expect(firstView.headers["cache-control"]).toBe("no-store");
    expect(firstView.json()).toMatchObject({
      contact: { displayName: "Primary Contact" },
      projectNumber: `PRJ-${projectId}`,
      schedule: [{ jobNumber: `JOB-${jobId}`, status: "scheduled" }],
      serviceType: "material_delivery",
    });
    const presentation = JSON.stringify(firstView.json());
    expect(presentation).not.toContain("acceptedValueCents");
    expect(presentation).not.toContain("ownerUserId");
    expect(presentation).not.toContain("supplier");
    await fastify.inject({ method: "GET", url: `/api/v1/public/projects/${token}` });

    const recordedViews = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      links: await transaction
        .select()
        .from(projectPublicLinks)
        .where(eq(projectPublicLinks.id, link.linkId)),
      views: await transaction
        .select()
        .from(projectPublicLinkViews)
        .where(eq(projectPublicLinkViews.projectPublicLinkId, link.linkId)),
    }));
    expect(recordedViews.links[0]?.viewCount).toBe(2);
    expect(recordedViews.views).toHaveLength(2);
    expect(
      await withTenantTransaction(runtime(), foreignTenantId, (transaction) =>
        transaction.select().from(projectPublicLinks),
      ),
    ).toHaveLength(0);
    const tampered = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/projects/${token}x`,
    });
    expect(tampered.statusCode).toBe(404);
    expect(tampered.json()).toMatchObject({ error: { code: "PROJECT_LINK_INVALID" } });

    const revoked = await fastify.inject({
      headers: { "idempotency-key": "communications-project-link-revoke" },
      method: "POST",
      url: `/api/v1/projects/${projectId}/public-links/${link.linkId}/actions/revoke`,
    });
    expect(revoked.statusCode).toBe(204);
    const unavailable = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/projects/${token}`,
    });
    expect(unavailable.statusCode).toBe(410);
    expect(unavailable.json()).toMatchObject({ error: { code: "PROJECT_LINK_REVOKED" } });

    const expiredLinkId = randomUUID();
    const tokens = new CustomerCapabilityTokenService(configured(baseConfig, {}));
    const expiredReference = {
      kind: "project" as const,
      linkId: expiredLinkId,
      targetId: projectId,
      tenantId,
    };
    const expiredToken = tokens.create(expiredReference);
    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.insert(projectPublicLinks).values({
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        customerAccountId: customerId,
        expiresAt: new Date("2026-08-02T00:00:00.000Z"),
        id: expiredLinkId,
        projectId,
        tenantId,
        tokenHash: expiredToken.hash,
      }),
    );
    const expired = await fastify.inject({
      method: "GET",
      url: `/api/v1/public/projects/${expiredToken.token}`,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({ error: { code: "PROJECT_LINK_EXPIRED" } });

    const template = await fastify.inject({
      headers: { "idempotency-key": "communications-job-scheduled-template" },
      method: "POST",
      payload: {
        allowedVariables: ["customerName", "projectNumber", "scheduledAt", "secureUrl"],
        bodyTemplate:
          "Hello {{customerName}}, project {{projectNumber}} is scheduled for {{scheduledAt}}. {{secureUrl}}",
        channel: "email",
        name: "Automatic schedule notice",
        subjectTemplate: "Project {{projectNumber}} scheduled",
        templateKey: "job.scheduled",
      },
      url: "/api/v1/notification-templates",
    });
    expect(template.statusCode).toBe(201);
    await fastify.inject({
      headers: { "idempotency-key": "communications-job-scheduled-template-publish" },
      method: "POST",
      url: `/api/v1/notification-templates/${template.json<TemplateResponse>().id}/actions/publish`,
    });
    await fastify.inject({
      headers: { "idempotency-key": "communications-project-schedule-preference" },
      method: "POST",
      payload: {
        contactId,
        emailEnabled: true,
        notificationType: "schedule",
        smsEnabled: false,
      },
      url: `/api/v1/customers/${customerId}/notification-preferences`,
    });
    const sourceEventId = randomUUID();
    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.insert(outboxEvents).values({
        aggregateId: jobId,
        aggregateType: "Job",
        createdBy: userId,
        eventType: "job.scheduled",
        id: sourceEventId,
        payload: {
          scheduledEndAt: "2026-08-12T16:00:00.000Z",
          scheduledStartAt: "2026-08-12T14:00:00.000Z",
        },
        tenantId,
      }),
    );
    const provider = new RecordingProvider();
    await processOutbox(provider);

    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.body).toContain("/customer/projects/pv1.");
    const automated = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      deliveries: await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationType, "schedule")),
      requests: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "notification.requested")),
    }));
    const delivery = automated.deliveries.find(
      (candidate) => candidate.projectPublicLinkId !== null,
    );
    expect(delivery).toMatchObject({ projectId, status: "delivered" });
    expect(delivery?.renderedBody).toContain("[secure customer link]");
    expect(JSON.stringify(automated)).not.toContain("/customer/projects/pv1.");
    expect(
      automated.requests.filter((request) => request.payload.sourceEventId === sourceEventId),
    ).toHaveLength(1);

    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .update(outboxEvents)
        .set({ availableAt: new Date(0), processedAt: null, status: "pending" })
        .where(eq(outboxEvents.id, sourceEventId)),
    );
    await processOutbox(provider);
    expect(provider.messages).toHaveLength(1);
    const replay = await withTenantTransaction(runtime(), tenantId, async (transaction) => ({
      deliveries: await transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.projectId, projectId)),
      requests: await transaction
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "notification.requested")),
    }));
    expect(
      replay.deliveries.filter((candidate) => candidate.notificationType === "schedule"),
    ).toHaveLength(1);
    expect(
      replay.requests.filter((request) => request.payload.sourceEventId === sourceEventId),
    ).toHaveLength(2);
  });

  it("delivers scheduled reminders once and exposes recoverable communication operations", async () => {
    await createAndPublishReminderTemplate();
    const preference = await fastify.inject({
      headers: { "idempotency-key": "communications-reminder-preference" },
      method: "POST",
      payload: {
        contactId,
        emailEnabled: true,
        notificationType: "reminder",
        smsEnabled: false,
      },
      url: `/api/v1/customers/${customerId}/notification-preferences`,
    });
    expect(preference.statusCode).toBe(200);

    const [reminder] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(scheduledJobs)
        .where(eq(scheduledJobs.jobType, "communications.service_reminder")),
    );
    expect(reminder).toMatchObject({ status: "pending" });
    if (!reminder) throw new Error("The Job schedule policy did not create a reminder");
    await withTenantTransaction(migrator(), tenantId, (transaction) =>
      transaction
        .update(scheduledJobs)
        .set({ runAt: new Date(0) })
        .where(and(eq(scheduledJobs.tenantId, tenantId), eq(scheduledJobs.id, reminder.id))),
    );

    await processScheduledJobs();
    const provider = new RecordingProvider();
    await processOutbox(provider);
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.body).toContain("/customer/projects/pv1.");
    const [deliveredReminder] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationType, "reminder")),
    );
    expect(deliveredReminder).toMatchObject({ status: "delivered" });
    expect(deliveredReminder?.renderedBody).toContain("[secure customer link]");

    await withTenantTransaction(migrator(), tenantId, (transaction) =>
      transaction
        .update(scheduledJobs)
        .set({ completedAt: null, runAt: new Date(0), status: "pending" })
        .where(and(eq(scheduledJobs.tenantId, tenantId), eq(scheduledJobs.id, reminder.id))),
    );
    await processScheduledJobs();
    await processOutbox(provider);
    expect(provider.messages).toHaveLength(1);
    const reminderDeliveries = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.notificationType, "reminder")),
    );
    expect(reminderDeliveries).toHaveLength(1);

    const failedQueue = await fastify.inject({
      headers: { "idempotency-key": "communications-permanent-provider-failure" },
      method: "POST",
      payload: notificationPayload("schedule.confirmed", "schedule"),
      url: "/api/v1/notifications",
    });
    expect(failedQueue.statusCode).toBe(201);
    const failedOutboxId = failedQueue.json<QueuedResponse>().outboxEventId;
    await processOutbox(new PermanentFailureProvider());
    const [failedDelivery] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.originOutboxEventId, failedOutboxId)),
    );
    expect(failedDelivery).toMatchObject({
      lastErrorCode: "provider_rejected",
      status: "failed",
    });
    if (!failedDelivery) throw new Error("The provider failure did not create a Delivery");

    const operations = await fastify.inject({
      method: "GET",
      url: "/api/v1/communication-operations",
    });
    expect(operations.statusCode).toBe(200);
    const operationsBody = operations.json<{
      deadLetters: { errorCode: string | null; id: string; kind: string }[];
      metrics: { failed: number };
      reminders: { id: string; status: string }[];
    }>();
    expect(operationsBody.metrics.failed).toBe(1);
    expect(operationsBody.deadLetters.find((item) => item.id === failedOutboxId)).toMatchObject({
      errorCode: "provider_rejected",
      kind: "outbox",
    });
    expect(operationsBody.reminders.find((item) => item.id === reminder.id)).toMatchObject({
      status: "completed",
    });
    expect(JSON.stringify(operationsBody)).not.toContain("provider-token");

    const retryDelivery = () =>
      fastify.inject({
        headers: { "idempotency-key": "communications-retry-failed-delivery" },
        method: "POST",
        url: `/api/v1/notifications/${failedDelivery.id}/actions/retry`,
      });
    const firstRetry = await retryDelivery();
    expect(firstRetry.statusCode).toBe(200);
    expect(firstRetry.json()).toMatchObject({ operationId: failedOutboxId, status: "queued" });
    expect((await retryDelivery()).json()).toEqual(firstRetry.json());
    const [retriedOutbox] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.select().from(outboxEvents).where(eq(outboxEvents.id, failedOutboxId)),
    );
    expect(retriedOutbox).toMatchObject({ attempts: 0, lastError: null, status: "pending" });

    const deadReminderId = randomUUID();
    await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.insert(scheduledJobs).values({
        attempts: 5,
        id: deadReminderId,
        jobType: "communications.service_reminder",
        lastError: "NotificationReminderConfigurationError",
        payload: { jobId },
        runAt: new Date(0),
        status: "dead_letter",
        tenantId,
      }),
    );
    const retryReminder = await fastify.inject({
      headers: { "idempotency-key": "communications-retry-dead-reminder" },
      method: "POST",
      url: `/api/v1/communication-operations/scheduled-jobs/${deadReminderId}/actions/retry`,
    });
    expect(retryReminder.statusCode).toBe(200);
    const [retriedReminder] = await withTenantTransaction(runtime(), tenantId, (transaction) =>
      transaction.select().from(scheduledJobs).where(eq(scheduledJobs.id, deadReminderId)),
    );
    expect(retriedReminder).toMatchObject({ attempts: 0, lastError: null, status: "pending" });
  });

  async function createAndPublishTemplate(
    templateKey: string,
    key: string,
  ): Promise<TemplateResponse> {
    const created = await fastify.inject({
      headers: { "idempotency-key": key },
      method: "POST",
      payload: {
        allowedVariables: ["customerName", "scheduledAt"],
        bodyTemplate: "Hello {{customerName}}, your service is scheduled for {{scheduledAt}}.",
        channel: "email",
        name: "Schedule confirmation",
        subjectTemplate: "Your service schedule",
        templateKey,
      },
      url: "/api/v1/notification-templates",
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json<TemplateResponse>();
    const published = await fastify.inject({
      headers: { "idempotency-key": `${key}-publish` },
      method: "POST",
      url: `/api/v1/notification-templates/${draft.id}/actions/publish`,
    });
    expect(published.statusCode).toBe(200);
    return published.json<TemplateResponse>();
  }

  async function createAndPublishReminderTemplate(): Promise<TemplateResponse> {
    const created = await fastify.inject({
      headers: { "idempotency-key": "communications-reminder-template" },
      method: "POST",
      payload: {
        allowedVariables: ["customerName", "projectNumber", "scheduledAt", "secureUrl"],
        bodyTemplate:
          "Hello {{customerName}}, project {{projectNumber}} starts at {{scheduledAt}}. {{secureUrl}}",
        channel: "email",
        name: "Service reminder",
        subjectTemplate: "Reminder for project {{projectNumber}}",
        templateKey: "service.reminder",
      },
      url: "/api/v1/notification-templates",
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json<TemplateResponse>();
    const published = await fastify.inject({
      headers: { "idempotency-key": "communications-reminder-template-publish" },
      method: "POST",
      url: `/api/v1/notification-templates/${draft.id}/actions/publish`,
    });
    expect(published.statusCode).toBe(200);
    return published.json<TemplateResponse>();
  }

  function notificationPayload(templateKey: string, notificationType: string) {
    return {
      channel: "email",
      contactId,
      customerAccountId: customerId,
      notificationType,
      templateKey,
      variables: { customerName: "Primary Customer", scheduledAt: "August 12 at 9:00 AM" },
    };
  }

  async function processOutbox(provider: NotificationProvider): Promise<void> {
    const registry = new OutboxHandlerRegistry();
    const tokens = new CustomerCapabilityTokenService(configured(baseConfig, {}));
    const handler = new NotificationOutboxHandler(runtime(), registry, provider, tokens);
    handler.onModuleInit();
    const policies = new NotificationPolicyHandler(
      runtime(),
      registry,
      tokens,
      configured(baseConfig, {}),
    );
    policies.onModuleInit();
    const processor = new OutboxProcessorService(
      runtime(),
      configured(baseConfig, { id: `communications-${randomUUID()}`, tenantIds: [tenantId] }),
      registry,
    );
    for (let index = 0; index < 8; index += 1) {
      if ((await processor.processOnce(tenantId)) === 0) break;
    }
  }

  async function processScheduledJobs(): Promise<void> {
    const registry = new ScheduledJobHandlerRegistry();
    const handler = new NotificationReminderHandler(
      runtime(),
      registry,
      new CustomerCapabilityTokenService(configured(baseConfig, {})),
    );
    handler.onModuleInit();
    const processor = new ScheduledJobProcessorService(
      runtime(),
      configured(baseConfig, {
        id: `communications-scheduled-${randomUUID()}`,
        tenantIds: [tenantId],
      }),
      registry,
    );
    for (let index = 0; index < 4; index += 1) {
      if ((await processor.processOnce(tenantId)) === 0) break;
    }
  }
});

class CountingProvider implements NotificationProvider {
  public readonly name = "test";
  public calls = 0;

  public send(): Promise<{ providerMessageId: string }> {
    this.calls += 1;
    return Promise.resolve({ providerMessageId: `test-${this.calls.toString()}` });
  }
}

class FailsOnceProvider implements NotificationProvider {
  public readonly name = "test-retry";
  public calls = 0;

  public send(): Promise<{ providerMessageId: string }> {
    this.calls += 1;
    if (this.calls === 1) {
      const error = new Error("provider-token-must-not-be-persisted");
      error.name = "TemporaryProviderFailure";
      return Promise.reject(error);
    }
    return Promise.resolve({ providerMessageId: "test-retry-delivered" });
  }
}

class RecordingProvider implements NotificationProvider {
  public readonly name = "recording";
  public readonly messages: SendNotificationInput[] = [];

  public send(input: SendNotificationInput): Promise<{ providerMessageId: string }> {
    this.messages.push(input);
    return Promise.resolve({ providerMessageId: `recorded-${this.messages.length.toString()}` });
  }
}

class PermanentFailureProvider implements NotificationProvider {
  public readonly name = "permanent-failure";

  public send(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new NotificationProviderError("provider_rejected", false));
  }
}

async function seedCustomer(
  database: Database,
  tenantId: string,
  userId: string,
  customerId: string,
  contactId: string,
  label: string,
): Promise<void> {
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(organizations).values({
      displayName: `${label} Communications`,
      id: tenantId,
      legalName: `${label} Communications LLC`,
    });
    await transaction.insert(users).values({
      displayName: `${label} User`,
      email: `${label.toLowerCase()}-user@example.test`,
      id: userId,
      tenantId,
    });
    await transaction.insert(customerAccounts).values({
      customerType: "individual",
      displayName: `${label} Customer`,
      id: customerId,
      normalizedName: `${label.toLowerCase()} customer`,
      ownerUserId: userId,
      tenantId,
    });
    await transaction.insert(contacts).values({
      displayName: `${label} Contact`,
      email: `${label.toLowerCase()}@example.test`,
      firstName: label,
      id: contactId,
      lastName: "Contact",
      normalizedEmail: `${label.toLowerCase()}@example.test`,
      preferredContactMethod: "email",
      tenantId,
    });
    await transaction.insert(accountContacts).values({
      contactId,
      customerAccountId: customerId,
      isPrimary: true,
      tenantId,
    });
  });
}

async function seedProjectFixture(
  database: Database,
  tenantId: string,
  userId: string,
  customerId: string,
  contactId: string,
  projectId: string,
  jobId: string,
): Promise<void> {
  const locationId = randomUUID();
  const leadId = randomUUID();
  const policyId = randomUUID();
  const pricingVersionId = randomUUID();
  const estimateId = randomUUID();
  const estimateVersionId = randomUUID();
  const quoteId = randomUUID();
  const quoteVersionId = randomUUID();
  await withTenantTransaction(database, tenantId, async (transaction) => {
    await transaction.insert(serviceLocations).values({
      addressLine1: "100 Customer Way",
      city: "Lincoln",
      customerAccountId: customerId,
      id: locationId,
      label: "Project site",
      normalizedAddress: "100 customer way lincoln ne 68502",
      postalCode: "68502",
      region: "NE",
      tenantId,
    });
    await transaction.insert(leads).values({
      customerAccountId: customerId,
      estimatedQuantity: "10.000",
      id: leadId,
      leadNumber: `L-${leadId}`,
      materialDescription: "Customer-safe gravel delivery",
      ownerUserId: userId,
      primaryContactId: contactId,
      quantityUnit: "tons",
      serviceLocationId: locationId,
      serviceType: "material_delivery",
      source: "phone",
      status: "accepted",
      summary: "Deliver gravel",
      tenantId,
    });
    await transaction.insert(pricingPolicies).values({
      id: policyId,
      name: "Communications fixture policy",
      serviceType: "material_delivery",
      status: "active",
      tenantId,
    });
    await transaction.insert(pricingVersions).values({
      activatedAt: new Date(),
      effectiveAt: new Date(),
      id: pricingVersionId,
      pricingPolicyId: policyId,
      status: "active",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(estimates).values({
      estimateNumber: `EST-${estimateId}`,
      id: estimateId,
      leadId,
      ownerUserId: userId,
      status: "quote_generated",
      tenantId,
    });
    await transaction.insert(estimateVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      approvedQuotePriceCents: 25_000,
      contentHash: "c".repeat(64),
      depositCents: 0,
      estimateId,
      id: estimateVersionId,
      inputSnapshot: {},
      marginCents: 10_000,
      pricingVersionId,
      purchaseCostCents: 15_000,
      readiness: "ready",
      recommendedPriceCents: 25_000,
      serviceType: "material_delivery",
      status: "quote_generated",
      tenantId,
      versionNumber: 1,
    });
    await transaction.insert(quotes).values({
      customerAccountId: customerId,
      estimateId,
      id: quoteId,
      leadId,
      ownerUserId: userId,
      primaryContactId: contactId,
      quoteNumber: `QTE-${quoteId}`,
      serviceLocationId: locationId,
      status: "accepted",
      tenantId,
    });
    await transaction.insert(quoteVersions).values({
      approvedAt: new Date(),
      approvedBy: userId,
      contentHash: "d".repeat(64),
      customerSnapshot: { displayName: "Primary Customer" },
      estimateVersionId,
      id: quoteVersionId,
      locationSnapshot: { addressLine1: "100 Customer Way" },
      quoteId,
      requiredDepositCents: 0,
      scope: "Deliver gravel",
      status: "draft",
      subtotalCents: 25_000,
      tenantId,
      totalCents: 25_000,
      versionNumber: 1,
    });
    await transaction
      .update(quoteVersions)
      .set({ status: "accepted", terminalAt: new Date() })
      .where(eq(quoteVersions.id, quoteVersionId));
    await transaction.insert(projects).values({
      acceptedQuoteContentHash: "d".repeat(64),
      acceptedQuoteVersionId: quoteVersionId,
      acceptedValueCents: 25_000,
      contractRequirement: "waived",
      contractStatus: "waived",
      customerAccountId: customerId,
      depositRequirement: "waived",
      depositStatus: "waived",
      id: projectId,
      outcomeStatement: "Deliver the requested gravel",
      ownerUserId: userId,
      primaryContactId: contactId,
      projectNumber: `PRJ-${projectId}`,
      requiredDepositCents: 0,
      serviceLocationId: locationId,
      serviceType: "material_delivery",
      status: "active",
      tenantId,
    });
    await transaction.insert(jobs).values({
      id: jobId,
      jobNumber: `JOB-${jobId}`,
      projectId,
      scheduledEndAt: new Date("2026-08-12T16:00:00.000Z"),
      scheduledStartAt: new Date("2026-08-12T14:00:00.000Z"),
      serviceType: "material_delivery",
      status: "scheduled",
      tenantId,
    });
  });
}

function configured(
  base: ServerConfig,
  worker: Partial<ServerConfig["worker"]>,
): ServerConfigService {
  return { value: { ...base, worker: { ...base.worker, ...worker } } };
}

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for communications integration tests`);
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
