# Local Development Runbook

## Supported environment

The V1 local-development environment is Intel macOS. Supporting services run as host-native,
project-owned processes. Docker, Homebrew formula installation, and global background services are
not used.

Pinned tool versions and SHA-256 checksums are recorded in `infra/local/tool-versions.env`. Tools
are downloaded from Postgres.app, MinIO, and Mailpit's official release locations and installed
beneath ignored `.local/tools/`. Dependency updates require a reviewed version-and-checksum change,
a fresh infrastructure verification, and `pnpm check`.

## First setup

```bash
pnpm infra:install
cp .env.example .env
pnpm infra:verify-env
pnpm db:up
pnpm infra:verify
```

The values in `.env.example` are local-only development credentials. Do not reuse them in shared,
staging, or production environments.

## Process management

```bash
pnpm db:up
pnpm infra:status
pnpm infra:logs
pnpm infra:verify
pnpm db:down
```

`db:up` starts all supporting services because PostgreSQL, private object storage, and email capture
form one local infrastructure unit. It is safe to run repeatedly.

## API and worker processes

After the infrastructure is healthy, prepare the database and start the application processes in
separate terminals:

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev:api
pnpm dev:worker
```

The API listens at `http://127.0.0.1:3001`. Swagger UI is available at `/api/docs`, the committed
contract at `/api/docs/openapi.json`, liveness at `/health/live`, and readiness at `/health/ready`.
The worker is a standalone NestJS application context and opens no HTTP listener.

The web application listens at `http://127.0.0.1:3000`. Its browser API base URL and the API's
allowed browser origin come from `NEXT_PUBLIC_API_BASE_URL` and `WEB_ORIGIN`. Restart local
infrastructure after changing `WEB_ORIGIN` so MinIO receives the matching CORS configuration.

Development authentication is allowed only with `APP_ENV=local`. The tenant, user, and permissions
come from `.env`; clients cannot select tenant context with an `x-tenant-id` header. Set
`READY_REQUIRE_WORKER=true` when readiness should also require a fresh worker heartbeat.

## Customer Intake development

After migration and seed, open `/leads/new` to create either a Material Delivery or Dump Trailer
Rental opportunity. The seeded owner has all permissions. A dispatcher role intended to operate
intake needs `customers:read`, `customers:write`, `leads:read`, `leads:write`, `leads:transition`,
`documents:read`, and `documents:write`.

Use a new `Idempotency-Key` header for each logical write and reuse that key only when retrying the
same body. The browser does this automatically. Duplicate warnings are advisory: continuing creates
a separate record and never merges existing customer data. Lead state changes must use the action
endpoints shown in Swagger; do not patch `status` directly.

Run the intake verification gates with local infrastructure available:

```bash
pnpm db:migrate
pnpm test:integration
pnpm api:check
pnpm test:e2e
pnpm check
```

## Document development

Local document uploads accept PDF, JPEG, PNG, and plain-text files up to 20 MiB by default. The
browser receives a short-lived upload URL, uploads directly to MinIO, and asks the API to validate
the object. A file remains unavailable until its media type, byte size, SHA-256, and supported file
signature pass validation.

`DOCUMENT_PUBLIC_LINK_SIGNING_KEY` is a server-only secret. Use a unique high-entropy value outside
local development, never expose it through `NEXT_PUBLIC_` configuration, and expect rotating it to
invalidate existing customer document links. The database stores only link hashes. Signed URLs,
capability tokens, and MinIO credentials must not be copied into logs or support messages.

## Pricing and Quote development

Open `/pricing` to create and activate a controlled Material Delivery or Dump Trailer Rental Pricing
Version. An Estimating Lead exposes its Estimate builder; all authoritative costs, totals, deposits,
and margins are returned by the API. Continue approval at `/estimates`, then approve and send the
commercial snapshot from `/quotes`. The send response contains the only recoverable customer token;
the database stores its hash. Do not put customer Quote tokens in logs, tickets, or screenshots.

The owner role can perform all Sprint 1.4.0 actions. Operational roles should be granted only the
needed `pricing:*`, `estimates:*`, and `quotes:*` permissions; approval permissions are
intentionally separate from write/send permissions. Reusing an `Idempotency-Key` is valid only for
an identical retry. Acceptance itself uses the Quote Version and evidence hash as its natural
idempotency boundary.

The PostgreSQL integration suite exercises the canonical $184 cost, $420 Quote, and $185 deposit,
immutable accepted content, tenant isolation, supersession/decline terminal states, and repeated
acceptance producing one Project.

## Project and scheduling development

Accepting a Quote now creates one Project and one initial `MAT` or `DTR` Job atomically. Open
`/projects` to generate the immutable Contract snapshot, add the business signature, and create the
customer capability link. The link is the only recoverable plaintext token; the database stores its
hash and the send-request hash. After customer signature, confirm external deposit readiness before
starting Project or Job planning.

Use `/jobs` for lifecycle, route, checklist, readiness, and event history, and `/schedule` for the
jobs-needing-scheduling queue, asset registry, and calendar. Material Jobs require a service block;
rental Jobs require drop-off and pickup blocks. Every required block needs an assigned active user
and available asset. PostgreSQL returns `ASSET_RESERVATION_CONFLICT` when concurrent or overlapping
requests try to reserve the same asset. Do not work around this by checking availability only in the
browser.

Contract and Quote customer tokens, typed-name evidence, IP addresses, and user agents must not be
logged or copied into support messages. Operational roles use `projects:read`, `operations:manage`,
and `scheduling:manage`; the owner wildcard remains available for local development.

## Local state

All generated state is ignored by Git and stored beneath `.local/`:

```text
.local/
├── logs/
├── mailpit/
├── minio/
│   ├── data/
│   └── mc/
├── postgres/
│   └── data/
└── run/
```

The lifecycle scripts stop only processes represented by project PID files and refuse to terminate
an unexpected process if a PID has been reused.

## PostgreSQL roles

- `ldg_admin` initializes the local cluster and is not an application credential.
- `ldg_migrator` owns the application database and future migration-created objects.
- `ldg_app` is the restricted runtime login and cannot bypass Row-Level Security.

The application must use `DATABASE_URL`. Migration commands must use `DATABASE_MIGRATION_URL`.

## MinIO access

The documents bucket is private. Initialization creates a separate application user with a policy
limited to that bucket. The application must not use MinIO root credentials.

## Troubleshooting

Confirm dependency versions:

```bash
pnpm infra:verify-env
```

Inspect status and logs:

```bash
pnpm infra:status
pnpm infra:logs
```

Port conflicts are reported during startup. Change the corresponding `.env` port only when the rest
of the development team agrees, because documented defaults are part of the bootstrap contract.
