<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/broker

## Purpose

The owner-local CLI Broker: a Unix-domain-socket / named-pipe server shared by
the Desktop app and the `dopedb` CLI, per the product's connection-pinned
Terminal model (see root `CLAUDE.md`/`AGENTS.md`). It authenticates a
connecting process by OS peer identity and process ancestry, binds it to a
specific in-app Terminal session's capabilities, and routes typed commands to
the same feature application logic the Desktop UI uses — it is not a
general-purpose or always-on database server. Covers `dispatch/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | `BrokerRuntime`: owns the runtime identity, session registry, external-agent-request registry, and shutdown/status lifecycle shared between the Desktop app and the CLI. |
| `discovery.rs` | Runtime discovery path, atomic publication, and owner-only permissions for the endpoint file the CLI looks up to find a running Broker. |
| `peer.rs` | OS peer identity and owner-only endpoint permissions (500 lines). `PeerProcessIdentity` (pid + start time) identifies a connecting peer process cross-platform (Unix and Windows paths), bounded by `MAX_PROCESS_ANCESTORS` when walking process ancestry to confirm a request originates from an authorized descendant process. |
| `server.rs` | The owner-local UDS/named-pipe server with bounded length-prefixed frames. |
| `session.rs` | In-memory Terminal session capabilities (924 lines, the largest file in this module). Tokens never enter SQLite, discovery, logs, argv, or serialized broker results — a session's authority lives only in process memory for its lifetime. |
| `external_agent_requests.rs` | In-memory handoff between owner-local Broker requests and the Desktop approval UI (for `dopedb agent start`-style external Agent bootstrap requests). |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `dispatch/` | Broker envelope validation, authentication sequencing, and feature-handler routing (see below). |

`dispatch/mod.rs`: validates the incoming `dopedb-protocol` request envelope,
sequences authentication against `session::AuthenticatedSession`, and routes
each typed command (catalog, connection, database, document, operation,
query, schema, skill, status, version) to the matching handler module, using
the same `ApplicationServices` the Tauri command surface uses.
`dispatch/connection_catalog.rs`: connection and catalog broker handlers.
`dispatch/query_document.rs`: query and document-read broker handlers.
`dispatch/analysis_article_operation.rs`: ACP-only Analysis Article
operations — the Agent supplies declarative content, while the authenticated
session supplies every authority and revision pin. `dispatch/knowledge.rs`:
Project Knowledge tools scoped to one immutable ACP resource revision set (750
lines, the largest dispatch handler). `dispatch/external_agent.rs`:
Desktop-approved bootstrap for an official Agent CLI running outside the app
window. `dispatch/public_skill.rs`: public runtime and skill-management
broker handlers. `dispatch/projection.rs`: shared broker authority conversion,
wire projection, and stable error mapping used by every other dispatch
handler.

## For AI Agents

### Working In This Directory

- A Broker session's authority must stay bound to the exact process identity
  (`peer.rs`), Terminal session, and resource-revision pins it was created
  with — never widen a handler to accept a request based on a bare
  connection id or workspace id without re-validating those pins through
  `session::AuthenticatedSession`.
- Tokens/capabilities in `session.rs` must never reach SQLite, discovery
  files, logs, argv, or a serialized response — keep any new capability
  in-memory-only, matching the existing invariant.
- A new dispatch command must go through `dispatch/projection.rs`'s shared
  authority conversion and error mapping rather than hand-rolling a new
  response-encoding or error path.
- This Broker exists only for the exact Desktop-launched ACP session or a
  Desktop-approved `dopedb agent start` session (per the product direction in
  root `CLAUDE.md`/`AGENTS.md`) — do not turn it into an always-on or
  general-purpose endpoint.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`) runs this module.
  `session.rs` is budget-protected under the repository's 208-test cap
  (`tests/critical-test-budget.json`, 4 tests); a new test here must replace a
  lower-value existing test rather than raise the cap — run
  `pnpm check:test-budget` after a test change. `dispatch/mod.rs` also exposes
  a `#[cfg(test)]` `assert_dispatch_contract` that cross-checks every dispatch
  submodule's own contract assertions.

## Dependencies

### Internal

- Routes into the same `ApplicationServices` (`../services`) the Tauri
  command surface uses; consumes `../kernel::identity`/`TerminalAuthority` for
  scoping and `../skills::SkillManager` for skill commands.

### External

- `dopedb-protocol` (the wire command/response contract), `tokio`/
  `tokio-util` (async server + cancellation), `dashmap` (session registry),
  `subtle`/`zeroize` (constant-time/zeroizing token handling), `tauri`
  (event emission back to the Desktop UI), `chrono`, `serde`/`serde_json`,
  `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
