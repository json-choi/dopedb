<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-13 | Updated: 2026-09-13 -->

# workspace-cloud/lib/provider-import-postgres-harness

## Purpose
Scenario suite for the historical PostgreSQL control-plane path (`../../drizzle/schema.postgres.ts`),
run only against an independently provisioned, isolated test database — never production D1. It is
invoked through `../provider-import-postgres.harness.ts` and gated by
`scripts/provider-import-postgres-harness-guard.mjs`, which refuses to run unless a source-tree
safety check and an environment/database-target check both pass. No production URL or real secret
is used anywhere in this suite; fixtures and scenarios use only synthetic identities and
`randomUUID()`-generated data.

## Key Files
| File | Description |
|------|-------------|
| `analysis-lifecycle-scenarios.ts` | Verifies Analysis Article create/mutate/publish lifecycle against the isolated PostgreSQL fixture. |
| `analysis-member-removal-scenarios.ts` | Verifies Analysis Article/runner state after a member is removed from the workspace. |
| `article-sharing-scenarios.ts` | Verifies Analysis Article sharing/grant behavior built on the analysis-lifecycle and authority-provider scenario results. |
| `assertions.ts` | Shared scenario assertions, including `expectRfc3339Timestamp` for strict timestamp format checks. |
| `authority-provider-scenarios.ts` | Verifies provider-integration authority checks (session/member/role) against the isolated fixture. |
| `connection-versioning-scenarios.ts` | Verifies connection version create/mutate against `../workspace-versioning` and `../workspace-versioning-store` on PostgreSQL. |
| `credential-key-rotation-scenarios.ts` | Verifies lossless provider-credential-key rotation and rejection of writes sealed under an old deployment key; uses `../../drizzle/provider-credential-key-rotation`. |
| `fixture.ts` | Builds the isolated PostgreSQL harness fixture: a `drizzle-orm/postgres-js` client over `../../drizzle/schema.postgres`, cleanup targets, and shared test identities. |
| `personal-knowledge-scenarios.ts` | Verifies `../knowledge/personal-scope` account-backed Personal Workspace Knowledge behavior on PostgreSQL. |
| `provider-operation-scenarios.ts` | Verifies provider-operation plan/decide/execute against the isolated fixture, building on authority-provider scenarios. |
| `source-revision-scenarios.ts` | Verifies exact-commit webhook source-revision replay and ordering safety; graph construction is out of scope for this scenario. |
| `sync-scenarios.ts` | Verifies Knowledge source-sync event/job behavior against the isolated fixture. |
| `workspace-lifecycle-scenarios.ts` | Verifies workspace deletion scheduling/retention against the isolated fixture, using shared support assertions. |

## For AI Agents

### Working In This Directory
- Every scenario file takes a `ProviderImportPostgresHarness` fixture (from `fixture.ts`) as its first argument and uses `vitest`'s `expect`/`vi` directly; none declares its own `describe` block — composition happens in `../provider-import-postgres.harness.ts`.
- Never hardcode a real connection string, API key, or production identifier; use `randomUUID()` and the fixture's synthetic organization/user ids, matching every existing scenario.
- This suite must keep working against PostgreSQL specifically — it is the regression net for `../../drizzle/schema.postgres.ts` and `../../drizzle/provider-credential-key-rotation.ts`, which D1-only harnesses do not exercise.

### Testing Requirements
- `pnpm test:postgres-import` (`scripts/run-provider-import-postgres-harness.mjs`) runs this suite, but only after `validateHarnessSourceTree` and `validateHarnessEnvironment` (from `scripts/provider-import-postgres-harness-guard.mjs`) both pass.
- `pnpm test:postgres-harness-guard` (`node --test scripts/provider-import-postgres-harness-guard.node.mjs`) is the guard's own regression test.
- Requires an isolated, independently provisioned PostgreSQL test database; it is never pointed at production.

### Common Patterns
- Scenario functions return a typed result object (e.g. `AuthorityProviderScenarioResult`, `AnalysisLifecycleScenarioResult`) that later scenario functions accept as an input parameter, chaining state across the suite without global variables.

## Dependencies

### Internal
- `../workspace-versioning.ts`, `../workspace-versioning-store.ts`, `../knowledge/personal-scope.ts`, `../provider-credential-envelope.ts`, `../secret-envelope-core.ts`.
- `../../drizzle/schema.postgres.ts` and `../../drizzle/provider-credential-key-rotation.ts` (historical PostgreSQL-only tooling).

### External
- `drizzle-orm/postgres-js` and `postgres` for the isolated database client.
- `vitest` (`expect`, `vi`) for assertions and mocking.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
