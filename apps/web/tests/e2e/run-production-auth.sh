#!/usr/bin/env bash
set -euo pipefail

export APP_ENV=production
export NEXT_PUBLIC_API_BASE_URL=https://api.ldg.test
export NEXT_PUBLIC_AUTH_MODE=supabase
export NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abcdefghijklmnopqrstuvwxyz

next build
vitest run --config vitest.e2e.config.ts tests/e2e/auth-boundary.test.ts
