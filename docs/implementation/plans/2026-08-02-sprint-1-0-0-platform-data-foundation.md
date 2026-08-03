# Sprint 1.0.0 Platform Data Foundation Plan

## Objective

Create the PostgreSQL and Drizzle foundation for tenant-isolated application data, reliable
commands, audit history, background work, and document metadata.

## Source documents

- `AGENTS.md`
- `packages/database/AGENTS.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/repository-bootstrap.md`
- `docs/architecture/technical-architecture.md`
- `docs/implementation/sprints.md`

## Tenant decision

For V1, one Organization is one tenant. `organizations.id` is the tenant identity, and tenant-owned
tables carry `tenant_id` referencing `organizations.id`. The Organization row is the tenant root;
its `id` is protected by the same session tenant context even though it does not duplicate that
value in a separate `tenant_id` column.

## Tables

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

## Database behavior

- UUID primary keys from `pgcrypto`
- tenant-aware composite foreign keys where records relate within a tenant
- forced Row-Level Security for tenant-root and tenant-owned tables
- transaction-local `app.current_tenant_id` context
- optimistic `row_version` trigger for mutable records
- append-only Audit Events
- transaction-safe business-number allocation
- idempotency reservation and completed-response storage
- `FOR UPDATE SKIP LOCKED` claiming with expiring leases for outbox and scheduled jobs
- restricted runtime grants with no table ownership or RLS bypass

## Application interfaces

- database-pool construction from an explicit connection string
- tenant-scoped transaction helper
- transaction-safe number allocation
- idempotent command execution
- outbox and scheduled-job claim helpers
- migration and seed commands

No HTTP endpoints are added in this sprint.

## Events and permissions

Application services will insert Audit Events and outbox events in the same tenant transaction as a
meaningful business change. The database runtime role may read and insert Audit Events but may not
update or delete them. Worker claims are limited by tenant context in V1; cross-tenant orchestration
will use one tenant transaction per claim cycle.

## Migration impact

Add forward migration `0000_platform_foundation`. It creates the foundation schema, database
functions, policies, triggers, indexes, and runtime grants. The migration must apply to an empty
database owned by the migration role.

## Tests

- empty-database migration
- runtime role attributes and ownership
- tenant-scoped reads and writes
- cross-tenant insert and foreign-key denial
- concurrent business-number allocation
- idempotent replay and request-hash mismatch
- Audit Event and outbox atomic rollback
- append-only Audit Event enforcement
- concurrent outbox and scheduled-job claiming
- seed idempotency

Use PostgreSQL; do not substitute SQLite.

## Completion checklist

- [x] Database package and Drizzle schema added
- [x] Migration SQL reviewed
- [x] Tenant transaction and command helpers added
- [x] Seed added
- [x] Integration tests pass against PostgreSQL
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm check` passes
- [x] Architecture documentation records the V1 tenant decision
