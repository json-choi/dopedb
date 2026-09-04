# DopeDB product analytics

Status: canonical tracking plan, effective 2026-08-14.

This document owns the purpose, consent boundary, event vocabulary, identity
rules, retention, and operating procedure for DopeDB product analytics. The
desktop, first-party relay, Cloudflare Worker and D1 store, privacy policy, and analysis queries
must follow it. Product analytics is an operator capability; it does not create a
user-facing Funnel Analysis product domain. Product reporting may be presented
through the existing Analysis Article domain.

## Decision and purpose

DopeDB measures whether people can reach a useful outcome inside the product's
three boundaries:

1. connect to an exact database grant;
2. let a member or Agent complete bounded work inside that grant; and
3. make the access or result safely reusable by a workspace.

The data may be used only to improve onboarding, reliability, activation,
retention, and the shared-access workflow. It must not be used for advertising,
cross-site profiling, employee evaluation, credit or eligibility decisions,
general-purpose AI training, or reconstructing a customer's database or source
code.

Counts are diagnostic. They do not justify weakening an approval, grant,
credential, masking, or retention boundary.

## Three separate measurement systems

Do not join these systems by silently copying identifiers between them.

| System | Purpose | Current boundary |
| --- | --- | --- |
| Vercel Web Analytics on `dopedb.dev` | Aggregate public page, download, and workspace CTA flow | Automatic website measurement with `Download Clicked` and `Workspace Opened`; no Desktop installation identifier |
| Sentry Desktop diagnostics | Investigate sanitized production renderer failures and allowlisted Agent-plugin failures | Error diagnostics only; no product funnel events, replay, tracing, logs, breadcrumbs, default PII, request, user, free-form message, or customer payload |
| Desktop product analytics | Measure explicitly approved product outcomes | Explicit opt-in, closed schema, first-party relay, dedicated Cloudflare EU D1, no vendor autocapture or person profiles |

Website activity and Desktop activation are reported as separate aggregate
stages. A download click must not carry a visitor identifier into an installer,
and the Desktop installation identifier must not be sent back to Vercel Web
Analytics.

## Consent contract

Desktop product analytics is optional and fail-closed.

- `pending` and `denied` mean no product event is created, queued, or sent and no
  analytics installation identifier exists.
- The app may create the random installation identifier and bounded retry queue
  only after the user explicitly selects `Allow product analytics`.
- Consent is local to that Desktop installation. Signing in, joining a workspace,
  accepting terms, or an administrator's choice does not grant it.
- Revoking consent stops collection immediately and deletes the queued events and
  local installation identifier. A durable local revocation tombstone prevents a
  stale native grant from resuming collection after a failed IPC or restart.
  Opting in again creates a new installation and session identifier; neither
  identifier is reused. Authentication and Personal Workspace pseudonyms also
  rotate with the installation. A team `actorKey` is deliberately stable only
  for the same actor inside the same team workspace, and the team `workspaceKey`
  is stable for that workspace, so separately consented team events can still be
  grouped without linking the actor across customer workspaces.
- Native consent has a monotonically changing generation. Renderer batches must
  match the currently granted generation exactly. `consentGeneration` exists only
  on the renderer-to-native IPC batch and is removed before the native relay sends
  the public Cloud envelope.
- A release-time feature flag and a configured relay are additional kill
  switches, not substitutes for user consent.
- Sentry error diagnostics and public-site Vercel Analytics are separate systems
  and must be described separately wherever the product analytics choice is
  shown.

The consent control must state the categories below, link to the privacy policy,
and be available again in Settings. There is no preselected checkbox, dark
pattern, or degraded core product when consent is refused.

## Identity and session rules

The wire envelope is schema version 1 and contains only:

- `installationId`: a random UUID created locally after opt-in; the analytics store uses it as
  `distinct_id` with `$process_person_profile: false`;
- `sessionId`: a fresh random UUID for one app process/session;
- `eventId`: a 64-character domain-separated SHA-256 key derived from a stable
  receipt UUID when available, or from a fresh random nonce and event context;
  the derivation includes the current installation ID, the analytics store uses it as
  `$insert_id`, and the relay derives its top-level deterministic RFC UUID from
  the same value for idempotent retries;
- `appVersion`, `platform` (`macos`, `windows`, `linux`, or `unknown`), and locale
  (`en` or `ko`);
- an optional 64-character pseudonymous `actorKey` and `workspaceKey`, plus
  `workspaceKind` (`personal` or `team`), only where the event dictionary allows
  them; and
- one event name with its exact closed property object.

Raw account, workspace, connection, product session, article, or database
identifiers must not leave the Desktop in a product-analytics envelope. A
successful-authentication `actorKey` is a one-way, domain-separated projection of
the installation and account UUID, so it rotates after re-consent. A team-event
`actorKey` projects the team workspace and account UUID together, so the same
person cannot be linked across different customer workspaces; it remains stable
inside that one workspace across consent periods. A team `workspaceKey` is the
domain-separated projection of the workspace UUID. A Personal Workspace key is
instead derived from the random installation ID so different people do not
collapse onto the reserved Personal Workspace UUID. These values are
pseudonymous, not anonymous, and must never be exposed in product UI, support
tickets, or public reports.

The lowercase UTF-8 v1 projections are exact and append no operator secret:

- authentication actor: SHA-256 of
  `dopedb-product-analytics:actor-installation:v1:<installationId>:<accountId>`;
- team actor: SHA-256 of
  `dopedb-product-analytics:actor-workspace:v1:<workspaceId>:<accountId>`;
- team workspace: SHA-256 of
  `dopedb-product-analytics:workspace:v1:<workspaceId>`; and
- Personal Workspace: SHA-256 of
  `dopedb-product-analytics:workspace:v1:personal:<installationId>`.

Identity requirements are structural:

- `desktop_installation_ready` carries no actor or workspace key;
- unsuccessful authentication carries neither key; successful authentication
  carries only `actorKey`;
- Personal Workspace events carry `workspaceKey` and `workspaceKind=personal`,
  but no `actorKey`;
- team workspace events carry both keys and `workspaceKind=team`; and
- `workspace_membership_ready` is valid only for a team workspace.

The first-party relay must reject an unknown field, raw UUID where a hash is
required, invalid identity combination, invalid enum, duplicate event ID inside a
batch, event older than seven days, or event more than five minutes in the future.

## Data that is never collected as a product event

The following values are prohibited in the event name, properties, analytics
identifier, URL, application log, retry key, or vendor context. The relay's
one-way transport rate-limit key and Vercel's separate hosting/security metadata
are the explicit source-IP processing exceptions described below:

- SQL, query text or fragments, query hashes derived from content, parameters,
  DDL, filter or pipeline expressions;
- database results, rows, cells, documents, charts, article evidence, or result
  fragments;
- database, host, connection, schema, table, column, collection, project, or
  Environment names;
- credentials, passwords, tokens, cookies, certificates, connection URLs, secret
  references, provider response bodies, or keychain data;
- Agent prompts, messages, attachments, tool inputs or outputs, transcripts,
  provider error messages, or ACP payloads;
- repository owner/name/identifier, ref, commit, source code, graph content, local
  folder, file path, export path, or CLI path;
- email address, display name, workspace or organization name, invitation address,
  or raw product UUID;
- raw source IP, full user agent, hostname, OS account, device serial, MAC address,
  or hardware fingerprint; and
- raw errors, stack traces, request/response bodies, local tracing output, or
  product audit records.

Sentry may receive the separately documented sanitized exception type, stack
structure/code location, app release, runtime, component name chain, and closed
Agent-plugin failure tags. Sentry data must never be copied into product
analytics.

## Event dictionary

There are exactly 13 v1 product events. A caller cannot add properties beyond the
listed object. `completed` means one terminal outcome is emitted after the owning
operation finishes; it is not an event for every intermediate UI click.

| Event | Emit only when | Exact properties | Identity |
| --- | --- | --- | --- |
| `desktop_installation_ready` | After explicit opt-in, analytics bootstrap, and local installation allocation; the deterministic anchor is queued once per installation identity until the relay accepts it | No properties | Installation only |
| `workspace_authentication_completed` | A device authentication attempt reaches a terminal result; success only after the account credential is durably accepted | `outcome`: `success`, `denied`, `expired`, `failed` | Success: actor only; otherwise installation only |
| `workspace_scope_ready` | Once per app session when the selected Personal or team workspace has a usable local projection; this does not claim hosted synchronization succeeded | No properties | Workspace context |
| `knowledge_environment_created` | The Environment creation transaction commits | `creationKind`: `project_default`, `additional` | Workspace context |
| `connection_verification_completed` | Test Connection reaches a terminal result | `outcome`: `success`, `failed`; `engine`: `postgres`, `mysql`, `sqlite`, `mongodb`; `credentialMode`: `local`, `managed`, `none`; `ssh`: boolean | Workspace context |
| `environment_connection_bound` | A connection revision is durably bound to an Environment | `accessMode`: `local`, `managed`; `engine`: `postgres`, `mysql`, `sqlite`, `mongodb` | Workspace context |
| `query_execution_completed` | A renderer-owned SQL workbench attempt reaches an observed terminal result; replacing or unmounting the observer is not reported as cancellation | `outcome`: `success`, `failed`, `cancelled`, `unknown`; `statementClass`: `select`, `explain`, `show`, `other_read`, `write`, `script`; `rowCountBucket`: `zero`, `one`, `2_10`, `11_100`, `101_1000`, `over_1000`, `unknown`; `durationBucket`: shared duration enum; `approvalRequired`: boolean | Workspace context |
| `knowledge_source_sync_completed` | A renderer-owned GitHub or Local Folder initial connection or manual synchronization reaches an observed terminal result | `outcome`: `success`, `failed`; `sourceKind`: `github`, `local_folder`; `syncReason`: `initial`, `manual` | Workspace context |
| `agent_session_initialization_completed` | The official ACP adapter initialization reaches a terminal result | `outcome`: `success`, `failed`; `provider`: `claude`, `codex` | Workspace context |
| `agent_turn_completed` | One ACP user turn reaches a terminal result | `outcome`: `success`, `failed`, `cancelled`; `provider`: `claude`, `codex`; `durationBucket`: shared duration enum | Workspace context |
| `analysis_article_run_completed` | A manually started exact-source article run reaches an observed terminal result | `outcome`: `success`, `failed`, `cancelled`, `stale`; `trigger`: `manual`; `durationBucket`: shared duration enum | Workspace context |
| `workspace_membership_ready` | Once per app session when the selected team workspace membership and its current role are visible in the local auth projection; this is not a membership-join receipt | `role`: `viewer`, `analyst`, `editor`, `admin`, `owner` | Team workspace context |
| `shared_connection_access_ready` | The first successful team SQL workbench query observed per workspace, engine, and access mode in an app session; this is a verified-access proxy, not a local-binding or managed-lease issuance receipt | `accessMode`: `local`, `managed`; `engine`: `postgres`, `mysql`, `sqlite`, `mongodb` | Team workspace context |

The shared duration enum is `under_100ms`, `100ms_1s`, `1s_10s`, `10s_60s`,
`over_60s`, or `unknown`. Counts and durations remain bucketed; no raw SQL length,
exact row count, exact duration, or error text is allowed.

## North Star and funnels

The North Star follows `PRODUCT_POSITIONING.md`:

> **Weekly activated workspaces** — the number of distinct pseudonymous
> workspaces observed from consenting installations in a calendar week with at
> least one successful exact-grant member query, Agent turn, or manual Analysis
> Article run.

Count a workspace at most once per week. Segment only by `workspaceKind` and
other closed properties when the resulting cohort is large enough to avoid
singling out one customer. Total event volume is not the North Star.
`workspace_scope_ready` is the denominator for a workspace activation rate;
the successful value terminal above is its numerator. Both sides therefore
describe only consenting installations, not all users or downloads. Test
Connection is optional and must not be required for activation.

The canonical aggregate funnels are:

1. **Public acquisition, reported separately:** Vercel page view -> `Download
   Clicked`. Do not person-join it to Desktop.
2. **Direct first value:** `desktop_installation_ready` -> successful
   `workspace_authentication_completed` when sign-in is chosen ->
   `workspace_scope_ready` -> first successful `query_execution_completed`.
   Personal/local use may omit authentication. A successful
   `connection_verification_completed` is an optional diagnostic branch, not a
   mandatory stage.
3. **Knowledge and Agent value:** `workspace_scope_ready` ->
   `knowledge_environment_created` -> `environment_connection_bound` ->
   successful `knowledge_source_sync_completed` when a source is used -> successful
   `agent_session_initialization_completed` -> successful `agent_turn_completed`
   -> successful manual `analysis_article_run_completed`.
   A source sync is optional when the Agent uses schema context without a
   Knowledge source.
4. **Team sharing:** team `workspace_scope_ready` ->
   `workspace_membership_ready` -> `shared_connection_access_ready` together
   with its first successful team query -> a successful Agent turn or manual
   article run. Membership readiness measures observed access, not invite
   conversion.

Time-to-value is computed from event timestamps only in buckets or aggregates.
Seven-day return is a repeat weekly activated workspace, not a copy of query or
session content. Every Desktop metric must be labeled **among consenting
installations**. The system intentionally emits nothing for pending or denied
consent and does not join downloads to Desktop identity, so it cannot measure
opt-in coverage, refusal rate, consent revocation rate, or download-to-activation
conversion. Never invent those denominators or present the consenting subset as
all users.

Guardrails are connection-verification failure rate, query cancellation/failure
rate, approval-required share, Agent initialization failure rate, Analysis Article
stale/failure rate. Product-event guardrails use only consenting-installation
data. Relay availability/rejection and the client retry queue require separate
operational and release-QA checks; they are not customer funnel events. A
guardrail may trigger investigation but must not expose the underlying customer
payload.

## Current measurement limits

The v1 vocabulary is intentionally narrower than future producer coverage:

- Renderer-owned terminal observers can undercount when the app exits, a screen
  unmounts, or ownership changes before the durable terminal receipt is observed.
  The implementation does not guess that an unobserved operation was cancelled.
- `workspace_scope_ready` proves only a usable local projection. It does not
  prove that a hosted synchronization completed or distinguish a deliberately
  deferred synchronization.
- Knowledge events cover initial source connection and manual sync only. Webhook
  and scheduled sync have no v1 producer. Analysis Article runs are manual-only;
  proposal validation failures and Agent-test runs have no v1 producer.
- `workspace_membership_ready` is a once-per-session observation, so it cannot
  measure invitation acceptance or exact join time.
- `shared_connection_access_ready` is deduplicated once per session for the same
  workspace, engine, and access mode after a successful team query. Local-binding
  completion and managed-lease issuance do not yet have durable v1 receipt
  producers and must not be inferred from this proxy.
- A retry keeps the original occurrence time and may arrive later or out of order.
  Events that remain undelivered for seven days are discarded, so vendor outages
  can lower measured counts.

## First-party relay and Cloudflare EU D1

The Desktop posts to the first-party
`/api/v1/product-analytics/events` control-plane route. The route does not require
authentication so pre-auth activation can be measured. The required
`x-dopedb-product-analytics-contract: 1` header selects the contract version; it
is not authentication or proof of an official client. The route accepts only the
v1 schema. It:

- accepts JSON bodies no larger than 32 KiB and batches of 1–16 events;
- before reading a body, applies independent one-minute global-request (400) and
  one-way source/IP (60) request budgets, so malformed bodies and rotating
  installation IDs still consume ingress capacity;
- after strict envelope validation, applies independent one-minute global-event
  (16, charged by batch event count) and one-way installation-ID (60 requests)
  budgets. Invalid envelopes cannot allocate caller-controlled installation
  buckets;
- keeps the original source IP out of the analytics envelope and stored event;
- does not persist a raw analytics event in the workspace database;
- sends only the normalized public v1 envelope over an authenticated server-to-server
  request to the dedicated `dopedb-product-analytics.*.workers.dev` Worker;
- requires a separate server-side `PRODUCT_ANALYTICS_RELAY_ENABLED=1` switch;
  URL/token configuration alone never exposes the dormant collector;
- repeats the global 16-event-per-minute ceiling in the Worker with an exact,
  atomic D1 budget before any raw event insert, limiting damage if the private
  relay capability is exposed;
- stores accepted events idempotently by the 64-hex `eventId` primary key in the
  dedicated D1 database restricted to Cloudflare's EU jurisdiction;
- uses no browser or Desktop analytics SDK, autocapture, cookies, session replay,
  heatmaps, surveys, feature flags, or remote configuration; and
- fails closed with a retryable response when the relay is unconfigured or
  unavailable. Accepted batches return `202`; an intentional permanent upstream
  rejection returns non-retryable `422`; rate limits return retryable `429`; an
  unavailable or unconfigured relay returns retryable `503` with bounded retry
  guidance.

Because this is a public unauthenticated ingestion surface, installation IDs,
headers, timestamps, and otherwise valid events remain caller-controlled and can
be forged or spammed within the budgets. Treat the resulting funnel as
operationally untrusted, directional aggregate evidence. Apply anomaly review and
cohort thresholds; never use it for authorization, billing, abuse enforcement,
security audit, individual customer attribution, or an externally asserted
adoption number. Authentication would exclude the pre-auth stage but would not by
itself make client-originated analytics a security receipt.

Vercel may process the inbound request and its IP as hosting/security data. That
transport metadata remains outside the stored product event and is governed by the
separate hosting-log boundary.

## Retention and access

- The local retry queue holds at most 100 events and discards events older than
  seven days. It exists only while consent is granted and is bound to the current
  installation ID and native consent generation. On overflow it reserves the
  newest pending installation anchor plus the newest unique closed milestone
  shapes, with at most 32 reserved entries total, then fills the remaining slots
  with the newest outcomes. Older high-volume query and Agent-turn events yield
  first. This is bounded priority sampling during offline bursts, not lossless
  event storage.
- The Vercel first-party relay does not persist raw analytics. The dedicated
  Cloudflare Worker persists the normalized v1 event only in analytics D1.
- One-way rate-limit bucket keys are operational abuse-control data, not product
  events. They use the shared 24-hour expiry eligibility and reclaim a bounded
  oldest-first batch only while a rate-limited request already has PostgreSQL
  active; they must not be queried as funnel identity.
- Raw events in the EU-jurisdiction D1 database expire after 30 days. A daily
  bounded scheduled job refreshes aggregate rows and deletes up to 30,000 expired
  raw rows per run; operators must monitor that the oldest row remains inside the
  promised window.
- Raw-event secondary indexes are intentionally absent. A measured indexed insert
  consumed five D1 row writes; keeping only the primary key makes the worst-case
  16-event/minute insert, exact budget, and expiry workload fit the Free plan's
  daily write limit. Reviewed aggregate queries may scan the bounded raw table and
  must stay within the separate daily read allowance.
- Only aggregate, non-identifying weekly/monthly counts may be retained beyond
  the raw-event period. Long-term aggregates must contain no installation,
  session, event, actor, or workspace key and no cohort small enough to identify
  a customer.
- Access to the Cloudflare analytics account and D1 database is limited to the operator and specifically authorized
  maintainers. Exporting raw events into spreadsheets, issue trackers, support
  tools, or Analysis Articles is prohibited.
- D1 analytics data is not merged into the workspace audit log, Neon account records,
  Sentry issues, Vercel visitor profiles, or Agent memory.

Vercel may retain inbound hosting/security metadata under its separate service
policy. That transport metadata is not a product event and is outside the local
queue and D1 raw-event retention promises above.

## Operations and deletion runbook

As of 2026-08-14 the Cloudflare storage path is provisioned but Desktop collection
remains deliberately dormant until the official release workflow compiles in the
feature. Source and development builds remain off. Activation order is fail-closed:

1. Verify the D1 database reports `jurisdiction=eu`, apply the checked-in MVP
   baseline, and deploy the Worker with preview URLs disabled.
2. Store the same 32-byte ingestion capability only as the Worker's
   `INGEST_TOKEN` secret and the protected workspace-cloud
   `PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN`; never expose it to Desktop or JavaScript.
3. Set `PRODUCT_ANALYTICS_CLOUDFLARE_URL` to the exact dedicated Worker
   `/v1/events` endpoint. Keep `PRODUCT_ANALYTICS_RELAY_ENABLED=0`.
4. Temporarily set `PRODUCT_ANALYTICS_RELAY_ENABLED=1`, send a synthetic contract-v1 batch through the first-party relay, verify one
   D1 row per event and an idempotent replay, run the three reviewed aggregate
   queries, delete the synthetic rows, record the evidence, then return the switch
   to `0` while Desktop collection remains dormant.
5. Only after the relay smoke test, retention review, consent UI, local reset,
   schema checks, privacy policy, and QA gates pass, explicitly set
   `PRODUCT_ANALYTICS_RELAY_ENABLED=1` and
   `DOPEDB_PRODUCT_ANALYTICS_ENABLED=1` for the official release build. Do not
   enable either by default for source or development builds.

Emergency stop: set `PRODUCT_ANALYTICS_RELAY_ENABLED=0`, unset either Cloudflare
relay variable, or disable the Desktop release flag. The relay must return a
retryable failure rather than acknowledge and drop a batch. Do not loosen
validation to restore analytics availability.

Consent revocation is the user-facing local deletion path: it deletes the pending
queue and installation identity immediately. A later opt-in starts new
installation and session identifiers. It stops future collection and deletes
not-yet-sent local data; it cannot identify or immediately erase raw events that
the relay already accepted. Those events expire under the D1 raw-retention
limit above.

For an access or deletion request:

1. Explain the present lookup limit before accepting a request. The UI and support
   tooling do not expose an installation ID, DopeDB keeps no
   account-to-installation map, and Personal Workspace keys are installation
   derived. Therefore v1 has no executable individual lookup/deletion path for
   installation-only, unsuccessful-authentication, or Personal Workspace vendor
   rows. They expire within 30 days.
2. For team events only, verify the requester's authority and canonical raw
   account/workspace UUID through the applicable workspace process. An authorized
   operator may recompute the documented workspace-scoped actor key and team
   workspace key locally, search only the analytics D1 database for those
   pseudonyms, and delete matching raw rows. Authentication actor keys are
   installation-scoped and cannot be recomputed without the unavailable
   installation ID. Never ask the requester to provide a hash and never store an
   account-to-installation map.
3. Verify the provider deletion job. There is no product-analytics row to delete
   from Neon, and deleting an actor/workspace pseudonym does not locate unrelated
   installation-only rows.
4. Handle Vercel website analytics and Sentry diagnostics as separate provider
   requests; never infer their identities from the analytics installation ID.
5. Record only the request, verification, provider job reference, completion, and
   any legally required retention exception. Do not copy deleted event payloads
   into the request record.

A dedicated user-held deletion token that can locate installation and Personal
Workspace rows without creating an operator identity map is planned, not
implemented. Do not describe it as available until its threat model, UI, rotation,
and vendor-deletion flow ship together.

## QA and change control

Every release that changes analytics must verify:

- pending/denied consent creates no installation ID, queue entry, or network
  request;
- granting consent creates an ID only after the action, and revoking deletes the
  ID and queue immediately;
- re-granting creates new installation, session, event, authentication-actor, and
  Personal Workspace identities. The deliberately stable team workspace and
  workspace-scoped actor pseudonyms remain linkable only inside the same team as
  disclosed;
- a renderer batch is accepted only by the exact currently granted native consent
  generation, and that native-only field is absent from the Cloud envelope;
- each of the 14 events accepts only its exact properties and identity shape;
- unknown events/properties, raw UUID identity keys, forbidden fields, stale
  timestamps, duplicate event IDs, oversized bodies/batches, and invalid enums are
  rejected at Desktop and server boundaries;
- Personal, team, authentication, and member identity rules fail closed;
- a relay configuration other than the dedicated HTTPS Cloudflare Worker is rejected;
- global request/event, source/IP, and installation budgets remain
  independent under installation and source rotation;
- the persisted D1 row contains no IP, raw account, workspace, or
  customer identifier, free-form string, error, URL, SQL, prompt, path, customer
  name, or vendor autocaptured property;
- retry is bounded, opt-out clears retries, and product work continues when
  analytics is unavailable;
- public-relay data is labeled as directional consenting-installation evidence,
  never a trusted security, billing, customer-attribution, or all-user measure;
- Sentry, Vercel site analytics, workspace audit, and local tracing cannot enter
  the Cloudflare D1 projection;
- the EN and KO privacy text describe the same implemented paths; and
- Site TypeScript/build checks reject event names or properties outside the
  current `Download Clicked` and `Workspace Opened` catalog.

Adding or changing an event requires updating this document first, then keeping
the frontend type, Rust decoder, server validator, privacy impact review, tests,
the shared `tests/fixtures/product-analytics-v1.json` golden, and operator queries
synchronized in one change. The golden is the exact public Cloud envelope and
must not contain native-only `consentGeneration`. A free-form `properties` escape
hatch, raw-log forwarding, generic event endpoint, or vendor autocapture is a
breaking privacy regression and must not ship.
