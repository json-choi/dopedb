<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/design-system/components

## Purpose
The canonical React UI primitive library referenced throughout
`src/design-system/README.md`. Each file owns one repeated visual/interaction
contract (geometry, keyboard behavior, ARIA) so screens and features compose
these primitives with semantic props instead of copying Tailwind class lists
or rebuilding behavior like focus trapping, roving tab index, or floating
positioning.

## Key Files
| File | Description |
|------|-------------|
| `Agent.tsx` | Canonical observation/approval card primitives for ACP-driven Agent work (protocol adapters supply state/actions; this owns card geometry and status treatment). |
| `AgentRichText.tsx` | Canonical ACP message renderer: streams incomplete text as plain text and isolates completed rich output behind bounded Markdown with a visible plain-text fallback; never renders remote images or raw HTML. |
| `AnalysisArticleBody.tsx` | Shared presentation of server-sanitized Analysis Article HTML, used by both Desktop and Workspace Web; takes a DOM `bodyRef` instead of using React internally so the Workspace build doesn't need Desktop's React install. |
| `AppChrome.tsx` | Canonical application chrome surfaces (title/status bar geometry) shared across the shell. |
| `Button.tsx` | Canonical Tailwind button primitive: variant, density, icon geometry, tone, and active/expanded state as semantic props instead of class maps; supports a `menuItem` presentation for full-width popup actions. |
| `CommandMenu.tsx` | Canonical searchable command popup (floating surface, search input, grouped/dense result rows) used by Action Search and "새 연결" provider selection. |
| `DataGridViewport.tsx` | Canonical scroll surface shared by table and virtual data-grid renderers; caller picks `panel`/`workbench`/`embedded` sizing, never restyles the viewport itself. |
| `Diagnostics.tsx` | Shared compact problems/diagnostics list for settings and property editors, with `warning`/`danger` tone. |
| `DopeDBMark.tsx` | Thin wrapper around `DopeDBMarkGraphic` that supplies a unique `useId()` per instance to avoid SVG mask collisions. |
| `DopeDBMarkGraphic.tsx` | Generated (by `pnpm icons`, do not hand-edit) hook-free brand mark SVG shared by Desktop, `site/`, and Workspace. |
| `EnvironmentBadge.tsx` | Neutral uppercase dev/staging/prod label with a small semantic-color dot; used only on DB connection rows in Explorer. |
| `FormControls.tsx` | Canonical Tailwind form controls (`Field`, `TextInput`, `TextAreaInput`, `SelectInput`, `InlineSelect`, `CheckboxField`) that own label/focus/disabled state at dense desktop sizing. |
| `IconRailTabs.tsx` | Canonical 42px vertical icon-only category rail for dense dialogs, with tooltip parity and roving keyboard focus. |
| `IdeTabs.tsx` | Flat IDE tab-strip primitives (`IdeTab`, `IdeTabStrip`) where the active tab sits inside the strip rather than filling a whole rectangle. |
| `Modal.tsx` | Canonical modal backdrop/dialog frame: viewport placement, elevation, responsive bounds, focus containment, and background-interaction blocking (`ModalBackdrop`, `ModalSurface`, `ModalHeader`, `ModalFooter`, `ModalDetailActionBar`). |
| `PanelTabs.tsx` | Dense ARIA tabs for settings/property panels; horizontally scrollable, auto-exposes the active tab, roving keyboard focus skips disabled tabs. |
| `PopupMenu.tsx` | Canonical flat popup-menu surface and command/checkbox row items (`PopupMenu`, `PopupMenuItem`, `PopupMenuCheckbox`), sharing the `floating.ts` positioning hook. |
| `Progress.tsx` | `ProgressBar` determinate/indeterminate progress primitive (`default`/`compact` density) for downloads, query work, and export. |
| `RenderRecoveryBoundary.tsx` | Error boundary isolating render failures of optional rich surfaces (Markdown, diagrams, provider payloads); shows only a safe caller-provided fallback and retry, never the raw error. |
| `ResizeSeparator.tsx` | Canonical keyboard/pointer resize boundary with ARIA `now`/`min`/`max`, bounded arrow-key steps, Home/End, and double-click reset; caller keeps persisted size and drag lifecycle. |
| `SegmentedControl.tsx` | Compact mutually-exclusive radiogroup for property editors; owns disabling whole/individual options and keyboard focus that skips them. |
| `Settings.tsx` | `SettingsGroup`: flat divider/heading rhythm for dense preference groups, no nested card surfaces. |
| `SettingsList.tsx` | Dense settings inventory rows (`SettingsSectionHeader` and related row primitives) sharing one identity/state/action grid. |
| `Status.tsx` | Small semantic status primitives (`neutral`/`success`/`warning`/`danger` tone); color always communicates state, never navigation selection. |
| `ToolWindow.tsx` | Canonical dense tool-window primitives (header, body, sections) shared by Explorer, Agent, and provider panels. |
| `Tooltip.tsx` | Canonical portal tooltip for icon-only commands: delayed hover/focus, viewport-safe flip via `floating.ts`, Escape dismissal. |
| `TreeControls.tsx` | Dense tree controls (search chrome, keyboard toggling) shared by Explorer-style tool windows. |
| `VirtualTreeRows.tsx` | Virtualized tree row renderer using TanStack React Virtual for large object trees; owns row windowing only, not color/spacing. |
| `Workbench.tsx` | Canonical workbench primitives (`WorkbenchPane` and related exports) for the flat IDE spacing shared by editor, data, and result panes. |

## Subdirectories
None.

## For AI Agents

### Working In This Directory
- Each primitive owns one repeated contract; do not add a second component
  that re-implements the same visual/interaction pattern (e.g. another
  button-like element instead of extending `Button.tsx`'s `variant`/`tone`
  props). Search this directory before adding a new file.
- Several primitives here import `Icon`/`IconName` from the app-level
  `src/components/Icon.tsx` (`Agent.tsx`, `Diagnostics.tsx`, `Status.tsx`,
  `ToolWindow.tsx`, `TreeControls.tsx`, `Workbench.tsx`) — this is the one
  sanctioned upward dependency out of `design-system/`; do not introduce
  others back into `src/features/` or `src/screens/`.
- Portal/floating surfaces (`Tooltip.tsx`, `CommandMenu.tsx`, `PopupMenu.tsx`,
  `IconRailTabs.tsx`) should reuse `../floating.ts`'s
  `useAnchoredFloatingSurface`/middleware rather than hand-rolling
  positioning.
- Keyboard roving-focus behavior for tabs and trees comes from
  `../tabKeyboard.ts` and `../treeKeyboard.ts` respectively; reuse those
  helpers instead of re-deriving arrow-key index math per component.

### Testing Requirements
- No `*.test.ts(x)` files exist under this directory today. `pnpm build`
  type-checks every primitive and its exported prop types; `pnpm
  check:ui-primitives` (part of `pnpm build`) validates primitive-usage rules
  against the rest of the app.

### Common Patterns
- A short header comment states what the primitive owns vs. what the caller
  supplies (e.g. `ResizeSeparator.tsx`: "Feature owners keep the persisted
  dimension and pointer drag lifecycle; this primitive owns ARIA...").
- Semantic data-contract props (`variant`, `density`, `tone`, `active`) are
  preferred over conditional class-string assembly; see `Button.tsx` and
  `Status.tsx`.

## Dependencies

### Internal
- `../floating.ts`, `../tabKeyboard.ts`, `../treeKeyboard.ts` within
  `design-system/`.
- `src/components/Icon.tsx` (see above).
- Consumed by nearly every screen/feature in the app.

### External
- `@tanstack/react-virtual` (`VirtualTreeRows.tsx`).
- `react-dom`'s `createPortal` (used by portal surfaces such as `Modal.tsx`,
  `PopupMenu.tsx`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
