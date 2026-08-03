#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

status=0
POSTGRES_DATA_DIR="${LDG_LOCAL_DIR}/postgres/data"

if [[ -f "${POSTGRES_DATA_DIR}/PG_VERSION" ]] &&
  pg_isready --host="${POSTGRES_HOST}" --port="${POSTGRES_PORT}" --quiet; then
  echo "PostgreSQL  ready  ${POSTGRES_HOST}:${POSTGRES_PORT}"
else
  echo "PostgreSQL  down   ${POSTGRES_HOST}:${POSTGRES_PORT}"
  status=1
fi

if ldg_read_pid "${LDG_RUN_DIR}/minio.pid" >/dev/null 2>&1 &&
  curl --fail --silent --max-time 2 "http://${MINIO_HOST}:${MINIO_PORT}/minio/health/ready" >/dev/null; then
  echo "MinIO       ready  http://${MINIO_HOST}:${MINIO_PORT}"
else
  echo "MinIO       down   http://${MINIO_HOST}:${MINIO_PORT}"
  status=1
fi

if ldg_read_pid "${LDG_RUN_DIR}/mailpit.pid" >/dev/null 2>&1 &&
  curl --fail --silent --max-time 2 "http://${MAILPIT_HOST}:${MAILPIT_UI_PORT}/api/v1/info" >/dev/null; then
  echo "Mailpit     ready  http://${MAILPIT_HOST}:${MAILPIT_UI_PORT}"
else
  echo "Mailpit     down   http://${MAILPIT_HOST}:${MAILPIT_UI_PORT}"
  status=1
fi

exit "${status}"
