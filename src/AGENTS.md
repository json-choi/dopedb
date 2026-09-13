<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src

## Purpose
Frontend root of the Tauri v2 desktop app: React/TypeScript rendered inside a
WKWebView/WebView2 shell, talking to the Rust core in `src-tauri/` over typed
IPC. `App.tsx` is the sole render root (re-exporting `features/appShell/AppShell`);
there is no URL router, so screens are switched by the shell's internal
document/route state, not by path.

## Key Files
| File | Description |
|------|-------------|
| `main.tsx` | Boots the React tree: starts product-analytics and client-monitoring, resolves a `PackagedBenchmarkApplication` instead of the real `App` when `VITE_DOPEDB_PACKAGED_BENCHMARK=1`, wraps everything in `AppProviders`, and records a `first_shell_commit` startup mark after the first two animation frames. |
| `App.tsx` | Re-exports `features/appShell/AppShell` as the default app component; contains no logic of its own. |
| `reactDomClient.ts` | Picks `react-dom/client` normally or `react-dom/profiling` under the packaged benchmark build, so `createRoot` always has one call site. |
| `vite-env.d.ts` | Vite client type reference plus ambient module declarations for `*.css` imports and the `react-dom/profiling` shim. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `assets/` | Bundled local icon assets (agent provider marks, DB engine logos) (see `assets/AGENTS.md`). |
| `benchmarks/` | Packaged-build performance benchmark harness, only active under `VITE_DOPEDB_PACKAGED_BENCHMARK=1` (see `benchmarks/AGENTS.md`). |
| `components/` | Shared UI widgets used across screens/features that sit above the design system (grids cells, confirm buttons, toasts, engine marks) (see `components/AGENTS.md`). |
| `design-system/` | Styling and primitive source of truth: `--ds-*` tokens, Tailwind v4 bridge, and the canonical React primitive library (see `design-system/AGENTS.md`). |
| `features/` | Per-feature domain/state/application/adapter code (see `features/AGENTS.md`). |
| `ipc/` | Typed Tauri command boundary and the ts-rs-generated Rust wire contracts (see `ipc/AGENTS.md`). |
| `lib/` | DOM-free shared logic and the global TanStack Query cache, including i18n (see `lib/AGENTS.md`). |
| `screens/` | Screen-level entry points mounted by the app shell (see `screens/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- Follow the layering in root `CLAUDE.md`/`AGENTS.md`: `screens/` compose
  `features/<feature>/`, which use `components/`, `design-system/`, and `lib/`.
  Backend reads go through TanStack Query options (`lib/queries.ts`), never a
  raw `useEffect` + `invoke`.
- `src/lib/*` is named-export only; elsewhere use a default export when a file
  has one main artifact, named exports otherwise.
- Read `src/design-system/README.md` before touching any TSX, CSS, or
  Tailwind utility anywhere under `src/`.

### Testing Requirements
- `pnpm build` type-checks all of `src/` (`tsc -p tsconfig.node.json && tsc`)
  before bundling with Vite.
- `pnpm test` runs the fixed-budget smoke suite (files listed explicitly in
  `package.json`, currently all under `src/features/`); see
  `tests/critical-test-budget.json` for the 208-test cap.
- `pnpm dev:app` launches the real desktop app for manual verification of UI
  changes.

### Common Patterns
- Tauri v2 event names use `:` as a separator, never `.`.
- `NUMERIC`/`MONEY` values from the backend are serialized as strings to
  preserve precision; do not parse them to `number` for display or editing.

## Dependencies

### Internal
- `src-tauri/` is the Rust counterpart reached exclusively through `ipc/` and
  each feature's `tauriAdapter.ts`.

### External
- `react` / `react-dom` 19, `@tanstack/react-query`, `@tauri-apps/api`,
  `tailwindcss` v4 (via `@tailwindcss/vite`), `@sentry/vite-plugin` (wired in
  `vite.config.ts` at the repo root).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
