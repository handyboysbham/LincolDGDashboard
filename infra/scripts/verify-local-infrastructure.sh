#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

"${SCRIPT_DIR}/status-local-infrastructure.sh"

export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}"
role_result="$({
  psql \
    --host="${POSTGRES_HOST}" \
    --port="${POSTGRES_PORT}" \
    --username="${POSTGRES_ADMIN_USER}" \
    --dbname="${POSTGRES_DB}" \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --set=runtime_user="${POSTGRES_RUNTIME_USER}" \
    --set=migration_user="${POSTGRES_MIGRATION_USER}" \
    --command="SELECT rolname || ':' || rolsuper || ':' || rolbypassrls FROM pg_roles WHERE rolname IN (:'runtime_user', :'migration_user') ORDER BY rolname;"
} | tr -d '[:space:]')"

[[ "${role_result}" == *"${POSTGRES_MIGRATION_USER}:f:f"* ]] ||
  ldg_die "PostgreSQL migration role has unsafe privileges"
[[ "${role_result}" == *"${POSTGRES_RUNTIME_USER}:f:f"* ]] ||
  ldg_die "PostgreSQL runtime role has unsafe privileges"

export PGPASSWORD="${POSTGRES_RUNTIME_PASSWORD}"
runtime_identity="$(psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_RUNTIME_USER}" \
  --dbname="${POSTGRES_DB}" \
  --tuples-only \
  --no-align \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT current_user;')"
[[ "${runtime_identity}" == "${POSTGRES_RUNTIME_USER}" ]] || ldg_die "Runtime database login failed"

export MC_CONFIG_DIR="${LDG_LOCAL_DIR}/minio/mc"
mc alias set ldg-local-app \
  "http://${MINIO_HOST}:${MINIO_PORT}" \
  "${MINIO_APP_USER}" \
  "${MINIO_APP_PASSWORD}" >/dev/null

probe_file="${LDG_LOCAL_DIR}/minio/verification-probe.txt"
printf 'local infrastructure verification\n' >"${probe_file}"
mc cp "${probe_file}" "ldg-local-app/${MINIO_BUCKET}/.verification/probe.txt" >/dev/null
mc stat "ldg-local-app/${MINIO_BUCKET}/.verification/probe.txt" >/dev/null
mc rm "ldg-local-app/${MINIO_BUCKET}/.verification/probe.txt" >/dev/null
rm -f "${probe_file}"

curl --fail --silent --show-error \
  "http://${MAILPIT_HOST}:${MAILPIT_UI_PORT}/api/v1/info" >/dev/null

mailpit_probe="${LDG_LOCAL_DIR}/mailpit/verification-message.txt"
printf '%s\n' \
  'From: local@lincolndirtandgravel.test' \
  'To: infrastructure-check@example.test' \
  'Subject: Local infrastructure verification' \
  '' \
  'Mailpit SMTP verification.' >"${mailpit_probe}"
curl --fail --silent --show-error \
  --url "smtp://${MAILPIT_HOST}:${MAILPIT_SMTP_PORT}" \
  --mail-from local@lincolndirtandgravel.test \
  --mail-rcpt infrastructure-check@example.test \
  --upload-file "${mailpit_probe}"
rm -f "${mailpit_probe}"

ldg_note "PostgreSQL roles, private object storage, and Mailpit passed verification"
