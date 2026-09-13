<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/audit

## Purpose

Append-only, hash-chained audit log used as the compliance record for
ask/classify/preview/run actions, exposed via `record` and `verify_chain`.
Rows are inserted, never updated or deleted. This is tamper-**evident**, not
tamper-proof: it defends against silent edits, not a determined rewrite with
write access to `app.db` (that needs an external notary or append-only sink).

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Public `record`/`verify_chain` entry points over the append-only audit table. |
| `chain.rs` | Hash-chain primitives: each entry's `hash = SHA256(prev_hash ‖ canonical_row)` over a deterministic serialization of the audited fields, so re-hashing the chain diverges from stored hashes at the first altered row. |

## For AI Agents

### Working In This Directory

- Never add an update/delete path for an audit row. A correction is a new
  row, not a mutation of an old one.
- Any new audited field must be included in the canonical row serialization
  `chain.rs` hashes, or it silently falls outside tamper-evidence.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); this module has no dedicated `#[cfg(test)]` block of its own today.

## Dependencies

### Internal

- Reads/writes through `../store` (the `app.db` audit table); exposed to the frontend via `../commands` (`audit_verify`, `list_audit_page`, `get_audit_entry`).

### External

- `sha2` (hash chaining), `sqlx`, `chrono`, `uuid`, `futures`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
