<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# assets

## Purpose
Holds the single approved source of DopeDB's brand mark and the tooling
contract for regenerating every downstream projection (desktop icons, web
favicons, README image, OAuth logo) from it. Shape edits happen only here;
generated projections elsewhere are never hand-edited.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `brand/` | The approved source SVG and its generation/verification contract (`README.md`); holds `dopedb-icon.svg`, the single original the D-shape, ring angle, and satellite-dot proportions must be preserved from. |

## For AI Agents

### Working In This Directory
- Edit the brand shape only in `brand/dopedb-icon.svg`; never hand-edit a generated PNG/ICO/ICNS/React graphic listed in `brand/README.md`'s usage table.
- `pnpm icons` regenerates every projection from the SVG into a temporary directory before copying only changed outputs; `pnpm icons --check` verifies without changing the repository and is the CI-safe form.
- Regenerating icons here does not redeploy anything: installed apps, the public site, and third-party OAuth consoles need their own build/release/upload before a new mark is visible.
- Do not replace the historical screenshot assets under `site/public/dopedb-desktop-0.4.21*.png` or anything under `audits/`; they are dated records, not living brand assets.

### Testing Requirements
- `pnpm icons --check` (fails on missing or inconsistent generated output); requires macOS `iconutil`, Python 3 + Pillow, and the site's installed Sharp dependency (`pnpm --dir site install --frozen-lockfile`).

### Common Patterns
- Semantic `currentColor` is used for inline marks so they follow each screen's light/dark theme; each consuming app scopes its own `useId()`-based mask reference.

## Dependencies

### Internal
- Generates into `src/design-system/components/DopeDBMark`/`DopeDBMarkGraphic`, `site/app/DopeDBMark.tsx`, `site/public/`, `workspace-cloud/app/components/Brand`, `src-tauri/icons/`.

### External
- `scripts/generate-icons.py`; macOS `iconutil`; Python 3 + Pillow; Sharp (via the site's Next.js dependency).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
