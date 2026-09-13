<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/benchmarks

## Purpose

Checked-in benchmark result/budget artifacts. Each file is generated data, not
code: a `schemaVersion`, a `measurementScope`, an `environment` block
describing the machine it was captured on, and a `methodology` field
documenting exactly what was measured. They exist to give the packaged-release
and rendering-hot-path benchmarks a regression baseline to diff against, not
to be hand-edited.

## Key Files

| File | Description |
|------|-------------|
| `data-surfaces-summary.json` | `sqlite_ipc_renderer_model` scope. In-memory SQLite cursor-list reads using production SELECT shapes and page/preview limits; measures IPC JSON byte size, retained V8 heap after forced GC, and p50/p95 open latency over repeated first-page reads, plus audit full-verification cost. |
| `desktop-streaming-summary.json` | `executor_only` scope. Cold vs. warm SQLite pool query timing measured in fresh subprocesses, comparing materialized `fetch_all` (all rows retained) against bounded page streaming (one page retained); excludes the `DesktopSqlStreamRegistry` pull/ACK and Tauri IPC layers. |
| `packaged-release-budgets.json` | The enforced performance budget for packaged-release user journeys: first-shell-commit and connection-restore p95 latency ceilings, max main-thread long-task and frame-gap durations, max process RSS/webview heap, per-action p95 targets (e.g. SQL editor format at 10k/100k rows), and idle IPC call-rate limits. |
| `packaged-release-summary.json` | A full captured run against those budgets for one build (profile, app version, git commit/dirty flag, OS/CPU/webview versions) with per-journey measured values. Large file (~270 KB); read selectively rather than in full. |
| `render-hot-paths-summary.json` | Renderer hot-path fixture results: streaming batch cadence/row counts, pointer-event handling, and ERD-node rendering timings at a fixed display refresh rate and stream fixture size. |

## For AI Agents

### Working In This Directory

- These are generated outputs of the packaged-release and rendering benchmark
  scripts (see `scripts/benchmark-packaged-release.mjs` and related scripts
  referenced by `packaged_benchmark*.rs` under `../src/`). Regenerate them by
  re-running the producing script; do not hand-edit values.
- `packaged-release-budgets.json` is the one file in this directory that acts
  as a contract (enforced budget) rather than a point-in-time measurement —
  changing its numbers changes what counts as a benchmark regression.

### Testing Requirements

- Not exercised by `pnpm test` or `pnpm test:rust`. They back a separate,
  explicitly invoked packaged-release benchmark flow gated by the
  `packaged-benchmark` Cargo feature (see `../AGENTS.md` and
  `../src/AGENTS.md`).

## Dependencies

None — static JSON data, no imports.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
