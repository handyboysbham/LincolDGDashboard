# Job Charge

## Purpose

Job Charge is the controlled bridge between operational facts and customer billing after Quote
acceptance.

It may represent:

- a Charge
- a Credit
- a No-Charge Adjustment
- an Informational Adjustment

## Supported examples

Material Delivery:

- additional material
- increased or reduced quantity
- additional delivery trip
- additional supplier stop
- additional placement or spread service
- customer waiting time
- substitution increase or credit

Dump Trailer Rental:

- additional rental day
- weight overage
- disposal-cost overage
- failed pickup
- special pickup
- trailer relocation or exchange
- prohibited-material handling
- cleaning
- damage

## Record boundaries

- Operational source records what occurred.
- Accepted Quote and Contract record commercial terms.
- Job Charge records the billing decision.
- Expense records company cost.
- Invoice records the formal customer bill.

## Amounts

Preserve separately:

- calculated amount
- proposed amount
- approved amount
- invoiced amount
- credited amount
- remaining billable amount

Historical accepted rates must be used rather than current Pricing Version rates.

## Responsibility

Suggested states:

```text
Customer
Lincoln Dirt and Gravel
Shared
Supplier
Disposal Facility
Vendor
Insurance
Unknown
Disputed
Not Applicable
```

Business-caused rework should not automatically become a customer charge.

## Authorization and approval

Customer authorization may be required when:

- scope increases
- new work is requested
- accepted terms do not already authorize the variable charge

Internal approval may be required for:

- high-value charge
- damage
- prohibited material
- manual amount
- reduced or waived charge
- incomplete evidence
- verbal authorization
- credit above threshold

## Statuses

```text
Draft
Calculating
Evidence Required
Responsibility Review
Awaiting Customer Authorization
Awaiting Internal Approval
Approved
Partially Approved
Rejected
Waived
Disputed
Ready to Invoice
Invoiced
Partially Invoiced
Credited
Reversed
Resolved
Cancelled
```

## Duplicate prevention

Use a stable dedupe key based on:

- Job
- charge type
- operational source
- allowance or service period
- quantity and rate context

Examples to prevent:

- two weight-overage charges for one rental reconciliation
- two additional-day charges for the same dates
- two failed-pickup charges for the same event
- both weight and disposal-cost overage without accepted authorization

Sprint 1.6.0 migration `0006` enforces one active dedupe key per tenant and Job. Job Charge amount
fields use integer cents, operational quantity uses controlled decimal precision, and every Charge
retains its source type, source identifier, calculation snapshot, responsibility, evidence,
authorization, approval, tax behavior, and customer description. Approved facts are immutable;
corrections use a Credit, No-Charge decision, cancellation before approval, or a linked reversal
rather than deletion.

The Sprint 1.6.0 application command validates that an operational source belongs to the same Job,
calculates quantity-times-rate amounts with fixed-point arithmetic, allocates a tenant-scoped Charge
number, and rejects duplicate active dedupe keys. Approval produces Ready to Invoice only after
evidence, responsibility, authorization, and internal approval are resolved. Cancellation is limited
to drafts; approved corrections create a linked reversal.

## Ready to Invoice

Requires:

- final calculation
- source and accepted term
- responsibility review
- evidence
- customer authorization when required
- internal approval when required
- customer-facing description
- tax behavior
- no blocking dispute
- no duplicate charge
