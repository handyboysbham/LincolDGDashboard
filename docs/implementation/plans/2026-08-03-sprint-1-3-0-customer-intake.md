# Sprint 1.3.0 Customer Intake Plan

Status: Completed on 2026-08-03.

## Objective

Deliver a complete tenant-isolated intake workflow for Material Delivery and Dump Trailer Rental
opportunities. Staff can create or reuse customer records, capture one service type, work the Lead
through controlled states, and see its notes, tasks, documents, and audit-backed timeline.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `docs/architecture/v1-build-readiness.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/object-model.md`
- `docs/architecture/state-transitions.md`
- `docs/domains/sales-and-intake.md`
- `docs/implementation/sprints.md`
- `docs/implementation/acceptance-journeys.md`

## Data ownership

- Customer Account owns the continuing customer relationship.
- Contact is a reusable person or communication identity and can be linked to multiple accounts or
  locations.
- Service Location belongs to one Customer Account and stores reusable service-address and access
  facts.
- Lead belongs to one Customer Account, uses one linked primary Contact and one Service Location,
  and represents one Material Delivery or Dump Trailer Rental opportunity.
- Lead Notes and Tasks belong to one Lead. Document metadata remains owned by the Documents module
  and connects through the existing `document_links` relation.
- Timeline is a read model assembled from immutable Audit Events and Lead activity records; it is
  not a second mutable event store.

## Intake command

`POST /api/v1/intake/leads` accepts either existing identifiers or nested new records for the
Customer Account, primary Contact, and Service Location. It creates the new records and Lead in one
tenant transaction and requires an `Idempotency-Key`.

The command accepts exactly one service detail object:

- Material Delivery: material description, controlled decimal estimated quantity, quantity unit, and
  optional delivery instructions.
- Dump Trailer Rental: start date, end date, debris type, and optional delivery instructions.

Database checks and application validation reject a mixed-service Lead or an incomplete detail
object. Browsers never select tenant context.

## Duplicate warnings

Duplicate lookup uses normalized customer names, contact email or phone, and complete service
addresses within the current tenant. Matches return warnings and stable record identifiers. They do
not merge, delete, or silently reuse records. Staff may continue after reviewing the warning.

## Lead lifecycle

Sprint 1.3.0 exposes explicit commands for the states owned by intake:

```text
New → Contacting → Qualified → Estimating
New | Contacting | Qualified | Estimating → Lost | Cancelled | Duplicate | Disqualified
```

Later sprints own Quoted and Accepted transitions. Every lifecycle command locks the Lead, confirms
its current state, checks permission, writes an Audit Event and outbox event, and commits
atomically.

## API surface

- `POST /api/v1/intake/actions/check-duplicates`
- `POST /api/v1/intake/leads`
- `GET /api/v1/customers`
- `GET /api/v1/customers/:id`
- `GET /api/v1/leads`
- `GET /api/v1/leads/:id`
- `POST /api/v1/leads/:id/notes`
- `POST /api/v1/leads/:id/tasks`
- `POST /api/v1/leads/:id/tasks/:taskId/actions/complete`
- `POST /api/v1/leads/:id/documents`
- explicit Lead lifecycle action endpoints under `/api/v1/leads/:id/actions/*`

## Web surfaces

- Customer workspace with search, empty, loading, error, and populated states
- guided New Lead form with service-specific fields and duplicate warnings
- Lead workspace with service, customer, location, activity, tasks, documents, and lifecycle actions
- responsive layouts and touch-friendly controls using the existing staff shell and generated API
  client

## Security and integrity

- every new table includes `tenant_id`, forced Row-Level Security, and runtime grants
- tenant-aware foreign keys prevent cross-tenant customer, contact, location, Lead, task, and note
  relationships
- normalized duplicate keys are tenant-scoped and never used to merge automatically
- state is changed only by explicit application commands
- critical retryable writes require idempotency
- every meaningful write creates an Audit Event and transactional outbox event
- customer-facing surfaces never expose employee notes or internal activity

## Completion checklist

- [x] customer-intake migration is reviewed and applies cleanly
- [x] RLS and cross-tenant foreign-key tests pass
- [x] both complete service-specific Lead commands pass
- [x] mixed-service and incomplete Leads are rejected
- [x] duplicate warnings work without destructive merging
- [x] lifecycle success, invalid-state, permission, tenant, and idempotency tests pass
- [x] Notes, Tasks, Documents, and timeline are available on Lead detail
- [x] customer and Lead web workflows cover loading, empty, error, and success states
- [x] OpenAPI and typed client artifacts are current
- [x] architecture, runbook, acceptance, and sprint documentation are current
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm api:check` passes
- [x] `pnpm test:e2e` passes
- [x] `pnpm check` passes
