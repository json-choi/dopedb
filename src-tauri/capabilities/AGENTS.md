<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/capabilities

## Purpose

Tauri v2 capability (permission) manifests. A capability binds a set of
plugin/core permissions to a set of windows; Tauri denies any IPC command not
covered by one. This is the allowlist that decides what the `main` window's
webview is permitted to invoke on the Rust side, independent of the CSP in
`../tauri.conf.json`.

## Key Files

| File | Description |
|------|-------------|
| `default.json` | The `default` capability, applied to the `main` window. Grants `core:default`, `core:app:allow-set-app-theme`, `core:window:allow-start-dragging`, `updater:default`, `process:default`, and a scoped `opener:allow-open-url` permission whose `allow` list enumerates the exact external URLs/URL-prefixes the app may open in the system browser (workspace auth/settings, privacy policy, the GitHub knowledge-app install flow, official Claude Code / Codex CLI docs, GitHub Releases, and Analysis Article links). |

## For AI Agents

### Working In This Directory

- Adding a new "open in browser" link from the frontend requires adding its
  exact URL (or the narrowest possible prefix pattern) to
  `opener:allow-open-url`'s `allow` list here — do not widen it to a bare
  domain wildcard.
- A new window (beyond `main`) needs either its own capability file or an
  addition to this file's `windows` array, plus its own permission set.
- `$schema` points at `../gen/schemas/desktop-schema.json`, a Tauri-generated
  schema; do not hand-author permission identifiers that schema would reject.

### Testing Requirements

- No dedicated test suite. An invalid or missing permission surfaces at
  runtime as a denied IPC call; verify a changed capability with a manual
  `pnpm dev:app` check of the affected flow.

## Dependencies

None — declarative JSON consumed directly by the Tauri runtime; no Rust or
TypeScript imports.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
