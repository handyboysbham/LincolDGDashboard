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

Status: implementation complete; production approval pending.

- [x] package production deployment configuration and environment validation
- [x] implement backup creation, verification, restore rehearsal, and recovery runbooks
- [x] run security, tenant-isolation, authorization, accessibility, reliability, and performance
      hardening
- [x] close remaining operational logging, health, queue, and failure-recovery gaps
- [x] execute both canonical V1 journeys from a clean database and from a restored backup
- [x] reconcile migrations, OpenAPI, generated client, domain documentation, and operator guidance
- [x] record local release-candidate evidence with no unresolved critical defects and explicit
      remote go/no-go gates

## Phase 3 — Google Drive documents and off-site Supabase Free backups

Status: implementation complete; provider provisioning and production evidence pending.

- [x] add provider-neutral Document ownership and forward-only migration `0019`
- [x] retain MinIO for local development and add Google Workspace Shared Drive production storage
- [x] proxy Drive transfers through scoped expiring capabilities without public file permissions
- [x] allocate retry-safe Drive file IDs, pin binary revisions, and persist revision ownership
- [x] add Drive folder readiness and a private retained-revision release probe
- [x] add a daily official Supabase CLI logical export workflow
- [x] encrypt backups with authenticated AES-256-GCM before uploading to a separate Backups Shared
      Drive and separate service account
- [x] add backup decryption/authentication tooling and operator guidance
- [ ] apply `0019`, provision both Shared Drives and identities, escrow the encryption key, dispatch
      the first backup, and record a successful restore rehearsal

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

## Phase 2 closeout evidence

- The database integration suite passes all 26 tests from an isolated PostgreSQL database, including
  the controlled tenant-foundation and first-owner bootstraps, exact replay, release-role
  enforcement, and competing-candidate serialization. After local storage capacity was restored, the
  server integration suite passes all 38 tests, including the three document-storage journeys.
- `pnpm test:recovery` passes both canonical restored-database journeys: two files and five tests,
  including exact release and cross-tenant RLS verification.
- `pnpm api:check` confirms the OpenAPI `1.10.0` document and generated client are current.
- `pnpm test:e2e` passes 31 production route journeys and three production-auth boundary journeys.
- `pnpm check` passes formatting, lint, type checking, 228 unit tests, infrastructure checks, and
  all production builds.
- Browser acceptance verifies the Supabase sign-in boundary, semantic form controls, security
  headers, protected-route redirect, and a 390-pixel viewport without horizontal overflow.
- The verified `0017` hosted artifact differs from the committed hash, so forward-only migration
  `0018` reasserts the full release posture and promotes the candidate to `1.10.0-rc.2` without
  rewriting history.
- Hosted migration `0018` is recorded in Drizzle history with the reviewed hash
  `2359933123236fe83e54e95086a02da7d0b50dad53a48c980ed6dc506a6851d5`; the release marker, extension
  placement, operational privileges, RLS posture, function search paths, and runtime marker access
  pass post-apply verification, and Supabase security advisors return no findings.
- The candidate remains a production no-go until production environment validation passes with
  deployed values and backup/PITR, object versioning, first-owner bootstrap, and release approval
  are recorded.
- The production closeout follow-up adds a privileged, idempotent tenant-foundation bootstrap so an
  empty hosted database can be initialized without ad-hoc SQL. The database suite now passes 26
  tests, covering atomic foundation creation, exact replay, changed-input rejection, and
  release-role enforcement. A live object-storage probe now verifies two retained object versions
  before cleaning up only its uniquely named test versions.
- The hosted release remains an automatic no-go: the database is at `1.10.0-rc.2` but has no tenant
  or Auth user, the Vercel production web variables await an API origin, and the API/worker host,
  Google Drive identities, first encrypted backup evidence, and production acceptance still require
  operator execution.

## Phase 3 closeout evidence

- `pnpm check` passes formatting, lint, type checking, 238 unit tests, infrastructure validation,
  and the API and web production builds.
- `pnpm test:integration` passes 27 database and 39 server tests. The Document acceptance journey
  now covers both local S3-compatible storage and the production Google Drive transfer proxy backed
  by PostgreSQL, including retained revision metadata.
- `pnpm api:check` confirms the private binary transfer routes are represented in OpenAPI and the
  generated client; local forward migration reports current at `1.10.0-rc.3`.
- Live migration `0019`, distinct Documents and Backups Shared Drives and service accounts, the
  first encrypted scheduled backup and restore rehearsal, and the persistent API/worker host remain
  operator closeout work. The release therefore remains **NO-GO**.
