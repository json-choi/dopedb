<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/connections

## Purpose

Saved connection domain rules, validation, and mutation ordering for every
engine DopeDB supports. Per `CLAUDE.md`/`AGENTS.md`, connecting,
reconnecting, importing, or repairing a connection must never change an
existing application's users, roles, passwords, grants, default privileges,
PUBLIC/shared-role ACLs, or object ownership — this feature provisions and
validates DopeDB-owned principals without rewriting pre-existing ones.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Saved connection feature composition. |
| `domain.rs` | Connection domain values and invariants, deliberately unaware of Tauri, SQLite, the keychain, live pools, or the driver installer; owns rules every transport must use. |
| `probe.rs` | Connection probe outcomes: the closed check receipt that never serializes driver text and the database discovery receipt. A refusal made before contacting a server is an optional `refusal` on the receipt: `savedCredentialEndpointChanged`, `retryLater` (network family plus `retryAfterSeconds` from the managed cooldown), or `sharedConnectionChanged` (refresh the workspace). |
| `credential_endpoint.rs` | `same_credential_endpoint`: a saved credential is reused only for the engine, host, port, user, and SSH alias it was saved with, over transport security at least as strong (PostgreSQL/MySQL `sslmode` rank, MongoDB `tls`/`ssl`/`srv` and verification-relaxing options) and, while the stored profile verifies the server, the same CA option. Check, discovery, and save refuse anything else instead of sending or keeping the saved secret. The store applies the same rule to shared member-local bindings against the template endpoint each was bound to, and the workspace binding's keep-password path applies it to a changed user, SSH alias, or TLS file. |
| `application.rs` | Connection use cases; validation and mutation ordering, with concrete SQLite/keychain/driver/pool/Tauri details behind ports. |
| `ports.rs` | Platform ports required by connection use cases. |
| `adapters.rs` | Concrete connection adapters for SQLite, live pool authority, drivers, and keychain. |
| `local_probe.rs` | Credential-free loopback handshakes behind `LocalListenerProbePort`. Each probe opens one allowlisted candidate, identifies the protocol, and closes without authenticating, querying, or reading any client configuration or credential file. |
| `transport.rs` | Tauri transport adapter for connection use cases. |
| `demo.rs` | Creates the bundled, local SQLite learning database used by the first-run Data Source launcher; seeded idempotently under the app-local data directory so opening the demo never overwrites user edits. |

## For AI Agents

### Working In This Directory

- Any new connect/repair/import path must preserve pre-existing application
  users, roles, grants, and ownership; only new DopeDB-owned principals may
  be created or normalized. Stop with a specific diagnostic rather than
  silently widening access when a safe path cannot be established.
- `demo.rs`'s seeding must stay idempotent — never overwrite an existing
  demo database file's user edits.
- A saved local credential is resolved only from the stored profile with the
  same id and only while `same_credential_endpoint` holds; decide that before
  reading the OS credential store, and never relax it for a draft or a save.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

### Common Patterns

- `compose(...)` in `mod.rs` wires `adapters.rs`'s concrete gateways into
  `application::ConnectionUseCases`, following the same shape as `catalog/`.

## Dependencies

### Internal

- Imports `crate::features::catalog` and `crate::kernel::identity`.
- Imported by `crate::features::workspaces` (shared-connection
  publication/binding) and `crate::features::queries`/`crate::connection`
  runtime composition outside this tree.

### External

- `sqlx`, `keyring`, provider driver crates.
- Frontend adapter: `src/features/connections/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
