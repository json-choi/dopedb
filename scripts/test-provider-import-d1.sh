#!/usr/bin/env bash
set -euo pipefail
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$repository_root/workspace-cloud/scripts/test-d1-migrations.mjs"
