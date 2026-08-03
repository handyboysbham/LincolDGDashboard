#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ldg_require_supported_platform
ldg_prepare_directories

# shellcheck source=../local/tool-versions.env
source "${LDG_INFRA_ROOT}/infra/local/tool-versions.env"

TOOLS_DIR="${LDG_LOCAL_DIR}/tools"
BIN_DIR="${TOOLS_DIR}/bin"
DOWNLOAD_DIR="${LDG_LOCAL_DIR}/downloads"
mkdir -p "${BIN_DIR}" "${DOWNLOAD_DIR}"

download_verified() {
  local url="$1"
  local destination="$2"
  local expected_sha256="$3"

  if [[ ! -f "${destination}" ]] ||
    [[ "$(shasum -a 256 "${destination}" | awk '{print $1}')" != "${expected_sha256}" ]]; then
    rm -f "${destination}"
    curl --fail --location --retry 3 --show-error --output "${destination}" "${url}"
  fi

  local actual_sha256
  actual_sha256="$(shasum -a 256 "${destination}" | awk '{print $1}')"
  [[ "${actual_sha256}" == "${expected_sha256}" ]] ||
    ldg_die "Checksum mismatch for ${destination}"
}

POSTGRES_DMG="${DOWNLOAD_DIR}/Postgres-${POSTGRES_APP_VERSION}-18.dmg"
SEVENZIP_ARCHIVE="${DOWNLOAD_DIR}/7z2602-mac.tar.xz"
MINIO_DOWNLOAD="${DOWNLOAD_DIR}/minio.${MINIO_VERSION}"
MC_DOWNLOAD="${DOWNLOAD_DIR}/mc.${MINIO_MC_VERSION}"
MAILPIT_ARCHIVE="${DOWNLOAD_DIR}/mailpit-${MAILPIT_VERSION}-darwin-amd64.tar.gz"

ldg_note "Downloading checksum-verified local infrastructure tools"
download_verified \
  "https://github.com/ip7z/7zip/releases/download/${SEVENZIP_VERSION}/7z2602-mac.tar.xz" \
  "${SEVENZIP_ARCHIVE}" \
  "${SEVENZIP_SHA256}"
download_verified \
  "https://github.com/PostgresApp/PostgresApp/releases/download/v${POSTGRES_APP_VERSION}/Postgres-${POSTGRES_APP_VERSION}-18.dmg" \
  "${POSTGRES_DMG}" \
  "${POSTGRES_DMG_SHA256}"
download_verified \
  "https://dl.min.io/server/minio/release/darwin-amd64/minio.${MINIO_VERSION}" \
  "${MINIO_DOWNLOAD}" \
  "${MINIO_SHA256}"
download_verified \
  "https://dl.min.io/client/mc/release/darwin-amd64/mc.${MINIO_MC_VERSION}" \
  "${MC_DOWNLOAD}" \
  "${MINIO_MC_SHA256}"
download_verified \
  "https://github.com/axllent/mailpit/releases/download/v${MAILPIT_VERSION}/mailpit-darwin-amd64.tar.gz" \
  "${MAILPIT_ARCHIVE}" \
  "${MAILPIT_SHA256}"

if [[ ! -x "${TOOLS_DIR}/postgres/bin/postgres" ]]; then
  SEVENZIP_DIR="${TOOLS_DIR}/7zip"
  POSTGRES_EXTRACT_DIR="${LDG_LOCAL_DIR}/postgres-installer-extract"
  rm -rf "${SEVENZIP_DIR}" "${POSTGRES_EXTRACT_DIR}"
  mkdir -p "${SEVENZIP_DIR}" "${POSTGRES_EXTRACT_DIR}"
  tar -xJf "${SEVENZIP_ARCHIVE}" -C "${SEVENZIP_DIR}"

  set +e
  "${SEVENZIP_DIR}/7zz" x "${POSTGRES_DMG}" -o"${POSTGRES_EXTRACT_DIR}" -y \
    >"${LDG_LOG_DIR}/postgres-extract.log" 2>&1
  postgres_extract_status=$?
  set -e

  [[ "${postgres_extract_status}" -eq 0 || "${postgres_extract_status}" -eq 2 ]] ||
    ldg_die "Unable to extract the Postgres.app release"

  POSTGRES_SOURCE="${POSTGRES_EXTRACT_DIR}/Postgres-${POSTGRES_APP_VERSION}-18/Postgres.app/Contents/Versions/18"
  [[ -x "${POSTGRES_SOURCE}/bin/postgres" ]] || ldg_die "PostgreSQL binary was not extracted"

  rm -rf "${TOOLS_DIR}/postgres"
  ditto "${POSTGRES_SOURCE}" "${TOOLS_DIR}/postgres"

  ln -sf ../../protobuf-c/protobuf-c.h "${TOOLS_DIR}/postgres/include/google/protobuf-c/protobuf-c.h"
  ln -sf libgdal.34.dylib "${TOOLS_DIR}/postgres/lib/libgdal.dylib"
  ln -sf libgeos_c.1.dylib "${TOOLS_DIR}/postgres/lib/libgeos_c.dylib"
  ln -sf libjson-c.5.dylib "${TOOLS_DIR}/postgres/lib/libjson-c.dylib"
  ln -sf libopenjp2.7.dylib "${TOOLS_DIR}/postgres/lib/libopenjp2.dylib"
  ln -sf libproj.25.dylib "${TOOLS_DIR}/postgres/lib/libproj.dylib"
  ln -sf libSFCGAL.2.dylib "${TOOLS_DIR}/postgres/lib/libSFCGAL.dylib"
fi

install -m 0755 "${MINIO_DOWNLOAD}" "${BIN_DIR}/minio"
install -m 0755 "${MC_DOWNLOAD}" "${BIN_DIR}/mc"
tar -xzf "${MAILPIT_ARCHIVE}" -C "${BIN_DIR}" mailpit
chmod 0755 "${BIN_DIR}/mailpit"

ldg_note "Project-local infrastructure tools are installed"
"${SCRIPT_DIR}/verify-environment.sh" --allow-missing-env
