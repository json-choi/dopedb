<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# .release-notes

## Purpose
Owns the user-facing release-notes contract: small, append-only, schema-validated
JSON fragments assembled deterministically into a stable release body, with no
external AI API call in the generation path. Currently in `prepared` mode
(pre-MVP): the generator, schema, and examples stay executable, but no real
fragments are required or accumulated yet. See root `AGENTS.md` for the
activation rule (post-MVP, explicit user decision only).

## Key Files
| File | Description |
|------|-------------|
| `README.md` | Owns the fragment-writing rules, current `prepared`-mode status, and the post-MVP activation checklist. |
| `config.json` | Declares `schemaVersion: 1`, current `mode: "prepared"`, the target repository, default locale (`ko`), fragment/example directories, and `maxHighlights: 3`. |
| `fragment.schema.json` | JSON Schema a fragment must satisfy: `type` (feature/improvement/fix/security/breaking), `area`, `audience` (user/admin/developer/internal), bounded `title`/`summary`/`details`, `issues`, and `highlight`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `examples/` | Reference fragments (e.g. `22.workspace-fix.json`, `95.agent-improvement.json`) kept valid against the schema so the generator/validator stay exercised while `mode` is `prepared`. |
| `fragments/` | Where real, append-only fragments will live once `mode` becomes `active`; currently holds only a `.gitkeep`. |

## For AI Agents

### Working In This Directory
- Do not switch `config.json`'s `mode` to `active` without an explicit post-MVP user decision (root `AGENTS.md`).
- While `mode` is `prepared`, do not add real files under `fragments/`; add or adjust `examples/` instead if the format needs exercising.
- Once active, a fragment is append-only: never edit, delete, or rename a fragment that has shipped in a release.
- A fragment's `title`/`summary` must describe the user-visible outcome, not the implementation; commit hashes and issue numbers are evidence, not the explanation.

### Testing Requirements
- `pnpm check:release-notes` validates config, schema, and current fragments/examples. `pnpm release:notes:preview` renders the example set as a release body without writing anything.

### Common Patterns
- Every fragment references `../fragment.schema.json` via its own `$schema` field and sets `schemaVersion: 1`.

## Dependencies

### Internal
- Read by `scripts/release/generate-release-notes.mjs`; invoked from `.github/workflows/release.yml` during stable release finalization.

### External
- None; no third-party AI or summarization service is called.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
