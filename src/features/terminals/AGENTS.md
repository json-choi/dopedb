<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/terminals

## Purpose
The connection-pinned advanced Shell PTY: xterm rendering, terminal domain types,
theming, and the IPC adapter. Per root `CLAUDE.md`, this Shell PTY is separate from
the ACP Agent session and is shown only in Settings → Command line when a user
explicitly opens it, never on a general work screen. `tauriAdapter.ts`'s header
states Agent (ACP) sessions remain owned by ACP and do not pass through this
adapter — this feature must not become a second transport for Agent I/O.

## Key Files
| File | Description |
|------|-------------|
| `PtySurface.tsx` | Owns the one xterm renderer used by the explicit connection-pinned advanced Shell; bridges bounded PTY input, output, resize, focus, and teardown. |
| `domain.ts` | Minimal connection-pinned Shell Terminal wire contract: branded `TerminalSessionId`, `TerminalLifecycle`. |
| `ptyTheme.ts` | Resolves the xterm palette from canonical design-system CSS custom properties so terminal rendering never hardcodes colors. |
| `tauriAdapter.ts` | Sole frontend owner of the bounded Shell Terminal commands (`terminal_create`, `terminal_write`, `terminal_resize`, `terminal_close`) and its output `Channel`. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- **Security/scope invariant (verified in code and root `CLAUDE.md`):** do not wire
  this feature's terminal into a general work screen; it belongs behind an explicit
  Settings → Command line entry point only.
- **Security invariant (verified in code):** `tauriAdapter.ts` must not carry ACP
  Agent session I/O — Agent sessions are a separate, ACP-owned transport.
- `ptyTheme.ts` must keep reading colors from design-system tokens
  (`--ds-*` custom properties) rather than hardcoding hex values, consistent with
  the repo's Tailwind/semantic-token UI rule.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.
  `pnpm test:rust` includes a terminal end-to-end test at the Cargo level
  (`cargo test --package dopedb-cli --test terminal_session_e2e`), not here.

### Common Patterns
- `terminal_create` takes an `onOutput` callback wired through a Tauri `Channel`,
  matching the streaming pattern used by `../queries`' SQL result streaming.

## Dependencies

### Internal
- `../connections` — `ConnectionEngine`, `ConnectionId`.
- `../workspaces` — `WorkspaceId`.
- `../../design-system/theme`.

### External
- `@xterm/xterm`, `@xterm/addon-fit`.
- Rust: `src-tauri/src/features/terminals/transport.rs` (also `adapters/`,
  `application.rs`, `domain.rs`, `ports.rs`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
