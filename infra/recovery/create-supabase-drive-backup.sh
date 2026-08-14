#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(DATABASE_BACKUP_URL DATABASE_BACKUP_ENCRYPTION_KEY_BASE64 GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_EMAIL GOOGLE_DRIVE_BACKUP_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 GOOGLE_DRIVE_BACKUP_SHARED_DRIVE_ID GOOGLE_DRIVE_BACKUP_FOLDER_ID)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "${name} is required" >&2; exit 1; }
done
command -v supabase >/dev/null || { echo "Supabase CLI is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required by Supabase CLI database dumps" >&2; exit 1; }

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work_directory="$(mktemp -d)"
trap 'rm -rf "${work_directory}"' EXIT
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="ldg-supabase-${timestamp}.tar.gz"

supabase db dump --db-url "${DATABASE_BACKUP_URL}" -f "${work_directory}/roles.sql" --role-only
supabase db dump --db-url "${DATABASE_BACKUP_URL}" -f "${work_directory}/schema.sql"
supabase db dump --db-url "${DATABASE_BACKUP_URL}" -f "${work_directory}/data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"

for file in roles.sql schema.sql data.sql; do
  [[ -s "${work_directory}/${file}" ]] || { echo "Supabase CLI produced an empty ${file}" >&2; exit 1; }
done

if command -v sha256sum >/dev/null 2>&1; then
  (cd "${work_directory}" && sha256sum roles.sql schema.sql data.sql > manifest.sha256)
else
  (cd "${work_directory}" && shasum -a 256 roles.sql schema.sql data.sql > manifest.sha256)
fi
printf 'created_at=%s\nformat=supabase-cli-logical-v1\n' "${timestamp}" > "${work_directory}/manifest.txt"
tar -czf "${work_directory}/${backup_name}" -C "${work_directory}" roles.sql schema.sql data.sql manifest.sha256 manifest.txt

BACKUP_ARCHIVE_PATH="${work_directory}/${backup_name}" \
BACKUP_NAME="${backup_name}" \
pnpm --dir "${root_dir}" --filter @ldg/google-drive production:backup-upload
