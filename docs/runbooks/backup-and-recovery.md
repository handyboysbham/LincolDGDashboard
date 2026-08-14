# Backup and Recovery

## Recovery objectives

The V1 target is a 24-hour recovery point and a four-hour recovery time. Supabase Free does not
provide the required managed daily-backup retention, so production uses a daily Supabase CLI logical
export encrypted with AES-256-GCM and copied to a dedicated Google Workspace Shared Drive. The
scheduled job is `.github/workflows/production-database-backup.yml` and can also be dispatched
manually.

Google Drive document files and database backups occupy separate Shared Drives and use separate
service accounts. The API credential must never be copied into the backup job, and the backup
credential must never be copied into API, worker, or Vercel environments. Keep the 32-byte backup
encryption key in the GitHub environment secret store and an owner-controlled offline password
manager; Google Drive must not hold the only copy of that key.

A database backup contains Document metadata, not Google Drive document bytes. Recovery is complete
only when both the logical database backup and the Documents Shared Drive are recoverable.

## Production scheduled backup

Configure these GitHub Actions secrets:

- `DATABASE_BACKUP_URL`: Supabase administrative or backup connection, never the runtime role
- `DATABASE_BACKUP_ENCRYPTION_KEY_BASE64`: a random 32-byte key encoded as base64
- `GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64`
- `GOOGLE_DRIVE_BACKUP_SHARED_DRIVE_ID`
- `GOOGLE_DRIVE_BACKUP_FOLDER_ID`

The backup service account is a Contributor to only the dedicated Backups Shared Drive. The daily
job runs the official Supabase CLI `roles.sql`, `schema.sql`, and `data.sql` export sequence,
creates per-file SHA-256 checksums, packages the result, encrypts it before upload, rejects public
Drive permissions, and pins the uploaded binary revision with `keepForever`. Logs contain only the
Drive file ID, revision ID, and encrypted-file SHA-256; they never print the database URL or
encryption key.

Run the same path manually from a trusted host with Docker, Supabase CLI, Node 24, pnpm, and the six
secrets above:

```bash
pnpm --filter @ldg/google-drive build
pnpm recovery:backup:supabase-drive
```

The GitHub schedule is inert until the repository secrets exist and the workflow is enabled. Treat a
missed or failed daily run as a release/operations alert; a file merely appearing in Drive is not
success unless the job also reports retained revision and private-permission validation.

## Local application-schema backup

`pnpm recovery:backup` remains the local PostgreSQL custom-format backup used by integration and
restore-rehearsal tests. It covers the application-owned `public` and `extensions` schemas and is
not the production Supabase Free backup strategy.

```bash
BACKUP_DIRECTORY=/secure/ldg-backups pnpm recovery:backup
pnpm recovery:verify -- /secure/ldg-backups/ldg-YYYYMMDDTHHMMSSZ.dump
```

## Decrypt and inspect a production backup

Download one `.ldgenc` file from the Backups Shared Drive to a trusted encrypted workstation. Build
the utility, decrypt into a new path, extract, and verify the manifest:

```bash
export DATABASE_BACKUP_ENCRYPTION_KEY_BASE64='<owner-controlled key>'
pnpm recovery:decrypt -- ./ldg-supabase-YYYYMMDDTHHMMSSZ.tar.gz.ldgenc ./ldg-supabase.tar.gz
mkdir ./ldg-supabase-restore
tar -xzf ./ldg-supabase.tar.gz -C ./ldg-supabase-restore
cd ./ldg-supabase-restore
sha256sum --check manifest.sha256
```

On macOS use `shasum -a 256 --check manifest.sha256`. Decryption authenticates the entire AES-GCM
envelope and removes a partial plaintext output if authentication fails. Never decrypt on a shared
runner or upload plaintext SQL to an artifact store.

Follow Supabase's current CLI restore order against a newly created target project: `roles.sql`,
`schema.sql`, then `data.sql` in one error-stopping workflow with triggers disabled as directed by
the platform guide. Reset custom role passwords afterward; password values are intentionally absent
from logical backups. Do not overwrite the damaged production project.

## Rehearse the application-schema restore

Restore only into a new disposable database whose exact name begins `ldg_restore_`. The rehearsal
refuses to overwrite an existing database and drops only that validated target unless
`KEEP_RESTORED_DATABASE=true` is explicitly set.

```bash
export RECOVERY_ADMIN_URL='postgresql://.../postgres?sslmode=require'
export RESTORE_DATABASE_NAME='ldg_restore_20260813rc3'
export RESTORE_DATABASE_OWNER='ldg_migrator'
export RESTORE_MIGRATION_URL='postgresql://ldg_migrator:.../ldg_restore_20260813rc3?sslmode=require'
export RESTORE_RUNTIME_URL='postgresql://ldg_app:.../ldg_restore_20260813rc3?sslmode=require'
export RECOVERY_TENANT_ID='<tenant UUID>'
export EXPECTED_DATABASE_RELEASE='1.10.0-rc.3'
pnpm recovery:rehearse -- /secure/ldg-backups/ldg-YYYYMMDDTHHMMSSZ.dump
```

`pnpm test:recovery` runs `MD-E2E-001` and `DTR-E2E-001` from clean databases, dumps each result,
restores each into a new database, and rechecks exact business state plus cross-tenant invisibility.
Schedule a full production-format restore rehearsal at least quarterly and record the achieved RPO,
RTO, Drive file/revision IDs, target project, operator, and result.

## Incident recovery

1. Stop the API and worker to freeze writes; keep the web maintenance response separate.
2. Record incident time, suspected corruption time, latest successful encrypted backup, and latest
   Documents Shared Drive recovery point.
3. Download and authenticate/decrypt the selected backup on a trusted encrypted workstation.
4. Restore into a newly created Supabase project using the current Supabase CLI restore guide.
5. Run migration-release and restricted-runtime RLS checks.
6. Run both canonical journeys and inspect queue/dead-letter state.
7. Verify representative Documents resolve to the recorded Drive file and retained revision, then
   match stored size and SHA-256.
8. Rotate every possibly exposed database, Drive, signing, and backup-encryption credential.
9. Point staging at the recovered database, complete owner approval, then switch production.
10. Preserve the damaged project and logs for investigation; do not delete them during recovery.
