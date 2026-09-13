<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/agent-runtime

## Purpose
Builds, signs, pins, and verifies the ACP (Agent Client Protocol) adapter
plugin bundles that Desktop installs for the official Claude/Codex CLIs. This
is packaging tooling for the contract owned by `docs/contracts/acp-plugin-runtime.md`;
it does not implement the ACP client itself (that lives under `src-tauri/src/features/agents/`).

## Key Files
| File | Description |
|------|-------------|
| `build-acp-plugin.mjs` | Builds a signed ACP adapter bundle for one plugin (Claude or Codex candidate/stable channel). |
| `sign-acp-plugin.mjs` | Applies the release signature to a built adapter bundle. |
| `update-acp-plugin-pins.mjs` | Updates the pinned adapter versions in `agent-runtime/plugins/catalog.json` / `package.json` from upstream. |
| `verify-published-acp.mjs` | Release availability gate only: confirms a publicly downloadable ACP manifest matches the checked-in pins and runtime contract; it never installs or executes the downloaded code — full Minisign/payload verification remains the Desktop installer's job. |

## For AI Agents

### Working In This Directory
- `verify-published-acp.mjs` is a gate, not an installer; do not extend it to execute or unpack downloaded artifacts.
- Version pin updates from `update-acp-plugin-pins.mjs` must keep `agent-runtime/plugins/catalog.json` and the bundled `runtime-catalog.json` (`src-tauri/resources/agent-runtime/`) consistent with `docs/contracts/acp-plugin-runtime.md`.

### Testing Requirements
- `pnpm check:agent-runtime` runs `prepare-agent-runtime.mjs --check-config` and `build-acp-plugin.mjs --check-config`. `pnpm check:agent-runtime:published` runs `verify-published-acp.mjs` and is required before/while preparing a stable release draft (see root `AGENTS.md` Stable releases).
- `.github/workflows/acp-adapter-compatibility.yml`, `acp-adapter-pins.yml`, and `acp-adapter-release.yml` exercise this directory in CI.

### Common Patterns
- Scripts resolve the repository root as `resolve(import.meta.dirname, "../..")` rather than assuming a working directory.

## Dependencies

### Internal
- `agent-runtime/plugins/`, `src-tauri/resources/agent-runtime/runtime-catalog.json`, `dopedb-protocol/src/acp_plugin.rs`, `src-tauri/src/features/agents/runtime/`.

### External
- Node built-ins (`node:crypto`, `node:fs/promises`, `node:child_process`) only.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
