<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# product-analytics-cloudflare

## Purpose
Independent pnpm sub-project (own lockfile/workspace, not part of the root
frontend build) implementing the dedicated Cloudflare Worker that receives
Desktop's consent-gated, closed schema-v1 product-analytics envelope over a
first-party Workspace service binding and appends it to BigQuery. It has no
public `workers.dev`/preview URL or custom route, stores no SQL, prompt,
result row, name, source IP, request header, cookie, replay, or arbitrary
property, and cannot read events back or run BigQuery query jobs — only
append. Native product-analytics is enabled only in stable release builds via
`DOPEDB_PRODUCT_ANALYTICS_ENABLED=1`; source/dev/benchmark builds stay
disabled.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | `dopedb-product-analytics-cloudflare`; `build`/`test`/`deploy` scripts (`tsc --noEmit` / `vitest run` / `wrangler deploy`). |
| `wrangler.jsonc` | Worker config: no public route, transport contract header requirement, BigQuery service-binding wiring. |
| `README.md` | Storage/identity boundary: raw events go only to the `product_analytics.events_raw` BigQuery table (EU multi-region, 30-day UTC daily partition expiry); transport contract header `x-dopedb-product-analytics-contract: 2` rejects older clients before storage; consent/queue invalidation rules on app-version change or after seven days. |
| `tsconfig.json`, `vitest.config.ts` | TypeScript and Vitest configuration for this sub-project. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | Worker request handling, BigQuery append client, and per-installation ingest rate limiting, documented inline below. |
| `bigquery/` | BigQuery schema, appender IAM role, and grant script, documented inline below. |
| `queries/` | Read-only analysis SQL run manually against BigQuery (not executed by the Worker), documented inline below. |

### `src/` (inline)
| File | Description |
|------|-------------|
| `index.ts` | Worker entrypoint: bounds request body to `MAX_BODY_BYTES` (32 KiB), validates the envelope (event TTL/future-skew windows, UUID and 64-char-hex event ID formats), enforces the per-window ingest budget, and forwards accepted events to `appendBigQuery`. |
| `bigquery.ts` | Server-only append sink: the bound `ANALYTICS_IDENTITY` service can append to exactly one BigQuery table and explicitly cannot read events, create query jobs, or use Workspace KMS/customer-resource grants. |
| `ingest-budget.ts` | Durable-Object-backed per-minute ingest counter (`AnalyticsBudget`) used to rate-limit acceptance before a BigQuery append is attempted. |
| `index.harness.ts` | Contract test for the Worker: imports the shared golden fixture from `../../tests/fixtures/product-analytics-v1.json` and exercises `parseEnvelope`/`appendBigQuery`/budget behavior together. |

### `bigquery/` (inline)
| File | Description |
|------|-------------|
| `schema.sql` | Creates the `product_analytics` dataset (EU location, 30-day partition expiry, 48-hour time-travel) and the `events_raw` table plus its canonical `events` view. |
| `appender-role.yaml` | Custom IAM role `DopeDB Analytics Appender`: dataset/table metadata read and table data update only — no data read, no query-job permission. |
| `grant-appender.mjs` | Allowlisted CLI helper that grants the appender role on the dataset via the BigQuery Dataset Access API, preserving existing ACL entries and using the dataset ETag to avoid races. |

### `queries/` (inline)
| File | Description |
|------|-------------|
| `first-value-funnel.sql` | Per-installation funnel from install through first authenticated/activated milestones. |
| `team-activation-funnel.sql` | Per-workspace funnel across scope/membership/environment activation milestones. |
| `weekly-retention.sql` | Weekly active-installation and query-execution retention aggregation. |

## For AI Agents

### Working In This Directory
- The `ANALYTICS_IDENTITY` binding is append-only by IAM role design (`bigquery/appender-role.yaml`); do not add a code path or a role permission that lets this Worker read back events or run a query job — that would break the "cannot read events" product invariant stated in the README.
- Keep the transport contract header check (`x-dopedb-product-analytics-contract`) as a hard reject-before-storage gate when changing the envelope shape; bump the header value together with any breaking envelope change and update `../tests/fixtures/product-analytics-v1.json` in the same change.
- Never log or forward SQL text, prompts, result rows, names, source IPs, request headers, or cookies — the README states this is a hard product boundary, not an oversight.

### Testing Requirements
- `pnpm analytics:cloudflare:test` (root) / `pnpm test` (here) runs `vitest run --config vitest.config.ts`, including `src/index.harness.ts` against the shared golden fixture.
- `pnpm analytics:cloudflare:build` (root) / `pnpm build` (here) runs `tsc --noEmit`.
- `pnpm analytics:cloudflare:deploy` (root) / `pnpm deploy` (here) runs `wrangler deploy`; treat as a real deployment action, not a build check.

### Common Patterns
- Request validation happens in small guarded steps before any external call (body-size check → envelope parse/format validation → budget check → BigQuery append) — see `src/index.ts`.

## Dependencies

### Internal
- `../tests/fixtures/product-analytics-v1.json` (shared golden envelope fixture, see `../tests/AGENTS.md`); the Desktop-side producer of this envelope (native product-analytics feature, gated by `DOPEDB_PRODUCT_ANALYTICS_ENABLED`).

### External
- `wrangler` (Cloudflare Workers build/deploy/dev), `vitest` (tests), `typescript`; Cloudflare Durable Objects (ingest budget) and a BigQuery-fronting service binding (`ANALYTICS_IDENTITY`) at runtime.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
