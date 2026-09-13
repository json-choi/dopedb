<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/safety

## Purpose

The 4-layer SQL safety engine. Governing principle: **L1 is a UX pre-filter;
L2 (the database's own read-only session) is the authoritative security
boundary.** A parser cannot see through functions, writable CTEs, or dialect
quirks, so nothing in this module trusts the parsed classification alone —
every read runs inside a DB-enforced read-only session that rejects a write
even when L1 misclassified it.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Module overview and re-exports of `l1_parse`, `l2_enforce`, `l3_preview`, `l4_gate`. |
| `l1_parse.rs` | L1 — parse & classify (UX pre-filter, not authoritative). `> 1` top-level statement → High risk / `Write` (stacked-injection guard); `Query` bodies are recursed for DML CTEs, reclassifying the whole statement to `Write` if one is found; `UPDATE`/`DELETE` with no `WHERE` → `no_where` + High risk; any parse error or ambiguity fails safe to `Privilege`/High risk rather than an `Err`, since an unknown statement must not inherit the narrower data-change credential. |
| `l2_enforce.rs` | L2 — DB-level enforcement, **the authoritative security boundary**. `run_read_only` executes inside a session the database itself constrains to read-only (Postgres: `SET TRANSACTION READ ONLY`, raises SQLSTATE `25006` on write; MySQL: `SESSION transaction_read_only = 1`, raises `1792`), so a write cannot commit even given a misclassification. A rejected write surfaces as a typed `AppError::Blocked`, never a generic DB error. |
| `l3_preview.rs` | L3 — dry-run / impact preview. Reads: `EXPLAIN` only (never executed). Writes: `EXPLAIN` only — no target-mutating statement runs before the exact Operation proposal is approved and an execution grant is issued. DDL/privilege statements get no row-count preview. Never uses `EXPLAIN ANALYZE` for a write, since that would execute it. |
| `l4_gate.rs` | L4 — human approval gate. Produces a `GateDecision`: read-only `SELECT` + `auto_run_reads` → `AutoRun`; write/DDL with `allow_writes` false → `Block`, true → `RequireApproval`; arbitrary privilege SQL → `Block` (narrowly scoped official operations like the `pg_monitor` grant use their own exact Operation service instead); `> 1` statement → always `Block`. This layer only decides — it never touches the database. |

## For AI Agents

### Working In This Directory

- Never let `../executor` or a feature module skip L2 by treating L1's
  classification as sufficient on its own — L1 exists to drive UX (badges,
  warnings), not to authorize execution.
- A new fail path in `l1_parse.rs` must fail toward `Privilege`/High risk, not
  toward a permissive default, per the "fail safe" contract already documented
  there.
- `l3_preview.rs` must never use `EXPLAIN ANALYZE` on a write path — that
  actually executes the statement, defeating the point of a preview.
- Arbitrary privilege SQL stays blocked at L4; a new narrowly-scoped official
  operation (like `pg_monitor`) gets its own exact Operation in
  `../operations`, not a widened L4 allowance.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`) runs this module's
  tests. Three files here are budget-protected under the repository's
  208-test cap (`tests/critical-test-budget.json`): `l1_parse.rs` (14 tests —
  classification/fail-safe invariants), `l2_enforce.rs` (4 tests — DB-level
  read-only rejection), and `l4_gate.rs` (7 tests — gate-decision matrix). A
  new test here must replace a lower-value existing test rather than raise the
  cap; run `pnpm check:test-budget` after a test change.

## Dependencies

### Internal

- Called by `../executor` (which assumes L1 already classified the statement
  and L4 already decided whether it may run) and by `../mongo/query.rs` for
  its structural L1/L4 analogue.

### External

- `sqlparser` (per-engine dialect parsing), `sqlx`, `serde`, `tokio`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
