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

Development authentication is allowed only with `APP_ENV=local`. The tenant, user, and permissions
come from `.env`; clients cannot select tenant context with an `x-tenant-id` header. Set
`READY_REQUIRE_WORKER=true` when readiness should also require a fresh worker heartbeat.

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
