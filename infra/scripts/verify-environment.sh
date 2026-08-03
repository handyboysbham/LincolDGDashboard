#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

allow_missing_env=false
if [[ "${1:-}" == "--allow-missing-env" ]]; then
  allow_missing_env=true
fi

if [[ -f "${LDG_INFRA_ROOT}/.env" ]]; then
  ldg_load_environment
elif [[ "${allow_missing_env}" != true ]]; then
  ldg_die "Missing .env. Run: cp .env.example .env"
fi

ldg_require_supported_platform
ldg_require_dependencies

# shellcheck source=../local/tool-versions.env
source "${LDG_INFRA_ROOT}/infra/local/tool-versions.env"

postgres_version="$(postgres --version)"
minio_version="$(minio --version | head -n 1)"
mc_version="$(mc --version | head -n 1)"
mailpit_version="$(mailpit version | head -n 1)"

[[ "${postgres_version}" == *"${POSTGRES_VERSION}"* ]] ||
  ldg_die "Expected PostgreSQL ${POSTGRES_VERSION}; got: ${postgres_version}"
[[ "${minio_version}" == *"${MINIO_VERSION}"* ]] ||
  ldg_die "Expected MinIO ${MINIO_VERSION}; got: ${minio_version}"
[[ "${mc_version}" == *"${MINIO_MC_VERSION}"* ]] ||
  ldg_die "Expected MinIO Client ${MINIO_MC_VERSION}; got: ${mc_version}"
[[ "${mailpit_version}" == *"${MAILPIT_VERSION}"* ]] ||
  ldg_die "Expected Mailpit ${MAILPIT_VERSION}; got: ${mailpit_version}"

ldg_note "Host-native local infrastructure dependencies match pinned versions"
