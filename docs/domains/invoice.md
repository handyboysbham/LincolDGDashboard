# Invoice Architecture

Implementation note: Sprint 1.7.0 Phase 1 establishes the tenant-scoped Invoice, Version, Line Item,
Adjustment, and Delivery tables in migration `0007_finance_data_foundation.sql`. The Phase 2 core
implements source-driven draft creation and revision, readiness, posting, Job Charge capture,
delivery evidence, queries, REST contracts, controlled Adjustments, void, and replacement. Posted
record immutability and serialized Invoice eligibility remain database-enforced. Phase 3 adds
Payment, Deposit, and Customer Credit applications with derived `Partially Paid` and `Paid` states.
Phase 4 reevaluates authoritative Job and Project financial completion after posting corrections or
moving customer value; a later reversal reopens completion without rewriting an Invoice ledger.
Phase 5 adds Project and Billing web workflows plus secure customer Invoice presentation. Migration
`0009_invoice_customer_links.sql` binds every customer capability to one posted Version and delivery
attempt with hash-only storage, expiration, revocation, and customer-view evidence.

## Implemented commands

- create a Deposit, Final, Additional Charge, or Credit Memo draft from authoritative Project,
  accepted Quote, and eligible Job Charge records
- revise an unposted Invoice by superseding its current Version
- prepare a Draft Version only while its billing and source snapshot still reconciles
- post a Ready Version idempotently, lock its sources, mark included Job Charges Invoiced, and move
  a Final-Invoice Job from Awaiting Final Invoice to Invoiced
- record attributable sent, delivered, or failed delivery evidence
- create a pending debit, credit, tax, write-off, or due-date Adjustment against a posted Invoice
- approve and post an Adjustment without rewriting its posted Invoice Version
- reverse a posted monetary Adjustment through one uniquely linked compensating Adjustment
- void an unapplied Invoice with an exact posted credit Adjustment and attributable reason
- replace an unapplied, clean-total Invoice atomically with a newly numbered posted Invoice while
  preserving both relationship links and the original obligation history
- apply or reverse Payment, Advance Payment Deposit, and Customer Credit value without mutating an
  applied ledger entry
- create Customer Credit automatically when a posted credit Adjustment exceeds the remaining
  customer obligation
- list and load Invoice read models with derived outstanding balances
- create and revoke secure customer Invoice links and record the first public view as delivery
  evidence

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

Normal Adjustments follow `Pending Approval → Approved → Posted`. A reversal never edits the
original posted Adjustment; it creates an opposite-direction Adjustment linked through
`reverses_invoice_adjustment_id`. Void and replacement are dedicated commands that create their
exact credit Adjustment atomically. They reject Invoices with applied customer value because value
transfer belongs to the Payment, Deposit, and Customer Credit workflows.

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

A negative result creates Customer Credit rather than an unexplained negative Invoice balance. Only
the excess below already-applied customer value becomes Credit, so the obligation and customer value
ledgers continue to reconcile exactly.

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
