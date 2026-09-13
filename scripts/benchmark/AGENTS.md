<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/benchmark

## Purpose
Shared modules consumed by `scripts/benchmark-packaged-release.mjs` to drive
and measure the packaged `DopeDB Benchmark` app bundle described in
`docs/PACKAGED_RELEASE_PERFORMANCE.md`. These are library modules, not
directly-run scripts.

## Key Files
| File | Description |
|------|-------------|
| `packaged-aggregates.mjs` | Turns raw per-run samples into the benchmark's summary aggregates (connections, required actions per scenario, non-visual native actions, workload scenarios). |
| `packaged-runtime.mjs` | Owns launching and driving the packaged Tauri binary under benchmark conditions (markers for fixture/failure/progress state). |
| `packaged-utilities.mjs` | Shared low-level helpers (process spawning, filesystem staging) used by the runtime and aggregate modules. |

## For AI Agents

### Working In This Directory
- These modules must not open the user's real DopeDB data directory, keychain, CLI login, provider account, or a real database, matching the isolation guarantee documented in `docs/PACKAGED_RELEASE_PERFORMANCE.md`.
- Each module exports a factory function that takes a `harness` object rather than reading global state directly; keep new code following that pattern for testability.

### Testing Requirements
- Exercised indirectly through `pnpm benchmark:packaged-release`; not part of the 208-test critical budget. `.github/workflows/packaged-performance.yml` runs it as a manual, non-required workflow.

### Common Patterns
- Factory-function-over-shared-harness pattern: `export function createBenchmark*(harness) { const { ... } = harness; ... }`.

## Dependencies

### Internal
- Consumed by `../benchmark-packaged-release.mjs`.

### External
- Node built-ins only (`node:child_process`, `node:fs/promises`, `node:os`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
