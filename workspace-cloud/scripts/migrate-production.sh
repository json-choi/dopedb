#!/usr/bin/env bash
set -euo pipefail

cloud_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${WORKSPACE_DEPLOYMENT_ENV:-}" != "production" ]]; then
  echo "Production migrations require WORKSPACE_DEPLOYMENT_ENV=production" >&2
  exit 1
fi
if [[ -n "${DATABASE_URL:-}" || -n "${DATABASE_URL_UNPOOLED:-}" ]]; then
  echo "Workspace production uses the D1 binding, not database URLs" >&2
  exit 1
fi
exec node "$cloud_dir/scripts/migrate-d1.mjs" "$@"
