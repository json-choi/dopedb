<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/ddl

## Purpose

Catalog-pinned, dialect-neutral DDL planning. Structured editors submit a
`SchemaChangeRequest`; this module validates it against the exact canonical
Catalog snapshot (`../introspect`) and renders a complete, reviewable plan
without ever executing a target-database mutation itself — execution happens
only after approval, through `../executor`/`../operations`.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Entry point: validates a `SchemaChangeRequest` against the pinned Catalog snapshot and dispatches to the engine-specific renderer. |
| `validate.rs` | Fail-closed validation for Catalog-pinned schema-change requests — rejects a request that does not match the exact snapshot it was planned against. |
| `common.rs` | Shared SQL rendering helpers used by every engine renderer; engine modules own their own capability decisions on top of these. |
| `postgres.rs` | PostgreSQL DDL renderer. |
| `mysql.rs` | MySQL/MariaDB DDL renderer; plans flag statements with implicit-commit behavior explicitly so the UI can warn before running them. |
| `sqlite.rs` | SQLite DDL renderer, including an explicit table-rebuild preview for `ALTER` operations SQLite cannot express directly. |

## For AI Agents

### Working In This Directory

- Never execute a mutating statement from this module — it only plans and
  renders. Actually applying a plan flows through `../operations` and
  `../executor` after approval, per the safety-engine boundary.
- A plan must be validated against the *exact* canonical Catalog snapshot it
  was built from (`validate.rs`); do not relax this to a looser
  name-only match, since that is how a stale-schema DDL plan could silently
  apply against a changed table.
- New engine-specific behavior belongs in that engine's own renderer file, not
  in `common.rs` — `common.rs` is for genuinely shared SQL-fragment helpers.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Consumes Catalog snapshots from `../introspect` (via `../store` caching);
  exposed to the frontend through `propose_table_changes` in `../commands`.

### External

- `dopedb-protocol` (the shared `SchemaChangeRequest`/plan wire types).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
