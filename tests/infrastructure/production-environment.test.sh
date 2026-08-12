#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="${root_dir}/infra/production/validate-environment.mjs"
result="$(
  LDG_PROCESS=web \
  APP_ENV=production \
  NEXT_PUBLIC_AUTH_MODE=supabase \
  NEXT_PUBLIC_API_BASE_URL=https://api.ldg.test \
  NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co \
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdefghijklmnopqrstuvwxyz \
  node "${validator}"
)"
[[ "${result}" == "Production environment is valid for the web process." ]]

api_environment=(
  APP_ENV=production
  AUTH_MODE=jwt
  WEB_ORIGIN=https://app.ldg.test
  AUTH_JWT_ISSUER=https://project.supabase.co/auth/v1
  AUTH_JWKS_URL=https://project.supabase.co/auth/v1/.well-known/jwks.json
  AUTH_JWT_AUDIENCE=authenticated
  DATABASE_URL='postgresql://ldg_app:strong-runtime-password@pooler.supabase.co:5432/postgres?sslmode=require'
  DATABASE_POOL_MAX=10
  EXPECTED_DATABASE_RELEASE=1.10.0-rc.2
  WORKER_TENANT_IDS=11111111-1111-4111-8111-111111111111
  DOCUMENT_PUBLIC_LINK_SIGNING_KEY=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab
  MINIO_ENDPOINT=https://storage.ldg.test
  MINIO_APP_USER=ldg-production
  MINIO_APP_PASSWORD=strong-object-storage-password
  MINIO_BUCKET=documents
  MAIL_FROM=no-reply@ldg.test
  NOTIFICATION_EMAIL_PROVIDER=resend
  NOTIFICATION_EMAIL_API_KEY=re_production_api_key_value
  NOTIFICATION_SMS_PROVIDER=disabled
  READY_REQUIRE_WORKER=true
  LOG_REQUESTS=true
  READY_MAX_OUTBOX_AGE_SECONDS=900
  READY_MAX_DEAD_LETTER_EVENTS=0
)
result="$(env "${api_environment[@]}" LDG_PROCESS=api node "${validator}")"
[[ "${result}" == "Production environment is valid for the api process." ]]

if output="$(
  env "${api_environment[@]}" \
    LDG_PROCESS=release \
    DATABASE_MIGRATION_URL='postgresql://ldg_app:migration-password@db.supabase.co:5432/postgres?sslmode=require' \
    DATABASE_BACKUP_URL='postgresql://ldg_app:backup-password@db.supabase.co:5432/postgres?sslmode=require' \
    node "${validator}" 2>&1
)"; then
  echo "Expected shared runtime and release roles to be rejected" >&2
  exit 1
fi
[[ "${output}" == *"must use a restricted runtime role distinct from the migration role"* ]]
[[ "${output}" == *"DATABASE_BACKUP_URL must not use the restricted runtime role"* ]]

sensitive_value="must-not-appear-in-validator-output"
if output="$(
  LDG_PROCESS=api \
  APP_ENV=production \
  AUTH_MODE=development \
  DOCUMENT_PUBLIC_LINK_SIGNING_KEY="${sensitive_value}" \
  node "${validator}" 2>&1
)"; then
  echo "Expected an unsafe API environment to be rejected" >&2
  exit 1
fi
[[ "${output}" == *"AUTH_MODE must be one of: jwt"* ]]
[[ "${output}" != *"${sensitive_value}"* ]]

echo "Production environment validation checks passed."
