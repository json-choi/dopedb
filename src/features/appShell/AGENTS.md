<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/features/appShell

## Purpose

Composes the whole desktop workbench shell: top chrome, resizable panel
layout, workspace/connection navigation, the Agent dock, tool-window layout,
and responsive (mobile-width) behavior. Per `AppShell.tsx`'s own header
comment, it *composes* other features' controllers (Action Search, Background
Tasks, Agent, Article link gate, onboarding, Query Services, Skills) rather
than owning their domain logic itself.

## Key Files

| File | Description |
|------|-------------|
| `AppShell.tsx` | Default-exported `App()` root: wires `ToastProvider`, Action Search, Background Tasks, Agent readiness warmup, the Article link gate, guided-demo commands, Query Services, and the Skill startup gate together. |
| `ConnectionPicker.tsx` | Default-exported connection-switcher dropdown, grouped via `buildConnectionSections`. |
| `IdeChrome.tsx` | `IdeTopBar`/`IdeStatusBar` — the single quiet title toolbar; its header comment notes macOS owns the native File/Edit/View menus, so the WebView must not draw a second application menu. |
| `ShellLayout.tsx` | Default-exported layout positioning the left Explorer, central documents, Agent dock, and persistent status bar, with a resizable separator. |
| `WorkbenchContent.tsx` | Default-exported central document router; per its header comment, content surfaces keep their own state/commands and this file only routes between them (lazy-loaded via `Suspense`). |
| `WorkspaceNavigation.tsx` | Main destination nav; per its header comment, reuses the Explorer's exact environment commands rather than a separate navigation model. |
| `navigationHooks.ts` | `preloadSqlEditor`, `useSqlEditorPreload`, `usePersistentSelectedConnection`, `useActivitySeen`. |
| `navigationState.ts` | `AppShellRoute`/`AppShellMode`/`appShellNavigationReducer`; per its header comment, the shell's central surface has exactly one route owner (Settings is a modal mode with an explicit background route, not a parallel flag). |
| `useAgentDock.ts` | Persisted Agent dock open/width state (`localStorage` keys `agentDockOpen`, `agentDockWidth`), built on `agents/layout.ts`'s clamping helpers. |
| `useAppShellWorkbenchController.ts` | The shell's main workbench controller: connection selection, document routing state, and catalog/driver queries feeding `WorkbenchContent`. |
| `useConnectionProfiles.ts` | Connection list query plus `changedConnectionRuntimeIds`, which fingerprints a profile's runtime-relevant fields (engine/provider/driver/host/port/database) to detect changes needing a reconnect. |
| `useConnectionProjectNames.ts` | Picker-only Project binding name lookup, kept out of the `AppShell` composition root per its header comment. |
| `useInertShellBackground.ts` | Sets `element.inert` on non-Agent-surface shell children while a modal/overlay is open, for focus containment. |
| `useOperationNudge.ts` | Watches the latest operation id and fires a toast notification once per new terminal operation while the operations terminal isn't visible. |
| `useResponsiveShell.ts` | Viewport-width tracking, compact-mode (≤560px) detection, and mobile Explorer open/dismiss state. |
| `useSafetySettings.ts` | Thin `useQuery`/invalidate wrapper over `safetySettings/queries.ts`'s `safetySettingsQuery`. |
| `useSidebarWidth.ts` | Persisted, viewport-ratio-clamped width for the Database Explorer and Local History sidebars (`sidebarW`, `localHistorySidebarW` storage keys). |
| `useToolWindowLayout.ts` | Persisted left-panel (`databaseExplorer` \| `localHistory`) selection and visibility; per its header comment, Local History is a temporary Explorer view and leaving it restores normal navigation. |

## For AI Agents

### Working In This Directory

- `AppShell.tsx` and `ShellLayout.tsx`/`WorkbenchContent.tsx` are composition
  roots: new cross-feature wiring belongs here, but feature-specific state
  (Agent sessions, Jobs, Knowledge, etc.) must stay owned by that feature and
  only be *composed* in this directory.
- `navigationState.ts`'s single-route-owner design (`AppShellRoute`) must not
  be bypassed with a second, independent "is X open" boolean for a new modal
  surface — extend `AppShellMode`/`AppShellRoute` instead.
- `IdeChrome.tsx` must not draw a second application menu on macOS (native
  File/Edit/View menus already exist) — this is a verified constraint, not a
  style preference.

### Testing Requirements

- No test file in this directory; not part of `pnpm test` or the 208-test
  budget. UI/layout changes need a manual `pnpm dev:app` check, including at
  narrow (mobile) width per `useResponsiveShell.ts`.

### Common Patterns

- Persisted UI geometry (`useAgentDock.ts`, `useSidebarWidth.ts`,
  `useToolWindowLayout.ts`) reads/writes `localStorage` directly with a
  versioned or plain key and a clamp/normalize helper, rather than going
  through TanStack Query.

## Dependencies

### Internal

- Composes almost every other feature: `actionSearch`, `agents`,
  `analysisArticles`, `backgroundTasks`, `catalogExplorer`, `connections`,
  `knowledge`, `onboarding`, `queries`, `queryServices`, `safetySettings`,
  `settings`, `skills`, `workbench`.
- `src/screens/Connections` (`DatabaseExplorer`), `src/screens/Onboarding`.
- `src/lib/{schemaDiff,tableRef,capabilities,queryClient,i18n}.ts`.
- No feature-owned Rust transport (`appShell` has no
  `src-tauri/src/features/app_shell/`); it composes commands owned by the
  features it wires together.

### External

- `@tanstack/react-query` (`useQuery`, `useQueryClient`).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
