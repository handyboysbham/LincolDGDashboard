# Sprint 1.2.0 Web and Document Foundation Plan

## Objective

Deliver the first usable staff, driver, and customer web surfaces and a tenant-isolated document
workflow backed by PostgreSQL metadata and the existing private MinIO bucket.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `docs/architecture/technical-architecture.md`
- `docs/architecture/repository-bootstrap.md`
- `docs/architecture/database-schema.md`
- `docs/implementation/sprints.md`
- `docs/implementation/acceptance-journeys.md`

## Web surfaces

- staff dashboard with responsive navigation, operational summaries, quick actions, work needing
  attention, loading behavior, and safe unavailable states
- mobile-first driver shell with large touch targets and an explicit empty-assignment state
- customer document page with available, invalid, unavailable, expired, and revoked states
- typed `@ldg/api-client` integration for session and document workflows

The web process calls the REST API and never imports the database package or performs authoritative
business calculations.

## Document workflow

1. An authenticated command creates a tenant-owned pending Document.
2. The API returns a short-lived, object-specific presigned upload URL.
3. The browser uploads directly to private object storage.
4. A completion command reads the object, validates content type, size, and SHA-256, and changes the
   Document to Available or Rejected.
5. Authorized staff receive short-lived, object-specific download URLs only for Available records.

Document commands create Audit Events and outbox events atomically with state changes. Object keys
contain opaque IDs and never use customer filenames.

## Public document links

- add a tenant-owned `document_public_links` table with Row-Level Security
- store only a SHA-256 token hash and a hashed creation idempotency key
- encode the tenant and link identifiers in the capability token so the API can establish tenant
  context before validating the secret
- scope V1 links to one Available Document and the `download` purpose
- enforce expiration and revocation before issuing a short-lived download URL
- derive replayable high-entropy token material with HMAC from a server-only signing key so link
  creation can be idempotent without persisting a plaintext token

## API surface

- `POST /api/v1/documents/uploads`
- `POST /api/v1/documents/:id/actions/complete`
- `POST /api/v1/documents/:id/actions/download`
- `POST /api/v1/documents/:id/public-links`
- `POST /api/v1/documents/:id/public-links/:linkId/actions/revoke`
- `GET /api/v1/public/document-links/:token`

State-changing authenticated routes require the documented document permission and an idempotency
key where a retry could otherwise create another durable record.

## Security boundaries

- storage bucket remains private and uses the existing bucket-scoped application credential
- upload and download URLs expire quickly and are scoped to one object and operation
- uploaded objects are not downloadable until server validation succeeds
- authenticated document reads run in the actor's tenant transaction
- public capability tokens are never logged and plaintext token material is never stored
- storage credentials, token secrets, and signed URLs are excluded from errors and application logs

## BOOT-E2E-001 coverage

- database foundation tests cover clean migration, seed primitives, number allocation, idempotency,
  Audit/outbox atomicity, and concurrent queue claims
- API/worker process tests cover independent startup and health
- web startup acceptance covers staff, driver, and customer routes
- document integration covers authorized upload/download, validation, public-link failures, and
  cross-tenant denial
- repository checks cover builds, generated contracts, and boundary rules

## Migration impact

Add one forward migration for `document_public_links`, including tenant-aware foreign keys, known
query indexes, row-update metadata, forced Row-Level Security, and least-privilege runtime grants.

## Completion checklist

- [x] Next.js staff, driver, and customer shells implemented
- [x] web boundary and responsive-state tests pass
- [x] document public-link migration reviewed
- [x] private upload, validation, and download flow implemented
- [x] hashed, expiring, scoped, revocable public links implemented
- [x] tenant, permission, invalid-state, idempotency, and log-safety tests pass
- [x] `BOOT-E2E-001` coverage passes
- [x] OpenAPI and typed client artifacts are current
- [x] architecture and local-development documentation are current
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm api:check` passes
- [x] `pnpm test:e2e` passes
- [x] `pnpm check` passes
