import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import type { AnalysisLifecycleScenarioResult } from "./analysis-lifecycle-scenarios";
import type { AuthorityProviderScenarioResult } from "./authority-provider-scenarios";
import type { ProviderImportPostgresHarness } from "./fixture";

export async function runAnalysisMemberRemovalScenarios(
  fixture: ProviderImportPostgresHarness,
  provider: AuthorityProviderScenarioResult,
  analysis: AnalysisLifecycleScenarioResult,
) {
  const {
    authority,
    organizationId,
    removableMemberId,
    removableUserId,
    sql,
    suffix,
  } = fixture;
  const { imported } = provider;
  const { articleId, revisedArticle, runnerStore, versioning } = analysis;
  const runnerId = randomUUID();
  const activeRunId = randomUUID();
  const historicalRunId = randomUUID();
  const claimId = randomUUID();
  const publicationId = randomUUID();
  const capability = await import("../workspace-analysis-runner-capability");
  const runnerCapabilityHash = capability.hashAnalysisRunnerCapability("a".repeat(64));
  const publicationSnapshot = {
    version: 1,
    title: "Historical member attribution",
    description: "Immutable publication evidence",
    html: "<p>Published result</p>",
  };

  await sql.begin(async (tx) => {
    await tx`
      UPDATE "workspace_control"."member"
      SET "revocation_pending_at" = now(),
          "revocation_claimed_at" = now(),
          "revocation_claim_id" = ${claimId}::uuid
      WHERE "id" = ${removableMemberId}
        AND "organization_id" = ${organizationId}
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_analysis_runner"
        ("id", "organization_id", "member_id", "device_id", "display_name",
         "runner_capability_hash", "runner_capability_generation", "background_allowed")
      VALUES (${runnerId}::uuid, ${organizationId}, ${removableMemberId},
              ${`removable-runner-${suffix}`}, 'Removable foreground runner',
              ${runnerCapabilityHash}, 1, FALSE)
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_analysis_article_run"
        ("id", "organization_id", "article_id", "article_revision", "runner_id",
         "runner_capability_generation", "lease_id", "requested_by_member_id", "trigger",
         "state", "parameter_values", "parameter_hash", "definition_hash", "started_at",
         "finished_at")
      VALUES (${activeRunId}::uuid, ${organizationId}, ${articleId}::uuid, 2,
              ${runnerId}::uuid, 1, NULL, ${removableMemberId}, 'manual', 'running',
              '{}'::jsonb, ${versioning.canonicalHash({})},
              ${versioning.canonicalHash(revisedArticle.definition)}, now(), NULL),
             (${historicalRunId}::uuid, ${organizationId}, ${articleId}::uuid, 2,
              ${runnerId}::uuid, 1, NULL, ${removableMemberId}, 'manual', 'succeeded',
              '{}'::jsonb, ${versioning.canonicalHash({})},
              ${versioning.canonicalHash(revisedArticle.definition)}, now(), now())
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_analysis_article_query_receipt"
        ("organization_id", "run_id", "query_node_id", "connection_id",
         "connection_revision", "query_run_id", "query_hash", "schema_fingerprint",
         "state", "row_count", "byte_count", "duration_ms")
      VALUES (${organizationId}, ${activeRunId}::uuid, 'active_rows',
              ${imported.connection.id}::uuid, ${imported.connection.contentRevision},
              ${randomUUID()}::uuid, ${"b".repeat(64)}, ${"c".repeat(64)},
              'succeeded', 1, 64, 1),
             (${organizationId}, ${historicalRunId}::uuid, 'active_rows',
              ${imported.connection.id}::uuid, ${imported.connection.contentRevision},
              ${randomUUID()}::uuid, ${"d".repeat(64)}, ${"e".repeat(64)},
              'succeeded', 1, 64, 1)
    `;
    await tx`
      INSERT INTO "workspace_control"."workspace_analysis_publication"
        ("id", "organization_id", "article_id", "article_revision", "source_run_id",
         "slug", "visibility", "title", "snapshot", "snapshot_hash",
         "approved_by_member_id")
      VALUES (${publicationId}::uuid, ${organizationId}, ${articleId}::uuid, 2,
              ${historicalRunId}::uuid, ${`harness-publication-${suffix}`},
              'unlisted', 'Historical member attribution',
              ${JSON.stringify(publicationSnapshot)}::jsonb,
              ${versioning.canonicalHash(publicationSnapshot)}, ${removableMemberId})
    `;
  });

  const removed = await runnerStore.removeMemberAfterAnalysisRunnerCleanup({
    organizationId,
    target: {
      memberId: removableMemberId,
      userId: removableUserId,
      role: "viewer",
      claimId,
    },
    externalLeaseRevocation: { revoked: 0, deferred: 0 },
    authority,
  });
  expect(removed).toMatchObject({
    id: removableMemberId,
    runnerCount: 1,
    activeRunCount: 1,
    discardedReceiptCount: 1,
  });
  const state = await sql<{
    memberPresent: boolean;
    runnerMemberId: string | null;
    runnerRevoked: boolean;
    runnerBackgroundAllowed: boolean;
    activeState: string;
    activeReceipts: number;
    activeRequester: string | null;
    historicalState: string;
    historicalReceipts: number;
    historicalRequester: string | null;
    publicationApprover: string | null;
    publicationPreserved: boolean;
    auditRunnerCount: number;
    auditRunCount: number;
    auditReceiptCount: number;
  }[]>`
    SELECT
      EXISTS (SELECT 1 FROM "workspace_control"."member"
              WHERE "id" = ${removableMemberId}
                AND "organization_id" = ${organizationId}) AS "memberPresent",
      runner."member_id" AS "runnerMemberId",
      runner."revoked_at" IS NOT NULL AS "runnerRevoked",
      runner."background_allowed" AS "runnerBackgroundAllowed",
      active_run."state" AS "activeState",
      (SELECT count(*)::int
       FROM "workspace_control"."workspace_analysis_article_query_receipt" receipt
       WHERE receipt."organization_id" = ${organizationId}
         AND receipt."run_id" = ${activeRunId}::uuid) AS "activeReceipts",
      active_run."requested_by_member_id" AS "activeRequester",
      historical_run."state" AS "historicalState",
      (SELECT count(*)::int
       FROM "workspace_control"."workspace_analysis_article_query_receipt" receipt
       WHERE receipt."organization_id" = ${organizationId}
         AND receipt."run_id" = ${historicalRunId}::uuid) AS "historicalReceipts",
      historical_run."requested_by_member_id" AS "historicalRequester",
      publication."approved_by_member_id" AS "publicationApprover",
      publication."snapshot_hash" = ${versioning.canonicalHash(publicationSnapshot)}
        AS "publicationPreserved",
      (audit."redacted_summary"->>'analysisRunnerCount')::int AS "auditRunnerCount",
      (audit."redacted_summary"->>'analysisActiveRunCount')::int AS "auditRunCount",
      (audit."redacted_summary"->>'analysisDiscardedReceiptCount')::int
        AS "auditReceiptCount"
    FROM "workspace_control"."workspace_analysis_runner" runner
    JOIN "workspace_control"."workspace_analysis_article_run" active_run
      ON active_run."id" = ${activeRunId}::uuid
    JOIN "workspace_control"."workspace_analysis_article_run" historical_run
      ON historical_run."id" = ${historicalRunId}::uuid
    JOIN "workspace_control"."workspace_analysis_publication" publication
      ON publication."id" = ${publicationId}::uuid
    JOIN "workspace_control"."workspace_audit_event" audit
      ON audit."organization_id" = ${organizationId}
     AND audit."action" = 'member.remove'
     AND audit."resource_id" = ${removableMemberId}
    WHERE runner."id" = ${runnerId}::uuid
  `;
  expect(state[0]).toEqual({
    memberPresent: false,
    runnerMemberId: null,
    runnerRevoked: true,
    runnerBackgroundAllowed: false,
    activeState: "stale",
    activeReceipts: 0,
    activeRequester: null,
    historicalState: "succeeded",
    historicalReceipts: 1,
    historicalRequester: null,
    publicationApprover: null,
    publicationPreserved: true,
    auditRunnerCount: 1,
    auditRunCount: 1,
    auditReceiptCount: 1,
  });
}
