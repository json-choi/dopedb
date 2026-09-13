<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# src/assets

## Purpose
Bundled local image assets consumed as static imports (never hotlinked at
runtime) by a small, closed set of UI primitives: Agent provider marks and
database engine logos.

## Key Files
None directly in this directory; every asset lives in one of the two
subdirectories below.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `agent-icons/` | Official third-party Agent provider marks. `README.md` — attribution table (file, official source, version, retrieval date: September 5, 2026) for the two icons below; required reading before adding/replacing a provider mark. `claude.svg` — Anthropic press-kit Claude Spark mark. `codex.svg` — OpenAI's Codex VS Code extension Blossom mark. Both are unchanged in path/proportion/color, transparent, with no background tile. |
| `db-icons/` | Local database engine logo SVGs: `mongodb.svg`, `mysql.svg`, `postgresql.svg`, `sqlite.svg`. |

## For AI Agents

### Working In This Directory
- `agent-icons/*.svg` carry marks owned by their respective providers; keep
  `agent-icons/README.md`'s source/version/retrieval-date table current if an
  icon is ever replaced, and do not alter path, proportion, or color per its
  documented terms.
- `db-icons/` covers `postgres`/`mysql`/`sqlite`/`mongodb` only —
  `bigquery`'s mark comes from Iconify's Simple Icons package instead (see
  `src/components/EngineMark.tsx`), not from this directory.
- Renaming or removing a file here requires updating its consumer:
  `agent-icons/` is imported by
  `src/design-system/components/Agent.tsx`; `db-icons/` is imported by
  `src/components/EngineMark.tsx`.
- Per root `CLAUDE.md`, this directory must not contain comparison/competitor
  product assets or any asset sourced from a contributor's personal/employer
  identity.

### Testing Requirements
- No tests apply; `pnpm build` catches a broken import path if a file is
  moved or renamed without updating its consumer.

### Common Patterns
- Every SVG here is imported directly as a module (e.g. `import claudeIcon
  from "../../assets/agent-icons/claude.svg"`) and rendered as an `<img>` or
  inline element by its consumer component — this directory holds no code.

## Dependencies

### Internal
- Consumed by `src/design-system/components/Agent.tsx` (`agent-icons/`) and
  `src/components/EngineMark.tsx` (`db-icons/`).

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
