<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/design-system

## Purpose
The single source of truth for DopeDB's visual language: app chrome color,
typography, spacing, radius/elevation, scoped (non-chrome) palettes, the
Tailwind v4 theme bridge, and the canonical React UI primitive library. Every
app chrome, tool window, document tab, data editor, and status-bar surface is
built from the tokens and primitives here — screens must not invent their own
colors, screen-level CSS, or duplicated component class strings. Read
`README.md` in full before any TSX/CSS/Tailwind change anywhere in the app; it
is the authoritative UI contract referenced from root `CLAUDE.md`/`AGENTS.md`.

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Canonical UI/UX contract: ownership table per concern, Tailwind v4 rules, visual direction, color roles, typography, radius/elevation, and a component-by-component primitive registry. |
| `tokens.css` | Product-owned `--ds-*` core chrome tokens (surface/foreground pairs, typography, radius, shadow, status colors). Monochrome-first; color is reserved for focus and meaningful database state. |
| `scoped-palettes.css` | Non-chrome palettes with closed consumer boundaries (`--ds-terminal-*` ANSI theme for `resolvePtyTheme`, `--ds-syntax-*` for Agent code-fence highlighting) — never reused for navigation/selection/buttons. |
| `artifactPalettes.ts` | `ERD_EXPORT_PALETTE`: hard-coded colors for generated ERD export artifacts (SVG/PNG/PDF) that cannot resolve live CSS custom properties. |
| `index.css` | Tailwind v4 entry point: layers `theme, base, components, utilities`, imports Pretendard, Tailwind's theme/utilities with the `tw:` prefix, then `tokens.css`/`scoped-palettes.css`/`system.css`, and exposes only semantic tokens via `@theme inline`. Preflight is intentionally not imported. |
| `system.css` | Shared non-React UI classes (`.badge`, `.ds-panel`, `.ds-toolbar`, base reset) for surfaces that aren't React components. |
| `theme.ts` | Device-local `dopedb.theme` preference (`system`/`light`/`dark`) via `useSyncExternalStore`; resolves to a `ColorScheme` and reacts to OS `prefers-color-scheme` changes when set to `system`. |
| `floating.ts` | Shared Floating UI (`@floating-ui/react-dom`) middleware for every portalled surface (menus, tooltips, popovers): `autoUpdate`, `flip`, `shift`, `size`, `hide`, reading viewport gutter from CSS custom properties. |
| `dataGridGeometry.ts` | Canonical compact result-grid geometry constants (header/row height, row-number column width, default column width) shared by table and virtual grid renderers. |
| `agentSyntax.ts` | Fine-grained Shiki bridge for Agent code-fence output; the highlighter, regex engine, and grammars load lazily only once a completed fence needs highlighting, and colors resolve through the closed `--ds-syntax-*` palette. |
| `tabKeyboard.ts` | Roving-focus keyboard helpers (`tabFocusTargetIndex`, `moveTabFocus`, `moveHorizontalTabFocus`) shared by every tab-strip primitive. |
| `treeKeyboard.ts` | Roving-focus keyboard/virtualization helpers for tree rows, shared by `TreeControls.tsx` and `VirtualTreeRows.tsx`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `components/` | The canonical React primitive library (29 files): buttons, modals, menus, tabs, tool-window chrome, tree/data-grid mechanics, form controls, Agent surfaces, and brand marks (see `components/AGENTS.md`). |

## For AI Agents

### Working In This Directory
- Never add a raw hex/rgb color or a `tw:bg-[#...]`/`tw:text-[rgb(...)]`
  utility. If a component needs a new semantic role, define it as a
  surface/foreground pair in `tokens.css` first.
- Respect the scoped-palette consumer boundaries in `README.md`'s "범위별
  palette 소유권" table (core chrome / Agent syntax / terminal ANSI /
  provider-engine brand / ERD export artifact). `pnpm check:ui-palette`
  enforces these boundaries and rejects raw color in feature TSX/CSS.
- All Tailwind utilities use the `tw:` prefix (migration boundary against
  legacy semantic class names); utility strings must be static and visible in
  the TSX, never assembled at runtime or hidden in a `styles.ts`/style map.
- Do not add new screen-level CSS, CSS modules, or `styles.ts` files anywhere
  in the app — CSS here is reserved for tokens, the Tailwind bridge
  (`index.css`), documented vendor integration, and this directory's own
  primitives.
- `theme.ts`'s `useTheme` only reconfigures CodeMirror and updates xterm's
  theme option in place; it does not remount documents, sessions, or
  terminals on a theme change.
- This directory is not a leaf: `components/Agent.tsx`, `TreeControls.tsx`,
  `Status.tsx`, `Diagnostics.tsx`, `ToolWindow.tsx`, and `Workbench.tsx` all
  import `Icon` from the app-level `src/components/Icon.tsx` — that single
  upward dependency is intentional (see `../components/AGENTS.md`), do not
  duplicate the icon set here.

### Testing Requirements
- `pnpm check:ui-palette` and `pnpm check:ui-primitives` (both run as part of
  `pnpm build`) validate palette-boundary and primitive-usage rules.
- No `*.test.ts(x)` files exist under `src/design-system/` today; visual
  correctness is verified by running `pnpm dev:app` and checking the changed
  surface in both light and dark theme.

### Common Patterns
- Components own their own state-machine-free presentation and take
  `variant`/`density`/`tone`/`active` style props rather than raw class names
  — e.g. `Button.tsx`'s `variant`/`density`/`icon`/`tone`/`active` props, or
  `Status.tsx`'s `StatusTone`.
- Files with meaningful behavior open with a short role comment describing
  what the primitive owns vs. what the caller supplies (e.g. `ToolWindow.tsx`,
  `CommandMenu.tsx`, `ResizeSeparator.tsx`).

## Dependencies

### Internal
- `src/components/Icon.tsx` (see above) — the one sanctioned upward import.
- Consumed by nearly every file under `src/features/` and `src/screens/`
  (109 files import from `design-system/` at last count).

### External
- `@floating-ui/react-dom` (`floating.ts`, `Tooltip.tsx`, `CommandMenu.tsx`,
  `PopupMenu.tsx`).
- `tailwindcss` v4.3.3 pinned, via `@tailwindcss/vite` (see root
  `vite.config.ts`).
- `shiki` (`agentSyntax.ts`), `pretendard` npm package (`index.css`, the
  bundled variable font).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
