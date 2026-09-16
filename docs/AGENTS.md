<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# docs

## Purpose
Canonical, sourced-controlled decision documents for DopeDB. Each file owns one
topic; other docs, code, and this hierarchy reference it rather than restating
it. See root `AGENTS.md` / `CLAUDE.md` for the repository-wide product axes and
work-safety rules this directory's files implement in detail.

## Key Files
| File | Description |
|------|-------------|
| `CLOUDFLARE_OPERATIONS.md` | Owns production Cloudflare topology (Workspace, identity, site, scheduler, analytics Workers) and the rule that private production values never enter a build-visible `.env` file. |
| `CODE_STRUCTURE.md` | Owns cohesion-based code-structure review criteria; 300 lines starts a review, it is not a hard split threshold. |
| `DRIVER_ARCHITECTURE.md` | Owns the engine / provider / driver layering model and driver-registry selection order. |
| `GCP_SCHEMA_ACCESS_SAFETY.md` | Owns the safety boundary for managed GCP/PostgreSQL connection setup: never modify pre-existing application users, roles, or ACLs. |
| `GITHUB_ISSUE_GOVERNANCE.md` | Owns the local-Codex issue-review architecture and its execution boundary (implementation: `scripts/issue-review/AGENTS.md`). |
| `LIVE_VALIDATION_RUNBOOK.md` | Owns the manual live-account/device verification runbook for issues automated checks cannot close on their own. |
| `NEON_AUTHENTICATION_DECISION.md` | Owns the decision that Neon management authentication is a workspace-managed integration only, never a Desktop OAuth or API-key form. |
| `PACKAGED_RELEASE_PERFORMANCE.md` | Owns the packaged-app benchmark harness and baseline methodology backing performance claims. |
| `PRODUCT_ANALYTICS.md` | Owns the canonical product-analytics tracking plan: consent boundary, event vocabulary, identity rules, retention. |
| `PRODUCT_POSITIONING.md` | Owns DopeDB's public market category and claim boundary. |
| `PRODUCT_UI_SCOPE.md` | Owns the per-feature UI scope decision table (구현 안 함 / 범위 밖 / 미결) and the product's UI contract. |
| `PROJECT.md` | The single maintained top-level project guide: product summary, current scope, and links to the owning documents. |
| `SENTRY_CREDENTIAL_OPERATIONS.md` | Owns local personal Sentry CLI credential handling and the desktop monitoring project setup. |
| `UI_IMPLEMENTATION_TRACKER.md` | Owns per-screen implementation status (`complete`/`partial`/`missing`/`out-of-scope`) against `PRODUCT_UI_SCOPE.md`. |
| `UI_TEXT_LINE_COLOR_INVENTORY.md` | Owns the per-screen inventory of always/conditionally visible text, retained lines, and allowed colors from the UI cleanup pass. |
| `UI_UX_AUDIT.md` | Owns the closed defects and permanent regression conditions from the full UI/UX audit. |
| `WORKSPACE_ROADMAP.md` | Owns the maintained alpha roadmap for hardening the team workspace; it tracks work, not product scope. |
| `commit.md` | Owns commit message format (Korean Conventional Commits) and author-identity preservation rules. |
| `dependencies.md` | Owns dependency and toolchain policy: Node/pnpm/TypeScript/Rust versions, dependency age, and build-script allowlist policy. |
| `github-account-switching.md` | Owns GitHub account and commit-identity rules, and the owner-only wrapper scripts. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `adr/` | Accepted architecture decision records (see `adr/AGENTS.md`). |
| `architecture/` | Machine-readable architecture baselines consumed by CI guard scripts (see `architecture/AGENTS.md`). |
| `contracts/` | Wire/domain contracts shared across CLI, Desktop, and ACP consumers (see `contracts/AGENTS.md`). |
| `decisions/` | Evidence reports for open repository-owner decisions; they gather measured facts and options without deciding (see `decisions/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- A document here is the single source of truth for its topic. When a decision changes, update the owning document first, then the code or screen that implements it — never the reverse.
- Do not duplicate another document's content; link to it instead.
- `PRODUCT_UI_SCOPE.md`, `PRODUCT_POSITIONING.md`, and accepted ADRs in `adr/` take precedence over any third-party product's screens, feature list, or terminology.

### Testing Requirements
- Documentation-only changes need a diff and link review, not a test run (see root `AGENTS.md` Validation section).

### Common Patterns
- Status/decision-date headers (e.g. `PRODUCT_POSITIONING.md`, ADRs) mark a document as an owned decision rather than a proposal.

## Dependencies

### Internal
- Referenced by `src/`, `src-tauri/`, `scripts/`, and CI workflows in `.github/workflows/` that enforce these decisions programmatically.

### External
- None; these are markdown/JSON documents with no runtime dependency.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
