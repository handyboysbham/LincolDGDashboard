# Disposal Load

## Purpose

A Disposal Load records one actual unloading or disposal transaction associated with a Dump Trailer
Rental Job.

One rental may have multiple Disposal Loads.

## Responsibilities

- planned and actual facility
- debris classification
- facility acceptance or rejection
- arrival, unloading, and departure times
- gross, tare, and net weight
- scale ticket and receipt
- disposal cost and Expense link
- partial unloading and remaining material
- empty-trailer confirmation
- contribution to rental-wide allowance and overage
- reconciliation state

## Suggested statuses

```text
Planned
Facility Review
Ready for Disposal
En Route
At Facility
Acceptance Pending
Accepted
Weighed In
Unloading
Partially Unloaded
Unloaded
Weighed Out
Documentation Pending
Reconciling
Reconciled
Rejected
Redirected
Cancelled
```

## Weight

When gross and tare are available:

```text
Net Weight = Gross Weight - Tare Weight
```

Rules:

- Gross cannot be less than tare.
- Net cannot be negative.
- Preserve source units and conversions.
- Estimated weight is not automatically sufficient for customer overage unless accepted terms allow
  it.

## Facility rejection

A rejected load remains preserved.

Workflow:

```text
Record rejection and evidence
→ determine whether load is safe to move
→ identify alternate facility
→ recalculate route and cost
→ determine customer responsibility
→ create Task, Hold, Case, or Job Charge review
→ create replacement Disposal Load when needed
```

Do not rewrite the rejected record to look like the next facility was the original plan.

## Allowance and overage

Default rule:

> Included weight and disposal allowances apply to the entire rental Job unless the accepted Quote
> explicitly states otherwise.

Rental-wide weight overage:

```text
Total Actual Weight = sum of reconciled Disposal Load net weights
Overage Weight = max(Total Actual Weight - Included Weight, 0)
Charge = Overage Weight × Accepted Overage Rate
```

Prevent duplicate overage Job Charges.

## Reconciliation

A Disposal Load is reconciled when:

- actual facility and acceptance result exist
- unloading outcome exists
- weight exists or is formally not applicable
- ticket and receipt exist or approved exception exists
- Expense exists when a fee applies
- empty-trailer result exists
- remaining material is resolved
- rejection and variance are resolved
- overage contribution is calculated

Sprint 1.8 Phase 4 implements these facts as tenant-scoped, idempotent application commands. Each
Load owns a disposal Schedule Block, driver, truck reservation, trailer assignment, and Route Stop.
Ticket, receipt, and empty-trailer Documents are linked to the Load; a positive disposal fee creates
an attributable reconciled Expense. Gross-minus-tare and tons-to-pounds conversion use fixed-point
thousandths, and only reconciled Loads contribute to the rental-wide weight summary.

Rejected and redirected Loads are terminal and are never rewritten. A replacement references the
terminal Load, and operational completion accepts that history only after a replacement chain
reaches Reconciled.
