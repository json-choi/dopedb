# DopeDB product analytics

The dedicated Cloudflare Worker receives the consent-gated, closed schema-v1
Desktop envelope through the first-party Workspace service binding. Public
workers.dev and preview URLs are disabled, and no custom public route is registered. Transport contract header
`x-dopedb-product-analytics-contract: 2` identifies clients with the BigQuery disclosure;
older clients are rejected before storage. A changed native consent generation
invalidates older queues. Both acceptance and refusal expire on an app version
change or seven days after the last explicit choice. Missing choice metadata
also requires a new choice. Desktop shows a global bottom-right prompt while
pending and clears the prior queue and installation identifier. Native checks
the deadline before transport; the UI checks before capture/delivery, on focus,
and every minute while visible. Privacy settings allow changes at any time.
The stable release workflow enables the native feature with
`DOPEDB_PRODUCT_ANALYTICS_ENABLED=1`. Source/development builds remain disabled
unless explicitly built with that flag; packaged benchmarks always remain disabled.

## Storage and identity

Raw events go only to `dopedb-503203.product_analytics.events_raw` in BigQuery's
EU multi-region. The former analytics D1 database is retired without migrating
its MVP data. No SQL, prompts, result rows, names, source IP, request headers,
cookies, replay, or arbitrary properties are stored by this service.

`bigquery/schema.sql` defines the table and canonical `events` view. UTC daily
partitions expire after 30 days, so active retention is at most 30 days. Google
retains restricted recovery copies for two days of time travel and then seven
days of fail-safe recovery. These are not available through normal queries.
No separate long-lived daily aggregate store is maintained.

`insertAll` acknowledges success only when both HTTP status and every row receipt
succeed. Partial failures and timeouts return retryable 503. Stable `event_id`
values survive retries; Google's `insertId` is only best effort, so all operator
queries use the deduplicating `events` view. Never count `events_raw` directly.

The private `AnalyticsIdentity` service binding issues a fixed analytics subject.
GCP WIF pool `dopedb-analytics`, provider `cloudflare`, accepts only the exact
production subject, Cloudflare account, workload ID, and environment. It can
impersonate only `dopedb-analytics-ingest` in this project. That service account
has the custom `dopedbAnalyticsAppender` role on this dataset, with only the three
permissions in `bigquery/appender-role.yaml`. It has no event-read, query-job,
KMS, or customer-database grants. No service-account key exists. Google access
credentials last 15 minutes and never reach Desktop or the browser.

A single SQLite-backed Durable Object stores only the current minute and count,
atomically enforcing the existing global ceiling of 16 events per minute. This
intentional global coordinator bounds MVP ingest cost and contains no analytics
payload. Excess batches return 429 and retry in 60 seconds. Request payloads and
provider response bodies are never logged.

## Operations

Use the project's verified personal GCP identity with an explicit per-command
account; never change the workstation's default account. The checked-in project
and Cloudflare IDs are public deployment coordinates. The Worker has no public route or shared bearer secret: only the Workspace
`PRODUCT_ANALYTICS` service binding reaches its ingest handler.

The dataset, table/view, dedicated service account, WIF pool/provider, and custom
role are provisioned separately. `bigquery/schema.sql` is intentionally create-only;
do not rerun it against an existing dataset. `bigquery/grant-appender.mjs ACCOUNT`
adds only this dedicated principal, preserving existing dataset ACLs with an etag.
It refuses to rewrite an existing principal's grant.

Validate and deploy the identity entrypoint before deploying its consumer:

```sh
pnpm --dir workspace-cloud build:identity
pnpm --dir workspace-cloud deploy:identity
pnpm --dir product-analytics-cloudflare build
pnpm --dir product-analytics-cloudflare test
pnpm --dir product-analytics-cloudflare deploy
```

Deploy the Workspace relay and public privacy policy with their verified deployment
scripts. A desktop stable release is separate: only a new official build can show
the global prompt and send contract 2. No Desktop release is implied by a backend
deployment. Verify a synthetic contract-2 event through the production relay and
query its count before declaring ingestion operational. Check rejection of
contract 1 and malformed payloads as well.

Run the reviewed SQL in `queries/` using GoogleSQL in region EU, with a query byte
limit. Never export raw identifiers into logs, tickets, spreadsheets, or workspace
Analysis Articles. The operator's GCP IAM identity is the query boundary.

References: [streaming receipts and deduplication](https://docs.cloud.google.com/bigquery/docs/write-api-rest),
[partition expiration](https://docs.cloud.google.com/bigquery/docs/managing-partitioned-tables),
[recovery retention](https://docs.cloud.google.com/bigquery/docs/time-travel),
[workload federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).
