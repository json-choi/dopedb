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

Human output shows the two database identities once, the counts, `Compared
properties match.` when there are no differences, one `Compared: …` and one
`Not compared: …` line in the result's scope order, then relation groups with
full `−` baseline / `+` target definitions.
Identifiers and values are never ellipsized; terminal control characters are
escaped. A valid comparison exits with status 0, including when differences are
found. `--json` emits the complete `SchemaDiff` version-2 result with no
headings, containing:

- `baseline` and `target`: connection ID, database, catalog fingerprint and capture time.
- `engine`, `scope`, `counts`, `total` and all `objects`.
- `scope.compared` and `scope.notCompared`: closed camelCase property lists,
  identical for every result of this version.
- Each object: relation path (`schema.table`, never the database name), object
  type (`table`, `view`, `materializedView`, `column`, `index`, `foreignKey`),
  name, status and both complete values.

The comparison follows Desktop Diff. It compares exactly (`scope.compared`):
relation presence and kind (`relationPresence`, `relationKind`); column presence,
type, nullability and primary-key membership (`columnPresence`, `columnType`,
`columnNullability`, `primaryKey`); index presence, key order — a column or an
expression key such as `lower(email)` — and uniqueness (`indexPresence`,
`indexKeys`, `indexUniqueness`); and foreign-key column targets
(`foreignKeyTargets`). Relations are identified by the `(schema, name)` pair,
so names containing dots cannot collide; database names and native IDs are
excluded from cross-environment object identity. Whole added/missing relations
count once. A renamed object appears as an addition and a missing object.

- `primaryKey` is set membership: whether each column belongs to the primary
  key, not the key's column order.
- `foreignKeyTargets` is per column: each referencing column's referenced
  relation and column, not constraint names or composite grouping. Two
  single-column keys and one composite key with the same column pairs compare
  equal.
- Type spelling ignores outer whitespace and letter case except inside quoted
  text: MySQL `ENUM`/`SET` members and quoted identifiers keep their case, so
  `enum('A','b')` and `enum('a','B')` differ while ` BIGINT ` equals `bigint`.
- A UNIQUE constraint counts only through its index, and an INVALID index or a
  NOT VALID foreign key compares like a valid one.

It does not compare (`scope.notCompared`): column order, column defaults,
generated columns, identity/auto-increment, collations, check constraints,
UNIQUE constraints without an index, index methods, index predicates, INCLUDE
columns, index sort order, index validity, foreign-key actions, foreign-key
deferrability, foreign-key validation, view definitions, partitioning, comments,
triggers, routines, types or sequences (`columnOrder`, `columnDefault`,
`generatedColumn`, `identity`, `collation`, `checkConstraint`,
`uniqueConstraint`, `indexMethod`, `indexPredicate`, `indexInclude`,
`indexSortOrder`, `indexValidity`, `foreignKeyAction`, `foreignKeyDeferrable`,
`foreignKeyValidation`, `viewDefinition`, `partitioning`, `comment`, `trigger`,
`routine`, `type`, `sequence`), nor row data. `total` 0 means only the compared
properties match, not that the schemas are identical; Desktop states the same
scope. Different engines and MongoDB are rejected. CLI and Desktop consume the
same neutral comparison fixture in their existing critical contract tests, which
also pin the object order.

Objects are ordered by relation `(schema, name)`, then the relation-level entry,
columns, indexes and foreign keys, each by name in Unicode code-point order (not
natural or locale order). Several entries for one foreign-key column list
additions before missing values. Desktop uses the same order.

Desktop reads both sides through the same live loader as `catalog.show` with an
exact database. Opening the comparison and each explicit reread introspect the
baseline and the selected comparison database once; other group members are not
read. Each side shows when it was read, and a failed reread keeps the previous
comparison visible with that read time and a retry.

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

The private Broker command schema is version 18. Version 18 added the
`materializedView` object type, expression-key comparison and the `scope` field
to the version-2 schema diff and an optional rejected-decision reason to
operation summaries, so a
version-17 CLI is refused and told to update from Desktop Settings → Command
line. Publishing updated installers remains a separate explicit release action.
