<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/operations

## Purpose

The authoritative Operation Runtime. Adapters may request state transitions
(propose, approve, reject, claim, complete), but only this module decides
whether a stored operation may actually change state, and only this module
can hand out the opaque `ExecutionGrant` that lets `../executor` perform a
target mutation. The grant is deliberately unconstructible outside this
module — `operations/mod.rs` enforces that with a `compile_fail` doctest
attempting `use app_lib::operations::ExecutionGrant;` from outside the crate.
Covers `repository/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Public module surface; documents and enforces the unconstructible `ExecutionGrant` contract. |
| `model.rs` | Internal durable Operation models. Intentionally not Tauri or broker response DTOs — adapters receive separately redacted projections and can never construct an execution grant from a deserialized request. |
| `state_machine.rs` | Pure Operation lifecycle transition validation (no I/O). |
| `context.rs` | Scope-derived operation policy and actor context. These functions belong to the Operation boundary rather than any individual application service; they derive immutable policy/identity values from one authority pin and never perform I/O. |
| `canonicalize.rs` | Versioned canonical JSON encoding for immutable Operation payloads and ledger records. Object keys are recursively sorted before compact serialization so a semantically identical request always receives the same SHA-256. |
| `execute.rs` | The opaque `ExecutionGrant` type itself — issued only after the durable Operation projection has been atomically claimed; adapters cannot deserialize or construct it. |
| `runtime.rs` | Process-wide Operation Runtime facade. Owns the runtime identity and is the only production path that can turn an immutable stored plan into an opaque execution grant. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `repository/` | SQLite operation persistence, split by lifecycle responsibility (see below). |

`repository/mod.rs`: splits persistence into `planning` (insertion + immutable
lookup), `approval` (exact approve/reject decisions), `lifecycle` (compare-
and-swap execution claims and transitions), `projection` (row projection,
canonical payload validation, event hashing), `ledger` (append-only event
ledger + hash-chain verification), and `recovery` (runtime-restart recovery
and the transactional transition primitive). The repository remains the
single writer for operation projections and ledgers; each child module owns
one cohesive part of the durable state machine.

## For AI Agents

### Working In This Directory

- Never widen `ExecutionGrant`'s visibility or add a second way to construct
  one. The whole safety argument for target mutations rests on this type only
  coming from a runtime-claimed operation.
- A new operation type must go through `canonicalize.rs`'s canonical JSON
  encoding for its payload hash — do not hand-serialize a payload for hashing
  elsewhere, or two semantically identical requests could hash differently.
- `repository/` is the single writer for operation projections and the
  ledger; do not add a second write path (e.g. a feature writing operation
  rows directly via `../store`) — request a transition through `runtime.rs`
  instead.
- `context.rs` functions must stay I/O-free and derive only from an existing
  authority pin — do not add a database call into this module.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`) runs this module's
  tests. Two files are budget-protected under the repository's 208-test cap
  (`tests/critical-test-budget.json`): `canonicalize.rs` (3 tests — canonical
  hash stability) and `state_machine.rs` (5 tests — lifecycle transition
  validity). A new test here must replace a lower-value existing test rather
  than raise the cap; run `pnpm check:test-budget` after a test change.

## Dependencies

### Internal

- Persists through `repository/` into `../store`'s `app.db`; consumed by
  `../executor` (execution grants), `../safety/l4_gate.rs` (approval
  decisions), and feature modules that propose operations (e.g.
  `../features/operation_control`).

### External

- `sqlx`, `sha2` (canonical payload hashing), `chrono`, `uuid`, `thiserror`,
  `tokio`, `dopedb-protocol`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
