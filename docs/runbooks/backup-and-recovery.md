# Backup and Recovery

## Recovery objectives

The V1 minimum target is a 24-hour recovery point and a four-hour recovery time. A stricter business
target requires Supabase Point-in-Time Recovery and matching object-storage replication. Confirm the
actual Supabase plan, retention window, storage versioning, and restore permissions before release.

A database backup contains document metadata, not private object bytes. Recovery is complete only
when both PostgreSQL and the versioned private object bucket are recoverable.

## Create and verify a logical backup

Use a direct administrative `DATABASE_BACKUP_URL` in an isolated scheduled job. The role must be
able to read tables protected by `FORCE ROW LEVEL SECURITY`; the restricted runtime and normal
migrator must not be used.

```bash
BACKUP_DIRECTORY=/secure/ldg-backups pnpm recovery:backup
pnpm recovery:verify -- /secure/ldg-backups/ldg-YYYYMMDDTHHMMSSZ.dump
```

The backup command writes the application-owned `public` and `extensions` schemas plus the required
`btree_gist` extension definition in PostgreSQL custom format, validates its archive catalog, and
creates a SHA-256 checksum with owner-only file permissions. Supabase-managed backup/PITR remains
authoritative for platform-managed schemas such as Auth and Storage. Encrypt logical-backup storage,
restrict access, apply retention, and copy it outside the primary failure domain. Never print or
persist connection URLs in backup logs.

## Rehearse a restore

Restore only into a new disposable database whose exact name begins `ldg_restore_`. The rehearsal
refuses to overwrite an existing database and drops only that validated target unless
`KEEP_RESTORED_DATABASE=true` is explicitly set.

```bash
export RECOVERY_ADMIN_URL='postgresql://.../postgres?sslmode=require'
export RESTORE_DATABASE_NAME='ldg_restore_20260811rc2'
export RESTORE_DATABASE_OWNER='ldg_migrator'
export RESTORE_MIGRATION_URL='postgresql://ldg_migrator:.../ldg_restore_20260811rc2?sslmode=require'
export RESTORE_RUNTIME_URL='postgresql://ldg_app:.../ldg_restore_20260811rc2?sslmode=require'
export RECOVERY_TENANT_ID='<tenant UUID>'
export EXPECTED_DATABASE_RELEASE='1.10.0-rc.2'
pnpm recovery:rehearse -- /secure/ldg-backups/ldg-YYYYMMDDTHHMMSSZ.dump
```

The rehearsal restores as the migration role, verifies the release marker, and confirms the
restricted runtime role can read the restored tenant under RLS. `pnpm test:recovery` goes further:
it runs `MD-E2E-001` and `DTR-E2E-001` from clean databases, dumps each result, restores each into a
new database, and rechecks exact business state plus cross-tenant invisibility.

## Incident recovery

1. Stop the API and worker to freeze writes; keep the web maintenance response separate.
2. Record incident time, suspected corruption time, latest verified database backup, and latest
   object-storage recovery point.
3. Prefer Supabase PITR when it provides the required recovery point. Otherwise restore the latest
   verified logical backup into a new database; do not overwrite the damaged database.
4. Restore or select the matching versioned object bucket snapshot.
5. Run the schema-release and restricted-runtime RLS checks.
6. Run both canonical journeys against disposable restored data and check queue/dead-letter state.
7. Verify representative available Documents exist in object storage and match stored size and hash.
8. Rotate any credential possibly exposed during the incident.
9. Point staging at the recovered database, complete owner approval, then switch production.
10. Preserve the damaged database and logs for investigation; do not delete them during recovery.

Record achieved recovery point, recovery duration, evidence paths, approver, and every divergence
from this runbook in the incident record.
