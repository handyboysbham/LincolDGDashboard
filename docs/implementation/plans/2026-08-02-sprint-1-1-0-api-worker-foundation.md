# Sprint 1.1.0 API and Worker Foundation Plan

## Objective

Add independently runnable NestJS API and worker processes over the Sprint 1.0.0 database
foundation, with secure request context, stable errors, health reporting, reliable outbox execution,
and generated OpenAPI client types.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `docs/architecture/technical-architecture.md`
- `docs/architecture/repository-bootstrap.md`
- `docs/implementation/sprints.md`
- `packages/database/AGENTS.md`

## Modules

- configuration
- request context and correlation
- database
- health
- identity and development authentication
- permissions
- idempotent command execution
- outbox processing
- worker heartbeat
- OpenAPI generation

Business-domain controllers are not introduced in this sprint.

## Processes

- API: Fastify-backed NestJS HTTP process on the configured host and port
- Worker: NestJS application context with no HTTP controllers

Both processes share configuration and database infrastructure but have independent entry points.
The worker accepts server-configured tenant identifiers; the browser cannot provide tenant context.
For the current single-organization V1 deployment, the seeded Organization is the configured worker
tenant.

## Endpoints

- `GET /health/live`
- `GET /health/ready`
- Swagger UI at `/api/docs`

Business REST resources will remain under `/api/v1` as they are added.

## Authentication and permissions

Local development authentication is valid only when `APP_ENV=local` and uses server-configured
tenant and user identifiers. Requests cannot select a tenant by header. A provider interface keeps
the authentication boundary replaceable with the managed OIDC/JWT provider required outside local
development.

Permission metadata is evaluated by a global guard after authentication. Public infrastructure
routes must opt out explicitly.

## Transactions and idempotency

Application commands receive the authenticated actor and open one tenant transaction through
`@ldg/database`. Retryable commands use the `IdempotentCommandService`, which hashes the canonical
request input and stores or replays the completed result in that same transaction.

## Worker behavior

- emit a global worker heartbeat on startup and at a configured interval
- claim tenant-scoped outbox events with `FOR UPDATE SKIP LOCKED`
- dispatch only registered event types
- mark successful events processed
- retry failures with bounded exponential delay
- dead-letter events after the configured attempt limit
- stop timers and close database resources during shutdown

Provider-facing handlers remain responsible for provider idempotency.

## Migration impact

None. Sprint 1.0.0 already includes outbox and heartbeat storage. Integration tests use the existing
forward migration against isolated PostgreSQL databases.

## OpenAPI and client generation

The API process and offline generator use the same application configuration function. The OpenAPI
artifact is written beneath `apps/server/openapi/`. `@ldg/api-client` generates TypeScript operation
types from that committed artifact.

## Tests

- configuration success and invalid development-auth combinations
- stable error and correlation response behavior
- development actor context and tenant-header rejection
- permission enforcement
- live and ready health behavior
- migration, database, object-storage, and heartbeat readiness failures
- idempotent command replay and request mismatch
- two workers claim one event only once
- outbox success, retry, and dead-letter behavior
- worker heartbeat persistence
- OpenAPI and generated-client freshness

## Completion checklist

- [x] API and worker packages build independently
- [x] Configuration and request context implemented
- [x] Authentication and permissions implemented
- [x] Health endpoints implemented
- [x] Idempotent command integration implemented
- [x] Outbox retries and heartbeat implemented
- [x] OpenAPI and API client generated
- [x] Integration tests pass against PostgreSQL
- [x] `pnpm api:check` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm check` passes
