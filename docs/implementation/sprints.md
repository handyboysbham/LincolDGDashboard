# V1 Sprint Roadmap

## Purpose

This roadmap converts the build sequence into reviewable delivery increments. Sprint numbers use a
release-style `major.minor.patch` identifier. They describe planned product increments; they do not
require publishing the root package at that version until the increment is accepted.

The completed root-tooling and host-native infrastructure work is the baseline. Development starts
with Sprint `1.0.0`.

## Rules for every sprint

Each sprint must:

- produce demonstrable behavior rather than isolated tables or screens
- preserve tenant context, Row-Level Security, audit, outbox, and idempotency requirements
- use application commands for state transitions
- include success, invalid-state, permission, and tenant-isolation tests where applicable
- update OpenAPI, generated clients, migrations, and documentation when affected
- finish with `pnpm check`
- additionally run `pnpm db:migrate` and `pnpm test:integration` for database changes
- additionally run `pnpm api:check` for API changes
- run the relevant acceptance journey for business-workflow changes

An increment is complete only after its acceptance gates pass. Unfinished scope moves to a later
increment; the acceptance criteria are not silently weakened.

## Sprint 1.0.0 — Platform Data Foundation

Status: Completed on 2026-08-02.

### Goal

Establish the PostgreSQL system of record and the transaction primitives required by every later
business module.

### Scope

- Drizzle database package and reviewed migration workflow
- organizations, users, roles, and user-role assignments
- number sequences
- tenant transaction context and Row-Level Security
- idempotency keys
- Audit Events
- transactional outbox
- scheduled jobs and worker heartbeats
- Document metadata and document links
- local development seed data

### Acceptance gates

- migrations apply to an empty PostgreSQL database
- runtime role cannot bypass Row-Level Security
- cross-tenant reads, writes, and foreign-key attempts fail
- concurrent number allocation produces no duplicates
- idempotent command replay returns the original result
- business data, Audit Event, and outbox event commit or roll back together
- two claimers cannot process the same outbox or scheduled-job record concurrently

## Sprint 1.1.0 — API and Worker Foundation

Status: Completed on 2026-08-02.

### Goal

Expose a secure application boundary and reliable background-processing shell over Sprint 1.0.0.

### Scope

- NestJS API and worker processes
- Fastify adapter and `/api/v1` routing
- configuration and environment validation
- request correlation and structured error contract
- development authentication guardrails
- tenant and permission request context
- live and readiness health endpoints
- idempotency middleware or command integration
- outbox processing, retries, and worker heartbeat
- OpenAPI generation and API-client generation

### Acceptance gates

- API and worker start independently
- readiness detects database, migration, object-storage, and required-configuration failures
- tenant identity cannot be selected by an arbitrary browser header
- one outbox event is processed once under two workers
- OpenAPI output and generated client are current

## Sprint 1.2.0 — Web and Document Foundation

Status: Completed on 2026-08-03.

### Goal

Provide the first usable staff, driver, and customer shells with secure document storage.

### Scope

- Next.js application shell
- staff navigation and dashboard placeholders
- mobile-first driver shell
- customer public-link failure states
- typed API-client integration
- pending-upload, validation, availability, and download flow
- private bucket and scoped application credentials
- expiring, scoped, revocable, hashed public-link tokens

### Acceptance gates

- web uses the API and never connects directly to PostgreSQL
- authorized upload and download succeed
- cross-tenant and expired/revoked link access fail
- signed URLs and credentials are absent from logs
- bootstrap acceptance journey `BOOT-E2E-001` passes

## Sprint 1.3.0 — Customer Intake

Status: Completed on 2026-08-03.

### Goal

Capture a complete, tenant-isolated service opportunity for either supported service.

### Scope

- Customer Accounts, Contacts, and Service Locations
- Material Delivery and Dump Trailer Rental Leads
- one-service-type-per-Lead validation
- Notes, Tasks, Documents, and timeline
- duplicate lookup and warnings
- Lead lifecycle commands and permissions

### Acceptance gates

- staff can create complete Leads for both service types
- mixed-service Leads are rejected
- transitions create Audit and outbox events atomically
- duplicate records are warned about without destructive merging
- tenant and permission tests pass

## Sprint 1.4.0 — Pricing, Estimates, and Quotes

Implementation status: complete in the 1.4.0 workspace change set.

### Goal

Turn a qualified Lead into a versioned, customer-visible offer with authoritative server-side
pricing.

### Scope

- materials, suppliers, supplier costs, and delivery zones
- Pricing Policies, Versions, Rules, and controlled calculation types
- Estimate parents and immutable approved Estimate Versions
- Quote parents, immutable commercial Quote Versions, delivery, and view tracking
- approval, send, decline, expiration, withdrawal, supersession, and revision commands
- secure Quote view and acceptance evidence
- idempotent Project creation from acceptance

### Acceptance gates

- both services produce reproducible prices from versioned inputs
- browser-supplied totals are never authoritative
- approved Estimate and sent commercial Quote content cannot be edited
- expired, withdrawn, or superseded Quotes cannot be accepted
- repeated acceptance creates exactly one Project

## Sprint 1.5.0 — Projects, Contracts, Jobs, and Scheduling

Implementation status: complete in the 1.5.0 workspace change set.

### Goal

Convert accepted work into independently scheduled operational Jobs.

### Scope

- Projects and controlled Project lifecycle
- Contracts, signatures, and deposit/contract readiness
- shared Jobs and service-specific numbering
- readiness evaluations
- Schedule Blocks, assignments, assets, and Asset Reservations
- Route Stops, Checklists, Job Events, holds, and reopening
- calendar and jobs-needing-scheduling work queue

### Acceptance gates

- accepted Quote has one Project and the correct initial Job creation policy
- one independently scheduled trip or rental is one Job
- contract or deposit requirements can block scheduling
- overlapping active asset reservations are rejected transactionally
- closed, financially complete Jobs reject ordinary edits
- secure Contract links expose customer-safe content and immutable signature evidence only
- Project, Job, calendar, schedule queue, and customer Contract production routes load successfully

## Sprint 1.6.0 — Material Delivery Operations

Implementation status: the operational vertical slice is complete as of 2026-08-04. Migration `0006`
and the Drizzle schema own the data model. Explicit idempotent REST commands cover planning, safety,
driver execution, evidence, quantity reconciliation, supplier Expenses and Allocations, operational
Job Charges, and invoice readiness. The staff Job workspace and mobile driver routes use the
generated API client and expose the appropriate dispatcher, driver, and reconciliation commands.
PostgreSQL integration coverage, the operational portion of `MD-E2E-001`, production web acceptance,
OpenAPI, and the generated client are current. Full invoice, payment, and financial completion
continue in Sprint 1.7.0. See the
[Sprint 1.6.0 implementation plan](plans/2026-08-03-sprint-1-6-0-material-delivery-operations.md).

### Goal

Execute a multi-material delivery through operational and invoice readiness.

### Scope

- Material Delivery Detail
- Material Loads and Load Items
- supplier and placement Route Stops
- capacity, payload, compatibility, and separation validation
- driver loading, transit, unloading, and evidence workflow
- planned, purchased, loaded, and delivered quantity reconciliation
- supplier Expenses and Expense Allocations
- substitutions, partial delivery, variances, and operational Job Charges

### Acceptance gates

- the operational portion of `MD-E2E-001` passes
- unsafe or overweight dispatch cannot be overridden
- separately scheduled follow-up delivery requires another Job
- missing required receipts block invoice readiness
- duplicate operational charges are prevented

## Sprint 1.7.0 — Invoicing and Payments

Implementation status: complete as of 2026-08-09. Financial data, Invoices, Payments, Advance
Payment Deposits, Customer Credits, Refunds, whole-Payment reversal, derived financial completion,
staff Finance workflows, and secure customer Invoice delivery are implemented. See the
[Sprint 1.7.0 implementation plan](plans/2026-08-04-sprint-1-7-0-invoicing-payments.md).

### Goal

Complete Material Delivery from approved charges through payment and financial closure.

### Scope

- Job Charge authorization and approval
- Invoice parents, Versions, line items, posting, delivery, and adjustments
- Deposit, Final, Additional Charge, and Credit Memo invoices
- Payments, Allocations, Deposit Balances, and Deposit Applications
- Customer Credits and their application records
- Refunds, reversals, partial payments, and overpayments
- Job and Project financial-completion evaluation

### Acceptance gates

- the full `MD-E2E-001` journey passes
- posted Invoice Versions and applied Allocations are immutable
- deposit and credit applications cannot be duplicated
- payment reversal reopens every affected balance and completion state
- authoritative balances reconcile from source transactions

## Sprint 1.8.0 — Dump Trailer Rental

Implementation status: Phases 1 through 4 complete as of 2026-08-09. The data foundation,
accepted-term planning, safety review, schedule/occupancy planning, readiness, pre-drop-off
inspection, drop-off through On Rent, reservation-safe Extensions, durable failed Pickup Attempts,
successful retrieval with custody end, disposal rejection and replacement, fixed-point weight and
evidence reconciliation, disposal Expenses, post-rental inspection, trailer release, derived
additional-day and weight-overage Charges, and operational completion are implemented. See the
[Sprint 1.8.0 implementation plan](plans/2026-08-09-sprint-1-8-0-dump-trailer-rental.md).

### Goal

Execute a Dump Trailer Rental through drop-off, customer custody, extension, pickup, disposal,
inspection, final billing, security-deposit resolution, and financial closure.

### Scope

- Dump Trailer Rental Detail and accepted-term snapshot
- debris, prohibited-material, access, and placement review
- drop-off, continuous trailer occupancy, and pickup execution
- reservation-safe Extensions and additional-day charges
- durable failed Pickup Attempts
- Disposal Loads, facility outcomes, weight, evidence, Expenses, and reconciliation
- post-rental inspection, cleaning, damage review, and trailer release
- rental-wide overage Job Charges
- staff, driver, and final finance workflows

### Acceptance gates

- the full `DTR-E2E-001` journey passes
- an Extension conflict cannot be overridden
- customer custody ends only on successful retrieval
- rejected or redirected Disposal Loads preserve their original history
- a rental cannot complete while the trailer remains loaded or uninspected
- additional-day and rental-wide overage charges are created exactly once
- the security deposit resolves through a traceable application or Refund

## Sprint 1.9.0 — Communications and Customer Experience

Implementation status: complete as of 2026-08-11, including clean-database communications coverage
and production-build mobile and keyboard acceptance. The tenant-isolated notification model,
immutable Template publication, customer preferences, idempotent delivery, automatic lifecycle
policies and reminders, configured email and optional SMS adapters, operational retry visibility,
hashed Project capabilities, staff Communications workspace, and responsive customer Project
experience are implemented and verified. See the
[Sprint 1.9.0 implementation plan](plans/2026-08-09-sprint-1-9-0-communications-customer-experience.md).

### Goal

Make project progress and financial communication usable without exposing internal data.

### Scope

- email and optional SMS templates
- Quote, Contract, schedule, on-the-way, completion, Invoice, receipt, and Refund notifications
- notification preferences, retries, and delivery history
- customer Project summary
- customer-visible documents, invoices, and receipts

### Acceptance gates

- notifications originate from committed outbox events
- provider retries are idempotent
- customer views exclude costs, margins, internal notes, and approval discussions
- revoked or expired customer links fail safely

## Sprint 1.10.0 — Administration and Launch Readiness

### Goal

Harden V1 for production operation and complete the release candidate.

### Scope

- configuration screens and controlled version publishing
- users, roles, assets, suppliers, facilities, and company payment accounts
- checklist and notification administration
- Audit Event viewer
- operational dashboards and basic search
- backup and restore procedure
- security, accessibility, reliability, and performance verification
- deployment packaging and production runbooks

### Acceptance gates

- both canonical acceptance journeys pass from a clean environment
- backup restoration is demonstrated
- tenant isolation and authorization suites pass
- no critical security, accessibility, or data-integrity defects remain
- migrations, OpenAPI, generated client, and documentation are current

### Delivery phases

1. Administration and operational visibility: configuration publishing, users and roles, reference
   data, payment accounts, checklists, notification administration, audit history, dashboards, and
   basic search.
2. Launch hardening and release candidate: backup restoration, deployment packaging, production
   runbooks, security, accessibility, reliability, performance, clean-environment acceptance, and
   final artifact verification.

## Release policy

Sprint identifiers are planned increments, not automatic releases. Tagging or publishing a version
requires all acceptance gates for that increment, reviewed migrations and generated artifacts, and a
clean required-check run. Production rollback uses forward corrections or a reviewed deployment
rollback; applied production migrations remain forward-only.
