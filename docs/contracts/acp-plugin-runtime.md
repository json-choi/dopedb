# ACP plugin runtime contract

DopeDB ships one platform Node runtime and installs only the first-party Claude
or Codex ACP adapter selected by the user. The runtime, adapter plugin, local
provider CLI, provider login, and optional DopeDB Skill are separate assets and
must never share an installation state.

## Bundled Node runtime

[`runtime-catalog.json`](../../src-tauri/resources/agent-runtime/runtime-catalog.json)
is the source of truth for the Node version and the three supported stable
release targets: Apple Silicon macOS, Intel macOS, and x64 Windows. Every entry
pins the official `nodejs.org` archive URL, byte length, and SHA-256. The core
installer budget rejects an archive larger than 60 MiB.

`scripts/prepare-agent-runtime.mjs` downloads at most the exact pinned byte
length, verifies the archive before extraction, and extracts only the Node
executable and its license. It creates a target-specific executable manifest
and SPDX 2.3 SBOM and places them under
`resources/agent-runtime/node/<target>/`. Tauri bundles that directory as a
read-only application resource. npm and npx are intentionally not included.

Generated runtime bytes are ignored by Git. Stable artifacts rebuild them from
the pinned catalog so a changed upstream object fails before signing.

## Closed plugin identity

`dopedb-protocol::AcpPluginId` accepts exactly:

- `dopedb.acp.claude`
- `dopedb.acp.codex`

There is no user-provided ID, executable, package name, URL, or provider field
on the Agent registration command. The ID fixes the provider and the local CLI
environment variable (`CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH`).

`SignedAcpPluginManifestV1` is the catalog wire shape. Its inner manifest owns
the exact upstream package version, tag and commit, compatibility ranges,
relative adapter entrypoint,
artifact URL and independent signature, packed archive hash, canonical unpacked
content-tree hash, size budgets, license inventory, SBOM digest,
release/revocation timestamps, and rollout cohort. The outer envelope
owns a separate manifest digest, signature, and key ID. Shape validation is not
signature verification; the installer must verify both signatures against the
bundled DopeDB key before any archive is extracted or activated.

The command schema is version 8. Agent registration carries the closed
`pluginId`, bundle version, the verified bundled Node path and hash, the signed
adapter entrypoint and hash, and the independently verified local provider CLI
path and hash. The private bridge re-verifies all three executables before it
starts the adapter. Desktop and its private Agent bridge are released together
and must negotiate that exact schema.

## Install, activation, and removal

The plugin manager downloads only fixed DopeDB release origins with bounded
redirects and byte counts. It verifies the signed manifest, artifact signature,
archive hash, compatibility range, and canonical content-tree hash before an
atomic stage. Archive extraction rejects absolute or parent paths, links,
special files, duplicate paths, oversized files, and file-count abuse.

The upstream adapter version, immutable distribution release ID
(`acp-bundle-vYYYY.MM.DD.N`), and signed manifest digest are three separate
identities. The version is user-facing compatibility information, the release ID
selects an immutable published asset set, and the manifest digest is the local
installation directory and activation-receipt key. Rebuilding an unchanged
upstream version therefore creates a distinct candidate without overwriting or
conflicting with the current bundle. Desktop continues to resolve legacy
version-keyed installation directories so an upgrade does not strand an existing
last-known-good adapter.

The first new ACP session launches a candidate. Successful initialization
promotes it to current and last-known-good; failure quarantines it and retries
the last-known-good bundle. Removing a plugin first closes that provider's ACP
sessions and waits for their launched process trees to exit, then deletes only
that provider's managed current, staged, rollback, and quarantine files. Local
provider CLIs, logins, conversations, DopeDB Skill, the other plugin, and bundled
Node remain untouched.

## Independent adapter releases

[`catalog.json`](../../agent-runtime/plugins/catalog.json) pins the exact
official npm package, upstream tag, and commit for each adapter. The adapter
build includes only the official JavaScript and production dependencies, rejects
provider-native executables and unsafe file types, produces an SPDX 2.3 SBOM,
and enforces the 30 MiB packed budget. Claude receives the verified local CLI
through `CLAUDE_CODE_EXECUTABLE`; Codex uses `CODEX_PATH`.

`acp-adapter-release.yml` builds and signs candidate or stable adapter bundles
without changing the app, CLI, or Skill version. Compatibility CI starts each
entrypoint with bundled Node. The pin watcher opens an exact source/lock update
PR when an official adapter changes. A candidate uses the owner-created
`acp-bundle-vYYYY.MM.DD.N-candidate` tag. Stable promotion uses the matching
owner-created `acp-bundle-vYYYY.MM.DD.N` tag, requires both tags to resolve to
the same commit, and compares each rebuilt archive and normalized build metadata
with the immutable candidate before publishing both providers together.

Every release remains a draft while all assets are attached and its exact asset
closure is checked, then one publish operation makes the release immutable.
There is no mutable `acp-bundle-stable` release: immutable release assets cannot
serve as a replaceable alias. Desktop instead reads GitHub's bounded matching-tag
index, ignores `-candidate` tags and malformed dates, and tries the newest eight
stable version tags until it finds the requested signed manifest. It caches the
resolved release for 15 minutes and requires the signed artifact URL to belong
to that exact release tag. This preserves independent adapter updates without
moving a release tag or weakening repository immutability. The protected
workflow never creates tags, so the repository's owner-only tag rule remains
intact.
The protected job opens the Minisign key with the configured password through
the non-interactive `acp-plugin-sign` Rust helper; it never depends on a TTY or
prints the password. An intentionally empty key password is still passed as an
explicit empty value so Minisign cannot fall back to an interactive prompt.
The ACP trust anchor is the exact public half of that protected updater signing
key. Configuration validation compares the complete decoded updater public key
with `acp-plugin.pub`, not only its key ID, so a drifted or mistyped key fails
before a bundle is built.

At runtime, startup schedules (but does not await) a 24-hour-coalesced signed
manifest check for installed plugins only. The check records an available release
but never downloads, stages, or activates its executable artifact. Agent Tools can
run the same metadata check explicitly; only the user's Install update action
downloads and stages that exact reviewed release. The active or last-known-good
adapter remains usable while an update waits. Download, verification, candidate
promotion, quarantine, and removal emit categorical provider/operation/outcome telemetry;
versions, paths, failure strings, credentials, prompts, and database data are
never included.
