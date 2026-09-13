<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/providers

## Purpose
Local provider-credential binding and managed-access provisioning (e.g. GCP Cloud
SQL IAM setup). `domain.ts` states its contracts "intentionally exclude API keys,
OAuth tokens, provider API bodies, and database connection material" — every id in
this feature is a branded opaque string, never a secret. `tauriAdapter.ts` is "the
sole frontend owner of local-provider command literals"; requests carry only a
short-lived receipt or a one-shot form value, and no provider secret is retained
here.

## Key Files
| File | Description |
|------|-------------|
| `ManagedAccessDialog.tsx` | Dialog for reviewing/starting managed-access (least-privilege, short-lived) provisioning for a connection. |
| `ProviderCredentialDialog.tsx` | Device-local provider binding wizard; its reducer owns the ephemeral secret and one-use receipt, and query caches only ever receive summaries. |
| `ProviderCredentialsMenuItem.tsx` | Account-menu leaf that opens the credential dialog; the account owner controls the dialog's lifetime so a scope switch unmounts it and discards the reducer-held secret. |
| `domain.ts` | Branded id types and DTOs that exclude API keys, OAuth tokens, provider bodies, and DB connection material. |
| `queries.ts` | TanStack Query options wrapping provider inventory/binding/provisioning reads with an 8s timeout. |
| `state.ts` | Credential dialog state shape (`selecting` → `credentials` → `verifying` → `complete`). |
| `tauriAdapter.ts` | Sole frontend owner of local-provider command literals (integrations, credential bindings, provisioning lifecycle). |
| `tauriAdapter.test.ts` | Verifies the summary-only command wire shape and cross-checks GCP Cloud SQL provisioning behavior (IAM setting restart-free, preserving existing Cloud SQL users, rejecting removed identity/manual GCP trust input) against the `workspace-cloud` GCP bootstrap sources. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- **Security invariant (verified in code):** `domain.ts` types never include a raw
  credential, token, or connection string field — only branded ids and receipt/plan
  summaries. Do not add a field that could hold a secret.
- **Security invariant (verified in code):** `ProviderCredentialDialog.tsx` keeps
  the entered secret only in its own reducer state, never in a TanStack Query cache
  or in `domain.ts` types that outlive the dialog.
- **Security invariant (verified in code):** `tauriAdapter.test.ts` asserts the
  local provider adapter "owns the exact summary-only command wire" and "rejects
  extra or missing integration and binding fields before a query cache can hold
  them" — a schema change here must keep that test passing, not loosen it.
- Connecting/reconnecting/provisioning through this feature must never change
  pre-existing application users, roles, grants, or ownership — see root `AGENTS.md`
  "Work safely."

### Testing Requirements
- `tauriAdapter.test.ts` is part of the `pnpm test` smoke suite
  (`vitest run src/features/providers/tauriAdapter.test.ts`) and counts against the
  208-test budget; extend it rather than adding a new top-level test file.

### Common Patterns
- Provisioning results are `parse*` functions in `tauriAdapter.ts` that validate
  the wire shape before returning, e.g. `parseProviderProvisioningPlan`.

## Dependencies

### Internal
- `../../components/Icon`, design-system dialog/button primitives.

### External
- `@tanstack/react-query`.
- Rust: `src-tauri/src/features/providers/transport.rs` (also `application.rs`,
  `domain.rs`, `ports.rs`, `adapters/`, `provisioning/`).
- Test-only: reads `workspace-cloud/lib/providers/gcp-cloud-*.ts` and `vault.ts`
  as raw source (`?raw` import) to keep local and cloud GCP provisioning behavior
  aligned.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
