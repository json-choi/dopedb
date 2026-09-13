<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/benchmarks

## Purpose
The packaged-build performance benchmark harness. It only activates when
`VITE_DOPEDB_PACKAGED_BENCHMARK=1`: `main.tsx` then renders
`PackagedBenchmarkApplication` instead of the real `App`, so these scenarios
measure the actual production bundle/runtime rather than a synthetic test
harness. It must never affect the normal app path when the flag is unset.

## Key Files
| File | Description |
|------|-------------|
| `backend.ts` | Typed `PackagedBackendAction` invocations (e.g. `query-first-batch`, `query-page-store-1m`, `query-start-cancellable-export`) that call into the Rust benchmark backend via `src/ipc/core.ts`. |
| `packagedMetrics.ts` | Metric recording used by both the benchmark harness and, unconditionally at a no-op level, `src/ipc/core.ts` (`recordBenchmarkIpc`) and `main.tsx`/React (`recordReactCommit`, a `ProfilerOnRenderCallback`); includes the guard that detects a renderer that stopped painting. |
| `PackagedBenchmarkApplication.tsx` | Scenario switch: maps a `scenario` string (from `features/runtime/tauriAdapter`'s `packagedBenchmarkConfig()`) to one exported scenario component from `packaged/`, or a `BenchmarkFailure` fallback that reports completion for an unsupported scenario. |
| `PackagedBenchmarkProfiler.tsx` | Wraps its children in a React `Profiler` (`id="dopedb-packaged-root"`) that reports every commit to `recordReactCommit`. |
| `AnalysisPublicationSnapshotScenario.tsx` | Fixed-HTML Analysis Article publication snapshot scenario used for packaged-runtime QA. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `packaged/` | The scenario implementations selected by `PackagedBenchmarkApplication.tsx` (see below); no separate `packaged/AGENTS.md`. |

### `packaged/` file reference
| File | Description |
|------|-------------|
| `AgentScenarios.tsx` | Packaged Agent transcript and Skill lifecycle scenarios (`AgentTranscriptScenario`, `AgentToolsScenario`) — ACP projection and Agent setup accessibility, kept together as one provider-runtime family. |
| `DataScenarios.tsx` | Packaged Explorer, result-grid, and retained-data scenarios (`ExplorerSearchScenario`, `QueryResultScenario`, `LongLivedDataScenario`) sharing a deterministic large-data projection contract. |
| `InteractionScenarios.tsx` | Packaged ERD, grid, pane-resize, and idle-runtime scenarios (`InteractionSurfacesScenario`, `IdleRuntimeScenario`). |
| `SqlScenarios.tsx` | Packaged SQL editing and first-row scenarios (`SqlEditorScenario`, `TableFirstRowScenario`) covering CodeMirror fixture settlement and streamed table evidence. |
| `benchmarkHarness.tsx` | Shared lifecycle and deterministic fixture projection for every scenario module (`BenchmarkSurface`, `finishBenchmark`, and the `preparePackagedBenchmarkWorkload`/`completePackagedBenchmark`/`failPackagedBenchmark` calls into `features/runtime/tauriAdapter`); scenario modules own UI interactions, this file owns measurement setup. |

## For AI Agents

### Working In This Directory
- A new scenario must be added to `PackagedBenchmarkApplication.tsx`'s
  `switch` (by its `scenario` string) or it is unreachable and falls through
  to `BenchmarkFailure`.
- Keep `PackagedBenchmarkApplication.tsx`'s per-scenario code split by family
  file under `packaged/` (Agent/Data/Interaction/Sql) rather than growing one
  monolithic scenario file.
- Any code path here gated on `import.meta.env.VITE_DOPEDB_PACKAGED_BENCHMARK`
  must default to the production behavior when the flag is unset — this
  directory's own imports into `src/ipc/core.ts` and `main.tsx` are the
  exception permitted for benchmark instrumentation, not a general pattern to
  copy elsewhere.

### Testing Requirements
- No `*.test.ts(x)` files exist under `src/benchmarks/`. The relevant checks
  are the `package.json` benchmark scripts: `pnpm benchmark:data-surfaces`,
  `pnpm benchmark:packaged-release`, `pnpm benchmark:render-hot-paths`, and
  `pnpm lint:benchmark` (ESLint over `scripts/benchmark-packaged-release.mjs`
  and `scripts/benchmark/`).

### Common Patterns
- Multi-scenario files open with a short comment naming why the grouped
  scenarios share one file (e.g. `AgentScenarios.tsx`: "ACP projection and
  Agent setup accessibility remain together as one provider-runtime
  benchmark family.").

## Dependencies

### Internal
- `src/ipc/core.ts` (`invoke`) for `backend.ts`.
- `src/features/runtime/tauriAdapter.ts` for benchmark lifecycle calls
  (`packagedBenchmarkConfig`, `completePackagedBenchmark`,
  `preparePackagedBenchmarkWorkload`, `failPackagedBenchmark`,
  `recordStartupMark`).
- `src/design-system/components/*` and `src/design-system/VirtualTreeRows.tsx`
  are exercised directly by several scenarios in `packaged/`.
- `main.tsx` is the sole entry point that conditionally mounts this
  directory's `PackagedBenchmarkApplication`/`PackagedBenchmarkProfiler`.
- `src/ipc/core.ts` imports back from `packagedMetrics.ts`
  (`recordBenchmarkIpc`) — the one reverse dependency from `ipc/` into this
  directory.

### External
- `react`'s `Profiler` (`PackagedBenchmarkProfiler.tsx`).
- `@codemirror/state`/`@codemirror/language` (`SqlScenarios.tsx`, to force
  deterministic parse/settlement timing).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
