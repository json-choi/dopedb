# Cloudflare production operations

DopeDB's public site, Workspace application, workload identity service,
background coordinator, and product analytics service run on Cloudflare. The
Workspace application stores account and collaboration records in D1. Checked-in
Wrangler configuration is the source of truth for Worker names, routes, bindings,
account IDs, and compatibility settings.

Private production values, deployment receipts, recovery copies, and provider
credentials stay outside the repository. Never copy them into a build-visible
`.env`, `.env.local`, `.env.production`, or `.env.production.local` file.

## Production topology

| Responsibility | Checked-in configuration | Public boundary |
| --- | --- | --- |
| Workspace pages and APIs | `workspace-cloud/wrangler.jsonc` | `app.dopedb.dev` |
| Workload identity metadata and binding-only token delivery | `workspace-cloud/wrangler.identity.jsonc` | `identity.dopedb.dev` |
| Public site and website analytics ingress | `site/wrangler.jsonc` | `dopedb.dev`, `www.dopedb.dev` |
| Due-time coordination | `workspace-scheduler-cloudflare/wrangler.jsonc` | authenticated service binding |
| Optional Desktop analytics | `product-analytics-cloudflare/wrangler.jsonc` | private service binding; BigQuery EU storage |

The Workspace Worker binds to the identity Worker through `WORKLOAD_IDENTITY`.
Desktop analytics uses the separate `AnalyticsIdentity` entrypoint and
`dopedb:analytics:production` subject. Its dedicated GCP pool and service account
can append to the analytics dataset, without Workspace KMS or customer-resource
grants. See [analytics operations](../product-analytics-cloudflare/README.md).
The public identity origin serves discovery metadata and JWKS only; token delivery
must remain inaccessible over the public route. The production OIDC issuer,
audience, account, workload ID, and subject must match in both Wrangler files.

## Workspace validation

Run the checks proportional to a Workspace change:

```sh
pnpm workspace:cloud:build
pnpm --dir workspace-cloud build:cloudflare
pnpm --dir workspace-cloud test:contracts
bash scripts/test-provider-import-d1.sh
pnpm build
```

The isolated D1 test applies the production migration entry point to a fresh
database, replays the exact history, and rejects altered receipts and unknown
databases. Contract tests exercise native workerd behavior, atomic mutations,
authentication, provider operations, managed leases, backups, and retention.

## Workspace deployment

For a code-only deployment that preserves the existing production secrets:

```sh
pnpm --dir workspace-cloud deploy:cloudflare --preserve-secrets
```

This checks the configured account, required secret names and exact D1 migration
receipts without applying migrations or uploading secrets. It then builds,
deploys and verifies the production version. Public build configuration comes
only from `workspace-cloud/deployment-public.json`; the deployment wrapper passes
its allowlisted Clarity ID to the build without exposing production secrets.
Pending migrations fail this path; use the environment-file workflow below when
a deployment actually requires migration or runtime-secret changes.

Use a private environment file with mode `0600`. It must contain only names from
`workspace-cloud/.env.example`, include every required production value, use
`https://app.dopedb.dev` as `BETTER_AUTH_URL`, and omit PostgreSQL connection URLs.

First validate the file without changing remote state:

```sh
pnpm --dir workspace-cloud deploy:cloudflare \
  --env-file /absolute/private/workspace-d1.env \
  --check
```

Then perform the requested deployment:

```sh
pnpm --dir workspace-cloud deploy:cloudflare \
  --env-file /absolute/private/workspace-d1.env
```

The deployment command fails closed unless the active Wrangler account matches
the account declared in `workspace-cloud/wrangler.jsonc`. It builds without
inheriting production values, validates and applies exact D1 migration receipts,
uploads secrets through standard input, deploys the OpenNext Worker, captures the
new version ID, and verifies both 100% traffic and the live production receipt.

A local build or upload acknowledgment is not deployment evidence. To re-check a
known version explicitly, run:

```sh
pnpm workspace:cloud:verify-deployment <worker-version-id>
```

## Public site deployment

Pull requests and disabled production runs build the public site and execute a
Wrangler dry run. On a `main` push, the `site-deploy` CI job deploys only after
`site-build` succeeds. The job rebuilds from that exact commit, checks that the
Cloudflare account matches `site/wrangler.jsonc`, and fails unless the uploaded
version receives 100% of traffic and matches the live `dopedb.dev` deployment
receipt.

Production deployment is fail-closed behind both of these GitHub settings:

- the `site-production` environment contains an environment secret named
  `CLOUDFLARE_API_TOKEN`; the token is limited to the declared account and the
  minimum Worker and route permissions needed by `dopedb-site`
- the repository variable `SITE_DEPLOY_ENABLED` is exactly `true`

Keep the variable unset or `false` until the environment secret and main-only
deployment policy have been reviewed. Never use a local Wrangler OAuth session
as the CI credential or store the token in a repository file. To deploy the
checked-out commit manually through the same fail-closed path, run:

```sh
pnpm site:cloud:deploy --commit "$(git rev-parse HEAD)"
```

To re-check a known public-site version without deploying, run:

```sh
pnpm site:cloud:verify-deployment <worker-version-id>
```

## Identity changes

Deploy `dopedb-workspace-identity` only when its source, keys, or checked-in
identity configuration changes. A Workspace-only OIDC consumer fix does not
require an identity Worker deployment. Before an identity change, confirm the
configured account, preserve the existing public-key set during rotation, and
verify public discovery/JWKS plus binding-only token delivery afterward.

## Rollback and recovery

Use Wrangler deployment history to identify an exact known-good Worker version.
Rollback must restore 100% traffic to that version and then pass the same live
deployment receipt check. Do not roll back D1 migrations by deleting migration
receipts or editing applied files. Forward-fix schema changes and retain private
recovery material under its approved access and retention policy.

The Workspace database is initialized and maintained through the checked-in D1
migration history. Customer-selected databases, customer cloud projects, the
domain registrar, and private recovery copies are outside a Workspace Worker
deployment and must not be changed implicitly.
