<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

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
| `critical-test-budget.json` | The manifest enforcing the repository's **hard 208-test budget**: `policy.totalCap: 208` split into `frontendCap: 80` (max 16 frontend test files) and `rustCap: 128` (max 26 Rust test files). Every counted file is listed with its exact `tests` count and a `protects` rationale string (≥12 characters) explaining the critical behavior it covers — a security/safety invariant, a public wire contract, or a core end-to-end journey, per root `AGENTS.md`. |
| `fixtures/product-analytics-v1.json` | Shared golden fixture for the schema-v1 product-analytics event envelope; imported by `../product-analytics-cloudflare/src/index.harness.ts` as `golden` so the Cloudflare Worker's contract test and any Desktop-side producer stay aligned on one canonical example payload. |

## For AI Agents

### Working In This Directory
- Do not raise `totalCap`, `frontendCap`, `frontendFileCap`, `rustCap`, or `rustFileCap` in `critical-test-budget.json` without an explicit user request — `scripts/check-critical-test-budget.mjs` fails the build if the manifest's `policy` values ever drift from the hard-coded caps (208/80/16/128/26) in that script.
- Adding a test means either: (a) it protects a security/safety invariant, public wire contract, or core end-to-end journey and you add/update its entry here with a real `protects` rationale, or (b) you replace an existing lower-value entry rather than growing the total. The checker fails if a discovered test file/count doesn't match this manifest exactly.
- Frontend test files are discovered by suffix (`.test`/`.spec`/`.node-test` before a `.js/.jsx/.ts/.tsx/.mjs/.cjs` extension); Rust test files are discovered by a `#[test]`-shaped attribute (including `#[rstest::test]`-style paths) inside any `.rs` file. `describe/it/test.each|only|skip` usage is treated as hidden test expansion the checker also has to account for — do not rely on dynamically generated test cases to stay under budget silently.

### Testing Requirements
- `pnpm check:test-budget` runs `node scripts/check-critical-test-budget.mjs`, which walks the whole repository (skipping `.git`, `node_modules`, `target`, `dist`, `.next`, `.open-next`, `.wrangler`, and similar build/tooling directories), counts every frontend/Rust test file and test case, and fails on any mismatch against `critical-test-budget.json`. Run this whenever a test file is added, removed, or renamed anywhere in the repository.

### Common Patterns
- Every manifest entry pairs a repository-relative file path with `{ "tests": <int>, "protects": "<one-sentence rationale>" }` — see any entry in `critical-test-budget.json` for the shape to match when adding one.

## Dependencies

### Internal
- Read by `../scripts/check-critical-test-budget.mjs`. `fixtures/product-analytics-v1.json` is read by `../product-analytics-cloudflare/src/index.harness.ts` (see `../product-analytics-cloudflare/AGENTS.md`).

### External
- None.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
