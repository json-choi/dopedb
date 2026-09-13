<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# docs/contracts

## Purpose
Wire and domain contracts shared across more than one consumer (CLI, Desktop
frontend, Rust core, ACP plugins). Each file is the canonical shape/invariant
reference implementers must match, not an implementation walkthrough.

## Key Files
| File | Description |
|------|-------------|
| `acp-plugin-runtime.md` | Owns the ACP plugin runtime contract: one bundled Node runtime, only first-party Claude/Codex adapters, with `runtime-catalog.json` (`src-tauri/resources/agent-runtime/`) as the source of truth for supported Node versions and pinned official download URLs/hashes; caps the installer archive at 60 MiB. |
| `catalog-v2.md` | Owns the Catalog V2 serde contract (canonical source: `dopedb-protocol/src/catalog.rs`); defines `schemaVersion: 2` and lists every consumer that must share one snapshot (CLI, SQL completion, table editor, DDL IR validation, ERD, import mapping). |
| `cli-schema-diff.md` | Owns the `dopedb schema diff` contract: compares two fresh authorized catalogs from the same active Desktop session and reports only structural `added`/`missing`/`changed` differences. |
| `database-capability-matrix.md` | Owns the per-engine capability matrix (PostgreSQL/MySQL/SQLite/MongoDB/BigQuery); `supported` still requires the typed validate/preview/approve/execute pipeline, and `blocked` means fail-closed with no raw-SQL fallback. |
| `feature-flags.md` | Owns desktop feature-activation rules: there is no shared rollout-flag registry; only the documented `DOPEDB_WORKSPACES_ENABLED` process-environment flag exists, and it never substitutes for auth, role, or grant checks. |
| `job-engine.md` | Owns the Durable Job Engine contract: domain/use cases in `src-tauri/src/features/jobs/`, single `JobRepository` boundary for Job state SQL, and the fail-closed rule that MongoDB-family import/export is blocked until a typed document adapter exists. |
| `local-query-results.md` | Owns the local disk-backed SQL result contract: Rust is the sole writer, a result is bound to one immutable operation/workspace/account/connection revision plus a 256-bit capability, and results never enter `app.db`, workspace sync, or audit payloads. |

## For AI Agents

### Working In This Directory
- Changing a contract here requires updating every listed consumer in the same change; these files exist specifically because format drift between consumers is the failure mode.
- Field order and serialization shape mentioned in a contract must match the corresponding Rust `transport.rs` / TypeScript `tauriAdapter.ts` pair exactly (see root `AGENTS.md` IPC rule).

### Testing Requirements
- `pnpm test:rust` exercises the Rust side of these contracts (e.g. `dopedb-protocol` golden tests referenced by `catalog-v2.md`); `pnpm test` covers frontend adapter contract tests.

### Common Patterns
- Contracts state an explicit ownership line ("정본 도메인과 use case는 ...에 있고") naming the single authoritative module before describing the shape.

## Dependencies

### Internal
- `dopedb-protocol/`, `src-tauri/src/features/`, `src/features/*/tauriAdapter.ts`, `dopedb-cli/`.

### External
- None directly; contracts describe existing crate/package boundaries rather than adding new ones.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
