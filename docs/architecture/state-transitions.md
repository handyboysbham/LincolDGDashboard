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
Pending Setup
→ Pending Contract or Pending Deposit
→ Ready for Planning
→ Planning
→ Active
→ Operationally Complete
→ Financially Complete
→ Completed
→ Closed
```

`On Hold` may interrupt nonterminal states. Reopening is controlled and audited.

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
