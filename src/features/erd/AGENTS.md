<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/erd

## Purpose

The entity-relationship diagram canvas. Physical relationships always come
from Catalog V2 (per `domain.ts`'s file-level doc comment); this feature only
owns diagram presentation, layout, and optional user-added "virtual"
relationships plus their persisted layout (positions, viewport, layout mode).

## Key Files

| File | Description |
|------|-------------|
| `ErdCanvas.tsx` | Default-exported React Flow surface: cancellable ELK auto-layout, workspace-scoped layout persistence, virtual relationship overlays, deterministic local export, and a compact mode for large schemas. |
| `ErdRelationNode.tsx` | Memoized React Flow node type for one Catalog V2 relation (`ErdFlowNode`); compact mode avoids mounting per-column rows for large schemas. |
| `ErdToolbar.tsx` | Default-exported flat command bar for layout mode, persistence, virtual edges, and local export. |
| `ErdCanvas.css` | The one documented CSS exception in this feature: styles React Flow's own generated subtree (background, minimap, controls) using design-system CSS variables; DopeDB-owned surface/control layout stays in Tailwind per this file's own header comment. |
| `domain.ts` | Branded `ErdLayoutId`/`ErdVirtualRelationId`, `ErdLayoutMode` (`physical`\|`logical`\|`uml`), and the `ErdLayout`/`SaveErdLayoutRequest`/`SaveErdLayoutOutcome` persistence contracts. |
| `tauriAdapter.ts` | `listErdLayouts(id)` and `saveErdLayout(request)`. |

## For AI Agents

### Working In This Directory

- `ErdCanvas.css` is an intentional, documented exception to the no-screen-CSS
  rule in root `CLAUDE.md`/`AGENTS.md` because it targets React Flow's own
  generated DOM, which Tailwind utilities cannot reach. Do not add new
  DopeDB-owned styling to this file — that belongs in Tailwind utilities per
  `src/design-system/README.md`.
- Relationship *data* always comes from Catalog V2; only virtual (user-added)
  relationships and layout/viewport state are locally owned and persisted by
  this feature.

### Testing Requirements

- No test file here; not part of `pnpm test` or the 208-test budget. Verify
  ERD changes with `pnpm build` and a manual check of the diagram screen.

### Common Patterns

- Branded ids with a constructor function (`erdLayoutId(value)`,
  `erdVirtualRelationId(value)`), matching the pattern used in
  `connections/domain.ts` and `jobs/domain.ts`.

## Dependencies

### Internal

- `src/features/connections/domain.ts` (`ConnectionId`), `src/ipc/types`
  (`CatalogObjectRef`, `CatalogRelationV2`).
- `src/lib/erdGraph.ts` (`relationDisplayName`).
- `src/design-system/components/{Workbench,FormControls}`, `src/components/{Icon,ToolbarMenu}`.
- Rust counterpart: `src-tauri/src/features/erd/transport.rs` (verified present).

### External

- `@xyflow/react` (React Flow: `Background`, `Controls`, `MiniMap`, `Handle`, `Position`, node/edge types).
- `elkjs` for automatic layout.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
