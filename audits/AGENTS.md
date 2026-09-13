<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# audits

## Purpose
Preserves bounded before/after UI regression evidence captured with a
deterministic fixture and browser projection. This directory is internal
regression evidence for a specific, dated audit pass; it is not release
evidence, a product-comparison archive, and it does not establish
packaged-runtime (macOS/Windows) parity on its own.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `ui-polish-2026-08-06/` | One dated UI-polish regression set: 20 PNG before/after captures (Explorer scope, connection editor, Settings rail, Action Search, Agent empty state, Welcome document, modal focus containment) plus `README.md`, which documents the deterministic PostgreSQL catalog fixture used, the accepted correction for each area, and the evidence limits (DOM/accessible-text only; packaged native rendering, screen readers, and connection runtime behavior remain separate manual validation per `docs/LIVE_VALIDATION_RUNBOOK.md`). |

## For AI Agents

### Working In This Directory
- Treat this directory as append-only historical evidence: do not overwrite a dated capture with a new UI's screenshot. A new UI change that needs visual evidence gets its own dated subdirectory and `README.md`, following the same fixture/projection discipline.
- Do not cite files here as proof of packaged (built, installed) app behavior; they are browser-projection captures only, per `ui-polish-2026-08-06/README.md`'s evidence limits.
- Feature scope decisions are never made or overridden here; `docs/PRODUCT_UI_SCOPE.md` remains authoritative even when a capture shows a control that scope document has not approved.

### Testing Requirements
- None; this is static evidence, not executable code.

### Common Patterns
- Each `README.md` in this tree states its fixture, viewport/projection, and an explicit "Evidence limits" section separating what was verified from what was not.

## Dependencies

### Internal
- Referenced by `docs/UI_UX_AUDIT.md` and `docs/UI_IMPLEMENTATION_TRACKER.md` as supporting evidence for closed defects.

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
