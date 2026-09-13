<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/code-structure

## Purpose
Implements the cohesion-based code-structure review from `docs/CODE_STRUCTURE.md`
as three composable stages: inventory, per-module metrics, and finding
analysis. Consumed by `scripts/check-code-structure.mjs`, never run standalone.

## Key Files
| File | Description |
|------|-------------|
| `source-inventory.mjs` | Builds one deterministic inventory of every hand-written code surface in the repository, classifying files (generated/declarative/test/product) so different review thresholds can apply. |
| `module-metrics.mjs` | Extracts language-light structural signals per module (line counts, fragmentation indicators) as review evidence, not a split instruction. |
| `analysis.mjs` | Turns inventory + metrics into review findings; treats oversized and fragmented modules as symmetric navigation-cost signals rather than a mechanical refactor trigger. |

## For AI Agents

### Working In This Directory
- `INTENTIONAL_BOUNDARY_NAMES` and similar allowlists in `analysis.mjs` exist to avoid flagging deliberate structural boundaries; extend them only for a genuinely intentional split, not to silence a real hotspot.
- These modules must stay deterministic (no wall-clock or filesystem-order dependent output) since their result is compared against the checked-in ratchet baseline in `docs/architecture/code-structure-baseline.json`.

### Testing Requirements
- Exercised via `pnpm check:code-structure` and `pnpm audit:code-structure` (full ranked report, run before changing the baseline).

### Common Patterns
- `@babel/parser` is used for structural parsing in `module-metrics.mjs`, tolerant of both plain JS/TS and JSX inputs.

## Dependencies

### Internal
- Consumed by `../check-code-structure.mjs`; reads `docs/architecture/code-structure-baseline.json`.

### External
- `@babel/parser`.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
