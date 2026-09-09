#!/usr/bin/env bash
set -euo pipefail
# Retain the existing required-check entry point while its Workspace storage
# implementation moves to D1. The native harness exercises production migrations.
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$repository_root/scripts/test-provider-import-d1.sh"
