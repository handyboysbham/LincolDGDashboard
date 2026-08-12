# Database Schema Baseline

## Platform

Recommended database: PostgreSQL.

For V1, one Organization is one tenant. `organizations.id` is the tenant identity. The Organization
row is the tenant root, and every tenant-owned child table carries `tenant_id` referencing that
identifier. The Organization row is protected by tenant context using its own `id`; it does not
duplicate the value in a second `tenant_id` column.

## Data types

| Value                 | Type               |
| --------------------- | ------------------ |
| Internal ID           | UUID               |
| Human-readable number | VARCHAR            |
| Status/type           | VARCHAR with CHECK |
| Timestamp             | TIMESTAMPTZ        |
| Date-only             | DATE               |
| Money                 | BIGINT cents       |
| Percentage            | NUMERIC(7,4)       |
| Quantity              | NUMERIC(12,3)      |
| Weight                | NUMERIC(14,3)      |
| Duration              | INTEGER minutes    |
| Snapshot              | JSONB              |
| Description           | TEXT               |

## Numbering

Use a transaction-safe `number_sequences` table keyed by tenant, entity type, and year.

Examples:

```text
LEAD-2026-00001
EST-2026-00001
QTE-2026-00001
PRJ-2026-00001
MAT-2026-00001
DTR-2026-00001
INV-2026-00001
PMT-2026-00001
RFD-2026-00001
```

## Major tables

### Platform

- organizations
- users
- roles
- user_roles
- number_sequences
- idempotency_keys
- audit_events
- outbox_events
- scheduled_jobs
- worker_heartbeats

### Customer and reference

- customer_accounts
- contacts
- account_contacts
- service_locations
- location_contacts
- materials
- suppliers
- supplier_locations
- supplier_materials
- supplier_cost_versions
- delivery_zones
- disposal_facilities
- disposal_rate_versions
- assets

The implemented intake slice uses normalized, tenant-scoped comparison fields on Customer Accounts,
Contacts, and Service Locations for duplicate warnings. `account_contacts` and `location_contacts`
model reusable relationships; a partial unique index permits only one primary Contact per Customer
Account. Service Locations belong to a Customer Account through a tenant-aware foreign key.

### Sales

- leads
- lead_notes
- lead_tasks
- pricing_policies
- pricing_versions
- pricing_rules
- pricing_rule_tiers
- estimates
- estimate_versions
- estimate_cost_items
- pricing_calculation_results
- quotes
- quote_versions
- quote_line_items
- quote_terms
- quote_deliveries
- quote_public_links
- quote_acceptances
- contracts
- contract_signatures

`leads` stores one intake service discriminator and one matching set of service-detail columns. A
database check requires either complete Material Delivery fields or complete Dump Trailer Rental
fields—never both. Quantities use `NUMERIC(12,3)`, rental dates are date-only, and rental end cannot
precede rental start. Lead Notes and Tasks are intake-owned collaboration records; uploaded file
metadata remains in `documents` and links to a Lead through `document_links`.

Pricing, Estimate, Quote, and minimal Project identity tables are implemented by migration `0003`.
Every rate, cost, calculation, commercial line, and deposit uses integer cents; material quantities
use `NUMERIC(12,3)`. Active Pricing Versions preserve an allowlisted rule snapshot. Database
triggers protect active/retired pricing content, approved Estimate content and children, sent or
terminal Quote content and children, and all Quote Acceptance evidence. `quote_public_links` stores
only token hashes, purpose-bound creation hashes, expiration, and revocation metadata.

Projects, Contracts, Jobs, and shared scheduling are implemented by migrations `0004` and `0005`.
Migration `0004` expands the accepted-Quote Project, backfills one initial service-numbered Job for
existing Projects, enables `btree_gist`, and creates the operational tables, tenant policies,
immutability triggers, closed-Job guards, and the active Asset Reservation exclusion constraint.
Migration `0005` records a request hash for Contract-link command idempotency.

The Sprint 1.6.0 Material Delivery data foundation is implemented by migration `0006`. It adds the
delivery Detail, physical Load, Load Asset, Load Item, immutable safety evaluation, substitution,
quantity variance, Expense, Expense Allocation, and Job Charge records. Assets gain canonical
cubic-yard capacity alongside the existing weight capacity. Tenant-and-Job composite foreign keys
keep all operational and financial children within one Job; Route Stops and Documents remain shared
records referenced by the delivery model.

The Sprint 1.7.0 financial data foundation is implemented by migration `0007`. It adds Invoice
parents, immutable posted Versions and Line Items, Adjustments, delivery evidence, Payments,
append-only Payment Allocations, Deposit Balances and Applications, Customer Credits and
Applications, and Refunds. Database guards serialize every source-value and Invoice-balance check,
reject over-application under concurrency, and preserve settled financial history.

Migration `0008` strengthens Refund execution. Alternate-method Refunds may enter review before an
approver is recorded but require approval before processing. A settled Refund remains immutable;
restored funds use one exact, uniquely linked compensating Refund. Payment, Deposit, and Customer
Credit balance guards net that compensating row before accepting later applications.

Migration `0009` adds `invoice_public_links`. Each capability is scoped to one posted Invoice
Version and delivery attempt, stores only a token hash, expires, can be revoked, and records view
evidence. The table is tenant-owned, forced through Row-Level Security, protected from hard
deletion, and never stores a plaintext customer token.

Sprint 1.10.0 migration `0016` adds company-controlled Payment Accounts and versioned Checklist
Templates with ordered Template Items. Payments may retain a tenant-aware link to the controlled
account while preserving the receiving-account snapshot used at receipt time. Checklist Instances
may retain the published Template identity while snapshotting the code, name, required flag, and
items used for execution. Published and retired checklist content is immutable; all three new tables
use forced RLS, explicit restricted-runtime grants, and no-delete history protection.

Sprint 1.8.0 migration `0010` owns the Dump Trailer Rental data foundation: one Rental Detail per
rental Job, attributable Debris Reviews, reservation-aware Extensions, durable Pickup Attempts,
Disposal Loads, and Rental Inspections. Shared Schedule Blocks and Asset Reservations remain the
source of scheduling and occupancy truth; Documents, Expenses, Job Charges, and finance records
remain the evidence, cost, billing-decision, and settlement owners.

Migration `0011` refines the Rental operational-completion guard. Rejected and redirected Disposal
Loads remain immutable terminal facts, but no longer block completion after a same-tenant, same-Job
replacement chain contains a reconciled Load. An unresolved, cancelled-only, or cyclic replacement
chain still blocks completion.

Migration `0012` adds tenant-owned Notification Templates, Notification Preferences, Notification
Deliveries, and Notification Delivery Attempts. It enforces immutable published Template content,
controlled delivery transitions, durable history, tenant-aware foreign keys, forced Row-Level
Security, and runtime grants without delete privileges.

Migration `0013` adds Project Public Links and append-only Project Public Link Views, and associates
Notification Deliveries with the capability used for customer Project presentation. Project tokens
are stored only as hashes; active summary links are unique per Project, and expiration, revocation,
view evidence, tenant-aware relationships, forced Row-Level Security, and no-delete history guards
are enforced in PostgreSQL.

Migration `0015` reconciles the restricted `ldg_app` runtime role for hosted environments that
provision the login after the application schema. It grants only the table operations established by
the originating migrations, preserves append-only and financial no-delete rules, allows tenant
context setup, and keeps migration history inaccessible to the runtime role.

### Projects and operations

- projects
- jobs
- material_delivery_details
- material_loads
- material_load_assets
- material_load_items
- material_load_validations
- material_substitutions
- material_quantity_variances
- dump_trailer_rental_details
- rental_debris_reviews
- rental_extensions
- rental_pickup_attempts
- disposal_loads
- rental_inspections
- schedule_blocks
- asset_reservations
- job_assignments
- asset_assignments
- route_stops
- checklist_templates
- checklist_template_items
- checklist_instances
- checklist_items
- job_events
- readiness_evaluations
- operational_holds

### Finance

- company_payment_accounts
- expenses
- expense_allocations
- job_charges
- invoices
- invoice_versions
- invoice_line_items
- invoice_adjustments
- invoice_deliveries
- invoice_public_links
- payments
- payment_allocations
- deposit_balances
- deposit_applications
- customer_credits
- customer_credit_applications
- refunds

### Shared collaboration

- documents
- document_links
- document_public_links
- notes
- tasks
- notification_templates
- notification_preferences
- notification_deliveries
- notification_delivery_attempts
- cases

## Important constraints

- One accepted Quote Version per Quote.
- One Project per accepted Quote Version.
- One service Detail per Job.
- Unique version number within each parent.
- No negative financial amounts where prohibited.
- Gross weight cannot be less than tare weight.
- Posted Invoice Versions, their Line Items, and posted Adjustments are immutable.
- Applied Allocations, Deposit Applications, and Customer Credit Applications cannot be edited or
  deleted; corrections use linked reversal entries.
- Settled Refunds are immutable.
- A Refund reversal exactly matches one settled Refund and restores source availability through a
  separate uniquely linked record.
- Payment, Deposit, and Customer Credit applications serialize source availability and Invoice
  eligibility checks before accepting value.
- Unique provider transaction ID when present.
- Unique active Job Charge dedupe key.
- One Material Delivery Detail per Job, and it may only belong to a Material Delivery Job.
- One Dump Trailer Rental Detail per Job, and it may only belong to a Dump Trailer Rental Job.
- Rental Detail, Debris Review, Extension, Pickup Attempt, Disposal Load, and Inspection children
  are constrained to the same tenant and Job.
- Approved Extensions require a passing reservation-conflict evaluation and approval evidence.
- Disposal Load net weight equals gross minus tare; reconciled Loads require final facility,
  unloading, evidence, empty-trailer, and Expense facts when applicable.
- Completed Rental Inspections, approved Extensions, failed Pickup Attempts, and reconciled Disposal
  Loads preserve immutable outcome facts.
- Published Notification Templates are immutable, delivery content and origin cannot be rewritten,
  and provider Attempts remain durable after completion.
- Project public-link tokens are stored only as hashes; revoked link identity is immutable, links
  cannot be deleted, and Project public-link view evidence is append-only.
- Material Load children, Route Stops, Expenses, Allocations, variances, substitutions, and Job
  Charges are constrained to the same tenant and Job.
- Ready Material Load Validations cannot contain failed capacity, compatibility, or separation
  results; validation evidence is append-only.
- Active Expense Allocations cannot exceed their Expense amount under concurrent writes, and an
  approved or reconciled Expense must be fully allocated.
- One open variance per type and one pending substitution are allowed per Material Load Item.
- No overlapping active Asset Reservation for the same asset.
- Tenant-aware foreign keys prevent cross-tenant relationships.
- A Lead has exactly one supported service type and its complete matching detail fields.
- Material Delivery estimated quantity is positive and never stored as floating point.
- Dump Trailer Rental end date is not before its start date.
- One primary Contact is allowed per Customer Account.
- Public document-link tokens are stored only as hashes and every link has a purpose, expiration,
  and optional revocation timestamp.
- Quote-link tokens are Quote-Version scoped, expiring, revocable, and stored only as hashes.
- Contract-link tokens are Contract scoped, expiring, revocable, stored only as hashes, and retain
  the canonical send-request hash for conflict-safe replay.
- Invoice-link tokens are posted-Version scoped, expiring, revocable, stored only as hashes, and
  retain an attributable delivery record and conflict-safe request hash.
- Contract commercial content is immutable after business signature; all Contract Signatures and Job
  Events are append-only. Material Load Validations are immutable, Material Delivery operational
  records are not hard-deleted, and Expense, Expense Allocation, and Job Charge corrections preserve
  history through reversals or controlled status changes.
- Closed Jobs reject ordinary updates to the Job and shared operational child records until an
  audited reopening command records `reopened_at`.

Every implemented tenant table has forced Row-Level Security. Runtime policies compare `tenant_id`
with `app.current_tenant_id`; duplicate lookups and all pricing, Estimate, Quote, acceptance,
Project, Contract, Job, scheduling, asset, readiness, checklist, route, event, hold, Material
Delivery, Expense, Expense Allocation, Job Charge, Invoice, Payment, Allocation, Deposit, Customer
Credit, Refund, Dump Trailer Rental, Extension, Pickup Attempt, Disposal Load, Rental Inspection,
Notification Template, Notification Preference, Notification Delivery, and Notification Delivery
Attempt, Project Public Link, and Project Public Link View queries are subject to the same tenant
boundary.

## Derived values

Calculate rather than manually edit:

- jobs needing scheduling
- Material Load totals
- rental total disposal weight
- overage
- Project value
- Invoice current total
- Invoice outstanding balance
- Payment available amount
- Customer Credit available amount
- Deposit available amount
- financial-completion state

Cached summary columns may exist, but source transactions remain authoritative.
