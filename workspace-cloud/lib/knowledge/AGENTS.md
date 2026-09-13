<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib/knowledge

## Purpose
Project Knowledge: the source-repository side of the Agent's exact grant. This directory owns
GitHub App installation/token minting, tenant-scoped project/source/graph inventory reads, exact-
commit source-revision bookkeeping for webhook deliveries, account-backed Personal Workspace
Knowledge scope, and read-only source browsing. It never receives or stores local folder paths,
database records, or credentials, and graph construction itself is intentionally out of scope here
(source-revision advancement and graph building are kept separate).

## Key Files
| File | Description |
|------|-------------|
| `github-app.ts` | Read-only GitHub App boundary: mints per-request installation tokens in function-local memory; tokens are never returned or stored. |
| `inventory.ts` | Shared, tenant-scoped Knowledge inventory reads so Desktop can load projects and sources behind one authorization check. |
| `mutation-authority.ts` | Revalidates Knowledge write authority inside the same D1 batch that changes durable state, closing the gap between an HTTP check and a later write after provider or GitHub I/O. |
| `personal-scope.ts` | Account-backed Personal Workspace Knowledge authority; never receives local folder paths, database records, or credentials. |
| `project-store.ts` | Project and Environment mutations; authority is checked inside each atomic D1 batch. |
| `source-browser-application.ts` | Application-level source browsing: resolves the environment/source/installation chain behind one authorization check. |
| `source-browser.ts` | Pure bounds contract for source browsing (max query bytes, max matches, max file/text bytes, max manifest size) and the manifest file shape. |
| `source-revisions.ts` | Exact-commit GitHub source revision updates; webhook deliveries advance only the pinned commit, graph construction stays outside this path. |

## For AI Agents

### Working In This Directory
- `mutation-authority.ts`'s pattern — revalidate authority inside the same D1 batch as the write — must be reused by any new Knowledge mutation; do not authorize once at the route boundary and mutate later.
- `github-app.ts` tokens are function-local and short-lived; never persist one or return it to a client.
- `personal-scope.ts` is the account-backed (not device/local) Personal Workspace boundary — it must stay free of local filesystem paths, database records, and credentials per its own header comment.
- `source-revisions.ts` only advances the pinned commit; do not fold graph-building logic into this module.

### Testing Requirements
- Exercised indirectly through `../provider-import-postgres-harness/personal-knowledge-scenarios.ts` and `../provider-import-postgres-harness/source-revision-scenarios.ts` (run via `pnpm test:postgres-import`).
- `../d1-route-scenarios.harness.ts` exercises the knowledge environment-connection bind route directly (part of `pnpm test:contracts`).

### Common Patterns
- Read paths (`inventory.ts`, `source-browser-application.ts`) are plain tenant-scoped Drizzle queries through `../db.ts`; write paths (`project-store.ts`, `personal-scope.ts`) go through `../d1/atomic.ts`'s `atomicD1`.

## Dependencies

### Internal
- `../db.ts`, `../d1/atomic.ts`, `../d1/schema/values.ts` for reads and atomic writes.
- `../workspace-permissions.ts` (`WorkspaceCapability`, `WorkspaceRoleName`) for `mutation-authority.ts`'s capability checks.
- `../env.ts` for GitHub App configuration in `github-app.ts`.

### External
- `drizzle-orm` for query construction.
- `node:crypto` (`createHash`, `createHmac`, `createSign`, `timingSafeEqual`, `randomUUID`) for GitHub App JWT signing and constant-time comparisons.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
