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

## Production-configuration audit

The 2026-08-12 provider-neutral audit confirmed:

- the hosted Supabase project is active and healthy in `us-east-1` on PostgreSQL 17
- the restricted `ldg_app` runtime connection and migration connection use distinct roles through
  the TLS-verified Supabase pooler
- one worker tenant is configured, and Supabase exposes an active modern publishable key
- Vercel is selected as the production web host
- the checked-in production example and four fail-closed runtime validators cover the required API,
  worker, web, and isolated release-job environments

The live Vercel audit identified project `lincol-dg-dashboard-web` as the Next.js web deployment for
`handyboysbham/LincolDGDashboard`. Its `apps/web` monorepo build discovers both `@ldg/web` and the
generated API client, and the latest Sprint 1.10 preview for commit `5efd133` is ready, returns HTTP
200, includes the expected security headers, and has no grouped runtime errors in the preceding
seven days. Six current sprint-branch deployments are healthy previews, but the production alias
`lincol-dg-dashboard-web.vercel.app` still targets the older Sprint 1.7 `main` deployment. That
production deployment exposes the development-authenticated staff shell and must not be treated as
an approved operational system. The build also reports Node.js `24.15.0`, below the repository's
reviewed `>=24.18.0 <25` requirement; align the Vercel runtime with that baseline before production
approval rather than silently weakening the application requirement.

Vercel production builds now fail closed unless the production web process and all four public web
variables are present and valid. Configure the following in the Vercel Production environment, then
merge the approved release candidate to the production branch and verify the staff sign-in redirect
before promoting or assigning a custom domain:

- `APP_ENV=production`
- `LDG_PROCESS=web`
- `NEXT_PUBLIC_AUTH_MODE=supabase`
- `NEXT_PUBLIC_API_BASE_URL=https://<approved-api-origin>`
- `NEXT_PUBLIC_SUPABASE_URL=https://dvobqdmjjmakacmqotqd.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<active-publishable-key>`

The local development environment is not a production deployment manifest and intentionally fails
the four production validators. Launch remains blocked until an operator supplies, through the
chosen platform's secret manager:

- production web and API HTTPS origins
- Supabase Auth issuer, JWKS URL, public project URL, and publishable key
- an isolated direct backup connection
- versioned private S3-compatible object storage and production credentials
- a production public-link signing key and Resend credentials
- production readiness thresholds and logging/worker settings

The Supabase organization is currently on the Free plan. That does not satisfy the managed-backup or
PITR release gate: choose a paid backup/PITR posture or approve and automate an off-platform logical
backup posture that meets the documented 24-hour recovery-point and four-hour recovery-time targets.
The Vercel project and provisional web domain are now recorded. The persistent API/worker host and
API domain, object-storage provider, and backup posture must still be recorded before deployment
configuration can be completed.

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
