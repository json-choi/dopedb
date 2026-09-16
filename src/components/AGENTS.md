<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/components

## Purpose
App-level shared UI that sits one layer above `src/design-system/`: these
widgets carry a small amount of DopeDB-specific behavior (SQL viewing, row
editing, toolbar menus) rather than being pure visual primitives, so a couple
of them import feature domain types. Multiple screens/features reuse this
layer instead of re-implementing the same cell viewer, confirm button, or
toolbar menu.

## Key Files
| File | Description |
|------|-------------|
| `ConfirmButton.tsx` | Inline two-step confirm ("Really delete? Yes / No") that auto-reverts after 3s if untouched; never uses `window.confirm`. |
| `EngineMark.tsx` | Renders the small engine logo (`postgres`/`mysql`/`sqlite`/`mongodb` from `src/assets/db-icons/`, `bigquery` from Iconify) at `control` or `tree` size. |
| `Icon.tsx` | The app's inline-SVG icon set (Feather/Lucide-style 24×24 glyphs, `currentColor`, `em`-sized); no icon-library dependency. Icons are `aria-hidden`; the enclosing control owns the accessible name. |
| `InfoTip.tsx` | Small circular "i" affordance that opens a `design-system` `Tooltip` with a caption. |
| `LazySqlViewer.tsx` | `React.lazy` wrapper around `SqlViewer` so the CodeMirror bundle is only loaded when a SQL viewer is actually rendered. |
| `RowEditor.tsx` | Row editor panel (one input per column, checkbox for SQL `NULL`, read-only primary keys on edit) that builds an `INSERT`/`UPDATE` via `sqlBuild` and hands it to the caller — it never executes SQL itself, so the caller's approval/audit pipeline still applies. |
| `Skeleton.tsx` | Placeholder loading bars for a cold cache with no data to paint yet; a 200ms CSS reveal delay means a fast response unmounts it before it's visible. |
| `SqlViewer.tsx` | Shared CodeMirror 6 SQL viewer/editor. Read-only by default; a `catalog` prop enables schema-aware table/column autocomplete, and `onRun` binds Mod-Enter to execute. |
| `Toast.tsx` | Toast system (context + `useToast()` hook + fixed corner stack) with success/error variants and 3s auto-dismiss. |
| `ToolbarMenu.tsx` | Portal popup menu anchored to a trigger button; owns floating-surface positioning, roving keyboard focus over menu items, and several trigger-density variants. |
| `WorkbenchDocumentStrip.tsx` | Document tab strip for the central workbench (rename-in-place via double-click, close, overflow menu of all open documents). |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- This layer is distinct from `src/design-system/components/`: design-system
  owns visual/interaction *primitives* (Button, Modal, Tooltip, tree/tab
  mechanics), this directory owns small DopeDB-specific compositions built on
  top of them. Compose design-system primitives here rather than duplicating
  their class strings.
- `SqlViewer.tsx` and `WorkbenchDocumentStrip.tsx` are the two exceptions that
  import feature domain types (`features/connections/domain`,
  `features/workbench/domain`); keep new components decoupled from features
  unless the composition genuinely needs a feature-owned type.
- `Icon.tsx` is imported by `src/design-system/components/*` (e.g. `Agent.tsx`,
  `Status.tsx`, `Workbench.tsx`), so this directory is not a pure downstream
  consumer of the design system — avoid introducing a cycle back through a
  design-system import here.
- Static `tw:`-prefixed Tailwind utilities and semantic tokens only; no
  screen/component CSS, CSS modules, or `styles.ts` class-string objects (see
  `src/design-system/README.md`).

### Testing Requirements
- No test files exist directly under `src/components/` today. `pnpm test`
  (the fixed 208-test budget) and `pnpm build` (type-check) are the checks
  that exercise this code indirectly through its feature/screen consumers.

### Common Patterns
- One main export per file uses a default export (`EngineMark.tsx`,
  `InfoTip.tsx`, `RowEditor.tsx`); files with several related exports use
  named exports (`Icon.tsx` exports `Icon` plus `IconName`; `Toast.tsx`
  exports the provider and `useToast`).
- Files with meaningful behavior open with a short role comment (e.g.
  `RowEditor.tsx`, `SqlViewer.tsx`, `Skeleton.tsx`) per the 45-line-file
  convention in root `CLAUDE.md`.

## Dependencies

### Internal
- `src/design-system/components/` (Button, Tooltip, IdeTabs) for composition.
- `src/lib/i18n` for `useI18n`/`t()`; `src/lib/tableRef.ts` for `tableLabel`.
- `src/ipc/types.ts` for the `Engine` type (`EngineMark.tsx`).
- `src/assets/db-icons/` for engine logos.
- Consumed by `src/screens/*` and `src/features/*` throughout the app.

### External
- `@uiw/react-codemirror` (`SqlViewer.tsx`).
- `react-dom` `createPortal` (`ToolbarMenu.tsx`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
