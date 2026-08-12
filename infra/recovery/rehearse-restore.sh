#!/usr/bin/env bash
set -Eeuo pipefail

backup_path="${1:-}"
[[ -f "${backup_path}" ]] || { echo "Usage: $0 /path/to/backup.dump" >&2; exit 1; }
required=(RECOVERY_ADMIN_URL RESTORE_DATABASE_NAME RESTORE_DATABASE_OWNER RESTORE_MIGRATION_URL RESTORE_RUNTIME_URL RECOVERY_TENANT_ID EXPECTED_DATABASE_RELEASE)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "${name} is required" >&2; exit 1; }
done
[[ "${RESTORE_DATABASE_NAME}" =~ ^ldg_restore_[a-z0-9]{8,64}$ ]] || {
  echo "RESTORE_DATABASE_NAME must be a disposable ldg_restore_ name" >&2
  exit 1
}

created=false
cleanup() {
  if [[ "${created}" == true && "${KEEP_RESTORED_DATABASE:-false}" != true ]]; then
    dropdb --if-exists --force --maintenance-db="${RECOVERY_ADMIN_URL}" "${RESTORE_DATABASE_NAME}" >/dev/null
  fi
}
trap cleanup EXIT

if psql "${RECOVERY_ADMIN_URL}" --no-psqlrc --tuples-only --command="select 1 from pg_database where datname = :'name'" --set="name=${RESTORE_DATABASE_NAME}" | grep -q 1; then
  echo "Refusing to overwrite existing database ${RESTORE_DATABASE_NAME}" >&2
  exit 1
fi

createdb --maintenance-db="${RECOVERY_ADMIN_URL}" --owner="${RESTORE_DATABASE_OWNER}" "${RESTORE_DATABASE_NAME}"
created=true
# PostgreSQL creates public in every new database. The application archive owns
# and recreates that schema, so remove the empty default before restoring it.
psql "${RESTORE_MIGRATION_URL}" --no-psqlrc --command="drop schema public" >/dev/null
pg_restore --exit-on-error --no-owner --dbname="${RESTORE_MIGRATION_URL}" "${backup_path}"

release="$(psql "${RESTORE_MIGRATION_URL}" --no-psqlrc --tuples-only --no-align --command="select public.current_schema_release()")"
[[ "${release}" == "${EXPECTED_DATABASE_RELEASE}" ]] || {
  echo "Restored schema release does not match EXPECTED_DATABASE_RELEASE" >&2
  exit 1
}

tenant_visible="$(psql "${RESTORE_RUNTIME_URL}" --no-psqlrc --quiet --tuples-only --no-align --set="tenant=${RECOVERY_TENANT_ID}" --command="begin; select set_tenant_context(:'tenant'::uuid); select count(*) from organizations where id = current_tenant_id(); rollback;" | tr -d '[:space:]')"
[[ "${tenant_visible}" == "1" ]] || {
  echo "Restricted runtime role could not read the restored tenant under RLS" >&2
  exit 1
}

echo "Restore rehearsal passed for ${RESTORE_DATABASE_NAME}."
