<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/agents

## Purpose

ACP (Agent Client Protocol) runtime and local Agent CLI readiness. This is
the only place the official `claude`/`codex` CLIs are launched and driven, and
it deliberately never opens their auth files, reads a token, refreshes a
credential, or offers a login flow — authentication stays entirely with the
locally installed CLI. It also owns installation/verification of signed ACP
adapter plugins and the bundled Node runtime they run under. Per
`CLAUDE.md`/`AGENTS.md`, this feature must not build a bespoke chat protocol
or a per-provider integration, and must not expose an always-on general MCP
server; any MCP-compatible bridge exists only inside one Desktop-launched ACP
session.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Declares `acp`, `adapters`, `application`, `domain`, `external_transport`, `ports`, `runtime`, `transport`; `compose()` builds `AgentsFeature = AgentsUseCases<ProcessAgentCliProbe>`. |
| `acp.rs` | Official ACP client runtime module root for the in-app Agent surface; documents the no-token-access invariant for the whole `acp/` submodule. |
| `acp_runtime.rs` | ACP session admission, lifecycle commands, and runtime coordination. |
| `acp_session.rs` | ACP session projections, permissions, and replay-buffer state. |
| `acp_session_driver.rs` | ACP adapter process execution, turn handling, and protocol validation. |
| `application.rs` | Read-only Agent CLI discovery composed from an explicit platform port. |
| `domain.rs` | ACP conversation and local CLI status contracts. |
| `external_transport.rs` | Tauri approval surface for external official Agent CLI sessions (i.e. `dopedb agent start`, launched outside Desktop after a visible config review). |
| `ports.rs` | Port for local CLI discovery. |
| `transport.rs` | Tauri transport for ACP sessions and CLI probes. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `acp/` | ACP protocol mechanics: authority revocation, project-scoped model/permission-mode advertisement, the Desktop adapter bundle, event delivery, Knowledge-scope resolution, session persistence, process launch, and prompt shaping. |
| `adapters/` | Concrete desktop adapter(s) for CLI discovery. |
| `runtime/` | Signed ACP adapter plugin catalog, install/update, storage, and bundled-runtime verification. |

**`acp/`**

| File | Description |
|------|-------------|
| `authority.rs` | Immediate ACP revocation when a connection, Project, or workspace authority changes. |
| `configuration.rs` | Project-only advertised model and permission-mode choices surfaced to the Desktop UI. |
| `desktop.rs` | Desktop adapter bundle supplied by the Tauri transport for one ACP launch. |
| `event_sink.rs` | ACP session change delivery port and its Tauri desktop adapter. |
| `knowledge_scope.rs` | Exact Project Knowledge resolution port for connection-pinned ACP sessions. |
| `persistence.rs` | Workspace-scoped ACP session persistence port and ordered batch worker. |
| `process.rs` | Verified official-CLI process launch port for one connection-pinned ACP actor. |
| `prompt.rs` | Bounded, injection-aware ACP prompt and optional editor context projection. |

**`adapters/`**

| File | Description |
|------|-------------|
| `cli_probe.rs` | Process adapter for bounded, credential-free Agent CLI status probes. |
| `mod.rs` | Concrete desktop adapter for CLI discovery; exposes `ProcessAgentCliProbe`. |

**`runtime/`**

| File | Description |
|------|-------------|
| `mod.rs` | Signed ACP adapter plugin installation and bundled Node runtime verification (module root). |
| `archive.rs` | Extracts a downloaded plugin archive (tar+gzip) under a bounded byte cap (`MAX_ACP_PLUGIN_UNPACKED_BYTES`) with path-traversal guards. |
| `domain.rs` | Runtime plugin-state schema (`RUNTIME_STATE_SCHEMA_VERSION`) and installed-plugin records. |
| `manager.rs` | Top-level plugin manager coordinating catalog resolution, download, install, and version bookkeeping. |
| `manager_install.rs` | ACP plugin catalog resolution, download, and installed-version management. |
| `manager_storage.rs` | ACP plugin state validation and atomic private-file operations. |
| `verification.rs` | Signature, host contract, and bundled runtime verification for ACP plugins. |

## For AI Agents

### Working In This Directory

- Never add code that reads, refreshes, or stores a provider auth token; the
  local `claude`/`codex` CLI login is the sole authority. `acp.rs` and
  `acp/process.rs` state this invariant explicitly — preserve it in any new
  process-launch or prompt path.
- Run only the official, unmodified ACP adapters; do not add a
  provider-specific protocol translation layer here.
- `runtime/` plugin installs must stay signature-verified
  (`runtime/verification.rs`) and byte-capped (`runtime/archive.rs`) before
  any extracted file is trusted.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`). `mod.rs` and
  `transport.rs` each expose a `#[cfg(test)] assert_*_contract()` helper
  (`adapters::assert_agent_cli_probe_contract`,
  `transport::assert_agent_transport_contract`) invoked from `mod.rs`'s own
  test.

### Common Patterns

- `compose() -> AgentsFeature` takes no external dependencies (CLI discovery
  only); the heavier ACP session runtime is composed elsewhere and reached
  through `acp_runtime`/`acp_session_driver`.

## Dependencies

### Internal

- Imports `crate::features::knowledge` (Project Knowledge scope resolution
  for a pinned ACP session) and `crate::kernel::{access, identity, sync}`.
- Imported by `crate::features::queries` (Agent-originated SQL plan/run
  flows).

### External

- `agent-client-protocol` (pinned `=2.1.0`), `tokio`, `tar`, `flate2`
  (`GzDecoder`), `minisign-verify`, `semver`, `sha2`, `dopedb-protocol`
  (`AcpPluginManifestV2`, `AcpPluginId`, `SignedAcpPluginManifestV2`).
- Frontend adapter: `src/features/agents/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
