#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ -n "${DATABASE_BACKUP_URL:-}" ]] || { echo "DATABASE_BACKUP_URL is required" >&2; exit 1; }
backup_directory="${BACKUP_DIRECTORY:-./backups}"
mkdir -p "${backup_directory}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$(mktemp "${backup_directory}/ldg-${timestamp}.XXXXXX.dump")"
complete=false
cleanup() {
  if [[ "${complete}" != true ]]; then
    rm -f "${backup_path}" "${backup_path}.sha256"
  fi
}
trap cleanup EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --extension=btree_gist \
  --schema=extensions \
  --schema=public \
  --file="${backup_path}" \
  "${DATABASE_BACKUP_URL}"
pg_restore --list "${backup_path}" >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${backup_path}" >"${backup_path}.sha256"
else
  shasum -a 256 "${backup_path}" >"${backup_path}.sha256"
fi

complete=true
echo "Verified database backup created at ${backup_path}"
