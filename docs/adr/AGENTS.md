<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# docs/adr

## Purpose
Accepted architecture decision records. Each ADR owns one irreversible-ish
structural decision and its rationale; it is not a running design-notes log.
See `../AGENTS.md` for how these relate to the other canonical docs.

## Key Files
| File | Description |
|------|-------------|
| `0001-operation-runtime-state.md` | All execution passes through one Operation Runtime; UI, Local Broker, Agent CLI, and Plugin never run a database command directly. First stored state is `planned`; editing drafts are never persisted. |
| `0002-local-broker-protocol.md` | The `dopedb` CLI never opens app SQLite, the credential store, or a DB driver itself; it only speaks a local, length-prefixed JSON IPC protocol to a running Desktop Runtime (Unix socket, Windows named pipe; no loopback HTTP/TCP). |
| `0003-terminal-session-capability.md` | Generic shell DB commands are allowed only inside an in-app Terminal session pinned to a workspace and connection at creation time; it does not retarget when the Workbench connection changes. |
| `0004-feature-slices-and-state-ownership.md` | Organizes new/migrated code by feature slice (domain/state/application/adapter) with a single writer per mutable state, replacing layer-only folders. |
| `0005-tailwind-v4-migration.md` | Migrates accumulated per-screen CSS to Tailwind CSS v4 plus semantic tokens incrementally, rather than replacing all CSS at once. |
| `0006-native-query-cancellation.md` | Defers per-engine native query cancellation; Stop instead cancels via an Operation-Runtime-issued UUID and a process-local cancellation slot checked before connection release. |
| `0007-analysis-article-bi-domain.md` | Analysis Article is a published sanitized-HTML document with exactly one saved read-only query and a Desktop-only manual rerun; this supersedes the earlier block/graph BI composition model and excludes dashboards, transforms, schedules, and signals. |
| `0008-desktop-loopback-pkce-login.md` | Desktop Workspace login uses hosted account approval plus an ephemeral IPv4 loopback callback and PKCE S256; native secrets stay outside the WebView while RFC 8628 remains a compatibility boundary. |

## For AI Agents

### Working In This Directory
- Add a new ADR (next sequential number) for a new structural decision instead of editing an accepted one. If a decision is reversed, add a new ADR that states it supersedes the old one, and update the superseded ADR's status line.
- An ADR here does not override `docs/PRODUCT_UI_SCOPE.md` or `docs/PRODUCT_POSITIONING.md`; product scope decisions live in those files.

### Testing Requirements
- None directly; several ADRs are enforced by guard scripts under `scripts/architecture/` (e.g. `terminal-security-guards.mjs` for ADR 0003, `release-workflow-guards.mjs` touches ADR-adjacent release sequencing) run via `pnpm check:architecture`.

### Common Patterns
- Each ADR states Status, Date, and related product-boundary or plan documents in its header before the Decision section (see `0001-operation-runtime-state.md`).

## Dependencies

### Internal
- Enforced in code by `src-tauri/src/features/` (Operation Runtime, terminals, queries) and checked by `scripts/architecture/*.mjs`.

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
