# Initial Repository Bootstrap

## Goal

A clean clone should support:

```bash
git clone <repository>
cd lincoln-dirt-gravel
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Expected local services:

- Web: `http://localhost:3000`
- API: `http://localhost:3001`
- OpenAPI: `http://localhost:3001/api/docs`
- Live health: `http://localhost:3001/health/live`
- Readiness: `http://localhost:3001/health/ready`
- MinIO: ports 9000 and 9001
- Mailpit: port 8025
- PostgreSQL: port 5432

## Repository layout

```text
lincoln-dirt-gravel/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── .env.example
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── api-client/
│   ├── config/
│   ├── database/
│   ├── observability/
│   ├── testing/
│   ├── ui/
│   └── validation/
├── docs/
├── infra/
├── tests/
└── .github/
```

## Root commands

```bash
pnpm dev
pnpm dev:web
pnpm dev:api
pnpm dev:worker
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm check

pnpm db:up
pnpm db:down
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:reset
pnpm db:studio

pnpm api:openapi
pnpm api:client
pnpm api:check
```

## Local infrastructure

Local development uses host-native services on Intel macOS. A repository installer downloads
checksum-verified release artifacts for:

- PostgreSQL 18
- MinIO and MinIO Client
- Mailpit

Repository scripts install, initialize, start, verify, and stop the services. Tool binaries, service
data, logs, MinIO client configuration, and PID files remain under the ignored project-local
`.local/` directory. Services bind to `127.0.0.1` and must not be exposed to the local network by
default.

Local development does not require Docker, Homebrew formula installation, or global background
services. Web, API, and worker also run on the host during development.

Required local infrastructure commands:

```bash
pnpm infra:install
pnpm infra:verify-env
pnpm infra:up
pnpm infra:status
pnpm infra:verify
pnpm infra:logs
pnpm infra:down
```

`pnpm db:up` and `pnpm db:down` are aliases for starting and stopping the complete supporting
service set.

## First migration

Migration `0000_platform_foundation` creates only platform foundation tables:

- organizations
- users
- roles
- user_roles
- number_sequences
- idempotency_keys
- audit_events
- outbox_events
- scheduled_jobs
- worker_heartbeats
- documents
- document_links

It also creates:

- `pgcrypto`
- tenant-context function
- row-update trigger function
- Row-Level Security policies
- claim indexes
- runtime grants

## Shared columns

Tenant-owned mutable business tables normally include:

```text
id UUID PRIMARY KEY
tenant_id UUID NOT NULL
created_at TIMESTAMPTZ NOT NULL
created_by UUID
updated_at TIMESTAMPTZ NOT NULL
updated_by UUID
row_version BIGINT NOT NULL DEFAULT 1
```

Financial and accepted records are not hard deleted.

## Required server modules

Initial API modules:

- configuration
- observability
- database
- health
- identity
- tenancy
- permissions
- numbering
- idempotency
- audit
- outbox
- scheduled jobs
- documents

The worker imports infrastructure and worker handlers but no HTTP controllers.

## Health endpoints

`GET /health/live` checks only process liveness.

`GET /health/ready` checks:

- database connection
- expected migrations
- object storage
- required configuration
- optional worker heartbeat freshness

Readiness failure returns HTTP 503 and never exposes secrets.

## Development authentication

`AUTH_MODE=development` is allowed only when `APP_ENV=local`.

The local tenant and user are server-configured. The browser may not select an arbitrary tenant by
header. `GET /api/v1/session` exposes the authenticated development actor to typed clients without
returning credentials.

Worker tenant scope is also server-configured. A worker never accepts tenant context from an event
payload or browser request before opening a tenant transaction.

## Initial web shell

The implemented staff shell includes:

- desktop sidebar
- mobile navigation
- environment badge
- user menu
- command-search placeholder
- dashboard placeholders for quick actions, messages, alerts, tasks, schedule, and jobs needing
  scheduling

The driver shell includes a mobile-first empty assignment state, readiness summary, large dispatch
actions, and bottom navigation.

The customer-public document shell supports safe invalid, expired, revoked, and unavailable link
states plus an Available download state. It never exposes storage credentials or internal records.

## Document API foundation

The API provides pending upload creation, validation completion, authenticated download,
customer-link creation and revocation, and public link resolution. Presigned URLs are scoped to one
object and operation and expire after the configured short interval. The browser origin is explicit
for API and MinIO CORS; `x-tenant-id` is never allowed.

## Bootstrap acceptance

`BOOT-E2E-001` must prove:

1. Clean migration and seed
2. API, worker, and web startup
3. Health endpoints
4. Business number allocation
5. Idempotency replay
6. Audit transaction atomicity
7. Outbox processing exactly once with two workers
8. Scheduled-job claiming
9. Document upload and download
10. Cross-tenant document denial
11. CI from a clean environment
