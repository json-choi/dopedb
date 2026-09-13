<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/infrastructure

## Purpose
This directory is the standalone source for a separate Cloudflare Worker,
`dopedb-workspace-identity` (deployed via `../wrangler.identity.jsonc`, custom
domain `identity.dopedb.dev`), independent from the main workspace-cloud
Next.js/OpenNext Worker. Its job is narrow and verified from the code: mint a
self-signed OpenID Connect ID token for Google Cloud Workload Identity
Federation (`aud: https://iam.googleapis.com`) and publish the matching OIDC
discovery/JWKS metadata. It signs its own assertion with an RSA key it holds as
a Cloudflare secret; it does not call Google, does not hold any GCP
service-account key, and does not itself obtain a GCP credential — token
exchange with GCP STS happens outside this directory. Two fixed subjects are
supported (`dopedb:workspace:production`, `dopedb:analytics:production`), each
gated behind its own RPC entrypoint class, reachable only through a Cloudflare
service binding from one other specific Worker — never over public HTTP. The
public HTTP surface at `identity.dopedb.dev` serves only the OIDC discovery
document and JWKS; it can never mint a token.

This is unrelated to the root CLAUDE.md/AGENTS.md "official CLI only, no
stored provider credential" rule for Anthropic/OpenAI traffic — that rule
governs AI-provider CLI usage. This worker is a Google Cloud Workload Identity
Federation token issuer; it is a separate, GCP-facing identity boundary. What
GCP resource(s) the resulting token is ultimately exchanged for (e.g. BigQuery,
Cloud SQL) is not visible from this directory's code and is not asserted here.

## Key Files
| File | Description |
|------|--------------|
| `identity-worker.ts` | Worker entry point. Exports `WorkspaceIdentity` and `AnalyticsIdentity` (`WorkerEntrypoint` RPC classes, each answering only `POST /token` and returning `{ token }` with `cache-control: private, no-store`), plus a default `fetch` export that serves only `identityMetadataResponse` (OIDC discovery/JWKS) over public HTTP and never issues a token. |
| `workload-identity-core.ts` | All token-issuance and metadata logic: `identityMetadataResponse` (serves `/.well-known/openid-configuration` and `/.well-known/jwks.json`, 404/405 otherwise), `issueWorkloadIdentity`/`issueAnalyticsIdentity` (fix the JWT `sub` claim), and `issueIdentity` (validates config, cross-checks the private signing key against the published JWKS, hand-builds and RS256-signs a 15-minute JWT via Web Crypto). |
| `tsconfig.identity.json` | Standalone strict TS project scoped to just these two files plus the generated `../identity-env.d.ts`; types are `@cloudflare/workers-types` + `node` (Node compat comes from the `nodejs_compat` flag in `wrangler.identity.jsonc`, which is what makes `Buffer` available). |

## For AI Agents

### Working In This Directory
- This is deployed as its own Worker via `../wrangler.identity.jsonc`
  (`workers_dev: false`, `preview_urls: false`), never bundled into the main
  app's build or wrangler config. Do not import these files from the main
  Next.js/OpenNext app; consumers reach it only through a Cloudflare service
  binding (RPC) or the public discovery endpoints.
- `issueIdentity` hard-validates `OIDC_ISSUER`, `OIDC_AUDIENCE`,
  `OIDC_ACCOUNT_ID`, `OIDC_WORKLOAD_ID`, and `OIDC_SUBJECT` against fixed
  expected values before signing anything — including when issuing the
  analytics-subject token, where `configuration.OIDC_SUBJECT` must still equal
  `"dopedb:workspace:production"` (it is a fixed environment guard, not a
  per-call subject selector; the actual `sub` claim comes from the `subject`
  argument, not from this var). Do not loosen this check to "support" a new
  subject without re-reading `issueIdentity` end to end.
- `publicKeys()` explicitly rejects any JWK carrying `d`/`p`/`q` (private key
  material) even though it is only meant to render the public JWKS — preserve
  that check; it is the guard against a private key ever being served as
  public.
- `issueIdentity` also refuses to sign unless the private `OIDC_SIGNING_KEY`
  secret's `kid`/`n`/`e` match an entry already present in `OIDC_PUBLIC_KEYS`.
  Rotating the signing key requires publishing the new public key in
  `OIDC_PUBLIC_KEYS` first (or alongside), not swapping the private secret
  alone.
- Token lifetime (`exp - iat`) is hardcoded to 900 seconds and `environment` is
  hardcoded to `"production"` — there is no non-production configuration path
  in this code.
- No JWT/JOSE library is used or should be added silently: the header, payload,
  and RS256 signature are all built by hand with `crypto.subtle` and
  `Buffer`/base64url encoding.

### Testing Requirements
- `pnpm build:identity` (run from `workspace-cloud/`): `tsc -p
  infrastructure/tsconfig.identity.json && wrangler deploy --dry-run -c
  wrangler.identity.jsonc`. This is a type-check plus deploy dry-run only — it
  does not exercise token issuance, signature, or expiry logic.
- `pnpm test:contracts` (`vitest run --config vitest.contracts.config.ts`) is
  the actual behavioral coverage. `../lib/control-plane-contracts.harness.ts`
  calls `assertWorkloadIdentityContract()` from
  `../lib/providers/workload-identity.harness.ts`, which imports
  `issueWorkloadIdentity`, `issueAnalyticsIdentity`, and
  `identityMetadataResponse` directly (bypassing the RPC binding) and
  round-trips them against the consumer-side verifier in
  `../lib/providers/workload-oidc.ts`. It asserts: correct claims and 900s
  lifetime, JWKS shape, 404/405 on wrong paths/methods, rejection of an
  altered signature, rejection of a mismatched `OIDC_WORKLOAD_ID`, rejection of
  an expired token, and that a non-production `OIDC_SUBJECT` throws. Any change
  to `workload-identity-core.ts` should keep this suite passing.

### Common Patterns
- RPC-only privilege separation: only `WorkerEntrypoint` subclasses exposed
  through a named service binding can reach `issueWorkloadIdentity` /
  `issueAnalyticsIdentity`; the default-exported plain `fetch` handler (public
  internet surface) is wired only to `identityMetadataResponse`, which cannot
  issue a token. Preserve this split when adding any new capability here.
- Signing-key/public-key consistency check before every signature (see above)
  is the pattern to follow for any future key-rotation logic in this file.

## Dependencies

### Internal
- `../wrangler.identity.jsonc` — deployment config for this Worker
  (`dopedb-workspace-identity`); declares `OIDC_ISSUER`, `OIDC_AUDIENCE`,
  `OIDC_ACCOUNT_ID`, `OIDC_WORKLOAD_ID`, `OIDC_SUBJECT` as plain `vars` and
  `OIDC_SIGNING_KEY`/`OIDC_PUBLIC_KEYS` as required `secrets` (names only; no
  values in this repo).
- `../identity-env.d.ts` — wrangler-generated ambient `IdentityEnv` type
  (`wrangler types --config=wrangler.identity.jsonc …`), included by
  `tsconfig.identity.json`. Regenerate it rather than hand-editing after
  changing `wrangler.identity.jsonc`'s vars/secrets.
- `../wrangler.jsonc` (main Worker) declares service binding `WORKLOAD_IDENTITY`
  → `dopedb-workspace-identity` entrypoint `WorkspaceIdentity`; consumed by
  `../lib/workload-identity.ts` (`workloadOidcToken()`), which fetches
  `POST /token` on that binding and validates the response shape before
  trusting it.
- `product-analytics-cloudflare/wrangler.jsonc` (separate subproject) declares
  service binding `ANALYTICS_IDENTITY` → the same `dopedb-workspace-identity`
  Worker's `AnalyticsIdentity` entrypoint. This directory does not contain that
  consumer; only the binding declaration was checked.
- `../lib/providers/workload-identity.harness.ts` and
  `../lib/providers/workload-oidc.ts` — test-only consumer/verifier pair for
  the contract test described above.

### External
- `cloudflare:workers` (`WorkerEntrypoint`) in `identity-worker.ts`.
- `workload-identity-core.ts` has no external package imports: it uses only
  the platform Web Crypto API (`crypto.subtle`, `crypto.randomUUID`) and
  Node's `Buffer` (available via the `nodejs_compat` compatibility flag set in
  `wrangler.identity.jsonc`). No JWT/JOSE library is used for encoding or
  signing.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
