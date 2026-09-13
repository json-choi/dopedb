<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-protocol/tests

## Purpose
Golden wire-contract test suite for `dopedb-protocol`. Encodes/decodes every
versioned DTO against a checked-in JSON fixture per shape, so a serialization
change (field name, order, type, or added/removed field) is caught here first,
before it silently breaks `dopedb-cli` or the Desktop/Cloud sync path.

## Key Files
| File | Description |
|------|-------------|
| `golden.rs` | Encodes and fail-closed-decodes the public CLI, Cloud↔Desktop sync, managed-lease, and Analysis Article wire contracts against `fixtures/*.json`; also golden-tests the schema-diff JSON shape and its shared Desktop comparison fixture. Imports essentially the full public surface of the crate (commands, DTOs, and every `*_VERSION`/`*_SCHEMA_VERSION` constant) to keep version bumps and fixture updates honest. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `fixtures/` | One checked-in JSON file per golden wire shape, documented inline below (no separate `AGENTS.md`). |

### `fixtures/` (inline — golden wire-contract fixtures)
| File | Description |
|------|-------------|
| `app-open-request.json`, `app-open-success.json`, `app-open-error.json` | `AppOpenCommand`/`AppOpenResult` request and success/error response shapes. |
| `status-request.json`, `status-success.json`, `status-error.json` | `StatusCommand`/`StatusResult` request and success/error response shapes. |
| `version-request.json`, `version-success.json`, `version-error.json` | `VersionCommand`/`VersionResult` request and success/error response shapes. |
| `catalog-snapshot-v2.json` | Catalog V2 snapshot DTO fixture (`catalog::CatalogSnapshot`). |
| `schema-diff-v1.json` | Read-only structural schema-diff output fixture (`schema_diff.rs`). |
| `query-plan-request.json` | `QueryPlanCommand`/`QueryPlanArguments` request fixture. |
| `policy-blocked.json` | A policy-denied broker response fixture (`ErrorCode` / policy-block path). |
| `runtime-discovery.json` | Public, secret-free runtime discovery metadata fixture (`discovery.rs`). |
| `command-catalog-v17.json` | Versioned catalog of every `CommandName`/`CommandSpec` the broker accepts, at command-schema version 17. |
| `cli-command-contract-v14.json` | Versioned CLI command contract fixture, at contract version 14. |
| `control-plane-contracts-v1.json` | Workspace control-plane HTTPS payload contracts fixture (`control_plane.rs`), version 1. |
| `skill-command-contract-v1.json` | Skill bundle/inventory/mutation command contract fixture (`skill_command.rs`), version 1. |
| `graph-build-artifact-v1.json` | Project Knowledge graph-build artifact fixture (`GraphBuildArtifactV1`), version 1. |

## For AI Agents

### Working In This Directory
- A fixture file is the source of truth for a wire shape, not `golden.rs`'s in-memory construction of it — when a DTO's serialization changes intentionally, regenerate/update the matching fixture in the same change as the `src/` edit, and update any dependent frontend (`tauriAdapter.ts`) or Rust (`transport.rs`) adapter at the same time (see `../AGENTS.md`).
- A versioned fixture's filename encodes its schema version (e.g. `command-catalog-v17.json`); a breaking change bumps both the constant in `src/` and the fixture filename rather than editing the existing version in place, so old and new shapes stay diffable.

### Testing Requirements
- `cargo test --package dopedb-protocol --test golden` — part of `pnpm test:rust`. Protects 8 tests in the repository's 208-test critical budget (`tests/critical-test-budget.json`): "Versioned public CLI and Cloud↔Desktop sync, managed lease, and Analysis Article wire contracts with fail-closed decoding; schema diff JSON and shared Desktop comparison fixture." See `../../tests/AGENTS.md` for the budget mechanics.

### Common Patterns
- Each golden test reads a `fixtures/*.json` file, decodes it into the matching Rust type, re-encodes it, and asserts byte-for-byte (or canonical-JSON) equality — see the fixture list above for the file/type pairing.

## Dependencies

### Internal
- `dopedb-protocol` (the crate under test, via `../src/`).

### External
- `serde`, `serde_json` (`json!`/`Value`), `sha2` (content hashing).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
