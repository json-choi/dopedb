<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/executor

## Purpose

Query executor: the last stage of the SQL pipeline. It assumes `../safety`'s
L1 already classified the statement and L4 already decided whether it may
run. It dispatches to the read path (L2 read-only pool) or the guarded write
path, and owns cancellation/timeout — nothing here re-decides whether a
statement is allowed to execute. A target mutation additionally requires the
unforgeable `ExecutionGrant` issued by `../operations`'s durable Operation
Runtime; L3 EXPLAIN-only impact previews live in `../safety/l3_preview.rs`,
not here.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Dispatch entry point: routes an already-classified statement to `read` or `write`. |
| `cancel.rs` | Process-wide query cancellation plus a wall-clock guard. `guard` races the query future against a wall-clock timeout and an on-demand cancel signal keyed by the frontend's `query_id` inside a `tokio::select!`; on cancel/timeout the query future is dropped mid-flight. Executors hold their pooled connection in `AbandonClosingConnection`, which closes the socket when its future is abandoned (sqlx would otherwise drain the abandoned statement before reusing the connection while the server kept running it); callers `release()` it after awaiting their whole statement sequence. PostgreSQL 14+ pools set `client_connection_check_interval`, so the server aborts the abandoned statement. |
| `read.rs` | Read path (L2 read-only pool). Executes a `SELECT` against the connection's read-only, L2-enforced pool and maps rows dynamically to JSON. sqlx has no single dynamic-row API across engines (`PgRow`/`MySqlRow`/`SqliteRow` carry different `Column`/`TypeInfo` types), so the per-engine mappers here are unavoidable duplication rather than a missing abstraction. The mappers and `stream_capped` are `pub(crate)` and reused by `../safety/l2_enforce.rs` so every read path decodes a cell identically. A namespaced PostgreSQL read sends `BEGIN READ ONLY; SET LOCAL search_path …` as one simple-protocol message and a raw `ROLLBACK`; `finish_read` returns a connection to the pool only when its session is idle, so a capped read (unread rows) or any failure inside that transaction closes the connection instead of draining the rest of the result. |
| `read_values.rs` | Lossless JSON decoding for PostgreSQL, MySQL, and SQLite row values (e.g. `NUMERIC`/`MONEY` as exact strings, per the repository-wide convention). |
| `read_pg_wire.rs` | PostgreSQL binary wire decoding with checked arithmetic for the values SQLx would lose or panic on: timestamp/date infinities and out-of-range instants, `24:00:00`, NUMERIC beyond 28 digits, REAL, non-finite floats, MONEY scale, JSON numbers beyond 2^53, empty ranges, and arrays of any dimension. An unrepresentable value becomes per-cell failure metadata, never a panic or a silently changed value. |
| `read_session.rs` | Per-pool presentation facts (PostgreSQL MONEY scale from `lc_monetary`, the session time zone's fixed offset) probed once per pool outside any read transaction; a probe a compatible engine rejects falls back to defaults and never aborts the read. Desktop, manual-transaction, Terminal/Agent, and Analysis Article reads decode with the same facts. |
| `read_page_budget.rs` | Streamed page budget: the page envelope (column names, identity) and each row's failure metadata are counted before rows, and the largest cells of an oversized row become bounded text previews reported with their original size, so a wide result or one huge value cannot fail a whole result and copy/export refuse the incomplete value. A row that still cannot fit fails with the typed `resultRowTooLarge`. |
| `write.rs` | Write path (Phase 3). Only reachable after L4 approval **and** with the connection's `allow_writes` gate on. Runs the statement inside `BEGIN..COMMIT` on the read-write pool and reports exactly how many rows committed. |
| `namespace.rs` | Engine-aware SQL namespace validation and PostgreSQL transaction context shared by the read/write paths. |

## For AI Agents

### Working In This Directory

- Do not add a new authorization check here that duplicates or second-guesses
  `../safety`'s L1/L4 decisions — this module trusts that input and only adds
  cancellation, timeout, and the write-path transaction/gate check.
- The write path must remain reachable only with both an approved L4 decision
  and the connection's `allow_writes` gate on; do not add an alternate write
  entry point that skips either check.
- Reuse `read.rs`'s per-engine row mappers and `stream_capped` for any new read
  surface instead of writing a new per-engine decoder — `l2_enforce.rs`
  already depends on sharing exactly these mappers.
- Any new column type decoding belongs in `read_values.rs` and must preserve
  the lossless-string convention for `NUMERIC`/`MONEY`.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block in this module today (row-decoding and gating behavior is exercised via `../safety`'s and the feature layer's tests).

## Dependencies

### Internal

- Consumes decisions from `../safety` and execution grants from
  `../operations`; used by `../features/queries` and `../commands`
  (`run_document_query`, `run_script`).

### External

- `sqlx`, `tokio`, `chrono`, `serde_json`, `uuid`, `futures`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
