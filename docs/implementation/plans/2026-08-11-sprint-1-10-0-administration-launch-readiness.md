# Sprint 1.10.0 Administration and Launch Readiness Plan

## Goal

Complete the staff administration and operational-visibility foundation, then harden the full V1
system into a deployable release candidate with repeatable recovery and acceptance evidence.

## Constraints

- Administration remains part of the NestJS modular monolith and uses the generated REST client.
- The web application never connects directly to PostgreSQL or Supabase.
- Every administration query runs inside tenant context; every new tenant table has forced RLS and
  an explicit restricted-runtime grant.
- Configuration changes use explicit commands, permissions, Audit Events, outbox events, and
  idempotency. Clients never patch status fields directly.
- Published checklist and notification versions are immutable. Corrections create a new version.
- Company payment accounts store only safe staff-facing references, never credentials, access
  tokens, raw card data, or employee personal-payment details.
- Supplier facilities remain `supplier_locations` for V1 because delivery and rental operations
  already reference that tenant-safe aggregate. A second facility table would split ownership.
- Existing notification administration and controlled Pricing Version publication remain owned by
  their current modules and are linked from the administration workspace rather than duplicated.

## Phase 1 — Administration and operational visibility

Status: complete.

- [x] add controlled company payment accounts and reusable versioned checklist templates
- [x] attach checklist instances and new Payments to controlled configuration without rewriting
      historical snapshots
- [x] add reviewed RLS, restricted-runtime grants, indexes, immutability, and no-delete protections
- [x] expose tenant-safe administration overview, Users/Roles, assets, suppliers/facilities, payment
      accounts, checklist templates, Audit Events, and basic cross-domain search
- [x] add idempotent administration commands with explicit permissions, Audit Events, and outbox
      events
- [x] publish checklist versions through a lock/readiness/retire-current/publish transaction
- [x] deliver a responsive `/settings` workspace with loading, empty, error, success, keyboard, and
      mobile states
- [x] connect the staff search entry point to authoritative server-side results
- [x] document configuration ownership, payment-account safety, and checklist publication rules
- [x] complete the administration integration and production-route acceptance journey

## Phase 2 — Launch hardening and release candidate

Status: planned.

- [ ] package production deployment configuration and environment validation
- [ ] implement backup creation, verification, restore rehearsal, and recovery runbooks
- [ ] run security, tenant-isolation, authorization, accessibility, reliability, and performance
      hardening
- [ ] close remaining operational logging, health, queue, and failure-recovery gaps
- [ ] execute both canonical V1 journeys from a clean database and from a restored backup
- [ ] reconcile migrations, OpenAPI, generated client, domain documentation, and operator guidance
- [ ] record release-candidate evidence with no unresolved critical defects

## Phase 1 acceptance

1. A permitted owner lists Users and Roles, adds a company-controlled payment account, creates a
   checklist draft with ordered items, and publishes the version.
2. Replaying each command with the same idempotency key returns the same result without duplicate
   rows, Audit Events, or outbox events.
3. Publication locks the draft, validates at least one item, retires the prior published version,
   and prevents edits or deletion of published history.
4. A Job checklist instance can retain the published Template identity while snapshotting its code,
   name, and items for operational execution.
5. The administration overview reports actionable counts; search returns only the current tenant's
   customers, Projects, Jobs, Invoices, and Payments with stable detail paths.
6. The Audit Event viewer filters by entity and event type without exposing another tenant.
7. A read-only administrator cannot execute commands, a user without administration access cannot
   read the workspace, and a foreign-tenant identifier is rejected.
8. The production `/settings` route presents usable loading, empty, error, success, validation,
   keyboard, and narrow-viewport states.

## Required validation

```bash
pnpm db:migrate
pnpm test:integration
pnpm api:check
pnpm test:e2e
pnpm check
```

## Phase 1 closeout evidence

- `pnpm db:migrate` reports the migration set as current.
- `pnpm test:integration` passes 18 database tests and 38 server tests, including the new
  administration foundation and updated canonical material-delivery journey.
- `pnpm api:check` regenerates a current OpenAPI document and typed client.
- `pnpm test:e2e` builds the production web application and passes all 31 route tests, including
  `/settings`.
- `pnpm check` passes formatting, lint, type checking, 209 unit tests, infrastructure checks, and
  production builds.
- Browser acceptance verifies the administration search, payment-account safety workflow, checklist
  workspace, keyboard-closeable mobile navigation, and a 390-pixel viewport without horizontal
  overflow.
