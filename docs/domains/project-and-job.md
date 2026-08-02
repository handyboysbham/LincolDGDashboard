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

## Schedule Blocks

Schedule Blocks own calendar time.

Material Delivery normally uses one block.

Rental uses:

- drop-off block
- pickup block
- optional disposal or inspection block

Trailer occupancy is an Asset Reservation and does not reserve driver time continuously.

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
