#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$repo_dir/workspace-cloud/scripts/migrate-d1.mjs" "$@"
