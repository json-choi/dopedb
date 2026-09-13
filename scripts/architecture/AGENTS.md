<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/architecture

## Purpose
Individual architecture guard collectors, each checking one layering or
ownership invariant against a deterministic repository view supplied by
`../check-architecture.mjs`. A collector returns diagnostics (strings); it
never mutates the repository.

## Key Files
| File | Description |
|------|-------------|
| `analysis-architecture-guards.mjs` | Checks that Analysis Article code keeps its local-repository, exact-read-execution, and hosted-authority ports independent of SQLite/pool/HTTP/Tauri/`AppState`; also checks that hosted-workspace HTTP responses pass a shared content-type/byte-cap reader before deserialization and that Knowledge wire validation rejects C1 Unicode control characters. |
| `connection-editor-guards.mjs` | Requires the connection-editor controller, footer, general-tab screen, and Rust transport files to exist and stay wired together. |
| `dependency-graph.mjs` | Shared AST-based module-dependency graph builder (parses TS/TSX, resolves local specifiers, finds cycles/paths) used by the other frontend/workspace-cloud guards; not a standalone check. |
| `frontend-architecture-guards.mjs` | The largest guard: enforces that screens are composition leaves that features never reach into, that generic presentation layers stay runtime-agnostic (no Tauri/IPC), that `AppShell` stays a composition root rather than owning connection/query/Action-Search state, and that literal-enum boundaries never silently coerce non-string input. |
| `frontend-dependency-cycles.mjs` | Runs `dependency-graph.mjs` over `src/` and reports any cyclic dependency component found. |
| `i18n-ownership-guards.mjs` | Requires that specific localized editors (row editor, Analysis Article editor) exist, backing the i18n rules in root `AGENTS.md`. |
| `knowledge-architecture-guards.mjs` | Checks Knowledge/Team-Project feature boundaries: bounded local remote-inventory caching must not silently reconcile access authority or mutate grants, long-lived Knowledge work takes dependencies at composition time rather than through a global `AppState` locator, and the ACP session actor stays a single actor with platform concerns pushed to sibling ports. |
| `provider-ownership.mjs` | Requires the provider domain/ports/application/mod Rust modules to exist and checks that provider Tauri commands are only declared in their owning module. |
| `query-central-ipc-ownership.mjs` | Parses frontend source to confirm central query IPC contract types (`RiskLevel`, `Classification`, `PreviewMode`, `PreviewReport`, `SqlInspection`, …) are defined and re-exported only from their single owning module. |
| `query-frontend-ownership.mjs` | Confirms query Tauri commands and query domain/adapter types are used only through their owning frontend modules (`src/features/queries/tauriAdapter.ts`, `domain.ts`) rather than being re-implemented or re-invoked elsewhere. |
| `query-rust-runtime-guards.mjs` | Rust-side counterpart: checks the query feature's production modules, forbids removed runtime patterns, validates runtime-ID conversions, and confirms Tauri command declarations for queries live only in the owning module set. |
| `release-workflow-guards.mjs` | Keeps the stable macOS release sequence fail-closed: verifies `.github/workflows/release.yml` notarizes/staples the final DMG separately after Tauri's own app notarization, via `scripts/release/notarize-macos-dmg.sh`. |
| `repository-identity-guards.mjs` | Checks that the owner-authored commit script (`with-repository-owner-identity.sh`) is the only path used for owner commits, and that the production bundle identifier stays a product-owned namespace (`dev.dopedb.desktop`). |
| `rust-safety-guards.mjs` | Checks Tauri app startup ordering (`AppState::new` before `.setup()`/single-instance plugin) in `src-tauri/src/lib.rs`, and flags `.lock().unwrap()`/`.expect()` calls in production Rust that would panic on a poisoned mutex. |
| `terminal-security-guards.mjs` | Requires `src/features/terminals/PtySurface.tsx` to exist and enforces its terminal-security invariants (backing ADR 0003). |
| `updater-ownership-guards.mjs` | Requires the Settings → Updates screen, updater controller, and `useAppUpdater` hook to exist and stay each other's sole owners. |
| `workspace-cloud-http-guards.mjs` | Builds a Workspace Cloud-scoped dependency graph to enforce zero dependency cycles and zero lib-internal imports reaching through the provider-integration public barrel; also checks Neon operation transport imports. |

## For AI Agents

### Working In This Directory
- A guard collector takes a `harness` (or a destructured subset: `root`, `read`, `readTextFile`, `exists`, `relative`, `walk`, `failures`) supplied by `../check-architecture.mjs`; keep new guards side-effect-free and dependent only on that harness, not on `process.cwd()`.
- Add a new guard here (and register it in `../check-architecture.mjs`) instead of hand-rolling an ownership check inside a feature; this is the single place `pnpm check:architecture` looks.
- Do not weaken a guard to unblock a change; if the underlying rule changed, update the owning ADR/doc first (see `docs/adr/AGENTS.md`, `docs/architecture/AGENTS.md`).

### Testing Requirements
- `pnpm check:architecture` runs every guard in this directory as one CI contract; it is part of `pnpm build`.

### Common Patterns
- Guards that need AST-level precision use `dependency-graph.mjs`'s `@babel/parser`-based utilities rather than regex; simpler existence/text-pattern guards (e.g. `connection-editor-guards.mjs`, `i18n-ownership-guards.mjs`) use plain `exists`/`read`.

## Dependencies

### Internal
- Read by `../check-architecture.mjs`. Checks target `src/`, `src-tauri/src/features/`, `workspace-cloud/`, and `.github/workflows/release.yml`.

### External
- `@babel/parser` (via `dependency-graph.mjs`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
