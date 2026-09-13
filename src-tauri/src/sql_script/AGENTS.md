<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/sql_script

## Purpose

SQL script scanning shared by the SQL screen's multi-statement executor. The
scanner is deliberately syntax-light: it only locates top-level statement
boundaries while preserving quoted strings, dollar quotes, and comments — it
does not parse or validate SQL (that is `../safety/l1_parse.rs`'s job).

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `split_statements` splits a script into top-level statements per `Engine` (MySQL honors backslash escapes in quoted literals by default; PostgreSQL/SQLite use a plain doubled-quote scan). `statement_position` locates an already-split statement's 1-based Unicode-character offset in the original script, matching PostgreSQL's own error-position convention, without being confused by repeated text inside literals. |

## For AI Agents

### Working In This Directory

- This module must stay syntax-light and engine-boundary-only (statement
  splitting + position lookup). Statement classification and safety decisions
  belong in `../safety`, not here.
- `statement_position` intentionally returns Unicode character offsets, not
  byte offsets — keep that convention if extending it, since it must match
  PostgreSQL's own error-position semantics for the UI to point at the right
  character.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- `../model::Engine` (per-engine escape-handling switch). Used by the
  multi-statement run path (`run_script`/`propose_script` in `../commands`).

### External

- None beyond the standard library.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
