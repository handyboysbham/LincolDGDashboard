# V1.10.0 Release Candidate Record

## Candidate

- release marker: `1.10.0-rc.1`
- schema migration: `0017_release_readiness`
- API contract version: `1.10.0`
- decision date: 2026-08-11

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

## Evidence

- [x] local forward migration reports current
- [x] server and web type checking passes
- [x] 181 server, 42 web, and 1 generated-client unit tests pass
- [x] restored canonical acceptance passes: 2 files, 5 tests
- [x] all PostgreSQL integration suites pass: 18 database and 38 server tests
- [x] OpenAPI and generated client are current
- [x] production route acceptance passes: 31 application routes and 3 production-auth boundaries
- [x] complete `pnpm check` passes
- [ ] production Supabase migration is applied and security advisors return no unresolved warnings
- [ ] deployed production environment values pass API, worker, web, and release-job validation
- [ ] managed backup/PITR plan and private object-storage versioning are operator-confirmed
- [ ] first owner Auth identity bootstrap is approved and recorded
- [ ] release approver records go/no-go decision

## Go/no-go rule

This candidate is not a production release while any unchecked item remains. Performance-advisor
information may be accepted only with a written query-path rationale; security warnings, failed
acceptance, migration drift, unavailable recovery evidence, or critical accessibility/data-integrity
defects are automatic no-go conditions.
