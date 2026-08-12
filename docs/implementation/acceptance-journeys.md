# End-to-End Acceptance Journeys

## ADMIN-E2E-001 — Tenant Administration and Operational Visibility

Implementation status: Sprint 1.10.0 Phase 1 implements the PostgreSQL, API, generated-client, and
responsive staff-workspace journey. The focused clean-database suite covers idempotency, forced RLS,
cross-tenant rejection, Checklist publication and immutability, User Role assignment, supplier
facilities, search, Audit filtering, and transactional Audit/outbox evidence.

### Journey

1. Load one tenant's Users, Roles, assets, suppliers and facilities, company Payment Accounts,
   Checklist Templates, operational counts, and recent Audit Events.
2. Add a company-controlled receiving account and replay the command without creating a duplicate.
3. Create an ordered delivery Checklist draft, publish it, then publish a new version and retire the
   prior published version.
4. Create a Job Checklist from the published version and retain both Template identity and the
   execution snapshot.
5. Link a Supabase Auth identity and assign an active Role to a User through explicit idempotent
   commands.
6. Add a supplier and facility location without creating a second facility ownership model.
7. Search authoritative Customers, Projects, Jobs, Invoices, and Payments and follow stable staff
   detail paths.
8. Filter Audit Events and confirm every command wrote one Audit Event and one outbox event in the
   same transaction.
9. Load `/settings` from a production build and use its loading, error, empty, success, keyboard,
   and narrow-viewport states.

### Negative tests

- a foreign tenant cannot read or mutate administration configuration
- a user without `administration:read` cannot load the workspace
- a read-only administrator cannot run commands
- an inactive Role cannot be assigned and a user cannot deactivate their own session
- a Checklist cannot publish without Items or for an invalid source state
- published or retired Checklist versions and Items cannot be rewritten or deleted
- a Payment cannot use an inactive, foreign-tenant, or wrong-method company account
- Payment Account records cannot contain provider credentials, tokens, raw card data, or employee
  personal-payment information

---

## COMMS-E2E-001 — Outbox-Driven Customer Communication

Implementation status: complete and rerun from a clean local PostgreSQL database on 2026-08-11.
Production-build mobile and keyboard acceptance also passed for the staff Communications workflow
and the secure customer Project loading, success, expired, revoked, invalid, and unavailable states.
Coverage includes Template publication, preference evaluation, explicit and lifecycle-event
queueing, scheduled reminders, configured providers, outbox and scheduled-work processing,
idempotent delivery, suppression, retry and dead-letter operations, tenant isolation, staff
Communications workflows, and the secure customer Project experience.

### Journey

1. Create and publish an email Template with declared customer-safe variables.
2. Enable schedule email for the Customer's primary Contact.
3. Queue a schedule notification and replay the command with the same idempotency key.
4. Process the committed `notification.requested` outbox event.
5. Record exactly one Notification Delivery and one successful provider Attempt.
6. Disable the preference and record a Suppressed Delivery without a provider call.
7. Fail a provider attempt, retry through the outbox worker, and retain ordered failure/success
   Attempts under one Delivery.
8. Process a committed Job schedule event through the lifecycle policy registry.
9. Create or reuse a hashed Project summary capability and provide its plaintext URL only to the
   in-memory provider request.
10. Replay the source event and retain one Delivery and provider call.
11. Open the customer Project summary and view allowlisted status, schedule, milestone, financial,
    and customer-visible Document presentation.
12. Record first-view and append-only view evidence, then revoke the capability and fail safely.
13. Schedule a reminder from the committed Job schedule event and re-read current Job readiness at
    execution time.
14. Deliver one reminder with a stable provider idempotency key, then replay its scheduled work and
    retain one Delivery and provider call.
15. Permanently reject one provider request, expose only its controlled error code in Communications
    operations, and retry it with an audited idempotent command.
16. Edit Contact email and SMS preferences through the Customer staff view.
17. Load the staff Communications and customer Project routes from a production build, including
    loading, empty, unavailable, expired, and revoked states.

### Negative tests

- a Template cannot declare cost, margin, approval-discussion, supplier-cost, or internal-note data
- queued variables must exactly match the published Template allowlist
- a foreign-tenant Contact cannot be targeted or read
- provider exception messages and credentials are not persisted
- scheduled reminders become stale safely when Job time or terminal state changes
- retry commands cannot operate on successful, suppressed, active, or foreign-tenant work
- Delivered and Suppressed history cannot be rewritten or deleted
- Project responses exclude employee identifiers, costs, margins, internal notes, private Documents,
  and approval discussions
- tampered, expired, revoked, and cross-tenant Project capabilities fail safely

---

## BOOT-E2E-001 — Repository Bootstrap

### Configuration

- one seeded Organization with owner and driver users
- restricted PostgreSQL runtime role with forced Row-Level Security
- private MinIO bucket with bucket-scoped application credentials
- API, worker, and web processes configured independently
- development tenant and users supplied only by server configuration

### Journey

1. Apply all forward migrations to an empty PostgreSQL database and create the local seed records.
2. Start the API, worker, and web independently.
3. Verify API liveness and database, migration, object-storage, and optional worker readiness.
4. Allocate business numbers concurrently without duplicates.
5. Replay one idempotent command and receive its original result.
6. Commit and roll back business data, Audit Events, and outbox events atomically.
7. Claim one outbox event exactly once across two workers.
8. Claim scheduled work exactly once across two workers.
9. Create a pending Document, upload bytes directly to private storage, validate it, and download it
   through a short-lived authorized URL.
10. Create and resolve an expiring customer document link whose plaintext token is not stored.
11. Load the staff, driver, and customer web routes from a production build.

### Negative tests

- an arbitrary `x-tenant-id` browser header is rejected
- a tenant cannot download another tenant's Document
- invalid uploaded bytes remain unavailable
- expired, revoked, malformed, and tampered customer links fail safely
- signed URLs, capability tokens, and storage credentials are absent from application logs
- the web package cannot import PostgreSQL or the database package

---

## INTAKE-E2E-001 — Customer Intake

### Configuration

- one authenticated tenant owner with Customer, Lead, and Document permissions
- a second tenant with a similarly named customer for isolation checks
- one available intake Document

### Journey

1. Search for duplicate Customer Accounts, Contacts, and Service Locations inside the active tenant.
2. Create a new Customer Account, primary Contact, Service Location, and Material Delivery Lead in
   one idempotent command.
3. Replay the command with the same key and receive the original Lead without duplicate records.
4. Create a separate Dump Trailer Rental Lead with a valid rental date range.
5. List Customers and Leads, then load both detail views.
6. Move the Material Delivery Lead from New to Contacting to Qualified to Estimating through
   explicit action commands.
7. Add an internal Note and follow-up Task, then complete the Task.
8. Link the available intake Document and load the Audit Event-backed timeline.
9. Close an active Lead with a terminal outcome and required reason.
10. Load `/customers`, `/leads`, `/leads/new`, and a Lead detail shell from the production web
    build.

### Negative tests

- a request containing both service detail types is rejected by the API and database constraint
- incomplete or invalid service details are rejected
- duplicate warnings never merge, overwrite, or delete records
- a foreign tenant cannot read or relate Customer, Contact, Service Location, Lead, Note, or Task
  records
- missing Lead permissions deny writes and transitions
- an invalid lifecycle source state is rejected without Audit or outbox side effects

---

## OPS-E2E-001 — Accepted Work to Conflict-Safe Schedule

### Journey

1. Accept a sent Quote twice concurrently and receive one Project plus one correctly prefixed Job.
2. Verify Project and Job planning fail before Contract and deposit readiness.
3. Generate the Contract, sign as the business, create a secure link, view it, and sign as customer.
4. Confirm external deposit readiness and start Project and Job planning.
5. Move the Job to Needs Scheduling and register an available asset.
6. Create a required Schedule Block with the current user and asset.
7. Verify an overlapping reservation for the same asset fails with a stable conflict.
8. Confirm the schedule, pass dispatch readiness, and start the Job.
9. Add a Route Stop and required Checklist, then complete its items.
10. Complete the operational lifecycle, reject ordinary edits after closure, and preserve explicit
    reopening history. Financial completion is derived by the finance journey rather than a direct
    lifecycle action.

### Negative tests

- a foreign tenant cannot read Project, Job, Contract, schedule, reservation, or readiness records
- a customer Contract response exposes no internal identifiers, notes, or deposit evidence
- a Contract link is invalid after expiration or revocation and its plaintext token is never stored
- a different request replayed with one idempotency key is rejected
- Contract content and signature evidence reject direct mutation

---

## MD-E2E-001 — Multi-Material Delivery

Implementation status: Sprint 1.6.0 verifies the PostgreSQL-backed operational portion through steps
9–16, including the staff and mobile driver production routes. Sprint 1.7.0 now also verifies a
Quote-derived
$185 Deposit Invoice and a source-reconciled Final Invoice with versioning, explicit
preparation, posting, Job Charge capture, delivery evidence, idempotent replay, and Job advancement.
The journey voids and reissues the Deposit Invoice, approves/posts/reverses a Final Invoice credit,
and atomically replaces the corrected Final Invoice without rewriting either posted Version. Phase
3 verifies and settles the $185
and $235 Payments, creates the Advance Payment Deposit exactly once, applies/reverses/reapplies
Payment, Deposit, and Customer Credit value, rejects duplicate and excess applications, and converts
overpayment or post-payment correction value into Customer Credit. Phase 4 verifies alternate-method
Refund review and identity evidence, settlement, exact Refund reversal and reissue, derived Job and
Project financial completion, whole-Payment reversal across direct and Deposit/Credit dependencies,
and automatic reopening of paid Invoices and a closed Job. Phase 5 connects the same commands to the
Project and Billing workspaces, verifies production routes for Invoice, Payment, Refund, and
customer Invoice views, and proves a scoped customer link can be viewed and revoked without exposing
internal correction reasons or cost data.

### Configuration

- Four cubic yards of #57 gravel at $32 per yard
- Two cubic yards of masonry sand at $28 per yard
- Material markup: 25%
- Delivery zone: $125
- Additional supplier stop: $25
- Separate placement: $40
- Deposit: greater of purchase cost or $150, rounded up to nearest $5
- Asset capacity: 7 cubic yards and 10,000 pounds
- Estimated weight: gravel 6,000 pounds, sand 3,000 pounds

### Expected price

```text
Purchase cost = $184
Customer material charge = $230
Delivery = $125
Additional supplier stop = $25
Separate placement = $40
Quote total = $420
Deposit = $185
```

### Journey

1. Create Customer, Contact, Location, and Material Delivery Lead.
2. Create Estimate Version with two material cost items and one proposed Load.
3. Approve Estimate at $420 and $185 deposit.
4. Send Quote with ten-day expiration.
5. Accept Quote and create one Project idempotently.
6. Generate and sign Contract.
7. Post Deposit Invoice for $185.
8. Verify $185 company Zelle Payment and allocate it.
9. Create Material Delivery Job, Detail, one Load, and two Items.
10. Create two supplier stops and two placement stops.
11. Schedule driver, truck, and trailer.
12. Load gravel and sand; upload tickets and receipts.
13. Create two Expenses totaling $184 and allocate to Items.
14. Deliver gravel to driveway and sand beside garage.
15. Upload placement evidence and reconcile quantities.
16. Complete Job operationally.
17. Post Final Invoice:

```text
Material Delivery Service  $420
Deposit Applied            -$185
Amount Due                  $235
```

18. Verify and allocate $235 Payment.
19. Mark Invoice Paid, derive Job and Project financial completion, and close the Job.

The implemented Phase 4 continuation also refunds a duplicate receipt through an approved alternate
method, reverses and reissues that Refund without mutating its settled history, derives financial
completion, then reverses both final and advance Payments to prove that the Invoice, closed Job, and
Project reopen from authoritative ledgers.

The Phase 5 customer-delivery continuation creates an expiring secure link for the posted
replacement Final Invoice, records its first customer view as delivery evidence, returns only
customer-safe financial presentation, and proves revocation returns Gone.

### Negative tests

- 11,000-pound estimate blocks dispatch.
- Missing supplier receipt blocks Invoice Readiness.
- Second Deposit Application is rejected transactionally.
- Duplicate Quote acceptance does not create another Project.
- Sent Quote content and line items reject direct mutation.
- A superseded link returns Gone and cannot accept.
- A declined Quote remains terminal and cannot accept later.
- Alternate-method Refund approval without identity-verification evidence is rejected.
- A second whole-Payment reversal is rejected without duplicate ledger entries.

---

## DTR-E2E-001 — Weekend Dump Trailer Rental

### Configuration

- Weekend rental: $350
- Included days: 3
- Additional day: $50
- Included weight: 2,000 pounds
- Overage: $0.08 per pound
- Refundable security deposit: $150
- Actual disposal weight: 2,680 pounds

### Expected final charges

```text
Weekend Rental          $350.00
Additional Rental Day    $50.00
Weight Overage            $54.40
Total                    $454.40
```

### Journey

1. Create Rental Lead for Friday drop-off and Monday pickup.
2. Estimate Weekend package and preserve all accepted rates.
3. Send and accept Quote.
4. Create Project, Rental Job, and Rental Detail.
5. Sign Contract.
6. Post and pay $150 Security Deposit Invoice.
7. Create drop-off block, occupancy reservation, and pickup block.
8. Assign driver, truck, and trailer.
9. Complete pre-delivery inspection and drop off trailer.
10. Set trailer In Use and rental On Rent.
11. Customer requests Tuesday pickup.
12. Check future reservations; approve one-day extension.
13. Create and approve $50 Job Charge.
14. Pick up trailer and end customer custody.
15. Create Disposal Load.
16. Record gross 15,620 pounds and tare 12,940 pounds.
17. Calculate net 2,680 pounds.
18. Upload ticket, receipt, Expense, and empty-trailer photo.
19. Calculate one rental-wide Weight Overage Job Charge for $54.40.
20. Complete inspection with no damage and normal cleaning.
21. Mark trailer Available.
22. Post Final Invoice for $454.40.
23. Verify and allocate final Payment.
24. Refund $150 Security Deposit through original method.
25. Mark Deposit resolved, Job Financially Complete, and close Project.

### Negative tests

- Trailer reservation conflict blocks extension approval.
- Prohibited material creates Hold and Case; no automatic charge.
- Payment reversal reopens Invoice and removes financial completion.
- Duplicate overage creation is rejected.
- Rental cannot complete until trailer is empty and inspected.
