#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_prepare_directories
touch "${LDG_LOG_DIR}/postgres.log" "${LDG_LOG_DIR}/minio.log" "${LDG_LOG_DIR}/mailpit.log"
tail -n 100 -F "${LDG_LOG_DIR}/postgres.log" "${LDG_LOG_DIR}/minio.log" "${LDG_LOG_DIR}/mailpit.log"
