import { randomUUID } from "node:crypto";

import { expect } from "vitest";

import { expectRfc3339Timestamp } from "./assertions";
import type { AuthorityProviderScenarioResult } from "./authority-provider-scenarios";
import type { ProviderImportPostgresHarness } from "./fixture";

export async function runAnalysisLifecycleScenarios(
  fixture: ProviderImportPostgresHarness,
  provider: AuthorityProviderScenarioResult,
) {
  const { authority, memberId, organizationId, sql, suffix } = fixture;
  const { developmentEnvironment, imported } = provider;
  const [articleStore, articleContract, runStore, runnerStore, runContract,
    versioning, runnerCapabilityContract] = await Promise.all([
    import("../workspace-analysis-article-store"),
    import("../workspace-analysis-articles"),
    import("../workspace-analysis-run-store"),
    import("../workspace-analysis-runner-store"),
    import("../workspace-analysis-runs"),
    import("../workspace-versioning"),
    import("../workspace-analysis-runner-capability"),
  ]);

  const query = {
    id: "active_rows",
    title: "Active rows",
    sql: "SELECT count(*) AS active_rows FROM users WHERE active = TRUE",
    maxRows: 5,
    maxBytes: 16_384,
    columns: [{
      name: "active_rows",
      type: "number",
      nullable: false,
      role: "measure",
      sensitivity: "internal",
      masking: "none",
    }],
  } as const;
  const articleId = randomUUID();
  const article = articleContract.parseSharedAnalysisArticleCreate({
    id: articleId,
    projectEnvironmentId: developmentEnvironment.id,
    environmentRevision: developmentEnvironment.revision,
    connectionId: imported.connection.id,
    connectionRevision: imported.connection.contentRevision,
    definition: {
      version: 3,
      source: "human",
      title: "Harness analysis",
      html: "<h2>Active rows</h2><p>One exact saved query.</p>",
      query,
    },
  });
  expect(Object.keys(article.definition).sort()).toEqual([
    "html", "query", "source", "title", "version",
  ]);

  const created = await articleStore.commitAnalysisArticleCreate({
    organizationId,
    article,
    authority,
  });
  expect(created).toMatchObject({
    id: articleId,
    revision: 1,
  });
  const revisedArticle = articleContract.parseSharedAnalysisArticleCreate({
    ...article,
    definition: {
      ...article.definition,
      html: "<h2>Active rows</h2><p>A verified exact saved query.</p>",
    },
  });
  const updated = await articleStore.commitAnalysisArticleMutation({
    organizationId,
    article: revisedArticle,
    expectedRevision: 1,
    ownerMemberId: memberId,
    authority,
    operation: "update",
  });
  expect(updated).toMatchObject({ revision: 2 });
  await expect(articleStore.commitAnalysisArticleMutation({
    organizationId,
    article: revisedArticle,
    expectedRevision: 1,
    ownerMemberId: memberId,
    authority,
    operation: "update",
  })).resolves.toBeNull();
  await expect(sql`
    UPDATE "workspace_control"."workspace_analysis_article_revision"
    SET "payload_hash" = ${"0".repeat(64)}
    WHERE "organization_id" = ${organizationId}
      AND "article_id" = ${articleId}::uuid
      AND "revision" = 1
  `).rejects.toThrow(/immutable/);

  expect(() => runContract.parseAnalysisRunnerRegistration({
    deviceId: `background-${suffix}`,
    displayName: "Background runner",
    backgroundAllowed: true,
  })).toThrow("Invalid manual Analysis runner registration");
  const deviceId = `analysis-capability-${suffix}`;
  await expect(runnerStore.registerAnalysisRunner({
    organizationId,
    registration: { deviceId, displayName: "Runner" },
    runnerCapability: null,
    capabilityVersion: null,
    authority,
  })).resolves.toMatchObject({ status: "unsupported" });
  const registration = await runnerStore.registerAnalysisRunner({
    organizationId,
    registration: { deviceId, displayName: "Foreground runner" },
    runnerCapability: null,
    capabilityVersion: 1,
    authority,
  });
  expect(registration).toMatchObject({ status: "created" });
  if (registration?.status !== "created" || typeof registration.runnerCapability !== "string") {
    throw new Error("Runner registration failed");
  }
  const runnerCapabilityHash = runnerCapabilityContract.hashAnalysisRunnerCapability(
    registration.runnerCapability,
  );
  await expect(runnerStore.registerAnalysisRunner({
    organizationId,
    registration: { deviceId, displayName: "Verified runner" },
    runnerCapability: registration.runnerCapability,
    capabilityVersion: 1,
    authority,
  })).resolves.toMatchObject({ status: "verified", runnerCapability: null });

  const createRun = async () => {
    const runId = randomUUID();
    const started = await runStore.commitAnalysisRunCreate({
      organizationId,
      articleId,
      run: {
        id: runId,
        articleRevision: 2,
        runnerId: registration.id,
        trigger: "manual",
      },
      definitionHash: versioning.canonicalHash(revisedArticle.definition),
      runnerCapabilityHash,
      authority,
    });
    expect(started?.run).toMatchObject({ id: runId, state: "running", trigger: "manual" });
    expect(started?.connectionContentRevision).toBe(imported.connection.contentRevision);
    expectRfc3339Timestamp(started?.run.startedAt);
    return runId;
  };
  await expect(runStore.commitAnalysisRunCreate({
    organizationId,
    articleId,
    run: {
      id: randomUUID(), articleRevision: 2, runnerId: registration.id,
      trigger: "manual",
    },
    definitionHash: versioning.canonicalHash(revisedArticle.definition),
    runnerCapabilityHash: runnerCapabilityContract.hashAnalysisRunnerCapability("f".repeat(64)),
    authority,
  })).resolves.toBeNull();

  const runId = await createRun();
  await expect(runStore.getAnalysisRunControl({
    organizationId,
    articleId,
    runId,
    membershipId: memberId,
    runnerCapabilityHash,
  })).resolves.toMatchObject({ authorized: true, state: "running" });
  const queryReceipt = {
    queryNodeId: query.id,
    connectionId: imported.connection.id,
    connectionRevision: imported.connection.contentRevision,
    queryRunId: randomUUID(),
    queryHash: versioning.canonicalHash({ sql: query.sql }),
    schemaFingerprint: versioning.canonicalHash(query.columns),
    state: "succeeded" as const,
    rowCount: 2,
    byteCount: 257,
    durationMs: 9,
  };
  const completion = runContract.parseAnalysisRunCompletion({
    state: "succeeded",
    queryReceipts: [queryReceipt],
    error: null,
  }, revisedArticle.definition);
  expect(() => runContract.parseAnalysisRunCompletion({
    state: "succeeded",
    queryReceipts: [queryReceipt],
    fragmentManifest: [{ blockId: "removed" }],
    error: null,
  }, revisedArticle.definition)).toThrow("Invalid Analysis Article run completion");
  const completionInput = {
    organizationId,
    articleId,
    runId,
    runnerId: registration.id,
    runnerCapabilityHash,
    completion,
    authority,
  } as const;
  await expect(runStore.commitAnalysisRunCompletion(completionInput)).resolves.toMatchObject({
    id: runId,
    state: "succeeded",
    rowCount: 2,
    byteCount: 257,
    resultHash: runContract.analysisRunResultHash([queryReceipt]),
  });
  await expect(runStore.commitAnalysisRunCompletion(completionInput))
    .resolves.toMatchObject({ id: runId, state: "succeeded" });
  const durability = await sql<{ receipts: number; audits: number }[]>`
    SELECT
      (SELECT count(*)::int
       FROM "workspace_control"."workspace_analysis_article_query_receipt"
       WHERE "organization_id" = ${organizationId} AND "run_id" = ${runId}::uuid)
        AS "receipts",
      (SELECT count(*)::int FROM "workspace_control"."workspace_audit_event"
       WHERE "organization_id" = ${organizationId}
        AND "action" = 'analysis_article.run_complete' AND "resource_id" = ${runId})
        AS "audits"
  `;
  expect(durability[0]).toEqual({ receipts: 1, audits: 1 });

  const cancelledRunId = await createRun();
  await expect(runStore.requestAnalysisRunCancellation({
    organizationId, articleId, runId: cancelledRunId, authority,
  })).resolves.toMatchObject({ id: cancelledRunId });
  await expect(runStore.commitAnalysisRunCompletion({
    organizationId,
    articleId,
    runId: cancelledRunId,
    runnerId: registration.id,
    runnerCapabilityHash,
    completion: {
      state: "cancelled",
      queryReceipts: [],
      error: { kind: "cancelled", message: "Cancelled by harness" },
    },
    authority,
  })).resolves.toMatchObject({ id: cancelledRunId, state: "cancelled" });

  const revokedRunId = await createRun();
  await expect(runnerStore.revokeAnalysisRunner({
    organizationId,
    runnerId: registration.id,
    authority,
  })).resolves.toMatchObject({ id: registration.id, activeRunCount: 1 });
  const revoked = await sql<{ state: string; receipts: number }[]>`
    SELECT run."state",
      (SELECT count(*)::int
       FROM "workspace_control"."workspace_analysis_article_query_receipt" receipt
       WHERE receipt."organization_id" = run."organization_id"
         AND receipt."run_id" = run."id") AS "receipts"
    FROM "workspace_control"."workspace_analysis_article_run" run
    WHERE run."organization_id" = ${organizationId} AND run."id" = ${revokedRunId}::uuid
  `;
  expect(revoked[0]).toEqual({ state: "stale", receipts: 0 });

  return { articleId, revisedArticle, runnerStore, versioning };
}

export type AnalysisLifecycleScenarioResult =
  Awaited<ReturnType<typeof runAnalysisLifecycleScenarios>>;
