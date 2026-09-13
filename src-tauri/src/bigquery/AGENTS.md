<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/bigquery

## Purpose

BigQuery read adapter backed by Google's official `bq` CLI. Authentication
remains owned by the official Google Cloud CLI inside an exact app-selected
Workspace/member scope — DopeDB never calls Google's API directly, per the
repository-wide "official CLI only" provider rule. SQL is sent over stdin
(never argv), every read is server dry-run first, and the real job carries a
byte-billing ceiling plus an exact id for cancellation. Covers `onboarding/`
inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Adapter entry point: dry-run-then-execute query flow, byte-billing ceiling, job cancellation by exact id. |
| `connection.rs` | BigQuery connection query, catalog, cancellation, and bounded CLI execution (546 lines). |
| `contract.rs` | BigQuery CLI response parsing and profile/query validation (423 lines). |
| `executable.rs` | Audited, app-managed BigQuery SDK entrypoints and bounded process I/O. |
| `runtime.rs` | App-owned Google Cloud CLI runtime for BigQuery (712 lines; also the parent module for `runtime_archive.rs` and `runtime_installation.rs`, which it includes via `#[path]` as submodules `archive`/`installation`). DopeDB still delegates every Google request and login to Google's unmodified `gcloud`/`bq` entrypoints; this module only removes the prerequisite that a member install those tools globally — it downloads one pinned official archive (`.tar.gz` via `flate2`+`tar`, or `.zip` on Windows), verifies its exact size and SHA-256, extracts into a private staging directory, probes both entrypoints, then publishes the runtime atomically. |
| `runtime_archive.rs` | Bounded BigQuery SDK archive extraction and layout validation (submodule of `runtime.rs`, not declared in `mod.rs`). |
| `runtime_installation.rs` | Managed BigQuery runtime marker verification and command environments (submodule of `runtime.rs`, not declared in `mod.rs`). |
| `onboarding.rs` | BigQuery connection onboarding through the official Google Cloud CLI. Browser OAuth and service-account credential import stay inside `gcloud`; Desktop receives only authentication availability and bounded resource identifiers, while `bq` remains the sole process that talks to BigQuery. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `onboarding/` | Onboarding-specific CLI profile storage and bounded process execution (see below). |

`onboarding/auth_storage.rs`: app-owned Google Cloud CLI profile storage for
BigQuery onboarding. Google sign-in state is isolated by the active DopeDB
Workspace member, service-account state is narrowed to one exact connection
binding, and this module owns filesystem validation/cleanup only — it never
parses or returns credentials itself. `onboarding/process.rs`: the bounded
execution boundary for official `gcloud`/`bq` onboarding commands.

## For AI Agents

### Working In This Directory

- Never call a Google Cloud API directly from this module — every request
  must go through the official `gcloud`/`bq` CLI binaries, matching the
  repository-wide provider-traffic rule (see root `AGENTS.md`/`CLAUDE.md`).
- SQL sent to `bq` must go over stdin, not argv, to avoid leaking the query
  text into process listings.
- A real (non-dry-run) job must carry both a byte-billing ceiling and an exact
  cancellable job id — do not add a query path that skips the dry-run
  pre-check.
- `runtime.rs`'s archive download must keep verifying exact size and SHA-256
  before extraction, and must publish the extracted runtime atomically (no
  partially-extracted runtime should ever be probed as ready).
- `onboarding/auth_storage.rs` must never parse or return a credential; it
  only validates/cleans up filesystem state. Credential handling stays inside
  `gcloud` itself.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); `mod.rs`, `contract.rs`, `runtime.rs`, and `onboarding.rs` hold `#[cfg(test)]` blocks not separately tracked in `tests/critical-test-budget.json`.

## Dependencies

### Internal

- Implements `../driver`'s BigQuery adapter contract and `../introspect`'s
  Catalog contract (`DbPool::Bigquery` in `../introspect/mod.rs`); exposed to
  the frontend via `../features/connections/transport.rs` (BigQuery auth/
  discovery commands listed in `../lib.rs`).

### External

- `reqwest` (rustls) for the archive download, `flate2` + `tar` for
  `.tar.gz` extraction and `zip` for the Windows archive, `sha2` (archive
  verification), `semver`, `serde`/`serde_json`, `tokio`, `futures`, `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
