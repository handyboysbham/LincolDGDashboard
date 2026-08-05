# Material Delivery Detail

## Purpose

Material Delivery Detail is the one-to-one service-specific child of a Material Delivery Job.

It owns the overall delivery plan and result while the Job owns shared lifecycle, scheduling,
assignments, readiness, financial status, and closure.

## Responsibilities

- delivery classification
- material summary
- supplier plan
- multi-material delivery
- total planned and actual quantities
- capacity and compatibility summary
- placement and spread plan
- site-access review
- delivery result
- partial-delivery summary
- completion summary

## Core rules

- One independently scheduled delivery trip is one Job.
- One Job may include multiple materials.
- One Job may include multiple supplier stops.
- One Job may include multiple customer placement areas.
- Multiple physical loads may exist only when they remain one continuous scheduled operation.
- A separately scheduled follow-up delivery requires a new Job.
- Combined volume and weight must be validated.
- Material compatibility and separation must be explicit.
- Partial delivery is not completion.
- Supplier tickets and costs are required before financial reconciliation unless an approved
  exception exists.

## Implemented data foundation

Sprint 1.6.0 migration `0006` implements `material_delivery_details` as a tenant-scoped, one-to-one
child of Job. The database verifies that the parent has service type `material_delivery`; a Dump
Trailer Rental Job cannot own this Detail.

The Detail stores overall planning and completion summaries plus planned and actual load, volume,
and weight totals. Physical execution remains normalized into Material Loads and Items. Every
delivery child carries `job_id`, and composite foreign keys prove that Loads, Items, validations,
substitutions, variances, Expenses, Allocations, and Job Charges stay in the same tenant and Job.

Accepted operational records are not hard-deleted. Closed Jobs reject ordinary edits to all new
delivery children until the existing controlled reopen transition returns the Job to Planning. All
tenant-owned records use forced Row-Level Security.

## Scheduling

Material Delivery uses one Schedule Block.

Estimated duration should include:

- travel
- supplier loading
- customer placement
- spread service when selected
- configurable operational buffer

## Completion

Material Delivery is operationally complete when:

- every active Material Load is resolved
- every Load Item has a delivery result
- all planned Route Stops are resolved
- actual quantities are entered
- placement evidence exists where required
- remaining material is accounted for
- no blocking operational issue remains

Invoice readiness additionally requires required supplier receipts, Expenses, Expense Allocations,
and variance resolution.

Planning, safety, driver execution, evidence, reconciliation, cost, charge, and invoice-readiness
commands now own the operational lifecycle with Audit Events and transactional outbox events. The
staff Job workspace and mobile driver routes use those commands through the generated API client.
The operational portion of `MD-E2E-001` is PostgreSQL-backed and verified; invoice and payment
completion remain Sprint 1.7.0. Implementation details are recorded in the
[Sprint 1.6.0 implementation plan](../implementation/plans/2026-08-03-sprint-1-6-0-material-delivery-operations.md).
