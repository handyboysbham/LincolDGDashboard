# Lincoln Dirt and Gravel Repository Instructions

## Project

This repository contains the Lincoln Dirt and Gravel operating system.

The system manages:

- customer intake
- estimates and pricing
- quotes and contracts
- projects and jobs
- material delivery
- dump trailer rental
- scheduling and asset use
- job charges
- invoicing
- payments, credits, and refunds

Read `docs/index.md` and the relevant domain document before changing code.

## Architecture

- TypeScript monorepo
- Next.js web application
- NestJS modular-monolith server
- PostgreSQL system of record
- Drizzle schema with reviewed SQL migrations
- REST and OpenAPI
- Transactional outbox
- PostgreSQL-backed worker queue
- Private S3-compatible object storage

Do not introduce microservices, Redis, a message broker, GraphQL, Kubernetes, or another runtime
without an approved architecture decision record.

## Required commands

Before finishing a change, run:

```bash
pnpm check
```

For database changes, also run:

```bash
pnpm db:migrate
pnpm test:integration
```

For API changes, also run:

```bash
pnpm api:check
```

Run the relevant acceptance journey for business-workflow changes.

## Business integrity rules

- Never store money as floating point.
- Use integer cents for money.
- Use controlled decimal values for quantity and weight.
- Never let the browser calculate authoritative financial totals.
- Never mutate status fields directly.
- Use application commands for state transitions.
- Never edit an accepted Quote Version.
- Never edit a posted Invoice Version.
- Never delete Payments, applied Allocations, or settled Refunds.
- Corrections use new versions, adjustments, reversals, credits, or refunds.
- Every tenant query must run with tenant context.
- Every critical retryable command must be idempotent.
- Every meaningful state change must create an Audit Event.
- Integration side effects must use the transactional outbox.
- A customer cannot submit both service types in one Lead.
- One independently scheduled trip or rental is one Job.
- A Job is locked after final financial completion and closure.

## Module boundaries

- Controllers remain thin.
- Controllers call application services.
- Application services own transaction orchestration.
- Domain code must not import NestJS, Drizzle, provider SDKs, or browser code.
- Infrastructure implements application and domain ports.
- A module must not import another module's repository.
- Cross-module work uses public application services or an orchestration service.
- The web application never connects directly to PostgreSQL.

## Database

- Every schema change requires a committed migration.
- Review generated SQL before committing.
- Migrations are forward-only outside local development.
- Every tenant-owned table includes `tenant_id`.
- Enable and test Row-Level Security.
- Financial and accepted-customer records are not hard deleted.
- Use tenant-aware foreign keys where practical.
- Add indexes for actual query paths, not speculation.

## State transitions

Every transition must:

1. Lock the target record when concurrency matters.
2. Confirm current state.
3. Confirm permission.
4. Evaluate readiness.
5. Validate related records.
6. Change state.
7. Create Audit Events.
8. Create outbox events.
9. Commit atomically.

Clients may not update status with an unrestricted `PATCH`.

## Testing

Every state transition needs:

- success test
- invalid-state test
- permission test
- tenant-isolation test where applicable
- idempotency or concurrency test when relevant

Use PostgreSQL for integration tests. Do not substitute SQLite.

## Security

- Do not commit secrets.
- Do not log tokens, payment credentials, or signed URLs.
- Do not store raw card data.
- Customer public links must be scoped, expiring, revocable, and stored as hashes.
- Provider webhooks require signature verification and replay protection.
- Employee personal payment accounts and personal funds are prohibited.

## Documentation

Update documentation when changing:

- architecture
- database ownership
- state transitions
- API contracts
- financial calculations
- security behavior

Complex work should have a plan under `docs/implementation/plans/`.
