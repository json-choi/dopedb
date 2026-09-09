# Cloudflare hosting migration

## Current scope — approved empty D1 initialization

The owner approved converting the Workspace database from PostgreSQL to
Cloudflare D1 and starting with empty application data. Retirement remains
limited to Vercel-dependent resources. The existing domain registrar, customer
Google databases, existing Cloudflare services and private recovery backups stay
outside that deletion scope. The separately prepared Neon standby is recovery
material, not the requested final database destination.

The personal Cloudflare account contains `dopedb-workspace` D1 database
`5ef469d0-db9f-45cb-bbce-99dfbe68c181`. Seven applied migration files have
matching remote SHA-256 receipts: 56 application tables, immutable history,
audit/sync and storage type guards, atomic operation scope, encrypted backup
chunks, and the exact retention-purge boundary. The ENAM location hint is not
an assertion of exact data residency.

As of 2026-09-09, the runtime DB entry point, schema and Better Auth adapter use
native D1. The runtime PostgreSQL SQL scan passes. Verified real-workerd scenarios
cover authentication, workspace creation, personal scope, Project revisions,
GitHub delivery replay, discovery/import idempotency, provider integration
refresh/disconnect, managed lease limits and revocation, connection history and
conflicts, analysis execution/completion/publication, runner/member cleanup,
provider operation approval/claim/remote-start/reconciliation/bootstrap, atomic
branch switches, backup restore, and workspace retention. A maximum-size
1,000-connection UTF-8 backup exceeds 2 MB and round-trips through encrypted
D1 chunks, including key rotation. Late failures restore all related rows and audits.

The production migration entry point has passed an isolated D1 harness covering
fresh apply, exact replay, altered receipt rejection and unknown database rejection.
Nine contract tests, Workspace build, architecture ownership, code structure,
server-log boundaries and the unchanged 104/208 critical-test budget passed.
The final OpenNext production builds, D1 schema check and root `pnpm build` passed.
The 42 frontend smoke tests and nine native D1 contracts passed after replacing
obsolete PostgreSQL source-shape expectations with their D1 equivalents. No tests
were skipped or budget limits raised; the critical-test budget remains 104/208.

Production cutover and source retirement completed on 2026-09-09 (KST):

- Workspace version `a6d601da-6407-485b-80cc-913cc8291716` receives 100% of traffic.
  `pnpm workspace:cloud:verify-deployment` matched the live `app.dopedb.dev` receipt
  through ordinary DNS. Fresh Google login reached authenticated settings; D1
  contained one new account/session and zero team workspaces after the approved reset.
- Public site version `25275845-cb2a-43d5-b44c-bd1043597d0a` receives 100% of traffic.
  Six English/Korean pages, ten static assets, the `www` redirect and bounded
  website analytics ingress/rejections passed public HTTPS checks. The privacy
  notice now describes the active Cloudflare Workspace and D1 storage.
- New session/credential keys and recovered integration settings are registered as
  Worker secrets. GitHub's webhook secret was changed after owner reauthentication;
  a correctly signed ping returned 202. Google OAuth remains on the same callback.
- Scheduler and analytics service capabilities were replaced on both sides.
  Both authenticated Workspace cron routes returned successful empty-work receipts.
  Both scheduler kicks returned 202, ran and became dormant with zero failures.
  Desktop analytics remains disabled (`PRODUCT_ANALYTICS_RELAY_ENABLED=0`), as before;
  its service accepts the replacement capability and rejects malformed input.
- Vercel projects `dopedb` and `dopedb-workspace`, and Vercel-managed Neon resources
  `dopedb` and `dopedb-workspace-free` were deleted and confirmed absent from inventory.
  The source project was `lively-shadow-11550703`. Unrelated projects/resources remain.
- The Vercel wildcard DNS record was removed after all exact Worker domains were
  active. Registration, renewal and transfer settings remain at the existing registrar.
- The old dedicated `dopedb-vercel` Google federation pool and its KMS impersonation
  grant were removed; the `dopedb-workspace` pool and existing KMS key remain.
  A new remote-binding STS/impersonation/KMS round trip passed after removal.
  Customer Google projects and the private recovery copies were not changed.

The existing scheduler retains its older `workspace_background_task_v1` production
schema and migration history; its two rows were inspected without reinitializing it.
Do not apply a fresh baseline to existing scheduler or analytics storage. This
migration initializes only the new Workspace D1 database. Native workerd coverage
proves fixture backup/restore and managed-access behavior; the fresh production
workspace has no imported connections or historical backups to rerun those flows.
Private deployment, retirement and backup receipts remain outside the repository.

Native D1 uses UTC ISO text dates, integer booleans, exact JavaScript-safe integer
revisions, and JSON decoding at wire projections. Every mutation formerly relying
on row/advisory locks rechecks its authority inside one conditional statement or
atomic batch. Backup chunks share the same batch, key-rotation claim and retention
cascade as their metadata. Variable ID lists use one JSON binding to stay within
D1's 100-parameter limit. Customer PostgreSQL adapter SQL remains provider-side;
historical PostgreSQL schema/recovery tools under `drizzle/` are not Worker storage.
The currently unused code-index staging schema still has no application write path;
its large-payload contract needs a D1 row-size review before that feature is enabled.

References checked on 2026-09-09:
[D1 import compatibility](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 placement and jurisdiction](https://developers.cloudflare.com/d1/configuration/data-location/),
[SQLite RETURNING restrictions](https://www.sqlite.org/lang_returning.html), and
[Hyperdrive architecture](https://developers.cloudflare.com/hyperdrive/).

## Earlier PostgreSQL standby checkpoint — 2026-09-08

This historical checkpoint precedes the approved D1 reset above. Its PostgreSQL
cutover assumptions and outstanding reset decisions no longer describe the current plan.
This is **not a full migration completion receipt**.
The public site now runs on Cloudflare; the Workspace application still runs on
Vercel. Its Worker has been built locally. Database and Google OAuth credentials
have now been recovered, and replacement GitHub/service credentials are prepared.
An unavailable session-signing key and two customer Google integration trust
changes still need the explicit decisions described below before Workspace
cutover. Both old projects' Git repository connections have been
disconnected. The Workspace credential key has been replaced through verified
server-internal re-encryption; the replacement runtime decrypted every affected
stored record and preserved its other fields. The original key was never exported.
The Workspace sign-in page still responds successfully. Cloudflare deployment remains
an explicit CLI operation. Do not reconnect the old Git auto-deploy to this source.

The public site is deployed at `dopedb.dev` and `www.dopedb.dev`, version
`c4172e18-be64-4134-95da-00c1548da7c7`, with 100% of its Worker deployment on that
version. Public HTTPS checks cover six English/Korean pages, their security headers,
static assets, the canonical `www` redirect, and the matching `/api/deployment`
receipt. All three macOS/Windows download targets return HTTP 200. Browser language
switching also updates the document language. Analytics
Engine accepted the closed test event and returned it through its SQL API. Public
DNS points to Cloudflare; local resolver caches may temporarily retain the old host.
The published privacy notice explicitly retains the still-active Workspace host
and prior website analytics until their remaining processing/retention ends.

The `dopedb.dev` Cloudflare zone is provisioned on the Free plan. Its apex and `www`
now use Worker-managed records. The DNS-only wildcard preserves the running
Workspace destination, and all three CAA records remain. Public DNS delegates to
Cloudflare and the zone is active. The target
account already has Workers Paid; no new paid plan was purchased for this migration.
Registration has not been transferred. The owner explicitly chose to keep the
existing registrar; no transfer or payment is pending. Preserve its transfer lock,
registration and renewal settings.

The identity Worker is deployed at `identity.dopedb.dev`, version
`3e0cc3da-938f-4a39-bf53-3e087cd2a224`. Its live public metadata and JWKS match the
new signing key; public token delivery is denied. A controlled local probe using
the actual remote service binding passed Google STS, service-account impersonation,
and a fixture encrypt/decrypt round trip on the existing backup CryptoKey. This
does not prove an existing encrypted Workspace backup can be restored.
The new `dopedb-workspace` GCP pool/provider and its exact KMS impersonation grant
are provisioned; old trust remains available for the running deployment/rollback.

| Responsibility | Target | Cutover evidence |
| --- | --- | --- |
| Public site, legal pages, assets | `dopedb-site` Worker, OpenNext, `dopedb.dev` and `www.dopedb.dev` | Exact Worker version returned by `/api/deployment`; both languages, downloads, canonical redirect, CSP |
| Workspace pages and APIs | `dopedb-workspace` Worker, OpenNext, `app.dopedb.dev` | 100% deployment plus matching `/api/internal/deployment`; existing login, invitation, Desktop approval and data flows |
| Public page and CTA metrics | `dopedb_site` Analytics Engine | Closed page/click points; rejected identifiers and oversized payloads; DNT/GPC honored |
| Google workload federation and backup KMS | Separate `dopedb-workspace-identity` Worker, `identity.dopedb.dev` | Public discovery/JWKS; binding-only token delivery; real STS/IAM and existing-backup decrypt |
| Due-time coordinator | Existing scheduler Worker and D1 | Existing tokens preserved; authenticated credential/maintenance receipts; no independent Workspace cron |
| Optional Desktop analytics | Existing analytics Worker and EU D1 | Existing relay token preserved, normalized event delivery, retention and consent unchanged |
| DNS | Cloudflare DNS | Parent-zone delegation, both assigned authoritative servers, TLS and live HTTP |
| Registrar | Existing registrar, retained by owner decision | Registration, transfer lock and renewal remain unchanged |

The currently implemented Workspace runtime uses Neon PostgreSQL and its stateless
HTTP driver. It has not been rewritten for D1; see the current-scope review above.
Google KMS retains its
existing CryptoKey; changing workload authentication does not rotate backup keys.
The current Neon project belongs to a Vercel-managed organization, so moving the
application alone does not remove that provisioning/billing dependency. Review a
Neon-supported separation or a verified database-copy cutover before retiring the
old integration; never disconnect/delete it while the live database depends on it.
Sentry, Google sign-in, GitHub, optional invitation delivery, and customer-selected
database providers remain independent services, not dependencies of the old host.

## Account and secret preparation

### Credential recovery and cutover preparation — 2026-09-08 12:07 UTC

The Google CLI was reauthenticated through the verified personal Chrome profile,
without changing the global active CLI account. Explicit account/project selection
confirmed access to the existing backup-key project and its Cloudflare WIF provider.
A local-only probe with the actual remote identity service binding again passed
STS, service-account impersonation, and a fixture KMS encrypt/decrypt round trip.
When the probe config lives outside the app directory, explicitly select the
verified Wrangler profile: directory-scoped authentication is otherwise not applied
to that config, and the remote binding session fails to authenticate.

The existing Neon Console connection dialog supplied both original database URLs.
A downloaded Google OAuth client file matched the client ID and redirect URI
returned by the live Workspace sign-in endpoint. It replaced the stale ID candidate
from the older local export. The GitHub App owner, ID, slug and client ID were
verified in its existing settings; an additional client secret and RSA private key
were created while retaining the old credentials. The new private key successfully
authenticated to the expected GitHub App API. All recovered/prepared values are in
a private file outside the repository; new webhook/scheduler/analytics capabilities
have not been activated on either side.

`BETTER_AUTH_SECRET` is the only unavailable application setting. The live database
has six accounts with no stored provider tokens or passwords, and 17 unexpired
sessions at the inventory checkpoint. Replacing this key requires a specific
decision about reauthentication; no existing session or signing key was changed.
The two GCP integrations select customer databases in a company-owned Google
project. Moving their existing six dedicated service accounts to the personal
Cloudflare workload requires explicit authorization under the account-separation
rule. No IAM changes were made to those customer resources.

All three stored provider credentials decrypted using the recovered replacement
key. No live provider setup, provider operation, or unexpired DB lease was present.
There were zero Workspace metadata backups and zero wrapped Workspace data keys;
an existing encrypted-backup restore is therefore not an applicable live test at
this checkpoint. A full database dump was restored into an isolated local database
with six users, six accounts, three integrations and five connections. An additional
archive preserves ACLs, including the privileged purge function's owner-only
execution grant.

A separate, directly managed Neon Free project `square-cell-59761594` is prepared
as the replacement database, with PostgreSQL 18, AWS `us-east-1`, and Neon Auth
disabled. It is a standby destination, not the live database. Its initial serial
restore exceeded the operator timeout and rolled back completely. The parallel
retry encountered two platform-owned default ACL entries that the application
role cannot modify. After verifying that both entries already matched the source,
the standby application schemas were reset and restored with only those two
archive entries excluded. All application ACLs, including the owner-only purge
function, were retained.

The completed standby verification matched row digests for all 56 tables, all
617 columns, 170 indexes, and seven functions with their ACLs. Of 886 constraints,
878 definitions matched exactly; the remaining eight differ only in conjunction
parenthesization and produced identical predicate plans on the destination.
Migration preflight passed with two applied migrations and none pending. A final
quiesced copy and source/destination verification are still required before
changing the application's database URLs. The old Vercel-managed database and
integration remain intact. This verified standby snapshot is not a production
cutover or continuous replication receipt.

The application credential validator previously still accepted only the old
workload subject, which would reject newly bootstrapped Cloudflare integrations.
It now accepts the exact production subject and rejects preview/other subjects;
existing contract coverage and frontend smoke coverage exercise the new identity.
Root, Workspace and OpenNext builds, all 42 frontend and 8 Workspace contract tests,
the isolated PostgreSQL production-migration harness, test-budget and
code-structure checks passed, and the AST graph was updated.

### Resumed preflight — 2026-09-08 11:14 UTC

The configured Cloudflare account matches the active directory-scoped Wrangler
identity. The site, identity, analytics, and scheduler Workers each still have one
version receiving 100% of traffic. The Workspace Worker does not exist yet
(`10007`); no Workspace upload, DNS cutover, or production database migration was
performed during this preflight.

A private recovery candidate outside the repository contains the replacement
credential key, verified against its durable backup, and the previously recovered
settings. An older local export supplies a Google client ID candidate; confirm it
against the current OAuth application before deployment. The two existing Worker
endpoint addresses were reconstructed from the authenticated account's subdomain
and deployed Worker names; both reject unauthenticated POST requests with `401`.
Their authentication tokens remain unavailable. No masked marker or hosting-only
environment variable was copied into the candidate.

The following 13 configured values still need their originals:

- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
- `BETTER_AUTH_SECRET`, `CRON_SECRET`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_KNOWLEDGE_APP_ID`, `GITHUB_KNOWLEDGE_APP_SLUG`,
  `GITHUB_KNOWLEDGE_APP_PRIVATE_KEY`, `GITHUB_KNOWLEDGE_CLIENT_ID`,
  `GITHUB_KNOWLEDGE_CLIENT_SECRET`, `GITHUB_KNOWLEDGE_WEBHOOK_SECRET`
- `PRODUCT_ANALYTICS_CLOUDFLARE_TOKEN`, `WORKSPACE_BACKGROUND_SCHEDULER_TOKEN`

The candidate deliberately retains the original KMS audience pending replacement
trust review. The active Google CLI identity differs from the migration's intended
identity, so no Google IAM changes were made. Verify the explicitly selected
account and project before resuming those changes. Existing encrypted-backup
restore, persisted GCP integration conversion, authenticated scheduler/analytics
receipts, and application cutover flows are still outstanding. Registrar payment
and Neon separation also remain outstanding as described above.

The resumed checks passed: root build and 42 frontend smoke tests, Workspace Next
and OpenNext builds, identity Worker dry-run build, 8 Workspace contract tests, isolated PostgreSQL production
migration/replay/baseline rejection and provider credential-rotation scenarios,
code-structure and test-budget checks. The recovery candidate's deployment
`--check` correctly fails on missing `DATABASE_URL`; this is not deployment
success. Public site checks again covered six pages, ten assets, the canonical
redirect, and analytics ingress/rejections. A subsequent ordinary DNS/HTTPS check
also matched the site's deployed version, identity JWKS, public token denial, and
the existing Workspace sign-in response. These checks do not prove authenticated
Workspace flows or existing backup restore.

Use the account ID declared in each Wrangler file. Check `wrangler whoami` before
remote changes; do not change CLI accounts implicitly. Verify the separately
authorized Google project/account before any IAM mutation. Git author identity
and stable-release signing are unrelated to this hosting migration.

On a workstation with several identities, bind the intended existing Wrangler
profile to each app directory with `wrangler auth activate <profile> <directory>`
or pass `--profile` to one command. Do not change the global default. The deployment
script checks that the authenticated account can access the configured account
before running a production database migration.

Recover the **original** production values into a private environment file outside
the repository (`chmod 600`). A hosting export containing `[SENSITIVE]` is not a
backup. Never upload those markers, paste secrets into chat, print them in logs,
or deploy a temporary endpoint to expose protected environment values.

- Preserve `BETTER_AUTH_SECRET` byte-for-byte for existing sessions. Preserve
  `WORKSPACE_CREDENTIAL_KEY` unless the data-preserving rotation below has been
  completed and the replacement key has a verified private backup.
- Preserve both PostgreSQL URLs, Google OAuth values, optional GitHub App values,
  configured invitation/provider values, and enabled analytics/scheduler switches
  with their matching original service tokens.
- Preserve the KMS CryptoKey and dedicated service account. Update its WIF audience
  only after the replacement Google trust is verified.
- Set `WORKSPACE_DATA_REGION` only from the database's verified storage location;
  a Worker execution location does not establish database residency.
- `DATABASE_URL_UNPOOLED` is used only by the local production migration command.
  It is not uploaded to the application Worker.
- Keep runtime values out of `.env`, `.env.local`, and production dotenv files
  inside `workspace-cloud`: Next loads them while compiling.

Validate the file without changing remote state:

```sh
pnpm --dir workspace-cloud deploy:cloudflare --env-file /secure/workspace.env --check
```

This checks format, completeness and origin, not the validity of a credential or
permission. Omit unconfigured optional integrations rather than copying their
example placeholders. Review optional features against the old deployment so an
omitted value cannot silently turn off a live integration.

### Replacing an unavailable credential key

A write-only hosting secret cannot be recovered through an environment export.
If the existing production runtime still has the key, it can re-encrypt its data
internally without returning the old key or plaintext. Merely replacing the
environment variable destroys access to the existing ciphertext.

`workspace-cloud/lib/provider-credential-key-rotation.ts` provides a deliberately
narrow operator transaction for GCP and Neon credentials. It rejects any
provider-operation history, other providers, pending credential changes, active setup sessions, changed
preflight snapshots, or oversized batches. Operation ownership markers also use
the root key, and may exist remotely, so this routine never silently re-signs them.
Workspace backup DEKs and their Google KMS key are separate and stay unchanged.

1. Generate a 32-byte key with an OS cryptographic random generator. Store its
   canonical base64url representation outside the repository with mode `0600`,
   with a durable private backup. Do not activate it yet.
2. Prepare a protected deployment from the exact currently running source, with
   support for `v2.<key fingerprint>.<AES-GCM envelope>`. Keep the production
   alias unchanged. The public fingerprint is also authenticated as AAD.
3. Run the transaction's preflight inside the existing-key runtime. A temporary
   operator transport must have an exact database target, an independent random
   authorization capability, a short absolute expiry, a bounded request body,
   and aggregate-only output. Do not provide an environment-export endpoint,
   public preview, request-body logging, arbitrary SQL, or caller-selected DB URL.
4. Build a replacement deployment using the new key without assigning production
   traffic. Keep the original secret intact and stage the replacement separately
   until its runtime is verified. Keep the old-key maintenance deployment
   available for the commit.
5. Apply using the exact preflight snapshot. The transaction locks all three
   affected tables, verifies each plaintext round trip, changes only the two
   encrypted-credential columns, and re-reads every saved row before committing.
   Failure rolls back both ciphertext updates and the cutover constraints.
6. Promote the prepared new-key runtime immediately and verify all stored
   credentials with that runtime, the production alias, and existing app flows.
   Old-key deployments must not receive production traffic again after commit.
   New Neon branch operations wait until the receipt's `operationsResumeAt`
   (six minutes after the transaction starts). The temporary operation fence
   drains the reviewed 60-second operation and 300-second setup handlers before
   accepting new signatures. Re-review this bound if runtime limits change.
7. Retain the operator-owned `provider_credential_rotation_fence` constraints on
   both credential tables until all old runtimes are retired. They reject both
   untagged ciphertext and tagged ciphertext from a different key. They are
   temporary cutover state, not changes to an applied migration file. Retire the
   temporary transport and remove its capability after verification; never leave
   an unrestricted maintenance endpoint in the application.
   Once the new-key runtime has verified every record, replace the canonical
   secret, deploy the normal accessor without the temporary transport, and remove
   the staged replacement setting. Keep the durable private key backup.

The isolated PostgreSQL harness covers content/metadata preservation, corrupted
ciphertext, active setup refusal, stale snapshot refusal, and old-key write
rejection. This is a key-rotation receipt only; it does not complete the hosting,
OAuth, Google workload-trust, or registrar migrations.

## Workload identity and existing Google grants

The identity Worker holds an RSA private JWK in `OIDC_SIGNING_KEY` and its public
JWKS in `OIDC_PUBLIC_KEYS`, configured as Worker secrets. Generate a fresh RSA key
of at least 2048 bits with a random `kid` (16–80 URL-safe characters), `alg=RS256`,
and `use=sig`; send it directly to Worker secrets over stdin. Do not keep plaintext
key copies in the repository or command arguments. Recover a lost signing service
by publishing and rotating a new key as described below, not by exporting secrets.
No Google service-account key is created or accepted.

Only the Workspace service binding names the `WorkspaceIdentity` entrypoint.
Public HTTP exposes discovery and JWKS only; `/token` never issues a credential.
Binding callers cannot choose token claims. Tokens expire after 15 minutes and
bind the fixed issuer, audience, production subject, account ID, and workload ID
declared in both Wrangler files. Treat the workload ID as immutable across deploys.
Any maintainer who can alter bindings or identity secrets is inside this trust
boundary; do not grant those permissions to previews or untrusted build jobs.

Deploy identity separately after uploading its two secrets, then attach the
`identity.dopedb.dev` custom domain. Verify the actual public JWKS and the named
binding before changing Google trust. The default Worker has no public token
endpoint and no `workers.dev` exposure.

Existing integrations do **not** automatically change issuer when this code is
deployed. Inventory all live GCP integrations, encrypted configurations, principal
claims, selected resource fingerprints, active leases, pending setup tickets,
provider operations and wrapped backup keys. Never log decrypted credentials.

For each authorized Google project, prepare narrowly scoped replacement WIF
trust for the fixed Cloudflare identity. Restrict issuer, exact audience, subject,
account, workload, and production environment; grant impersonation only on the
already approved service accounts. Verify actual STS exchange, read/write/schema
service-account boundaries, and KMS encrypt/decrypt on the existing CryptoKey.
Read success alone is not proof that forbidden writes are rejected.

Convert persisted provider identity and resource revisions through an explicitly
reviewed migration or the owner-approved setup flow. The bootstrap now uses
`dopedb-workspace` for new pool/provider IDs; it cannot silently retarget old
encrypted configuration or preserve stale fingerprints. Drain outstanding setup
and provider operations, stop new legacy issuance during cutover, and let old
leases expire. If a stored principal embeds a personal namespace, obtain the
repository's required privacy-safe migration decision before retaining it as an
alias or changing continuity. Keep the old trust until rollback no longer needs
it; then remove only the specifically superseded bindings/provider.

For identity signing-key rotation, publish old and new public keys first (at most
three), wait for discovery caches, switch the signing key, verify token exchange,
then retain the old public key until all 15-minute tokens and caches expire.
Never remove a still-required verification key during a deployment.

## Application cutover and verification

1. Finish the secret and Google trust review above. Verify a recoverable backup
   and existing encrypted records before any production mutation.
2. Confirm both Cloudflare authoritative nameservers serve the preserved DNS
   records and there is no stale parent DS record. Confirm zone activation. Keep
   the old hosting destinations DNS-only until each Worker is ready.
3. Disable the old site's and Workspace's Git-triggered deployment before pushing
   Cloudflare-only source. Keep their last successful production artifacts and
   environment available for a deliberate rollback.
4. Build and test the exact source with the commands below. Configure required
   secrets and bind custom domains only after preview/runtime verification. Add
   each custom domain to the corresponding Wrangler `routes` with
   `custom_domain: true` when cutting over; keep `workers_dev: false`.
   Unauthenticated previews must never receive production credentials.
   A manually managed CNAME at an exact hostname must be removed before a Worker
   Custom Domain can replace it; Wrangler may report API error `100117` even when
   its domain changeset reports no conflict. Verify the deployed Worker first,
   retain the old record for rollback, remove only that hostname's CNAME, then
   apply the configured domains with `wrangler triggers deploy` and verify TLS.
5. Run `pnpm --dir workspace-cloud deploy:cloudflare --env-file /secure/workspace.env`.
   It builds without runtime values, runs the existing fail-closed production
   migration through the unpooled URL, sends runtime secrets over stdin, deploys,
   and requires that exact version at the production domain. Initial staging
   without the custom domain is not completion and intentionally fails that last
   check. Configure the verified domain and rerun verification for the uploaded ID.
6. Deploy the site with `pnpm --dir site deploy:cloudflare`. Record its uploaded
   version and compare `/api/deployment`; check the canonical `www` redirect,
   English/Korean legal pages, assets, download and Workspace links, and actual
   analytics ingestion. Publish updated privacy copy only with the described
   infrastructure in place; reconcile retained legacy hosting/analytics data.
   The site can cut over independently while Workspace secrets are recovered,
   provided the notice still identifies the active Workspace host and relay.
   Update that notice again when Workspace cutover is verified.
7. Check an existing browser session, a fresh Google sign-in, invitation/shared
   link, Desktop device approval and return link, authorized and unauthorized
   API access, existing managed connections, backup decrypt/restore and key
   rotation, GitHub callback/webhook, and both due-time scheduler receipts. Use
   disposable fixtures for writes. Preserve consent and disabled feature states.
8. Keep the existing domain registration and renewal settings, as explicitly
   requested by the owner. Registrar transfer is outside this migration.
9. After all receipts and a rollback observation window, remove old project
   hosting, analytics collection, superseded identity trust, build hooks and
   provider-side environment secrets; cancel only the obsolete subscription.
   Confirm there is no obsolete live request, DNS, callback, billing, or identity
   dependency before marking this migration complete. The deliberately retained
   registrar relationship is an exception; do not close its account or billing.

## Checks and rollback

```sh
pnpm build
pnpm test
pnpm workspace:cloud:build
pnpm --dir workspace-cloud build:cloudflare
pnpm --dir workspace-cloud build:identity
pnpm --dir workspace-cloud test:contracts
bash scripts/test-provider-import-postgres.sh
pnpm --dir site build:cloudflare
pnpm check:test-budget
pnpm check:code-structure
pnpm workspace:cloud:verify-deployment <worker-version-id>
```

Use the prior Cloudflare version only if its schema and identity configuration
remain compatible. For initial hosting rollback, restore the recorded DNS-only
destinations or domain routing and the prior immutable hosting artifacts. Keep
the same database, auth/encryption secrets, KMS key, and sufficient old/new Google
trust until outstanding credentials drain. Never reverse an applied database
migration by deleting history or silently dropping data. A failed receipt must
remain visible; DNS propagation or a successful upload cannot substitute for it.

After credential-key rotation, a pre-rotation artifact is no longer a valid
rollback target. Use a verified artifact that understands provider `v2` envelopes
and has the replacement key. Restoring only an old deployment or environment
setting cannot undo the ciphertext transaction.

The transitional privacy notice, applied SQL migration comments, and ignored CLI
cache names may still mention the old host. The notice reflects remaining live
processing; the others are historical hashes/local tooling exclusions. Do not
edit applied migration files merely to remove a name.
