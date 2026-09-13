<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# skills

## Purpose
Markdown guidance served to Agents (built-in ACP sessions and the public
`dopedb` CLI), not to end users directly. Two independent skills live here
with different distribution paths: `dopedb-analysis-article` is compiled
straight into the `dopedb-agent-bridge` binary via `include_str!` and served
as one in-session MCP tool result, while `dopedb-cli` is versioned, hashed,
and shipped as a discoverable skill bundle for use outside an existing Agent
session.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `dopedb-analysis-article/` | Analysis Article authoring guide, documented inline below. |
| `dopedb-cli/` | Direct-CLI setup and safety guide plus its references, documented inline below (covers `dopedb-cli/references/`). |

### `dopedb-analysis-article/` (inline)
| File | Description |
|------|-------------|
| `SKILL.md` | Guides an Agent to create or edit a visual Analysis Article: sanitized HTML plus the existing Article's one saved read-only query. States that other authoring skills may help produce content, but a local file or chat render does not save an Article. Embedded directly into `dopedb-cli/src/agent_mcp_dispatch.rs` (`TOOL_ANALYSIS_ARTICLE_GUIDE`) and returned verbatim as an MCP tool result — it is not run through `scripts/generate-skill-bundle.mjs` and has no version/manifest of its own. |

### `dopedb-cli/` (inline, covers `dopedb-cli/references/`)
| File | Description |
|------|-------------|
| `SKILL.md` | Entry guide for direct CLI use outside an existing DopeDB Agent session. States the CLI only talks to the running Desktop runtime and never reads credentials, opens a driver, or approves its own mutation; tells an in-session Agent to prefer the supplied typed MCP tools instead. Embedded into the `dopedb-cli` binary via `include_str!` (`commands/skills.rs`) and separately packaged as the discoverable skill bundle described below. |
| `references/safety.md` | The DopeDB trust-boundary contract: Desktop owns credentials, drivers, authorization, policy, monitoring, execution, and audit; the CLI is a typed local adapter only. |
| `references/queries.md` | Query workflow reference; explicitly tells an in-session Agent to prefer typed MCP tools (`environment_context`, `catalog_search`, `query_read`) over the raw CLI commands below it, since the Project resource set is already pinned. |
| `references/operations.md` | How to propose a single-statement SQL mutation through stdin and read back its receipt. |
| `references/documents.md` | MongoDB document reads via `dopedb document run`, distinct from the SQL query path. |
| `references/analyses.md` | Analysis Article workflow from the CLI/Agent-bridge side: the HTML is the document, the saved query can be manually rerun later. |

## For AI Agents

### Working In This Directory
- `dopedb-cli/SKILL.md` and every file under `dopedb-cli/references/` are embedded at Rust compile time (`include_str!` in `dopedb-cli/src/commands/skills.rs`) *and* packaged separately by `scripts/generate-skill-bundle.mjs`. Renaming, moving, or restructuring any of these files breaks both the CLI build and the skill bundle — update both consumers in the same change.
- `dopedb-analysis-article/SKILL.md` has only one consumer (`dopedb-cli/src/agent_mcp_dispatch.rs`'s `TOOL_ANALYSIS_ARTICLE_GUIDE`); it is not part of the versioned bundle pipeline, so it needs no manifest/hash update, only a binary rebuild.
- Keep this Markdown factual and free of comparison-product names or personal names, matching root `CLAUDE.md`'s neutral-namespace rule — it is served directly to Agent sessions and CLI users.

### Testing Requirements
- `pnpm check:skills` runs `node scripts/generate-skill-bundle.mjs --check` — verifies the packaged `dopedb-cli` skill bundle (content hash and discovery stub) is in sync with the source files here. Part of the root `pnpm build` chain.
- `pnpm generate:skills` runs the same script without `--check` to regenerate the bundle after an intentional content change.
- The generated bundle is emitted to `src-tauri/resources/skills/` (`current-manifest.json`, `snapshot-registry.json`, `release-mapping.json`) — generated output, not edited by hand, and out of scope for this directory's `AGENTS.md` per the deepinit skip rule for generated resources.

### Common Patterns
- `dopedb-cli/SKILL.md` starts with a `---`-fenced discovery stub (`name`, `description`) matching the format `scripts/generate-skill-bundle.mjs` also synthesizes for its own discovery-stub check; keep new skill front matter in that same two-field shape.

## Dependencies

### Internal
- Consumed by `../dopedb-cli/src/commands/skills.rs` (`dopedb skills get/list`) and `../dopedb-cli/src/agent_mcp_dispatch.rs` (in-session MCP tool results); packaged by `../scripts/generate-skill-bundle.mjs` into `../src-tauri/resources/skills/`.

### External
- None (plain Markdown; no external package dependency).

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
