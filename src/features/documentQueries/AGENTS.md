<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/documentQueries

## Purpose

IPC adapter for MongoDB document reads. It reuses the same persisted
propose/consume boundary as SQL reads (`queries`/`operations`) rather than a
separate document-specific approval flow. As its header comment states, there
is intentionally no document *write* transport in the Desktop product — this
feature is read-only.

## Key Files

| File | Description |
|------|-------------|
| `tauriAdapter.ts` | `runDocumentQuery(operationId)`, `proposeDocumentQuery(id, query, origin?)`, and `runDocumentRead(id, query, origin?)` — propose-then-run wrappers over `invoke("propose_document_query"/"run_document_query")`. |

## For AI Agents

### Working In This Directory

- Do not add a document write path here without an explicit product decision —
  the header comment is a deliberate scope boundary, not an oversight.
- New document read operations should extend the existing
  propose/consume shape (`DocumentOperationProposal` → `run`) rather than
  introduce a second pattern.

### Testing Requirements

- No test file here; not part of `pnpm test` or the 208-test budget.

## Dependencies

### Internal

- `src/ipc/types` (`DocumentOperationProposal`, `DocumentPage`, `DocumentQuery`).
- Rust counterpart: no `src-tauri/src/features/document_queries/transport.rs`
  exists; document commands are implemented under
  `src-tauri/src/features/documents/` (`application.rs`, `desktop_run.rs`,
  `desktop_plan.rs`), reached via `src-tauri/src/commands/mod.rs`.

### External

- None beyond the Tauri IPC bridge.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
