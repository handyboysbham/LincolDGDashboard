# Customer, Lead, Estimate, and Quote

## Customer model

### Customer Account

Represents the continuing customer relationship.

Owns:

- display name
- customer type
- status
- owner
- preferred contact method
- billing contact summary
- timeline summary

### Contact

Represents one person or communication identity.

A Contact may be shared across Customer Accounts and Service Locations.

### Service Location

Stores reusable service-address facts, access notes, and location contacts.

## Lead

One Lead represents one independent service opportunity.

Rules:

- Service type is Material Delivery or Dump Trailer Rental.
- A Lead cannot contain both service types.
- Lead may convert to one Estimate.
- Duplicate and disqualified Leads remain preserved.

Suggested statuses:

```text
New, Contacting, Qualified, Estimating, Quoted, Accepted,
Lost, Cancelled, Duplicate, Disqualified
```

## Estimate

Estimate is internal decision support.

The Estimate parent owns the lifecycle; Estimate Versions preserve immutable recommendations.

An Estimate Version contains:

- pricing version
- cost items
- pricing calculation results
- operational assessment
- risk assessment
- readiness
- recommended price
- approved Quote price
- deposit recommendation
- profit and margin summary

Approved Estimate Versions are immutable.

## Pricing

Pricing is rule-driven and versioned.

Supported V1 calculation types:

- fixed amount
- quantity multiplied by rate
- percentage markup
- tiered distance rate
- greater-of
- minimum charge
- cost plus markup
- additional-day calculation
- allowance overage
- controlled rounding

Do not execute arbitrary code or user-provided formulas.

## Quote

The Quote parent owns the customer-offer lifecycle. Quote Versions preserve the exact
customer-facing offer.

Quote Version contains:

- customer snapshot
- location snapshot
- scope
- line items
- terms
- subtotal, adjustments, taxes, total
- required deposit
- issue and expiration dates
- rendered document
- content hash

Default expiration is ten calendar days after sending.

Sent, accepted, declined, expired, withdrawn, and superseded versions are immutable.

## Quote acceptance

Acceptance requires:

- valid current Quote Version
- not expired
- not withdrawn
- not superseded
- accepting contact
- accepted name
- acceptance method
- timestamp
- consent text
- content hash

Acceptance creates one Project idempotently.
