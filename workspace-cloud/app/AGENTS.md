<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/app

## Purpose
Next.js 16 App Router tree for the DopeDB Workspace Web control-plane app: every
`route.ts` (REST API), `page.tsx` (server-rendered screen), and the small
screen-local client components each page composes. This directory owns workspace
identity, connection templates, member/connection grants, provider integrations
(PlanetScale/Neon/GCP Cloud SQL/Vault), Analysis Article sharing, and Better Auth
session/Desktop-approval screens. It must never: return raw database query result rows
(Analysis Article runs return only receipts/metadata; rows stay on the Desktop
runner), execute or expose a saved query from a public `/analyses/[slug]` page
(publications are immutable pre-rendered HTML snapshots), issue a managed
credential to anything but a Desktop bearer request, or let a shared/public
record carry a long-lived secret. Nearly every mutating route also enforces one
serialized "revocation gate" before it changes connection/member/integration
access, so an in-flight credential lease cannot be orphaned by a concurrent grant
change.

## Route Table

### Auth
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/auth/[...all]` | `app/api/auth/[...all]/route.ts` | GET, POST | Better Auth catch-all handler (`toNextJsHandler`); GET first checks whether the `callback/google` path is actually a GCP Cloud Setup OAuth callback and special-cases it before delegating to Better Auth |
| `/accept-invitation/[invitationId]` | `app/accept-invitation/[invitationId]/page.tsx` | page (RSC) | Validates the UUID, requires a session (redirects to `/auth/sign-in?returnTo=...` otherwise), renders `AcceptInvitation` inside the shared Identity shell |
| `/accept-invitation/[invitationId]/AcceptInvitation.tsx` | same dir | page (client) | Calls `authClient.organization.acceptInvitation`; also lets the user switch to another already-signed-in local account via `multiSession.setActive` before accepting |
| `/article-invitations/[invitationId]` | `app/article-invitations/[invitationId]/page.tsx` | page (RSC) | `force-dynamic`, `noindex`; validates UUID, renders `HandoffPage` (from `features/articleSharing`) for accepting an Analysis Article sharing invitation |
| `/auth/github/complete` | `app/auth/github/complete/page.tsx` | page (RSC) | Static success/failure confirmation screen for the GitHub App installation OAuth flow, driven by `?status=connected|failed` |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | page (RSC) | Marketing-style sign-in screen; resolves a safe `returnTo`, shows OAuth-error copy, renders `SignInButton` |
| `/auth/sign-in/SignInButton.tsx` | same dir | page (client) | Calls `authClient.signIn.social({ provider: "google", callbackURL: returnTo })` |

### Internal / Cron
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/internal/cron/credential-leases` | `app/api/internal/cron/credential-leases/route.ts` | GET | Cron-authorized (`cronRequestAuthorized` + scheduler header) cleanup of up to 10 expired managed credential leases; schedules the next background run |
| `/api/internal/cron/maintenance` | `app/api/internal/cron/maintenance/route.ts` | GET | Cron-authorized cleanup of expired provider discovery receipts and durable workspace retention (deletion purge); schedules the next run |
| `/api/internal/deployment` | `app/api/internal/deployment/route.ts` | GET | Public, secret-free deployment receipt: returns `{ service, versionId }` from `CF_VERSION_METADATA`; no DB/session access |

### v1 top-level
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/v1/article-invitations/[invitationId]` | `app/api/v1/article-invitations/[invitationId]/route.ts` | POST | Accepts one Analysis Article sharing invitation for the authenticated user (`acceptArticleInvitation`) |
| `/api/v1/knowledge/github/callback` | `app/api/v1/knowledge/github/callback/route.ts` | GET | GitHub App installation/user-authorization OAuth callback: validates opaque setup state, rechecks workspace `manage` authority, inspects/validates the installation, then upserts `knowledge_github_installation`; redirects to `/auth/github/complete` |
| `/api/v1/knowledge/github/webhook` | `app/api/v1/knowledge/github/webhook/route.ts` | POST | Verifies the GitHub HMAC signature on a size-bounded body, then updates `knowledge_source` sync state for `push`, `installation`, `installation_repositories`, and `repository` events |
| `/api/v1/personal/knowledge/scope` | `app/api/v1/personal/knowledge/scope/route.ts` | POST | Provisions/updates the signed-in user's private Personal Knowledge scope (Projects/Environments) from a bounded, strictly-shaped payload |
| `/api/v1/product-analytics/events` | `app/api/v1/product-analytics/events/route.ts` | POST | Anonymous first-party analytics ingestion: content-type/size checks, ingress + per-installation rate limits, then relays the envelope; distinguishes retryable (429/503) from terminal (400/415/422) outcomes |
| `/api/v1/providers/planet-scale/callback` | `app/api/v1/providers/planet-scale/callback/route.ts` | GET | PlanetScale OAuth callback: consumes single-use state, re-authorizes the workspace, exchanges the code, verifies managed scopes, and persists/reconnects the provider integration (revoking prior leases on reconnect) |
| `/api/v1/public/analyses/[slug]` | `app/api/v1/public/analyses/[slug]/route.ts` | GET | Rate-limited, secret-free JSON read of one live (non-revoked) public Analysis Article publication; strict CSP/robots headers |
| `/api/v1/session` | `app/api/v1/session/route.ts` | GET | Returns the current authenticated user/session identity, or 401 |
| `/api/v1/workspaces` | `app/api/v1/workspaces/route.ts` | GET, POST | GET lists the caller's active-lifecycle workspaces (excluding personal-knowledge orgs), auto-accepting pending invitations first; POST creates a new organization/workspace with a generated slug |
| `/` | `app/page.tsx` | page (RSC) | Redirects to the localized `/settings` |
| `/robots.ts` | `app/robots.ts` | (metadata route) | Allows `/`, disallows `/api/`, sets `host` to `app.dopedb.dev` |

### v1 / workspaces / {workspaceId} / analyses
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/v1/workspaces/[workspaceId]/analyses` | `.../analyses/route.ts` | GET, POST | GET lists Analysis Articles accessible to the member (optionally filtered by Environment); POST creates a new Article (requires expected revision `0`) |
| `.../analyses/[articleId]` | `.../analyses/[articleId]/route.ts` | GET, PATCH, DELETE | GET one accessible Article; PATCH applies an optimistic-revision `update` action (or `propose` if the new definition is AI-authored); DELETE soft-deletes after re-validating the current revision's payload |
| `.../analyses/[articleId]/publications` | `.../analyses/[articleId]/publications/route.ts` | GET, POST | GET lists publications for one Article; POST publishes a new immutable HTML snapshot, requiring a `succeeded` run at the current Article revision |
| `.../analyses/[articleId]/publications/[publicationId]` | `.../publications/[publicationId]/route.ts` | DELETE | Revokes one publication (keeps the audit row), revalidates the public page and API paths |
| `.../analyses/[articleId]/revisions` | `.../analyses/[articleId]/revisions/route.ts` | GET | Returns up to 200 immutable version-history rows for the Article (Editor access required) |
| `.../analyses/[articleId]/runs` | `.../analyses/[articleId]/runs/route.ts` | GET, POST | GET paginates run history (cursor by `createdAt`); POST creates/starts a run at an exact Article revision (requires a Desktop bearer session + runner capability) |
| `.../analyses/[articleId]/runs/[runId]` | `.../runs/[runId]/route.ts` | GET, PATCH | GET returns run status + per-node query receipts; PATCH completes a run (Desktop bearer only), verifying each receipt's query hash matches the immutable revision |
| `.../analyses/[articleId]/runs/[runId]/cancel` | `.../runs/[runId]/cancel/route.ts` | POST | Records cooperative cancellation intent; the Desktop runner observes it and finishes as cancelled |
| `.../analyses/[articleId]/runs/[runId]/control` | `.../runs/[runId]/control/route.ts` | GET | Minimal execution-control projection (cancellation/authority state only) for a running query; requires Desktop bearer + runner capability |
| `.../analyses/[articleId]/sharing` | `.../analyses/[articleId]/sharing/route.ts` | GET, POST, DELETE | Single handler bound to all three methods: GET loads sharing state, POST creates an email invitation, DELETE revokes one by id |
| `.../analyses/runners` | `.../analyses/runners/route.ts` | GET, POST | GET lists the member's own registered Desktop Analysis runners; POST registers/heartbeats a runner and issues/validates its possession-bound capability |
| `.../analyses/runners/[runnerId]` | `.../runners/[runnerId]/route.ts` | DELETE | Revokes ("forgets") one Desktop runner and stops its active foreground run |

### v1 / workspaces / {workspaceId} / connections
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/api/v1/workspaces/[workspaceId]/connections` | `.../connections/route.ts` | GET, POST | GET lists connections the member has any grant on (managed, or safe read-only member-local); POST creates a new shared connection template (workspace admin/owner only) |
| `.../connections/[connectionId]` | `.../connections/[connectionId]/route.ts` | POST, PATCH, DELETE | POST is an access preflight for `read`/`write`/`schema` (checks write/schema capability and provider support without granting anything); PATCH updates the template under optimistic revision (409 returns a `conflictId` on mismatch); DELETE soft-deletes after revoking active leases |
| `.../connections/[connectionId]/grants` | `.../[connectionId]/grants/route.ts` | GET, POST, DELETE | GET lists every member's connection capability; POST raises a member's grant (a manager cannot self-downgrade); DELETE removes a grant, first claiming a revocation gate and revoking active leases |
| `.../connections/[connectionId]/lease` | `.../[connectionId]/lease/route.ts` | POST, DELETE | POST issues a one-time managed credential lease to a Desktop bearer request (re-validates provider/resource/policy/capability, audits the issuance, revalidates authority right before returning the secret); DELETE is a best-effort early release of one lease |
| `.../connections/[connectionId]/managed-access-target` | `.../managed-access-target/route.ts` | GET, POST, DELETE | GET returns a secret-free canonical provisioning target; POST (Desktop bearer) re-verifies live provider identity and refreshes OAuth before pinning a target into an approval plan; DELETE (Desktop bearer) destroys managed access after re-verifying every pinned fingerprint |
| `.../connections/[connectionId]/managed-access` | `.../[connectionId]/managed-access/route.ts` | PUT | Switches a connection from managed back to member-local credentials; rejects re-enabling managed mode here (that requires the receipt-bound import route) and revokes active leases first |
| `.../connections/[connectionId]/provider-local-target` | `.../provider-local-target/route.ts` | GET | Returns a secret-free canonical target for a Desktop-local provider binding |
| `.../connections/conflicts` | `.../connections/conflicts/route.ts` | GET | Lists unresolved connection conflicts visible to members holding `manage` on that connection |
| `.../connections/conflicts/[conflictId]` | `.../conflicts/[conflictId]/route.ts` | POST | Records a human decision (`server`/`candidate`/`dismissed`) resolving one conflict |

### v1 / workspaces / {workspaceId} / knowledge
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `.../knowledge/environment-connections` | `.../environment-connections/route.ts` | GET | One bounded workspace-wide snapshot of Environment→connection bindings |
| `.../knowledge/environments/[environmentId]/connections` | `.../environments/[environmentId]/connections/route.ts` | GET, POST, DELETE | GET lists bindings for one Environment (flags staleness vs. current connection revision); POST creates/updates a binding via one atomic D1 statement group (rejects reassigning a connection already bound elsewhere); DELETE revokes a binding |
| `.../knowledge/github/install` | `.../github/install/route.ts` | POST | Starts GitHub App installation OAuth: stores a hashed, 10-minute setup state, returns the installation authorization URL |
| `.../knowledge/github/repositories` | `.../github/repositories/route.ts` | GET | Lists repositories visible to the workspace's active GitHub App installations |
| `.../knowledge/grants` | `.../grants/route.ts` | GET, POST, DELETE | Knowledge-graph grants are not shipped: GET always returns `{ grants: [] }`; POST always 409; DELETE still revokes an old persisted grant row for cleanup |
| `.../knowledge/inventory` | `.../inventory/route.ts` | GET | One combined Projects + Sources snapshot for the Desktop Explorer |
| `.../knowledge/mappings` | `.../mappings/route.ts` | GET, POST, PATCH | Graph-backed mapping proposals are not shipped: GET returns `{ mappings: [] }`, POST and PATCH always 409 |
| `.../knowledge/projects/[projectId]/environments` | `.../projects/[projectId]/environments/route.ts` | POST | Appends a new Environment to a Project under an expected Project revision |
| `.../knowledge/projects/[projectId]` | `.../projects/[projectId]/route.ts` | DELETE | Deletes a Project under an expected revision; blocked (409) if the Project still has active Analysis Articles |
| `.../knowledge/projects` | `.../projects/route.ts` | GET, POST, PATCH | GET lists Projects; POST creates a Project with 1-20 Environments; PATCH renames a Project under an expected revision |
| `.../knowledge/source-sync-progress` | `.../source-sync-progress/route.ts` | GET | Stub: always returns `{ progress: [] }` |
| `.../knowledge/sources/[sourceId]/browse` | `.../sources/[sourceId]/browse/route.ts` | GET, POST | GET searches a pinned GitHub source at an exact commit; POST reads an exact file/line range from that pinned commit — both delegate to `source-browser-application` |
| `.../knowledge/sources/[sourceId]/graph` | `.../sources/[sourceId]/graph/route.ts` | GET | Stub: always 409 ("Knowledge graph access is not available") |
| `.../knowledge/sources/[sourceId]` | `.../sources/[sourceId]/route.ts` | POST, DELETE | POST always 409 (graph indexing unsupported; sources use exact-commit browsing); DELETE marks a source revoked |
| `.../knowledge/sources` | `.../sources/route.ts` | GET, POST | GET lists Knowledge sources; POST binds a GitHub repository/ref as a new source, resolving and pinning its current commit SHA via the GitHub App |

### v1 / workspaces / {workspaceId} / backups
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `.../backups` | `.../backups/route.ts` | GET, POST | GET lists backup ciphertext metadata only (admin/owner, audit-logged); POST snapshots workspace profile + connection templates, KMS-seals them, and inserts a new backup row |
| `.../backups/[backupId]` | `.../backups/[backupId]/route.ts` | DELETE | Tombstones a backup (admin/owner) and schedules its retention purge |
| `.../backups/[backupId]/restore` | `.../backups/[backupId]/restore/route.ts` | POST | Decrypts and integrity-checks a backup snapshot, then restores it additively — existing ids become immutable restore *candidates* rather than overwriting current data |
| `.../backups/key-rotation` | `.../backups/key-rotation/route.ts` | GET, POST | GET returns rotation status (owner-only); POST begins, resumes/claims, or advances the workspace data-key rotation (idempotency-keyed) |

### v1 / workspaces / {workspaceId} / provider-integrations
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `.../provider-integrations` | `.../provider-integrations/route.ts` | GET, POST | GET lists active/reconnect-required integrations plus the static provider catalog (optionally including managed connections); POST starts OAuth (PlanetScale/GCP Cloud SQL) or validates+persists a directly-supplied credential (Neon/Vault, or GCP via a sealed bootstrap ticket) |
| `.../provider-integrations/[integrationId]` | `.../[integrationId]/route.ts` | DELETE | Multi-phase, resumable disconnect: revoke active leases → revoke the provider OAuth grant → scrub the stored credential → finalize; each phase is durably recorded so a crash mid-disconnect can resume |
| `.../provider-integrations/[integrationId]/imports` | `.../[integrationId]/imports/route.ts` | POST | Imports a new managed connection from a single-use, session/member-bound discovery receipt (idempotency-keyed) |
| `.../provider-integrations/[integrationId]/neon-bootstrap` | `.../[integrationId]/neon-bootstrap/route.ts` | POST | `action: "preflight"` inspects a Neon database and returns a signed, TTL-bound bootstrap plan; `action: "apply"` re-validates and executes that exact plan, then issues a discovery receipt |
| `.../provider-integrations/[integrationId]/neon-branches/operations` | `.../neon-branches/operations/route.ts` | GET, POST | GET lists durable Neon branch operations for the integration; POST runs a branch operation command (thin HTTP boundary over `neon-branch-operation-application`) |
| `.../provider-integrations/[integrationId]/neon-branches` | `.../[integrationId]/neon-branches/route.ts` | GET | Read-only Neon branch tree for one project: live provider branch inventory joined with workspace connection references, active lease counts, and deletion-blocker codes |
| `.../provider-integrations/[integrationId]/resources` | `.../[integrationId]/resources/route.ts` | GET, POST | GET discovers provider resources for a selection (org/project/database/branch/instance/broker/target) and seals a per-item selection proof; POST re-runs that exact discovery and exchanges a still-valid selection proof for a single-use import receipt |
| `.../provider-integrations/gcp-setup/[setupId]` | `.../gcp-setup/[setupId]/route.ts` | GET, POST | GET queries session-bound GCP OAuth discovery (`projects`/`instances`/`permissions`); POST bootstraps a Cloud SQL instance — provisions least-privilege principals, optionally grants/revokes temporary IAM, and returns a sealed bootstrap ticket |
| `.../provider-integrations/local-authority` | `.../local-authority/route.ts` | GET | Read-only, redacted authority projection for member-local (non-managed) provider credentials |

### v1 / workspaces / {workspaceId} misc
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `.../lifecycle` | `.../[workspaceId]/lifecycle/route.ts` | GET, POST | GET returns deletion/lifecycle status and blockers; POST performs `schedule_deletion` (exact-name confirmed, idempotency-keyed, schedules the purge cron) or `cancel_deletion` |
| `.../members` | `.../[workspaceId]/members/route.ts` | GET, POST, PATCH, DELETE | GET lists members + pending invitations; POST creates an invitation (`auth.api.createInvitation`); PATCH changes a member's role (revocation-gated, revokes active leases, blocks if the member owns undelegated Analysis Articles); DELETE removes a member or cancels a pending invitation |
| `.../sync` | `.../[workspaceId]/sync/route.ts` | GET | Ordered, payload-free change cursor: given a client cursor it returns the new head plus which secret-free collections (`connections`, `analyses`) need reconciliation and whether either was tombstoned; a stale/too-far-behind cursor triggers a full `reset` |

### Public / misc pages
| Route | File | Methods | Purpose |
|-------|------|---------|---------|
| `/analyses/[slug]` | `app/analyses/[slug]/page.tsx` | page (RSC) | `force-dynamic`, `revalidate: 0`; rate-limits and loads a public Analysis Article publication (memoized per request via `React.cache`), 404s if unavailable, sets SEO metadata from `searchIndexable` |
| `/analyses/[slug]/PublicAnalysisArticle.tsx` | same dir | page (RSC) | Renders the sanitized HTML body plus localized title and explicit UTC publication timestamp for a public publication |
| `not-found.tsx` / `error.tsx` | app root | RSC / client boundary | Uses one localized, non-identifying recovery surface for unavailable or failed shared links; never reveals whether an Article, invitation, workspace, or saved query exists |
| `/open-article/[workspaceId]/[articleId]` | `app/open-article/[workspaceId]/[articleId]/page.tsx` | page (RSC) | `force-dynamic`, `noindex`; validates both UUIDs, renders `HandoffPage` scoped to the workspace+article for opening it in Desktop |
| `/settings` | `app/settings/page.tsx` | page (RSC) | `force-dynamic`; the full Settings screen — see Settings section below |

## Layout, misc top-level files
- `app/layout.tsx` — root server layout: resolves locale, sets metadata (noindex), loads Pretendard + IBM Plex Mono fonts, wraps children in `WorkspaceLocaleProvider` and `WorkspaceWebAnalytics`.

## Components (app/components/)
| File | Description |
|------|-------------|
| `Brand.tsx` | Client. Logo + "DopeDB Workspace" wordmark link; points to the marketing site or `/settings` depending on `destination` |
| `Console.tsx` | Server. `ConsoleNotice` — inline success/danger status banner used by settings notices |
| `Controls.tsx` | Server. Shared button/link/input/select/field primitives (`ControlButton`, `ControlLink`, `ControlField`, `ControlInput`, `ControlSelect`) used across `app/` screens |
| `Identity.tsx` | Server. Shared auth-shell/card/typography/button primitives (`IdentitySingleShell`, `IdentityCard`, `IdentityTitle`, `IdentityPrimaryButton`, etc.) used by accept-invitation and `/auth/*` pages |
| `LocaleSwitcher.tsx` | Client. EN/KO toggle link that preserves the current path and query string |
| `WebAnalyticsProvider.tsx` | Client. Consent-gated analytics provider: checks eligibility (HTTPS, not localhost, no DNT/GPC), reads/writes a `localStorage` consent flag, lazy-loads the Clarity plugin only after consent, and stops tracking before client-side navigation |
| `WorkspaceLocale.tsx` | Client. React context provider (`WorkspaceLocaleProvider`) and hook (`useWorkspaceLocale`) for the resolved locale |

## Settings (app/settings/)
All of the panels below are composed by `app/settings/page.tsx`, the server component that resolves the session, the caller's visible/active workspace and role, and the requested section (`workspaces` / `access` / `providers` / `workspace-settings` / `account`) before rendering the matching panel(s).

| File | Description |
|------|-------------|
| `page.tsx` | Server, `force-dynamic`. Resolves session (redirects to sign-in), accepts pending invitations, lists+filters visible workspaces, resolves the active workspace/role/lifecycle state, computes the effective section, and renders header + `SettingsNavigation` + the section's panel(s) |
| `SettingsNavigation.tsx` | Server. Tab navigation between `workspaces` / `access` / `providers` / `workspace-settings` / `account`, hiding tabs the caller cannot use |
| `AccountSwitcher.tsx` | Client. Multi-session Better Auth account switcher dropdown in the header (`multiSession.setActive` / `.revoke`, sign-out-all) |
| `AccountManagementPanel.tsx` | Client. Account identity header; renders `ActiveSessions` (user-level, not workspace-scoped) |
| `ActiveSessions.tsx` | Client. Lists and revokes the user's active Better Auth sessions via `authClient.listSessions`/`revokeSession`; handles `SESSION_NOT_FRESH` by prompting reauthentication |
| `CreateWorkspaceForm.tsx` | Client. `POST /api/v1/workspaces` to create a new workspace, then `router.refresh()` |
| `WorkspaceAccessPanel.tsx` | Client. Member/invitation administration; calls `GET/POST/PATCH/DELETE .../workspaces/{id}/members` |
| `ConnectionAccessPanel.tsx` | Client. Per-connection member grant management and conflict resolution UI; calls `.../connections`, `.../connections/conflicts`, `.../connections/{id}/grants`, `.../connections/conflicts/{id}`, and `.../connections/{id}` (conflict apply) |
| `CloudAccountPanel.tsx` | Client. Renders the provider integration list or the GCP Cloud Setup wizard (via `useProviderAccountAccess`); wraps `GcpCloudSetup` / `ProviderIntegrationList` from `features/providerAccess` |
| `SharedDatabasePanel.tsx` | Client. Managed-provider database import and Neon branch management UI (`NeonBranchManager`, `ProviderResourcePicker`) driven by the `useSharedDatabaseAccess` hook |
| `WorkspaceLifecyclePanel.tsx` | Client. Workspace deletion scheduling/cancellation, backup list, and key-rotation controls; calls `.../lifecycle`, `.../backups`, `.../backups/key-rotation` |
| `WorkspaceManagementPanel.tsx` | Server. Composes the `access` / `providers` / `workspace-settings` panels above for the selected management area |

## Auth flows (app/auth/*)
- **Desktop loopback flow** (`auth/desktop`): hosted login, explicit account choice and approval followed by a `127.0.0.1` callback carrying only a 120-second authorization code and state. `api/auth/desktop/authorize` requires exact Origin, cookie-only live session and a request/session-bound nonce; `api/auth/desktop/token` accepts native JSON S256 exchange only, atomically consumes the code and creates a separate Better Auth Bearer session.
- **Google sign-in** (`auth/sign-in`): marketing-style screen; `SignInButton` calls `authClient.signIn.social({ provider: "google" })` with a validated `returnTo`.
- **GitHub App installation completion** (`auth/github/complete`): static success/failure screen reflecting `?status=connected|failed` from the `api/v1/knowledge/github/callback` redirect.

## Static assets
- `app/favicon.ico`, `app/apple-icon.png`, `app/icon.svg` — tab/PWA icons for the Workspace Web app.
- `app/globals.css` — global stylesheet, imported once by `app/layout.tsx` alongside the Pretendard variable font.

The Desktop approval page owns `DesktopAccountActions.tsx`, which selects an explicit browser account before approval.

## For AI Agents

### Working In This Directory
- Every mutating `route.ts` calls `mutationAllowed(request, env.appOrigin())` as its very first check, before touching auth or the database (origin/CSRF gate).
- Session/authority resolution is layered: `authoritativeSession(request)` for user-level `/api/v1` routes with no workspace scope (`session`, `workspaces` list/create, `article-invitations/*`, `personal/knowledge/scope`); `authorizeWorkspace(request, workspaceId, capability)` for workspace-scoped routes; `authorizeWorkspaceConnection` / `authorizeWorkspaceConnectionAction` for connection-scoped capability checks; `authorizeWorkspaceLifecycle` for `.../lifecycle`.
- Every dynamic path param is validated with `isUuid()` (or an explicit regex for non-UUID ids) before any query, and every query's `WHERE` always re-intersects `organizationId`/`workspaceId` — this is how a guessed UUID from another tenant is prevented from resolving.
- Mutations that change persisted content use optimistic concurrency (`parseExpectedRevision`, `contentRevision`/`revision` columns): missing revision → 428, stale revision → 409 (sometimes returning a `conflictId` for connections).
- Routes that change live database/member/integration access wrap a revocation-gate claim (`claimRevocationGate` → `revokeActiveLeases` → commit → `clearRevocationGate`/`releaseRevocationGateClaim`) so a concurrent grant change can never race an issued credential lease.
- Desktop-only endpoints (lease issue/release, run create/complete, provisioning target prepare/destroy) require an `Authorization: Bearer` header and/or an exact `x-dopedb-*-contract` version header, returning `426` to force a client upgrade on mismatch.
- Query/result rows never cross any Analysis Article or run API — only receipts, hashes, and row/byte counts. Do not add a field that would leak result data through these routes.
- Dynamic segment names are consistent nouns: `[workspaceId]`, `[connectionId]`, `[articleId]`, `[runId]`, `[runnerId]`, `[integrationId]`, `[setupId]`, `[backupId]`, `[invitationId]`, `[environmentId]`, `[projectId]`, `[sourceId]`, `[publicationId]`, `[conflictId]`, `[slug]`.

### Testing Requirements
- `pnpm test:contracts` (vitest, `vitest.contracts.config.ts`) runs only `lib/control-plane-contracts.harness.ts` and `lib/d1-storage.harness.ts`. This exercises wire-format/serialization helpers that routes call (e.g. `managedLeaseResponse` used by `connections/[connectionId]/lease/route.ts`, `workspaceSyncPage` used by `sync/route.ts`) — it does **not** invoke any `route.ts` handler directly.
- The root `pnpm test` critical smoke suite only runs `src/features/*` tests; nothing under `workspace-cloud/app/` is covered by it.
- There is no route-level (HTTP integration) test suite for `app/api/**` in this repository at present. Verify route changes manually (`pnpm dev`, or `pnpm build` + a manual check per repo AGENTS.md) and add coverage only within the repo's 208-test budget, per root `docs/CODE_STRUCTURE.md`/`AGENTS.md` policy.

### Common Patterns
- Nearly every mutating route follows: origin check → capability authorization → (optimistic revision check) → scoped DB lookup (`organizationId` + id) → body validation/parsing → versioned/gated commit → typed public projection. See `app/api/v1/workspaces/[workspaceId]/connections/[connectionId]/route.ts` `PATCH` for a representative example of all six steps together.
- Secret-bearing responses (leases, bootstrap tickets) always set `pragma: no-cache`, `expires: 0`, and `x-content-type-options: nosniff` in addition to the normal `privateJson` headers.
- Provider discovery is a three-step "sealed proof" pattern used by both `provider-integrations/[integrationId]/resources/route.ts` and `neon-bootstrap/route.ts`: discover → seal a signed `selectionProof`/plan client-side round-trip → re-run discovery and require the proof/plan to still match before mutating.

## Dependencies

### Internal
- `../lib/` — see `../lib/AGENTS.md`. Referenced constantly: `workspace-authorization.ts` (all authorization helpers), `workspace-versioning*.ts` (optimistic concurrency + conflict store), `revocation-gates.ts`, `provider-integrations/*`, `provider-integration-mutation-store.ts`, `workspace-analysis-*-store.ts`, `workspace-backup*.ts`, `knowledge/*`, `secret-envelope.ts`, `schema.ts` (Drizzle tables), `http.ts` (`jsonError`/`privateJson`/`boundedJsonBody`/`isUuid`/`mutationAllowed`).
- `../features/` — client components delegate feature logic here rather than embedding it: `features/providerAccess/*` (Cloud setup, Neon branch manager, resource picker) used by `settings/CloudAccountPanel.tsx` and `settings/SharedDatabasePanel.tsx`; `features/connectionAccess/*` (grant mutation, Desktop-return handoff) used by `settings/ConnectionAccessPanel.tsx` and `settings/page.tsx`; `features/articleSharing/*` (`HandoffPage`, invitation store/acceptance) used by `article-invitations/[invitationId]/page.tsx`, `open-article/.../page.tsx`, and `api/v1/article-invitations/[invitationId]/route.ts` and `.../analyses/[articleId]/sharing/route.ts`.
- `../drizzle.d1.config.ts` / D1 migrations — schema source for everything imported from `lib/schema.ts`.

### External
- `better-auth` + `@better-auth/drizzle-adapter` — session, organization/member, invitation, multi-session primitives used throughout `api/auth`, `api/v1/workspaces/**`, and the `auth/*` pages.
- `drizzle-orm` — every SQL query and schema reference in `route.ts` files.
- `sanitize-html` — via `src/design-system/components/AnalysisArticleBody`, used to render public Analysis Article HTML in `analyses/[slug]/PublicAnalysisArticle.tsx`.
- `@opennextjs/cloudflare` (`getCloudflareContext`) — `api/internal/deployment/route.ts`.
- `@microsoft/clarity` (via `lib/clarity-plugin`) — lazy-loaded by `components/WebAnalyticsProvider.tsx` only after explicit consent.
- `next/font/google` (`IBM_Plex_Mono`) and the `pretendard` package — loaded once in `layout.tsx`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
