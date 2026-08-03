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

## Sprint 1.6.0 — Material Delivery Operations

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

### Goal

Complete the canonical rental journey, including extension, disposal, overage, inspection, and
security-deposit resolution.

### Scope

- Dump Trailer Rental Detail
- drop-off and pickup Schedule Blocks
- continuing trailer occupancy reservation
- on-rent custody and extension workflow
- failed pickup and prohibited-material handling
- Disposal Loads, weights, receipts, and Expenses
- rental-wide allowance and overage calculation
- inspection, cleaning, damage review, and asset release
- security-deposit refund or other controlled resolution

### Acceptance gates

- `DTR-E2E-001` passes
- reservation conflicts block extension approval
- one rental-wide overage charge is created idempotently
- rental cannot complete while loaded or awaiting inspection
- settled Refunds remain immutable

## Sprint 1.9.0 — Communications and Customer Experience

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

## Release policy

Sprint identifiers are planned increments, not automatic releases. Tagging or publishing a version
requires all acceptance gates for that increment, reviewed migrations and generated artifacts, and a
clean required-check run. Production rollback uses forward corrections or a reviewed deployment
rollback; applied production migrations remain forward-only.
