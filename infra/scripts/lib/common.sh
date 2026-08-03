#!/usr/bin/env bash

set -Eeuo pipefail

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

LDG_INFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LDG_LOCAL_DIR="${LDG_INFRA_ROOT}/.local"
LDG_LOG_DIR="${LDG_LOCAL_DIR}/logs"
LDG_RUN_DIR="${LDG_LOCAL_DIR}/run"

ldg_die() {
  echo "error: $*" >&2
  exit 1
}

ldg_note() {
  echo "==> $*"
}

ldg_load_environment() {
  local env_file="${LDG_INFRA_ROOT}/.env"
  [[ -f "${env_file}" ]] || ldg_die "Missing .env. Run: cp .env.example .env"

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a

  local required_variables=(
    POSTGRES_HOST
    POSTGRES_PORT
    POSTGRES_DB
    POSTGRES_ADMIN_USER
    POSTGRES_ADMIN_PASSWORD
    POSTGRES_MIGRATION_USER
    POSTGRES_MIGRATION_PASSWORD
    POSTGRES_RUNTIME_USER
    POSTGRES_RUNTIME_PASSWORD
    MINIO_HOST
    MINIO_PORT
    MINIO_CONSOLE_PORT
    MINIO_ROOT_USER
    MINIO_ROOT_PASSWORD
    MINIO_APP_USER
    MINIO_APP_PASSWORD
    MINIO_BUCKET
    MAILPIT_HOST
    MAILPIT_SMTP_PORT
    MAILPIT_UI_PORT
  )

  local variable_name
  for variable_name in "${required_variables[@]}"; do
    [[ -n "${!variable_name:-}" ]] || ldg_die "${variable_name} must be set in .env"
  done
}

ldg_prepare_directories() {
  mkdir -p \
    "${LDG_LOCAL_DIR}/postgres" \
    "${LDG_LOCAL_DIR}/minio/data" \
    "${LDG_LOCAL_DIR}/minio/mc" \
    "${LDG_LOCAL_DIR}/mailpit" \
    "${LDG_LOG_DIR}" \
    "${LDG_RUN_DIR}"
}

ldg_add_local_tool_paths() {
  export PATH="${LDG_LOCAL_DIR}/tools/postgres/bin:${LDG_LOCAL_DIR}/tools/bin:${PATH}"
}

ldg_require_command() {
  command -v "$1" >/dev/null 2>&1 || ldg_die "$1 is not installed. Run: pnpm infra:install"
}

ldg_require_dependencies() {
  ldg_add_local_tool_paths
  ldg_require_command initdb
  ldg_require_command pg_ctl
  ldg_require_command pg_isready
  ldg_require_command psql
  ldg_require_command minio
  ldg_require_command mc
  ldg_require_command mailpit
  ldg_require_command curl
}

ldg_require_supported_platform() {
  [[ "$(uname -s)" == Darwin ]] || ldg_die "The V1 local installer currently supports macOS only"
  [[ "$(uname -m)" == x86_64 ]] || ldg_die "The V1 local installer currently supports Intel macOS only"
}

ldg_validate_identifier() {
  [[ "$2" =~ ^[a-z_][a-z0-9_]*$ ]] || ldg_die "$1 must be a lowercase SQL identifier"
}

ldg_wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-60}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error --max-time 2 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  ldg_die "${label} did not become ready at ${url}"
}

ldg_read_pid() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] || return 1

  local pid
  pid="$(<"${pid_file}")"
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  kill -0 "${pid}" 2>/dev/null || return 1
  printf '%s\n' "${pid}"
}

ldg_stop_pid_file() {
  local label="$1"
  local pid_file="$2"
  local expected_command="$3"
  local pid

  if ! pid="$(ldg_read_pid "${pid_file}")"; then
    rm -f "${pid_file}"
    ldg_note "${label} is already stopped"
    return 0
  fi

  local command_line
  command_line="$(ps -p "${pid}" -o command=)"
  [[ "${command_line}" == *"${expected_command}"* ]] ||
    ldg_die "Refusing to stop PID ${pid}; it is not the expected ${label} process"

  kill -TERM "${pid}"
  local attempt
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${pid_file}"
      ldg_note "Stopped ${label}"
      return 0
    fi
    sleep 1
  done

  ldg_die "${label} did not stop after 30 seconds"
}
