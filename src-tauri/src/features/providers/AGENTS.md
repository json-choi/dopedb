<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/providers

## Purpose

Member-local provider credentials (GCP/Neon/PlanetScale) and the
provider-neutral managed-access provisioning lifecycle. Per `CLAUDE.md`, this
feature must never change an existing application's users, roles, passwords,
grants, default privileges, PUBLIC/shared-role ACLs, or object ownership; it
provisions only new, verifiably DopeDB-owned principals and stops with a
specific diagnostic when safe access cannot be established. All provider
traffic goes through an official CLI binary or an authenticated hosted
control plane — never a directly-called provider API with a stored token.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Two-phase composition: `prepare(store, operation) -> ProviderComposition` exposes only the provider-local connection port needed to build the connection runtime (no callable feature yet); `ProviderComposition::finish(revocation, provisioning_runtime) -> ProvidersFeature` completes it atomically with hosted authority, the credential vault, and the three provisioning drivers, so no partially-initialized `ProvidersFeature` can exist. |
| `domain.rs` | Pure contracts for member-local hosted-provider credentials; secrets never appear here — accepted only by transport, immediately wrapped in `Zeroizing`, and live in the credential vault. |
| `ports.rs` | Platform ports for provider credential use cases (`ProviderBindingRevocationPort`, `ProvisioningRuntimePort`). |
| `application.rs` | Provider credential use cases with hosted authority revalidation. |
| `transport.rs` | Tauri boundary for member-local provider credentials; the renderer gets only redacted inventory, binding state, and opaque receipt ids — device identity and receipt ownership stay process-local, provider family/generation are never renderer-selected. |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `adapters/` | Concrete hosted authority, SQLite, OS credential storage, receipt registry, and fail-closed GCP verifier adapters. |
| `provisioning/` | Provider-neutral managed-access provisioning contracts and the three concrete drivers (GCP, Neon, PlanetScale). |

**`adapters/`**

| File | Description |
|------|-------------|
| `mod.rs` | Concrete provider adapters: hosted authority, SQLite, OS credential storage, process-local receipts, and fail-closed verifier clients (module root). |
| `authority.rs` | Hosted provider-integration authority adapter; the webview never supplies a provider family/generation/token — inventory and exact revalidation come from the authenticated control plane immediately before a local credential is staged/committed. |
| `authority_tests.rs` | **Part of the 208-test critical budget** (`tests/critical-test-budget.json`): 4 tests protecting inventory authority, duplicate-key-safe CLI JSON/exit status, literal fixed argv, Unicode/path/executable drift rejection, exact managed-target/connection-pinned receipts, cross-workspace/account scope CAS, restart-safe recovery, deterministic partial-destroy repair, and Provider-audit hash-chain correlation. |
| `keychain_vault.rs` | Provider-only Keychain/Credential Manager vault with no debug file fallback. |
| `local_connection.rs` | Provider-local connection resolution with a secret-free binding hand-off; provider metadata comes only from an audited official CLI. Neon has no supported local management CLI, so Neon connections use the workspace's managed-lease path instead of reading an API key in Desktop. |
| `provisioning_authority.rs` | Authenticated, secret-free target authority for Managed Access planning. |
| `receipt_registry.rs` | Bounded one-use provider credential receipt registry (`InMemoryProviderReceiptRegistry`). |
| `sqlite_bindings.rs` | Provider-owned SQLite persistence for local credential bindings; the table stores only an opaque OS-keyring reference and redacted verification evidence — never provider tokens or raw discovery responses. |
| `sqlite_repository.rs` | SQLite adapter for local provider binding metadata. |
| `gcp_adc/` | Fail-closed Google ADC (Application Default Credentials)/WIF verifier — see below. |
| `sqlite_bindings/` | Typed row projection for the SQLite bindings table — see below. |

**`adapters/gcp_adc/`** — the adapter accepts only a deliberately small ADC/WIF subset; it opens the selected credential as a no-follow regular file, runs the fixed `gcloud auth application-default print-access-token` command in a scrubbed environment, and ADC contents never escape this module. A verified ephemeral bearer token may leave only through the non-serializable connector carrier consumed by the bundled Cloud SQL Auth Proxy.

| File | Description |
|------|-------------|
| `gcp_target.rs` | Exact Cloud SQL target proof for a local GCP WIF receipt. |
| `process_group.rs` | Process-group lifecycle fencing for the fixed `gcloud` child. |
| `subject_token.rs` | No-follow, bounded ADC and WIF subject-token file handling. |
| `subject_token/cleanup.rs` | Descriptor-rooted cleanup for private gcloud snapshots on macOS/Linux; every mutation is relative to an already-opened directory descriptor, and a path is used only once (`O_NOFOLLOW`) to open the random root and its parent. |
| `target_access.rs` | Hardened ADC token hand-off for one immediately bounded Cloud SQL request; owns the short-lived bearer token while verifying the exact target, then moves it into the non-serializable connector carrier — provider bindings and persistent profiles can never observe it. |

**`adapters/sqlite_bindings/`**

| File | Description |
|------|-------------|
| `sqlite_binding_rows.rs` | Typed projection of redacted provider-binding SQLite rows. |

**`provisioning/`** — concrete Provider adapters may discover targets and translate closed actions into fixed CLI/API calls, but cannot invent lifecycle states, declare Managed Access ready early, or persist credential material here.

| File | Description |
|------|-------------|
| `mod.rs` | Provider-neutral managed-access provisioning contracts (module root and the invariant above). |
| `domain.rs` / `domain_plan.rs` / `domain_receipt.rs` | Pure, secret-free provisioning plan and receipt state machines. |
| `shared.rs` | Shared, provider-neutral managed-access lifecycle mechanics — hashing, plan shape, connection-pin validation, ownership, and smoke-step completeness in one contract so the three adapters cannot drift through copied scaffolding. |
| `application.rs` | Provider-neutral orchestration over durable Operations and provisioning receipts (`ProvisioningCoordinator`). |
| `application_execution.rs` | Provisioning execution, cancellation, and runtime recovery. |
| `application_model.rs` | Provisioning driver contracts and transport projections. |
| `application_tests.rs` | Provisioning restart and resume contract coverage. |
| `repository.rs` | Active-scope and revision-fenced SQLite provisioning receipt repository. |
| `process.rs` | Fixed-binary, fixed-argv provider CLI boundary; raw stdout stays bounded and process-local, the caller gets only a schema-checked JSON value and must still independently verify the exact Provider/DB target before advancing a receipt to `Ready`. |
| `process_tests.rs` | Provider CLI process-boundary contract coverage. |
| `gcp.rs` | Complete GCP Cloud SQL managed-access verification lifecycle; keyless WIF and least-privilege database bootstrap, `gcloud` independently proves member-visible project/instance/database identity, the connection runtime validates one uncached short-lived lease — no Google token or database credential crosses this module. |
| `gcp_cli.rs` | Strict, read-only Google Cloud CLI inventory for detect/discover only; apply/verify/issue/reconcile/owned-destroy stay behind the approved plan and hosted target authority. |
| `neon.rs` | Neon managed-access lifecycle; no member-local login prerequisite — the encrypted project-scoped API key stays in the workspace service, every discovery/apply/drift/destroy revalidates that server-owned authority, Desktop receives only a secret-free target pin and one uncached short lease. |
| `planetscale.rs` | Complete PlanetScale managed-access lifecycle; the official CLI proves the member's local OAuth visibility during discovery, the workspace service owns API validation/revocation, the connection runtime opens one uncached short-lived smoke-verification lease. |
| `planetscale_cli.rs` | Strict, read-only PlanetScale CLI inventory; runtime credentials are never issued through this boundary — `pscale` proves local OAuth visibility only. |
| `planetscale_cli_tests.rs` | Inline `assert_planetscale_cli_contract()` covering CLI failure classification (auth required, MFA required, permission denied, rate limited, network unavailable). |
| `test_support.rs` | Shared fake/mock harness for provisioning driver tests. |

## For AI Agents

### Working In This Directory

- Preserve pre-existing application users/roles/grants/ownership on every
  provision/repair/destroy path; a connection or repair approval is not an
  access migration. Provision only new DopeDB-owned principals and stop with
  a specific diagnostic when safe access cannot be established.
- Never call a provider's API directly with a stored token; go through the
  official CLI (`gcp_cli.rs`, `planetscale_cli.rs`) or the authenticated
  hosted control plane (`neon.rs`, `authority.rs`).
- ADC/WIF material must stay inside `adapters/gcp_adc/`; a verified bearer
  token may only move through the non-serializable connector carrier, never
  through a serializable DTO, binding row, or log.
- `sqlite_bindings.rs` may persist only an opaque OS-keyring reference and
  redacted verification evidence — never a raw token or discovery response.
- A `ProvidersFeature` cannot exist half-built: build new runtime
  dependencies through `ProviderComposition::finish`, not a second
  incremental setter.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).
  `adapters/authority_tests.rs` is part of the repository's 208-test
  critical budget (`tests/critical-test-budget.json`) — replace a
  lower-value test rather than adding a new one there without an explicit
  user request.

### Common Patterns

- Two-phase composition (`prepare` → `finish`) to break a dependency cycle
  with `crate::connection`, documented directly in `mod.rs`; prefer this
  over a late-bound `Option`/`OnceCell` holder when a similar cycle appears
  elsewhere.
- All three provisioning drivers (`gcp.rs`, `neon.rs`, `planetscale.rs`)
  share one state-machine contract via `provisioning/shared.rs` — implement
  a new provider driver against that contract rather than copying an
  existing driver's scaffolding.

## Dependencies

### Internal

- Imports `crate::features::workspaces` and `crate::kernel::{access, identity, sync}`.
- Imported by `crate::features::queries` is not observed; consumed by
  `crate::connection` (provider-local connection resolution) outside
  `features/`.

### External

- `keyring`, `reqwest`, `sqlx`, `zeroize`/`subtle`, `x509-parser`, `libc`
  (Unix `O_NOFOLLOW` handling in `gcp_adc/`), `tokio`.
- Frontend adapter: `src/features/providers/tauriAdapter.ts` — also has 6
  tests in the 208-test critical budget
  (`src/features/providers/tauriAdapter.test.ts`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
