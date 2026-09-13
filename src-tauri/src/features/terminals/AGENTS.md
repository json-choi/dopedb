<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/terminals

## Purpose

Connection-pinned, PTY-backed advanced Shell. Per `CLAUDE.md`, this
connection-pinned Shell is distinct from the ACP Agent session and is not
shown on a normal work screen — it is surfaced only when the user explicitly
opens it from Settings → Command line. Nothing here is persisted: output,
process handles, and broker capabilities all die with the desktop runtime.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Connection-pinned, PTY-backed advanced Shell vertical slice. |
| `domain.rs` | Serializable advanced Shell contracts and immutable session metadata. |
| `application.rs` | Explicit connection-pinned advanced Shell use-case entry points. |
| `ports.rs` | Capabilities required by the connection-pinned advanced Shell. |
| `transport.rs` | Thin Tauri transport for the explicit advanced Shell surface. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Desktop adapters for the PTY-backed Shell: authority, environment, output filtering, process-tree cleanup, runtime, and session ownership. |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Desktop adapters for the connection-pinned advanced Shell (module root). |
| `authority.rs` | Projection and comparison of scope-pinned connection authority. |
| `desktop.rs` | Desktop composition adapter for Terminal sessions. |
| `environment.rs` | Secret-minimized environment and profile command construction. |
| `output.rs` | Bounded PTY output handling; the renderer receives terminal bytes, never HTML — OSC control strings (including clipboard/hyperlink sequences) are removed entirely and CSI window operations are discarded before xterm sees them, via a stateful parser so a control sequence split across read boundaries cannot bypass the filter. |
| `process_tree.rs` | Cross-platform descendant cleanup for one PTY session. |
| `runtime.rs` | In-memory PTY session owner; nothing here is persisted — output, process handles, and broker capabilities die with the desktop runtime. |
| `session.rs` | One Terminal session's PTY resources, output stream, and lifecycle. |
| `windows_pty_test_support.rs` | Stateful ConPTY handshake support shared by Windows PTY tests. |

## For AI Agents

### Working In This Directory

- Never persist PTY session state, output, or process handles — this is an
  in-memory-only surface by design (`adapters/runtime.rs`).
- Any new output path must go through `adapters/output.rs`'s OSC/CSI
  filtering so the renderer never receives raw control sequences or HTML.
- `adapters/environment.rs` must keep the spawned shell's environment
  secret-minimized; do not pass a connection credential into the child
  process environment.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`);
  `adapters/windows_pty_test_support.rs` backs Windows-specific ConPTY tests.

## Dependencies

### Internal

- Imports `crate::kernel::{access, identity, sync}`.
- No other `features/*` module imports this one; `dopedb-cli` also has
  advanced-Shell integration coverage
  (`dopedb-cli/tests/terminal_session_e2e.rs`, part of the 208-test critical
  budget) that exercises this feature end to end.

### External

- `portable-pty`, `libc` (Unix process-tree handling), `windows-sys`
  (Windows ConPTY).
- Frontend adapter: `src/features/terminals/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
