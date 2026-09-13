<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src

## Purpose

The `dopedb` crate's Rust source (library name `app_lib`, entry point
`lib.rs::run()`). Wires Tauri plugins, application state, the full
`#[tauri::command]` invoke-handler surface, and the owner-local CLI Broker.
Feature verticals live under `features/`; everything else here is either a
cross-feature engine (safety, executor, operations, driver/introspect/ddl),
shared infrastructure (store, connection, broker, kernel), or process-level
plumbing (state, startup, app_paths). Per the root `AGENTS.md`/`CLAUDE.md`,
feature cores must not reach through this layer to Tauri, SQLx, `Store`,
keychain, network, or the global `AppState` directly — they depend on the
narrower contracts these modules expose.

## Key Files

| File | Description |
|------|-------------|
| `lib.rs` | Crate root. Declares every module, builds the Tauri app (plugins, `AppState`, job/manual-transaction event forwarding, post-paint recovery timer), and lists the entire `invoke_handler` command surface plus graceful-shutdown ordering on `RunEvent::Exit` (desktop streams → manual transactions → terminals → ACP agents → broker → connections). |
| `main.rs` | Binary entry point (`src/main.rs`, `[[bin]] name = "dopedb"`). Suppresses the console window on Windows release builds and calls `app_lib::run()`. |
| `state.rs` | `AppState`: the shared, Tauri-managed struct injected into every command (broker runtime, connection manager, ACP runtime/plugin manager, knowledge watch runtime, operations runtime, application services, skill manager, terminals feature, startup trace). |
| `app_paths.rs` | Application-owned filesystem roots. Production uses standard OS app-data directories; debug builds use an isolated "Dev" directory so DopeDB Dev cannot read/mutate the installed stable app's store, plugins, or secrets; the `packaged-benchmark` feature gets its own isolated root under the OS temp dir. |
| `error.rs` | The crate-wide `AppError`/`AppResult` spine. Every fallible path returns `AppError`, which serializes to `{ kind, message, position? }` for `#[tauri::command]` to hand straight to the frontend. |
| `model.rs` | Shared serde DTOs — the camelCase data contract between the Rust core and the frontend (e.g. `Engine`). Authoritative: feature modules conform to these shapes rather than redefining them. |
| `startup.rs` | Structured process-start telemetry and the post-paint recovery readiness gate exposed to the frontend via `record_startup_mark`. |
| `process_tree.rs` | Cross-platform lifecycle boundary for a spawned CLI process and all of its descendants (used wherever a sidecar/child process tree must be reliably isolated and torn down). |
| `hosted_control_plane.rs` | Shared HTTP mechanics (validated origin, pooled `reqwest` client, bounded common error decoding) for authenticated calls to DopeDB-hosted adapters. Feature adapters own their own routes/DTOs on top of this. |
| `cli_environment.rs` | Shared, credential-free CLI executable discovery (`PATH` resolution against common install locations) for GUI-launched child processes. |
| `cli_install.rs` | Bundled vs. global CLI resolution. The in-app Terminal always resolves the immutable bundled sidecar; a separate explicit user action copies it to the per-user bin directory and optionally adds a managed `PATH` entry. |
| `packaged_benchmark.rs` | Release-profile packaged benchmark transport, inert outside the `packaged-benchmark` feature. Uses an isolated app identity/data root, accepts only numeric renderer measurements, and emits one bounded JSON line — never SQL, rows, prompts, paths, or credentials. |
| `packaged_benchmark_fixtures.rs` | Packaged benchmark fixture (seed connection) preparation, feature-gated. |
| `packaged_benchmark_metrics.rs` | Packaged benchmark scenario/resource/renderer-metric validation, feature-gated. |
| `packaged_benchmark_receipts.rs` | Packaged benchmark backend action receipt construction, feature-gated. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `audit/` | Append-only, hash-chained compliance audit log (see `audit/AGENTS.md`). |
| `bigquery/` | BigQuery read adapter over Google's official `bq`/`gcloud` CLIs, including onboarding (see `bigquery/AGENTS.md`, covers `onboarding/`). |
| `broker/` | Owner-local CLI Broker server shared by the Desktop app and the `dopedb` CLI (see `broker/AGENTS.md`, covers `dispatch/`). |
| `commands/` | Remaining cross-feature `#[tauri::command]` adapters not owned by a feature vertical (see `commands/AGENTS.md`). |
| `connection/` | Live sqlx/BigQuery/Mongo connection pools, OS credential-store secrets, and scope-pinned runtime leasing (see `connection/AGENTS.md`, covers `runtime/`). |
| `ddl/` | Catalog-pinned, dialect-neutral DDL planning and per-engine rendering (see `ddl/AGENTS.md`). |
| `driver/` | Driver registry and runtime dispatch for target-database protocol drivers (see `driver/AGENTS.md`). |
| `executor/` | Query executor: guarded cancellation, the L2 read path, and the approval-gated write path (see `executor/AGENTS.md`). |
| `features/` | Frontend-mirroring vertical feature slices (domain/application/ports/adapters/transport). See `features/AGENTS.md`. |
| `introspect/` | Schema introspection into the shared `Catalog` contract, per engine (see `introspect/AGENTS.md`, covers `pg/`). |
| `kernel/` | Small, platform-independent cross-feature domain primitives and permission types (see `kernel/AGENTS.md`). |
| `mongo/` | MongoDB document-database adapter with a structural (non-pool-based) read-only boundary (see `mongo/AGENTS.md`). |
| `monitoring/` | Read-mostly database health snapshots for Agent query planning (see `monitoring/AGENTS.md`). |
| `operations/` | Authoritative durable Operation Runtime: canonicalization, ledger, lifecycle, execution grants (see `operations/AGENTS.md`, covers `repository/`). |
| `safety/` | The 4-layer (L1–L4) SQL safety engine (see `safety/AGENTS.md`). |
| `services/` | Application feature composition shared by Tauri and the local CLI broker (see `services/AGENTS.md`). |
| `skills/` | Offline, version-matched Skill bundle install/repair manager (see `skills/AGENTS.md`, covers `inventory/`). |
| `sql_script/` | Syntax-light multi-statement SQL script scanner (see `sql_script/AGENTS.md`). |
| `store/` | The local `app.db` SQLite store and its feature-scoped repositories (see `store/AGENTS.md`, covers `repositories/` and `tests/`). |

## For AI Agents

### Working In This Directory

- Module boundaries above are enforced by convention, not the compiler beyond
  `mod`/`pub(crate)` visibility — most modules expose only `pub(crate)` or
  narrower items (e.g. `operations::ExecutionGrant` is unconstructible outside
  `operations/`, enforced with a `compile_fail` doctest in `operations/mod.rs`).
  Preserve that pattern rather than widening visibility to work around it.
- `safety/` (L1–L4) is the SQL security boundary; `executor/` assumes L1
  already classified the statement and L4 already decided whether it may run,
  and adds only cancellation/timeout and the write-path transaction. Do not
  bypass `safety` from a new call site — route through it.
- `state.rs`'s `AppState` is the single Tauri-managed application state;
  commands read/mutate it via the services/features it owns, not by reaching
  around it into raw pools or the store.

### Testing Requirements

- `pnpm test:rust` → `cargo fmt --all -- --check && cargo test --package dopedb --lib && cargo test --package dopedb-protocol --test golden && cargo test --package dopedb-cli --test terminal_session_e2e`. The `--lib` run covers every `#[cfg(test)]` module under this tree.
- Several modules here hold budget-protected tests under the repository's
  208-test cap (`tests/critical-test-budget.json`): `broker/session.rs`,
  `operations/canonicalize.rs`, `operations/state_machine.rs`,
  `safety/l1_parse.rs`, `safety/l2_enforce.rs`, `safety/l4_gate.rs`,
  `store/repositories/analysis_articles.rs`, and
  `store/tests/connections_scope.rs`. A new test in this tree must replace a
  lower-value existing test rather than raise the cap; run
  `pnpm check:test-budget` after a test change.

## Dependencies

### Internal

- `features/` mirrors the frontend's `src/features/<feature>/` layering and is
  the primary consumer of `connection/`, `executor/`, `safety/`, `store/`,
  `operations/`, `introspect/`, `ddl/`, `driver/`, `mongo/`, `bigquery/`, and
  `kernel/`.
- `broker/dispatch/` reuses the same feature-level application logic as
  `lib.rs`'s Tauri command surface so the CLI Broker and the Desktop app stay
  behaviorally identical.

### External

- `tauri` 2, `tokio` (full), `sqlx` 0.9 (postgres/mysql/sqlite), `mongodb`,
  `sqlparser`, `keyring`, `chacha20poly1305`/`subtle`/`zeroize`,
  `agent-client-protocol`, `minisign-verify`, `reqwest` (rustls), `dashmap`,
  `schemars`, `tracing`/`tracing-subscriber`. Full list in `../Cargo.toml`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
