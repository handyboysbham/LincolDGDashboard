#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

ldg_stop_pid_file Mailpit "${LDG_RUN_DIR}/mailpit.pid" "mailpit"
ldg_stop_pid_file MinIO "${LDG_RUN_DIR}/minio.pid" "${LDG_LOCAL_DIR}/minio/data"

POSTGRES_DATA_DIR="${LDG_LOCAL_DIR}/postgres/data"
if [[ -f "${POSTGRES_DATA_DIR}/PG_VERSION" ]] &&
  pg_ctl --pgdata="${POSTGRES_DATA_DIR}" status >/dev/null 2>&1; then
  pg_ctl --pgdata="${POSTGRES_DATA_DIR}" --mode=fast --wait stop >/dev/null
  ldg_note "Stopped PostgreSQL"
else
  ldg_note "PostgreSQL is already stopped"
fi
