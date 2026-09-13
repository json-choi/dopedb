<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri

## Purpose

The Rust/Tauri v2 core of the DopeDB desktop app: the `dopedb` crate (library
name `app_lib`), its Tauri manifests for the production/dev/benchmark/Windows
variants, macOS signing inputs, bundled resources, and the window-permission
capability set. The frontend (`../src/`) never talks to a database or a
provider API directly — every one of those paths is implemented here and
exposed to the renderer only through `#[tauri::command]` transports.

## Key Files

| File | Description |
|------|-------------|
| `Cargo.toml` | Crate manifest. Package `dopedb`, lib name `app_lib` (staticlib/cdylib/rlib), bin `dopedb` (`src/main.rs`). Declares the `packaged-benchmark` feature (isolated release-profile benchmark harness; never compiled into ordinary production artifacts). |
| `build.rs` | Runs `tauri-build` without the default Windows app manifest, then embeds `windows-app-manifest.xml` via linker args on MSVC so both the GUI binary and Rust test binaries share one manifest resource. |
| `tauri.conf.json` | Production manifest. Identifier `dev.dopedb.desktop`, strict CSP (no `unsafe-eval`, `script-src 'self'`), bundled sidecars (`dopedb-cli`, `dopedb-agent-bridge`, `cloud-sql-proxy`), bundled `resources/`, minisign updater pubkey, GitHub Releases updater endpoint. |
| `tauri.dev.conf.json` | Dev overlay merged onto `tauri.conf.json`. Identifier `dev.dopedb.desktop.dev`, product name "DopeDB Dev", separate deep-link scheme (`dopedb-dev`), updater disabled. Keeps the dev app's data root, credential-store namespace, and deep-link scheme isolated from the installed stable app. |
| `tauri.benchmark.conf.json` | Overlay for the release-profile packaged benchmark harness. Identifier `dev.dopedb.desktop.benchmark`, ad-hoc `signingIdentity: "-"`, updater disabled, builds via `scripts/build-packaged-benchmark.mjs`. Only meaningful together with the `packaged-benchmark` Cargo feature. |
| `tauri.windows.conf.json` | Windows-specific window/bundle overlay (NSIS target, webview bootstrapper, Mica/Acrylic window effects, installer icon/language selector). |
| `sign-dev.sh` | Signs the locally built dev binary with a stable code-signing identity (existing "Apple Development" identity, else a persistent self-signed fallback) so macOS Keychain "Always Allow" grants survive rebuilds. Runs automatically from `pnpm tauri:dev`/build; can be invoked manually as `bash src-tauri/sign-dev.sh [path-to-binary]`. |
| `entitlements.plist` | macOS hardened-runtime entitlements: `com.apple.security.cs.allow-jit` (required by the WKWebView JS engine under hardened runtime) and no App Sandbox (the app must fork/exec a user-installed CLI such as `codex` from an arbitrary `PATH`, which the sandbox forbids). |
| `windows-app-manifest.xml` | Declares the Common Controls v6 dependency for the Windows binary (embedded by `build.rs`). |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `benchmarks/` | Checked-in benchmark summary/budget JSON artifacts (see `benchmarks/AGENTS.md`). |
| `binaries/` | Gitignored, locally fetched sidecar binaries (`dopedb-cli`, `dopedb-agent-bridge`, `cloud-sql-proxy`) matching `tauri.conf.json`'s `externalBin`. Not tracked; skipped here. |
| `capabilities/` | Tauri v2 window permission manifest (see `capabilities/AGENTS.md`). |
| `gen/` | Tauri-generated schemas (e.g. `gen/schemas/desktop-schema.json`) referenced by `capabilities/default.json`. Generated output; not documented here. |
| `icons/` | App icon set (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`) referenced by `tauri.conf.json`'s `bundle.icon` and `tauri.windows.conf.json`'s NSIS `installerIcon`. |
| `resources/` | Bundled runtime resources: Skill manifests, third-party licenses, and the ACP agent-runtime catalog (see `resources/AGENTS.md`). |
| `src/` | The `dopedb`/`app_lib` Rust source tree (see `src/AGENTS.md`). |

## For AI Agents

### Working In This Directory

- Three product identifiers coexist by design: `dev.dopedb.desktop` (stable),
  `dev.dopedb.desktop.dev`, and `dev.dopedb.desktop.benchmark`. Each variant
  gets its own OS app-data root (see `src/app_paths.rs`) so a dev or benchmark
  build can never open the production credential store, `app.db`, or plugin
  state. Do not merge these identifiers or their data roots.
- The production CSP (`tauri.conf.json` → `app.security.csp`) is intentionally
  narrow (`script-src 'self'`, no `unsafe-eval`, a fixed `connect-src`
  allowlist). Any new outbound frontend request needs an explicit CSP entry,
  not a wildcard.
- `entitlements.plist` deliberately omits the App Sandbox; do not add it back
  without re-solving how the app forks/execs user-installed CLIs.
- Version and identifier values in `Cargo.toml`/`tauri.conf.json` are release
  inputs — see the root `CLAUDE.md`/`AGENTS.md` release rules before touching
  them.

### Testing Requirements

- `pnpm test:rust` runs `cargo fmt --all -- --check`, the `dopedb` lib test
  suite, the `dopedb-protocol` golden test, and the `dopedb-cli`
  `terminal_session_e2e` test. Run it for any change under `src-tauri/`.
- A UI-visible change under this crate also needs a manual `pnpm dev:app`
  check per the root `AGENTS.md` validation rules.

## Dependencies

### Internal

- `../dopedb-protocol`: the wire-contract crate shared with the frontend and
  `dopedb-cli` (path dependency in `Cargo.toml`).
- `../src` (frontend): consumes this crate's `#[tauri::command]` surface via
  `invoke`; `frontendDist` in `tauri.conf.json` points at `../dist`.

### External

- `tauri` 2 (`macos-private-api`), `tauri-build`, and the `tauri-plugin-*`
  family (`dialog`, `opener`, `updater`, `process`, and on
  macOS/Windows/Linux `deep-link`, `single-instance`).
- `sqlx` 0.9 (postgres/mysql/sqlite, rustls TLS), `mongodb`, `sqlparser`,
  `keyring`, `chacha20poly1305`/`zeroize`/`subtle` for credential handling.
- `agent-client-protocol`, `minisign-verify`, `reqwest` (rustls) for the ACP
  runtime and hosted control-plane traffic. Full list in `Cargo.toml`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
