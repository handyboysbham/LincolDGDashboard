# Sprint 1.8.0 Dump Trailer Rental Plan

## Objective

Execute one Dump Trailer Rental Job from accepted commercial terms through drop-off, customer
custody, extension, pickup, disposal, inspection, final billing, security-deposit resolution, and
financial closure. Preserve operational facts, customer responsibility, disposal evidence, company
cost, and billing decisions as separate records.

Phases 1 through 3 establish the rental database model, accepted-term planning and drop-off, and
customer-custody extension and pickup application slices. Later phases add disposal reconciliation,
operational charges, web workflows, and the completed canonical `DTR-E2E-001` journey.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `tests/acceptance/AGENTS.md`
- `docs/architecture/object-model.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/state-transitions.md`
- `docs/domains/project-and-job.md`
- `docs/domains/dump-trailer-rental-detail.md`
- `docs/domains/disposal-load.md`
- `docs/domains/job-charge.md`
- `docs/domains/invoice.md`
- `docs/domains/payment.md`
- `docs/implementation/build-sequence.md`
- `docs/implementation/acceptance-journeys.md`
- `docs/implementation/sprints.md`

## Scope boundaries

- One rental is one independently scheduled Dump Trailer Rental Job.
- Job continues to own lifecycle, readiness, assignments, holds, operational completion, financial
  completion, and closure.
- Schedule Block owns driver time for drop-off, pickup, disposal, and inspection. Trailer occupancy
  is one continuous Asset Reservation from planned drop-off through operational release.
- Dump Trailer Rental Detail is the one-to-one service-specific child and owns the accepted rental
  terms snapshot plus current operational summary.
- Debris Review preserves customer attestation and internal prohibited-material/access decisions.
  Unsafe access, legal, towing, or prohibited-material blockers are not override flags.
- Rental Extension preserves the requested period, historical accepted rate, availability result,
  authorization, and schedule/reservation decision. It does not directly mutate a price.
- Pickup Attempt records every actual pickup outcome. A failed attempt remains historical and may
  become the source of a controlled Job Charge.
- Disposal Load records one actual facility transaction. A rejected load is preserved; redirection
  creates or links a replacement load rather than rewriting the rejected record.
- Rental Inspection preserves pre-drop-off or post-rental condition evidence. A completed inspection
  is immutable.
- Document and Document Link own tickets, receipts, photos, and inspection evidence. Rental tables
  store only tenant-aware document references where a singular required artifact exists.
- Expense owns disposal cost. Job Charge owns additional-day, overage, failed-pickup, cleaning, or
  damage billing decisions. Invoice and Payment remain Sprint 1.7 records.

## Database ownership

| Table                         | Responsibility                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `dump_trailer_rental_details` | Accepted terms, debris/access summary, custody, occupancy, and readiness per Job  |
| `rental_debris_reviews`       | Attributable debris, prohibited-material, access, and customer-attestation review |
| `rental_extensions`           | Requested rental-period change, conflict evaluation, authorization, and outcome   |
| `rental_pickup_attempts`      | Ordered pickup execution outcomes, including durable failed attempts              |
| `disposal_loads`              | Facility outcome, source/canonical weight, evidence, Expense, and reconciliation  |
| `rental_inspections`          | Pre-drop-off and post-rental trailer condition, cleaning, damage, and release     |

The existing `schedule_blocks`, `asset_reservations`, `job_assignments`, `asset_assignments`,
`route_stops`, `checklist_instances`, `documents`, `expenses`, `job_charges`, `invoices`,
`deposit_balances`, and `refunds` tables remain authoritative for their existing boundaries.

## Integrity model

- Money uses integer cents. Duration uses integer days. Weight uses controlled numeric values and
  preserves both source units and canonical pounds.
- Every rental child includes `tenant_id` and `job_id`. Composite foreign keys prove that Detail,
  Extension, Pickup Attempt, Disposal Load, Inspection, shared schedule records, Expenses, and Job
  Charges belong to the same Job.
- One Rental Detail is allowed per Job, and the database rejects a Detail for a Material Delivery
  Job.
- Accepted rental-term fields and their content hash become immutable after the rental leaves
  planning.
- An approved Extension requires a passing reservation-conflict evaluation, customer authorization
  when required, an approver, and an attributable availability snapshot.
- Pickup Attempt numbers and Disposal Load sequence numbers are positive and unique per rental.
- Gross weight cannot be below tare; net weight is gross minus tare. Canonical pounds cannot be
  negative.
- A reconciled Disposal Load requires a final facility outcome, unloading result, weight or approved
  not-applicable decision, ticket and receipt or attributable waivers, an empty-trailer result, and
  an Expense when a disposal fee applies.
- Rental-wide actual weight and overage are derived from reconciled Disposal Loads. One active
  weight-overage Job Charge uses a stable Job Charge dedupe key.
- A rental cannot complete until customer custody has ended, every Disposal Load is resolved, the
  trailer is confirmed empty, a post-rental inspection is complete, and the occupancy reservation is
  released.
- Rental operational records are not hard deleted. Completed inspections, approved extensions,
  failed pickup attempts, and reconciled Disposal Loads retain immutable outcome facts.
- Closed Jobs reject changes to every rental child until the existing controlled reopen command
  returns the Job to Planning.
- Every table has forced Row-Level Security, tenant-aware indexes, row-update metadata, and runtime
  grants limited to the application role.

## Application commands

All mutations use explicit idempotent commands:

- create or revise the Rental Detail from the accepted Quote Version
- record debris/customer attestation and approve, reject, or place the rental on hold
- plan drop-off, pickup, and continuous occupancy against shared scheduling records
- evaluate drop-off readiness and record pre-delivery inspection
- begin drop-off, record arrival, place the trailer, and begin customer custody
- request, evaluate, approve, reject, or cancel an Extension
- begin pickup, record arrival, record failure, or retrieve the trailer and end customer custody
- create and execute a Disposal Load, including rejection and redirection
- record weight, ticket, receipt, Expense, empty-trailer evidence, and reconciliation
- perform post-rental inspection and release or quarantine the trailer
- calculate deduplicated additional-day, weight-overage, failed-pickup, cleaning, and damage Job
  Charges from accepted historical terms
- evaluate operational completion and invoice readiness
- issue the Final Invoice, settle payment, resolve/refund the security deposit, derive financial
  completion, and close the Project through the Sprint 1.7 services

Every transition locks the Job and affected aggregate when concurrency matters, confirms permission
and current state, evaluates readiness, writes Job and Audit Events, enqueues an outbox event, and
commits atomically.

## Planned API surface

- `GET /api/v1/jobs/:id/dump-trailer-rental`
- `POST /api/v1/jobs/:id/dump-trailer-rental`
- `POST /api/v1/dump-trailer-rentals/:id/actions/revise-plan`
- `POST /api/v1/dump-trailer-rentals/:id/debris-reviews`
- `POST /api/v1/rental-debris-reviews/:id/actions/:action`
- `POST /api/v1/dump-trailer-rentals/:id/actions/plan-schedule`
- `POST /api/v1/dump-trailer-rentals/:id/actions/evaluate-readiness`
- `POST /api/v1/dump-trailer-rentals/:id/actions/:executionAction`
- `POST /api/v1/dump-trailer-rentals/:id/extensions`
- `POST /api/v1/rental-extensions/:id/actions/:action`
- `POST /api/v1/dump-trailer-rentals/:id/pickup-attempts`
- `POST /api/v1/rental-pickup-attempts/:id/actions/:action`
- `POST /api/v1/dump-trailer-rentals/:id/disposal-loads`
- `POST /api/v1/disposal-loads/:id/actions/:action`
- `POST /api/v1/dump-trailer-rentals/:id/inspections`
- `POST /api/v1/rental-inspections/:id/actions/:action`
- `POST /api/v1/dump-trailer-rentals/:id/actions/reconcile`

All staff mutations require `Idempotency-Key`. Responses expose authoritative duration, weight,
overage, and readiness calculations; the browser never calculates financial totals.

## Delivery phases

### Phase 1 — Plan and data foundation

- add the six rental-owned tables
- add tenant-aware same-Job foreign keys, checks, indexes, RLS, grants, metadata triggers,
  immutability/history guards, and closed-Job guards
- extend Job Charge source types for rental operational records
- generate and review the forward migration
- add empty-database, tenant-isolation, service-type, weight, immutability, and closed-Job coverage

### Phase 2 — Rental planning and drop-off

- create the Rental Detail from accepted commercial terms
- perform debris, prohibited-material, placement, and access review
- plan drop-off, pickup, trailer occupancy, assignments, and route stops
- evaluate schedule/dispatch readiness
- execute pre-delivery inspection and drop-off through On Rent

Phase 2 is complete. The API derives rates and deposit terms from the accepted Estimate/Quote
snapshot; it never accepts authoritative money from the browser. Rental schedule planning creates
drop-off and pickup Schedule Blocks, their driver and truck assignments, customer Route Stops, and
one continuous trailer occupancy reservation atomically. Shared Job schedule and dispatch
transitions apply the rental-specific readiness gates. The focused PostgreSQL journey covers replay
and conflicting idempotency keys, invalid transition order, tenant isolation, inspection gating,
Audit Events, outbox events, and successful custody start.

### Phase 3 — Customer custody, extension, and pickup

- expose the current rental/occupancy read model
- request and evaluate Extensions against active/future Asset Reservations
- atomically extend occupancy and move pickup when approved
- execute pickup, preserve failed attempts, and end customer custody only on retrieval

Phase 3 is complete. Extension requests preserve the current pickup, requested pickup, historical
additional-day rate, server-calculated duration and amount, customer authorization, and the exact
pickup block and occupancy reservation being changed. Evaluation checks the trailer's extended
occupancy and shifted pickup-vehicle window. Approval repeats that check under transaction locks,
then moves pickup time, pickup Asset Reservations, and continuous trailer occupancy atomically.

Pickup Attempts derive their driver, truck, trailer, Schedule Block, and Route Stop from the
confirmed shared schedule. Execution is ordered through preparation, departure, arrival, failure or
retrieval. A failed attempt is immutable history and returns the Rental to On Rent without ending
customer custody. Only retrieval completes the pickup block and stop and records the custody-end and
actual-pickup timestamps; trailer occupancy remains active for disposal and final inspection.

### Phase 4 — Disposal, inspection, reconciliation, and charges

- execute accepted, rejected, redirected, partial, and completed Disposal Loads
- record gross, tare, net, canonical pounds, ticket, receipt, Expense, and empty-trailer evidence
- complete post-rental inspection and release or quarantine the trailer
- derive additional-day and rental-wide weight-overage Job Charges exactly once
- gate operational completion and invoice readiness

### Phase 5 — Web and final acceptance

- add dispatcher and reconciliation workflows to the staff Job workspace
- add mobile drop-off, pickup, disposal, and inspection driver workflows
- reuse Sprint 1.7 for Final Invoice, final Payment, security-deposit Refund, financial completion,
  and Project closure
- update OpenAPI and the generated client
- make `DTR-E2E-001` and its negative cases pass

## Acceptance coverage

`DTR-E2E-001` must prove:

- a Weekend package preserves $350, three included days, a $50 additional-day rate, 2,000 included
  pounds, an eight-cent-per-pound overage rate, and a $150 refundable security deposit
- drop-off and pickup reserve driver time separately while occupancy reserves the trailer
  continuously
- successful drop-off starts customer custody and successful retrieval ends it
- a one-day Extension moves pickup and occupancy only when no future trailer conflict exists
- the Extension creates one approved $50 Job Charge from the accepted historical rate
- one Disposal Load calculates 2,680 pounds from 15,620 gross and 12,940 tare
- ticket, receipt, Expense, and empty-trailer evidence are attributable
- rental-wide overage is 680 pounds and creates one $54.40 Job Charge
- the trailer cannot become Available until it is empty, inspected, and released
- Final Invoice totals $454.40 and payment allocation derives financial completion
- the $150 security deposit is refunded through its original method and resolved
- a reservation conflict blocks Extension approval
- prohibited material creates a Hold/Case decision rather than an automatic customer charge
- a failed pickup remains historical and does not complete the rental
- duplicate overage creation is rejected
- payment reversal reopens the Invoice, Job, and Project completion state
- foreign tenants cannot read or relate rental records

## Phase 1 completion checklist

- [x] all six ownership boundaries are represented without floating-point money or weight
- [x] one Rental Detail per Dump Trailer Rental Job is database-enforced
- [x] same-tenant and same-Job relationships are database-enforced
- [x] approved/completed operational outcomes preserve immutable history
- [x] closed Jobs reject ordinary rental-child changes
- [x] every new tenant table has forced RLS and tested tenant isolation
- [x] migration applies to empty and existing PostgreSQL databases
- [x] database and sprint documentation is current
- [x] `pnpm db:migrate` passes
- [x] database integration coverage passes
- [x] `pnpm check` passes

The complete integration gate remains required. A local object-storage HTTP 507 caused by host disk
capacity may defer the document portion of `pnpm test:integration`; it does not waive the gate.

## Phase 2 completion checklist

- [x] Rental terms are derived from the accepted Quote/Estimate snapshot
- [x] debris approval enforces attestation, access, legal towing, and prohibited-material rules
- [x] drop-off/pickup time and continuous trailer occupancy are reserved atomically
- [x] exact driver, truck, trailer, and Route Stop relationships are persisted
- [x] schedule and dispatch readiness are shared Job transition blockers
- [x] pre-drop-off inspection controls trailer release
- [x] ordered drop-off actions reach On Rent and set the trailer In Use
- [x] every command is tenant-scoped, idempotent, audited, and published through the outbox
- [x] permission metadata, invalid-state behavior, tenant isolation, and PostgreSQL journey pass
- [x] OpenAPI and the generated TypeScript client are current

## Phase 3 completion checklist

- [x] current rental, occupancy, Extension, and Pickup Attempt facts are exposed together
- [x] Extension duration and amount use the accepted historical additional-day rate
- [x] availability checks active trailer occupancy and shifted pickup-vehicle reservations
- [x] approval rechecks conflicts and atomically moves pickup and occupancy windows
- [x] a late reservation conflict blocks approval without partially changing the schedule
- [x] customer authorization and internal approval remain separate states
- [x] failed Pickup Attempts remain historical and customer custody continues
- [x] successful retrieval alone ends customer custody and completes pickup schedule records
- [x] the trailer stays In Use with active occupancy after retrieval
- [x] commands are tenant-scoped, idempotent, audited, and published through the outbox
- [x] permissions, invalid transitions, replay, conflict, tenant isolation, and PostgreSQL coverage
      pass
- [x] OpenAPI and the generated TypeScript client are current

## Phase 4 completion checklist

- [x] each Disposal Load receives an attributable schedule, driver, truck, trailer, facility, and
      Route Stop
- [x] facility rejection and redirection preserve terminal source history and use a replacement Load
- [x] gross, tare, net, and canonical pounds are calculated with fixed-point decimal arithmetic
- [x] ticket, receipt, empty-trailer evidence, and disposal Expense are linked to the accepted Load
- [x] rental-wide actual and overage weights derive only from reconciled Disposal Loads
- [x] post-rental inspection releases occupancy and returns the trailer to Available or quarantines
      it
- [x] approved Extensions create one Ready-to-Invoice additional-day Job Charge from historical
      terms
- [x] final reconciliation creates one Ready-to-Invoice rental-wide weight-overage Job Charge
- [x] operational completion requires resolved disposal, empty evidence, inspection, released
      occupancy, and resolved operational charges
- [x] commands are tenant-scoped, idempotent, audited, and published through the outbox
- [x] rejected/replacement, tenant isolation, replay, exact charge, and PostgreSQL journey coverage
      pass
- [x] migration `0011` accepts terminal rejected/redirected Loads only after a reconciled
      replacement
- [x] OpenAPI and the generated TypeScript client are current
