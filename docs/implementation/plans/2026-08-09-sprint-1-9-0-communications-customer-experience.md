# Sprint 1.9.0 Communications and Customer Experience Plan

## Goal

Deliver reliable, preference-aware customer notifications from committed business events and provide
a secure customer Project experience that never exposes internal operational or financial data.

## Constraints

- Provider calls occur only in the worker after the source transaction commits.
- Notification production and provider retries are idempotent.
- Templates are versioned and published versions are immutable.
- Customer links are scoped, expiring, revocable, rate-limitable, and stored only as hashes.
- Customer responses exclude supplier costs, margins, internal notes, approval discussions, private
  Documents, and employee identifiers.
- Existing Quote, Contract, Invoice, Document, Job, and finance ownership boundaries remain intact.

## Phase 1 — Notification foundation

Status: implementation complete in the current Sprint 1.9 change set. Final interactive and
clean-database acceptance reruns remain pending because the current execution environment denied
localhost browser and PostgreSQL acceptance-test access.

- [x] Notification Template, Preference, Delivery, and Delivery Attempt schema
- [x] reviewed migration with tenant-aware foreign keys, forced RLS, grants, and transition guards
- [x] idempotent Template draft creation and explicit publication
- [x] per-Contact email and SMS preferences
- [x] explicit, idempotent notification queue command
- [x] `notification.requested` outbox handler
- [x] server-side allowlisted Template rendering
- [x] preference suppression without provider invocation
- [x] deduplicated delivery and durable retry-attempt history
- [x] provider port with local capture adapter that logs no message content
- [x] staff read APIs for Templates, Preferences, Deliveries, and Attempts
- [x] permission, replay, retry, protected-variable, and tenant-isolation coverage

## Phase 2 — Event-driven customer experience backend

Status: complete in the current Sprint 1.9 change set.

- [x] define a typed event-to-notification policy registry
- [x] derive safe recipient and presentation variables from authoritative records
- [x] queue Quote, Contract, schedule, on-the-way, completion, Invoice, receipt, and Refund notices
- [x] create or reuse the appropriate scoped customer capability before delivery
- [x] prevent one source event from generating duplicate channel deliveries
- [x] add hashed, expiring, revocable Project public links
- [x] resolve tenant context only from the signed capability
- [x] expose customer-safe Project status, schedule, milestone, and contact presentation
- [x] expose customer-visible Documents and existing secure Invoice/receipt resources
- [x] record first view and view history without leaking internal identifiers
- [x] test expiration, revocation, tampering, cross-tenant access, and response redaction

## Phase 3 — Production workflows and acceptance

Status: complete in the current Sprint 1.9 change set.

- [x] add Communications queue, Template status, delivery history, and retry visibility
- [x] add Customer preference editing with accessible channel controls
- [x] add customer Project summary route with loading, empty, success, expired, and revoked states
- [x] link customer-visible Documents, Invoices, receipts, and Refund status
- [ ] verify mobile and keyboard workflows from production builds
- [x] add configured email provider adapter and optional SMS adapter
- [x] add scheduled reminders and retry/dead-letter operations
- [x] verify provider idempotency, timeouts, error classification, and dead-letter visibility
- [x] ensure credentials, tokens, destinations, and message bodies are absent from logs
- [ ] execute `COMMS-E2E-001` from a clean database
- [x] run migrations, API generation checks, and `pnpm check`

## Phase 1 acceptance

1. Create and publish an email Template containing declared customer-safe variables.
2. Set a Contact preference and queue a notification with one idempotency key.
3. Replay the queue command and receive the same outbox event.
4. Process the outbox event and record one Delivery plus one successful Attempt.
5. Disable the channel, queue another request, and record Suppressed without a provider call.
6. Fail one provider attempt, retry, and retain one Delivery with ordered failure/success Attempts.
7. Reject internal-only Template variables and a foreign-tenant Contact.

## Phase 2 acceptance

1. Create one Project summary capability and persist only its hash.
2. Resolve the public Project read model without accepting tenant context from the request.
3. Expose customer-safe contact, location, schedule, milestone, Invoice, payment, Refund, and
   explicitly customer-visible Document presentation.
4. Record first-view and append-only view evidence while keeping employee identifiers, internal
   notes, costs, and margins out of the response.
5. Convert a committed lifecycle outbox event into one notification request through the typed policy
   registry.
6. Reuse the Project capability, inject the plaintext URL only into the in-memory provider request,
   and persist no plaintext capability.
7. Replay the source event and retain one Delivery and one provider call for the channel.
8. Reject tampered, expired, revoked, and foreign-tenant capability access.

## Phase 3 acceptance

1. Schedule a reminder from the committed Job schedule event and claim it through the shared
   PostgreSQL scheduled-work queue.
2. Re-read the current Job and customer records at execution time, create the Project capability,
   and deliver the secure link once.
3. Replay the scheduled work and retain one Delivery and provider call.
4. Classify provider timeouts and availability failures as retryable while dead-lettering permanent
   rejection without storing raw provider details.
5. List redacted queue metrics, failed operations, and scheduled reminders for staff, then retry a
   failed Delivery or dead-lettered reminder through an audited idempotent command.
6. Edit Contact preferences through accessible email and SMS controls.
7. Load the Communications and customer Project routes from a production build and exercise their
   loading, empty, success, expired, revoked, and error presentation.

## Required validation

```bash
pnpm db:migrate
pnpm test:integration
pnpm api:check
pnpm check
```
