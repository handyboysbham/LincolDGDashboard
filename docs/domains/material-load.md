# Material Load and Material Load Item

## Material Load

A Material Load represents one physical load carried by a truck, trailer, or approved hauling
configuration during a Material Delivery Job.

It answers:

- which assets carried the load
- which materials were included
- which suppliers and stops were used
- combined volume and weight
- capacity result
- compatibility and separation result
- loading and unloading sequence
- whether the load was fully delivered and reconciled

### Cardinality

```text
Material Delivery Job 1 → 1..* Material Loads
Material Load 1 → 1..* Material Load Items
```

### Suggested statuses

```text
Planned
Ready for Loading
At Supplier
Loading
Loaded
En Route
At Customer
Unloading
Partially Delivered
Delivered
Reconciling
Reconciled
Rejected
Cancelled
```

### Capacity

Calculate combined planned and actual totals across active Items.

Validate against:

- trailer volume
- payload
- truck capacity
- combined vehicle rating
- hitch and axle limits
- business safe-load rules
- material-specific restrictions

Safety and legal failures cannot be overridden.

Sprint 1.6.0 stores each evaluation in `material_load_validations`. A validation records a canonical
input hash and snapshot plus separate capacity, compatibility, and separation results. The database
rejects a `ready` result when any safety dimension failed. Validation rows are append-only;
reevaluation creates another row rather than changing history.

The planning application calculates authoritative totals with fixed-point arithmetic from planned
quantity and each Item's unit weight/volume snapshots. The conservative V1 hauling limit is the
lowest documented capacity across the configured truck/trailer chain. Missing capacity data blocks
readiness. A multi-material Load requires explicit compatibility confirmation plus compartment or
separation instructions for every Item. Planning and dispatch are separate evaluation types.

## Material Load Item

A Material Load Item represents one distinct material, quantity, supplier source, placement
destination, and cost component within a Material Load.

It owns:

- material identity
- planned and actual supplier
- planned, purchased, loaded, and delivered quantities
- unit and weight conversion snapshot
- supplier cost
- accepted Quote reference
- loading sequence
- unloading sequence
- compartment or separation
- customer placement area
- tickets, receipts, and photos
- substitution
- delivery result
- quantity variance

### Quantity reconciliation

Preserve separately:

- planned quantity
- purchased quantity
- loaded quantity
- delivered quantity

Do not assume they are identical.

`material_load_items` also preserves the accepted Quote Line Item reference, actual material and
supplier, Route Stop references, loading/unloading order, compartment and separation instructions,
unit volume and weight snapshots, remaining-material disposition, and delivery result. Supplier and
placement references must point to supplier and customer Route Stops, respectively, in the same Job.

### Expenses

Supplier Expense remains a separate financial record.

Expense Allocation connects receipt value to one or more Material Load Items.

The sum of active allocations must reconcile to the Expense total before final approval, unless an
approved unallocated balance policy exists.

The implemented V1 policy requires exact active allocation before approval or reconciliation.
Allocation writes lock the Expense and reject a concurrent over-allocation. Approved or reconciled
Expense facts and active Allocation facts are immutable; corrections use attributable reversal
records or reversed allocation status. Money is stored as integer cents.

### Substitution

A substitution may require:

- internal approval
- customer approval
- Quote revision
- Job Charge or Credit
- capacity revalidation
- compatibility revalidation
- schedule recalculation

### Completion

An Item is reconciled only when:

- material is delivered or formally resolved
- actual quantity exists
- supplier source is confirmed
- required ticket and receipt relationship exists
- placement is complete
- substitution and quantity variance are resolved
- commercial impact is resolved

## Implemented tables

- `material_loads` owns one physical load and its planned/actual totals and lifecycle timestamps.
- `material_load_assets` records the hauling configuration and its capacity snapshot.
- `material_load_items` owns distinct material, source, placement, quantity, and separation facts.
- `material_load_validations` preserves immutable safety evaluations.
- `material_substitutions` preserves controlled replacement-material decisions.
- `material_quantity_variances` preserves expected-versus-actual facts and resolution.
- `expenses` and `expense_allocations` preserve supplier cost independently from billing.
- `job_charges` preserves the deduplicated billing, credit, waiver, or informational decision.

The schema and database guards are implemented by migration `0006`. Explicit REST commands now own
planning, hauling configuration, driver lifecycle, independent actual quantities, actual-load
safety, Document evidence, quantity variances, Expense reconciliation, operational Job Charges, and
invoice readiness. The staff planner/reconciliation workspace and mobile driver workflow use the
generated client, and the PostgreSQL-backed operational acceptance journey is verified. Invoice and
payment completion remain Sprint 1.7.0; details are maintained in the
[Sprint 1.6.0 implementation plan](../implementation/plans/2026-08-03-sprint-1-6-0-material-delivery-operations.md).
