<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# .github

## Purpose
GitHub configuration: code ownership, security-reporting policy, dependency
update automation, and every CI/release/canary workflow. Release and version
files require the repository owner's review (see `CODEOWNERS`), matching root
`AGENTS.md`'s release-governance rules.

## Key Files
| File | Description |
|------|-------------|
| `CODEOWNERS` | Requires the repository owner's review for `/.github/`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `package.json`, `Cargo.lock`, and `src-tauri`'s `Cargo.toml`/`tauri*.json`. |
| `SECURITY.md` | Owns the vulnerability-reporting policy: private GitHub advisories only, security fixes applied to latest stable and `main`. |
| `dependabot.yml` | Security-only grouped updates (`open-pull-requests-limit: 0`) for GitHub Actions and every npm/Cargo project in the repo (root, `workspace-cloud`, `site`, `product-analytics-cloudflare`, `workspace-scheduler-cloudflare`, `agent-runtime/plugins`, and Cargo). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `workflows/` | Every GitHub Actions workflow (listed below; no separate `AGENTS.md` per assignment). |

### Workflows (`workflows/`)
| File | Trigger | Purpose |
|------|---------|---------|
| `acp-adapter-compatibility.yml` | `pull_request`/`push` to `main` on ACP adapter/runtime paths; `workflow_dispatch` | Checks ACP adapter compatibility when adapter plugin, runtime scripts, protocol, or agent-runtime code changes. |
| `acp-adapter-pins.yml` | Weekly `schedule` (`23 4 * * 1`); `workflow_dispatch` | Runs `update-pins` to refresh pinned ACP adapter versions in `agent-runtime/plugins/`. |
| `acp-adapter-release.yml` | `workflow_dispatch` (choose plugin: claude/codex/all; channel: candidate/stable) | `build-sign-publish` job builds, signs, and publishes an ACP adapter bundle; stable promotion requires confirming healthy candidate telemetry. |
| `canary.yml` | `pull_request` (labeled/reopened/synchronize) against `main` | `build` job builds an unprivileged canary installer only for a same-repo `work/<login>/<topic>` PR carrying the `canary` label. |
| `canary-publish.yml` | `workflow_dispatch` (build run ID input) | `validate` then `publish`: publishes only the caller's own successful canary build as an unsigned prerelease, gated by a per-caller environment approval. |
| `ci.yml` | `pull_request`; `push` to `main` | Required-check pipeline: dependency vulnerability scan, frontend smoke tests, Rust smoke tests, provider/Postgres import test, site build, site deploy, analytics/scheduler Cloudflare Worker checks. |
| `codeql.yml` | `pull_request`; `push` to `main`; weekly `schedule` (`23 3 * * 2`) | CodeQL static analysis across JavaScript/TypeScript, Rust, and Actions workflow languages. |
| `packaged-performance.yml` | `workflow_dispatch` only (deliberately no push/PR/schedule) | Manual long-running packaged-app performance benchmark for a chosen scenario and sample counts. |
| `release-cache.yml` | `push` to `main` on `Cargo.lock`/self changes; `workflow_dispatch` | Pre-warms release-profile Rust dependency compilation on `main` under the same cache key `release.yml` uses, since tag-triggered runs cannot see prior tag caches. |
| `release.yml` | `push` of `app-v*` tags | `verify-release` → `publish-tauri` → `finalize-release`: verifies the version, builds/notarizes/staples per-platform installers, then finalizes and publishes the stable release against the pre-created owner draft. |

## For AI Agents

### Working In This Directory
- Do not add a workflow trigger that lets GitHub Actions create or bypass the owner-only tag ruleset for `release.yml`; `create-stable-draft.sh` (`scripts/release/`) is the only path that creates the draft/tag.
- `packaged-performance.yml` must stay `workflow_dispatch`-only per its own in-file comment; do not add push/PR/schedule triggers.
- `canary.yml`/`canary-publish.yml` must keep the build/publish split and the unprivileged, label-gated, caller-scoped-environment model described in root `AGENTS.md`.

### Testing Requirements
- Workflow changes are validated by GitHub Actions itself on the next run; there is no local workflow test harness in this repository.

### Common Patterns
- Every workflow sets an explicit `concurrency.group` and a minimal `permissions:` block (often `contents: read` only, or `permissions: {}` for canary jobs that need none by default).

## Dependencies

### Internal
- References `scripts/release/*`, `scripts/agent-runtime/*`, `scripts/architecture/release-workflow-guards.mjs`, `.release/macos-distribution.json`, `.release-notes/`.

### External
- GitHub Actions marketplace actions pinned by commit SHA (e.g. `actions/checkout`, `github/codeql-action`, `google/osv-scanner-action`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
