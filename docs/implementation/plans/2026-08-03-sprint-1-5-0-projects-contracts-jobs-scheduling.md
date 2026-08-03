# Sprint 1.5.0 Projects, Contracts, Jobs, and Scheduling Plan

## Objective

Turn an accepted Quote into contract-ready, independently scheduled work. Quote acceptance creates
one Project and one initial shared Job atomically. Contract and deposit readiness block scheduling,
asset occupancy is conflict-safe in PostgreSQL, and closed Jobs preserve history until a controlled
reopening command is used.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `tests/acceptance/AGENTS.md`
- `docs/architecture/v1-build-readiness.md`
- `docs/architecture/object-model.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/state-transitions.md`
- `docs/architecture/technical-architecture.md`
- `docs/domains/project-and-job.md`
- `docs/implementation/build-sequence.md`
- `docs/implementation/acceptance-journeys.md`
- `docs/implementation/sprints.md`

## Scope boundaries

- Project owns the accepted commercial snapshot, readiness summaries, lifecycle, holds, and Jobs.
- Contract owns one immutable commercial agreement generated from the Project snapshot. Business and
  customer signatures are separate immutable evidence records.
- A Material Delivery accepted Quote creates one initial `MAT` Job; a Dump Trailer Rental accepted
  Quote creates one initial `DTR` Job. Service-specific Detail records remain in Sprints 1.6 and
  1.8.
- Schedule Block owns staff calendar time. Asset Reservation owns exclusive scheduled or continuing
  asset occupancy. PostgreSQL rejects overlapping active reservations for one asset.
- Deposit readiness records an external readiness fact and evidence reference. It does not create an
  Invoice, Payment, Allocation, Deposit Balance, or accounting entry; those remain Sprint 1.7.
- This sprint provides shared Route Stops, Checklists, Job Events, and holds. Service-specific
  execution behavior remains in the later vertical slices.

## Lifecycle commands

Project:

```text
Pending Contract → Pending Deposit → Ready for Planning → Planning → Active
→ Operationally Complete → Financially Complete → Completed → Closed
```

`On Hold` records and preserves the prior state. Release restores it. Reopening a closed Project is
controlled, reasoned, audited, and returns it to Planning.

Job:

```text
New → Planning → Needs Scheduling → Scheduled → Dispatch Ready → Active
→ Operationally Complete → Awaiting Final Invoice → Invoiced → Financially Complete → Closed
```

`On Hold` and `Cancelled` are controlled alternatives. Closed Jobs reject ordinary mutations in both
the application and database; controlled reopening returns the Job to Planning.

## API surface

Projects and Contracts:

- `GET /api/v1/projects`
- `GET /api/v1/projects/:id`
- `POST /api/v1/projects/:id/actions/generate-contract`
- `POST /api/v1/projects/:id/actions/confirm-deposit-readiness`
- `POST /api/v1/projects/:id/actions/:action`
- `POST /api/v1/contracts/:id/actions/sign-business`
- `POST /api/v1/contracts/:id/actions/send`
- `GET /api/v1/public/contracts/:token`
- `POST /api/v1/public/contracts/:token/actions/sign`

Jobs and shared operations:

- `GET /api/v1/jobs`
- `GET /api/v1/jobs/:id`
- `POST /api/v1/jobs/:id/actions/:action`
- `POST /api/v1/jobs/:id/actions/evaluate-readiness`
- `POST /api/v1/jobs/:id/route-stops`
- `POST /api/v1/jobs/:id/checklists`
- `POST /api/v1/checklist-items/:id/actions/complete`

Scheduling and assets:

- `GET /api/v1/assets`
- `POST /api/v1/assets`
- `GET /api/v1/schedule/calendar`
- `GET /api/v1/schedule/queue`
- `POST /api/v1/jobs/:id/schedule-blocks`
- `POST /api/v1/schedule-blocks/:id/actions/cancel`

Every staff mutation requires an `Idempotency-Key`. Statuses are never set through unrestricted
PATCH requests.

## Web surfaces

- `/projects`: Project readiness and lifecycle queue
- `/projects/:id`: accepted value, contract, deposit, holds, and Jobs
- `/jobs`: shared operational queue and jobs-needing-scheduling view
- `/jobs/:id`: schedule, assignments, assets, stops, checklists, readiness, and timeline
- `/schedule`: calendar window, unscheduled queue, assets, and conflict-safe scheduling form
- `/customer/contracts/:token`: customer-safe agreement view and typed-name signature

All pages include loading, empty, error, and populated states and use only the generated API client.

## Completion checklist

- [x] reviewed forward migration applies to an empty and existing PostgreSQL database
- [x] every new tenant table has forced RLS, grants, and tenant-aware relationships
- [x] Quote acceptance creates one Project and one correctly numbered initial Job idempotently
- [x] Contract content is immutable after business signature and signature evidence is immutable
- [x] secure Contract tokens are scoped, expiring, revocable, and stored only as hashes
- [x] Contract and deposit readiness block scheduling until satisfied or waived
- [x] one independently scheduled trip or rental is one Job
- [x] overlapping active Asset Reservations fail transactionally under concurrency
- [x] required schedule blocks, driver assignments, and asset reservations gate confirmation
- [x] holds preserve and restore prior Project and Job states
- [x] closed Jobs and their ordinary child records reject edits until controlled reopening
- [x] readiness, Route Stop, Checklist, and Job Event behavior is audited and tenant-isolated
- [x] staff and customer web surfaces are responsive, accessible, and customer-safe
- [x] OpenAPI and generated client artifacts are current
- [x] architecture, domain, acceptance, runbook, and sprint documentation are current
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm api:check` passes
- [x] `pnpm test:e2e` passes
- [x] `pnpm check` passes
