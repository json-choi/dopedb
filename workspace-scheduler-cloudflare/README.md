# DopeDB Workspace Background Scheduler

This Cloudflare Worker is a small wake-up coordinator for the Vercel workspace
control plane. Its D1 database stores exactly two rows (`credential` and
`maintenance`) containing a due time, a short execution lease, a generation,
and a closed error kind. It stores no workspace, member, repository, provider,
credential, graph, or Analysis data.

The Worker cron checks D1 every minute. It contacts `app.dopedb.dev` only when a
task is due. A receipt with `nextRunAt: null` parks that row in a dormant state;
there is no hourly PostgreSQL reconciliation. Managed lease issuance, deferred
revocation, retention tombstones, result fragments, discovery receipts, and
notification creation move only their task to an exact due time through
`/v1/kick`. The credential route is isolated from general retention work, so an
expiring lease does not fan out into unrelated queries. Five consecutive
failures open a six-hour circuit-breaker interval; a new producer kick resets
the failure state and retries earlier. This keeps PostgreSQL authoritative while
allowing Neon to remain suspended when there is no durable work.

`/v1/kick` requires the exact contract header and the `KICK_TOKEN` Worker
secret. The token is a server-to-server capability, never a Desktop or browser
secret. The Worker calls the existing internal routes with the separate
`WORKSPACE_CRON_SECRET`. Both upstream responses and kick bodies are streamed
under fixed byte caps, redirects are refused, and logs contain only task and
closed failure enums. The event-driven task and nullable receipt shape is
contract v2; mixed v1/v2 deployments reject each other instead of guessing.

## Operator commands

Run commands from this directory. Checked-in account and D1 IDs are non-secret
deployment coordinates. Authenticate Wrangler to that exact account (a named
profile is recommended) and configure both required Worker secrets before deploy.

```sh
pnpm install --frozen-lockfile
pnpm types
pnpm build
pnpm test
pnpm db:migrate:remote
pnpm deploy
```

Apply D1 migrations before deploying a Worker that understands the new task
names. Do not schedule the two Vercel routes independently. The Cloudflare cron
is the only recurring timer, and it reads D1 only; a dormant system never calls
the workspace control plane.
