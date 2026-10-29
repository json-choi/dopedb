# Query workflow

Inside built-in AI Chat or a Desktop-approved `dopedb agent start` process, use
the supplied typed DopeDB MCP tools instead of the commands below. The exact
Project resource set is already pinned: call `environment_context`, search
metadata with `catalog_search`, describe every relation you need in one
`table_describe` call, and execute independent reads together in one
`query_read` call. Only a bounded row preview enters the conversation; for longer
listings, report how many rows were omitted. Each read is listed in the
connection's Desktop Activity, where the user can reopen and rerun its SQL.
When observing or cancelling work on a non-anchor database, pass its returned
`connectionId` back to the `operation_status`, `operation_wait`, or
`operation_cancel` tool.
Do not perform CLI discovery/version/status handshakes inside that session.

The direct CLI workflow below requires a DopeDB-created Terminal or the approved
external Agent process tree.

## Select a connection

Use:

```text
dopedb connection list --json
dopedb connection show id:<uuid> --json
dopedb connection test id:<uuid> --json
dopedb database list --connection id:<uuid> --json
```

Do not select the first connection or non-default database. If the user has not
identified a connection and there is no pinned `current` connection, ask them
to choose. If they have not identified a database, use only the database marked
`isDefault`.

## Inspect before querying

Prefer canonical catalog commands over assumptions:

```text
dopedb catalog show --connection id:<uuid> --database <database> --json
dopedb schema list --connection id:<uuid> --database <database> --json
dopedb table describe schema.table --connection id:<uuid> --database <database> --json
```

Qualify relation names when the engine supports schemas or namespaces.

## Plan exactly one read

Pass SQL through stdin:

```text
dopedb query plan --connection id:<uuid> --database <database> --file - --json <<'SQL'
SELECT id, email FROM public.users LIMIT 100
SQL
```

The planner rejects multiple statements and mutation shapes. Review:

- planning decision;
- notices and safer suggestions;
- estimated rows;
- aggregate database health and its coverage;
- plan expiration.

If the SQL changes, plan again and explain why. Do not run a plan created for
different text.

## Consume the plan

```text
dopedb query run --plan <plan-id> --json
```

Plans are exact, single-use, expiring, and Terminal-scoped. A conflict or expiry
is not permission to retry blindly. Re-plan only when the user still wants the
same read and the connection scope remains correct.

Results are row- and byte-capped. A truncated result is not the full table.
Summaries must say when truncation occurred.

## Cancellation and failure

Use the returned operation identifier:

```text
dopedb query cancel <operation-id> --json
```

Distinguish cancellation, timeout, target execution failure, scope denial, and
protocol mismatch. Never convert a failed or missing receipt into success.
