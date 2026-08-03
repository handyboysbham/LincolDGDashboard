#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_load_environment
ldg_prepare_directories
ldg_require_dependencies

export MC_CONFIG_DIR="${LDG_LOCAL_DIR}/minio/mc"
MINIO_ALIAS=ldg-local-admin
MINIO_POLICY=ldg-documents-readwrite
MINIO_URL="http://${MINIO_HOST}:${MINIO_PORT}"
POLICY_FILE="${LDG_LOCAL_DIR}/minio/documents-policy.json"

mc alias set "${MINIO_ALIAS}" "${MINIO_URL}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
mc mb --ignore-existing "${MINIO_ALIAS}/${MINIO_BUCKET}" >/dev/null
mc anonymous set none "${MINIO_ALIAS}/${MINIO_BUCKET}" >/dev/null

cat >"${POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::${MINIO_BUCKET}"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:AbortMultipartUpload",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListMultipartUploadParts",
        "s3:PutObject"
      ],
      "Resource": ["arn:aws:s3:::${MINIO_BUCKET}/*"]
    }
  ]
}
EOF

mc admin user add "${MINIO_ALIAS}" "${MINIO_APP_USER}" "${MINIO_APP_PASSWORD}" >/dev/null

if mc admin policy info "${MINIO_ALIAS}" "${MINIO_POLICY}" >/dev/null 2>&1; then
  mc admin policy detach "${MINIO_ALIAS}" "${MINIO_POLICY}" --user="${MINIO_APP_USER}" >/dev/null 2>&1 || :
  mc admin policy rm "${MINIO_ALIAS}" "${MINIO_POLICY}" >/dev/null
fi

mc admin policy create "${MINIO_ALIAS}" "${MINIO_POLICY}" "${POLICY_FILE}" >/dev/null
mc admin policy attach "${MINIO_ALIAS}" "${MINIO_POLICY}" --user="${MINIO_APP_USER}" >/dev/null

ldg_note "Private MinIO bucket and scoped application user are ready"
