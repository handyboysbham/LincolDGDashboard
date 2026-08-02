# Lincoln Dirt and Gravel Operating System

This folder contains the implementation source material for building the Lincoln Dirt and Gravel CRM
and operations platform with Codex.

## Product purpose

The system manages two core services:

1. Material delivery
2. Dump trailer rental

The complete business journey is:

```text
Customer Request
→ Estimate
→ Quote
→ Acceptance
→ Project
→ Job
→ Scheduling
→ Field Execution
→ Job Charges
→ Invoice
→ Payment, Credit, or Refund
→ Closure
```

## Start here

Read these files in order:

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/index.md`](docs/index.md)
3. [`docs/architecture/v1-build-readiness.md`](docs/architecture/v1-build-readiness.md)
4. [`docs/architecture/technical-architecture.md`](docs/architecture/technical-architecture.md)
5. [`docs/architecture/repository-bootstrap.md`](docs/architecture/repository-bootstrap.md)
6. [`docs/implementation/build-sequence.md`](docs/implementation/build-sequence.md)
7. [`docs/implementation/acceptance-journeys.md`](docs/implementation/acceptance-journeys.md)

Then read the relevant domain file before implementing a module.

## Recommended implementation approach

Use a TypeScript modular monolith:

- Next.js web application
- NestJS API and worker
- PostgreSQL system of record
- Drizzle schema and reviewed SQL migrations
- REST and OpenAPI
- Transactional outbox
- Private S3-compatible document storage

Do not begin with microservices, Kubernetes, Redis, Kafka, GraphQL, or a general workflow engine.

## First development milestone

Build the repository foundation first:

```text
Root tooling
→ Local infrastructure
→ Database foundation
→ API and worker shell
→ Web shell
→ CI and tenant-isolation tests
```

After bootstrap, build the first complete vertical slice:

```text
Customer and Lead
→ Estimate
→ Quote
→ Acceptance
→ Project
→ Material Delivery Job
→ Invoice
→ Payment
→ Closure
```

## Root tooling

Commit 1 establishes the workspace and repository checks without adding application frameworks or
local infrastructure.

Prerequisites:

- Node.js 24.18.0 or a newer Node.js 24 release
- pnpm 11.18.0

Install and validate from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Use `pnpm install` without `--frozen-lockfile` only when intentionally updating dependencies. The
`apps` and `packages` directories remain implementation placeholders until their staged tasks.
