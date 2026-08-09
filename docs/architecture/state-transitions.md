# State Transitions

## General transition service

Every transition must:

1. Lock the record when concurrency matters.
2. Confirm current state.
3. Confirm permission.
4. Evaluate readiness.
5. Validate related records.
6. Apply the state change.
7. Write Audit Events.
8. Write outbox events.
9. Create tasks and notifications.
10. Commit atomically.

## Lead

```text
New → Contacting → Qualified → Estimating → Quoted → Accepted
```

Terminal alternatives:

```text
Lost | Cancelled | Duplicate | Disqualified
```

Sprint 1.3.0 owns these explicit intake commands:

| Command          | Allowed source | Result       |
| ---------------- | -------------- | ------------ |
| Start contacting | New            | Contacting   |
| Qualify          | Contacting     | Qualified    |
| Start estimating | Qualified      | Estimating   |
| Mark lost        | New–Estimating | Lost         |
| Cancel           | New–Estimating | Cancelled    |
| Mark duplicate   | New–Estimating | Duplicate    |
| Disqualify       | New–Estimating | Disqualified |

Every terminal command requires a reason. The API locks the Lead, validates the source state and
permission, and writes the state change, Audit Event, outbox event, and idempotency result in one
transaction. Sprint 1.4.0 moves Estimating to Quoted when an approved Quote Version is sent and
moves Quoted to Accepted inside the Quote-acceptance transaction.

## Estimate

```text
Draft → Pending Approval → Approved → Quote Generated
```

Revision creates a new Estimate Version; it does not overwrite an approved version.

## Quote Version

```text
Draft → Ready to Send → Sent → Viewed → Accepted
```

Alternatives:

```text
Declined | Expired | Withdrawn | Superseded
```

Approval records the approver and prepares the exact commercial snapshot for sending. Sent, viewed,
accepted, and terminal Quote Version content and child line items/terms are immutable. Revision
supersedes the prior nonaccepted version and creates a new Draft; terminal versions cannot accept.

## Project

```text
Pending Contract
→ Pending Deposit
→ Ready for Planning
→ Planning
→ Active
→ Operationally Complete
→ Financially Complete
→ Completed
→ Closed
```

Contract execution advances a Project to Pending Deposit, or directly to Ready for Planning when the
deposit is waived. Confirming deposit readiness records external evidence and advances to Ready for
Planning. `On Hold` may interrupt nonterminal states and preserves the prior state. Reopening a
closed Project is reasoned, controlled, audited, and returns to Planning.

## Shared Job

```text
New
→ Planning
→ Needs Scheduling
→ Scheduled
→ Dispatch Ready
→ Active
→ Operationally Complete
→ Awaiting Final Invoice
→ Invoiced
→ Financially Complete
→ Closed
```

Alternatives:

```text
On Hold | Cancelled
```

Schedule confirmation evaluates Project Contract and deposit readiness, required block types, driver
assignments, and active Asset Reservations. Dispatch and completion have separate readiness
evaluations. Holds restore the prior status when released. Closed Jobs reject ordinary updates;
reasoned reopening returns to Planning and records `reopened_at`.

For Material Delivery, schedule confirmation additionally requires one current planning-safety
evaluation for every active Material Load. Dispatch readiness requires a current dispatch-safety
evaluation. Capacity, compatibility, or separation failure produces `not_ready`; there is no
override transition. Revising a planned Item or hauling Asset invalidates the Load summary and
requires a new immutable evaluation.

## Material Load

```text
Planned
→ Ready for Loading
→ At Supplier
→ Loading
→ Loaded
→ En Route
→ At Customer
→ Unloading
→ Delivered
→ Reconciling
→ Reconciled
```

Partial delivery is a nonterminal state requiring remaining-quantity disposition.

Planning commands create the Detail, Loads, Items, supplier/customer Route Stop relationships, and
hauling Asset snapshots while the Job is in Planning or Needs Scheduling. Safety evaluation is an
explicit idempotent command: planning evaluation is allowed before schedule confirmation, while
dispatch evaluation requires a Scheduled Job.

Driver execution requires an Active Job and follows the ordered Load lifecycle. Purchased and loaded
quantities are recorded before an immutable actual-load safety evaluation; departure is blocked when
that evaluation is missing, stale, or unsafe. Delivery completion requires delivered and remaining
quantities, a delivery result, remaining-material disposition, and placement evidence when required.
Reconciliation additionally requires supplier tickets and resolved quantity variances.

## Rental operational state

```text
Planning
→ Scheduled for Drop-Off
→ Drop-Off Preparing
→ En Route for Drop-Off
→ At Customer for Drop-Off
→ Delivered
→ On Rent
→ Pickup Scheduled
→ Pickup Preparing
→ En Route for Pickup
→ At Customer for Pickup
→ Picked Up
→ Awaiting Disposal
→ At Facility
→ Unloading
→ Inspection Required
→ Returned
→ Complete
```

Phase 2 derives the Rental Detail from the Project's accepted Quote Version. Debris approval
requires customer attestation, passing placement access, passing legal towing review, and no
prohibited materials. Schedule readiness requires separate drop-off and pickup blocks, a driver and
truck for each, the selected trailer on both blocks, and one active occupancy reservation covering
the full rental term. Dispatch readiness additionally requires confirmed blocks and a completed
pre-drop-off inspection whose release decision is `release` and whose safe-to-release result is
true.

Drop-off execution is ordered and idempotent. Preparing requires a Dispatch Ready Job; departure,
arrival, placement, and customer-custody actions require an Active Job. Completing placement records
the actual drop-off time and completes the drop-off Route Stop and Schedule Block. Beginning the
rental records `on_rent_at`, keeps occupancy active, and changes the selected trailer Asset to In
Use. The rental cannot complete while the trailer remains loaded or its continuous occupancy remains
active.

Phase 3 adds an attributable Extension workflow:

```text
Requested
→ Availability Review
→ Awaiting Customer Authorization
→ Awaiting Internal Approval
→ Approved
```

Rejected and Cancelled are terminal alternatives. Availability checks the proposed extension of the
trailer occupancy and the shifted pickup-vehicle reservation. Approval rechecks availability while
locking the Job, Rental Detail, Extension, pickup Schedule Block, and affected Asset Reservations.
It then moves the pickup block and its reservations, extends occupancy, and updates the planned
pickup atomically. A reservation conflict cannot be overridden or leave a partially moved schedule.

Pickup execution is also ordered and idempotent. Creating an attempt requires an Active Job, a
confirmed pickup block, exactly one driver, an assigned truck, the Rental trailer, and attributable
customer notification, access, and safe-load facts. Preparation, departure, and arrival move the
Rental through the shared pickup states. Failure preserves an immutable Pickup Attempt and returns
the Rental to On Rent without ending customer custody. Retrieval requires passing access and
safe-load results; only then are `customer_custody_ended_at` and `actual_pickup_at` recorded and the
pickup Route Stop and Schedule Block completed. Trailer occupancy and In Use status continue through
disposal and final inspection.

Phase 4 creates one confirmed disposal Schedule Block, driver assignment, truck reservation, trailer
assignment, Route Stop, and Disposal Load for each independently executed trip. Facility acceptance,
weight, unloading, evidence, Expense, and reconciliation are explicit commands. A rejected or
redirected Load is terminal history; a new Load references it and the source is resolved only when a
replacement chain reaches Reconciled.

Rental weight is derived from reconciled Disposal Loads using fixed-point thousandths of a pound.
After all Loads are resolved and the trailer is documented empty, the Rental requires a post-rental
inspection. Completing that inspection releases continuous occupancy and moves the trailer to
Available only for a safe release; quarantine and out-of-service outcomes release occupancy but keep
the Asset Out of Service. Final reconciliation derives one additional-day Charge per approved
Extension and one rental-wide weight-overage Charge, then sets invoice readiness and operational
completion atomically.

## Job Charge

```text
Draft
→ Calculating
→ Evidence or Responsibility Review
→ Customer Authorization and/or Internal Approval
→ Approved
→ Ready to Invoice
→ Invoiced
→ Resolved
```

Alternatives:

```text
Rejected | Waived | Disputed | Credited | Reversed | Cancelled
```

Operational Job Charges are created through an idempotent command with a stable per-Job dedupe key.
Quantity-times-rate calculations use server-side fixed-point arithmetic and historical calculation
snapshots. Approval requires resolved evidence, responsibility, customer authorization, and internal
approval. Corrections use a linked reversal rather than mutation or deletion.

## Invoice

```text
Draft
→ Review Required
→ Ready to Post
→ Posted
→ Sent
→ Partially Paid or Paid
→ Resolved
```

Additional states:

```text
Past Due | Disputed | Collection Hold | Adjusted | Credited | Written Off | Voided | Replaced
```

## Payment

```text
Draft or Pending
→ Verification Required or Processing
→ Verified
→ Settled
→ Partially Allocated or Fully Allocated
→ Resolved
```

Alternatives:

```text
Failed | Reversed | Disputed | On Hold | Partially Refunded | Refunded
```
