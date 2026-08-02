# Database Package Instructions

- Every schema change requires a reviewed SQL migration.
- Migrations are forward-only outside local development.
- Every tenant-owned table includes `tenant_id` and Row-Level Security.
- The runtime role must not own application tables or bypass RLS.
- Prefer tenant-aware foreign keys for cross-table relationships.
- Use UUID primary keys.
- Use integer cents for money.
- Use NUMERIC for quantity and weight; never floating point.
- Financial and accepted-customer records are not hard deleted.
- Do not use cascading deletion for financial history.
- Add indexes for known query paths.
- Test migrations on an empty PostgreSQL database.
- Test cross-tenant reads, writes, and foreign-key attempts.
