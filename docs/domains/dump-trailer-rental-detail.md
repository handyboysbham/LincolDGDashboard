# Dump Trailer Rental Detail

## Purpose

Dump Trailer Rental Detail is the one-to-one service-specific child of a Dump Trailer Rental Job.

It manages:

- rental package and duration
- trailer requirements and assigned trailer summary
- debris and prohibited-material review
- placement and access
- drop-off execution
- trailer occupancy and on-rent state
- extension
- pickup
- disposal summary
- overage summary
- post-rental inspection
- final trailer condition
- rental completion

## Core rules

- One rental is one Job.
- Drop-off and pickup are Schedule Blocks.
- Trailer occupancy is an Asset Reservation.
- Deposit is required according to accepted terms.
- Trailer remains In Use until retrieved, unloaded, inspected, and released.
- Failed pickup does not complete the rental.
- Customer custody ends at successful retrieval.
- Job cannot complete while the trailer remains loaded.
- Disposal Load records provide weight and cost evidence.
- Additional days and overage become Job Charges.

## Rental rates

Support:

- Daily
- Weekend
- Weekly
- Approved Custom

The accepted Quote must preserve:

- included days
- additional-day rate
- included weight or disposal allowance
- overage rate
- deposit amount and classification
- customer responsibilities

## Debris and access

Track:

- primary and secondary debris types
- mixed debris
- heavy material
- prohibited and restricted materials
- customer attestation
- placement instructions
- access review
- property-damage risk
- pickup-access requirement

Unsafe access and legal or towing failures are non-waivable.

## Extension

Extension workflow:

```text
Customer requests extension
→ check trailer availability
→ calculate additional days and charge
→ obtain approval and customer authorization
→ extend occupancy reservation
→ move pickup block
→ notify customer and dispatcher
```

An extension cannot be approved when the trailer conflicts with another confirmed reservation.

## Pickup and disposal

Pickup readiness requires:

- approved pickup time
- customer notification
- driver and truck
- confirmed trailer location
- access
- safe load
- disposal destination and facility hours

After pickup, customer custody ends, but asset occupancy continues until disposal, inspection, and
release.

## Inspection and release

Final condition states may include:

```text
Pending Inspection
Acceptable
Acceptable After Cleaning
Maintenance Review
Damage Review
Out of Service
Undetermined
```

Maintenance Review is not automatically Out of Service.
