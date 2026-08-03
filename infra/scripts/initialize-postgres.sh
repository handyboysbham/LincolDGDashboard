#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

ldg_validate_identifier POSTGRES_DB "${POSTGRES_DB}"
ldg_validate_identifier POSTGRES_ADMIN_USER "${POSTGRES_ADMIN_USER}"
ldg_validate_identifier POSTGRES_MIGRATION_USER "${POSTGRES_MIGRATION_USER}"
ldg_validate_identifier POSTGRES_RUNTIME_USER "${POSTGRES_RUNTIME_USER}"

POSTGRES_DATA_DIR="${LDG_LOCAL_DIR}/postgres/data"

if [[ ! -f "${POSTGRES_DATA_DIR}/PG_VERSION" ]]; then
  ldg_note "Initializing PostgreSQL data directory"
  mkdir -p "${POSTGRES_DATA_DIR}"
  printf '%s\n' "${POSTGRES_ADMIN_PASSWORD}" | initdb \
    --auth-host=scram-sha-256 \
    --auth-local=scram-sha-256 \
    --encoding=UTF8 \
    --pwfile=/dev/fd/0 \
    --username="${POSTGRES_ADMIN_USER}" \
    --pgdata="${POSTGRES_DATA_DIR}" >/dev/null
fi

if ! pg_ctl --pgdata="${POSTGRES_DATA_DIR}" status >/dev/null 2>&1; then
  ldg_die "PostgreSQL must be running before roles can be initialized"
fi

export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}"

psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_ADMIN_USER}" \
  --dbname=postgres \
  --set=ON_ERROR_STOP=1 \
  --set=migration_user="${POSTGRES_MIGRATION_USER}" \
  --set=migration_password="${POSTGRES_MIGRATION_PASSWORD}" \
  --set=runtime_user="${POSTGRES_RUNTIME_USER}" \
  --set=runtime_password="${POSTGRES_RUNTIME_PASSWORD}" \
  --set=application_database="${POSTGRES_DB}" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'migration_user',
  :'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'migration_user',
  :'migration_password'
)
\gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_user',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
  :'runtime_user',
  :'runtime_password'
)
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'application_database', :'migration_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'application_database')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'application_database', :'migration_user')
\gexec
SQL

psql \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_ADMIN_USER}" \
  --dbname="${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 \
  --set=migration_user="${POSTGRES_MIGRATION_USER}" \
  --set=runtime_user="${POSTGRES_RUNTIME_USER}" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_user')
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_user')
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'migration_user',
  :'runtime_user'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  :'migration_user',
  :'runtime_user'
)
\gexec

SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I',
  :'migration_user',
  :'runtime_user'
)
\gexec
SQL

ldg_note "PostgreSQL database and least-privilege roles are ready"
