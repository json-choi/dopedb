<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/lib/i18n

## Purpose
The localization system: statically bundled English/Korean message catalogs
(no async loading gap) plus the small React runtime that resolves the active
language and exposes `t()`. Every user-facing string in the app is a
`namespace.camelCaseKey` catalog entry looked up through `useI18n()` — there
is no dynamic key assembly at runtime, and English/Korean are always added
together.

## Key Files
| File | Description |
|------|-------------|
| `types.ts` | Shared `Lang`/`MessageCatalog` contracts and `defineCatalog`, which makes a missing, extra, or mismatched Korean key a compile-time TypeScript error rather than a runtime fallback. |
| `catalog.ts` | Composes every bounded catalog from `catalogs/` into one `messages` object via `composeCatalogs`, which throws at module load if a key length/name mismatch or an inter-catalog key collision is detected. |
| `runtime.tsx` | React context/provider and `useI18n()` hook: resolves the initial language from `localStorage` (`dopedb.lang`) or the browser's Korean locale hint (`resolveInitialLang`), and exposes `lang`, `setLang`, and `t(key, vars?)`. |
| `index.ts` | Barrel re-exporting `I18nProvider`/`useI18n` from `runtime.tsx` and the `I18nKey`/`Lang` types. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `catalogs/` | One file per bounded feature namespace (24 files), each calling `defineCatalog({ ...en }, { ...ko })` and exported into `catalog.ts`'s `catalogParts` array. See the table below; there is no separate `catalogs/AGENTS.md`. |

### `catalogs/` file reference
| File | Namespace(s) owned |
|------|--------------------|
| `activity.ts` | `activity.*` |
| `agents.ts` | `agent.*`, `agentTools.*` |
| `analysis.ts` | Analysis Article messages (one HTML document + one saved query contract). |
| `app.ts` | `app.*`, `common.*`, `language.*`, `settings.*`, `tabs.*` |
| `approval.ts` | `approval.*` |
| `cli.ts` | `cli.*` |
| `connections.ts` | `connections.*` |
| `documents.ts` | `documents.*` |
| `jobs.ts` | `jobs.*` |
| `knowledge.ts` | Project Knowledge messages. |
| `localHistory.ts` | `localHistory.*` |
| `onboarding.ts` | `onboarding.*` |
| `productAnalytics.ts` | `productAnalytics.*` |
| `providerProvisioning.ts` | `managedAccess.*` (managed-access provisioning flow; note the namespace does not match the filename). |
| `results.ts` | `grid.*`, `results.*` |
| `rowEditor.ts` | `rowEditor.*` |
| `safety.ts` | `safety.*` |
| `schema.ts` | `schema.*` |
| `schemaDiff.ts` | `schemaDiff.*` |
| `sql.ts` | `sql.*` |
| `tables.ts` | `tables.*` |
| `terminal.ts` | Advanced Shell Terminal messages (a bounded developer surface, separate from ACP). |
| `updates.ts` | `updates.*` |
| `workspace.ts` | `workspace.*` |

## For AI Agents

### Working In This Directory
- Add a new string via `defineCatalog`'s `en` object and its exact Korean
  counterpart in the same catalog file — TypeScript rejects a missing or
  extra Korean key at the `defineCatalog` call site.
- Use a stable `namespace.camelCaseKey`; a narrow, stable semantic
  subnamespace for a bounded family (feature/state/enum) is allowed, but the
  key must still be a static string passed to `t()` — never assemble a key
  from a runtime template string.
- A new feature catalog file must be added to `catalog.ts`'s `catalogParts`
  array or its keys are unreachable from `t()`.
- `composeCatalogs` fails fast (throws) on any inter-catalog key collision or
  `en`/`ko` key-set mismatch, so a broken catalog is caught at import time,
  not at render time.

### Testing Requirements
- No dedicated i18n test files exist today. `pnpm build`'s type-check
  enforces the `defineCatalog` en/ko parity constraint at compile time;
  `composeCatalogs`'s runtime checks run whenever the app or any test that
  imports `catalog.ts` boots.

### Common Patterns
- Every `catalogs/*.ts` file opens with a one-line comment naming the
  namespace(s) it owns (e.g. `agents.ts`: "agent, agentTools messages are
  owned by this bounded feature catalogue.").
- Catalog files are plain data modules with no React import; only
  `runtime.tsx` touches React.

## Dependencies

### Internal
- Consumed via `useI18n()` from `../index.ts` throughout `src/features/`,
  `src/screens/`, and `src/components/`.

### External
- None beyond `react` (`runtime.tsx`'s context/hook).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
