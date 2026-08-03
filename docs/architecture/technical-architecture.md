# Technical Architecture

## Primary decision

Use a TypeScript modular monolith with three runtime processes sharing one PostgreSQL database:

1. Next.js web application
2. NestJS API
3. NestJS worker

Supporting services:

- PostgreSQL
- Private S3-compatible object storage
- Email provider
- Optional SMS provider
- Optional map and payment-provider adapters

## Why a modular monolith

The domains are tightly connected and frequently require one transaction:

- Quote acceptance creates a Project and Job.
- Scheduling reserves assets.
- Operations create Expenses and Job Charges.
- Job Charges become Invoice Line Items.
- Payments update Invoice and Project financial state.

Microservices would add distributed transactions, eventual consistency, higher cost, and harder
debugging without providing useful V1 value.

## Selected stack

- Node.js 24 LTS
- TypeScript strict mode
- pnpm workspaces
- Turborepo
- Next.js 16
- NestJS 11
- Fastify adapter
- PostgreSQL 18
- Drizzle ORM and reviewed SQL migrations
- REST and OpenAPI
- Vitest, PostgreSQL integration tests, and Playwright
- S3-compatible object storage

For V1 Intel macOS local development, PostgreSQL, MinIO, and Mailpit run as host-native processes
from checksum-verified, project-local tool installations. Repository scripts own their state and
lifecycle. Docker and global package installation are not local-development dependencies.

## Runtime topology

```text
Staff and Customer Browsers
            │
            ▼
       Next.js Web
            │ REST
            ▼
       NestJS API
       ├── PostgreSQL
       ├── Object Storage
       └── Provider Adapters
            ▲
            │ Outbox and scheduled work
       NestJS Worker
```

## Process responsibilities

### Web

- Staff interface
- Driver field interface
- Customer secure-link pages
- Form presentation
- File uploads and previews
- Responsive interaction

The web process never connects directly to PostgreSQL and never performs authoritative financial
calculations.

### API

- Authentication and authorization
- Tenant context
- Input validation
- Commands and queries
- Transactions
- State transitions
- Readiness evaluation
- Pricing and financial calculations
- Audit and outbox writes
- Provider webhook ingestion

### Worker

- Outbox processing
- Email and SMS delivery
- PDF rendering
- Quote expiration
- Reminders
- Scheduled checks
- Retry processing
- Temporary upload cleanup

### PostgreSQL

Source of truth for:

- business records
- financial records
- state transitions
- audit events
- outbox events
- scheduled jobs
- idempotency keys
- search indexes
- file metadata

Large file bytes remain in object storage.

## API rules

Use REST and OpenAPI under `/api/v1`.

Resource endpoints handle normal CRUD. Explicit action endpoints handle state changes:

```text
POST /estimate-versions/:id/actions/approve
POST /quote-versions/:id/actions/accept
POST /jobs/:id/actions/confirm-schedule
POST /jobs/:id/actions/start
POST /invoices/:id/actions/post
POST /payments/:id/actions/verify
POST /refunds/:id/actions/approve
```

State-changing requests should support:

- authentication
- tenant context
- permission
- expected row version
- idempotency key
- request correlation ID

Customer Intake follows the same command boundary. `POST /api/v1/intake/leads` creates the Lead and
any new Customer Account, Contact, and Service Location in one tenant transaction. Explicit Lead
action endpoints own lifecycle changes. Notes, Tasks, document links, lifecycle changes, and new
intake entities write immutable Audit Events and transactional outbox events with the business
change.

Duplicate lookup is advisory. The API compares normalized names, email addresses, phone numbers, and
complete service addresses inside the authenticated tenant, returns stable candidate IDs, and never
merges or silently replaces a record.

## Tenant isolation

Every tenant-owned table includes `tenant_id`.

For V1, an Organization is the tenant boundary: `organizations.id` is the value propagated as
`tenant_id`. A separate Tenant record is not used.

Isolation layers:

1. Authenticated request context
2. Repository filters
3. PostgreSQL Row-Level Security
4. Tenant-aware foreign keys
5. Automated cross-tenant tests

A tenant transaction sets:

```sql
SET LOCAL app.current_tenant_id = '<tenant UUID>';
```

API tenant context comes from authenticated server state, never an unrestricted browser header.
Worker tenant scope is supplied by trusted server configuration before queue claims or handler
transactions begin.

## Transactions and concurrency

One application command normally equals one database transaction.

Use row locks for:

- Quote acceptance
- number allocation
- Project creation
- asset reservation
- Invoice posting
- Payment Allocation
- Deposit Application
- Customer Credit use
- Refund processing

Use optimistic concurrency with `row_version` for normal editable records.

## Idempotency

Mandatory for:

- intake Lead creation
- intake Notes, Tasks, document links, and lifecycle commands
- Quote acceptance
- Project conversion
- Contract generation
- Invoice posting
- payment webhooks
- Payment Allocation
- Deposit Application
- Refund submission
- outbox handlers
- document generation
- notification delivery

## Transactional outbox

Write business change, Audit Event, and outbox event in the same transaction.

Workers claim with `FOR UPDATE SKIP LOCKED` and use provider idempotency where available.

## Money and quantities

- Store money as integer cents.
- Never use floating point for authoritative money.
- Use controlled decimal values for quantity and weight.
- Preserve units and conversion rules.
- Store timestamps in UTC and tenant timezone as `America/Chicago`.

## Documents

Use private object storage and database metadata.

Upload flow:

```text
Create pending Document
→ return presigned upload URL
→ upload directly to object storage
→ validate object
→ mark Available
```

Customer access uses short-lived authorized download URLs.

Pending uploads record the expected media type, byte size, and SHA-256. Completion reads the stored
object and verifies all three values plus a supported content signature before changing the Document
to Available. Invalid objects become Rejected and cannot receive download URLs.

Authenticated document commands run in the actor's tenant transaction. Public document links use a
versioned capability containing opaque identifiers and high-entropy HMAC-derived token material.
Only the token hash and a hashed creation-idempotency key are stored. Link resolution establishes
the encoded tenant context, verifies the hash in constant time, and then checks purpose, expiration,
revocation, and Document availability before issuing a new short-lived download URL.

## Authentication

Staff use a managed OIDC or JWT-compatible provider.

Customers use purpose-limited secure links for:

- Quote
- Contract
- Project status
- Invoice
- Payment

Tokens must be random, hashed, scoped, expiring, revocable, and rate-limited.

## Prohibited V1 infrastructure

Do not add:

- microservices
- Kubernetes
- Kafka
- RabbitMQ
- required Redis dependency
- event sourcing
- GraphQL
- separate search cluster
- native mobile app
- Docker or Docker Compose as a required local-development dependency
