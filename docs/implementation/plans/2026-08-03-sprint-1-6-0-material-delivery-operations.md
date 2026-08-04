# Sprint 1.6.0 Material Delivery Operations Plan

## Objective

Execute one independently scheduled, multi-material delivery from planning through operational
completion and invoice readiness. Preserve the accepted commercial basis, actual supplier cost,
load-safety evidence, delivered quantities, placement evidence, operational variances, and billing
decisions as separate records.

Phase 1 establishes the implementation plan and database model. Phase 2 implements the planning and
safety application layer. Phase 3 implements driver execution, actual-load safety, evidence,
quantity reconciliation, supplier Expenses and Allocations, operational Job Charges, and invoice
readiness. Staff web workflows and final operational acceptance verification remain later Sprint
work.

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
- `docs/domains/material-delivery-detail.md`
- `docs/domains/material-load.md`
- `docs/domains/job-charge.md`
- `docs/implementation/build-sequence.md`
- `docs/implementation/acceptance-journeys.md`
- `docs/implementation/sprints.md`

## Scope boundaries

- Job continues to own independent scheduling, assignments, readiness, lifecycle, holds, and
  closure.
- Material Delivery Detail is the one-to-one service-specific child of a Material Delivery Job.
- Material Load represents one physical hauling configuration within that continuous scheduled Job.
  A separately scheduled follow-up delivery requires another Job.
- Material Load Item owns one material, supplier source, placement destination, and four distinct
  quantity facts: planned, purchased, loaded, and delivered.
- Route Stop remains the shared owner for supplier and customer placement stops. The delivery model
  references those stops rather than duplicating address or route state.
- Document and Document Link remain the owners for supplier tickets, receipts, placement evidence,
  and photos. Operational records do not store object keys or signed URLs.
- Expense owns actual company cost. Expense Allocation connects that cost to Material Load Items.
- Job Charge owns the later decision to charge, credit, waive, or record an informational
  adjustment. It does not mutate the accepted Quote or Contract.
- Invoice, Payment, Allocation, Deposit Balance, and formal financial-completion commands remain
  Sprint 1.7.0.

## Database ownership

| Table                         | Responsibility                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `material_delivery_details`   | One delivery plan/result and readiness summary per Material Delivery Job            |
| `material_loads`              | Physical load lifecycle, canonical volume/weight totals, and safety summaries       |
| `material_load_assets`        | Truck, trailer, and equipment actually associated with a physical load              |
| `material_load_items`         | Material, supplier, placement, quantity reconciliation, and accepted-line reference |
| `material_load_validations`   | Immutable capacity, compatibility, and separation evaluations                       |
| `material_substitutions`      | Controlled replacement-material decision and approval evidence                      |
| `material_quantity_variances` | Expected-versus-actual variance and its operational resolution                      |
| `expenses`                    | Supplier/vendor cost, receipt requirement, approval, and reversal relationship      |
| `expense_allocations`         | Active or reversed allocation of Expense value to a Material Load Item              |
| `job_charges`                 | Deduplicated operational billing decision prepared for Sprint 1.7 invoicing         |

`assets` gains canonical cubic-yard capacity. Existing `capacity_weight` is treated as pounds.
Safety-rule inputs that are not stable asset attributes—combined configuration limits, material
density, axle/hitch rules, and business safe-load rules—are preserved in the immutable validation
input snapshot.

## Integrity model

- Money uses integer cents; quantities, volume, and weight use controlled PostgreSQL numerics.
- Every new operational child carries `tenant_id` and `job_id`.
- Composite tenant-and-Job foreign keys prove that Detail, Load, Item, validation, Expense,
  Allocation, substitution, variance, and Job Charge records belong to the same Job.
- Material Delivery Detail is unique per Job. The database rejects a Detail for a rental Job.
- Load and Item sequence numbers are unique within their parent and must be positive.
- Quantity facts are independent and nonnegative. The database never assumes purchased, loaded, and
  delivered quantities are equal.
- A ready validation cannot contain a failed capacity, compatibility, or separation result. Failed
  safety results are always `not_ready` and have no override state.
- Material Load Validations are append-only and retain a canonical input hash.
- One pending substitution and one open variance of a given type may exist per Item.
- Approved or reconciled Expenses require a receipt or an explicit, attributable waiver.
- Active Expense Allocations cannot exceed the Expense amount, including under concurrent writes.
- Approved/reconciled Expenses, active Expense Allocations, and approved Job Charges cannot be
  deleted. Corrections use reversal records or explicit reversal commands.
- One active Job Charge dedupe key is allowed per Job.
- Closed Jobs reject changes to every Material Delivery child until the existing controlled reopen
  command returns the Job to Planning.
- Every new tenant table has forced Row-Level Security and runtime grants limited to the existing
  application role.

## Application commands

The application exposes explicit commands rather than unrestricted status updates. Planning, safety,
execution, evidence, reconciliation, cost, charge, and readiness commands are implemented:

- create or revise the delivery plan while the Job is editable
- create, revise, cancel, and sequence Loads and Items
- attach planned supplier and placement Route Stops
- assign the load hauling configuration from Job-assigned assets
- evaluate planned and dispatch safety
- record supplier arrival, loading, loaded, transit, customer arrival, and unloading events
- record purchased, loaded, delivered, and remaining quantities
- request, approve, reject, or cancel a substitution
- open, resolve, or waive a quantity variance
- attach tickets, receipts, and placement evidence through Document Links
- create, approve, reverse, and allocate supplier Expenses
- calculate or resolve deduplicated operational Job Charges
- evaluate operational completion and invoice readiness

Every command will lock the affected Job and aggregate when concurrency matters, validate the
current state and permission, write Audit Events and Job Events, enqueue outbox events, and commit
atomically through the existing idempotency boundary.

## API surface

Implemented in Phase 2:

- `GET /api/v1/jobs/:id/material-delivery`
- `POST /api/v1/jobs/:id/material-delivery`
- `POST /api/v1/jobs/:id/material-loads`
- `POST /api/v1/material-loads/:id/items`
- `POST /api/v1/material-load-items/:id/actions/revise`
- `POST /api/v1/material-loads/:id/assets`
- `POST /api/v1/material-loads/:id/actions/evaluate-safety`

Implemented in Phase 3:

- `POST /api/v1/material-loads/:id/actions/:action`
- `POST /api/v1/material-load-items/:id/actions/record-quantities`
- `POST /api/v1/material-load-items/:id/substitutions`
- `POST /api/v1/material-substitutions/:id/actions/:action`
- `POST /api/v1/material-load-items/:id/variances`
- `POST /api/v1/material-quantity-variances/:id/actions/:action`
- `POST /api/v1/jobs/:id/expenses`
- `POST /api/v1/expenses/:id/allocations`
- `POST /api/v1/expenses/:id/actions/:action`
- `POST /api/v1/jobs/:id/job-charges`
- `POST /api/v1/job-charges/:id/actions/:action`
- `POST /api/v1/jobs/:id/actions/evaluate-invoice-readiness`

All staff mutations require an `Idempotency-Key`. Server responses expose derived totals and
readiness; browser calculations are never authoritative.

## Planned web surfaces

- extend `/jobs/:id` with a Material Delivery summary and readiness blockers
- add a dispatcher load planner for materials, suppliers, placement areas, and asset configuration
- add a driver flow optimized for supplier arrival, loading, tickets, transit, unloading, photos,
  and delivered quantities
- add reconciliation views for receipts, Expenses, Allocations, substitutions, quantity variances,
  and operational Job Charges
- show safety failures as blocking results without an override control

The web phase will reuse the existing staff shell, responsive operational styling, generated API
client, and explicit loading, empty, error, conflict, and success states.

## Delivery phases

### Phase 1 — Data foundation

- add the ten owned tables and asset volume capacity
- generate and review the forward migration
- add tenant-aware foreign keys, checks, partial unique indexes, RLS, grants, metadata triggers,
  append-only guards, financial-history guards, allocation balance guard, and closed-Job guards
- extend PostgreSQL integration coverage

### Phase 2 — Planning and safety application layer

- create Material Delivery Detail, Loads, Items, stop relationships, and load assets
- derive canonical planned volume and weight
- implement immutable safety evaluation snapshots
- block schedule confirmation/dispatch when capacity, compatibility, or separation fails

### Phase 3 — Driver execution and evidence

- implement Load lifecycle commands and timestamp ordering
- record actual supplier, purchased/loaded/delivered quantities, remaining disposition, and
  placement result
- attach ticket, receipt, and placement evidence Documents
- emit Job Events and refresh readiness after every meaningful fact

### Phase 4 — Cost, variance, and invoice readiness

- implement Expense approval/reversal and balanced Expense Allocations
- implement substitution and variance resolution
- produce deduplicated operational Job Charges from accepted historical terms
- gate operational completion and invoice readiness

### Phase 5 — Web and acceptance

- build dispatcher, driver, and reconciliation experiences
- update OpenAPI and the generated client
- make the operational portion of `MD-E2E-001` pass, including negative cases

## Acceptance coverage

The operational portion of `MD-E2E-001` must prove:

- one Material Delivery Job owns one Detail, one Load, and two Items
- two supplier stops and two placement stops can be planned within one scheduled Job
- a 9,000-pound, six-cubic-yard load passes against 10,000 pounds and seven cubic yards
- an 11,000-pound load cannot reach dispatch readiness and has no override path
- gravel and sand compatibility/separation evidence is preserved
- driver transitions and ticket/receipt/placement evidence are attributable and ordered
- two Expenses total $184 and active Allocations reconcile exactly to the two Items
- delivered quantities remain distinct from planned, purchased, and loaded quantities
- partial delivery and remaining material prevent operational completion until resolved
- a separately scheduled follow-up delivery references a different Job
- missing required receipts block invoice readiness
- duplicate operational Job Charges are rejected by stable dedupe key
- foreign tenants cannot read or relate any Material Delivery record
- a closed Job rejects ordinary Material Delivery child edits

## Data-foundation completion checklist

- [x] Drizzle schema represents all ten ownership boundaries without floating-point money/quantity
- [x] forward migration is reviewed and applies to empty and existing PostgreSQL databases
- [x] every new relationship is tenant-aware and same-Job relationships are database-enforced
- [x] safety validation evidence is append-only and failed safety has no override state
- [x] Expense and Job Charge history uses reversal/cancellation rather than hard deletion
- [x] active Expense Allocations cannot exceed the Expense amount under concurrency
- [x] active Job Charge dedupe keys are unique per Job
- [x] every new tenant table has forced RLS, grants, and tested tenant isolation
- [x] closed-Job guards cover every new operational child
- [x] database architecture, domain ownership, and sprint status documentation is current
- [x] `pnpm db:migrate` passes
- [x] `pnpm test:integration` passes
- [x] `pnpm check` passes

## Remaining Sprint 1.6 completion checklist

- [x] planning, safety, driver, evidence, reconciliation, and readiness commands are implemented
- [ ] every transition has success, invalid-state, permission, tenant, and concurrency coverage
- [x] OpenAPI and generated client artifacts are current
- [ ] dispatcher, driver, and reconciliation web surfaces are complete
- [ ] the operational portion of `MD-E2E-001` passes
- [x] unsafe or overweight dispatch has no override path
- [x] missing receipts block invoice readiness
- [x] duplicate operational charges are prevented through the application boundary

## Phase 2 planning-and-safety checklist

- [x] explicit commands lock the Job and mutate planning data only in allowed states
- [x] Material Delivery plan, Load, Item, Route Stop, and hauling Asset references are validated
- [x] accepted Quote Line references must belong to the Project's accepted Quote Version
- [x] canonical planned weight and volume use server-side fixed-point arithmetic
- [x] changing an Item or hauling Asset invalidates prior safety summaries
- [x] planning and dispatch evaluations append canonical input snapshots and hashes
- [x] failed capacity, compatibility, or separation has no override state
- [x] schedule and dispatch readiness require the appropriate current Load evaluation
- [x] every command is idempotent and writes Job, Audit, and outbox events atomically
- [x] controller permission metadata and unit tests are current
- [x] the PostgreSQL-backed planning/safety journey passes
- [x] OpenAPI and generated client artifacts are current
- [x] `pnpm check` passes with the Phase 2 changes

## Phase 3 execution-and-reconciliation checklist

- [x] ordered Load lifecycle commands cover supplier arrival through reconciliation
- [x] actual loaded weight and volume require a current immutable safety evaluation before departure
- [x] purchased, loaded, delivered, and remaining quantities remain independent fixed-point facts
- [x] supplier tickets, receipts, placement evidence, and delivery photos link only available
      Documents
- [x] delivery and reconciliation require item results, evidence, and remaining-material disposition
- [x] quantity variances have controlled open, resolve, and waive commands
- [x] supplier Expenses use integer cents, exact active Allocations, approval, reconciliation, and
      reversal
- [x] operational Job Charges use server calculations, approval, reversal, and stable dedupe keys
- [x] operational completion and invoice readiness are independently gated
- [x] every command is idempotent and writes Job, Audit, and outbox events atomically
- [x] controller permission metadata and unit tests are current
- [ ] the PostgreSQL-backed Phase 3 journey passes
- [x] OpenAPI and generated client artifacts are current for Phase 3
- [x] `pnpm check` passes with the complete Phase 3 changes
