<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/productAnalytics

## Purpose
Consent-gated product analytics runtime. Native code owns endpoint availability and
authenticated batch delivery; this WebView layer owns only a closed event
vocabulary, immediate identity hashing, a seven-day local retry queue, and
observable consent state. It must never let arbitrary metadata, SQL, prompts,
database names, file paths, a URL, or a token cross into a wire payload or into
frontend hands — `domain.ts` enforces this by construction (typed event names and
enumerated properties only).

## Key Files
| File | Description |
|------|-------------|
| `ConsentPrompt.tsx` | Global consent card with a short explanation and always-visible grant/deny choices. |
| `WorkspaceScopeObserver.tsx` | Records one privacy-bounded "ready" outcome per usable workspace scope per app session; de-dupes across StrictMode replays. |
| `client.ts` | Runtime client: exposes `useProductAnalyticsSnapshot`, capture functions, and consent mutation, backed by hashed identity + local retry queue. |
| `domain.ts` | Closed event vocabulary: enumerated outcomes and raw-UUID-only identities (hashed before storage); no arbitrary metadata type path exists. |
| `outcomes.ts` | Closed, lossy mappings from potentially sensitive runtime inputs (engine, access mode, credential mode, row counts) to bounded enums. |
| `privacyPolicy.ts` | Opens the product analytics privacy policy URL via the OS opener plugin. |
| `storage.ts` | Local persistence of the pseudonymous installation id and bounded retry queue; withholds both until native consent status is applied. |
| `tauriAdapter.ts` | `productAnalyticsStatus`, `setProductAnalyticsConsent`, `submitProductAnalyticsBatch` — the only IPC surface for this feature. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- **Security invariant (verified in code):** `domain.ts` defines a closed event
  name/property vocabulary; do not add a free-form `metadata` or `properties: Record<string, unknown>`
  field to any event type.
- **Security invariant (verified in code):** `outcomes.ts` converts real values
  (row counts, SQL statement class, connection engine) into small closed enums
  before they can reach an event — never pass a raw value (SQL text, table name)
  through un-mapped.
- **Security invariant (verified in code):** `tauriAdapter.ts`'s header states the
  WebView never receives a URL, token, or generic HTTP primitive; do not add a
  fetch/XHR call here — all delivery is native, via `submit_product_analytics_batch`.
- **Security invariant (verified in code):** `storage.ts` withholds consent/queue
  state until native consent status has been applied for the process; do not read
  or act on local storage before that.
- Identity values are hashed immediately (`isProductAnalyticsUuid` guard in
  `domain.ts`); do not retain a raw identifier across a call boundary.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `WorkspaceScopeObserver.tsx` uses `captureProductEventOncePerSession` to avoid
  duplicate "ready" events under React StrictMode double-invocation.

## Dependencies

### Internal
- `../workspaces` — `workspaceAuthStateQuery` (for scope observation only).
- `../../lib/queries` — `useCatalogScope`.
- `../connections` — `ConnectionEngine`, `WorkspaceCredentialMode` (mapped through `outcomes.ts`, never passed raw).

### External
- `@tauri-apps/api/app` (`getVersion`), `@tauri-apps/plugin-opener` (`openUrl`), React `useSyncExternalStore`.
- Rust: `src-tauri/src/features/product_analytics/transport.rs` (also `adapters.rs`, `domain.rs`, `ports.rs`) implements `product_analytics_status`, `set_product_analytics_consent`, `submit_product_analytics_batch`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
