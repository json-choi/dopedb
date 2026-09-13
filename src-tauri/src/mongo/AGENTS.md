<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/mongo

## Purpose

MongoDB document-database adapter, deliberately separate from the sqlx pool
stack (`../connection/pool.rs`). MongoDB has no server-enforced read-only
session equivalent to L2 (`../safety/l2_enforce.rs`), so safety here is
structural: data access happens only through the typed `DocumentQuery` API in
`query.rs`, which calls the driver's `find`/`aggregate`/`count_documents` and
never `run_command`. Users are still advised to grant the DB account a `read`
role, but the client allowlist is not presented as a substitute for that
server-side grant.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Adapter entry point wiring `introspect` and `query`. |
| `introspect.rs` | Collection discovery for the shared Catalog contract: collections map to tables (schema `None`, like SQLite/MySQL), sampled top-level fields map to columns, `listIndexes` maps to indexes exactly, and `estimatedDocumentCount` fills the row estimate — matching the Catalog contract's "statistics, not exact" semantics. Sampled columns are inherently approximate; only `_id` is certain. |
| `query.rs` | Typed, read-only document query path — MongoDB's stand-in for L1+L2. `classify` walks the actual request tree (never raw strings) against a hard aggregation-stage allowlist, recursing into `$lookup`/`$facet`/`$unionWith` sub-pipelines, and fail-safes anything unrecognized to a High-risk write so the L4 gate blocks it. `run` is structurally read-only: it only ever calls the driver's typed `find`/`aggregate`/`count_documents`, never `run_command`. |

## For AI Agents

### Working In This Directory

- Never call the MongoDB driver's `run_command` (or any other command that
  bypasses `find`/`aggregate`/`count_documents`) from this module — that
  escape hatch is exactly what the structural read-only boundary depends on
  not existing here.
- A new aggregation stage must be added to `classify`'s allowlist explicitly;
  an unrecognized stage must keep fail-safing to a High-risk write, not
  silently pass through as a read.
- Sampled columns from `introspect.rs` are approximate by construction — do
  not present them to the user as an exact schema the way a SQL engine's
  `information_schema` columns are.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); no dedicated `#[cfg(test)]` block here today.

## Dependencies

### Internal

- Implements the same Catalog/`DocumentQuery` contracts consumed by
  `../features/catalog` and `../features/documents`; participates in the
  `../safety` L1/L4 flow via `query.rs`'s own classification.

### External

- `mongodb` (official Rust driver), `futures`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
