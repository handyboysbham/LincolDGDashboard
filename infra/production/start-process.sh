#!/usr/bin/env bash
set -euo pipefail

node infra/production/validate-environment.mjs

case "${LDG_PROCESS:-}" in
  api) exec pnpm --filter @ldg/server start:api ;;
  worker) exec pnpm --filter @ldg/server start:worker ;;
  web) exec pnpm --filter @ldg/web start ;;
  *) echo "LDG_PROCESS must be api, worker, or web" >&2; exit 1 ;;
esac
