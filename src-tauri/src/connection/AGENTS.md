<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/connection

## Purpose

Connection management: live sqlx pools (a separate read-only pool per
connection), OS credential-store secret storage, and per-provider connection-
string tuning. Long-lived local credentials live only in the OS credential
store; managed credentials are short-lived process-memory leases. The CLI
sees connection ids only, never secrets. A connection UUID alone is never a
cache identity — every pool cache entry is keyed by the exact workspace/
account selection plus connection and binding revisions (see `runtime/`).
Covers `runtime/` inline.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Module overview; re-exports `keychain`, `pool`, `providers` as `pub`, keeps `cloud_sql_proxy`, `provider_local`, `remote_authority`, `runtime` crate-private. |
| `keychain.rs` | Connection secrets in the OS credential store (macOS Keychain / Windows Credential Manager via `keyring` 4). Service = bundle id, account = connection id; `app.db` holds only a `secret_ref`, never a cleartext password. A zeroizing process-session cache avoids reopening the OS store per query/membership request, with the OS store remaining the at-rest authority. **Production requires a signed build** — unsigned/ad-hoc builds can both hit platform credential-store failures (e.g. macOS `errSecMissingEntitlement -34018`) and accidentally prompt for the installed production app's items, so debug builds use only an obfuscated file under the isolated dev app-data dir and never open the production credential-store namespace. |
| `pool.rs` | Live connection pools. A write-capable `LiveConnection` holds a mutation pool and a separate read-only pool; a read acquisition holds only the read-only pool. The read-only pool is the first line of L2 enforcement at the connection level, though the authoritative boundary remains the per-request read-only transaction the executor opens (Postgres: `default_transaction_read_only = on` via `after_connect`; MySQL: `SESSION transaction_read_only = 1`; SQLite: a second handle opened `read_only(true)`, file-level and unforgeable). |
| `providers.rs` | Per-provider connection-string normalization. DopeDB does not bundle any external CA files — a custom CA is supplied per connection via `extra_params["sslrootcert"]` (documented, not shipped). |
| `provider_local.rs` | Secret-free authority and local credential resolution for imported providers. The control plane supplies only a narrow, expiring resource target; a provider feature supplies the local resolver and may return either the profile's OS-keyring secret or an ephemeral zeroizing secret. Neither the runtime cache nor the remote authority contract can carry a credential. |
| `remote_authority.rs` | Object-safe remote authority contract injected into the connection pool runtime. |
| `cloud_sql_proxy.rs` | Bundled Cloud SQL Auth Proxy transport. The proxy is pinned into the signed application bundle; each database pool gets one loopback-only proxy process and one short-lived IAM access token — no mutable-PATH binary or authorized-network firewall exception is part of the connection path. |
| `ssh.rs` | System OpenSSH tunnel transport. DopeDB owns only the forwarding process and its lifetime; identity, keys, passphrases, agents, ProxyJump, and host-key policy remain in the user's own OpenSSH configuration — a profile stores one non-secret `~/.ssh/config` Host alias and never accepts key paths or SSH credentials directly. |
| `runtime.rs` | Scope-pinned authorization, single-flight pool creation, and managed-lease retirement shared by UI, introspection, and agent transports. The parent module file for `runtime/authority.rs`, `runtime/cache.rs`, and (via `#[path]`) the sibling files `runtime_context.rs`, `runtime_manager.rs`, `runtime_policy.rs`. |
| `runtime_context.rs` | Connection context admission, leasing, and exact-scope authorization (included into the `runtime` module via `#[path]`). |
| `runtime_manager.rs` | Connection manager lifecycle and provider revocation integration (included into the `runtime` module via `#[path]`). |
| `runtime_policy.rs` | Provider-managed database policy verification (included into the `runtime` module via `#[path]`, 657 lines — the largest file in this directory). |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `runtime/` | Two of `runtime.rs`'s submodules live here as separate files (see below); the other three (`runtime_context.rs`, `runtime_manager.rs`, `runtime_policy.rs`) are siblings of `runtime.rs` mapped in via `#[path]`, not a subdirectory. |

`runtime/authority.rs`: provider-local and managed-pool authorization at the
runtime boundary — remote RBAC is checked before a provider target is
fetched, and the local provider binding is pinned independently before every
cache hand-off, so only a genuinely new pool may ask the provider feature to
resolve a secret. `runtime/cache.rs`: cache identity and retirement lifecycle
for scope-pinned database pools — the runtime owns cache admission, while
this module owns only the immutable key, generation-aware slot, expiry task,
and last-lease retirement mechanics.

## For AI Agents

### Working In This Directory

- Never let a database pool be cached by connection UUID alone — every cache
  key must include the exact workspace/account selection plus connection and
  binding revisions (`runtime/cache.rs`), or a scope switch could read/write
  through a pool authorized for a different account.
- A `ConnectionLease` retains the scope read gate for its whole operation
  lifetime specifically so adapters cannot switch scope mid-operation and
  write history/cache into a different account — preserve that when adding a
  new scoped-write API.
- `keychain.rs`'s debug-build fallback (obfuscated file under the isolated dev
  data dir) must never be reachable from a production/signed build path, and
  must never open the production OS credential-store namespace.
- `cloud_sql_proxy.rs` and `ssh.rs` must not accept a raw key, passphrase, or
  long-lived credential from the app UI — Cloud SQL access goes through a
  short-lived IAM token per pool, and SSH access goes through the user's own
  `~/.ssh/config` Host alias and system `ssh` binary only.
- `providers.rs` must not bundle a CA file; a custom CA stays an opt-in
  per-connection `extra_params["sslrootcert"]` value.

### Testing Requirements

- Covered indirectly by `pnpm test:rust` (`cargo test --package dopedb --lib`); four files in this module hold `#[cfg(test)]` blocks, none separately tracked in `tests/critical-test-budget.json`.

## Dependencies

### Internal

- Backs `../introspect`, `../executor`, `../mongo`, `../bigquery`, and most of
  `../features/connections`/`../features/providers`; scope authority comes
  from `../kernel::access`; secrets never reach `../store`.

### External

- `sqlx` (postgres/mysql/sqlite pools), `keyring` (OS credential store),
  `zeroize` (secret hygiene), `dashmap` (pool cache), `sqlparser`, `futures`,
  `tokio`, `chrono`, `uuid`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
