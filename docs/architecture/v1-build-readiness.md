# V1 Build Readiness

## Product goal

V1 must allow Lincoln Dirt and Gravel to complete both core service journeys in one system:

```text
Customer Request
→ Estimate
→ Quote
→ Acceptance
→ Project
→ Job
→ Scheduling
→ Field Execution
→ Final Charges
→ Invoice
→ Payment or Refund
→ Closure
```

## Included in V1

### Identity and access

- Organization and tenant record
- User accounts
- Owner, dispatcher, driver, and financial roles
- Role-based permissions
- Tenant isolation
- Audit history
- User activation and deactivation

### Customer and intake

- Customer Accounts
- Contacts
- Service Locations
- Contact preferences
- Manual Lead creation
- Website-intake-ready endpoint
- One service type per Lead
- Duplicate detection
- Notes, tasks, documents, and timeline

### Pricing, Estimates, and Quotes

- Pricing Policies and immutable Pricing Versions
- Supplier Cost Versions
- Delivery zones
- Material markup rules
- Rental packages
- Included allowances
- Deposit rules
- Minimum charges
- Price rounding
- Estimate parent and Estimate Versions
- Quote parent and Quote Versions
- Ten-day default Quote expiration
- Quote delivery and view tracking
- Customer acceptance, decline, and revision request
- Lightweight electronic acceptance evidence

### Contracts and Projects

- Contract generated from accepted Quote
- Customer and business signatures
- One Project per accepted Quote
- Project status, readiness, holds, operational completion, and financial completion
- Project timeline and customer-facing summary

### Shared Jobs and Scheduling

- Service-prefixed Job numbers
- Shared Job parent
- Service-specific Job Detail
- Readiness states
- Schedule Blocks
- Driver and asset assignments
- Asset Reservations
- Route Stops
- Checklists
- Job Events
- Holds, cancellation, completion, locking, and reopening
- Calendar and scheduling work queue
- Jobs-needing-scheduling KPI

### Material Delivery

- Material Delivery Detail
- Material Loads and Material Load Items
- Multiple materials
- Multiple supplier stops
- Multiple placement areas
- Volume and payload validation
- Compatibility and separation
- Loading and unloading sequence
- Planned and actual quantities
- Supplier tickets and receipts
- Expenses and Expense Allocations
- Substitutions
- Partial delivery
- Quantity variance
- Placement evidence

### Dump Trailer Rental

- Daily, weekend, and weekly packages
- Planned and actual rental duration
- Included days and allowances
- Drop-off, occupancy, on-rent state, extension, pickup, and failed pickup
- Debris and prohibited-material review
- Disposal Loads
- Gross, tare, and net weight
- Rental-wide overage
- Empty-trailer confirmation
- Post-rental inspection
- Cleaning and damage review
- Deposit resolution

### Finance

- Job Charges and Credits
- Evidence and responsibility review
- Customer authorization and internal approval
- Deposit Invoice
- Final Invoice
- Additional Charge Invoice
- Credit Memo
- Invoice Versions and Adjustments
- Payments and Payment Allocations
- Deposit Balances and Applications
- Customer Credits
- Refunds
- Payment reversal
- Partial payment and overpayment
- Financial completion

### Shared capabilities

- Tasks
- Notes
- Documents
- Communications
- Notifications
- Cases
- Holds
- Timeline
- Audit Events
- Transactional outbox
- Idempotency keys
- Basic search
- Command palette

## Deferred after V1

- Advanced route optimization
- Live GPS and telemetry
- Predictive scheduling
- Payroll
- Advanced workforce management
- Inventory and parts management
- Full accounting ledger
- Bank reconciliation
- Native mobile applications
- Complex offline synchronization
- General workflow designer
- AI pricing recommendations
- Large-scale OCR and AI document classification
- Custom reporting platform
- Multi-currency billing
- Franchise or multi-company accounting

## Explicit product boundaries

The application is not a replacement for:

- full accounting software
- payroll software
- tax preparation software
- banking software
- telematics hardware
- legal advice
- insurance claims administration
- card-data vaulting
- enterprise resource planning

## Build-readiness decision

No additional major business-object specification is required before repository creation.

Changes after implementation begins should be managed through:

- scope changes
- schema migrations
- new Pricing Versions
- new workflow versions
- backlog items
