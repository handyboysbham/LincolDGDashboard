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

### Expenses

Supplier Expense remains a separate financial record.

Expense Allocation connects receipt value to one or more Material Load Items.

The sum of active allocations must reconcile to the Expense total before final approval, unless an
approved unallocated balance policy exists.

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
