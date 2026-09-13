<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-cli

## Purpose
Independent Rust crate (`dopedb-cli`, part of the root Cargo workspace) providing the
public `dopedb` CLI binary and the app-only ACP process bridge binary. Both binaries
talk to the running DopeDB Desktop runtime through `dopedb-protocol` framed IPC; the
crate never opens a database driver, reads a credential, or approves its own
mutation. `dopedb agent start` here launches only the user's own official, locally
authenticated ACP CLI after a Desktop-approved, secret-free project resource review —
it never reads or refreshes a provider token. See root `AGENTS.md` / `CLAUDE.md` for
the product-wide ACP and CLI boundary this crate must not cross.

## Key Files
| File | Description |
|------|-------------|
| `Cargo.toml` | Defines two bins: `dopedb-cli` (public CLI, `src/main.rs`) and `dopedb-agent-bridge` (app-only ACP bridge, `src/agent_bridge_main.rs`), kept distinct so the signed public sidecar never carries the Agent database hot path. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | CLI parsing, broker client, output formatting, and the ACP/MCP bridge modules (see `src/AGENTS.md`, which also documents `src/commands/`). |
| `tests/` | End-to-end tests against a real isolated Broker fixture (see `tests/AGENTS.md`, which also documents `tests/support/`). |

## For AI Agents

### Working In This Directory
- Two separate binaries exist on purpose: `dopedb-cli` is the public, released surface; `dopedb-agent-bridge` is bundled with Desktop but never installed as the public CLI. Do not merge their entrypoints or let the public CLI parser reach the Agent MCP dispatch path directly.
- All typed request/response shapes come from `dopedb-protocol`; do not hand-roll JSON payloads here — add or change a shape in that crate first and update the golden fixtures there.
- `src/lib.rs` exists only to expose an internal surface to the crate's own cross-platform security regression tests; it is not a public API for other crates.

### Testing Requirements
- `cargo test --package dopedb-cli --test terminal_session_e2e` (this is one of the three checks run by `pnpm test:rust`, alongside the `dopedb` lib tests and the `dopedb-protocol` golden tests).

### Common Patterns
- Command modules under `src/commands/` construct a `BrokerClient`, send one typed `*Command`, and render through `crate::output` in either human or JSON mode — see `src/commands/connection.rs` for the shape.

## Dependencies

### Internal
- `dopedb-protocol` (path dependency): every request/response type, error code, and framing constant.

### External
- `clap` / `clap_complete` for argument parsing and shell completion, `tokio` (io-util/macros/net/rt-multi-thread/sync/time) for the async broker client, `uuid`, `sha2`, `hex`, `zeroize`, `dirs`; platform-specific `libc` (unix) and `windows-sys` (Security/FileSystem/Threading) for socket/pipe permission handling.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
