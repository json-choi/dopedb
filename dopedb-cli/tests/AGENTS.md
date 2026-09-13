<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-cli/tests

## Purpose
End-to-end test crate for both `dopedb-cli` binaries. Exercises the real
built CLI and Agent-bridge binaries against an isolated, authenticated Broker
fixture over a Unix socket; no installed Desktop, account, credential, or real
database is used.

## Key Files
| File | Description |
|------|-------------|
| `terminal_session_e2e.rs` | Unix-only (`#[cfg(unix)]`) end-to-end suite. Covers typed ACP MCP direct-Broker catalog search and a single-call plan/run journey without a bearer token or the public CLI, plus full CLI/schema-diff Agent journeys with exact dual selectors, no partial output after denial/read-failure/revocation, snapshot identity validation, and fingerprint-bound result paging. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `support/` | Shared fixture helpers for this suite, documented inline below (no separate `AGENTS.md`). |

### `support/` (inline)
| File | Description |
|------|-------------|
| `schema_diff.rs` | Spins up an isolated fake Broker (`UnixListener`) and drives the real CLI/Agent-bridge binaries as subprocesses against it; used by `terminal_session_e2e.rs`'s schema-diff scenarios. |

## For AI Agents

### Working In This Directory
- This suite launches the actual compiled `dopedb-cli` and `dopedb-agent-bridge` binaries as subprocesses over a fake Unix-socket Broker; it does not mock `BrokerClient` in-process. Keep new scenarios consistent with that approach rather than adding a unit-style mock.
- Unix-only: guard new platform-specific code with the same `#[cfg(unix)]` gating already used at the top of `terminal_session_e2e.rs`.

### Testing Requirements
- `cargo test --package dopedb-cli --test terminal_session_e2e` — part of `pnpm test:rust`. Protects one test slot in the repository's 208-test critical budget (`tests/critical-test-budget.json`); see `../../tests/AGENTS.md`.

### Common Patterns
- A scenario creates a temporary directory and `UnixListener`, spawns a thread that answers Broker requests, then runs the built binary with `Command::new(...)` pointed at that socket — see `support/schema_diff.rs`.

## Dependencies

### Internal
- The built `dopedb-cli` and `dopedb-agent-bridge` binaries from `../src/`; `dopedb-protocol` framing types for constructing fixture responses.

### External
- `tempfile`, `chrono` (dev-dependencies declared in `../Cargo.toml`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
