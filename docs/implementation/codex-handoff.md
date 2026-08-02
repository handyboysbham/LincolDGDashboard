# Codex Handoff Guide

## Create the repository

Start a new repository named:

```text
lincoln-dirt-gravel
```

Copy this specification package into the repository root.

## First Codex prompt

Use a prompt similar to:

```text
Read AGENTS.md, README.md, docs/index.md,
docs/architecture/technical-architecture.md, and
docs/architecture/repository-bootstrap.md.

Create Commit 1: Root Tooling only.

Implement the pnpm monorepo, Turborepo configuration, strict TypeScript,
ESLint, Prettier, root scripts, README, root AGENTS.md, and the empty app/package
folders defined by the bootstrap specification.

Do not add Docker, database code, Next.js, or NestJS yet.
Run all available checks and report exactly what was created.
```

## Recommended Codex task sequence

### Task 1 — Root tooling

- workspace files
- package manifests
- TypeScript
- ESLint
- Prettier
- Turbo
- README and AGENTS

### Task 2 — Local infrastructure

- Docker Compose
- PostgreSQL roles
- MinIO
- Mailpit
- environment validation

### Task 3 — Database foundation

- Drizzle package
- migration 0000
- seed
- tenant transaction helper
- RLS tests
- number allocation
- idempotency
- audit and outbox

### Task 4 — Server foundation

- NestJS API
- worker
- health
- request context
- stable error contract
- outbox processing
- worker heartbeat

### Task 5 — Web foundation

- Next.js shell
- staff dashboard
- driver shell
- public-link states
- generated API client

### Task 6 — CI and bootstrap acceptance

- GitHub Actions
- OpenAPI generation
- tenant-isolation tests
- BOOT-E2E-001
- container builds

## Rules for Codex tasks

Each task should:

- read the relevant Markdown first
- state the planned files
- avoid unrelated refactors
- add tests with behavior
- update documentation when behavior differs
- run `pnpm check`
- run database or API checks when relevant
- stop and report unsupported assumptions rather than silently inventing financial rules

## Plans

For work affecting more than one module, create:

```text
docs/implementation/plans/YYYY-MM-DD-short-name.md
```

Include:

- objective
- source documents
- tables
- endpoints
- transitions
- events
- permissions
- migration impact
- tests
- completion checklist

## Definition of done

Codex should not mark a task complete until:

- code builds
- types pass
- tests pass
- migrations apply from empty database when relevant
- tenant isolation remains intact
- generated API client is current
- documentation matches the implementation
