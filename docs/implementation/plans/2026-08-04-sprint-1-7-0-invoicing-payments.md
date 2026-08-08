# Sprint 1.7.0 Invoicing and Payments Plan

## Objective

Complete the canonical Material Delivery Project from approved commercial and operational charges
through posted Invoices, received Payments, controlled value application, reversals, and financial
closure. Preserve every posted customer obligation and every movement of customer value as
append-only financial history.

## Source documents

- `AGENTS.md`
- `apps/server/AGENTS.md`
- `apps/web/AGENTS.md`
- `packages/database/AGENTS.md`
- `tests/acceptance/AGENTS.md`
- `docs/architecture/v1-build-readiness.md`
- `docs/architecture/object-model.md`
- `docs/architecture/database-schema.md`
- `docs/architecture/state-transitions.md`
- `docs/domains/invoice.md`
- `docs/domains/payment.md`
- `docs/domains/job-charge.md`
- `docs/domains/project-and-job.md`
- `docs/implementation/acceptance-journeys.md`
- `docs/implementation/build-sequence.md`
- `docs/implementation/sprints.md`

## Scope boundaries

- Invoice owns the formal customer obligation; it does not rewrite the accepted Quote, Contract,
  operational Job Charge, or Expense.
- Invoice Version owns one complete customer-facing calculation. Posted Versions and their Line
  Items are immutable.
- Invoice Adjustment changes a posted obligation without rewriting its posted Version.
- Payment owns money received into a company-controlled account. Processor fees remain Expenses.
- Payment Allocation, Deposit Application, and Customer Credit Application are append-only value
  movements. Corrections create linked reversal entries.
- Deposit Balance and Customer Credit own available customer value. Their availability is derived
  from source value, applications, reversals, and settled Refunds.
- Refund owns money returned. Settled Refunds are immutable, and an alternate method or payee
  requires attributable approval evidence.
- Job and Project financial completion are derived from posted obligations and unresolved customer
  value; clients cannot set financial completion directly.
- Dump Trailer Rental security-deposit operations remain Sprint 1.8.0, but the shared finance model
  supports advance and refundable-security classifications from the start.

## Database ownership

| Table                          | Responsibility                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `invoices`                     | Continuing customer obligation, type, status, Project, Job, and lifecycle        |
| `invoice_versions`             | Immutable posted calculation and presentation snapshot                           |
| `invoice_line_items`           | Traceable accepted Quote, Job Charge, application, tax, and adjustment lines     |
| `invoice_adjustments`          | Posted debit, credit, write-off, due-date, void, and replacement corrections     |
| `invoice_deliveries`           | Attributable delivery attempts and customer-view evidence                        |
| `payments`                     | Money received, verified, settled, reversed, and retained with provider evidence |
| `payment_allocations`          | Append-only Payment-to-Invoice applications and linked reversals                 |
| `deposit_balances`             | Advance or refundable-security value created from a settled deposit allocation   |
| `deposit_applications`         | Append-only Deposit-to-Invoice applications and linked reversals                 |
| `customer_credits`             | Unapplied or overpaid customer value                                             |
| `customer_credit_applications` | Append-only Customer-Credit-to-Invoice applications and linked reversals         |
| `refunds`                      | Controlled return of Payment, Deposit, or Customer Credit value                  |

## Integrity model

- Money uses integer cents and one three-letter currency per financial relationship.
- Every finance table carries `tenant_id`, uses forced Row-Level Security, and has runtime grants.
- Tenant-aware foreign keys keep Invoice, Payment, Deposit, Credit, Refund, Customer, Project, and
  optional Job relationships aligned.
- Posted Invoice Versions and their Line Items reject insert, update, and delete mutation.
- Posted Adjustments alone change a posted Invoice obligation.
- Allocation and application rows are append-only. A reversal points to exactly one prior entry,
  uses the same source, target, and amount, and may be created only once.
- Payment, Deposit, and Customer Credit applications lock their source and target and may not exceed
  either available source value or eligible Invoice balance under concurrency.
- Deposit and Customer Credit availability is derived; no command directly edits an available
  balance.
- Provider transaction references are unique per tenant and provider when present.
- Settled Refunds and all applied value movements are immutable and never hard-deleted.
- A negative Invoice result creates Customer Credit rather than a negative unexplained balance.

## Planned application commands

- create Deposit, Final, Additional Charge, or Credit Memo Invoice
- create or revise a draft Invoice Version from accepted Quote lines and approved Job Charges
- evaluate Invoice readiness and prepare an exact customer-facing calculation
- post, deliver, view, void, or replace an Invoice through explicit commands
- create, approve, post, or reverse an Invoice Adjustment
- record, verify, settle, fail, or reverse a Payment
- allocate Payment value to one posted Invoice and reverse that Allocation
- create a Deposit Balance from a settled Deposit Invoice allocation
- apply or reverse Advance Payment value on a Final Invoice
- create and apply Customer Credit from overpayment, Credit Memo, or released value
- create, approve, process, settle, fail, cancel, or reverse a Refund
- evaluate Job and Project financial completion from authoritative financial records

Every retryable command will lock the financial aggregate, validate state and permission, enforce
currency and Customer ownership, write Audit and outbox events, and commit through the existing
idempotency boundary.

## Delivery phases

### Phase 1 — Financial data foundation

- add the twelve finance-owned tables and reviewed forward migration
- add tenant-aware ownership, checks, append-only guards, posted-Version guards, balance guards,
  RLS, grants, and metadata triggers
- prove empty/existing migration behavior, tenant isolation, immutability, and concurrency
  invariants

Status: complete on 2026-08-04. Migration `0007_finance_data_foundation.sql` supplies the twelve
tenant-owned finance tables, forced RLS, append-only and posted-record guards, and serialized source
and Invoice balance checks. PostgreSQL integration coverage proves clean migration, tenant
isolation, immutable posted obligations and settled value, over-application rejection, and
concurrent Customer Credit application safety.

### Phase 2 — Invoice application layer

- implement draft Invoice and Version creation from accepted Quote and approved Job Charge sources
- calculate authoritative integer-cent totals and traceable Line Items
- post Versions atomically, mark included Job Charges invoiced, and record delivery evidence
- implement post-posting Adjustments, Credit Memos, void, and replacement

### Phase 3 — Payments, deposits, and credits

- record, verify, and settle company-received Payments
- implement append-only Payment Allocations and reversals
- create and apply Advance Payment Deposit Balances exactly once
- create Customer Credit for unapplied value, overpayment, Credit Memo, and approved corrections

### Phase 4 — Refunds, reversals, and financial completion

- implement approval and settlement workflow for Refunds
- reverse Payments and every dependent Allocation without deleting history
- reopen affected Invoice, Job, and Project completion state
- derive Job and Project financial completion from posted obligations and unresolved customer value

### Phase 5 — Web and full acceptance

- build finance work queues, Invoice detail/posting, Payment allocation, Deposit/Credit, and Refund
  UI
- build customer-safe Invoice views and delivery evidence
- complete the full `MD-E2E-001` journey through $185 deposit, $235 final payment, and closure
- cover partial payment, overpayment, duplicate applications, and reversal reopening

## Sprint 1.7 completion checklist

- [x] reviewed finance migration applies to empty and existing PostgreSQL databases
- [x] every finance table has forced RLS and tested tenant isolation
- [x] posted Invoice Versions and their Line Items are immutable
- [x] applied value movements and settled Refunds are append-only and immutable
- [x] source availability and Invoice eligibility remain correct under concurrency
- [ ] Invoice posting is idempotent and marks included Job Charges exactly once
- [ ] deposit and Customer Credit applications cannot be duplicated
- [ ] Payment reversal reopens every affected obligation and completion state
- [ ] authoritative balances reconcile from source transactions
- [ ] finance web and customer Invoice routes pass production acceptance
- [ ] the full `MD-E2E-001` journey passes
- [ ] OpenAPI and generated client artifacts are current
- [ ] `pnpm check`, `pnpm db:migrate`, and `pnpm test:integration` pass
