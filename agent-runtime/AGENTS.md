<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# agent-runtime

## Purpose
Checked-in, review-only source of truth for which official ACP adapter
versions Desktop bundles, and at what pins. This directory holds no build
output and no executable adapter code itself — it is the input that
`scripts/prepare-agent-runtime.mjs` and `scripts/agent-runtime/*.mjs` read to
stage a bundled Node runtime and to build/sign/verify the ACP adapter plugin
package placed under `src-tauri/resources/agent-runtime/` (a generated
directory, not tracked here or edited by hand).

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `plugins/` | Upstream ACP adapter pins and the signed-plugin catalog, documented inline below. |

### `plugins/` (inline)
| File | Description |
|------|-------------|
| `catalog.json` | The closed, schema-versioned catalog of first-party ACP adapters Desktop will accept: signing `keyId`, supported `acpProtocol` and Node version range, `runtimeContractVersion`, and one entry per plugin (`id`, `provider`, `npmPackage`, `adapterVersion`/`adapterBundleVersion`, `entrypoint`, `upstreamRepository`/`upstreamTag`/`upstreamCommit`, `installMode`, license). Matches `dopedb-protocol::acp_plugin`'s closed two-ID allowlist. |
| `package.json` (`@dopedb/acp-adapter-pins`) | Review-only `dependencies` pinning the exact upstream adapter npm package versions listed in `catalog.json`, so a version bump is a visible, reviewable diff. |
| `package-lock.json` | Lockfile for the pins above; updated together with `catalog.json` by `scripts/agent-runtime/update-acp-plugin-pins.mjs`. |

## For AI Agents

### Working In This Directory
- Only `catalog.json` + `package.json`/`package-lock.json` are hand-maintained (or updated by the pin-update script); everything downstream (staged Node runtime, built/signed plugin bundle) is generated into `src-tauri/resources/agent-runtime/` and must not be edited directly or committed as source here.
- `catalog.json`'s two plugin entries are the only ACP adapters Desktop will run (see `dopedb-protocol/src/acp_plugin.rs`); adding a third provider or a second executable identity for an existing one is a product/security decision, not a routine pin bump.
- A version bump normally comes from `scripts/agent-runtime/update-acp-plugin-pins.mjs`, which reads `npm view <package> version`, resolves the matching upstream commit, and rewrites `catalog.json`/`package.json` together — do not hand-edit `adapterVersion` without also updating `upstreamCommit`.

### Testing Requirements
- `pnpm check:agent-runtime` runs `node scripts/prepare-agent-runtime.mjs --check-config && node scripts/agent-runtime/build-acp-plugin.mjs --check-config` — validates the pinned Node runtime config and that the plugin bundle can build from the current `catalog.json`/pins without actually publishing. This is part of the root `pnpm build` chain.
- `pnpm check:agent-runtime:published` runs `scripts/agent-runtime/verify-published-acp.mjs`, which checks that the publicly downloadable ACP release artifacts for the current pins satisfy the adapter runtime contract (`runtimeContractVersion`), ACP protocol range, and bundled Node version range declared in `catalog.json`, and that the published manifest's `adapterVersion`/`adapterBundleVersion` match the checked-in pins exactly. Required before both stable-release draft preparation and release verification (root `AGENTS.md`).

### Common Patterns
- The build/sign/publish/verify pipeline is split one script per concern in `../scripts/agent-runtime/`: `build-acp-plugin.mjs` (package + SBOM + `build-metadata.json`), `sign-acp-plugin.mjs` (Minisign signature via the `tools/acp-plugin-sign` binary), `verify-published-acp.mjs` (post-publish compatibility gate, read-only — it never installs or runs the downloaded adapter), and `update-acp-plugin-pins.mjs` (pin bumps). `scripts/prepare-agent-runtime.mjs` separately stages the pinned Node runtime binary bundled alongside the adapters.

## Dependencies

### Internal
- Read by `../scripts/prepare-agent-runtime.mjs` and every script in `../scripts/agent-runtime/`; consumed conceptually by `dopedb-protocol::acp_plugin` (the closed allowlist) and `dopedb-cli`'s `acp_launch.rs`/`agent_launch_policy.rs` (the launcher that runs the resulting bundle). See `../dopedb-protocol/src/AGENTS.md` and `../dopedb-cli/src/AGENTS.md`.
- Signing uses the `../tools/acp-plugin-sign` binary; updater/publication integrity is checked by `../tools/release-updater-verify`.

### External
- Upstream ACP adapter npm packages named in `plugins/catalog.json` (published by their own maintainers, not built here); a pinned Node.js runtime distribution fetched by `prepare-agent-runtime.mjs`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
