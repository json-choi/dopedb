<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-protocol

## Purpose
Transport-independent Rust crate defining the versioned local IPC and catalog
contracts shared by DopeDB Desktop and `dopedb-cli`. This is a public wire
contract: it deliberately has no database, credential-store, Tauri, or network
dependency, so an adapter built on it cannot accidentally become a second
execution path. Every request/response DTO, error code, and framing limit that
crosses the Desktop↔CLI or Desktop↔Cloud boundary is defined here first.

## Key Files
| File | Description |
|------|-------------|
| `Cargo.toml` | Library crate `dopedb-protocol`, no default dependency on any Desktop/CLI runtime crate — only `serde`, `serde_json`, `chrono`, `sha2`, `thiserror`, `uuid`, `zeroize`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | All DTOs, command specs, and versioning constants (see `src/AGENTS.md`). |
| `tests/` | Golden wire-contract tests and their fixtures (see `tests/AGENTS.md`, which also documents `tests/fixtures/`). |

## For AI Agents

### Working In This Directory
- **This crate is a public wire contract.** Changing a serialization shape (field name, order, or type) is a breaking change: it requires updating the matching JSON file(s) under `tests/fixtures/` and the corresponding frontend (`src/features/<feature>/tauriAdapter.ts`) and Rust (`src-tauri/src/features/<feature>/transport.rs`) adapters in the same change. See root `CLAUDE.md` for the IPC field-order rule.
- Keep this crate free of Tauri, SQLx, keychain, or network dependencies — that boundary is what lets `dopedb-cli` depend on it without pulling in Desktop internals.
- `NUMERIC`/`MONEY`-shaped values serialize as strings (root `CLAUDE.md`); preserve that convention in any new catalog/value DTO.

### Testing Requirements
- `cargo test --package dopedb-protocol --test golden` — part of `pnpm test:rust`. See `tests/AGENTS.md` for what the golden suite protects.

### Common Patterns
- A domain gets a plain-data file (e.g. `catalog.rs`) plus a `*_command.rs` file defining its `CommandSpec` implementations (e.g. `catalog_command.rs`) — see `knowledge.rs` / `knowledge_command.rs` for the pairing.

## Dependencies

### Internal
- None (leaf contract crate). Consumed by `dopedb-cli` and by `src-tauri` (Desktop core).

### External
- `serde`/`serde_json` (DTO (de)serialization), `chrono` (serde feature, timestamps), `uuid` (serde feature), `sha2` (fixture/content hashing), `thiserror` (typed errors), `zeroize` (serde feature, secret-bearing control-plane fields).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
