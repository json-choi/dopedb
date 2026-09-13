<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/runtime

## Purpose
Startup-mark recording and the packaged desktop-benchmark harness (renderer
performance metrics: React commit timing, long tasks, frame gaps, IPC call
counts/durations, per-action timing breakdowns). This is instrumentation, not a
user-facing feature — it exists to measure the packaged app's real startup and
workload performance from inside the WebView.

## Key Files
| File | Description |
|------|-------------|
| `tauriAdapter.ts` | Records startup marks and drives the packaged benchmark lifecycle (config, prepare workload, compact window, complete/fail) plus the full `PackagedBenchmarkRendererMetrics` shape. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- `PackagedBenchmarkRendererMetrics` is a large, precise wire shape; keep new
  fields consistent with the existing units (`*Ms`, `*Bytes`, `*Count` suffixes)
  and update the matching Rust struct together with this file.
- `failPackagedBenchmark`'s `PackagedBenchmarkFailureReason` union is closed;
  extend it rather than passing a free-form string reason.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- N/A — single-file adapter with no shared internal pattern beyond the wire types.

## Dependencies

### Internal
- None (self-contained instrumentation adapter).

### External
- Rust: no dedicated `features/runtime/` module. `record_startup_mark` is in
  `src-tauri/src/startup.rs`; `packaged_benchmark_config` and the rest of the
  packaged-benchmark commands are in `src-tauri/src/packaged_benchmark.rs`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
