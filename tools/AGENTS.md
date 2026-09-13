<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# tools

## Purpose
Small, independent Rust binaries (Cargo workspace members alongside
`dopedb-cli`/`dopedb-protocol`) used only by release automation. They sign or
verify ACP adapter release artifacts with Minisign; neither is shipped inside
the Desktop app, and neither has any database, credential-store, or network
dependency beyond the release pipeline that invokes them.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `acp-plugin-sign/` | Non-interactive Minisign signing helper, documented inline below. |
| `release-updater-verify/` | Updater-closure verification tool, documented inline below. |

### `acp-plugin-sign/` (inline)
| File | Description |
|------|-------------|
| `Cargo.toml` | Library + bin crate `acp-plugin-sign`; depends only on `minisign`. |
| `src/lib.rs` | `sign_file(secret_key_path, message_path, signature_path, password)`: non-interactive Minisign support for protected ACP adapter releases. |
| `src/main.rs` | CLI entrypoint calling `sign_file`; used by `scripts/agent-runtime/sign-acp-plugin.mjs` to produce a manifest signature during the ACP adapter release job. |

### `release-updater-verify/` (inline)
| File | Description |
|------|-------------|
| `Cargo.toml` | Bin crate `release-updater-verify`; depends on `minisign-verify`, `base64`, `sha2`, `serde`/`serde_json`, and (dev-only) `acp-plugin-sign` + `minisign` to produce fixtures for its own tests. |
| `src/main.rs` | Verifies a completed release updater closure using the same Minisign `verify(data, signature, true)` semantics as the Tauri updater plugin: checks digest, signature, and asset-set integrity for a release before it can be trusted by the auto-updater. Protected by 4 tests in the repository's 208-test critical budget (`tests/critical-test-budget.json`): "Updater digest, signature, and asset closure integrity plus non-interactive ACP signing and draft-first immutable publication." |

## For AI Agents

### Working In This Directory
- These binaries are release-time tooling, not application code — do not add a runtime dependency from `src-tauri/` or `dopedb-cli/` on either crate.
- `acp-plugin-sign` and `release-updater-verify` deliberately duplicate no signing/verification logic with each other or with the Desktop's own updater-verification path; if you change one Minisign-related invariant, check both crates and the ACP manifest scripts in `../scripts/agent-runtime/` for the matching assumption.

### Testing Requirements
- `release-updater-verify` has its own `cargo test` suite (dev-dependency on `acp-plugin-sign` + `minisign` to build test fixtures); it is one of the crates counted toward the Rust side of `tests/critical-test-budget.json` (see `../tests/AGENTS.md`).
- Neither crate is part of `pnpm test:rust`'s three named test binaries; they are exercised by their own `cargo test` and by the release pipeline invoking the built binaries directly.

### Common Patterns
- Both `main.rs` entrypoints are thin: parse a small set of CLI flags, call one library function, and exit non-zero with a clear message on failure (see `acp-plugin-sign/src/main.rs`).

## Dependencies

### Internal
- Consumed by `../scripts/agent-runtime/sign-acp-plugin.mjs` (signing) and the release pipeline's updater-closure check (verification). See `../agent-runtime/AGENTS.md` for how the ACP plugin build/sign/publish chain fits together.

### External
- `minisign` / `minisign-verify`, `base64`, `sha2`, `serde`/`serde_json`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
