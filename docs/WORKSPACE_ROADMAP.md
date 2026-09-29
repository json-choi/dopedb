# Workspace Collaboration Roadmap

Status: maintained alpha roadmap, updated 2026-09-29.

This document tracks the remaining work needed to harden DopeDB's team workspace.
It does not define product scope. Scope is owned by
[Product Positioning](./PRODUCT_POSITIONING.md),
[Product UI Scope](./PRODUCT_UI_SCOPE.md), and accepted ADRs.

## Product outcome

DopeDB is a shared database-access workspace for teams and AI agents. The hosted
service owns identity, secret-free connection records, policy, provider resources,
revisions, and collaboration audit. Desktop owns credentials, database traffic,
execution, approval, cancellation, recovery, and local result rows.

Work is prioritized in this order:

1. Make sharing one connection and obtaining member-specific access reliable.
2. Complete provider discovery, least-privilege issuance, revoke, expiry, and drift.
3. Enforce every Agent operation inside one exact Project resource grant.
4. Keep the simple HTML Analysis Article and immutable public publication reliable.
5. Deepen schema introspection where it materially improves Agent judgment.

Driver count, a general database-client feature list, dashboards, text-to-SQL, and an
always-on general MCP server are not workspace exit criteria.

## Adopted roadmap: use-case proof and team self-hosting

Owner direction accepted 2026-09-29:

1. Show the three strongest useful DopeDB workflows on the introduction site with
   graphics grounded in actual product use. Start with candidate selection, then
   validate the flows, capture them, and implement the site presentation.
2. Add an option for a team to self-host the workspace control plane and retain
   control of provider access-issuance authority. This is accepted roadmap work,
   not an available installation option; packaging and supported deployment
   dependencies still need design.
3. Skip business-model development. Pricing, paid tiers, conversion funnels, and
   license changes are not deliverables of this roadmap.

These presentation priorities do not waive the alpha reliability and security
gates below. Candidate selection is not proof that a workflow is ready to publish.

### Introduction-site candidates, in recommended display order

| Candidate | Concrete task and benefit | Actual-use graphic sequence | Evidence required before publication |
| --- | --- | --- | --- |
| 1. Give a teammate database access without another provider login | An administrator connects a supported managed provider; an authorized teammate signs in to DopeDB and reads the shared database without handling the administrator's provider key or a shared DB password. | Administrator's managed connection and team access → teammate's shared connection → successful local read. | A packaged two-member run on one named supported managed provider, with distinct member access and redacted issuance evidence. DopeDB sign-in and grants remain required; do not imply member-local or BigQuery authentication is eliminated. |
| 2. Investigate a data problem using code and the real database together | Ask why a sample order is missing from a report. The Agent reads the explicitly selected source revision and database schema/data, then explains the cause with file and query evidence. | Project resource selection → actual investigation request → source/query evidence and explanation. | A packaged official Agent session with a selected GitHub source revision and DB, reproducible synthetic data, evidence supporting the answer, and verification that unselected resources are inaccessible. Do not imply automatic cross-database joins or an implemented knowledge graph. |
| 3. Share a clear funnel analysis with workspace teammates | Turn an investigation of an order-conversion funnel into a readable Analysis Article with its explanation and one exact read-only query. Share it inside the workspace so authorized teammates can understand the analysis and manually rerun the query in Desktop with their own access. | Actual funnel investigation → readable Article with stage definitions and findings → internal share link → authorized teammate opens the same Article and manually reruns its query. | A packaged two-member run proving internal access checks, the same shared Article definition, one exact read-only query, and independent authorized Desktop reruns with local-only result rows. Show synthetic analysis content; no public publication is needed for this story. A funnel is the subject of the Article, not a new funnel-builder, dashboard, multi-query pipeline, or automatic refresh feature. |

The three candidates cover team onboarding, useful investigation, and clear
internal analysis sharing. Use one coherent
synthetic order-data scenario where practical, with product-owned neutral names.
Capture actual application screens or recordings; crop, annotate, and sequence
them for readability without fabricating controls, Agent answers, or receipts.
Keep secrets and private data out of captures. Explain any illustrative overlays
and keep each workflow's prerequisites and alpha status visible.

Analysis Article sharing replaces Agent-proposed data correction as the third lead
story by owner direction. Its packaged two-member and manual-rerun validation gates
remain open; selection does not imply completion. Write approval remains a
supporting capability. Generic SQL generation, driver count, and personal offline
use are also supporting capabilities rather than these lead stories.

Completion means three verified workflows, their redacted capture evidence, and
readable site graphics with accurate captions. Site visitors do not execute real
database operations through those graphics. No graphics or site changes are
completed by this roadmap entry.

### Team self-hosting: accepted direction, design pending

The intended option lets a team operate workspace identity, membership, connection
definitions, policy, collaboration metadata, and managed provider issuance inside
its own infrastructure. Provider authorization or keyless trust must be controlled
by that team, rather than requiring DopeDB's hosted service to issue access.
Desktop continues to execute DB traffic locally and receive member-specific
short-lived credentials; self-hosting does not create a DB proxy or shared static
password distribution path.

Before implementation, settle the supported installation target and external
dependencies, team authentication and bootstrap, Desktop server selection and
server-bound identity isolation, secret/key ownership and rotation, scheduling and
expiry/revoke behavior, backup/restore, upgrades, and operator responsibility.
Record these choices in an ADR and update the Product UI Scope decision table and
implementation tracker before introducing server-selection controls. The option
must not silently reuse hosted-service sessions or provider authority.

Acceptance requires a clean installation on team-controlled infrastructure,
two-member managed access with no DopeDB-hosted control-plane dependency, verified
denial and expiry behavior, and documented upgrade and restore drills. This does
not promise offline provider APIs or offline AI execution. Existing application
principals, grants, and ownership must remain unchanged by setup and repair.

## Architecture boundary

- `workspace-cloud/` is the authenticated web and API control plane at
  `app.dopedb.dev`; `site/` is the separate public marketing deployment.
- Hosted PostgreSQL stores collaboration metadata. Desktop never connects to that
  database directly.
- Member-local credentials stay in each member's OS credential store.
- Managed access uses provider-native or approved broker authority to issue a
  member-specific, least-privilege, short-lived database credential. The issued
  secret is delivered once and kept only in Desktop process memory.
- Target-database traffic never passes through Workspace Cloud.
- Provider discovery and authentication use the provider's official CLI where the
  app is the caller. DopeDB does not read a provider token and call its API directly.
- Codex and Claude run through their official adapters or official local CLIs. Every
  Agent session is bound to the current workspace, account, exact selected Project
  resources, process ancestry, local policy, and at most one write target.

```mermaid
flowchart LR
    W["Workspace control plane<br/>identity · connections · grants · revisions"]
    A["Member A Desktop<br/>credential · execution · audit"]
    B["Member B Desktop<br/>credential · execution · audit"]
    AA["Codex or Claude<br/>exact Project grant"]
    AB["Codex or Claude<br/>exact Project grant"]
    DB[(Target database)]
    W <-->|"secret-free metadata"| A
    W <-->|"secret-free metadata"| B
    AA <-->|"runtime-only typed bridge"| A
    AB <-->|"runtime-only typed bridge"| B
    A -->|"local DB traffic"| DB
    B -->|"local DB traffic"| DB
```

## Shared and local data

| Resource | Workspace Cloud | Desktop only |
| --- | --- | --- |
| Connection | engine, endpoint fields, environment, safety ceiling, revision, grant, redacted provider selector | username, password, token, certificate, connection URL, local secret reference, live pool |
| Provider integration | encrypted provider authorization or keyless trust metadata, verified scope, lifecycle and audit | one-time issued DB credential and local transport diagnostics |
| Project | resource identity, Environment bindings, exact revisions and grants | Local Folder absolute path and member-specific credential binding |
| Agent session | no transcript, capability, SQL, result, or process token | exact runtime grant, process binding, transcript, proposals and execution results |
| Analysis Article | sanitized HTML, one read-only query definition, exact connection content revision, immutable revisions, manual run receipt metadata | query result rows and bounded encrypted recovery artifact |
| Public article | immutable sanitized HTML snapshot, slug state, publisher receipt | saved query, private result, database grant, rerun command |
| Audit | collaboration changes and redacted authority receipts | full local query and operation audit |

Workspace roles never grant target-database privileges. The credential used on the
member's device and the database's own roles remain authoritative.

## Current Analysis Article contract

[ADR 0007](./adr/0007-analysis-article-bi-domain.md) owns this contract:

- one sanitized HTML body;
- exactly one non-empty bounded read-only query;
- exactly one connection content revision pin;
- immutable edit history;
- an explicit Desktop-only manual run with cancellation and authority rechecks;
- local-only result rows and a hosted query receipt;
- an optional immutable public HTML publication with no query or session path.

There is no parameter surface, transform graph, visualization block registry,
multi-query join, schedule, background runner selection, freshness monitor, result
upload, metric signal, or hosted database execution.

The serializer and every storage boundary accept only the compact current definition.
Pre-MVP Article definitions, lifecycle fields, automation records, result fragments,
and migration archives are unsupported and have no parser, table, route, or UI path.

## Authorization model

Workspace role and connection grant are separate narrowing layers. Managed imports
create a team-read policy for current and future members (view-only for Viewers);
existing connections remain explicit until their manager enables sharing in Access.
Individual grants override this default. Removed access is recorded by user identity
and survives membership re-creation and policy toggles. Team sharing never grants
write or manage, and disabling it drains leases before removing policy-created grants.

| Capability | Viewer | Analyst | Editor | Admin | Owner |
| --- | ---: | ---: | ---: | ---: | ---: |
| View current Articles for granted connections | yes | yes | yes | yes | yes |
| Run an allowed shared read locally | no | yes | yes | yes | yes |
| Create or update a shared Article | no | no | yes | yes | yes |
| Edit an Article or publish immutable HTML | no | no | yes | yes | yes |
| Manage connection policy and grants | no | no | no | yes | yes |
| Invite, remove, or change member roles | no | no | no | yes | yes |
| Delete the workspace | no | no | no | no | yes |

Every database operation is narrowed by all applicable layers:

1. active account and workspace session;
2. current membership and workspace role;
3. exact Project Environment/resource revision;
4. a materialized connection grant, either explicit or created by the manager-owned team-read policy;
5. provider and database credential capability;
6. Desktop safety policy;
7. exact proposal approval when the caller did not author the mutation;
8. target database privilege and read-only/transaction enforcement.

A cached role is only a UI hint. Revocation and mutation paths lock and recheck the
authoritative rows before committing.

## Implemented foundation

- Personal and team workspaces, Desktop browser sign-in with a short-lived loopback
  callback and PKCE, invitations, roles, and member removal. Existing RFC 8628
  endpoints remain compatible; the current CLI has no independent Workspace login
  command and `agent start` uses Desktop approval and its exact Project grant.
- Secret-free shared connection templates and member-local credential bindings.
- Per-connection `view`, `use`, and `manage` grants.
- Managed PlanetScale, Neon, GCP Cloud SQL, and allowlisted Vault access paths.
- Provider credential lease issuance, early revoke, provider expiry, and deferred
  cleanup through exact due-time scheduling rather than idle PostgreSQL polling.
- Project and Environment resource binding for databases, BigQuery, and source code.
- Exact-resource Desktop ACP sessions and Desktop-approved external
  `dopedb agent init/start` sessions.
- Local read-only enforcement, immutable write proposals, exact approvals,
  cancellation, rollback, result recovery, and hash-chained local audit.
- Compact HTML Analysis Articles, immutable revisions, manual Desktop rerun receipts,
  cancellation, and immutable public HTML publications.
- KMS-wrapped metadata backup, resumable key rotation, and reversible Owner workspace
  deletion in the control plane.

Implemented does not mean production validation is complete. Public claims remain
bounded by [Product Positioning](./PRODUCT_POSITIONING.md).

## Remaining alpha work

### Shared connection reliability

- Finish packaged two-member tests for create, grant, local binding, managed lease,
  revoke, reconnect, duplicate prevention, and member removal.
- Verify that every permission error links to the single authoritative Safety or
  Workspace database-access surface and reports the exact missing layer.
- Verify macOS and Windows credential-store isolation across multiple signed-in
  accounts and workspace switches.

### Provider lifecycle

- Run production discovery/import/lease/revoke/drift scenarios for every shipped
  provider with redacted evidence.
- Verify scheduler outages never extend provider credentials and that the next request
  performs bounded repair without periodic database polling.
- Complete recovery UX for revoked OAuth/provider authority while preserving connection
  IDs, Project bindings, and member grants.

### Project and Agent authority

- Complete packaged Project-context selection across arbitrary combinations of
  databases, BigQuery resources, and source repositories.
- Prove a stale resource revision, account change, workspace switch, process exit, or
  grant revoke stops the exact session without affecting unrelated work.
- Validate the shipped signed adapter installer, candidate promotion, and rollback
  on every supported release target; the launcher uses bundled Node and the verified
  adapter entrypoint described in the [runtime contract](contracts/acp-plugin-runtime.md).

### Analysis Article validation

- Verify two members can read the same Article definition and manually run its query
  with independent credentials while result rows remain local.
- Verify restart recovery preserves the last bounded local success and a failed rerun
  does not erase it.
- Verify publication creates and revokes one immutable HTML snapshot and exposes no
  saved SQL, private result, workspace enumeration, or rerun path.
- Verify unsupported pre-MVP Article payloads fail closed at both HTTP and Desktop
  boundaries while current manual-run and publication records remain round-trippable.

### Sync, backup, and recovery

- Complete full bidirectional projection validation, cursor compaction/rebase, offline
  replay, conflict visibility, KMS restore, and cross-account isolation.
- Verify destructive workspace lifecycle actions against live KMS and production
  PostgreSQL with explicit recovery evidence.

## Validation requirements

Every completed item needs evidence proportional to its risk:

- Rust and TypeScript contract checks for wire changes;
- cross-workspace, stale-revision, explicit-deny, and confused-deputy tests;
- credential and sensitive-data leak checks for logs, analytics, crash reports, sync,
  and backups;
- macOS and Windows packaged behavior for credential and process boundaries;
- target database tests proving Workspace state cannot bypass database read-only or
  privilege enforcement;
- retry, cancellation, process exit, provider timeout, and partial-failure recovery;
- no hidden scheduler, hosted result storage, or always-on database endpoint.

Do not close a live-validation issue from unit tests alone. Record the account,
provider, app version, exact scenario, redacted evidence, and remaining failure before
removing its validation label.

## Deferred decisions

- Knowledge graph construction is not shipped. A new implementation starts only after
  a benchmark proves material quality or latency gains relative to GitHub exact-commit
  reads and operating cost, and a paid or experimental entitlement is explicitly approved.
- Additional providers and engines require verified demand and a complete connection,
  revoke, drift, and platform test plan.
- Enterprise SSO/SCIM, configurable retention, and data residency beyond the current
  deployment remain separate decisions. Team self-hosting is accepted above;
  its packaging and implementation design remain pending.
- Cross-device Personal Workspace database, credential, and Local Folder sync is not
  implied by account sign-in.
