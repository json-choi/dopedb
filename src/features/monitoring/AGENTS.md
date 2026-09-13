<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/monitoring

## Purpose
Bundles two unrelated "monitoring" concerns under one feature folder: (1) privacy-bounded
desktop error/crash reporting (`client.ts`) and (2) Postgres statement-monitoring role
status/provisioning (`tauriAdapter.ts`). Native code owns crash-report delivery and
availability; the WebView side of (1) must strip database, workspace, and Agent payload
data before an event can leave the WebView, keeping only stack structure and a closed
set of safe surface/tag labels. Postgres monitoring changes are proposals that must be
approved through the shared `operations` approval flow before they take effect.

## Key Files
| File | Description |
|------|-------------|
| `client.ts` | Privacy-bounded desktop error monitoring client (Sentry) with a closed tag/error-type allowlist. |
| `tauriAdapter.ts` | Postgres monitoring status/proposal/set commands (`get_monitoring_status`, `propose_postgres_monitoring`, `set_postgres_monitoring`). |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- `client.ts` must never widen `SAFE_TAGS`/`SAFE_ERROR_TYPES` to admit SQL text,
  connection strings, table/database names, or Agent prompt content.
- `propose_postgres_monitoring` returns a `MonitoringOperationProposal`, which must
  be approved via `../operations/tauriAdapter` (`approveOperation`) before
  `setPostgresMonitoring` is called — do not invent a bypass path.
- `client.ts` and `tauriAdapter.ts` are independent modules; do not merge their
  concerns into one export surface.

### Testing Requirements
- No test file exists in this directory; not part of the `pnpm test` smoke suite.

### Common Patterns
- `tauriAdapter.ts` follows the repo-wide rule of being the sole frontend owner of
  its command name literals.

## Dependencies

### Internal
- `../operations` — approval flow for the monitoring proposal.
- `../../ipc/types` — `MonitoringOperationProposal`, `MonitoringStatus`.

### External
- `@sentry/react`, `@tauri-apps/api/app`, `@tauri-apps/api/event` (`client.ts`).
- Rust: no dedicated `transport.rs`. `get_monitoring_status` / `propose_postgres_monitoring` /
  `set_postgres_monitoring` are `#[tauri::command]`s in `src-tauri/src/commands/mod.rs`
  that call `state.services.monitoring`, composed from
  `src-tauri/src/features/monitoring/` (`mod.rs`, `application.rs`, `ports.rs`, `adapters.rs`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
