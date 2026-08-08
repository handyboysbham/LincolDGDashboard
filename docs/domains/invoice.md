# Invoice Architecture

Implementation note: Sprint 1.7.0 Phase 1 establishes the tenant-scoped Invoice, Version, Line Item,
Adjustment, and Delivery tables in migration `0007_finance_data_foundation.sql`. The database
already enforces posted-record immutability and serialized Invoice eligibility; application commands
and API workflows begin in Phase 2.

## Structure

```text
Invoice Parent
├── Invoice Versions
├── Invoice Line Items
├── Invoice Adjustments
├── Invoice Deliveries
├── Payment Allocations
└── Dispute and resolution summary
```

## Invoice Parent

Owns the continuing billing obligation:

- Invoice number and type
- Customer and Project
- lifecycle status
- current and posted version
- issue and due dates
- current balance
- delivery summary
- dispute summary
- void and replacement relationships

## Invoice Version

Preserves one complete calculation and customer-facing presentation.

Draft versions may change. Posted versions are immutable.

A new Version is created before posting when:

- line items change
- deposit application changes
- Job Charge is added or removed
- tax changes
- billing identity changes materially
- customer-facing wording changes after sharing

Post-posting changes use Adjustments, Credit Memos, or void and replacement.

## Invoice types

V1:

- Deposit Invoice
- Final Invoice
- Additional Charge Invoice
- Credit Memo

## Line items

Every line must have a traceable source:

- accepted Quote line
- approved Job Charge
- Deposit Application
- Customer Credit
- tax or rounding rule

Never expose internal cost, margin, supplier markup, or approval discussion.

## Deposit handling

Advance Payment:

```text
Deposit Invoice
→ Payment Allocation
→ Deposit Balance
→ Deposit Application to Final Invoice
```

Refundable Security Deposit is not automatically applied to service charges.

Split deposits maintain separate advance and security balances.

## Posting

Posting must atomically:

1. Validate Invoice Readiness.
2. Lock the Invoice Version and Line Items.
3. Finalize issue and due dates.
4. Finalize tax.
5. Create the customer receivable.
6. Mark included Job Charges Invoiced.
7. Record deposit and credit applications.
8. Write Audit and outbox events.

Posting is idempotent.

## Invoice Adjustment

Corrects a posted Invoice without rewriting it.

Types may include:

- additional charge
- credit
- tax adjustment
- deposit application or reversal
- write-off
- charge reversal
- due-date extension
- void
- replacement link

Only Posted Adjustments change the authoritative balance.

## Balance

```text
Current Invoice Total
= Posted Invoice Total
+ Posted Debit Adjustments
- Posted Credit Adjustments

Outstanding Balance
= Current Invoice Total
- Applied Payments
- Applied Deposits
- Applied Customer Credits
- Posted Write-Offs
```

A negative result creates Customer Credit rather than an unexplained negative Invoice balance.

## Statuses

```text
Draft
Review Required
Ready to Post
Posted
Sent
Viewed
Partially Paid
Paid
Past Due
Disputed
Collection Hold
Adjusted
Credited
Written Off
Voided
Replaced
Resolved
Archived
```
