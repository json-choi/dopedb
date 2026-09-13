<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# docs/architecture

## Purpose
Machine-readable architecture baselines that CI guard scripts read and compare
against the live repository. These are ratchets and ownership declarations, not
prose documentation — hand-editing them changes what CI enforces.

## Key Files
| File | Description |
|------|-------------|
| `legacy-removal.md` | Owns the migration gate: a feature migration is complete only after the old runtime path, fallback, re-export, and flag are deleted, not merely after the new code exists. States the required six-step order and the pre-MVP persistence policy. |
| `code-structure-baseline.json` | Ratchet baseline (`fragmentClusters`, `highRiskModules`) read by `scripts/check-code-structure.mjs`; `pnpm check:code-structure` fails if new hotspots exceed it. Change only after reviewing `pnpm audit:code-structure` output per `docs/CODE_STRUCTURE.md`. |
| `state-ownership.json` | Declares each single-writer frontend state's owner file, dispatcher, required writer token, and forbidden writer tokens (state mutations that must not appear outside the owner). Read by `scripts/architecture/frontend-architecture-guards.mjs` as part of `pnpm check:architecture`. |

## For AI Agents

### Working In This Directory
- Do not hand-tune `code-structure-baseline.json` to silence a real regression; fix the underlying module split/merge instead, per `docs/CODE_STRUCTURE.md`.
- Adding a new single-writer state slice under ADR 0004 requires adding its entry to `state-ownership.json`, including `forbiddenWriterTokens` for any setter that must stay confined to the owner file.

### Testing Requirements
- `pnpm check:architecture` (reads `state-ownership.json`) and `pnpm check:code-structure` / `pnpm audit:code-structure` (reads `code-structure-baseline.json`).

### Common Patterns
- `state-ownership.json` entries follow `{ name, owner, dispatcher, writerTokens, forbiddenWriterTokens }`, matched literally against source text by the guard script.

## Dependencies

### Internal
- Read by `scripts/check-code-structure.mjs` and `scripts/architecture/frontend-architecture-guards.mjs`; both run under `scripts/check-architecture.mjs` / `pnpm check:architecture` and `pnpm build`.

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
