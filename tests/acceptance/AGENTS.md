# Acceptance Test Instructions

- Test business outcomes rather than internal implementation details.
- Use deterministic time and fixture data.
- Use PostgreSQL, not SQLite.
- Preserve the canonical Material Delivery and Rental journeys.
- Do not bypass public application commands to set state.
- Verify exact financial totals in integer cents.
- Verify duplicate retries do not create duplicate records.
- Verify reversals reopen financial obligations correctly.
- Verify tenant isolation for every newly exposed record type.
- Keep canonical journeys readable as executable business specifications.
