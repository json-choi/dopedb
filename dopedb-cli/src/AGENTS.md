<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# dopedb-cli/src

## Purpose
Source for both `dopedb-cli` binaries: the public `dopedb` CLI (`main.rs` +
`args.rs` + `client.rs` + `output.rs` + `commands/`) and the app-only ACP bridge
(`agent_bridge_main.rs` + `acp_launch.rs` + `agent_launch_policy.rs` +
`agent_mcp*.rs`). The public CLI and the ACP bridge share the same
`BrokerClient`/`dopedb-protocol` request path but are never invoked from the
same binary, so the released CLI surface can never reach the Agent MCP tool
dispatch and vice versa.

## Key Files
| File | Description |
|------|-------------|
| `main.rs` | Public CLI entrypoint; wires `clap`-parsed commands to `commands/*` and maps results to `exit_code` values. |
| `args.rs` | `clap` `Cli`/`Command` definitions for the public `dopedb` CLI surface. |
| `client.rs` | `BrokerClient`: discovers the running runtime, negotiates protocol/command-schema versions, and performs framed async requests over the local socket/pipe. |
| `output.rs` | Shared human/JSON `OutputMode` rendering used by every command module. |
| `exit_code.rs` | Stable process exit codes (`SUCCESS`, `POLICY_BLOCKED`, `PROTOCOL_MISMATCH`, etc.) mapped from `dopedb_protocol::ErrorCode` and `ClientError`. |
| `schema_diff.rs` | Builds one authorized, fresh catalog pair for CLI and session-scoped Agent callers by reusing existing Broker commands; no credentials or drivers live here. |
| `lib.rs` | Internal library surface exposed only so the crate's cross-platform security regression tests can exercise CLI/Agent binaries. |
| `acp_launch.rs` | Token-bearing bootstrap for one unmodified official ACP adapter; verifies the exact app-selected launcher image and consumes a one-time Broker registration capability without forwarding it to the adapter process. |
| `agent_bridge_main.rs` | Entrypoint for the `dopedb-agent-bridge` binary: registers the official ACP adapter process once, then serves typed MCP tools against the authenticated Local Broker. Bundled with Desktop, never installed as the public CLI. |
| `agent_launch_policy.rs` | Closed command policy for app-only official ACP adapter launchers. |
| `agent_mcp.rs` | Session-scoped typed MCP bridge shared by built-in ACP (via the bridge binary) and a Desktop-approved external Agent (via the hidden public-CLI entrypoint); every tool maps to one typed Local Broker command, never shelling out to another `dopedb` process. |
| `agent_mcp_dispatch.rs` | MCP tool dispatch and Broker request execution. |
| `agent_mcp_tools.rs` | MCP tool catalog and JSON Schema definitions served to ACP adapters. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `commands/` | One module per CLI command group, documented inline below (no separate `AGENTS.md`). |

### `commands/` (inline)
| File | Description |
|------|-------------|
| `mod.rs` | Declares the `app`, `catalog`, `completion`, `connection`, `document`, `external_agent`, `input`, `operation`, `query`, `skills` command modules. |
| `app.rs` | `dopedb app` status/version/open commands against the Broker. |
| `catalog.rs` | CLI catalog inspection and full human/JSON schema comparison output. |
| `completion.rs` | Runtime-independent shell completion generation. |
| `connection.rs` | Connection list/show/test commands and selector parsing shared with `query.rs`. |
| `document.rs` | Typed MongoDB reads through the authenticated local broker (`dopedb document run`). |
| `external_agent.rs` | Desktop-approved project configuration and official external Agent launch (`dopedb agent start`); reviews the checked-in, secret-free project resource config before launching the user's own official CLI. |
| `input.rs` | Bounded stdin input reader shared by SQL and typed document commands. |
| `operation.rs` | Operation show/cancel/wait commands built on `query.rs`'s UUID parsing and operation-writing helpers. |
| `query.rs` | SQL plan/run/cancel and propose commands; owns `MAX_SQL_INPUT_BYTES` bounding for stdin-supplied SQL. |
| `skills.rs` | `dopedb skills get/list/install/remove/repair`; embeds the `skills/dopedb-cli` guide and reference docs via `include_str!` so the CLI can serve them without a network fetch. |

## For AI Agents

### Working In This Directory
- The public CLI (`args.rs`/`main.rs`/`commands/`) and the ACP bridge (`agent_*.rs`) must stay reachable only from their own binary entrypoint; do not add a code path that lets `main.rs` call into `agent_mcp_dispatch.rs` or vice versa.
- `commands/skills.rs` embeds the live `skills/dopedb-cli/**` Markdown at compile time with `include_str!`; renaming or moving those skill files breaks the CLI build, not just the skill bundle.
- Every Broker request goes through `client::BrokerClient`; do not open a raw socket/pipe from a command module.

### Testing Requirements
- Exercised indirectly by `cargo test --package dopedb-cli --test terminal_session_e2e` (see `../tests/AGENTS.md`); there are no unit tests inside `src/` itself.

### Common Patterns
- A command function takes an `OutputMode`, builds a `BrokerClient`, awaits one typed `client.request::<SomeCommand>(&args)` call, then renders via `output::` — see `commands/connection.rs::list`.

## Dependencies

### Internal
- `dopedb-protocol` for every request/response/error type; `../skills/dopedb-cli/**` (embedded at build time by `commands/skills.rs`).

### External
- `clap`/`clap_complete`, `tokio`, `uuid`, `serde`/`serde_json`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
