<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# .release

## Purpose
Owns the checked-in macOS code-signing activation switch. This directory is
the single source of truth for whether stable macOS builds require Developer
ID signing and notarization, so the release pipeline cannot silently start
claiming a trust level it has not earned.

## Key Files
| File | Description |
|------|-------------|
| `macos-distribution.json` | `schemaVersion: 2` record of `distributionMode` (`legacy-unsigned` or `developer-id`), `productName`, `bundleIdentifier` (`dev.dopedb.desktop`), and `teamIdentifier`. This file's current `distributionMode` is `developer-id`. |

## For AI Agents

### Working In This Directory
- `distributionMode` must only move from `legacy-unsigned` to `developer-id` after the user explicitly enrolls and requests activation (root `AGENTS.md`); it is not toggled to unblock a build.
- While `legacy-unsigned`, the pipeline must not require Apple credentials or claim notarization. While `developer-id` (the current value), a stable publish must fail closed unless both `arm64` and `x64` builds produce a Developer ID + notarization + staple + Gatekeeper pass bound to the exact app-payload assets.
- Do not hand-edit `bundleIdentifier`/`teamIdentifier` to a personal or non-product-owned value; these are the production code-signing identity.

### Testing Requirements
- Enforced by `.github/workflows/release.yml` and `scripts/release/capture-macos-distribution-trust.mjs`, which captures the trust receipt matching this file's declared mode.

### Common Patterns
- A `schemaVersion` field guards against silently reinterpreting an older config shape; bump it if the contract changes.

## Dependencies

### Internal
- Read by `.github/workflows/release.yml` and `scripts/release/capture-macos-distribution-trust.mjs`.

### External
- Apple Developer ID signing / notarization service (only when `distributionMode` is `developer-id`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
