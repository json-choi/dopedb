# CLI schema comparison

`dopedb schema diff` compares two fresh, authorized catalogs and prints only
structural differences. The baseline is explicit: `added` exists only in the
target, `missing` exists only in the baseline, and `changed` exists on both sides
with a different compared definition.

```sh
dopedb schema diff --baseline id:<production-connection-uuid> --target id:<development-connection-uuid>
dopedb schema diff --baseline id:<production-connection-uuid> --target id:<development-connection-uuid> --json
```

Both selectors must be authorized by the same active Desktop session. A normal
connection-pinned Shell cannot gain access to a second saved connection with this
command. For two separate environment connections, select both databases in one
Project when starting built-in AI Chat or `dopedb agent init/start`, approve that
exact resource set in Desktop, and ask the official Agent to compare them. The
Agent uses the session-scoped `schema_diff` tool directly.

Direct CLI selectors follow existing conventions: `id:<uuid>`,
`name:<exact-name>`, or `current`. Ambiguous names fail and require an exact ID.
`--baseline-database` and `--target-database` select exact databases where the
pinned connection permits them; omitted values use each connection's configured
database. They do not expand a Project resource grant.

## Output and scope

Human output shows the two database identities once, counts, relation groups,
and full `−` baseline / `+` target definitions. Identifiers and values are never
ellipsized; terminal control characters are escaped. A valid comparison exits
with status 0, including when differences are found. `--json` emits the complete
`SchemaDiff` version-1 result with no headings, containing:

- `baseline` and `target`: connection ID, database, catalog fingerprint and capture time.
- `engine`, `counts`, `total` and all `objects`.
- Each object: relation path, object type, name, status and both complete values.

The comparison follows Desktop Diff: relation kind; column type, nullability and
primary-key membership; index column order and uniqueness; and foreign-key column
targets. Database names and native IDs are excluded from cross-environment object
identity. Whole added/missing relations count once. A renamed object appears as
an addition and a missing object. Type spelling is case/outer-whitespace insensitive.

This structural projection does not compare default/generated expressions,
check constraints, index expressions/predicates, foreign-key actions, routine or
view SQL, comments, or row data. Zero differences means the compared fields match.
Different engines and MongoDB are rejected. CLI and Desktop consume the same
neutral comparison fixture in their existing critical contract tests.

## Broker and Agent boundary

No new Broker command, credential path or provider integration is introduced.
CLI and Agent share one loader and pure Rust comparison model. The loader checks
both `connection.show` selectors before reading either side, then sends
`catalog.show` with each exact database to use Desktop's fresh introspection path.
Both connection grants are checked again before returning the comparison. Every
request uses the same runtime and session. Any failed read, mismatched snapshot,
changed connection or denied grant fails the entire comparison without partial
stdout. The two capture times are separate reads, not a cross-database transaction.
Existing Broker catalog response limits still apply and fail explicitly.

The session-scoped Agent tool requires `baselineConnectionId` and
`targetConnectionId`; optional database selectors have the same meaning as the
CLI flags. It returns `{ diff, offset, nextOffset, truncated }`. `diff.counts` and
`diff.total` describe the complete comparison. Its object page defaults to 100
entries, accepts a `limit` of 1–200, and also has a 256 KiB serialized-entry budget.
Individual definitions are never clipped. To continue, pass `nextOffset` as
`offset` and both `diff.baseline.fingerprint` / `diff.target.fingerprint` as
`baselineFingerprint` / `targetFingerprint`. Catalog drift rejects continuation
and requires a fresh first page. An individually oversized object fails clearly.

The private Broker command schema stays at version 17 because the request and
response meanings of its existing commands are unchanged. This feature requires
a Desktop/CLI build containing the new CLI parser and Agent tool; publishing
updated installers remains a separate explicit release action.
