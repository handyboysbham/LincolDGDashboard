#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

POSTGRES_DATA_DIR="${LDG_LOCAL_DIR}/postgres/data"
MINIO_PID_FILE="${LDG_RUN_DIR}/minio.pid"
MAILPIT_PID_FILE="${LDG_RUN_DIR}/mailpit.pid"

if [[ ! -f "${POSTGRES_DATA_DIR}/PG_VERSION" ]]; then
  mkdir -p "${POSTGRES_DATA_DIR}"
  printf '%s\n' "${POSTGRES_ADMIN_PASSWORD}" | initdb \
    --auth-host=scram-sha-256 \
    --auth-local=scram-sha-256 \
    --encoding=UTF8 \
    --pwfile=/dev/fd/0 \
    --username="${POSTGRES_ADMIN_USER}" \
    --pgdata="${POSTGRES_DATA_DIR}" >/dev/null
fi

if pg_ctl --pgdata="${POSTGRES_DATA_DIR}" status >/dev/null 2>&1; then
  ldg_note "PostgreSQL is already running"
else
  ldg_note "Starting PostgreSQL"
  pg_ctl \
    --pgdata="${POSTGRES_DATA_DIR}" \
    --log="${LDG_LOG_DIR}/postgres.log" \
    --options="-h ${POSTGRES_HOST} -p ${POSTGRES_PORT}" \
    --wait start >/dev/null
fi

"${SCRIPT_DIR}/initialize-postgres.sh"

if ldg_read_pid "${MINIO_PID_FILE}" >/dev/null 2>&1; then
  ldg_note "MinIO is already running"
else
  rm -f "${MINIO_PID_FILE}"
  ldg_note "Starting MinIO"
  MINIO_ROOT_USER="${MINIO_ROOT_USER}" \
    MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}" \
    MINIO_REGION="${MINIO_REGION:-us-east-1}" \
    nohup minio server "${LDG_LOCAL_DIR}/minio/data" \
      --address "${MINIO_HOST}:${MINIO_PORT}" \
      --console-address "${MINIO_HOST}:${MINIO_CONSOLE_PORT}" \
      >"${LDG_LOG_DIR}/minio.log" 2>&1 </dev/null &
  echo "$!" >"${MINIO_PID_FILE}"
fi

ldg_wait_for_http MinIO "http://${MINIO_HOST}:${MINIO_PORT}/minio/health/ready"
"${SCRIPT_DIR}/initialize-minio.sh"

if ldg_read_pid "${MAILPIT_PID_FILE}" >/dev/null 2>&1; then
  ldg_note "Mailpit is already running"
else
  rm -f "${MAILPIT_PID_FILE}"
  ldg_note "Starting Mailpit"
  nohup mailpit \
    --database "${LDG_LOCAL_DIR}/mailpit/mailpit.db" \
    --listen "${MAILPIT_HOST}:${MAILPIT_UI_PORT}" \
    --max 5000 \
    --smtp "${MAILPIT_HOST}:${MAILPIT_SMTP_PORT}" \
    >"${LDG_LOG_DIR}/mailpit.log" 2>&1 </dev/null &
  echo "$!" >"${MAILPIT_PID_FILE}"
fi

ldg_wait_for_http Mailpit "http://${MAILPIT_HOST}:${MAILPIT_UI_PORT}/api/v1/info"

ldg_note "Local infrastructure is running"
"${SCRIPT_DIR}/status-local-infrastructure.sh"
