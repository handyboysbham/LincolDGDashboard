import { sql } from "drizzle-orm";

import type { TenantTransaction } from "./client.js";

export interface ClaimedOutboxEvent {
  aggregateId: string;
  aggregateType: string;
  attempts: number;
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
      events.attempts
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
