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

### Projects and operations

- projects
- jobs
- material_delivery_details
- material_loads
- material_load_items
- dump_trailer_rental_details
- disposal_loads
- schedule_blocks
- asset_reservations
- job_assignments
- asset_assignments
- route_stops
- checklist_instances
- checklist_items
- job_events
- readiness_evaluations
- operational_holds

### Finance

- expenses
- expense_allocations
- job_charges
- invoices
- invoice_versions
- invoice_line_items
- invoice_adjustments
- invoice_deliveries
- payments
- payment_allocations
- deposit_balances
- deposit_applications
- customer_credits
- refunds

### Shared collaboration

- documents
- document_links
- document_public_links
- notes
- tasks
- communications
- cases

## Important constraints

- One accepted Quote Version per Quote.
- One Project per accepted Quote Version.
- One service Detail per Job.
- Unique version number within each parent.
- No negative financial amounts where prohibited.
- Gross weight cannot be less than tare weight.
- Posted Invoice Versions are immutable.
- Applied Allocations cannot be edited or deleted.
- Unique provider transaction ID when present.
- Unique active Job Charge dedupe key.
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
- Contract commercial content is immutable after business signature; all Contract Signatures and Job
  Events are append-only.
- Closed Jobs reject ordinary updates to the Job and shared operational child records until an
  audited reopening command records `reopened_at`.

Every implemented tenant table has forced Row-Level Security. Runtime policies compare `tenant_id`
with `app.current_tenant_id`; duplicate lookups and all pricing, Estimate, Quote, acceptance, and
Project, Contract, Job, scheduling, asset, readiness, checklist, route, event, and hold queries are
subject to the same tenant boundary.

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
