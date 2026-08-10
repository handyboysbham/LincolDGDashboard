# Communications and Customer Experience

## Purpose

Communications convert committed business events into customer-safe email or optional SMS delivery
without placing provider calls inside business transactions. Customer Project access uses a separate
purpose-limited capability and exposes only approved customer-facing records.

## Notification ownership

- A Notification Template is one tenant-owned, channel-specific content version.
- Draft Templates are editable only by replacement; publishing makes their content immutable.
- Publishing a newer version retires the previously published version for the same key and channel.
- A Notification Preference belongs to one Customer Account and one related Contact.
- A Notification Delivery is derived from exactly one committed outbox event and one published
  Template version.
- A Notification Delivery Attempt records each provider invocation without storing credentials,
  tokens, or raw provider responses.

## Phase 1 command flow

```text
Staff queues customer-safe variables
→ transaction validates Customer, Contact, channel, and published Template
→ Audit Event and notification.requested outbox event commit atomically
→ worker claims the outbox event
→ preference is evaluated
→ Template is rendered on the server
→ one deduplicated Notification Delivery is created
→ every provider attempt for the Delivery uses one stable idempotency key
→ delivery or failure history is committed
```

The API never calls an email or SMS provider directly. The worker selects the configured capture or
Resend email adapter and the capture, disabled, or Twilio SMS adapter. Provider calls have a bounded
timeout and a stable idempotency key. Configuration errors and customer/provider rejection are
permanent; timeouts, rate limits, invalid success responses, and availability failures are
retryable. Only controlled error codes enter durable history or logs.

## Template syntax and safety

Templates use plain-text `{{variableName}}` placeholders. A Template declares its complete variable
allowlist. A queued request must provide exactly those variables. Internal cost, margin, supplier
cost, approval discussion, and internal-note variables are prohibited.

Email Templates require a subject. SMS Templates do not. Published and retired Template content is
immutable; corrections use a new version.

## Preferences

Preferences are scoped by Contact and notification type. Email defaults on and SMS defaults off when
no explicit preference exists. A disabled channel produces a durable Suppressed Delivery and no
provider call.

Transactional notices can become mandatory only through a reviewed product and legal decision. The
Phase 1 model does not silently override a stored customer preference.

## Delivery states

```text
Pending → Sending → Delivered
                  ↘ Failed → Sending
Pending → Suppressed
```

Delivered and Suppressed Deliveries are terminal. Provider failure stores only a controlled error
code. Retries append Attempt evidence but reuse the Delivery's provider idempotency key, including
after a timeout or worker crash, so an ambiguous provider result cannot intentionally send twice.

## Integrity and security

- Every table includes `tenant_id`, forced Row-Level Security, and tenant-aware foreign keys.
- Delivery history and provider attempts cannot be deleted.
- Delivery content, ownership, recipient, and origin cannot be rewritten after creation.
- Provider credentials, secure-link tokens, and raw provider errors are never stored in delivery
  history or logs.
- Customer-facing messages may contain only approved presentation data and scoped secure links.

## Automatic lifecycle policies

The worker maps committed `quote.sent`, `contract.sent`, `contract.executed`, `job.scheduled`,
delivery or rental departure, `job.operationally_completed`, `invoice.sent`, `payment.settled`, and
`refund.settled` events through a typed policy registry. Each policy re-reads authoritative records,
selects the related primary Contact, derives an allowlisted presentation model, and queues a
`notification.requested` event only after the source event commits.

The source event identifier, Contact, notification type, and channel form the delivery deduplication
boundary. Replaying a source event can safely reproduce the request event, but it cannot create a
second Delivery or provider invocation. The source actor is retained on claimed outbox events so
automatic Audit Events remain attributable.

## Customer Project capability

A customer Project capability is Project- and Customer-scoped, stored only as a hash, expiring, and
revocable. Creating a replacement serializes on the Project and revokes any prior active summary
capability. Public resolution derives tenant context only by matching the token hash; it never
trusts a browser-supplied tenant identifier. Every successful view records first-view metadata plus
an append-only view row and Audit Event.

The public read model is an explicit allowlist containing customer contact and service-location
presentation, safe Project status, schedule windows, customer milestone labels, posted Invoices,
settled payment receipts, Refund status, and explicitly customer-visible Project Documents. Existing
Invoice and Document capabilities are reused for their resource links. Employee identifiers,
supplier costs, margins, approval discussions, operational notes, and private Documents are not
selected into the response.

Capability URLs exist only at creation or provider-call time. Notification variables and delivery
history store a `[secure customer link]` placeholder, while the provider request receives the
regenerated URL in memory after validating that the referenced capability is still current and
usable.

## Scheduled reminders

A committed `job.scheduled` event creates or reuses a deduplicated `communications.service_reminder`
row in the shared PostgreSQL scheduled-work queue. The configured lead time determines `run_at`;
scheduling inside that lead window makes the reminder immediately eligible. Execution re-reads the
current Job, Project, Customer, and Contact. A changed schedule or terminal Job makes the old
reminder stale without delivery. Missing or incompatible published Templates fail through normal
scheduled-work retry and dead-letter handling.

The scheduled Job identifier becomes the notification source identifier. Replaying completed work
can produce another request event, but Delivery uniqueness prevents a second provider call. Project
capability creation, Audit Events, and the notification request commit atomically.

## Staff and customer workflows

`/communications` exposes aggregate queue health, Template versions, masked-recipient Delivery and
Attempt evidence, reminders, and redacted dead letters. Staff can create Template drafts, publish a
draft, and retry failed Delivery, outbox, or reminder work through explicit permission-checked and
idempotent commands. Retry resets queue ownership and retry counters; it never deletes Attempt or
Delivery history.

The Customer detail view exposes per-Contact, per-notification-type email and SMS controls. The
public `/customer/projects/{token}` route renders the allowlisted Project summary with safe
schedule, milestone, Document, Invoice, receipt, and Refund presentation. It provides explicit
loading, empty, expired, revoked, invalid, and unavailable states without exposing internal
identifiers.
