# DopeDB Project Guide

This is the single maintained project document for DopeDB. Keep the root README files short and update this file when architecture, release, or safety behavior changes.

## Product

DopeDB is an open-source shared database access workspace for teams and AI
agents. The hosted workspace owns secretless connection identity, membership,
policy, provider resources, revisions, and collaboration audit. The Tauri
desktop app is the local execution and approval console: database traffic stays
on the member's machine, credentials stay member-local or arrive as
least-privilege short-lived leases, and official Claude/Codex ACP Agents run in
exact Project-resource-pinned sessions through an app-only typed bridge without
receiving raw credentials. The same official local AI CLIs can run outside the
window only through a visible Desktop-approved `dopedb agent start` session. The
canonical market promise and public claim boundary live in
[Product Positioning](./PRODUCT_POSITIONING.md).

Current scope:

- Desktop app: Tauri v2, Rust core, React UI, Vite
- Landing site: Next.js under `site/`, hosted at https://dopedb.dev
- Workspace control plane: Next.js under `workspace-cloud/`, hosted separately at
  `app.dopedb.dev`
- Databases: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, and read-only BigQuery
- Agent runtime: exact Project-resource-pinned Claude/Codex ACP sessions,
  Desktop-approved external official CLI sessions, plus an explicit Settings →
  Command line advanced Shell PTY path
- Shared access: team workspaces, roles, invitations, secretless connection
  templates, member-local bindings, and managed PlanetScale, Neon, and GCP Cloud
  SQL credential issuance
- Local tools: owner-local UDS/named-pipe Broker, the optional public `dopedb`
  CLI with secret-free Project setup, and a separately bundled app-only Agent
  bridge
- Distribution: GitHub Releases and Tauri updater metadata

The shipped workspace core and the remaining grant administration, provider
lifecycle, sync, recovery, Analysis Article validation, and Agent-runtime work are tracked in
the [Workspace Collaboration Roadmap](./WORKSPACE_ROADMAP.md). The app is still
an alpha; that roadmap, not landing copy, determines what may be described as
complete.

## Architecture

The Rust core owns the trust boundary:

- `driver/`: driver catalog, compatibility/recommendation, install state, and runtime dispatch
- `connection/`: connection profiles, concrete pools, provider tuning, and OS credential-store-backed secrets
- `safety/`: SQL classification, read-only enforcement, preview, and approval policy
- `executor/`: read execution and gated write execution
- `audit/`: query history and hash-chained audit records
- `kernel/access.rs`: workspace/account/connection pins shared across domains without
  making persistence their owner
- `features/<domain>/`: transport-neutral use cases and facades, domain-owned ports,
  and concrete adapters; transports translate requests but do not call sibling transports
- `services/`: the composition root that wires concrete adapters into cloneable feature facades
- `operations/`: immutable exact-payload plans, approvals, claims, and lifecycle receipts
- `features/agents/acp.rs` and `features/agents/acp/`: one serialized ACP session actor
  plus injected process, persistence, Knowledge-scope, and desktop-event ports
- `dopedb-protocol::acp_plugin`: closed Claude/Codex plugin IDs and the signed
  adapter catalog wire shape
- `broker/`: owner-local, versioned UDS/named-pipe control messages for the CLI
  and typed Agent bridge
- `cli_install.rs`: immutable sidecar resolution plus explicit per-user CLI/PATH installation
- `skills/`: bounded inventory plus atomic Codex/Claude Code Skill install, repair,
  backup, and removal
- `features/terminals/`: optional developer PTY runtime and process-tree cleanup;
  its only Desktop entry is the explicit Settings → Command line advanced Shell
  dialog, and it is not the ACP Agent execution path
- `store/`: local SQLite app store under the platform app data directory; feature-owned
  repositories such as Knowledge keep their SQL adapters inside the owning feature

The React application follows the same ownership direction. `features/` owns reducers,
query keys, external stores, workflow controllers, and transport adapters. `screens/` and
Cloud views render those controllers and never become dependencies of feature code.
`AppShell` composes one discriminated navigation state, while the ACP session store owns
the shared list/event projection. Cold workbench screens load behind one `React.lazy`
boundary so they do not inflate the startup entry.

The hosted control plane keeps HTTP routes thin. The current compact Analysis Article
payload is defined in `dopedb-protocol`, mirrored by the Cloud contract module, and
verified against one golden fixture plus representative semantic-rejection mutations.
The corpus protects named cross-language invariants but is not an exhaustive proof that
independent parsers are equivalent. Every stored definition, completion envelope, and
public response uses the current sanitized-HTML-plus-one-query shape. Provider routes parse and authorize
transport input, then delegate to provider-owned application workflows; provider
persistence and provider API adapters stay behind that application boundary.

The frontend renders database state and approval decisions. It does not own the safety decision.
Writes and DDL require an immutable Operation proposal, an exact stored approval, and
`allow_writes = true`; transports cannot approve a replacement SQL payload.

The Local Broker is the only database path for both the public `dopedb` CLI and the
app-only Agent bridge. Public `version`, `status`, and `app open` calls do not carry a
reusable secret. Database commands require an ephemeral in-memory capability pinned to
one workspace/account and exact resource revision set. ACP `session/new` and `session/load` attach a
session-local typed stdio MCP server implemented by the exact bundled Agent bridge. Each
tool maps bounded JSON directly to a protocol `CommandSpec` and `BrokerClient`; it does
not invoke a shell, public CLI parser, or another CLI process per tool call. `query_read`
still performs the Broker's exact plan request followed by its single-use run request,
but exposes that safety sequence as one MCP round trip. Catalog search is evaluated while
the canonical snapshot remains inside Desktop and returns only a bounded compact match set,
so a wide schema cannot overflow the local Broker frame.

The ACP server description contains no capability or credential, and the MCP child never
receives the bearer capability. Desktop pins a closed Claude/Codex adapter descriptor,
the launcher invocation path, its canonical resolved target, and the target SHA-256 when it
issues an Agent bootstrap session. Keeping the invocation path preserves shim dispatch such
as Volta's `npx`, while pinning the resolved target prevents a symlink swap.
The Agent bridge scrubs the inherited bearer before its first await, re-verifies that
descriptor, and uses the capability exactly once to bind its OS process id and start marker.
The Broker atomically zeroizes the bootstrap token and changes the session to process-bound
authentication. The transitional package names and versions come from the private bridge's
closed plugin-ID mapping, not launcher arguments. Unix replaces the bridge with the adapter;
Windows may retain the bridge as the ancestry root, but neither it nor the adapter environment
retains a usable bearer. The Broker accepts tokenless Agent requests only from that process or
a verified descendant. The global discovery file contains only runtime metadata. The app opens
no Agent HTTP or TCP listener.

The public CLI also supports an external official Agent without installing a
general MCP endpoint. `dopedb agent init` asks Desktop to choose one Project's
databases, BigQuery resources, source revisions, and at most one write target, then writes
only those stable identifiers to `.dopedb/agent.json`. `dopedb agent start` shows that
exact current set for Desktop approval, pins the requester's PID/start marker directly,
and launches the user's locally authenticated official `codex` or `claude` CLI with an
ephemeral stdio MCP definition. No bearer is generated or returned; descendants receive
only the runtime path, session identifier, and process-bound marker. The parent scrubs any
inherited Terminal bearer and revokes the session when the provider exits.

Stable builds also reconstruct a pinned Node LTS executable for each release
target from the official archive SHA-256 and bundle only that executable, its
license, manifest, and SPDX SBOM as a read-only Tauri resource. npm, npx, and
provider native binaries are not part of this core runtime. The signed adapter
installer and activation path are tracked separately; until that service
replaces the launcher, the private bridge retains its closed transitional npx
mapping. See the [ACP plugin runtime contract](./contracts/acp-plugin-runtime.md).

The stdio server continues reading MCP notifications while one serialized database tool
is active. Cancelling a `query_read` aborts the tool future and sends `query.cancel` with
the exact plan id when planning has completed. A persisted conversation whose adapter is
no longer owned by the current Desktop runtime is projected as closed/resumable instead
of exposing a stop control for a process that does not exist.

The repository-owned, optional external-CLI Skill source is `skills/dopedb-cli/`. Build verification records
exact and normalized hashes in versioned bundled manifests. The installed Skill is a
small discovery stub; `dopedb skills get dopedb-cli --full` returns the exact guide and
references embedded in that app version without contacting the network. Built-in AI Chat
does not load or require this Skill; its session prompt and typed MCP tools are authoritative.
Inventory scans
are bounded and reject symlinks/reparse points. Only a known, byte-exact managed snapshot
may be updated or removed automatically; repair preserves every conflicting directory.

## Agent Sessions and CLI Behavior

Opening an AI Chat starts the official Claude Agent or Codex ACP adapter and pins the
session to the selected workspace, account, exact Project resource revisions, optional
single write target, and database policy.
The app discovers only numbered, immutable stable ACP bundle releases; candidate tags
are never selected by normal clients. A signed manifest must point back to the exact
stable release that supplied it, and a missing newest release falls back only across a
bounded list of older stable tags. Adapter publication therefore stays independent of
app, CLI, and Skill versions without relying on a mutable GitHub Release alias.
The Desktop exposes AI Chat, approval, result, and recovery surfaces rather than a
general shell tool window. The optional developer PTY is an explicit advanced dialog
under Settings → Command line, not the ACP execution path. A connection, account,
membership, or authority change revokes every related ACP, Broker, and PTY session instead
of silently retargeting it. Child environments exclude database URLs, provider secrets,
API keys, and OS credential-store values. Provider authentication remains owned by the
user's local `claude` or `codex` login.

Outside built-in AI Chat, the signed `dopedb` CLI discovers an owner-only Unix socket or
Windows named pipe. Direct database commands require either the ephemeral
connection-pinned capability of the explicit advanced Terminal or the exact
Project-resource capability of a Desktop-approved `dopedb agent start` process tree.
The protocol's `TerminalSession` authority binds both explicit advanced terminals and
Desktop-approved Agent process trees. A capability is never a database credential and
cannot be moved to another process. ACP does
not execute the public CLI. Registration
consumes the same bearer shape only as a one-time, descriptor-bound capability inside the
app-only Agent bridge launcher; stdio MCP settings and Agent descendants carry a session identifier,
not the bearer, and the Broker revalidates their OS ancestry for every request. The command
surface and session-scoped bridge cover secret-free connection summaries, canonical
catalog/schema/table metadata, typed MongoDB reads, SQL read planning/execution,
declarative Analysis Article authoring, immutable SQL proposals, and operation receipts.

The bounded activity projection keeps only command, request/session/connection
identifiers, state, and a stable error code. It does not retain result rows, SQL text,
PTY output, session tokens, or credentials.

Every SQL data read remains a mandatory two-step Broker operation. `dopedb query plan` validates
one SELECT, runs non-executing EXPLAIN, gathers aggregate database-pressure signals, and
returns an expiring single-use plan. `dopedb query run` accepts only that plan identifier,
not replacement SQL or a connection. The database read-only session remains the
authoritative guard. The ACP bridge's typed `query_read` performs those two exact Broker
commands internally so the model needs only one tool round trip. MongoDB uses the typed
bridge or `dopedb document run` with bounded `find`, `aggregate`,
or `count` JSON shapes; unknown fields and write stages such as `$out` or `$merge` fail
closed.

Analysis Article commands accept a closed, versioned definition containing sanitized HTML
and one exact read-only query. A person starts each run in Desktop; the run is pinned to the
current workspace, Article revision, connection grant, and connection revision. Rows stay
in the member's bounded encrypted local recovery cache, while the control plane receives
only run metadata and the query receipt. Update operations preserve the immutable Article
revision contract; public publication remains an immutable HTML snapshot rather than an
executable query surface.

Query planning never sends other sessions' SQL text, users, client addresses, or
parameters to the agent. It returns aggregate connection usage, active/long-running
query counts, lock-wait counts, and replication lag when the engine exposes them.
PostgreSQL can grant or revoke `pg_monitor` from Safety settings through one fixed,
explicitly confirmed and separately audited command. MySQL uses available Performance
Schema aggregates; SQLite reports basic local coverage.

The app-start Agent selector only controls which official Claude/Codex provider appears in
AI Chat; missing DopeDB Skills never block ACP. Settings -> Agent tools optionally installs
the version-matched discovery Skill for agents operating from external terminals and keeps
managed revisions updated without overwriting conflicts. External MCP configuration is
unsupported; AI Chat supplies its bounded stdio tool only inside each official ACP session
and stores a bounded local transcript for explicit history/resume.
Live message chunks are projected once per animation frame and persisted by an ordered
session worker in bounded batches. Permission decisions, errors, and turn boundaries close
the current batch immediately. Both in-memory and SQLite replay are capped by event count
and aggregate bytes, so reconnect cannot grow the renderer or local database without bound.

## Safety Model

The important rules are enforced in Rust:

- Reads run through read-only database sessions.
- Writes are off by default per connection.
- A write or DDL path requires `allow_writes = true`.
- Manual writes require an approval card unless the connection policy explicitly disables approval.
- Successful and blocked execution paths are audited.

Skill text, agent prompts, and CLI output are guidance, not security boundaries.

## Development

Required local tools:

- Rust stable 1.94 or newer
- Node.js 24
- pnpm 11.25.0
- Xcode Command Line Tools

Main commands:

```sh
pnpm install
pnpm tauri dev
pnpm build
pnpm site:build
pnpm build:sidecars
cargo check --workspace
```

All three external binaries must exist before Tauri validates `bundle.externalBin`.
`pnpm build:sidecars` builds the host public `dopedb` CLI and app-only Agent bridge,
then stages them together with the version- and SHA-256-pinned official Cloud SQL Auth Proxy in
`src-tauri/binaries/`.

## Landing Site

The site lives in `site/`.

- Canonical domain: https://dopedb.dev
- Market category, audience, promise, and claim limits:
  [`docs/PRODUCT_POSITIONING.md`](./PRODUCT_POSITIONING.md)
- Framework: Next.js app router
- SEO files: `site/app/robots.ts`, `site/app/sitemap.ts`
- Product preview image: `site/public/dopedb-desktop.png`
- Preview generator: `site/scripts/generate-preview.py`

Local commands:

```sh
pnpm site:preview-image
pnpm site:dev
pnpm site:build
```

Vercel should use `site` as the root directory.

## CI and Releases

CI runs on pull requests and `main` pushes:

- install root and site dependencies
- build desktop frontend
- build landing site
- stage the CLI sidecar
- run `cargo check --workspace`

Stable release runs only on an owner-created `app-v*` tag whose commit is already in `main` and whose version matches `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock`. The `stable-release` environment requires approval from `@json-choi` before the signing key and write token are available:

- build macOS Apple Silicon artifact
- build macOS Intel artifact
- build Windows x64 NSIS installer with `src-tauri/tauri.windows.conf.json`
- upload stable direct-download aliases:
  `DopeDB-windows-x64-setup.exe`, `DopeDB-macos-arm64.dmg`, `DopeDB-macos-x64.dmg`
- upload installers, updater archives, signatures, and `latest.json`
- keep the release as a draft until every matrix build and stable alias upload succeeds, then publish it for immutable tag and asset protection

Contributors use same-repository `work/<github-login>/<topic>` pull requests and opt in to the unprivileged `canary-build` workflow with the `canary` label. After a successful build of the current pull-request head, the contributor may manually dispatch `canary-publish` from `main` with that run ID. Publication stays behind the per-user `canary-<github-login>` environment, never executes the downloaded installers, and creates only an unsigned prerelease without updater artifacts, updater signatures, or `latest.json`. See `CONTRIBUTING.md` for the security boundary.

Required protected `stable-release` environment secrets:

```txt
TAURI_SIGNING_PRIVATE_KEY
SENTRY_AUTH_TOKEN
```

`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is required only when the updater private
key was generated with a passphrase. It stays absent for a passwordless updater
key; adding an unrelated placeholder password would make signing fail.

GitHub does not expose existing secret values. The repository owner must recreate
these names in `stable-release`, verify the protected workflow, and only then remove
any repository-level copies. AI agents and source changes do not read, migrate, or
delete signing material. The local updater key path used during setup was
`~/.tauri/dopedb-updater.key`. Do not commit private keys.

The checked-in `.release/macos-distribution.json` selects `developer-id` after
the repository owner's explicit activation decision and Apple Developer Program
enrollment. Stable releases therefore fail closed unless the protected Apple
credentials are present and every macOS trust check succeeds.

Once `developer-id` is active, the protected `stable-release` environment must
own these macOS distribution secrets. Repository contributors and AI agents do
not create, export, read, or rotate their values.

```txt
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_API_ISSUER
APPLE_API_KEY
APPLE_API_PRIVATE_KEY
```

`APPLE_CERTIFICATE` is the Base64-encoded `.p12` export of the `Developer ID
Application` identity for Team `DD8NQWK3XA`. `APPLE_API_PRIVATE_KEY` is the
one-time `.p8` download for the App Store Connect API key identified by
`APPLE_API_KEY`; the checked-in public identity boundary lives in
`.release/macos-distribution.json`.
Follow the official [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/)
and [Apple notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
when provisioning or rotating those operator-owned credentials.

In `developer-id` mode each macOS matrix job imports the identity into an
ephemeral CI keychain, lets Tauri sign and notarize the app, then separately
submits and staples the final DMG before replacing the initially uploaded draft
asset. It then verifies the app bundle, DMG, and updater archive independently.
Stable finalization requires
per-architecture trust receipts whose SHA-256 values match the exact release
assets, and removes the temporary keychain and API key file even when the build
fails. In `legacy-unsigned` mode those steps and receipts stay inactive.

## Dependency Policy

Use the latest stable compatible library versions, including major releases, and
update the affected safety tests whenever an upgrade changes parser, database, broker,
or credential-store behavior. The desktop and both Next.js apps build with
TypeScript 7. pnpm 11 supply-chain policy, Next.js CLI type-checking, and audited
toolchain holds are documented in [`dependencies.md`](dependencies.md).

Dependency ownership follows deployment boundaries rather than an implicit monorepo
lock: the desktop uses the root `pnpm-lock.yaml`, `workspace-cloud/` owns its lock and
workspace policy, and `site/` owns its own. CI installs and audits each directory with
its matching frozen lockfile. Do not satisfy a child deployment dependency by adding
it only to the root package.

## macOS Distribution

The app is distributed outside the Mac App Store. The current checked-in mode is
`developer-id`, so every stable macOS artifact must pass Developer ID signing,
Apple notarization, stapling, Gatekeeper assessment, and exact-asset trust receipt
verification. Older `legacy-unsigned` releases can still show an unidentified
developer warning; only those historical artifacts use the bypass path below,
and only after confirming the file came from the official GitHub Release.

User-facing bypass path:

1. Try opening DopeDB once.
2. Open System Settings -> Privacy & Security.
3. Choose Open Anyway for DopeDB.
4. Confirm Open.

Terminal alternative after copying the app to Applications:

```sh
sudo xattr -dr com.apple.quarantine /Applications/DopeDB.app
open /Applications/DopeDB.app
```

Only document this command with the release-origin warning. It removes the macOS quarantine flag from the downloaded app and should not be presented as a general bypass for untrusted binaries.

## Windows Distribution

The public Windows alpha installer is currently distributed without an
Authenticode signature. Microsoft Defender SmartScreen can therefore block the
installer before it has established publisher reputation. This applies only to
alpha releases published before Windows code signing is enabled.

User-facing bypass path:

1. Confirm the installer came from the official GitHub Release.
2. In the SmartScreen dialog, choose More info.
3. Confirm the displayed app is DopeDB, then choose Run anyway.

Do not present this as a general bypass for untrusted executables. Windows code
signing and a fail-closed release gate require a separate owner decision from
the macOS Developer ID work in #133.

## Deferred Work

- Clean-device online/offline verification for Developer ID distribution (#133)
- More structured Agent proposal types beyond SQL
- SSH tunnel support
- More granular Agent and plugin origin handling
- Virtualized result grid for very large result sets
