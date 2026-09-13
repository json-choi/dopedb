<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/resources

## Purpose

Files bundled into the packaged app via `../tauri.conf.json`'s
`bundle.resources` (`resources/skills/*.json`, `resources/licenses/*.txt`,
`resources/agent-runtime/`). Covers its subtree inline: `agent-runtime/`,
`licenses/`, and `skills/`. `resources/agent-runtime/node/` is a gitignored
download cache for platform-specific Node archives and is skipped below.

## Key Files / Subdirectories

| Path | Description |
|------|-------------|
| `agent-runtime/runtime-catalog.json` | Pinned Node runtime version and release line, plus a per-target-triple table (archive name, SHA-256, byte size, executable path, license file) used to fetch and verify the sidecar Node runtime that hosts ACP plugins. Read at runtime by `../src/features/agents/runtime/verification.rs` (see `../src/features/agents/AGENTS.md`). |
| `agent-runtime/acp-plugin.pub` | Minisign public key used to verify signed ACP plugin manifests before installation (consumed alongside `runtime-catalog.json` by the same agent-runtime verification path). |
| `agent-runtime/node/` | Gitignored; holds the downloaded per-platform Node archives once fetched. Not tracked, skipped here. |
| `licenses/Pretendard-OFL-1.1.txt` | OFL 1.1 license text for the bundled Pretendard font. |
| `licenses/cloud-sql-proxy-LICENSE.txt` | License text for the bundled Cloud SQL Auth Proxy sidecar binary (see `../binaries/`, `../src/connection/AGENTS.md`). |
| `licenses/phosphor-icons-LICENSE.txt` | License text for the bundled Phosphor icon set. |
| `skills/current-manifest.json` | The current `dopedb-cli` Skill's manifest: schema version, source path, app version, release revision, package digest, and source/install file hashes. Embedded at compile time into `../src/skills/bundle.rs` via `include_str!` (and also shipped as a loose bundle resource). |
| `skills/release-mapping.json` | History mapping each shipped app version to its `dopedb-cli` Skill release revision and package digest. Embedded the same way as `current-manifest.json`. |
| `skills/snapshot-registry.json` | Full historical registry of every `dopedb-cli` Skill snapshot (per release revision: app version, package digest, and per-file path/size/sha256). Embedded the same way; used to validate and repair an installed Skill copy against any prior release, not just the current one. |

## For AI Agents

### Working In This Directory

- The three `skills/*.json` files are compiled into the binary via
  `include_str!` in `../src/skills/bundle.rs` — regenerate them with whatever
  produces the `dopedb-cli` Skill release artifacts rather than hand-editing,
  since `bundle.rs` validates the embedded manifest's digest, file hashes, and
  `app_version` (`env!("CARGO_PKG_VERSION")`) match at compile/runtime.
- `agent-runtime/runtime-catalog.json` and `acp-plugin.pub` are read from the
  bundled resource directory at runtime (via Tauri's `BaseDirectory`), not
  embedded — a build only needs to bump `runtime-catalog.json` to change which
  Node build the ACP runtime downloads and verifies.
- Do not add a real credential, token, or personal path into any file here —
  everything under `resources/` ships inside the distributed app bundle.

### Testing Requirements

- No dedicated test suite for these data files. `../src/skills/bundle.rs` and
  `../src/features/agents/runtime/verification.rs` validate their shape at
  load time; `pnpm test:rust` exercises the `skills` module's embedded-manifest
  checks as part of the `dopedb` lib test suite.

## Dependencies

None — static resource files with no imports; consumed by `../src/skills` and
`../src/features/agents/runtime`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
