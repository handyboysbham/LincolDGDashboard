# Payment, Allocation, Customer Credit, and Refund

Implementation note: Sprint 1.7.0 Phase 1 establishes Payment, append-only Allocation, Deposit,
Customer Credit, Application, and Refund records in migration `0007_finance_data_foundation.sql`.
Phase 3 implements Payment verification and settlement, append-only value movement, derived source
availability, exact-once Advance Payment creation, overpayment and Credit Memo value issuance, and
REST read models. Phase 4 adds the controlled Refund lifecycle, compensating Refund reversal,
whole-Payment reversal, and derived Job and Project financial completion. Migration
`0008_refund_reversal_integrity.sql` makes alternate-method review representable before approval and
requires an exact compensating row to restore value from a settled Refund. Database guards and
application source locks serialize every available-value check and preserve settled history. Phase 5
connects these commands to Project and Billing workflows without moving authoritative calculations
into the browser.

## Implemented commands

- record a Customer or Project Payment against a company-controlled receiving-account reference
- verify and settle a Payment through explicit idempotent transitions
- apply settled Payment value to an eligible posted Invoice and create an exact linked reversal
- create one Advance Payment Deposit Balance from one active Deposit Invoice Allocation
- apply Advance Payment value to a Final Invoice and create an exact linked reversal
- issue Customer Credit for an unapplied Payment, overpayment, Credit Memo, or over-crediting
  approved Invoice Adjustment
- apply Customer Credit to an eligible posted Invoice and create an exact linked reversal
- list and load Payments, Project Deposit Balances, and Customer Credits with derived availability
- create, approve, process, settle, fail, cancel, list, and load Refunds
- reverse a settled Refund with one exact compensating record while preserving the settled original
- reverse a whole Payment and automatically reverse every active dependent Allocation, Deposit
  Application, and Customer Credit Application
- derive and reopen Job and Project financial completion from posted obligations, unresolved value,
  and active Refund workflows

Converting Payment value into Customer Credit consumes the same source availability as direct
Allocation. A Payment row is locked for both paths, preventing concurrent double use. An Adjustment
that would reduce an obligation below already-applied customer value creates only the excess as
Customer Credit. Reversing that Adjustment first requires the generated Credit to remain unused.

## Payment

Payment records one receipt of money from or on behalf of a customer.

Owns:

- payer and Customer Account
- amount and currency
- payment method
- receiving company account
- provider transaction reference
- verification and settlement
- allocation summary
- refund and reversal summary
- evidence and receipt status

Supported configurable methods:

- Cash
- Zelle
- Venmo
- Cash App
- PayPal
- Card
- Bank Transfer
- Check

All receiving accounts must be company-controlled. Employee personal accounts and personal funds are
prohibited.

Sprint 1.10.0 adds `company_payment_accounts` as the controlled source for safe receiving-account
references. The record contains a business code, display name, supported method, safe reference,
optional staff instructions, default flag, and Active/Inactive status. It never stores provider
credentials, access tokens, raw card data, or employee personal-account details. New Payment
commands can select an active same-method account; the server copies its reference into the
immutable Payment receipt snapshot and retains the tenant-aware account ID. Historical Payments
without that ID remain valid.

### Statuses

```text
Draft
Pending
Verification Required
Verified
Processing
Settled
Partially Allocated
Fully Allocated
Partially Refunded
Refunded
Failed
Reversed
Disputed
On Hold
Resolved
Cancelled
```

### Processing fees

The customer normally receives credit for the full amount paid. Processor fees are business Expenses
unless an accepted and lawful surcharge applies.

## Payment Allocation

Applies a specific amount from Payment, Deposit Balance, or Customer Credit to a specific posted
Invoice.

Rules:

- one source and one target per Allocation
- source and target normally share Customer Account and currency
- cannot exceed source availability
- cannot improperly exceed Invoice eligibility
- Applied Allocations are immutable
- corrections use reversal and replacement
- failed or reversed Payments cannot support active Allocations

When payment target is unknown, leave it unapplied for review rather than guessing.

## Customer Credit

Represents value available to the Customer Account but not currently applied.

Sources:

- unapplied Payment
- overpayment
- Credit Memo
- released Deposit
- allocation reversal
- approved adjustment

Customer Credit may be:

- applied to an Invoice
- held for future service
- refunded
- placed on hold

Do not assume Credit expires. Cash-backed value must not be silently deleted.

## Refund

Refund records money returned to the customer or original payer.

Sources:

- Customer Credit
- overpayment
- refundable security Deposit
- cancellation
- Credit Memo
- duplicate Payment
- voided Invoice
- financial correction

Preferred policy:

> Refund to the original payment method whenever practical and appropriate.

Alternative method or payee requires approval and identity verification.

### Statuses

```text
Draft
Review Required
Pending Approval
Approved
Processing
Partially Processed
Processed
Settled
Failed
Cancelled
Reversed
Disputed
Resolved
```

Settled Refunds are immutable.

An alternate refund method is created in Review Required and cannot be approved without an
attributable reason and identity-verification reference. Approval and processing reserve source
value; only settlement contributes to the refunded total. A failed or cancelled workflow releases
its reservation. Reversing a settled Refund creates a separate exact row linked through
`reverses_refund_id`; it never updates the settled record.

## Deposit Balance

Classifications:

- Advance Payment
- Refundable Security Deposit
- Split Deposit

Every deposit dollar must ultimately be:

- applied
- refunded
- retained under accepted terms
- converted to Customer Credit
- actively disputed

Unresolved required Deposit balances block Project financial completion.

## Payment reversal

A Payment reversal must:

1. Preserve the Payment.
2. Reverse active Allocations.
3. Reopen affected Invoice balances.
4. Reduce related Customer Credit.
5. Reevaluate Deposit status.
6. Reevaluate Job and Project financial completion.
7. Create financial alerts.

The whole-Payment command performs these steps atomically. It blocks while any dependent Refund
remains economically active, reverses active application rows before resolving derived Deposit or
Customer Credit sources, marks the Payment Reversed, reopens affected Invoices, and reevaluates
financial completion. Reversed Payments expose zero available value.
