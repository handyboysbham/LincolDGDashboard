# End-to-End Acceptance Journeys

## MD-E2E-001 — Multi-Material Delivery

### Configuration

- Four cubic yards of #57 gravel at $32 per yard
- Two cubic yards of masonry sand at $28 per yard
- Material markup: 25%
- Delivery zone: $125
- Additional supplier stop: $25
- Separate placement: $40
- Deposit: greater of purchase cost or $150, rounded up to nearest $5
- Asset capacity: 7 cubic yards and 10,000 pounds
- Estimated weight: gravel 6,000 pounds, sand 3,000 pounds

### Expected price

```text
Purchase cost = $184
Customer material charge = $230
Delivery = $125
Additional supplier stop = $25
Separate placement = $40
Quote total = $420
Deposit = $185
```

### Journey

1. Create Customer, Contact, Location, and Material Delivery Lead.
2. Create Estimate Version with two material cost items and one proposed Load.
3. Approve Estimate at $420 and $185 deposit.
4. Send Quote with ten-day expiration.
5. Accept Quote and create one Project idempotently.
6. Generate and sign Contract.
7. Post Deposit Invoice for $185.
8. Verify $185 company Zelle Payment and allocate it.
9. Create Material Delivery Job, Detail, one Load, and two Items.
10. Create two supplier stops and two placement stops.
11. Schedule driver, truck, and trailer.
12. Load gravel and sand; upload tickets and receipts.
13. Create two Expenses totaling $184 and allocate to Items.
14. Deliver gravel to driveway and sand beside garage.
15. Upload placement evidence and reconcile quantities.
16. Complete Job operationally.
17. Post Final Invoice:

```text
Material Delivery Service  $420
Deposit Applied            -$185
Amount Due                  $235
```

18. Verify and allocate $235 Payment.
19. Mark Invoice Paid, Job Financially Complete, and close Project.

### Negative tests

- 11,000-pound estimate blocks dispatch.
- Missing supplier receipt blocks Invoice Readiness.
- Second Deposit Application is rejected transactionally.
- Duplicate Quote acceptance does not create another Project.

---

## DTR-E2E-001 — Weekend Dump Trailer Rental

### Configuration

- Weekend rental: $350
- Included days: 3
- Additional day: $50
- Included weight: 2,000 pounds
- Overage: $0.08 per pound
- Refundable security deposit: $150
- Actual disposal weight: 2,680 pounds

### Expected final charges

```text
Weekend Rental          $350.00
Additional Rental Day    $50.00
Weight Overage            $54.40
Total                    $454.40
```

### Journey

1. Create Rental Lead for Friday drop-off and Monday pickup.
2. Estimate Weekend package and preserve all accepted rates.
3. Send and accept Quote.
4. Create Project, Rental Job, and Rental Detail.
5. Sign Contract.
6. Post and pay $150 Security Deposit Invoice.
7. Create drop-off block, occupancy reservation, and pickup block.
8. Assign driver, truck, and trailer.
9. Complete pre-delivery inspection and drop off trailer.
10. Set trailer In Use and rental On Rent.
11. Customer requests Tuesday pickup.
12. Check future reservations; approve one-day extension.
13. Create and approve $50 Job Charge.
14. Pick up trailer and end customer custody.
15. Create Disposal Load.
16. Record gross 15,620 pounds and tare 12,940 pounds.
17. Calculate net 2,680 pounds.
18. Upload ticket, receipt, Expense, and empty-trailer photo.
19. Calculate one rental-wide Weight Overage Job Charge for $54.40.
20. Complete inspection with no damage and normal cleaning.
21. Mark trailer Available.
22. Post Final Invoice for $454.40.
23. Verify and allocate final Payment.
24. Refund $150 Security Deposit through original method.
25. Mark Deposit resolved, Job Financially Complete, and close Project.

### Negative tests

- Trailer reservation conflict blocks extension approval.
- Prohibited material creates Hold and Case; no automatic charge.
- Payment reversal reopens Invoice and removes financial completion.
- Duplicate overage creation is rejected.
- Rental cannot complete until trailer is empty and inspected.
