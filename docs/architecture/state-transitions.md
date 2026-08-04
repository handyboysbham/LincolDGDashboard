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
Scheduled for Drop-Off
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

The rental cannot complete while the trailer remains loaded.

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
