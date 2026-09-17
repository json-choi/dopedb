<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts

## Purpose
Build, check, benchmark, deployment, and release automation invoked through
`package.json` scripts. Files here run in CI and locally; they must not read
production secrets except through the documented owner/keychain wrappers (see
root `AGENTS.md` GitHub identity and release sections).

## Key Files
| File | Description | `package.json` script |
|------|-------------|------------------------|
| `benchmark-data-surfaces.mjs` | Node `--expose-gc` benchmark for in-memory data-surface hot paths using `node:sqlite`. | `benchmark:data-surfaces` |
| `benchmark-packaged-release.mjs` | Drives the packaged `DopeDB Benchmark` app bundle for cold/warm startup and workload timing. | `benchmark:packaged-release` |
| `benchmark-render-hot-paths.mjs` | Boots a Vite dev server to benchmark render hot paths. | `benchmark:render-hot-paths` |
| `build-packaged-benchmark.mjs` | Builds sidecars then packages the benchmark bundle for the current platform. | (invoked by benchmark tooling, not a direct script) |
| `build-sidecars.sh` | Builds native sidecar binaries for the current Tauri target triple; checks the skill bundle first. | `build:sidecars` |
| `cargo-signed-runner.sh` | Cargo-compatible macOS dev runner: builds, applies one stable code identity, then launches the exact binary Tauri would run. | used as `src-tauri` dev runner, not a top-level script |
| `check-architecture.mjs` | Runs the split architecture guard collectors (see `architecture/AGENTS.md`) as one CI contract over a deterministic repository view. | `check:architecture` |
| `check-code-structure.mjs` | Runs the full repository code-structure audit and the CI ratchet against `docs/architecture/code-structure-baseline.json`. | `check:code-structure`, `audit:code-structure` |
| `check-critical-test-budget.mjs` | Enforces the repository's fixed 208-test critical-suite budget. | `check:test-budget` |
| `check-site-deployment.mjs` | Verifies the requested site Worker version has 100% traffic and matches the live production domain. | `site:cloud:verify-deployment` |
| `check-ui-palette.mjs` | Scans `src/` for raw colors outside the design-system semantic token contract. | `check:ui-palette` |
| `check-ui-primitives.mjs` | Scans Desktop, Workspace Web, and site frontend roots for unnamed icon-only controls and inconsistent fixed-density form geometry. | `check:ui-primitives` |
| `check-workspace-deployment.mjs` | Verifies the requested Workspace Cloud Worker version has 100% traffic and matches the live production domain. | `workspace:cloud:verify-deployment` |
| `check-workspace-server-logs.mjs` | Enforces that server-side logging in `workspace-cloud/` only goes through the allowed log sink. | `check:workspace-logs` |
| `deploy-site-cloudflare.mjs` | Deploys the public site to Cloudflare Workers. | `site:cloud:deploy` |
| `deploy-workspace-cloudflare.mjs` | Builds Workspace Cloud without production values, applies D1 migrations, uploads secrets over stdin, then verifies the exact public Worker version. | (invoked by CI release/deploy jobs) |
| `generate-icons.py` | Regenerates every DopeDB brand asset projection from the approved SVG (see `assets/AGENTS.md`); never redraws the source shape. | `icons` |
| `generate-skill-bundle.mjs` | Generates/validates the packaged skill bundle shipped with the desktop app. | `generate:skills`, `check:skills` |
| `migrate-workspace-service.sh` | Thin wrapper that runs the Workspace Cloud D1 migration script. | `workspace:migrate` |
| `prepare-agent-runtime.mjs` | Prepares/validates the bundled Node agent runtime used by ACP adapters. | `check:agent-runtime` (config-check mode) |
| `sentry-personal.sh` | Runs one Sentry CLI command using the personal token from the macOS login keychain, without modifying the calling shell. | `sign:dev` uses a separate script; this one is invoked directly, not via `pnpm` |
| `tauri.sh` | Wraps `pnpm tauri ...` to give each dev build a distinct app identity and use the stable-signing runner on macOS. | `tauri`, `dev:app` |
| `test-gcp-schema-policy.mjs` | Exercises the production Cloud SQL IAM/schema policy against an isolated PostgreSQL cluster; touches no cloud credentials or real database. | (invoked manually / by CI for GCP policy changes) |
| `test-provider-import-d1.sh` | Runs the production D1 migration entry point against an isolated database. | `bash scripts/test-provider-import-d1.sh` (also called directly per root `AGENTS.md`) |
| `with-gh-owner.sh` | Runs one owner-only GitHub CLI/`git push` operation as the repository owner, then restores the default account even on failure or signal. | `gh:owner`, `gh:restore` |
| `with-repository-owner-identity.sh` | Runs one explicit owner-authored `git commit`/tag without persisting identity to Git config. | `repo:owner-identity` |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `agent-runtime/` | Builds, signs, pins, and verifies the published ACP adapter bundles (see `agent-runtime/AGENTS.md`). |
| `architecture/` | Individual architecture guard collectors invoked by `check-architecture.mjs` (see `architecture/AGENTS.md`). |
| `benchmark/` | Shared runtime/aggregation/utility modules used by the packaged-release benchmark scripts (see `benchmark/AGENTS.md`). |
| `code-structure/` | Source-inventory, metrics, and analysis modules used by `check-code-structure.mjs` (see `code-structure/AGENTS.md`). |
| `issue-review/` | Isolated local-Codex GitHub issue review worker and its policy/schemas (see `issue-review/AGENTS.md`). |
| `release/` | Stable-release draft creation, updater metadata, notarization, and release-notes generation (see `release/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- A script that reads or writes production secrets must go through the documented keychain (`sentry-personal.sh`) or owner-wrapper (`with-gh-owner.sh`, `with-repository-owner-identity.sh`) pattern; do not add a new path that reads a token directly.
- Guard/check scripts (`check-*.mjs`) are meant to fail closed; do not loosen a check to unblock a build without updating the doc that owns the underlying rule (`docs/CODE_STRUCTURE.md`, ADRs, etc.).

### Testing Requirements
- `pnpm build` runs most `check:*` scripts in sequence (see root `package.json`). `pnpm check:test-budget` exercises `check-critical-test-budget.mjs` directly against `tests/critical-test-budget.json`.

### Common Patterns
- Node scripts resolve the repository root via `fileURLToPath(new URL("..", import.meta.url))` rather than `process.cwd()` (see `check-workspace-deployment.mjs`, `deploy-site-cloudflare.mjs`), so they work regardless of invocation directory.

## Dependencies

### Internal
- Invoked by `package.json` scripts and `.github/workflows/*.yml`; several read `docs/architecture/*.json` and `tests/critical-test-budget.json`.

### External
- `@babel/parser` (structural parsing in `check-ui-primitives.mjs`, `architecture/dependency-graph.mjs`), Node built-ins only otherwise.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
