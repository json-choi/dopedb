<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src-tauri/src/features/product_analytics

## Purpose

Privacy-bounded product analytics transport. The renderer may submit only
the closed outcome vocabulary defined in `domain.rs`; the desktop never
accepts free-form analytics properties, raw product identifiers, SQL,
prompts, paths, or error messages. Also owns consent state (opt-in/opt-out,
generation, choice) persisted locally before any batch is forwarded.

## Key Files

| File | Description |
|------|-------------|
| `mod.rs` | Privacy-bounded product analytics transport (module root and the closed-vocabulary invariant). |
| `domain.rs` | Consent (`ProductAnalyticsConsent`, `ProductAnalyticsConsentState`) and batch event types/validation; bounds a batch to `MAX_BATCH_EVENTS` (16), rejects events older than `MAX_EVENT_AGE` (7 days) or clock-skewed beyond `MAX_FUTURE_SKEW` (5 minutes). |
| `ports.rs` | `ProductAnalyticsConsentPort` trait (`state`, `set_consent`). |
| `adapters.rs` | `Store`-backed consent adapter; persists consent/generation/choice under fixed keys, keeps a grant until explicit revocation, and applies the version-scoped weekly re-prompt bucket only to a denial. |
| `transport.rs` | Tauri commands forwarding validated batches to `crate::hosted_control_plane`; reads `AppState`. |

## For AI Agents

### Working In This Directory

- Never widen the accepted event/property shape beyond the closed
  vocabulary in `domain.rs`; a new analytics need requires a new named,
  reviewed variant, not a free-form field.
- Consent must be checked before any batch reaches `hosted_control_plane` in
  `transport.rs`.

### Testing Requirements

- `pnpm test:rust` (`cargo test --package dopedb --lib`).

## Dependencies

### Internal

- No cross-feature or kernel imports observed. `transport.rs` reaches
  `crate::hosted_control_plane` and `crate::state::AppState` directly
  (outside `features/`).

### External

- `reqwest` (via `hosted_control_plane`), `serde`, `uuid`, `chrono`.
- Frontend adapter: `src/features/productAnalytics/tauriAdapter.ts`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
