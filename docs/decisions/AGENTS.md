<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-17 | Updated: 2026-09-17 -->

# docs/decisions

## Purpose
Evidence reports for open repository-owner decisions. A file here gathers the
measured facts, the options, and the exact question the owner has to answer; it
does **not** decide, and it is not a decision record. Once the owner decides,
the outcome belongs in the document that owns that topic (`../adr/` for a
structural decision, `../PRODUCT_UI_SCOPE.md` for feature scope,
`../../tests/critical-test-budget.json` for test policy), and the report here
stays only as the evidence that supported it.

## Key Files
| File | Description |
|------|-------------|
| `0001-postgresql-provider-import-harness.md` | Per-scenario-group evidence for issue #216: what the PostgreSQL provider-import harness still protects, which groups fail or cannot run, which D1 harnesses already cover the same modules, and the re-measured porting cost. |
| `0002-harness-test-budget-policy.md` | Evidence for issue #198: declared count, actual CI execution, and caps reported separately for the `*.harness.*` contract suites, plus what folding them into the 208 budget would require. |
| `0003-provider-import-journey-ci-path.md` | Evidence for issue #199: what the existing `test:postgres-harness-guard` step does and does not prove, the two distinct PostgreSQL server floors, and a conditional CI plan for each #216 outcome. |

## For AI Agents

### Working In This Directory
- Separate measured evidence from inference explicitly. Quote the command and its real output; never restate an issue body's historical number as a current fact.
- Do not implement the decision a report describes. These reports exist because the repository owner has not decided; `미결` items are not started.
- End every report with the exact question the owner must answer, and keep any recommendation in its own section with its reasoning.
- Do not raise caps, change checker discovery patterns, or delete suites, migrations, fixtures, or dependencies while writing a report.

### Testing Requirements
- Documentation-only; a diff and link review is enough (see root `AGENTS.md` Validation section).

### Common Patterns
- Header states status, the related issue, the date, and the measurement environment before any finding.
- `[측정]` marks a value produced by a command run for that report; `[추정]` marks a value derived from reading source or configuration.

## Dependencies

### Internal
- References `../../tests/critical-test-budget.json`, `../../scripts/check-critical-test-budget.mjs`, `../../.github/workflows/ci.yml`, and the `workspace-cloud` harness sources these reports measure.

### External
- None; these are markdown documents with no runtime dependency.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
