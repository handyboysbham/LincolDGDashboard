import { and, eq, sql } from "drizzle-orm";

import type { TenantTransaction } from "./client.js";
import { outboxEvents, scheduledJobs } from "./schema.js";

export interface ClaimedOutboxEvent {
  aggregateId: string;
  aggregateType: string;
  attempts: number;
  createdBy: string | null;
  eventType: string;
  id: string;
  payload: Record<string, unknown>;
  tenantId: string;
}

export interface ClaimedScheduledJob {
  attempts: number;
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  tenantId: string;
}

function validateClaimInput(limit: number, leaseSeconds: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("claim limit must be an integer from 1 through 100");
  }

  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
    throw new Error("leaseSeconds must be an integer from 1 through 3600");
  }
}

export async function claimOutboxEvents(
  transaction: TenantTransaction,
  input: { workerId: string; limit?: number; leaseSeconds?: number },
): Promise<ClaimedOutboxEvent[]> {
  const limit = input.limit ?? 25;
  const leaseSeconds = input.leaseSeconds ?? 60;
  validateClaimInput(limit, leaseSeconds);

  if (!input.workerId) {
    throw new Error("workerId is required");
  }

  const result = await transaction.execute(sql`
    with candidates as (
      select id
      from outbox_events
      where
        available_at <= clock_timestamp()
        and (
          status = 'pending'
          or (status = 'processing' and locked_until < clock_timestamp())
        )
      order by available_at, id
      for update skip locked
      limit ${limit}
    )
    update outbox_events as events
    set
      status = 'processing',
      attempts = events.attempts + 1,
      locked_by = ${input.workerId},
      locked_until = clock_timestamp() + (${leaseSeconds} * interval '1 second')
    from candidates
    where events.id = candidates.id
    returning
      events.id,
      events.tenant_id as "tenantId",
      events.aggregate_type as "aggregateType",
      events.aggregate_id as "aggregateId",
      events.event_type as "eventType",
      events.payload,
      events.attempts,
      events.created_by as "createdBy"
  `);

  return result.rows as unknown as ClaimedOutboxEvent[];
}

export async function claimScheduledJobs(
  transaction: TenantTransaction,
  input: { workerId: string; limit?: number; leaseSeconds?: number },
): Promise<ClaimedScheduledJob[]> {
  const limit = input.limit ?? 25;
  const leaseSeconds = input.leaseSeconds ?? 60;
  validateClaimInput(limit, leaseSeconds);

  if (!input.workerId) {
    throw new Error("workerId is required");
  }

  const result = await transaction.execute(sql`
    with candidates as (
      select id
      from scheduled_jobs
      where
        run_at <= clock_timestamp()
        and (
          status = 'pending'
          or (status = 'processing' and locked_until < clock_timestamp())
        )
      order by run_at, id
      for update skip locked
      limit ${limit}
    )
    update scheduled_jobs as jobs
    set
      status = 'processing',
      attempts = jobs.attempts + 1,
      locked_by = ${input.workerId},
      locked_until = clock_timestamp() + (${leaseSeconds} * interval '1 second')
    from candidates
    where jobs.id = candidates.id
    returning
      jobs.id,
      jobs.tenant_id as "tenantId",
      jobs.job_type as "jobType",
      jobs.payload,
      jobs.attempts
  `);

  return result.rows as unknown as ClaimedScheduledJob[];
}

export async function completeOutboxEvent(
  transaction: TenantTransaction,
  input: { eventId: string; workerId: string },
): Promise<boolean> {
  const completed = await transaction
    .update(outboxEvents)
    .set({
      lastError: null,
      lockedBy: null,
      lockedUntil: null,
      processedAt: new Date(),
      status: "processed",
    })
    .where(
      and(
        eq(outboxEvents.id, input.eventId),
        eq(outboxEvents.status, "processing"),
        eq(outboxEvents.lockedBy, input.workerId),
      ),
    )
    .returning({ id: outboxEvents.id });

  return completed.length === 1;
}

export async function failOutboxEvent(
  transaction: TenantTransaction,
  input: {
    attempts: number;
    error: string;
    eventId: string;
    maxAttempts: number;
    retryAt: Date;
    workerId: string;
  },
): Promise<"dead_letter" | "pending" | "not_owned"> {
  const status = input.attempts >= input.maxAttempts ? "dead_letter" : "pending";
  const failed = await transaction
    .update(outboxEvents)
    .set({
      availableAt: input.retryAt,
      lastError: input.error.slice(0, 4_000),
      lockedBy: null,
      lockedUntil: null,
      status,
    })
    .where(
      and(
        eq(outboxEvents.id, input.eventId),
        eq(outboxEvents.status, "processing"),
        eq(outboxEvents.lockedBy, input.workerId),
      ),
    )
    .returning({ id: outboxEvents.id });

  return failed.length === 1 ? status : "not_owned";
}

export async function completeScheduledJob(
  transaction: TenantTransaction,
  input: { jobId: string; workerId: string },
): Promise<boolean> {
  const completed = await transaction
    .update(scheduledJobs)
    .set({
      completedAt: new Date(),
      lastError: null,
      lockedBy: null,
      lockedUntil: null,
      status: "completed",
    })
    .where(
      and(
        eq(scheduledJobs.id, input.jobId),
        eq(scheduledJobs.status, "processing"),
        eq(scheduledJobs.lockedBy, input.workerId),
      ),
    )
    .returning({ id: scheduledJobs.id });

  return completed.length === 1;
}

export async function failScheduledJob(
  transaction: TenantTransaction,
  input: {
    attempts: number;
    error: string;
    jobId: string;
    maxAttempts: number;
    retryAt: Date;
    workerId: string;
  },
): Promise<"dead_letter" | "pending" | "not_owned"> {
  const status = input.attempts >= input.maxAttempts ? "dead_letter" : "pending";
  const failed = await transaction
    .update(scheduledJobs)
    .set({
      lastError: input.error.slice(0, 4_000),
      lockedBy: null,
      lockedUntil: null,
      runAt: input.retryAt,
      status,
    })
    .where(
      and(
        eq(scheduledJobs.id, input.jobId),
        eq(scheduledJobs.status, "processing"),
        eq(scheduledJobs.lockedBy, input.workerId),
      ),
    )
    .returning({ id: scheduledJobs.id });

  return failed.length === 1 ? status : "not_owned";
}
