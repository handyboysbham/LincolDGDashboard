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

## Document development

Local document uploads accept PDF, JPEG, PNG, and plain-text files up to 20 MiB by default. The
browser receives a short-lived upload URL, uploads directly to MinIO, and asks the API to validate
the object. A file remains unavailable until its media type, byte size, SHA-256, and supported file
signature pass validation.

`DOCUMENT_PUBLIC_LINK_SIGNING_KEY` is a server-only secret. Use a unique high-entropy value outside
local development, never expose it through `NEXT_PUBLIC_` configuration, and expect rotating it to
invalidate existing customer document links. The database stores only link hashes. Signed URLs,
capability tokens, and MinIO credentials must not be copied into logs or support messages.

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
