# Consolidated Object Model

## High-level model

```text
Organization
├── Users
├── Roles
├── Pricing Policies
├── Assets
├── Suppliers
└── Disposal Facilities

Customer Account
├── Contacts
├── Service Locations
├── Leads
├── Projects
├── Invoices
├── Payments
└── Customer Credits

Lead
└── Estimate
    └── Estimate Versions
        └── Quote
            └── Quote Versions
                └── Quote Acceptance
                    └── Project
                        ├── Contract
                        ├── Jobs
                        ├── Invoices
                        ├── Payments
                        ├── Customer Credits
                        └── Refunds
```

## Operational model

```text
Project
└── Job
    ├── Service-Specific Detail
    ├── Schedule Blocks
    ├── Job Assignments
    ├── Asset Assignments
    ├── Asset Reservations
    ├── Route Stops
    ├── Checklists
    ├── Job Events
    ├── Expenses
    ├── Job Charges
    ├── Documents
    ├── Communications
    └── Cases
```

Material Delivery:

```text
Material Delivery Job
└── Material Delivery Detail
    └── Material Loads
        ├── Material Load Assets
        ├── Material Load Validations
        └── Material Load Items
            ├── Material Substitutions
            ├── Material Quantity Variances
            └── Expense Allocations

Material Delivery Job
├── Expenses
│   └── Expense Allocations
└── Job Charges
```

Dump Trailer Rental:

```text
Dump Trailer Rental Job
└── Dump Trailer Rental Detail
    └── Disposal Loads
```

## Financial model

```text
Accepted Quote Version
├── Deposit Requirement
│   └── Deposit Invoice
│       └── Payment Allocation
│           └── Deposit Balance
└── Final Invoice
    ├── Accepted Quote Line Items
    ├── Approved Job Charges
    ├── Deposit Applications
    ├── Credit Applications
    └── Invoice Adjustments

Payment
├── Payment Allocations
├── Unapplied Customer Credit
└── Refunds
```

## Core cardinalities

| Relationship                     | Cardinality |
| -------------------------------- | ----------- |
| Lead → Estimate                  | 1 to 0..1   |
| Estimate → Estimate Versions     | 1 to many   |
| Quote → Quote Versions           | 1 to many   |
| Accepted Quote Version → Project | 1 to 1      |
| Project → Jobs                   | 1 to many   |
| Material Delivery Job → Detail   | 1 to 1      |
| Material Delivery Job → Loads    | 1 to many   |
| Material Load → Assets           | 1 to many   |
| Material Load → Validations      | 1 to many   |
| Material Load → Items            | 1 to many   |
| Material Load Item → Variances   | 1 to many   |
| Material Load Item → Allocations | 1 to many   |
| Rental Job → Rental Detail       | 1 to 1      |
| Rental Job → Disposal Loads      | 1 to many   |
| Job → Schedule Blocks            | 1 to many   |
| Job → Job Charges                | 1 to many   |
| Project → Invoices               | 1 to many   |
| Invoice → Versions               | 1 to many   |
| Invoice Version → Line Items     | 1 to many   |
| Payment → Allocations            | 1 to many   |
| Invoice → Allocations            | 1 to many   |
| Customer Account → Credits       | 1 to many   |
| Customer Credit → Refunds        | 1 to many   |

## Ownership boundaries

- Customer Account owns the continuing customer relationship.
- Lead owns one service opportunity.
- Estimate owns internal pricing decision support.
- Quote owns the customer offer lifecycle.
- Project owns the overall customer outcome.
- Job owns independently scheduled operational work.
- Service-specific Detail owns service planning and result.
- Schedule Block owns calendar time.
- Asset Reservation owns continuing asset occupancy.
- Material Load owns one physical hauling configuration within a continuous scheduled Job.
- Material Load Item owns one material/source/placement and its reconciled quantity facts.
- Material Load Validation owns immutable capacity, compatibility, and separation evidence.
- Expense owns actual company cost.
- Expense Allocation applies company cost to a Material Load Item without changing billing.
- Job Charge owns the decision to bill or credit after acceptance.
- Invoice owns customer billing obligation.
- Payment owns money received.
- Payment Allocation applies value to an Invoice.
- Customer Credit owns unapplied customer value.
- Refund owns money returned.
