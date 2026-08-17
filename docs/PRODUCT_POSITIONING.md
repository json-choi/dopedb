# DopeDB Product Positioning

Status: accepted product decision, updated 2026-08-17.

This document owns DopeDB's market category, competitive boundary, and public
message. Architecture documents prove how the promise is enforced; the landing
site and README files must not invent a broader promise than the shipped product.

## Decision

DopeDB is the **shared database access workspace for teams and AI agents**.

It is not positioned as a universal desktop database client, a text-to-SQL
assistant, or a general-purpose MCP server. The desktop client is the local
execution and approval console. The hosted workspace is the control plane for
shared connection identity, membership, policy, provider resources, revisions,
bounded Analysis Article result fragments, and collaboration audit. Database
traffic continues to run through an exact-grant Desktop runner; the hosted
service does not become a database proxy.

The product promise has five parts:

1. A team shares a secretless connection definition, not a database password.
2. Each member uses an individual local credential or receives a least-privilege,
   short-lived managed credential.
3. Each official Claude or Codex Agent session is pinned to one exact workspace,
   account, connection revision, and policy boundary.
4. Risky execution is observable, approvable, stoppable, and recoverable, with an
   immutable operation and receipt trail.
5. A team can keep one versioned Analysis Article current from several exact
   database grants, inspect the lineage of every metric, and publish only an
   explicitly reviewed fixed snapshot outside the workspace.

## Audience and job

The first audience is a small engineering or data team that already uses Codex or
Claude Code and needs those agents to inspect staging or production-shaped
databases without distributing one shared credential or opening an unrestricted
database tool surface.

Their job is not merely "generate SQL." It is:

> Let a teammate or Agent reach the right database with the right authority, then
> see, approve, stop, and recover what it does.

Local-only users remain supported. Personal Workspace is the zero-account entry
path and the offline fallback, not the product's differentiating market position.
Signing in may add an account-bound GitHub Knowledge source to that local
workspace, but does not turn Personal Workspace databases, credentials, or Local
Folder paths into shared cloud records.
Signing in or switching accounts never selects a Team Workspace. Personal remains
active until the user explicitly chooses a Team from the workspace switcher.

## Competitive boundary

The following capabilities are category baseline. They are necessary, but none is
a sufficient reason to build or market DopeDB:

- a Tauri/Rust desktop database client;
- OS-keychain credential storage;
- schema introspection and SQL execution;
- a local CLI or MCP-compatible tool attachment;
- client-side read-only classification;
- a write confirmation dialog;
- a local query/audit log;
- a long list of database drivers, plugins, themes, or visual designers.

DopeDB differentiates only when those primitives form one enforceable shared-access
system:

| Baseline surface | DopeDB product boundary |
| --- | --- |
| Saved local connection | Revisioned, secretless workspace connection template |
| One user's keychain | Member-local binding or member-specific managed lease |
| General MCP database server | Session-local typed bridge pinned to exact authority |
| Toggleable read-only mode | Workspace role + connection grant + DB privilege + local policy |
| Query confirmation | Immutable proposal, exact approval, run claim, outcome receipt |
| Local activity log | Local execution audit plus scoped collaboration audit |
| Generic cloud connection | Provider-native discovery, issuance, revoke, drift, and lifecycle |
| Generic dashboard builder | Versioned Analysis Article with exact-source lineage, bounded live results, human publication, and deterministic blocks |

Analysis Article is the only BI collaboration domain. Dashboard, Funnel Analysis,
and Agent Report are migration sources, not separate product categories. Signal
rules attach to a published article metric. Flexibility comes from the closed,
versioned block and transform registries in
[`adr/0007-analysis-article-bi-domain.md`](adr/0007-analysis-article-bi-domain.md),
not arbitrary executable widgets or hosted cross-database SQL federation.

Do not chase a competitor's driver count or general database-management feature
list. A new engine or provider is justified only by verified user demand after the
existing shared-access path meets its discovery, onboarding, issuance, revoke,
drift, and platform E2E gates.

## Canonical message

English one-line description:

> DopeDB is an open-source database workspace where teams share access without
> sharing database credentials, and Codex or Claude works through one
> connection-pinned, locally enforced session.

Korean one-line description:

> DopeDB는 팀이 DB 인증정보 대신 연결과 정책을 공유하고, Codex와 Claude가
> 정확한 연결에 고정된 로컬 권한 경계 안에서 일하게 하는 오픈소스
> 데이터베이스 워크스페이스입니다.

Short headline:

> Share database access. Keep credentials personal.

Korean short headline:

> DB 접근은 함께, 인증정보는 각자 보관하세요.

The short headline is the **descriptive** line. It stays in page metadata, structured
data, README files, and the workspace console sign-in screen. The landing hero uses a
separate persuasive hook recorded in [Landing hook](#landing-hook); a hook may lead
with the reader's situation, but it may not assert anything the claim discipline below
forbids.

## Proof and claim discipline

Public copy may describe these implemented foundations:

- Personal and team workspaces, device sign-in, invitations, membership, and roles;
- secretless shared connection templates with member-local credential binding;
- managed PlanetScale, Neon, and GCP Cloud SQL access that returns expiring,
  member-specific database credentials without persisting the issued secret;
- official Claude and Codex ACP sessions pinned to workspace/account/connection
  revision and local policy;
- read-only execution, exact write proposals and approvals, cancellation, manual
  transaction rollback, durable local results, and audit receipts;
- local query execution without routing database traffic through the workspace
  service.

Two of those foundations are easy to overstate, so public copy must carry their
boundary in the same sentence that makes the claim:

- **Availability.** An already-synchronized workspace connection used with a
  member-local credential keeps working while the workspace service is unreachable,
  and Personal Workspace never required an account. Issuing a new managed credential
  and applying membership, policy, or revision changes do require the service, so
  never write an unqualified "DopeDB going down cannot affect you."
- **Result locality.** Queries, results, cancellation, and rollback stay on the
  member's machine, with one deliberate exception: the reviewed, bounded, masked
  result fragments a person publishes into an internal Analysis Article. Copy may say
  results stay local only when it also names that exception, and must not claim the
  workspace service knows *nothing* beyond who may reach what.

Public copy must label the product as an alpha and must not imply that the following
open roadmap work is complete:

- complete per-connection grant administration and every Milestone 2 exit criterion;
- general provider inventory/import and all revoke/drift reconciliation;
- full bidirectional resource sync, KMS wrapping, backup/restore, or self-service
  workspace deletion;
- packaged two-member production validation of the completed Analysis Article
  migration, scheduled Desktop runner, shared bounded results, and fixed public
  publication flow;
- the remaining Local Folder Project Knowledge and any paid/experimental graph product;
  GitHub exact-commit source browsing is the default source path, not a completed graph;
- bundled Node and independently installed first-party ACP adapter distribution;
- arbitrary cloud providers, database engines, or provider branching abstractions.

## Priority order

When work competes for time, use this order:

1. Make sharing one connection and obtaining individual access reliable.
2. Finish provider discovery, least-privilege issuance, revoke, expiry, and drift.
3. Strengthen the exact Agent authority, approval, stop, result, and recovery loop.
4. Keep GitHub exploration cheap and exact through pinned tree/path/file reads, then
   validate a graph product with measured quality, latency, and operating-cost gains
   before re-enabling graph construction as a paid/experimental capability.
5. Complete the Analysis Article archive, exact-source multi-database transforms,
   Desktop refresh runner, bounded team results, fixed public publications, and
   article metric signals only on top of that environment boundary.
6. Deepen schema introspection where it improves Agent judgment.

General local-client convenience, driver breadth, visual object authoring, built-in
model APIs, and universal MCP compatibility do not outrank those items.

## Landing contract

The public landing page serves one audience and one primary action:

- Audience: teams already using Codex or Claude against real databases.
- Offer: the current open-source DopeDB alpha for macOS or Windows.
- Primary conversion: a release download.
- Core objection: "Will this expose a shared credential or give an Agent broad DB
  authority?"
- Required proof: secretless shared template, per-member access, exact Agent pin,
  local execution, and visible approval/recovery.

GitHub and architecture documents are supporting evidence, not competing hero calls
to action. Future testimonials, usage numbers, or customer logos must never be
fabricated; add them only when a verifiable source exists. The same rule covers
setup-time and performance figures: a promise such as "five minutes to your first
connection" needs a measured onboarding source, so prefer a verifiable low-cost fact
("no account required") over an invented duration.

### Landing hook

The hero opens on the reader's situation rather than on architecture:

> Before you hand Codex your prod database.
>
> An Agent can ignore a system prompt. It cannot ignore authority.

Korean:

> Codex에게 prod DB를 맡기기 전에.
>
> Agent는 system prompt를 무시할 수 있습니다. 권한은 무시할 수 없습니다.

Rules for changing the hook:

- Keep the alpha label and the local-execution proof visible in the same viewport.
- Name a concrete moment the reader recognizes; do not lead with "boundary" or
  "control plane" as the subject of the sentence.
- Say what the reader does not have to experience, not what the system internally owns.
- Every trust section stays answerable by the [Proof and claim discipline](#proof-and-claim-discipline)
  list, including the availability and result-locality boundaries.

## Success measure

Raw visitors are diagnostic, not the product outcome. The leading product measure is
weekly activated workspaces:

> A workspace with a verified connection and at least one successful bounded Agent
> or member read, segmented into Personal and team workspaces.

Track the funnel from landing visit to release download, first open, verified
connection, first bounded query, first shared connection, and seven-day return without
recording SQL, hostnames, database names, schema names, credentials, or result rows.
