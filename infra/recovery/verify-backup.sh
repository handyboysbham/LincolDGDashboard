#!/usr/bin/env bash
set -Eeuo pipefail

backup_path="${1:-}"
[[ -f "${backup_path}" ]] || { echo "Usage: $0 /path/to/backup.dump" >&2; exit 1; }
[[ -f "${backup_path}.sha256" ]] || { echo "Missing checksum: ${backup_path}.sha256" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum --check "${backup_path}.sha256"
else
  shasum -a 256 --check "${backup_path}.sha256"
fi
pg_restore --list "${backup_path}" >/dev/null
echo "Backup checksum and archive structure are valid."
