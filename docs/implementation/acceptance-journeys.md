# End-to-End Acceptance Journeys

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
10. Complete the operational and financial lifecycle, close the Job, reject an ordinary child edit,
    and reopen it with a reason.

### Negative tests

- a foreign tenant cannot read Project, Job, Contract, schedule, reservation, or readiness records
- a customer Contract response exposes no internal identifiers, notes, or deposit evidence
- a Contract link is invalid after expiration or revocation and its plaintext token is never stored
- a different request replayed with one idempotency key is rejected
- Contract content and signature evidence reject direct mutation

---

## MD-E2E-001 — Multi-Material Delivery

Implementation status: Sprint 1.6.0 verifies the PostgreSQL-backed operational portion through steps
9–16, including the staff and mobile driver production routes. Sprint 1.7.0 will extend the same
canonical journey through final invoicing, payment allocation, and financial completion.

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
19. Mark Invoice Paid, Job Financially Complete, and close Project.

### Negative tests

- 11,000-pound estimate blocks dispatch.
- Missing supplier receipt blocks Invoice Readiness.
- Second Deposit Application is rejected transactionally.
- Duplicate Quote acceptance does not create another Project.
- Sent Quote content and line items reject direct mutation.
- A superseded link returns Gone and cannot accept.
- A declined Quote remains terminal and cannot accept later.

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
