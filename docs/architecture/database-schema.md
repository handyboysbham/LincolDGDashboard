# Database Schema Baseline

## Platform

Recommended database: PostgreSQL.

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
- disposal_facilities
- disposal_rate_versions
- assets

### Sales

- leads
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
- quote_acceptances
- contracts
- contract_signatures

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
