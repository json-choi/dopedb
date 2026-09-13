<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/release

## Purpose
Stable-release automation: creates the owner-attributed draft/tag, verifies
version consistency, finalizes and downloads updater metadata, notarizes the
macOS DMG, captures the macOS distribution trust receipt, and generates
user-facing release notes. Invoked from `package.json` and
`.github/workflows/release.yml`; see root `AGENTS.md` Stable releases section
for the human approval boundary these scripts implement.

## Key Files
| File | Description |
|------|-------------|
| `capture-macos-distribution-trust.mjs` | Captures the Developer ID / notarization / staple / Gatekeeper trust receipt for both macOS architectures and binds it to the exact app-payload assets, per `.release/AGENTS.md`. |
| `create-stable-draft.sh` | Creates the owner-attributed annotated `app-vX.Y.Z` tag and draft GitHub release; runs `verify-release-version.mjs` first. Invoked as `pnpm release:stable:draft -- X.Y.Z`. |
| `download-public-updater-assets.mjs` | Downloads the immutable public updater closure (no credentials, no full-memory installer buffering) for finalization/verification. |
| `finalize-updater-json.mjs` | Finalizes Tauri's `latest.json` updater metadata before a draft release becomes immutable, ensuring every asset URL resolves through GitHub's public release-download path; defines the `UPDATER_PLATFORMS` map. |
| `generate-release-notes.mjs` | Builds user-facing release notes from append-only fragments under `.release-notes/fragments/`; in the current `prepared` mode it preserves the generic pre-MVP release body while keeping the generator, validator, and preview path executable. Supports `check` and `preview` subcommands. |
| `notarize-macos-dmg.sh` | Notarizes and staples the final distributed DMG container, separately from Tauri's own app-bundle notarization. |
| `verify-release-version.mjs` | Verifies every stable-release version source (Cargo manifests, `Cargo.lock`, etc.) with a bounded TOML parser rather than first-match shell extraction; fails closed on ambiguity. |
| `wait-for-finalized-latest.mjs` | Polls GitHub only until its draft asset metadata catches up with an already-finalized local `latest.json`; a structural updater-closure failure stops immediately rather than retrying. |

## For AI Agents

### Working In This Directory
- Only `create-stable-draft.sh` may create the owner-attributed tag/draft, and only in response to an explicit user release request (root `AGENTS.md` Stable releases). Do not add a path that creates or force-pushes a release tag from CI.
- `generate-release-notes.mjs` must keep working in `prepared` mode without requiring real fragments; do not switch `.release-notes/config.json` to `active` here (see `.release-notes/AGENTS.md`) without an explicit post-MVP user decision.
- `verify-release-version.mjs`'s bounded TOML parsing is deliberate; do not replace it with a permissive regex extraction.

### Testing Requirements
- `pnpm check:release-notes` runs `generate-release-notes.mjs check`; `pnpm release:notes:preview` runs its `preview` subcommand (no file/release changes).
- `.github/workflows/release.yml` (triggered on `app-v*` tag push) runs `verify-release-version.mjs`, `capture-macos-distribution-trust.mjs`, `finalize-updater-json.mjs` (twice, once per platform batch), `wait-for-finalized-latest.mjs`, and `download-public-updater-assets.mjs` in sequence.

### Common Patterns
- Scripts that touch release assets fail closed on any ambiguity (unexpected TOML shape, non-GitHub asset URL, mismatched trust receipt) rather than guessing a safe default.

## Dependencies

### Internal
- `.release/macos-distribution.json`, `.release-notes/`, `Cargo.lock`, `src-tauri/Cargo.toml`, `.github/workflows/release.yml`.

### External
- `gh` CLI (via the owner wrapper for tag/draft creation), Node built-ins (`node:crypto`, `node:fs/promises`, `node:child_process`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
