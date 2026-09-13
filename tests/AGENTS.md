<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-14 -->

# tests

## Purpose
Holds the repository-wide critical-test-budget manifest and cross-project
test fixtures that don't belong inside a single crate or package. This is not
a general test directory — the actual frontend and Rust test files live next
to their source (see `src/`, `src-tauri/`, `dopedb-cli/tests/`,
`dopedb-protocol/tests/`); this directory only tracks and bounds them.

## Key Files
| File | Description |
|------|-------------|
| `critical-test-budget.json` | The manifest enforcing the repository's **hard 208-test budget**: `policy.totalCap: 208` split into `frontendCap: 80` (max 16 frontend test files) and `rustCap: 128` (max 26 Rust test files). Every counted file is listed with its exact `tests` count and a `protects` rationale string (≥12 characters) explaining the critical behavior it covers — a security/safety invariant, a public wire contract, or a core end-to-end journey, per root `AGENTS.md`. The separate `harness` section tracks the `*.harness.*` contract suites, which run under their own vitest configs **outside** that 208 budget (see below). |
| `fixtures/product-analytics-v1.json` | Shared golden fixture for the schema-v1 product-analytics event envelope; imported by `../product-analytics-cloudflare/src/index.harness.ts` as `golden` so the Cloudflare Worker's contract test and any Desktop-side producer stay aligned on one canonical example payload. |

## The `harness` section (outside the 208 budget)

The 208/80/128 caps count only suffix-discovered frontend tests and Rust
`#[test]` functions. A `*.harness.*` file is not discovered by that suffix rule:
it runs under a dedicated vitest config, often opt-in and environment-gated,
so its cases are **tracked but not charged** against the 208 budget. The
`harness` section exists so that scope is written down instead of invisible.

Each `*.harness.*` file in the repository — with no exceptions — must appear in
`harness` with a `protects` rationale and one of two roles:

| Role | Meaning | Required fields |
|------|---------|-----------------|
| `entry-point` | vitest executes this file directly; it declares `describe`/`it` cases. | `tests` (exact case count, ≥1) and `runner` (the vitest config whose `include` list names it) |
| `helper` | An assertion module with **zero** cases, imported by another harness file. | `tests: 0` and `importedBy` (the harness file that imports it) |

Current scope: 5 entry points carrying 14 cases, plus 16 helper modules.

Folding these cases into `frontendCap`/`totalCap` is a real alternative that
the repository owner has **not** decided (issue #198, option 2). Recording the
harness scope separately does not settle it; reversing it means raising the
caps, which needs an explicit owner request.

## For AI Agents

### Working In This Directory
- Do not raise `totalCap`, `frontendCap`, `frontendFileCap`, `rustCap`, or `rustFileCap` in `critical-test-budget.json` without an explicit user request — `scripts/check-critical-test-budget.mjs` fails the build if the manifest's `policy` values ever drift from the hard-coded caps (208/80/16/128/26) in that script.
- Adding a test means either: (a) it protects a security/safety invariant, public wire contract, or core end-to-end journey and you add/update its entry here with a real `protects` rationale, or (b) you replace an existing lower-value entry rather than growing the total. The checker fails if a discovered test file/count doesn't match this manifest exactly.
- Frontend test files are discovered by suffix (`.test`/`.spec`/`.node-test` before a `.js/.jsx/.ts/.tsx/.mjs/.cjs` extension); Rust test files are discovered by a `#[test]`-shaped attribute (including `#[rstest::test]`-style paths) inside any `.rs` file; harness files are discovered by a `.harness` suffix before the same JS/TS extensions. `describe/it/test.each|only|skip` usage is treated as hidden test expansion the checker also has to account for in all three — do not rely on dynamically generated test cases to stay under budget silently.
- Adding, removing, or renaming a `*.harness.*` file anywhere in the repository requires updating the `harness` section in the same change. The checker fails on any file that exists on disk but is unlisted, and names the offending path.
  - New **entry point**: add `role: "entry-point"`, the exact case count, the `runner` config path, and a `protects` rationale — and add the file to that config's `include` list, or the checker rejects the pair.
  - New **helper**: add `role: "helper"`, `tests: 0`, and the `importedBy` harness file that actually imports it. The checker verifies the import really exists, so an orphaned helper fails rather than rotting silently.
  - Changing a case count, converting a helper into an entry point, or dropping a file from a runner's `include` list all fail the check. Fix the manifest to match reality; do not soften the check.
- Do not move harness cases into `frontend` to "unify" the accounting. That raises the effective frontend total and needs the owner decision described above.

### Testing Requirements
- `pnpm check:test-budget` runs `node scripts/check-critical-test-budget.mjs`, which walks the whole repository (skipping `.git`, `node_modules`, `target`, `dist`, `.next`, `.open-next`, `.wrangler`, and similar build/tooling directories), counts every frontend/Rust/harness file and test case, and fails on any mismatch against `critical-test-budget.json`. Run this whenever a test or harness file is added, removed, or renamed anywhere in the repository.
- It prints two lines. The first is the 208 budget (`frontend … , Rust … , total …/208`); the second reports the harness suites separately (`harness 14/14 (budget 외 계약 검증, 208에 포함되지 않음): 5 entry points, 16 helper modules`). The harness line never changes the first line's totals.
- One shared counter serves both the frontend and harness sections, and it ignores member calls such as `/^[0-9a-f]{64}$/.test(value)` or `pattern.test(x)`. An assertion that happens to call `.test()` is never miscounted as a declared case, so a file is never pushed to a wrong number that the manifest then gets "corrected" to match. The Rust side is unaffected: it counts whole-line `#[test]`-shaped attributes, a form no method call can imitate.

### Common Patterns
- Every `frontend`/`rust` manifest entry pairs a repository-relative file path with `{ "tests": <int>, "protects": "<one-sentence rationale>" }` — see any entry in `critical-test-budget.json` for the shape to match when adding one.
- A `harness` entry uses the same path-keyed shape plus a `role` discriminator: `{ "role": "entry-point", "runner": "<vitest config>", "tests": <int>, "protects": "…" }` or `{ "role": "helper", "importedBy": "<harness file>", "tests": 0, "protects": "…" }`.

## Dependencies

### Internal
- Read by `../scripts/check-critical-test-budget.mjs`. `fixtures/product-analytics-v1.json` is read by `../product-analytics-cloudflare/src/index.harness.ts` (see `../product-analytics-cloudflare/AGENTS.md`).
- The `harness` section names four vitest configs it must stay consistent with: `../workspace-cloud/vitest.contracts.config.ts` (`pnpm --dir workspace-cloud test:contracts`, also reached by root `pnpm check:knowledge`), `../workspace-cloud/vitest.provider-harness.config.ts` (opt-in, launched only by `run-provider-import-postgres-harness.mjs` behind its isolation guard), `../product-analytics-cloudflare/vitest.config.ts` (`pnpm analytics:cloudflare:test`), and `../workspace-scheduler-cloudflare/vitest.config.ts` (`pnpm scheduler:cloudflare:test`).

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
