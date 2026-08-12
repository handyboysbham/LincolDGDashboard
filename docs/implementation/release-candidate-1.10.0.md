# V1.10.0 Release Candidate Record

## Candidate

- release marker: `1.10.0-rc.2`
- schema migration: `0018_release_readiness_reconciliation`
- API contract version: `1.10.0`
- decision date: 2026-08-11
- hosted database verification date: 2026-08-12

## Implemented launch controls

- Supabase JWT verification with trusted `app_metadata.tenant_id`
- database-backed active User and Role permission resolution
- protected Next.js staff and driver routes with Supabase SSR cookies
- idempotent, audited Auth identity linking for subsequent staff Users
- one immutable production image with API, worker, and web process modes
- fail-closed, secret-redacting production environment validation
- exact database release, tenant queue, object-storage, and worker readiness
- token-safe structured request completion logs and graceful worker drain
- security response headers and a responsive accessible staff sign-in surface
- custom-format logical backup, checksum verification, safe restore rehearsal, and cleanup
- restored-database acceptance for `MD-E2E-001` and `DTR-E2E-001`
- Supabase security-advisor remediation for function search paths, operational-table grants,
  extension placement when owner privileges allow, and public security-definer execution
- forward-only reconciliation of the reviewed `0017` artifact variance without rewriting migration
  history

## Evidence

- [x] local forward migration reports current
- [x] server and web type checking passes
- [x] 181 server, 42 web, and 1 generated-client unit tests pass
- [x] restored canonical acceptance passes: 2 files, 5 tests
- [x] all PostgreSQL integration suites pass: 19 database and 38 server tests
- [x] OpenAPI and generated client are current
- [x] production route acceptance passes: 31 application routes and 3 production-auth boundaries
- [x] complete `pnpm check` passes
- [x] production Supabase `0017` controls are verified and security advisors return no findings
- [x] reconciliation migration `0018` is applied remotely and its history hash is verified as
      `2359933123236fe83e54e95086a02da7d0b50dad53a48c980ed6dc506a6851d5`
- [x] performance-advisor information findings have a documented release disposition
- [ ] deployed production environment values pass API, worker, web, and release-job validation
- [ ] managed backup/PITR plan and private object-storage versioning are operator-confirmed
- [ ] first owner Auth identity bootstrap is approved and recorded
- [ ] release approver records go/no-go decision

## Performance-advisor disposition

The hosted advisor reported 135 informational unindexed-foreign-key candidates and 119 informational
unused-index candidates. Neither category is a demonstrated release regression:

- covering every composite foreign key without a measured join, filter, parent-update, or
  parent-delete path would add speculative write and storage cost; the release keeps the
  purpose-built indexes for current application query paths and requires representative-data
  `EXPLAIN (ANALYZE, BUFFERS)` evidence before adding more
- unused-index statistics are not representative on a pre-launch database; removal is deferred until
  production telemetry covers a meaningful operating window

Review both categories after representative workload data exists. Any demonstrated slow query or
parent-row lock amplification becomes a production-hardening defect rather than an informational
acceptance.

## Go/no-go rule

This candidate is not a production release while any unchecked item remains. Performance-advisor
information may be accepted only with a written query-path rationale; security warnings, failed
acceptance, migration drift, unavailable recovery evidence, or critical accessibility/data-integrity
defects are automatic no-go conditions.
