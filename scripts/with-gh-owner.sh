#!/usr/bin/env bash
# Run one owner-only GitHub operation with json-choi, then restore jaesong-blip
# even when the wrapped command fails or the shell receives a termination signal.
set -euo pipefail

readonly default_login="jaesong-blip"
readonly owner_login="json-choi"
readonly github_host="github.com"
project_root="$(cd "$(dirname "$0")/.." && pwd)"
readonly project_root
readonly gh_bin="${DOPEDB_GH_BIN:-gh}"
readonly lock_dir="${DOPEDB_GH_SWITCH_LOCK_DIR:-${TMPDIR:-/tmp}/dopedb-gh-owner-$(id -u).lock}"

usage() {
  cat >&2 <<'EOF'
Usage:
  pnpm gh:owner -- gh <arguments...>
  pnpm gh:owner -- git push <arguments...>
  pnpm gh:restore

Only one gh command or one git push may run while json-choi is active.
EOF
}

active_login() {
  "$gh_bin" api user --jq .login
}

switch_login() {
  "$gh_bin" auth switch --hostname "$github_host" --user "$1" >/dev/null
}

clear_lock() {
  rm -f "$lock_dir/pid"
  rmdir "$lock_dir" 2>/dev/null || true
}

restore_default() {
  local original_status=$?
  local restore_failed=false

  trap - EXIT HUP INT TERM
  if [ "$switch_attempted" = true ]; then
    if ! switch_login "$default_login"; then
      echo "gh-owner: failed to restore $default_login" >&2
      restore_failed=true
    elif [ "$(active_login)" != "$default_login" ]; then
      echo "gh-owner: restore verification failed for $default_login" >&2
      restore_failed=true
    fi
  fi
  clear_lock

  if [ "$restore_failed" = true ]; then
    exit 70
  fi
  exit "$original_status"
}

restore_after_crash() {
  local lock_pid=""

  if [ -f "$lock_dir/pid" ]; then
    IFS= read -r lock_pid <"$lock_dir/pid" || true
  fi
  if [[ "$lock_pid" =~ ^[0-9]+$ ]] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "gh-owner: another account-scoped command is still running (pid $lock_pid)" >&2
    exit 75
  fi

  clear_lock
  switch_login "$default_login"
  if [ "$(active_login)" != "$default_login" ]; then
    echo "gh-owner: restore verification failed for $default_login" >&2
    exit 70
  fi
  echo "gh-owner: restored $default_login"
}

if [ "${1:-}" = "--restore" ]; then
  if [ "$#" -ne 1 ]; then
    usage
    exit 64
  fi
  restore_after_crash
  exit 0
fi

if [ "${1:-}" = "--" ]; then
  shift
fi
if [ "$#" -lt 2 ]; then
  usage
  exit 64
fi

command_name="$(basename "$1")"
case "$command_name" in
  gh)
    if [ "${2:-}" = "auth" ]; then
      echo "gh-owner: nested gh auth commands are not allowed" >&2
      exit 64
    fi
    ;;
  git)
    if [ "${2:-}" != "push" ]; then
      echo "gh-owner: only git push is allowed with the owner account" >&2
      exit 64
    fi
    ;;
  *)
    echo "gh-owner: only gh commands and git push are allowed" >&2
    usage
    exit 64
    ;;
esac

cd "$project_root"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "gh-owner: another account-scoped command or a stale lock exists" >&2
  echo "gh-owner: run 'pnpm gh:restore' only after confirming no wrapper is active" >&2
  exit 75
fi
printf '%s\n' "$$" >"$lock_dir/pid"

switch_attempted=false
trap restore_default EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$(active_login)" != "$default_login" ]; then
  echo "gh-owner: expected active account $default_login; run 'pnpm gh:restore' first" >&2
  switch_attempted=true
  exit 77
fi
if [ "$("$gh_bin" repo view --json owner --jq .owner.login)" != "$owner_login" ]; then
  echo "gh-owner: the current repository is not owned by $owner_login" >&2
  exit 77
fi

switch_attempted=true
switch_login "$owner_login"
if [ "$(active_login)" != "$owner_login" ]; then
  echo "gh-owner: owner activation verification failed for $owner_login" >&2
  exit 70
fi

if [ "$command_name" = "gh" ]; then
  shift
  "$gh_bin" "$@"
else
  "$@"
fi
