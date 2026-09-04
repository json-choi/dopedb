# ADR 0007: Analysis Article is a published HTML document with one saved query

- Status: accepted, superseding the block-graph decision from 2026-08-12
- Date: 2026-08-27
- Owners: DopeDB product and workspace architecture

## Context

The first Analysis Article implementation combined a document block registry,
multi-source query graph, transforms, semantic metrics, shared result fragments,
schedules, signals, lineage review, and a separate public-snapshot builder. That
model made the common job—publish a readable analysis and run its query again
later—hard to understand and expensive to operate.

DopeDB is a shared database-access workspace, not a general BI composition
platform. SQL and an Agent already handle ad-hoc transforms and new analysis
questions better than a second visual programming system.

## Decision

`AnalysisArticle` remains the shared analysis resource, but its current contract
is deliberately small:

```text
AnalysisArticle
|- title
|- sanitized HTML body
|- one read-only saved query
|  |- one exact workspace connection id and content revision
|  |- declared bounded result columns, rows, and bytes
|- immutable edit history
|- local manual run receipts and recoverable local result
`- optional immutable public HTML publication
```

The editor exposes only the title, HTML body, database, and SQL. The article view
renders that HTML, shows the latest local query result, and has one explicit
`Run again` command. Changing the question means editing the saved SQL or asking
the Agent; it does not add a block, transform, metric, or dashboard mode.

## Query and authority contract

An article owns exactly one non-empty read-only query. It pins the shared
connection's public content revision, because that is the revision the Desktop
receives and can persist. Execution separately rechecks the current member grant,
connection existence, revocation gate, runner capability, local credential, and
local read-only policy. The internal revocation/lease epoch is not a content pin
and must not invalidate an unchanged saved query.

Pre-MVP Article payloads that do not carry the current content revision are
unsupported. They fail closed rather than inferring authority from an internal
epoch or another historical field.

The query executes only after an authenticated person explicitly requests a
manual rerun in Desktop. There is no cron, signal-triggered run, publication run,
or hosted execution. Results remain as bounded local artifacts; the workspace
service may retain run metadata and audit receipts but is not a result warehouse.
Failure never erases the last recoverable successful local result.

Saving creates the current shared workspace revision immediately. There is no separate
draft/review/live workflow, and those fields are rejected at the contract boundary.

## HTML contract

The body is ordinary HTML, not a component graph. It is sanitized against a
closed allowlist before storage/publication. Scripts, event handlers, forms,
iframes, remote embeds, inline styles, executable URLs, and hidden query metadata
are rejected or removed. The same sanitized body is used by Desktop preview and
the public page so publication does not introduce a second rendering grammar.

Public publication creates an immutable HTML snapshot. The public route has no
workspace session, database grant, query text, query command, credential path, or
refresh action. Running the saved query is available only inside the authenticated
Desktop article. Updating public HTML creates a new immutable publication version;
revocation disables its slug without rewriting audit history.

## Removed product surface

The current product does not expose or create:

- arbitrary article blocks, responsive layouts, or visualization definitions;
- multi-query graphs, cross-database transforms, semantic metrics, or evidence
  claim graphs;
- parameters, schedules, background runner selection, freshness targets, shared
  result fragments, or metric signals;
- block/result selection, sensitivity confirmation, or a separate publication
  preview workflow.

Pre-MVP definitions, schedules, signals, result fragments, and lifecycle records are
not read or retained. The current schema contains no compatibility parser or dormant
automation tables.

## Agent and human ownership

An exact-grant ACP Agent may propose or update the HTML body and the one read-only
query, and may perform a bounded pre-save read. It cannot publish or revoke a public
page, broaden the connection grant, or run a query from the hosted service.

The screen owns database selection, SQL/result inspection, manual rerun,
publication, revocation, deletion, and conflict recovery.
Deletion is workspace-resource cleanup rather than database execution. It still
requires an active write-capable workspace session, exact optimistic Article
revision, and Article ownership or workspace administrator authority, but does
not require a still-live Environment binding, connection grant, Knowledge grant,
mapping, or runner. Revoked source authority must not make an orphaned Article
impossible to remove.

## Consequences

- Publishing is the familiar operation of publishing an HTML document.
- A saved query stays reproducible without building a dashboard runtime.
- Public pages are cheap, cacheable static content and cannot reach a database.
- Removing schedules, signals, shared results, graphs, and transforms materially
  reduces UI depth, server polling, storage, and failure modes.
- Multi-source or newly shaped analysis is performed in SQL or by the Agent and
  then saved as a new single-query article when it is worth sharing.
