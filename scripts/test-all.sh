#!/usr/bin/env bash
# Reproduces the ci.yml verification matrix on a developer machine: the same
# steps, in the order CI runs them, behind a preflight that names every missing
# prerequisite before an expensive phase starts.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

all_phases=(
  frontend-smoke
  rust-smoke
  provider-postgres
  analytics-cloudflare
  scheduler-cloudflare
  site-build
)

usage() {
  cat <<'EOF'
Usage: bash scripts/test-all.sh [options] [phase ...]

Runs the .github/workflows/ci.yml verification matrix on this machine, in the
order CI runs it, and prints one pass/fail line per phase.

Phases (default: every phase, in this order):
  frontend-smoke        install, pnpm build, pnpm test
  rust-smoke            stage sidecars, cargo fmt, clippy, the four cargo tests
  provider-postgres     Workspace Workers, D1 migrations, Cloud SQL policy,
                        harness safety guard
  analytics-cloudflare  analytics Worker build, test, wrangler dry-run
  scheduler-cloudflare  scheduler Worker build, test, wrangler dry-run
  site-build            marketing Worker build, wrangler dry-run

Options:
  --preflight       Check prerequisites for the selected phases, then exit.
  --skip-preflight  Run the phases without checking prerequisites first.
  --skip-install    Skip every "install --frozen-lockfile" step.
  --skip-sidecars   Skip scripts/build-sidecars.sh in rust-smoke and require the
                    sidecars to be staged already.
  --fail-fast       Stop after the first failing phase.
  --list            Print the phase names, one per line, and exit.
  -h, --help        Print this message.

Every phase runs by default even after an earlier one fails, so a single run
reports every problem. The exit status is 0 only when every selected phase
passed.

Environment:
  PG_BIN            PostgreSQL bin directory holding initdb, pg_ctl and psql,
                    from a server at or above the floor named below. Validated
                    when set, resolved automatically when unset. CI uses
                    "pg_config --bindir"; locally that often resolves to a
                    libpq-only client with no initdb, so this script searches
                    for a directory that holds a new enough server.
  PNPM              Package manager command to use, for example "corepack pnpm".
                    Otherwise pnpm is used when its version matches the
                    packageManager pin, and "corepack pnpm" when it does not.
  CARGO_TOOLCHAIN   rustup toolchain name to pin, exported as RUSTUP_TOOLCHAIN.
                    Otherwise the lowest installed toolchain that satisfies the
                    workspace rust-version is selected.

provider-postgres needs a PostgreSQL 14 or newer server on this machine, because
scripts/test-gcp-schema-policy.mjs grants pg_read_all_data and pg_write_all_data,
which are PostgreSQL 14+ predefined roles. An older server fails in preflight.

Three CI jobs are deliberately out of scope because they cannot run here:
  dependency-vulnerability-scan  google/osv-scanner-action reusable workflow
  site-deploy                    deploys to Cloudflare from main
  windows-check                  needs a windows-latest runner
EOF
}

# ---------------------------------------------------------------- arguments --

run_preflight=1
preflight_only=0
skip_install=0
skip_sidecars=0
fail_fast=0
requested_phases=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preflight) preflight_only=1 ;;
    --skip-preflight) run_preflight=0 ;;
    --skip-install) skip_install=1 ;;
    --skip-sidecars) skip_sidecars=1 ;;
    --fail-fast) fail_fast=1 ;;
    --list)
      printf '%s\n' "${all_phases[@]}"
      exit 0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *) requested_phases="${requested_phases}$1"$'\n' ;;
  esac
  shift
done

phase_index() {
  local wanted="$1" position=0
  while [[ "$position" -lt "${#all_phases[@]}" ]]; do
    if [[ "${all_phases[$position]}" == "$wanted" ]]; then
      printf '%s\n' "$position"
      return 0
    fi
    position=$((position + 1))
  done
  return 1
}

phase_selected=()
phase_status=()
phase_detail=()
phase_seconds=()
position=0
while [[ "$position" -lt "${#all_phases[@]}" ]]; do
  phase_selected[position]=0
  phase_status[position]="skipped"
  phase_detail[position]=""
  phase_seconds[position]=0
  position=$((position + 1))
done

if [[ -z "$requested_phases" ]]; then
  position=0
  while [[ "$position" -lt "${#all_phases[@]}" ]]; do
    phase_selected[position]=1
    position=$((position + 1))
  done
else
  while IFS= read -r requested; do
    if [[ -z "$requested" ]]; then
      continue
    fi
    if ! position="$(phase_index "$requested")"; then
      printf 'Unknown phase: %s\n' "$requested" >&2
      printf 'Known phases: %s\n' "${all_phases[*]}" >&2
      exit 2
    fi
    phase_selected[position]=1
  done <<EOF
$requested_phases
EOF
fi

is_selected() {
  local position
  position="$(phase_index "$1")" || return 1
  [[ "${phase_selected[$position]}" == "1" ]]
}

# ------------------------------------------------------------------ helpers --

preflight_failures=0
package_manager_command=()
required_rust_version=""
resolved_pg_bin=""
resolved_pg_version=""

check_ok() { printf '  [ ok ] %s\n' "$1"; }
check_note() { printf '         %s\n' "$1"; }
check_fail() {
  printf '  [FAIL] %s\n' "$1"
  preflight_failures=$((preflight_failures + 1))
}

# Compares dotted versions. Succeeds when $1 is at least $2.
version_satisfies() {
  local lowest
  lowest="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)"
  [[ "$lowest" == "$2" ]]
}

# Prints the version of a cargo invocation, e.g. cargo_version cargo +stable
cargo_version() {
  local raw
  raw="$("$@" --version 2>/dev/null | head -1)" || return 1
  if [[ -z "$raw" ]]; then
    return 1
  fi
  printf '%s\n' "$raw" | awk '{ print $2 }'
}

# ---------------------------------------------------------------- preflight --

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    check_fail "node is not on PATH. Install Node.js 24, the version ci.yml pins."
    return 0
  fi
  local version major
  version="$(node --version)"
  major="${version#v}"
  major="${major%%.*}"
  check_ok "node $version"
  if [[ "$major" != "24" ]]; then
    check_note "ci.yml runs Node 24; another major can pass here and fail in CI."
  fi
  return 0
}

check_package_manager() {
  local pinned expected candidate_version corepack_version
  pinned="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)"
  expected="${pinned#pnpm@}"
  if [[ -z "$expected" ]]; then
    check_fail "package.json has no packageManager pin, so the pnpm version cannot be verified."
    return 0
  fi

  if [[ -n "${PNPM:-}" ]]; then
    # Word splitting is intended: PNPM may be "corepack pnpm".
    # shellcheck disable=SC2206
    package_manager_command=($PNPM)
    candidate_version="$("${package_manager_command[@]}" --version 2>/dev/null || true)"
    if [[ -z "$candidate_version" ]]; then
      package_manager_command=()
      check_fail "PNPM is set to '$PNPM' but it does not run. Unset PNPM or point it at a working pnpm."
      return 0
    fi
    check_ok "package manager: $PNPM ($candidate_version), pinned $expected"
    if [[ "$candidate_version" != "$expected" ]]; then
      check_note "Version differs from the packageManager pin; lockfile handling can differ from CI."
    fi
    return 0
  fi

  candidate_version="$(pnpm --version 2>/dev/null || true)"
  if [[ "$candidate_version" == "$expected" ]]; then
    package_manager_command=(pnpm)
    check_ok "package manager: pnpm ($candidate_version)"
    return 0
  fi

  corepack_version="$(corepack pnpm --version 2>/dev/null || true)"
  if [[ -n "$corepack_version" ]]; then
    package_manager_command=(corepack pnpm)
    check_ok "package manager: corepack pnpm ($corepack_version), pinned $expected"
    if [[ -n "$candidate_version" ]]; then
      check_note "pnpm $candidate_version is also on PATH; corepack wins because it honours the pin."
    fi
    if [[ "$corepack_version" != "$expected" ]]; then
      check_note "corepack resolved $corepack_version rather than the pinned $expected."
    fi
    return 0
  fi

  if [[ -n "$candidate_version" ]]; then
    package_manager_command=(pnpm)
    check_ok "package manager: pnpm ($candidate_version)"
    check_note "Expected $expected and corepack is unavailable; run 'corepack enable' for CI parity."
    return 0
  fi

  check_fail "No usable pnpm. Install Node.js 24 with corepack, run 'corepack enable'; this repo pins pnpm $expected."
  return 0
}

resolve_required_rust_version() {
  local members member version
  members="$(sed -n '/^\[workspace\]/,/^\[[a-z]/p' Cargo.toml |
    sed -n 's/^[[:space:]]*"\([^"]*\)",\{0,1\}[[:space:]]*$/\1/p')"
  for member in $members; do
    if [[ ! -f "$member/Cargo.toml" ]]; then
      continue
    fi
    version="$(sed -n 's/^rust-version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$member/Cargo.toml" | head -1)"
    if [[ -z "$version" ]]; then
      continue
    fi
    if [[ -z "$required_rust_version" ]] || ! version_satisfies "$required_rust_version" "$version"; then
      required_rust_version="$version"
    fi
  done
}

check_rust_toolchain() {
  local version toolchain_names="" name base chosen="" matched=""
  local satisfying_stable="" satisfying_other=""

  resolve_required_rust_version

  if ! command -v cargo >/dev/null 2>&1; then
    check_fail "cargo is not on PATH. Install Rust from https://rustup.rs and re-run."
    return 0
  fi
  if command -v rustup >/dev/null 2>&1; then
    toolchain_names="$(rustup toolchain list 2>/dev/null | sed -e 's/ (.*)$//')"
  fi

  version="$(cargo_version cargo || true)"
  if [[ -z "$required_rust_version" ]]; then
    check_ok "Rust toolchain: default (cargo ${version:-unknown}); no workspace rust-version to enforce"
    return 0
  fi

  if [[ -n "${CARGO_TOOLCHAIN:-}" ]]; then
    # Resolve against the installed list rather than running "cargo +name",
    # which makes rustup download a missing toolchain behind the user's back.
    for name in $toolchain_names; do
      if [[ "$name" == "${CARGO_TOOLCHAIN}" || "$name" == "${CARGO_TOOLCHAIN}"-* ]]; then
        matched="$name"
        break
      fi
    done
    if [[ -z "$matched" ]]; then
      check_fail "CARGO_TOOLCHAIN='$CARGO_TOOLCHAIN' is not installed. Run: rustup toolchain install $CARGO_TOOLCHAIN"
      return 0
    fi
    version="$(cargo_version cargo "+${matched}" || true)"
    if [[ -z "$version" ]]; then
      check_fail "CARGO_TOOLCHAIN='$CARGO_TOOLCHAIN' resolved to '$matched' but its cargo does not run. Run: rustup toolchain install $CARGO_TOOLCHAIN"
      return 0
    fi
    if ! version_satisfies "${version%%-*}" "$required_rust_version"; then
      check_fail "CARGO_TOOLCHAIN='$CARGO_TOOLCHAIN' is cargo $version, older than the workspace rust-version $required_rust_version."
      return 0
    fi
    export RUSTUP_TOOLCHAIN="$matched"
    check_ok "Rust toolchain: $matched (cargo $version), workspace needs $required_rust_version"
    return 0
  fi

  if [[ -n "$version" ]] && version_satisfies "${version%%-*}" "$required_rust_version"; then
    check_ok "Rust toolchain: default (cargo $version), workspace needs $required_rust_version"
    return 0
  fi

  if [[ -z "$toolchain_names" ]]; then
    check_fail "cargo ${version:-unknown} is older than the workspace rust-version $required_rust_version, and rustup is not available to select another toolchain."
    return 0
  fi

  for name in $toolchain_names; do
    base="$(cargo_version cargo "+$name" || true)"
    if [[ -z "$base" ]] || ! version_satisfies "${base%%-*}" "$required_rust_version"; then
      continue
    fi
    case "$base" in
      *-nightly* | *-beta*) satisfying_other="${satisfying_other}${base%%-*} ${name}"$'\n' ;;
      *) satisfying_stable="${satisfying_stable}${base} ${name}"$'\n' ;;
    esac
  done

  chosen="$(printf '%s' "$satisfying_stable" | sed '/^$/d' | sort -V | head -1)"
  if [[ -z "$chosen" ]]; then
    chosen="$(printf '%s' "$satisfying_other" | sed '/^$/d' | sort -V | head -1)"
  fi
  if [[ -z "$chosen" ]]; then
    check_fail "No installed toolchain satisfies the workspace rust-version $required_rust_version (default cargo is ${version:-unknown}). Run: rustup toolchain install $required_rust_version"
    return 0
  fi

  name="${chosen#* }"
  export RUSTUP_TOOLCHAIN="$name"
  check_ok "Rust toolchain: $name (cargo ${chosen%% *}), workspace needs $required_rust_version"
  check_note "The default toolchain is cargo ${version:-unknown}; RUSTUP_TOOLCHAIN=$name is exported for every cargo and rustc call, scripts/build-sidecars.sh included."
  return 0
}

check_sidecars() {
  local triple staged=0 missing="" binary
  if [[ ! -f scripts/build-sidecars.sh ]]; then
    check_fail "scripts/build-sidecars.sh is missing, so the rust-smoke sidecars cannot be staged."
    return 0
  fi
  if ! command -v rustc >/dev/null 2>&1; then
    check_fail "rustc is not on PATH, so the sidecar target triple cannot be resolved."
    return 0
  fi
  triple="$(rustc -vV | sed -n 's/^host: //p')"
  for binary in dopedb-cli dopedb-agent-bridge cloud-sql-proxy; do
    if [[ -x "src-tauri/binaries/$binary-$triple" ]]; then
      staged=$((staged + 1))
    else
      missing="${missing} $binary"
    fi
  done

  if [[ "$staged" -eq 3 ]]; then
    check_ok "Staged sidecars for $triple"
    if [[ "$skip_sidecars" -eq 1 ]]; then
      check_note "--skip-sidecars: scripts/build-sidecars.sh will not re-stage them."
    fi
    return 0
  fi

  if [[ "$skip_sidecars" -eq 1 ]]; then
    check_fail "--skip-sidecars was passed but these sidecars are not staged for $triple:${missing}. Run 'bash scripts/build-sidecars.sh' or drop --skip-sidecars."
    return 0
  fi

  check_ok "Sidecars will be staged by rust-smoke (missing for $triple:${missing})"
  check_note "scripts/build-sidecars.sh builds dopedb-cli in release mode and downloads the pinned Cloud SQL Auth Proxy on a cold cache."
  return 0
}

# scripts/test-gcp-schema-policy.mjs grants pg_read_all_data and
# pg_write_all_data, which are PostgreSQL 14+ predefined roles, so 14 is the
# floor for this phase and the script itself refuses anything older.
postgres_version_floor="14"

check_postgres() {
  local candidates="" candidate directory initdb_path raw version=""
  local config_bindir="" below_floor_bin="" below_floor_version=""
  local explicit="${PG_BIN:-}"

  if [[ -n "$explicit" ]]; then
    candidates="${explicit}"$'\n'
  fi
  if command -v pg_config >/dev/null 2>&1; then
    config_bindir="$(pg_config --bindir 2>/dev/null || true)"
    if [[ -n "$config_bindir" ]]; then
      candidates="${candidates}${config_bindir}"$'\n'
    fi
  fi
  if command -v initdb >/dev/null 2>&1; then
    initdb_path="$(command -v initdb)"
    candidates="${candidates}$(dirname "$initdb_path")"$'\n'
  fi
  for directory in \
    /opt/homebrew/opt/postgresql@*/bin \
    /usr/local/opt/postgresql@*/bin \
    /usr/lib/postgresql/*/bin \
    /Applications/Postgres.app/Contents/Versions/*/bin; do
    if [[ -d "$directory" ]]; then
      candidates="${candidates}${directory}"$'\n'
    fi
  done

  while IFS= read -r candidate; do
    if [[ -z "$candidate" ]]; then
      continue
    fi
    if [[ ! -x "$candidate/initdb" || ! -x "$candidate/pg_ctl" || ! -x "$candidate/psql" ]]; then
      continue
    fi
    raw="$("$candidate/initdb" --version 2>/dev/null || true)"
    version="$(printf '%s\n' "$raw" | awk '{ print $3 }')"
    if [[ -n "$version" ]] && version_satisfies "$version" "$postgres_version_floor"; then
      resolved_pg_bin="$candidate"
      resolved_pg_version="$version"
      break
    fi
    if [[ -z "$below_floor_bin" ]]; then
      below_floor_bin="$candidate"
      below_floor_version="${version:-unknown}"
    fi
  done <<EOF
$candidates
EOF

  if [[ -n "$resolved_pg_bin" ]]; then
    export PG_BIN="$resolved_pg_bin"
    check_ok "PostgreSQL server tools: $PG_BIN (PostgreSQL $resolved_pg_version, floor $postgres_version_floor)"
    if [[ -n "$explicit" && "$explicit" != "$resolved_pg_bin" ]]; then
      check_note "PG_BIN was set to '$explicit', which is not a PostgreSQL $postgres_version_floor+ server directory; using $resolved_pg_bin instead."
    elif [[ -n "$config_bindir" && "$config_bindir" != "$resolved_pg_bin" ]]; then
      check_note "CI uses \"pg_config --bindir\"; here that is $config_bindir, which this phase cannot use."
    fi
    return 0
  fi

  if [[ -n "$below_floor_bin" ]]; then
    check_fail "The newest PostgreSQL server found is $below_floor_bin (PostgreSQL $below_floor_version), below the $postgres_version_floor floor. scripts/test-gcp-schema-policy.mjs grants pg_read_all_data and pg_write_all_data, which are PostgreSQL 14+ predefined roles. Install a newer server (macOS: brew install postgresql@15) or set PG_BIN to its bin directory."
    return 0
  fi
  if [[ -n "$explicit" ]]; then
    check_fail "PG_BIN='$explicit' does not contain initdb, pg_ctl and psql. Point it at a PostgreSQL $postgres_version_floor+ server install rather than a libpq-only client."
    return 0
  fi
  if [[ -n "$config_bindir" ]]; then
    check_fail "No PostgreSQL server install found. 'pg_config --bindir' is $config_bindir, which has no initdb, so it is a libpq-only client. Install a server (macOS: brew install postgresql@15) or set PG_BIN to its bin directory."
    return 0
  fi
  check_fail "No PostgreSQL install with initdb was found. Install a PostgreSQL $postgres_version_floor+ server (macOS: brew install postgresql@15) or set PG_BIN to its bin directory."
  return 0
}

check_dependencies() {
  local directory="$1" label="$2" lockfile modules install_hint
  if [[ "$directory" == "." ]]; then
    lockfile="pnpm-lock.yaml"
    modules="node_modules"
    install_hint="${package_manager_command[*]:-pnpm} install --frozen-lockfile"
  else
    lockfile="$directory/pnpm-lock.yaml"
    modules="$directory/node_modules"
    install_hint="${package_manager_command[*]:-pnpm} --dir $directory install --frozen-lockfile"
  fi

  if [[ ! -d "$directory" ]]; then
    check_fail "$label: directory '$directory' is missing from this checkout."
    return 0
  fi
  if [[ ! -f "$lockfile" ]]; then
    check_fail "$label: $lockfile is missing, so 'install --frozen-lockfile' cannot run."
    return 0
  fi
  if [[ -d "$modules" ]]; then
    check_ok "$label: dependencies installed"
    return 0
  fi
  if [[ "$skip_install" -eq 1 ]]; then
    check_fail "$label: $modules is missing and --skip-install was passed. Run: $install_hint"
    return 0
  fi
  check_ok "$label: dependencies will be installed by its own 'install --frozen-lockfile'"
  return 0
}

needs_package_manager() {
  local phase
  for phase in frontend-smoke provider-postgres analytics-cloudflare scheduler-cloudflare site-build; do
    if is_selected "$phase"; then
      return 0
    fi
  done
  return 1
}

run_preflight_checks() {
  printf '==> Preflight\n'
  check_node
  if needs_package_manager; then
    check_package_manager
  fi
  if is_selected rust-smoke; then
    check_rust_toolchain
    check_sidecars
  fi
  if is_selected frontend-smoke; then
    check_dependencies "." "app"
  fi
  if is_selected provider-postgres; then
    check_dependencies "workspace-cloud" "workspace-cloud"
    check_postgres
  fi
  if is_selected analytics-cloudflare; then
    check_dependencies "product-analytics-cloudflare" "product-analytics-cloudflare"
  fi
  if is_selected scheduler-cloudflare; then
    check_dependencies "workspace-scheduler-cloudflare" "workspace-scheduler-cloudflare"
  fi
  if is_selected site-build; then
    check_dependencies "site" "site"
  fi

  if [[ "$preflight_failures" -gt 0 ]]; then
    printf '\nPreflight found %s unmet prerequisite(s). Nothing was run.\n' "$preflight_failures" >&2
    return 1
  fi
  printf '\nPreflight passed.\n'
  return 0
}

# ------------------------------------------------------------------- phases --

current_phase_position=0
current_phase_failed=0

run_step() {
  local description="$1"
  shift
  local status=0
  printf '\n--- %s\n    $ %s\n' "$description" "$*"
  "$@" || status=$?
  if [[ "$status" -ne 0 ]]; then
    current_phase_failed=1
    phase_detail[current_phase_position]="$description (exit $status)"
    printf '\n!!! %s failed with exit %s\n' "$description" "$status" >&2
    return 1
  fi
  return 0
}

begin_phase() {
  current_phase_position="$(phase_index "$1")"
  current_phase_failed=0
  printf '\n================================================================\n'
  printf '==> %s\n' "$1"
  printf '================================================================\n'
}

end_phase() {
  phase_seconds[current_phase_position]="$1"
  if [[ "$current_phase_failed" -eq 1 ]]; then
    phase_status[current_phase_position]="FAIL"
    return 1
  fi
  phase_status[current_phase_position]="pass"
  return 0
}

pnpm_install() {
  local directory="$1"
  if [[ "$skip_install" -eq 1 ]]; then
    return 0
  fi
  if [[ "$directory" == "." ]]; then
    run_step "Install app dependencies" \
      "${package_manager_command[@]}" install --frozen-lockfile
    return $?
  fi
  run_step "Install $directory dependencies" \
    "${package_manager_command[@]}" --dir "$directory" install --frozen-lockfile
}

phase_frontend_smoke() {
  pnpm_install "." || return 1
  run_step "Build desktop frontend" "${package_manager_command[@]}" build || return 1
  run_step "Test critical frontend paths" "${package_manager_command[@]}" test || return 1
  return 0
}

phase_rust_smoke() {
  if [[ "$skip_sidecars" -eq 0 ]]; then
    run_step "Stage CLI sidecar" bash scripts/build-sidecars.sh || return 1
  fi
  run_step "Check Rust formatting" cargo fmt --all -- --check || return 1
  run_step "Lint the Rust workspace" \
    cargo clippy --workspace --all-targets --all-features -- -D warnings || return 1
  run_step "Test the dopedb library" cargo test --package dopedb --lib || return 1
  run_step "Test the protocol golden contract" \
    cargo test --package dopedb-protocol --test golden || return 1
  run_step "Test the CLI terminal session end to end" \
    cargo test --package dopedb-cli --test terminal_session_e2e || return 1
  run_step "Test release updater verification" \
    cargo test --package release-updater-verify || return 1
  return 0
}

phase_provider_postgres() {
  pnpm_install "workspace-cloud" || return 1
  run_step "Build the Workspace Worker without production secrets" \
    "${package_manager_command[@]}" --dir workspace-cloud build:cloudflare || return 1
  run_step "Build the Workspace identity Worker" \
    "${package_manager_command[@]}" --dir workspace-cloud build:identity || return 1
  run_step "Dry-run the Workspace Worker deploy" \
    "${package_manager_command[@]}" --dir workspace-cloud exec wrangler deploy --dry-run || return 1
  run_step "Verify the native Workspace D1 runtime" \
    "${package_manager_command[@]}" --dir workspace-cloud exec node scripts/check-d1-runtime.mjs || return 1
  run_step "Test production D1 migrations and atomic Workspace journeys" \
    bash scripts/test-provider-import-d1.sh || return 1
  run_step "Verify Cloud SQL setup preserves application access" \
    node scripts/test-gcp-schema-policy.mjs || return 1
  return 0
}

phase_analytics_cloudflare() {
  pnpm_install "product-analytics-cloudflare" || return 1
  run_step "Type-check the analytics Worker" \
    "${package_manager_command[@]}" --dir product-analytics-cloudflare build || return 1
  run_step "Test the analytics Worker public contract" \
    "${package_manager_command[@]}" --dir product-analytics-cloudflare test || return 1
  run_step "Dry-run the analytics Worker deploy" \
    "${package_manager_command[@]}" --dir product-analytics-cloudflare exec wrangler deploy --dry-run || return 1
  return 0
}

phase_scheduler_cloudflare() {
  pnpm_install "workspace-scheduler-cloudflare" || return 1
  run_step "Type-check the scheduler Worker" \
    "${package_manager_command[@]}" --dir workspace-scheduler-cloudflare build || return 1
  run_step "Test the scheduler Worker" \
    "${package_manager_command[@]}" --dir workspace-scheduler-cloudflare test || return 1
  run_step "Dry-run the scheduler Worker deploy" \
    "${package_manager_command[@]}" --dir workspace-scheduler-cloudflare exec wrangler deploy --dry-run || return 1
  return 0
}

phase_site_build() {
  pnpm_install "site" || return 1
  run_step "Build the marketing Worker" \
    "${package_manager_command[@]}" --dir site build:cloudflare || return 1
  run_step "Dry-run the marketing Worker deploy" \
    "${package_manager_command[@]}" --dir site exec wrangler deploy --dry-run || return 1
  return 0
}

dispatch_phase() {
  case "$1" in
    frontend-smoke) phase_frontend_smoke ;;
    rust-smoke) phase_rust_smoke ;;
    provider-postgres) phase_provider_postgres ;;
    analytics-cloudflare) phase_analytics_cloudflare ;;
    scheduler-cloudflare) phase_scheduler_cloudflare ;;
    site-build) phase_site_build ;;
    *)
      printf 'No runner for phase: %s\n' "$1" >&2
      return 1
      ;;
  esac
}

# --------------------------------------------------------------------- main --

if [[ "$run_preflight" -eq 1 ]]; then
  if ! run_preflight_checks; then
    exit 1
  fi
else
  if [[ -n "${PNPM:-}" ]]; then
    # Word splitting is intended: PNPM may be "corepack pnpm".
    # shellcheck disable=SC2206
    package_manager_command=($PNPM)
  elif command -v pnpm >/dev/null 2>&1; then
    package_manager_command=(pnpm)
  else
    package_manager_command=(corepack pnpm)
  fi
fi

if [[ "$preflight_only" -eq 1 ]]; then
  exit 0
fi

started_at="$SECONDS"
failed_phases=0
position=0
while [[ "$position" -lt "${#all_phases[@]}" ]]; do
  phase="${all_phases[$position]}"
  selected="${phase_selected[$position]}"
  position=$((position + 1))
  if [[ "$selected" != "1" ]]; then
    continue
  fi
  if [[ "$fail_fast" -eq 1 && "$failed_phases" -gt 0 ]]; then
    continue
  fi
  begin_phase "$phase"
  phase_started_at="$SECONDS"
  dispatch_phase "$phase" || true
  if ! end_phase "$((SECONDS - phase_started_at))"; then
    failed_phases=$((failed_phases + 1))
  fi
done

printf '\n================================================================\n'
printf '==> Summary\n'
printf '================================================================\n'
position=0
while [[ "$position" -lt "${#all_phases[@]}" ]]; do
  phase="${all_phases[$position]}"
  case "${phase_status[$position]}" in
    pass) printf '  PASS     %-22s %4ss\n' "$phase" "${phase_seconds[$position]}" ;;
    FAIL) printf '  FAIL     %-22s %4ss   %s\n' "$phase" "${phase_seconds[$position]}" "${phase_detail[$position]}" ;;
    *) printf '  skipped  %s\n' "$phase" ;;
  esac
  position=$((position + 1))
done
printf '\nTotal %ss.\n' "$((SECONDS - started_at))"

if [[ "$failed_phases" -gt 0 ]]; then
  printf '%s phase(s) failed.\n' "$failed_phases" >&2
  exit 1
fi
printf 'Every selected phase passed.\n'
