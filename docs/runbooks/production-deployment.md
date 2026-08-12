# Production Deployment

## Runtime shape

One immutable image runs three independently managed processes:

- `LDG_PROCESS=web` — Next.js staff, driver, and customer pages
- `LDG_PROCESS=api` — NestJS REST API and readiness endpoints
- `LDG_PROCESS=worker` — PostgreSQL-backed outbox and scheduled work

Build with `infra/production/Dockerfile`. Next.js public configuration is compiled into browser
assets, so supply all four `NEXT_PUBLIC_*` values as Docker build arguments and inject the same
values into the web process at runtime. These values are intentionally public; never pass a Supabase
secret or service-role key as a build argument. Docker remains optional for local development; it is
the production packaging boundary only. Run the container as its non-root `ldg` user and place TLS
at the platform ingress.

```bash
docker build -f infra/production/Dockerfile \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.invalid \
  --build-arg NEXT_PUBLIC_AUTH_MODE=supabase \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=PUBLIC_KEY \
  .
```

## Secrets and connections

Start with `.env.production.example`, store populated values in the deployment platform's secret
manager, and never create a populated repository environment file.

Database responsibilities are intentionally separated:

- `DATABASE_URL` is the restricted `ldg_app` runtime role. A Supabase session-pooler connection on
  port 5432 is appropriate for a persistent API or worker when direct IPv6 is unavailable.
- `DATABASE_MIGRATION_URL` is a direct connection used only by the migration job.
- `DATABASE_BACKUP_URL` is a direct administrative/BYPASSRLS connection used only by the isolated
  backup job. `FORCE ROW LEVEL SECURITY` makes this separation necessary for complete backups.

All production PostgreSQL URLs require `sslmode=require` or a stricter verification mode. Never put
the migration or backup connection into the API, worker, or web process environment.

Run the fail-closed validator separately for every runtime process before startup. Validate all
three database roles in an isolated release job; do not copy that job's environment into a runtime
process:

```bash
LDG_PROCESS=api pnpm production:validate
LDG_PROCESS=worker pnpm production:validate
LDG_PROCESS=web pnpm production:validate
LDG_PROCESS=release pnpm production:validate
```

It rejects development authentication, placeholders, weak signing material, plaintext endpoints,
shared runtime/admin database roles, missing TLS, capture email, absent worker readiness, and
missing operational thresholds. It reports variable names, never secret values.

## Supabase Auth

Use the current Supabase publishable key in the web process. Do not expose a secret key or service
role key to Next.js. Configure:

- `AUTH_JWT_ISSUER=https://<project-ref>.supabase.co/auth/v1`
- `AUTH_JWKS_URL=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
- `AUTH_JWT_AUDIENCE=authenticated`
- `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>`

Every Supabase Auth staff user must have `tenant_id` in signed `app_metadata`; `user_metadata` is
never trusted for authorization. The matching application `users.external_subject` is the Supabase
Auth user UUID. The API verifies signature, issuer, audience, expiry, subject, and `app_metadata`,
then reloads the active User and active Role permissions from PostgreSQL on every request.

After the initial owner is authenticated, owners link subsequent identities through
`POST /api/v1/administration/users/:id/identity`. The idempotent command permits only an unlinked
User, prevents one Auth identity from being reused, and writes Audit and outbox evidence.

The first owner is a controlled bootstrap exception because no authenticated owner exists yet. Use a
reviewed transaction through the migration connection that sets tenant context, locks the exact
User, sets `external_subject` only when null, and inserts matching
`administration.user_identity_linked` Audit and outbox rows. Record the change ticket and remove
migration credentials immediately after the bootstrap. Do not use dashboard table editing.

## Release order

1. Confirm Supabase managed backups and object-storage versioning are healthy.
2. Create and verify a logical backup with `pnpm recovery:backup` and `pnpm recovery:verify`.
3. Run `pnpm db:migrate` through the direct migration connection. Applied migrations are
   forward-only.
4. Run the Supabase security and performance advisors. Resolve every security warning; review
   performance information against real query paths.
5. Deploy the worker and wait for a current heartbeat.
6. Deploy the API and require `/health/live` and `/health/ready` to pass.
7. Deploy the web process, verify staff sign-in, and verify one revocable customer capability.
8. Execute the smoke checklist in the release-candidate record.

Readiness fails when the database release marker differs, object storage is unavailable, a required
worker heartbeat is stale, a tenant queue exceeds backlog age, or dead letters exceed the configured
threshold. Request logs use route templates and correlation IDs; raw URLs, capability tokens,
headers, and bodies are not logged.

## Rollback

Rollback application images to the previously approved digest only when they remain compatible with
the current forward-only schema. Never reverse an applied production migration. Schema correction
uses a new reviewed migration. If integrity is uncertain, stop writes and follow the recovery
runbook before reopening traffic.
