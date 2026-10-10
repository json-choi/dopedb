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
| `mod.rs` | Module overview; re-exports `keychain`, `pool`, `providers` as `pub`, keeps `cloud_sql_proxy`, `mysql_session`, `pg_session`, `provider_local`, `remote_authority`, `runtime` crate-private. |
| `keychain.rs` | Connection secrets in the OS credential store (macOS Keychain / Windows Credential Manager via `keyring` 4). Service = bundle id, account = connection id; `app.db` holds only a `secret_ref`, never a cleartext password. A zeroizing process-session cache avoids reopening the OS store per query/membership request, with the OS store remaining the at-rest authority. **Production requires a signed build** — unsigned/ad-hoc builds can both hit platform credential-store failures (e.g. macOS `errSecMissingEntitlement -34018`) and accidentally prompt for the installed production app's items, so debug builds use only an obfuscated file under the isolated dev app-data dir and never open the production credential-store namespace. |
| `pool.rs` | Live connection pools. A write-capable `LiveConnection` holds a mutation pool and a separate read-only pool; a read acquisition holds only the read-only pool. The read-only pool is the first line of L2 enforcement at the connection level, though the authoritative boundary remains the per-request read-only transaction the executor opens (Postgres: `default_transaction_read_only = on` via `after_connect`; MySQL: `SESSION transaction_read_only = 1`; SQLite: a second handle opened `read_only(true)`, file-level and unforgeable). PostgreSQL/MySQL pools probe a connection on acquire only after it idled ≥15 s (sqlx already pings on release). Because a user-defined function called by a "read" can turn the read-only default off for the rest of the session (PostgreSQL `set_config` inside a function; a MySQL stored function running `SET SESSION transaction_read_only = 0` — a plain MySQL `SELECT` cannot assign a system variable, and L1 blocks `SET` and direct `set_config` calls), both read pools restore it in sqlx `after_release` and close a connection that cannot take it instead of reusing it. The connect and release plans live in `pg_session.rs` and `mysql_session.rs`; connecting adds no round trip. Cost: one extra round trip per release, run in sqlx's spawned release task before its own release ping — off the caller's path, but a burst of back-to-back reads may wait about one round trip longer for that connection or open another one up to the pool limit. |
| `mysql_session.rs` | MySQL read-pool connect and release plan (`MySqlReadSession`). Connect: `SESSION transaction_read_only = 1` (MariaDB before 11.1: `tx_read_only`; a server with neither is refused), then the startup script. Release, one message: `ROLLBACK` (a silent no-op outside a transaction), `SET SESSION max_execution_time = DEFAULT` (the L2 Agent read sets a 15 s session limit that must not reach a later Desktop read), the read-only re-assert, then the startup script again. A server refusal of that message (MariaDB has no `max_execution_time`; a proxy may refuse two statements per message) closes that connection and moves the pool to `ROLLBACK; <read-only>`, then to the read-only `SET` alone; connection loss never downgrades it. Named locks (`GET_LOCK`) are not released. |
| `pg_session.rs` | PostgreSQL connect and release plans (`PgSessionPlan`, one per pool). Connect: the managed schema owner policy (`gcp_schema_policy::prepare`), then on the read pool `default_transaction_read_only = on` as its own statement (a rejected best-effort setting can never roll it back), best-effort `client_connection_check_interval` (14+) and, on the read pool, `synchronize_seqscans = off` in one simple-protocol round trip with a per-statement fallback, then the startup script; no release step runs at connect (a fresh connection is clean). Read-pool release batch (one simple-protocol message, so one implicit transaction where any failure closes the connection): a guard `SELECT CASE WHEN now() = statement_timestamp() THEN 1 ELSE <error> END` that fails only when the connection is still inside a transaction an earlier message opened (silent otherwise — unlike a bare `ROLLBACK`, it writes no "no transaction in progress" WARNING to the client or the server log; the anomalous case logs one ERROR and closes the connection, so the server rolls back), `SET default_transaction_read_only = on`, `pg_advisory_unlock_all()` (a session advisory lock taken by a read, the Agent's L2 read included, never outlives it and cannot block an application), the exact connect-time role (`SET ROLE` to the managed schema owner, otherwise `RESET ROLE`; startup scripts cannot set a role) and `search_path` (`public` as the managed schema policy requires, otherwise `RESET`), then the startup script again (only allowlisted literal `SET`s, which also ran last at connect). The batch is all-or-nothing, so the pool settles it lazily: the first release tries the full batch; if that fails, the connection is closed and the next release probes each optional step alone (guard, advisory unlock, role, `search_path`; a guard failure is followed by a bare `ROLLBACK`, which also ends the transaction the guard's error aborted, and one retry, so a connection left inside a transaction is told apart from a server whose `now()` differs from `statement_timestamp()` even in a fresh transaction — that server's batch starts with the same `ROLLBACK` instead of the guard, warning only in its server log, rather than closing every connection) and keeps the batch without the steps the server lacks. The read-only default is never optional. Other settings a function changes outside that list (for example `statement_timeout` without a startup script) are not reset. **Transaction-mode poolers** (`providers::pg_transaction_pooler`, exposed as `LiveConnection::transaction_pooler`): consecutive transactions may run on server sessions other clients share, so a session `SET` neither sticks nor stays private. Detection: a `pooler.supabase.com` host on port 6543 (Supavisor transaction mode; its 5432 port is session mode and keeps the normal path), a Neon pooled endpoint (`-pooler.` host under `neon.tech`, PgBouncer in transaction mode), or the explicit profile parameter `extra_params["dopedb.transactionPooler"] = "true"` for any other transaction-mode pooler (PgBouncer, RDS Proxy, …) DopeDB cannot recognize by host. For those profiles both pools skip every DopeDB session statement — the read-only default, the best-effort defaults, the startup script — and the read pool's release runs only the transaction guard; every read must open its own `BEGIN READ ONLY … ROLLBACK` (the L2 Agent/Article paths and manual transactions already do). Other profiles keep the session-default fast path. |
| `providers.rs` | Per-provider connection-string normalization. DopeDB does not bundle any external CA files — a custom CA is supplied per connection via `extra_params["sslrootcert"]` (documented, not shipped). `pg_transaction_pooler` recognizes transaction-mode poolers (see `pg_session.rs`; opt in with `extra_params["dopedb.transactionPooler"] = "true"`), and every such profile — not only a Supavisor host — disables the SQLx statement cache, because a transaction pooler (PgBouncer before 1.21 included) can hand the next transaction to a server session without this client's named prepared statements. |
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
- Manual transaction sessions (`features/queries/manual_transaction*`) are the
  one deliberate exception to holding a lease for a session's whole lifetime:
  the session keeps one dedicated connection across statements, but every
  statement and the COMMIT re-pin scope generation, binding/connection
  revisions and write authority under the operation scope read guard before
  touching the target, and a scope, binding or provider change revokes the
  session with a rollback. Do not copy this shape into other APIs.
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
