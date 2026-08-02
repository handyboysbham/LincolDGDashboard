# Payment, Allocation, Customer Credit, and Refund

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
