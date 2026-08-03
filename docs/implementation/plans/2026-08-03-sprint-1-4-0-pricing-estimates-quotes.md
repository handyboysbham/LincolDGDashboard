# Sprint 1.4.0 Pricing, Estimates, and Quotes Plan

## Objective

Turn a qualified Lead into a reproducible, versioned, customer-visible offer. The server owns every
authoritative calculation, approved Estimate and sent Quote content is immutable, secure customer
actions preserve evidence, and accepting a Quote creates exactly one Project.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/object-model.md`
- `docs/architecture/state-transitions.md`
- `docs/architecture/technical-architecture.md`
- `docs/architecture/v1-build-readiness.md`
- `docs/domains/sales-and-intake.md`
- `docs/domains/project-and-job.md`
- `docs/implementation/acceptance-journeys.md`
- `docs/implementation/sprints.md`

## Data ownership

- Material, Supplier, Supplier Location, Supplier Material, Supplier Cost Version, and Delivery Zone
  are tenant-owned pricing reference records.
- Pricing Policy is the named pricing strategy for one service type. Pricing Versions preserve the
  rules in effect for a calculation; activation retires any prior active version without changing
  historical calculations.
- Estimate is the one internal pricing decision-support record for a Lead. Estimate Versions own
  immutable approved inputs, costs, rule results, readiness, price, deposit, and margin.
- Quote is the customer-offer lifecycle for an Estimate. Quote Versions own immutable commercial
  snapshots, line items, terms, totals, expiration, and content hashes.
- Quote Delivery records when and where a secure offer was sent. Quote Public Link stores only a
  hash of its deterministic capability secret.
- Quote Acceptance owns the accepting Contact, name, method, consent, timestamp, content hash, and
  request evidence.
- Sprint 1.4.0 creates the minimal Project identity required by acceptance. Sprint 1.5.0 expands the
  Project into contracts, Jobs, scheduling, readiness, and operational workflows.

## Controlled pricing model

No rule contains executable code or an arbitrary expression. The application recognizes an allowlist
of typed calculation codes and validates integer-cent or controlled-decimal parameters.

Material Delivery supports:

- supplier purchase cost from immutable Supplier Cost Versions
- quantity multiplied by an integer-cent unit rate using three-decimal quantities
- percentage markup in basis points
- fixed Delivery Zone charge
- additional supplier-stop charge
- separate-placement charge
- greater-of deposit against purchase cost and a configured minimum
- deposit rounding upward to a controlled integer-cent increment

Dump Trailer Rental supports:

- fixed package amount
- included rental days and controlled additional-day amount
- included weight and integer cents per pound overage rate preserved for later Job Charges
- fixed refundable security deposit

Every Estimate stores an input snapshot, Pricing Version, itemized cost records, calculation
results, and integer-cent totals. The browser may preview inputs but never submits or calculates an
authoritative subtotal, total, deposit, cost, or margin.

## Versioning and immutability

```text
Pricing Version: Draft → Active → Retired
Estimate: Draft → In Analysis → Pending Approval → Approved → Quote Generated
Quote Version: Draft → Ready to Send → Sent → Viewed → Accepted
Alternatives: Declined | Expired | Withdrawn | Superseded
```

- only one active Pricing Version exists per Pricing Policy
- one Estimate exists per Lead and revision creates the next Estimate Version
- approval records the content hash and makes Estimate inputs, costs, and results immutable
- creating a Quote changes the approved Estimate Version to Quote Generated without changing its
  commercial content
- Quote approval snapshots the current customer, location, service scope, terms, line items, and
  authoritative totals
- sent, viewed, accepted, declined, expired, withdrawn, and superseded Quote Version commercial
  content cannot be updated or deleted
- Quote revision supersedes the prior nonaccepted version and creates the next draft version
- acceptance is unique per Quote Version and Project is unique per accepted Quote Version

Database triggers enforce version-content and child-row immutability in addition to application
commands.

## API surface

Pricing:

- `GET /api/v1/pricing/configurations`
- `POST /api/v1/pricing/configurations`
- `POST /api/v1/pricing/versions/:id/actions/activate`

Estimates:

- `GET /api/v1/estimates`
- `GET /api/v1/estimate-versions/:id`
- `POST /api/v1/leads/:id/estimate-versions`
- `POST /api/v1/estimate-versions/:id/actions/submit`
- `POST /api/v1/estimate-versions/:id/actions/approve`
- `POST /api/v1/estimate-versions/:id/actions/create-quote`
- `POST /api/v1/estimates/:id/actions/revise`

Quotes:

- `GET /api/v1/quotes`
- `GET /api/v1/quotes/:id`
- `POST /api/v1/quote-versions/:id/actions/approve`
- `POST /api/v1/quote-versions/:id/actions/send`
- `POST /api/v1/quote-versions/:id/actions/withdraw`
- `POST /api/v1/quote-versions/:id/actions/expire`
- `POST /api/v1/quotes/:id/actions/revise`
- `GET /api/v1/public/quotes/:token`
- `POST /api/v1/public/quotes/:token/actions/decline`
- `POST /api/v1/public/quotes/:token/actions/accept`

Critical staff commands require an `Idempotency-Key`. Public acceptance is naturally idempotent by
the unique Quote Acceptance and Project constraints and rejects a different replay body.

## Secure Quote links

Sending creates or reuses an expiring, revocable, Quote-Version-scoped capability. The token
contains tenant and link identifiers plus a purpose-separated HMAC secret. PostgreSQL stores only
the secret hash, request hash, expiration, and revocation metadata. Public routes resolve tenant
context only from a valid capability and never accept an unrestricted tenant header.

View tracking changes Sent to Viewed atomically with Audit and outbox events. Expired, revoked,
withdrawn, superseded, declined, or already accepted offers fail closed where appropriate.

## Acceptance and Project conversion

Acceptance locks the public link, Quote Version, Quote, Estimate, and Lead when required. It
confirms the current version, expiration, content hash, accepting Contact, consent, and allowed
state. One transaction then creates Quote Acceptance and Project, marks Quote and Lead Accepted,
creates Audit Events and outbox events, and returns the existing result on an identical replay.

The minimal Project stores its business number, customer, service location, accepted Quote Version,
service type, outcome statement, owner, and Pending Setup status.

## Web surfaces

- `/pricing`: pricing configuration list and guided Material Delivery or Rental setup
- `/estimates`: pricing work queue with loading, empty, error, and populated states
- `/estimates/:id`: internal cost, calculation, price, deposit, margin, approval, revision, and
  Quote creation workflow
- `/quotes/:id`: staff commercial preview, approval, delivery, view state, revision, withdrawal, and
  expiration workflow
- `/customer/quotes/:token`: secure customer offer with available, expired, withdrawn, superseded,
  declined, accepted, and invalid states plus decline and acceptance forms

Customer surfaces never expose supplier cost, internal margin, pricing rules, operational
assessment, risk assessment, approval notes, or employee activity.

## Permissions

- `pricing:read`, `pricing:write`, `pricing:approve`
- `estimates:read`, `estimates:write`, `estimates:approve`
- `quotes:read`, `quotes:write`, `quotes:approve`, `quotes:send`
- `projects:read` for the Project result returned to staff

## Completion checklist

- [x] reviewed forward migration applies to an empty PostgreSQL database
- [x] all new tenant tables have forced RLS, grants, and tenant-aware relationships
- [x] canonical Material Delivery pricing produces $184 cost, $420 total, and $185 deposit
- [x] canonical Rental pricing produces a $350 package and preserves later-charge rates
- [x] browser-supplied authoritative totals are absent from API inputs
- [x] Pricing activation and Estimate/Quote transitions create Audit and outbox events atomically
- [x] approved Estimate content and child records are immutable
- [x] sent and terminal Quote content and child records are immutable
- [x] expiration, withdrawal, supersession, decline, and revision rules pass
- [x] secure Quote tokens are scoped, expiring, revocable, and stored only as hashes
- [x] repeated acceptance creates one Quote Acceptance and one Project
- [x] tenant, permission, invalid-state, idempotency, and concurrency tests pass
- [x] staff and customer web states are responsive and customer-safe
- [x] OpenAPI and generated client artifacts are current
- [x] architecture, domain, acceptance, runbook, and sprint documentation are current
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm api:check` passes
- [x] `pnpm test:e2e` passes
- [x] `pnpm check` passes
