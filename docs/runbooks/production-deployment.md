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

The first owner is a controlled bootstrap exception because no authenticated owner exists yet. Use
reviewed release jobs through the migration connection. On an empty production database, first
generate separate tenant and application-User UUIDs and provision the Organization, unlinked owner
User, owner assignment, standard Roles, Audit Event, and outbox event atomically:

```bash
APP_ENV=production \
LDG_PROCESS=release \
BOOTSTRAP_CONFIRM=PROVISION_TENANT_FOUNDATION \
BOOTSTRAP_TENANT_ID=<tenant-uuid> \
BOOTSTRAP_USER_ID=<application-user-uuid> \
BOOTSTRAP_ORGANIZATION_DISPLAY_NAME='Lincoln Dirt and Gravel' \
BOOTSTRAP_ORGANIZATION_LEGAL_NAME='<legal-business-name>' \
BOOTSTRAP_OWNER_DISPLAY_NAME='<owner-display-name>' \
BOOTSTRAP_OWNER_EMAIL='<owner-email>' \
BOOTSTRAP_TIMEZONE=America/Chicago \
BOOTSTRAP_APPROVED_BY=<approver-name-or-id> \
BOOTSTRAP_CHANGE_TICKET=<change-ticket> \
DATABASE_MIGRATION_URL=<direct-migration-connection> \
pnpm production:bootstrap-tenant
```

The command is tenant-serialized and idempotent for identical approved input. It refuses a partial
or changed replay, requires the privileged release connection to read the Supabase Auth schema, and
prints the tenant, owner User, and Audit Event identifiers without printing credentials.

Next create the Supabase Auth user through the Auth admin surface and set signed
`app_metadata.tenant_id` to the exact application tenant UUID. The Auth email must match the
application User, which must be active and have an active `owner` Role. Never put the tenant
identifier in user-editable `user_metadata`.

Run the bootstrap only in an isolated release environment. The command verifies the Auth record and
tenant metadata, sets tenant context, serializes bootstrap attempts for the tenant, locks the exact
User, rejects an existing authenticated owner, sets `external_subject` only when null, and
atomically inserts matching `administration.user_identity_linked` Audit and outbox rows. It is safe
to retry with the same identity because committed bootstrap evidence is detected without writing
duplicate events.

```bash
APP_ENV=production \
LDG_PROCESS=release \
BOOTSTRAP_CONFIRM=LINK_FIRST_OWNER \
BOOTSTRAP_TENANT_ID=<tenant-uuid> \
BOOTSTRAP_USER_ID=<application-user-uuid> \
BOOTSTRAP_AUTH_USER_ID=<supabase-auth-user-uuid> \
BOOTSTRAP_APPROVED_BY=<approver-name-or-id> \
BOOTSTRAP_CHANGE_TICKET=<change-ticket> \
DATABASE_MIGRATION_URL=<direct-migration-connection> \
pnpm production:bootstrap-owner
```

Store populated values only in the release job's secret manager, record the Audit Event ID printed
by the command in the release record, and remove migration credentials immediately afterward. Once
the first owner can authenticate, link every subsequent identity through the administration API. Do
not use SQL or dashboard table editing to change `public.users.external_subject`.

## Object-storage verification

The document bucket must be private and retain noncurrent object versions. Supabase Storage and
Railway Buckets do not currently implement S3 object versioning, so they do not satisfy this release
gate. Use a provider that supports the required S3 versioning operations, such as AWS S3, keep Block
Public Access enabled, and grant the application only its document-prefix permissions.

After the operator confirms the bucket policy, encryption, lifecycle retention, and Block Public
Access settings, run the live probe from an isolated release job:

```bash
APP_ENV=production \
LDG_PROCESS=release \
OBJECT_STORAGE_VERIFY_CONFIRM=VERIFY_PRIVATE_VERSIONED_BUCKET \
pnpm production:verify-storage
```

The probe checks bucket access and `Enabled` versioning, writes two versions of one unique
`release-verification/` object, confirms both version IDs are retained, and removes only those exact
test versions. Record its successful output in the release candidate. Never run the probe against a
bucket whose identity has not been independently confirmed.

## Release order

1. Confirm Supabase managed backups and private object-storage policy are healthy, then pass the
   object-versioning probe.
2. Create and verify a logical backup with `pnpm recovery:backup` and `pnpm recovery:verify`.
3. Run `pnpm db:migrate` through the direct migration connection. Applied migrations are
   forward-only.
4. Run the Supabase security and performance advisors. Resolve every security warning; review
   performance information against real query paths.
5. Provision the initial tenant foundation and first Auth owner when the production database is
   empty; record both Audit Event IDs.
6. Deploy the worker and wait for a current heartbeat.
7. Deploy the API and require `/health/live` and `/health/ready` to pass.
8. Deploy the web process, verify staff sign-in, and verify one revocable customer capability.
9. Execute the smoke checklist in the release-candidate record.

Readiness fails when the database release marker differs, object storage is unavailable, a required
worker heartbeat is stale, a tenant queue exceeds backlog age, or dead letters exceed the configured
threshold. Request logs use route templates and correlation IDs; raw URLs, capability tokens,
headers, and bodies are not logged.

## Rollback

Rollback application images to the previously approved digest only when they remain compatible with
the current forward-only schema. Never reverse an applied production migration. Schema correction
uses a new reviewed migration. If integrity is uncertain, stop writes and follow the recovery
runbook before reopening traffic.
