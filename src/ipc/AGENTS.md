<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/ipc

## Purpose
The typed Tauri IPC boundary between the frontend and the Rust core. `core.ts`
wraps every `invoke` call site; `types.ts` is the public shared-contract
facade re-exported to the rest of the app; `generated/` holds the DTOs that
`ts-rs` generates directly from the Rust `serde` structs/enums that produce
them, so the wire shape is checked in and reviewable as a diff. Frontend
`features/<feature>/tauriAdapter.ts` files are the callers of this layer; they
must keep serialization shape and field order in sync with the matching Rust
`features/<feature>/transport.rs`.

## Key Files
| File | Description |
|------|-------------|
| `core.ts` | The application-owned `invoke`/`Channel` boundary. Production calls pass straight through to `@tauri-apps/api/core`'s `invoke`; only under the isolated packaged benchmark build does it also record aggregate duration/count via `recordBenchmarkIpc`, without mutating any private Tauri window internals. |
| `types.ts` | Public shared-contract facade. Re-exports the ts-rs-generated model/protocol/introspection DTOs from `generated/`, plus feature-owned manual transport types that sit outside the generation boundary (explicitly commented as "not a schema-parity claim" where applicable, e.g. `DocumentQuery`). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `generated/` | ts-rs-generated Rust wire contracts (do not hand-edit; see below). |

### `generated/` file reference
| File | Description |
|------|-------------|
| `model.ts` | Generated from `src-tauri/src/model.rs` by ts-rs 12.0.1: core shared model types (e.g. `JsonValue`, `Engine`, `AuditEntry`, `HistoryEntry`, `ConnectionProfile`, `QueryResult`, `SafetySettings`). |
| `protocol-contracts.ts` | Generated from `dopedb-protocol`'s public serde DTOs by ts-rs 12.0.1: cross-process protocol types (`DatabaseEngine`, `OperationState`, `CatalogSnapshot`, `Namespace`, `Relation`, skill lifecycle types). |
| `catalog-feature-contracts.ts` | Generated from `src-tauri/src/features/catalog/domain.rs` by ts-rs 12.0.1: catalog-feature-specific DTOs (e.g. `CatalogOverviewDetailState`). |

## For AI Agents

### Working In This Directory
- Never hand-edit a file under `generated/`; each one's header comment names
  the exact Rust source it mirrors — a wire-format change starts on the Rust
  side and is regenerated via ts-rs, then reviewed as a diff here.
- `types.ts` is a facade, not a free-form re-export surface: keep the
  distinction it already draws between generated (schema-parity) types and
  feature-owned manual transport types, and don't quietly promote a
  feature-local type into looking like a generated one.
- A new IPC command needs matching serialization shape and field order on
  both sides: this directory / `features/<feature>/tauriAdapter.ts` on the
  frontend, `features/<feature>/transport.rs` in `src-tauri/`.
- `core.ts`'s benchmark instrumentation must stay a no-op wrapper in the
  non-benchmark path; do not add production behavior gated only on the
  `VITE_DOPEDB_PACKAGED_BENCHMARK` flag.

### Testing Requirements
- The Rust side of this contract is exercised by `pnpm test:rust`
  (`cargo test --package dopedb-protocol --test golden` covers the DTOs that
  `ts-rs` generates from). No frontend test files exist directly under
  `src/ipc/`; `pnpm build`'s type-check is what catches a drifted consumer.

### Common Patterns
- Each `generated/*.ts` file's first two lines are a fixed-format comment:
  the exact Rust source path and the ts-rs version, followed by "Keep this
  checked-in wire contract synchronized with the Rust DTOs."

## Dependencies

### Internal
- Consumed by every `src/features/<feature>/tauriAdapter.ts` and by
  `src/lib/queries.ts`.
- `core.ts` imports `recordBenchmarkIpc` from `../benchmarks/packagedMetrics`
  (the one place this directory depends on `src/benchmarks/`).

### External
- `@tauri-apps/api` (`invoke`, `Channel`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
