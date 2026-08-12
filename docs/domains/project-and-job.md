# Project and Shared Job

## Project

A Project represents the customer's requested outcome.

The accepted Quote creates one Project.

Project owns:

- Project number
- Customer and Service Location
- accepted Quote Version
- Contract
- outcome statement
- Project owner
- Job summary
- deposit summary
- operational and financial completion
- holds
- closure and reopening
- timeline

Sprint 1.5 stores the accepted value and required deposit as integer cents copied from the accepted
Quote Version. Contract readiness and deposit readiness are separate facts. Deposit readiness may
reference external evidence, but it does not create an Invoice, Payment, Allocation, or accounting
entry before the finance module is introduced.

## Contract

The Project has one Contract generated from a copied commercial snapshot. Its content hash binds
both signatures to the exact customer, location, scope, accepted value, deposit requirement, and
terms. The business signs before sending; the customer signs through an expiring, revocable,
Contract-scoped capability whose plaintext token is never stored. Contract content is immutable
after the business signs, and signature evidence is always immutable.

## Job

A Job represents one independently scheduled operational unit.

Rules:

- Material Delivery: one independently scheduled delivery trip is one Job.
- Dump Trailer Rental: one rental is one Job.
- Drop-off and pickup are Schedule Blocks, not separate Jobs.
- A Project may contain multiple Jobs.
- Job numbers use service-specific prefixes.
- Customers may see the Job number but are not required to provide it.

## Shared Job responsibilities

- identity and numbering
- Project, Customer, and Location relationships
- shared lifecycle
- scheduling
- assignments
- readiness
- execution timing
- holds and exceptions
- operational completion
- financial status
- locking and reopening

## Service-specific Details

The Job has exactly one service-specific Detail:

- Material Delivery Detail
- Dump Trailer Rental Detail

The Detail owns service-specific planning and outcome.

Quote acceptance creates the initial shared Job immediately (`MAT` for Material Delivery or `DTR`
for Dump Trailer Rental). The service-specific Detail is added by the applicable later vertical
slice; Sprint 1.5 does not invent placeholder service execution data.

## Schedule Blocks

Schedule Blocks own calendar time.

Material Delivery normally uses one block.

Rental uses:

- drop-off block
- pickup block
- optional disposal or inspection block

Trailer occupancy is an Asset Reservation and does not reserve driver time continuously.

Every active Asset Reservation owns a half-open time range. PostgreSQL enforces that one tenant's
asset cannot have overlapping active ranges, so concurrent schedule requests cannot double-book
equipment. A Material Delivery schedule requires a service block; a rental schedule requires both
drop-off and pickup blocks. Each required block needs a driver assignment and active reservation.

## Readiness states

Each Job should evaluate:

- planning readiness
- schedule readiness
- dispatch readiness
- completion readiness
- invoice readiness
- closure readiness

Readiness output:

```text
Ready | Ready with Warnings | Not Ready | Evaluation Required
```

## Locking

After financial completion and closure:

- ordinary edits are disabled
- historical records remain visible
- corrections require controlled reopening or financial adjustment
- prior closure history is preserved

Sprint 1.7.0 derives financial completion from posted non-Credit-Memo obligations, active Jobs,
unapplied Project Payment value, unresolved Project Deposit and Customer Credit value, and active
Refund workflows. Clients cannot set Job or Project financial completion directly. An evaluator
records completion only after every blocker clears; later financial corrections atomically return a
financially complete Job to Invoiced and its Project to Operationally Complete. A financially
incomplete closed Job is reopened to Planning with Job Event, Audit Event, and outbox history.

The database also rejects ordinary edits to closed Jobs and their schedule, reservation, assignment,
route, checklist, and hold records. Reopening requires an explicit reason and returns the Job to
Planning with a preserved reopen timestamp and Job Event.

Sprint 1.10.0 adds reusable, versioned Checklist Templates. A draft owns ordered Items and may be
published only when it has at least one Item. Publication locks the draft, retires the prior
published version for the same code, writes Audit and outbox evidence, and makes the version and its
Items immutable. Creating a Job Checklist from a published Template verifies service-type
compatibility, retains the Template ID, and snapshots the code, name, required flag, and labels so
later versions never rewrite operational history. The existing explicit checklist input remains a
compatibility path for historical workflows.
