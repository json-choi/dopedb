<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# scripts/issue-review

## Purpose
Implements the local-Codex GitHub issue review worker described in
`docs/GITHUB_ISSUE_GOVERNANCE.md`: a repository-maintenance tool that reads the
real `main` codebase and Graphify graph on the maintainer's Mac, then posts one
evidence-backed advisory comment per issue. It never implements, closes, or
labels an issue, and it only queues issues authored by one of the two
owner GitHub author IDs for anything beyond a read-only comment.

## Key Files
| File | Description |
|------|-------------|
| `local-issue-review.mjs` | The worker: parses `--initialize` / `--once [--dry-run]` / `--issue <n>` / `--backfill <count>` / `--self-test` modes, stages an isolated Codex `HOME` per invocation, runs Codex twice (query-plan phase, then review phase) against a JSON schema, and posts/updates the single review comment via `gh`. |
| `policy.mjs` | Pure policy module: owns `OWNER_AUTHOR_IDS` (`77596321`, `231148561`), the `REVIEW_MARKER` HTML comment used to find/update the bot's own comment, verdict validation, and `renderReviewComment`, which renders the advisory comment differently depending on `isOwnerAuthored`. |
| `launch-agent.mjs` | Installs/checks/removes the macOS `launchd` LaunchAgent (`dev.dopedb.github-issue-review`) that runs `local-issue-review.mjs --once` on a 60-second interval. |
| `query-plan.schema.json` | JSON Schema for the first Codex call's structured output: bounded `query_tokens` (max 12) and `search_intent` used to scope the Graphify query. |
| `review.schema.json` | JSON Schema for the second Codex call's structured output: `verdict` (from a closed enum), `summary`, `findings`, `questions`, `recommendation`. |

## For AI Agents

### Working In This Directory
- Isolation boundary (verified in `local-issue-review.mjs`, function `invokeCodex` / `stageCodexAuthentication` / `codexEnvironment`): each Codex call gets a fresh `mkdtempSync`-created home with its own `XDG_CACHE_HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`CODEX_HOME`. Only `auth.json` is copied from the real `CODEX_HOME` into the isolated one, `chmodSync`'d to `0o600`; no other config, history, or memory file is exposed. The temporary home is `rmSync(..., { recursive: true, force: true })` in a `finally` block after every call, including on error.
- No shell/MCP/write/network: Codex runs with `--sandbox read-only`, `--ask-for-approval never`, `sandbox_permissions=[]`, `web_search="disabled"`, `tools.web_search=false`, `--ignore-user-config`, and an explicit `--disable` list covering MCP/browser/shell/search-adjacent tool features (see `codexArguments` in `local-issue-review.mjs`).
- Output is schema-validated only: Codex must emit JSON matching `query-plan.schema.json` then `review.schema.json`; the worker never executes anything Codex returns beyond rendering it into a markdown comment via `policy.mjs`'s `renderReviewComment`.
- `isOwnerAuthored` (checked against `OWNER_AUTHOR_IDS`, the immutable numeric GitHub author ID) gates whether an issue may ever be treated as more than a read-only external proposal; do not add a login-name or label-based bypass (see root `AGENTS.md` Issue execution gate).
- The worker never implements or closes an issue; it only creates/updates one marked comment (`REVIEW_MARKER`) per issue.

### Testing Requirements
- `pnpm check:issue-review` runs `local-issue-review.mjs --self-test`, which includes a self-test of the credential-isolation guarantee (stages a fake `auth.json` + `history.jsonl`, asserts only `auth.json` is copied and staged at mode `0600`, and asserts the temporary home is deleted afterward) and a policy self-test (`policy.mjs`'s `runPolicySelfTest`).
- `pnpm issue:review:one -- <issue>` and `pnpm issue:review:backfill -- <count>` support manual dry-run/live invocation; `pnpm issue:review:install` / `:status` / `:uninstall` manage the LaunchAgent.

### Common Patterns
- Every write to local state (`state.json`, temporary Codex output, staged `auth.json`) uses an explicit `0o600` mode; the worker treats the entire GitHub issue body/comments as untrusted input passed only inside the sandboxed Codex call.

## Dependencies

### Internal
- Reads the local `main` checkout and the Graphify graph (`graphify-out/`) for evidence; posts through the `gh` CLI using the user's local GitHub login.

### External
- The officially installed `codex` CLI (invoked as a read-only, tool-disabled subprocess); Node built-ins otherwise.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
