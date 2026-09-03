import { describe, it, vi } from "vitest";

import {
  assertProviderSecretIsNotDurable,
  runProviderImportSupportAssertions,
} from "./provider-import-postgres-harness/assertions";
import { runAnalysisLifecycleScenarios } from "./provider-import-postgres-harness/analysis-lifecycle-scenarios";
import { runAnalysisMemberRemovalScenarios } from "./provider-import-postgres-harness/analysis-member-removal-scenarios";
import { runAuthorityProviderScenarios } from "./provider-import-postgres-harness/authority-provider-scenarios";
import { runConnectionVersioningScenarios } from "./provider-import-postgres-harness/connection-versioning-scenarios";
import { runPersonalKnowledgeScenarios } from "./provider-import-postgres-harness/personal-knowledge-scenarios";
import {
  openProviderImportPostgresHarness,
  seedProviderImportPostgresHarness,
} from "./provider-import-postgres-harness/fixture";
import { runProviderOperationScenarios } from "./provider-import-postgres-harness/provider-operation-scenarios";
import { runSourceRevisionScenarios } from "./provider-import-postgres-harness/source-revision-scenarios";
import { runSyncScenarios } from "./provider-import-postgres-harness/sync-scenarios";
import { runWorkspaceLifecycleScenarios } from "./provider-import-postgres-harness/workspace-lifecycle-scenarios";

vi.mock("server-only", () => ({}));

const dedicatedDatabaseUrl =
  process.env.PROVIDER_IMPORT_TEST_DATABASE_URL?.trim() ?? "";
const dedicatedDatabaseSentinel =
  process.env.PROVIDER_IMPORT_TEST_DATABASE_SENTINEL?.trim() ?? "";
const requested =
  process.env.WORKSPACE_CLOUD_RUN_POSTGRES_IMPORT_HARNESS === "1";
const enabled = requested
  && process.env.PROVIDER_IMPORT_TEST_DATABASE_ISOLATED === "1"
  && dedicatedDatabaseUrl.length > 0
  && dedicatedDatabaseSentinel.length >= 16;

if (requested && !enabled) {
  throw new Error(
    "PostgreSQL harness requires an explicitly confirmed dedicated test database",
  );
}

describe.runIf(enabled)("provider import PostgreSQL concurrency harness", () => {
  it("imports once, replays exactly, and rejects stale authority without leaking credentials", async () => {
    const database = await openProviderImportPostgresHarness(
      dedicatedDatabaseUrl,
      dedicatedDatabaseSentinel,
    );

    try {
      const support = await runProviderImportSupportAssertions();
      const fixture = await seedProviderImportPostgresHarness(database);
      await runPersonalKnowledgeScenarios(fixture);
      await runSourceRevisionScenarios(fixture);
      const provider = await runAuthorityProviderScenarios(fixture);
      const analysis = await runAnalysisLifecycleScenarios(fixture, provider);

      await runAnalysisMemberRemovalScenarios(fixture, provider, analysis);
      await runSyncScenarios(fixture, provider);
      await runProviderOperationScenarios(fixture, provider);
      await runConnectionVersioningScenarios(fixture);
      await runWorkspaceLifecycleScenarios(fixture, support);
      await assertProviderSecretIsNotDurable(fixture);
    } finally {
      await database.cleanup();
    }
  }, 60_000);
});
