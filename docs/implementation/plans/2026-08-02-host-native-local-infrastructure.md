# Host-Native Local Infrastructure Plan

## Objective

Replace the proposed Docker Compose local environment with reproducible host-native macOS services
and complete Commit 2 without adding application frameworks or database schema.

## Source documents

- `AGENTS.md`
- `docs/architecture/technical-architecture.md`
- `docs/architecture/repository-bootstrap.md`
- `docs/implementation/codex-handoff.md`

## Infrastructure

- PostgreSQL 18 from the checksum-verified Postgres.app release
- MinIO and MinIO Client from checksum-verified official release binaries
- Mailpit from its checksum-verified official release archive
- Project-local data, logs, configuration, and PID files under `.local/`
- Loopback-only network bindings

## Security boundaries

- Separate PostgreSQL administrator, migration-owner, and restricted runtime roles
- Runtime role cannot bypass Row-Level Security
- Private MinIO bucket
- Bucket-scoped MinIO application user separate from the root account
- Local example credentials clearly prohibited outside local development

## Migration impact

None. Database schema and Drizzle migrations remain part of Task 3.

## Tests

- Shell syntax validation
- Required environment-variable validation
- Pinned dependency verification
- PostgreSQL role and login verification
- MinIO application-user upload and deletion probe
- Mailpit API readiness and SMTP acceptance
- Root `pnpm check`

## Completion checklist

- [x] Architecture decision revised
- [x] Project-local checksum-verified tool installer added
- [x] Environment template added
- [x] Service lifecycle scripts added
- [x] PostgreSQL role initialization implemented
- [x] Private MinIO bucket initialized
- [x] MinIO and Mailpit live services verified
- [x] PostgreSQL live service verified outside the Codex shared-memory sandbox
- [x] Root checks pass
- [x] Commit 2 created
