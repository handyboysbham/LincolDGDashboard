# Initial Build Sequence

## Principle

Build complete vertical slices, not isolated tables and screens.

Each stage should produce working behavior and automated tests.

## Stage 0 — Repository foundation

Build:

- monorepo
- local infrastructure
- Next.js shell
- NestJS API and worker
- PostgreSQL and migrations
- tenant context and RLS
- audit
- outbox
- idempotency
- document storage
- CI

Exit:

- clean clone runs
- migrations and seed work
- API, worker, and web are healthy
- tenant isolation passes
- outbox processes exactly once

## Stage 1 — Customer, Contact, Location, and Lead

Build:

- Customer Account
- Contact
- Service Location
- Lead
- Notes
- Tasks
- Documents
- timeline
- duplicate lookup

Exit:

- complete Material Delivery Lead
- complete Rental Lead
- mixed-service Lead rejected
- duplicate warnings work

## Stage 2 — Pricing, Estimate, and Quote

Build:

- materials, suppliers, and costs
- Pricing Policies and Versions
- Pricing Rules
- Estimate and Estimate Versions
- approval
- Quote and Quote Versions
- Quote delivery and secure view
- acceptance and revision

Exit:

- both services produce prices
- approved Estimate Version immutable
- sent Quote Version immutable
- acceptance creates one Project idempotently

## Stage 3 — Project, Contract, and Shared Job

Status: implemented by Sprint 1.5.0.

Build:

- Project
- Contract and signatures
- Job
- readiness
- Schedule Blocks
- Assets and Reservations
- Assignments
- Route Stops
- Checklists
- Job Events
- shared workspaces

Exit:

- accepted Quote creates correct Project and Job
- Contract and Deposit can block scheduling
- schedule and asset conflicts are detected

## Stage 4 — Material Delivery vertical slice

Status: complete as of 2026-08-04. The database foundation, planning and safety application, driver
execution, evidence, cost reconciliation, operational charges, staff/driver web workflows, and
operational acceptance journey are implemented and verified. OpenAPI and the generated client are
current. Invoice issuance, payment, and formal financial completion continue in Stage 5. See the
[Material Delivery Operations plan](plans/2026-08-03-sprint-1-6-0-material-delivery-operations.md).

Build:

- Material Delivery Detail
- Loads and Items
- supplier and placement flows
- capacity and compatibility
- driver flow
- tickets, receipts, Expenses, and Allocations
- completion and quantity Job Charges

Exit:

- canonical Material Delivery journey passes through operational completion

## Stage 5 — Finance foundation

Build:

- Job Charges
- Invoices and Versions
- posting and delivery
- Deposit Invoices and Balances
- Payments and Allocations
- Customer Credits
- Refunds
- Credit Memos and Adjustments

Exit:

- Material Delivery completes through payment and closure
- deposit applies exactly once
- partial payments and overpayments work
- reversals update balances

## Stage 6 — Dump Trailer Rental vertical slice

Build:

- Rental Detail
- drop-off
- occupancy
- on-rent
- extension
- pickup
- failed pickup
- Disposal Load
- overage
- inspection
- security-deposit refund

Exit:

- canonical Rental journey passes
- extension conflicts block approval
- trailer cannot complete loaded
- overage created once

## Stage 7 — Communications and customer experience

Build:

- email and SMS templates
- Quote, Contract, schedule, on-the-way, completion, Invoice, receipt, and Refund messages
- customer Project view

## Stage 8 — Administration and launch hardening

Build:

- configuration screens
- users and roles
- assets, suppliers, and facilities
- payment accounts
- checklists
- notification preferences
- audit viewer
- backups and restore test
- security and performance tests

## First vertical slice

Begin after bootstrap with:

```text
Customer and Lead
→ Estimate
→ Quote
→ Customer Acceptance
→ Project
→ Material Delivery Job
→ Multi-Material Execution
→ Final Invoice
→ Payment
→ Closure
```
