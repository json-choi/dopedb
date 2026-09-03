# DopeDB Workspace Cloud

This is the authenticated web and API control plane for DopeDB workspaces. It is a
separate Next.js application intended for its own Vercel project at `app.dopedb.dev`;
the marketing `site/` deployment remains independent.

It is a separate trust boundary from the Tauri desktop. PostgreSQL stores identity,
membership, audit metadata, secret-free shared connection templates, and encrypted
provider integration material. It never stores member-local database passwords,
terminal capabilities, or ordinary query result rows. Runtime requests use the pooled
URL; schema migrations use only the unpooled URL.

## Local setup

Copy `.env.example` to the ignored `workspace-cloud/.env.local` and provide the Neon
pooler/unpooled URLs, Google OAuth web client credentials, a Better Auth secret, the
exact Better Auth URL, and a random 32-byte base64url `WORKSPACE_CREDENTIAL_KEY`.
PlanetScale managed access additionally requires `PLANETSCALE_CLIENT_ID` and
`PLANETSCALE_CLIENT_SECRET`. Generic PostgreSQL/MySQL dynamic access through
HashiCorp Vault requires `VAULT_BROKER_ORIGINS`, a comma-separated allowlist of
exact HTTPS broker origins; workspace owners cannot point the server at any other
host. Before removing an origin from that allowlist, disconnect its workspace
integrations and let all durable lease revocations complete; removing it first
deliberately makes future broker calls fail closed. Neon and GCP Cloud SQL do not add application
environment secrets. Set a separate random `CRON_SECRET` for the authenticated
credential-cleanup and retention routes. Background work is coordinated by the
separate `workspace-scheduler-cloudflare/` Worker: D1 holds only the credential and
maintenance due times, while leases, authority, and audit state remain in PostgreSQL.
Event producers record an exact due time; a null receipt leaves the task dormant, so
an idle workspace makes no periodic Neon query. Do not add an independent Vercel cron:
polling PostgreSQL prevents Neon from suspending. Managed credentials always expire at
the provider; a missed scheduler wake-up never rejects an otherwise valid lease, and
the next managed-access request performs a bounded cleanup repair before issuing more
access. Register this PlanetScale callback:

```text
http://localhost:3000/api/v1/providers/planet-scale/callback
```

Configure the PlanetScale OAuth application with the minimum scopes used by the
managed-access flow: `read_organizations`, `read_databases`, `read_branches`,
`manage_passwords`, and `manage_production_branch_passwords`. The callback rejects a
grant missing any of them instead of leaving a partially working integration.

To deliver invitation email, also set `RESEND_API_KEY` and a verified
`WORKSPACE_INVITATION_FROM` sender; without them, the dashboard keeps the email-bound
copy-link fallback. Signal email can use a separate verified
`WORKSPACE_SIGNAL_FROM`; when absent it deliberately reuses the invitation sender.
Failed Signal delivery is claimed durably and retried with bounded backoff. Ambiguous
email attempts retry within 23 hours, inside Resend's 24-hour idempotency-key lifetime.
The anonymous first-party product-outcome endpoint is disabled unless
`PRODUCT_ANALYTICS_RELAY_ENABLED=1` and both
`PRODUCT_ANALYTICS_CLOUDFLARE_URL` and `PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN` are set.
The URL must be the dedicated `dopedb-product-analytics.*.workers.dev/v1/events`
endpoint; the server relays bounded, schema-v1 outcome enums without an analytics
vendor SDK or the caller's IP. The Cloudflare Worker stores them in a dedicated
EU-jurisdiction D1 database, not the workspace database. The anonymous endpoint requires the exact
`x-dopedb-product-analytics-contract: 1` compatibility header; that version marker is
not authentication. Independent one-minute budgets apply to the one-way source-IP
hash (60 requests), one-way installation UUID hash (60 requests), a 400-request global
circuit, and a 16-event global circuit sized for D1's free write and storage
envelope. The Worker repeats the 16-event global circuit with an exact D1 counter,
so a leaked server relay capability cannot bypass the storage ceiling. Global gates run before caller-controlled
keys, bounding worst-case new limiter rows below the 1,000-row/minute cleanup rate;
rotating a UUID cannot reset the source budget and neither raw value enters the table.
A successful batch returns HTTP 202.
HTTP 429 and transient HTTP 503 responses set `Retry-After: 60` and return
`retryable: true` with `retryAfterMs: 60000`; contract, validation, and permanent relay
rejections return `retryable: false`. Missing or invalid relay configuration therefore
fails closed instead of acknowledging and dropping events.
Configure this Google redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

Then run `pnpm install` in this directory and `pnpm workspace:cloud:dev` from the repo
root. Generate/check migrations with `pnpm db:generate` and `pnpm db:check` here; apply
them through the unpooled URL with `pnpm workspace:migrate` from the repository root.
`pnpm build` intentionally succeeds without production secrets: database and auth
clients resolve configuration on the first request, where missing values fail closed.
Production Vercel builds run that migration before the Next.js build. The dedicated
production command requires `DATABASE_URL_UNPOOLED` and does not fall back to the pooled
runtime URL; a missing URL or migration failure stops the deployment instead of serving
code against an older control-plane schema.

Migration `0051_orange_sway` adds the Signal email claim, due-at, and retry indexes
without rewriting existing notification payloads. Existing pending rows become due at
migration time; delivered/failed rows remain terminal. It also indexes stale rate-limit
rows. Each due maintenance invocation deletes at most 1,000 expired rows, so
retention never adds an unbounded delete to the public request path. The schema
checks require claim id/timestamp pairs and prevent a delivered row from being retried.

The older `/api/v1/providers/gcp-cloud-sql/callback` route remains only because an
already registered Google OAuth client may still reference it. The canonical callback
is `/api/auth/callback/google`. Remove the compatibility route only after the Google
Cloud console no longer lists the older URI and production authorization has been
verified against the canonical callback.

## Shared Project Knowledge

GitHub Project Knowledge is workspace-owned. An Admin installs the single DopeDB
GitHub App and selects repositories through GitHub's installation screen; ordinary
workspace members do not paste a token, create a webhook, or keep a Desktop online.
The App needs only repository **Contents: read** permission and the `push`,
`installation`, `installation_repositories`, and `repository` events. Configure its
OAuth Callback URL, post-install Setup URL, and webhook once, centrally, at:

```text
Callback URL: https://app.dopedb.dev/api/v1/knowledge/github/callback
Setup URL: https://app.dopedb.dev/api/v1/knowledge/github/callback
Webhook URL: https://app.dopedb.dev/api/v1/knowledge/github/webhook
```

Keep callback wildcard matching off and keep **Request user authorization (OAuth) during
installation** off; DopeDB starts the PKCE-protected GitHub user authorization itself only
after validating the one-time setup state. Enable **Redirect on update** for the Setup
URL. GitHub otherwise returns after a new installation but leaves an existing
installation's repository update on GitHub, so the workspace state cannot be bound to
that update.

`GITHUB_KNOWLEDGE_CLIENT_ID` and `GITHUB_KNOWLEDGE_CLIENT_SECRET` are required in addition
to the App id, slug, private key, and webhook secret. The callback exchanges the one-time
code in function-local memory, verifies that the GitHub user can access the claimed
installation, and never stores or returns the user token. This prevents a spoofed
`installation_id` from binding another tenant's installation. Desktop refreshes only the
GitHub repository inventory when its window regains focus after this explicit flow; it
does not poll in the background. If the external browser has no DopeDB session, the
callback routes through the normal Google sign-in page and resumes the same one-time
setup state instead of discarding the installation attempt.

The default path does not build or persist a graph. The control plane pins each source
to an exact commit and exposes only bounded repository-relative tree search and UTF-8
line reads. Every read rechecks the current workspace membership, Environment
revision, source id, commit SHA, active GitHub installation, and tree membership before
using an in-memory installation token. Tokens and source bodies are never returned to
Desktop or stored in PostgreSQL. ACP sessions copy the exact source identities at
session start, so a branch move makes an old session fail closed rather than silently
changing its code view.

`KNOWLEDGE_GRAPH_BUILDS_ENABLED=0` is the fail-closed production default. While it is
off, webhook pushes advance only the source's pinned commit and no recurring Knowledge
task exists. Migration 0054 supersedes unfinished graph jobs and removes their staging
rows while preserving every previously activated graph/head. The older bounded manifest,
index, and activation pipeline remains dormant for a later paid/experimental evaluation;
reactivation requires an explicit scheduler design and is not part of the
free-source-browsing contract.

Local Folder remains strictly device-local because the cloud cannot observe an
offline path. Desktop indexes and watches it locally; the hosted source inventory and
Vercel queue accept GitHub sources only.

## Neon managed access

1. Create a **project-scoped organization API key** in Neon when the project belongs
   to an organization. Neon does not currently publish a third-party OAuth client
   registration contract for this use case. A personal key also works, but the UI
   identifies its wider account blast radius and never calls this fallback one-click.
2. In Workspace settings, choose Neon, enter the key and optional organization ID,
   and select project → branch → database. Protected branches are always production;
   default or otherwise unclassified branches require an Admin/Owner classification.
3. Run the read-only preflight. It returns redacted finding codes and exact before/after
   descriptions for the selected database, other database `PUBLIC CONNECT`, allowed
   schema creation, ownership, current/future object grants, public
   `SECURITY DEFINER` functions, and DopeDB marker/lease-role drift. Raw ACL SQL and
   owner credentials never reach the browser.
4. Review and explicitly approve any `PUBLIC` ACL changes and, independently, any
   production target. DopeDB applies only the sealed plan hash. Approved statements
   run transactionally, their exact inverse is retained for rollback, and a changed
   target forces a new preflight instead of silently broadening the plan.
5. DopeDB independently revalidates the Provider target and database boundary. A
   temporary read role must read successfully and fail to write. A separate temporary
   write role operates only on an owner-created disposable probe table: INSERT, UPDATE,
   and DELETE must succeed while DDL and role management must fail. DopeDB removes both
   roles and the probe before it issues the short-lived import receipt. A failed
   verification rolls back approved ACL changes. Cleanup or rollback ambiguity becomes
   a redacted `bootstrap_needs_repair` audit event rather than Ready.

The automatic plan may revoke database `CREATE`/`TEMPORARY`, allowed-schema
`PUBLIC CREATE`, and other databases' `PUBLIC CONNECT`; these can affect existing
clients and therefore never run without the dedicated approval. Ownership conflicts,
ungrantable objects, public access outside the schema allowlist, public object writes,
and public `SECURITY DEFINER` functions remain blockers for a DBA or a dedicated
development branch. The UI deliberately provides no arbitrary SQL/setup terminal.
Reserved provider schemas (`neon`, `neon_auth`, `pg_*`, and
`information_schema`) cannot be selected.

Imported Neon connections always begin read-only, including explicitly approved
production targets. Successful bootstrap records that a separately gated write
credential was verified, but neither import nor production approval enables writes.
A current Admin/Owner must later turn on the DB-specific write policy, and the member
must still have the workspace write capability and connection grant. Database numeric
ID and display name are stored separately, so a rename cannot silently redirect
authority to a different database. Every new lease rechecks that stable ID, branch
readiness, environment classification, owner boundary, current object ACL, and
future/default privileges.

DopeDB retrieves an owner connection only on the server and creates a unique login
role with a 15-minute password validity. The role receives only `CONNECT` plus
current/default table and sequence privileges in the explicit schema allowlist
(`public` by default). It does not use the Neon API role endpoint because API-created
roles inherit `neon_superuser`.

The API key is envelope-encrypted at rest and never returned. Disconnecting DopeDB
scrubs its encrypted copy; it intentionally does not delete a customer-owned Neon key
that another integration might use. The integration identity is derived from the
current Neon user/organization and a fingerprint of exactly the accessible project
IDs, so rotating a key with the same scope updates one integration while a narrower
project key remains separate. Revoke an unused key in Neon.

Role passwords are sent to PostgreSQL only as client-generated SCRAM-SHA-256
verifiers. The desktop uses the direct Neon endpoint, limits the two leased pools to
four combined connections, and closes them 30 seconds before expiry. The authenticated
Cloudflare-scheduled route independently commits `NOLOGIN`, terminates remaining sessions, and removes
expired roles. Background scheduling is not an exact timer, so the documentation does
not treat password `VALID UNTIL` alone as a hard session-expiry boundary.

## GCP Cloud SQL managed access

GCP uses keyless federation. Do not create or upload a JSON service-account key, and
do not copy a project number, WIF coordinate, or service-account identity into a
browser form.

1. A workspace Admin or Owner chooses **Google Cloud 연결** and approves the Google
   OAuth request. The short-lived setup grant is held only for this bootstrap session.
2. DopeDB lists the approved account's projects and runnable Cloud SQL instances. The
   admin selects one project and instance, classifies an unlabeled environment, and
   explicitly approves production access or a required database restart.
3. DopeDB checks the exact Google permissions needed for setup. If the account can
   grant them, the UI shows the missing roles and requires one explicit approval before
   applying them. Otherwise the UI reports the missing permissions without pretending
   the connection is ready.
4. The server enables the required APIs, creates the instance-scoped Workload Identity
   Pool/provider plus separate dedicated read and write service accounts, applies the
   narrow IAM bindings, enables Cloud SQL IAM authentication when approved, creates
   both IAM database users, and grants each its database-side least privilege. Imported
   connections still start with `allowWrites: false`; provisioning a dormant write
   principal does not authorize any workspace member to use it.
5. The completed integration stores only keyless trust coordinates and encrypted
   Provider authorization needed for rotation. Google login tokens, service-account
   keys, and database passwords are never copied into a shared connection or returned
   to the browser.

The OAuth account must be able to enumerate projects and Cloud SQL and, when one-click
setup is requested, enable services, manage the dedicated service account and IAM
policy, update the selected instance, and manage its IAM database user. The setup UI
shows the permission diff before making those changes. Existing resources are
revalidated and reused by deterministic identity; a partially completed setup can be
retried without adding duplicate principals.

At lease time Vercel OIDC is exchanged through GCP STS and IAM Credentials for
15-minute `sqlservice.login` and connector tokens. They reach only the native desktop
process. The app starts the pinned Google Cloud SQL Auth Proxy from its signed bundle,
binds it to a random loopback port for that pool, and gives the database driver the IAM
login token. The connector owns instance authorization and TLS, so Public IP no longer
requires each member machine to be added to Authorized Networks. Private services
access and Private Service Connect still require an existing resolvable network path
from that machine; the connector cannot create VPC reachability.

When an admin selects an existing member-local shared connection during a receipt-bound
provider import, the service converts that connection in place instead of creating a
second template. Its connection UUID, grants, Analysis Articles, and history references remain
stable; the content and authority revisions advance atomically, and the next desktop
sync removes obsolete member-local credential references from that device. Personal
workspaces do not issue managed credentials. Local GCP ADC is created by Google tooling
and can only verify member-local access for an existing team-workspace integration.

Cloud SQL instances explicitly labeled `environment=prod` or
`environment=production` may be imported only by a current workspace Admin/Owner after
the production warning is accepted. The approval bit is bound to the idempotent import
hash and recorded in the redacted audit event. Missing or unrecognized environment
labels remain fail-closed and cannot be imported. Production approval and write policy
are independent: import never enables writes. A current Admin/Owner may later change
the DB's durable `allowWrites` policy; only members whose current role is Editor,
Admin, or Owner and whose connection grant is `use` or `manage` can receive a write
lease. Analyst and Viewer access remains read-only in both production and non-production.

The tokens are not revocable, so access changes wait for bounded expiry and the desktop
drops both pool and connector 30 seconds early. Pool eviction prevents new app work but
is not a protocol-level kill switch for an already checked-out connection; the
database's own statement/session limits remain the final bound for a query already
running. Client-certificate-required instances are supported through the connector
rather than by issuing or storing a long-lived client certificate in DopeDB.

Reconnecting the same project and instance rotates the server-generated trust and
dedicated service account in place. The server first gates new leases, drains existing
credentials, then atomically replaces hash-only global principal claims so a service
account cannot be reused by another integration. Selecting a different dedicated
instance creates a separate integration; move its connections before disconnecting the
old one.
When Desktop cannot obtain a managed Cloud SQL lease, a manager can open that exact
database row in Workspace Web and start **Repair managed access**. The OAuth round trip
retains only a 15-minute, non-secret browser intent containing opaque workspace,
connection, and integration IDs. After OAuth, the server-projected managed connection
pins the existing project and instance; the setup rechecks required permissions, IAM
database authentication, and dedicated database users. The final mutation must resolve
to the same integration before it updates credentials, and then returns to the same
database row without replacing its connection ID or grants.
GCP managed connections saved before the explicit network-path field was introduced
are intentionally not leased. A workspace admin must reconnect and re-import the
instance so current discovery supplies the exact path; the server does not guess a path
for legacy records.

## Analysis Articles

An Analysis Article is the one shared BI resource for a Project Environment. Its
immutable definition revisions pin connection and Environment revisions, bounded
read-only query nodes, typed transforms, semantic metrics, responsive document blocks,
review evidence, refresh policy, and ownership. Dashboard, Funnel Analysis, and Agent
Report are migration-only source kinds and have no live route, command, or table.

Database execution remains on a member-owned Desktop runner inside exact current grants.
The control plane stores only reviewed, bounded, independently encrypted result
fragments whose declared column sensitivity and masking permit workspace sharing. Team
readers see the latest successful compatible live result; a failed refresh leaves the
last successful result visible with explicit freshness and runner health.

Desktop uploads each bounded result fragment through the staged-result endpoint before
it completes a run. The service performs a read-only exact-run preflight before KMS
work, but the final PostgreSQL transaction is authoritative: it rechecks the same
session, member, runner, cancellation, Article revision, result-sharing state, and
connection grants while it atomically commits receipts and the complete fragment
manifest. Retrying the same fragment or exact terminal completion is idempotent. Result
reads recompute the committed evidence hash from every still-unexpired fragment and
fail closed if retention cleanup has removed only part of a manifest. During the
Desktop/cloud rolling-upgrade window, the completion route also accepts the previous
inline `fragments` shape under a four-MiB bounded body and seals it through the same KMS
and SQL authority boundary; larger results require the staged protocol.

The collection endpoint is `/api/v1/workspaces/:workspaceId/analyses`; item, immutable
revision, run/result, runner/lease, Signal, notification, and publication endpoints are
nested below it. Every mutation uses optimistic authority checks. A person reviews and
makes revisions live, enables production scheduling, approves mappings, and publishes
fixed external snapshots. Public `/analyses/:slug` pages read only immutable snapshot
payloads and cannot reach a workspace session, SQL, credentials, or refresh commands.
The public HTML and snapshot API are private `no-store` responses because a slug is
revocable access: every request rechecks publication state and a revoked slug becomes
unavailable without a browser or shared-cache grace period.

Invalid legacy BI records are preserved in the non-executable migration-failure archive
for explicit recovery. The one-way migration then drops the legacy projections so a
second BI model cannot continue accumulating.

## Trust boundary

- Better Auth owns Google login, sessions, organizations, invitations, rate limits, and
  RFC 8628 device authorization; the app does not maintain a parallel auth system.
- Database hooks clear Google access, refresh, and ID tokens before account persistence.
- Better Auth Multi Session keeps at most ten browser identities available without
  merging their users or organization memberships. The active identity is explicit.
- Desktop sign-in uses a ten-minute, single-use device code and a Better Auth Bearer
  session. Sessions expire after 30 days with a one-day refresh age, and the desktop
  stores each account in a separate operating-system credential item.
- All application queries use Drizzle ORM; all schema changes use committed Drizzle Kit
  migrations.
- Application-owned server logging has one categorical sink. The root build rejects
  direct runtime `console`/stdout/stderr and alternate exception sinks under
  `workspace-cloud/app` and `workspace-cloud/lib`. Provider setup and managed-lease
  failures retain only closed provider/stage/status/error-kind values; requests,
  responses, SQL, identifiers, result rows, credentials, certificates, and raw error
  messages never cross that sink.
- Member-local target-database credentials never enter this service. In optional
  managed mode, reusable PlanetScale OAuth, Neon API authorization, or a dedicated
  Vault AppRole is AES-256-GCM encrypted with record-bound AAD before database
  persistence; GCP stores only non-secret WIF coordinates and service-account
  identities. Vault origins are deployment-allowlisted, redirects are rejected, and
  the AppRole material is never returned to a browser or Desktop. The envelope key is
  held separately in deployment configuration.
- A Vault operator owns the SQL privilege boundary behind each Database Secrets role.
  DopeDB verifies the named connection's plugin, role allowlist, connection target,
  password credential type, role identity, and maximum TTL before setup and every
  issuance, but it does not proxy the database or infer arbitrary role creation SQL.
  The configured read role must therefore be enforced as read-only by the database,
  and any write role must be separate and least-privileged. The closed adapter accepts
  one canonical TLS path per engine: PostgreSQL uses
  `postgresql://{{username}}:{{password}}@host:port/database?sslmode=verify-full`,
  while MySQL uses
  `{{username}}:{{password}}@tcp(host:port)/database?tls=true`. PostgreSQL may add
  non-identity connection parameters, but host/user/database query overrides and
  multi-host URLs are rejected.
- The dedicated Vault AppRole must issue a non-root service token with a 1–15 minute
  TTL. An issuance token is never persisted or returned, but it remains valid until
  the associated database lease is revoked or expires: Vault revokes dynamic secrets
  when their issuing token is revoked, so eagerly revoking that token would invalidate
  the credential before Desktop could use it. Error and explicit-release paths revoke
  it synchronously when doing so cannot invalidate a successfully delivered lease.
  Its SecretID must remain reusable; rotate it with an overlap by reconnecting DopeDB
  before invalidating the old SecretID, so outstanding leases can still be revoked.
- Managed target-database credentials are generated per member with a 15-minute TTL,
  returned once to an authenticated native Bearer client, and never inserted into the
  service database, audit stream, browser UI, or desktop store. The TTL bounds leaked
  credential value; it does not expire the durable role/grant/write policy. The desktop
  retires the pool before expiry and automatically obtains a new credential while that
  live authority remains unchanged.
- Every new managed lease enters a fresh Provider-authority gate before any database
  credential creation call. The complete pre-issuance authority sequence has a
  45-second fail-closed deadline, so there is no application-side periodic polling
  window: once the Provider exposes unsafe drift to an uncached validation, the next
  lease request is denied within that gate or times out without invoking credential
  creation. Provider-internal propagation remains outside DopeDB's clock. Credentials
  already delivered remain bounded by their actual Provider expiry of at most 15
  minutes, while the desktop retires its pool earlier when workspace authority changes.
- Managed lease POSTs send
  `x-dopedb-managed-lease-contract: access-v4` and an explicit `read`, `write`, or
  `schema` access mode. The service temporarily accepts `access-v3` and `access-v2`
  for read/write compatibility, but schema credentials fail with HTTP 426 unless the
  Desktop sends `access-v4`. This preserves existing access while the control plane is
  deployed before the matching Desktop release.
- Independently deployed Desktop and Workspace Cloud decode the same versioned
  `dopedb-protocol/tests/fixtures/control-plane-contracts-v1.json` golden for ordered
  workspace sync, managed lease request/response, and Analysis Article creation.
  Cloud route builders use `lib/control-plane-contracts.ts`; Rust adapters use the
  platform-free `dopedb-protocol` types. The fixture also carries one shared,
  path-mutation rejection corpus for the protected UUID, enum, length, revision,
  provider/TLS, duplicate, and definition-relationship invariants. That corpus is
  representative rather than an exhaustive parser-equivalence proof: a field, enum,
  or semantic constraint change must add the relevant accept/reject case and pass
  both parsers before either side ships. `workspace-analysis-articles.ts` remains the
  sole authority for the full parameter, schedule, and transform/block definition policy;
  Rust deliberately validates only the named cross-runtime safety and authority
  invariants before sending a create/update request.
- Desktop pool retirement calls the exact tenant/user/connection/lease DELETE
  boundary for early provider revocation. Natural provider expiry and the durable
  cleanup worker remain the fallback when the desktop is offline.
- New lease rows retain the validated, redacted Provider resource audit id beside the
  opaque DopeDB lease id. Issue, early revoke, scheduled cleanup, and deferred cleanup
  events carry both identifiers plus the non-secret external credential id, so an
  operator can reconcile Provider and workspace audit trails without opening a token
  or password. Cleanup state changes and their system-authored audit events commit in
  one database statement. Legacy rows keep a null Provider audit id rather than using
  a guessed backfill.
- Shared connection rows contain endpoint metadata, safety defaults, credential mode,
  the administrator-owned write policy, and a redacted provider-resource selector. Usernames,
  passwords, tokens, certificates, connection URLs, SQLite paths, advanced parameters,
  and desktop `secret_ref` values are rejected or absent from the hosted schema.
- Workspace metadata backups are canonical secretless snapshots: they include workspace
  lifecycle metadata and shared connection templates only, never provider OAuth tokens,
  target-database credentials, local secret references, query/result rows, certificates,
  or URLs with embedded credentials. A random 256-bit workspace data-encryption key (DEK)
  seals each snapshot with AES-256-GCM and AAD bound to the workspace and opaque backup id.
  Only the Cloud KMS-wrapped DEK is durable. The plaintext DEK exists in request memory for
  the envelope operation and is zeroized before return. Backups created by the former
  backup-only HKDF v1 domain remain readable until an Owner rotation re-encrypts them.
- KMS authentication is keyless. A Vercel Function request receives an
  `x-vercel-oidc-token`, exchanges it through the configured GCP Workload Identity Federation
  provider, and impersonates a dedicated service account with encrypt/decrypt access scoped
  to the configured CryptoKey. JSON service-account keys and reusable Google credentials are
  not accepted by the application. A rotation creates a new wrapped DEK version, processes
  every live and tombstoned backup in resumable bounded batches, and erases the retired
  wrapped DEK only after no backup references it. PostgreSQL permits ciphertext mutation only
  under the active, unexpired Owner rotation claim.
- A backup restore is additive and conflict-preserving, not a silent rollback. Existing
  connection ids retain the current server projection while the restored candidate is
  recorded as an immutable conflict branch; a new opaque conflict id is the only client
  handle. Backup create/list/restore/delete require the server-side Admin/Owner `manage`
  capability and each action writes a redacted audit event.
- Shared connection writes use `x-dopedb-expected-revision` (`0` for a new row).
  The server temporarily accepts quoted `If-Match` revisions and echoes that
  validator as a non-cacheable response ETag for released Desktop compatibility;
  new clients must use the dedicated header so hosting-layer HTTP precondition
  handling cannot replace an already-applied mutation response with 412.
  A stale offline update or delete never overwrites the current projection: the server
  persists its redacted candidate plus parent/base revision and returns HTTP 409 with an
  opaque conflict id. Connection version history is append-only at the database boundary.
- Admin/Owner can create, resend, and cancel Better Auth invitations; remove members;
  and assign Viewer (metadata only), Analyst (read-only), Editor (read/write through
  local safety gates), or Admin roles. Resend delivers email when configured, while the
  settings page always exposes a copyable, email-bound invitation link.
- A signed-in user with a verified Google email automatically accepts every live
  invitation for that exact email on the next workspace read. Better Auth still
  performs the recipient, expiry, role, membership-limit, and state-transition checks.
- Shared database execution uses a fresh server authorization check. Cached desktop role
  data is for presentation and fail-closed prechecks, not the final permission decision.
- Role downgrade, member removal, provider disconnect, and managed-mode changes attempt
  immediate provider credential revocation where supported. Neon additionally uses
  lazy and scheduled role cleanup because PostgreSQL `VALID UNTIL` does not terminate
  existing sessions. GCP IAM login tokens cannot be revoked, so GCP access changes wait
  for token expiry while the desktop closes its leased pools early.
- Identity, membership, invitation, and connection API responses are private `no-store`
  payloads and are covered by restrictive browser security headers.

## Backup API contract

All endpoints are under `/api/v1/workspaces/:workspaceId/backups`, require an active
server-verified Admin/Owner membership, and return `private, no-store` responses. `GET /`
lists only backup metadata (`id`, source revision, key reference/version, hash, timestamp);
`POST /` creates a ciphertext-only snapshot; `DELETE /:backupId` creates a retention
tombstone; and `POST /:backupId/restore` requires an
`x-dopedb-expected-revision` workspace revision.
`GET /key-rotation` returns only version/count/progress metadata. Owner-only
`POST /key-rotation` requires an opaque UUID `requestId`, resumes an interrupted rotation,
and is idempotent after a lost response. Repeated POSTs advance bounded batches until the
response reports `completed`; key material and ciphertext are never returned.
Neither successful nor failed responses contain provider grants, target credentials,
envelope ciphertext, decrypted snapshot data, or database result rows.

## Workspace lifecycle contract

Only the current Owner can inspect or mutate
`/api/v1/workspaces/:workspaceId/lifecycle`. Scheduling requires the exact current
workspace name and an opaque UUID that also becomes the durable deletion receipt.
The final locked mutation refuses to schedule while a provider integration, live
credential lease, unfinished or repair-required provider operation, key rotation, or
member revocation claim remains. A successful schedule immediately suspends every
member and clears that workspace from active sessions; all ordinary workspace APIs
then fail closed. The matching Owner may still open the lifecycle boundary and cancel
before the fixed seven-day deadline. Cancellation resumes only member markers written
by that exact schedule and is idempotent after a lost response.

The event-driven authenticated maintenance route hard-purges deleted backup tombstones
after seven days and processes due workspace deletions in bounded batches. Final
workspace purge is one database transaction that rechecks the receipt, deadline,
live credentials, Provider state, rotations, and revocation claims before removing
backups, wrapped data keys, and the organization. It leaves only a payload-free receipt
containing opaque ids,
timestamps, actor id when the account still exists, and terminal status. The SQL purge
function is not executable by `PUBLIC`; there is no browser endpoint for immediate
hard deletion.

Production must define `WORKSPACE_KMS_KEY_NAME`, `WORKSPACE_KMS_WIF_AUDIENCE`, and
`WORKSPACE_KMS_SERVICE_ACCOUNT_EMAIL`. The WIF provider must accept only the immutable
Vercel project/team/environment claims for this production deployment. Grant its principal
`roles/iam.workloadIdentityUser` on the dedicated service account, and grant that service
account `roles/cloudkms.cryptoKeyEncrypterDecrypter` on the single backup CryptoKey rather
than at project scope.

## Security references

- [Better Auth Organization](https://better-auth.com/docs/plugins/organization) for
  invitations, verified-email acceptance, custom roles, and server-side membership.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
  for least privilege, deny-by-default, per-request checks, and authorization tests.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
  for credential minimization, fine-grained access, non-logging, rotation, and revocation.
- [PostgreSQL role membership](https://www.postgresql.org/docs/current/role-membership.html)
  for the independent target-database privilege boundary.
- [Neon API authentication](https://api-docs.neon.tech/reference/authentication) for
  key types and project-scoped organization keys.
- [Neon current-user organizations](https://api-docs.neon.tech/reference/getcurrentuserorganizations)
  for identity resolution that also supports organization and project-scoped keys.
- [PostgreSQL CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html)
  for SCRAM verifiers and the password-only semantics of `VALID UNTIL`.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
  and [D1](https://developers.cloudflare.com/d1/) for the payload-free due-time
  coordinator; `CRON_SECRET` remains the Bearer boundary on Vercel.
- [Vercel OIDC for GCP](https://vercel.com/docs/oidc/gcp) and
  [Vercel OIDC claims](https://vercel.com/docs/oidc/reference) for the exact
  production-project trust condition, and
  [GCP Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
  for keyless service-account impersonation.
- [Cloud SQL IAM database authentication](https://docs.cloud.google.com/sql/docs/postgres/iam-authentication)
  for login roles, instance flags, database users, and database-level grants.
- [Cloud SQL IAM Conditions](https://docs.cloud.google.com/sql/docs/postgres/iam-conditions)
  for instance-scoped role bindings, and
  [Cloud SQL TLS identity verification](https://docs.cloud.google.com/sql/docs/postgres/configure-ssl-instance)
  for CA-mode and DNS requirements.
