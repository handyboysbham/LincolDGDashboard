#!/usr/bin/env bash

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

required_variables=(
  DATABASE_URL
  DATABASE_MIGRATION_URL
  POSTGRES_DB
  POSTGRES_RUNTIME_USER
  MINIO_ENDPOINT
  MINIO_APP_USER
  MINIO_BUCKET
  WEB_ORIGIN
  MAILPIT_UI_PORT
)
for variable_name in "${required_variables[@]}"; do
  grep -Eq "^${variable_name}=.+" .env.example || {
    echo "Missing ${variable_name} from .env.example" >&2
    exit 1
  }
done

while IFS= read -r script; do
  bash -n "${script}"
done < <(find infra/scripts -type f -name '*.sh' | sort)

grep -Fq 'NOBYPASSRLS' infra/scripts/initialize-postgres.sh
grep -Fq 'mc anonymous set none' infra/scripts/initialize-minio.sh
grep -Fq 'POSTGRES_DMG_SHA256=' infra/local/tool-versions.env
grep -Fq 'SEVENZIP_SHA256=' infra/local/tool-versions.env
grep -Fq 'MINIO_SHA256=' infra/local/tool-versions.env
grep -Fq 'MAILPIT_SHA256=' infra/local/tool-versions.env
grep -Fq '.local/' .gitignore

echo "Local infrastructure configuration tests passed"
