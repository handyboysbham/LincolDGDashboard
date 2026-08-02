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
