<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/analysis_articles

## Purpose

Current, one-exact-query Analysis Article definitions: sanitized HTML plus a
saved read-only query, sharing/publication, and a Desktop-only manual rerun.
Per ADR 0007 and `CLAUDE.md`, an Analysis Article is not a dashboard,
transform graph, schedule, or signal system — result rows never leave
Desktop; only definitions and immutable HTML publications are shared through
the hosted control plane.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Analysis Article vertical slice and adapter composition boundary. |
| `domain.rs` | Analysis Article runtime-only values. |
| `facade.rs` | Application facade depending only on feature-owned ports; keeps SQLite, connection runtimes, and hosted HTTP in concrete adapters. |
| `ports.rs` | Adapter-neutral contracts owned by the feature. |
| `runner.rs` | Exact-revision, read-only execution for one current Analysis Article query. |
| `validation.rs` | Runtime validation for the current one-query Analysis Article contract. |
| `desktop_links.rs` | Bounded, token-free navigation inbox; a link never changes account or executes work. |
| `sharing_transport.rs` | Sharing commands; keeps browser links free of credentials and fences account changes. |
| `transport.rs` | Tauri commands for current Analysis Articles; definitions and immutable HTML publications are shared, query results stay in Desktop's local recovery cache. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete Desktop and hosted adapters (SQLite local recovery cache and the authenticated hosted control-plane client). |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete Desktop and hosted adapters for Analysis Articles (module root). |
| `desktop_read.rs` | Exact-scope Desktop read adapter for Analysis Article query nodes. |
| `hosted.rs` | Authenticated Analysis Article control-plane adapter; Bearer sessions and manual-run capabilities stay in Rust, result rows never leave Desktop. |
| `hosted_articles.rs` | Hosted article and immutable publication operations. |
| `hosted_results.rs` | Hosted completion receipts for manual Analysis runs; query rows never leave Desktop, only authority receipts cross this boundary. |
| `hosted_runners.rs` | Hosted runner registration, discovery, and revocation operations. |
| `hosted_runs.rs` | Hosted metadata and authority operations for manual Analysis runs. |
| `hosted_sharing.rs` | Private share links and invitations; the hosted origin and current account own authority. |
| `sqlite.rs` | SQLite-backed local result recovery and manual-run capability identity. |

## For AI Agents

### Working In This Directory

- Never persist or forward a query result row through a hosted adapter; only
  `adapters/sqlite.rs` (local recovery cache) and `runner.rs` (exact-revision
  local execution) may see rows. Hosted adapters carry definitions, HTML, and
  receipts only.
- `desktop_links.rs` links must stay token-free and must not execute work or
  switch account on their own — they only navigate.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `facade.rs` is the single entry point other features/transports use;
  reach Analysis Article behavior through it rather than a concrete adapter.

## Dependencies

### Internal

- Imports `crate::features::knowledge` and `crate::kernel::{access, identity}`.
- Imported by `crate::features::workspaces` (shared-connection/publication
  flows) and `src-tauri/src/store/repositories/analysis_articles.rs` (whose
  result-cache tests are part of the 208-test critical budget, though that
  file lives outside this directory).

### External

- `reqwest` (hosted control-plane HTTP), `sqlx` (local cache), `serde_json`,
  `uuid`, `chrono`.
- Frontend adapter: `src/features/analysisArticles/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
