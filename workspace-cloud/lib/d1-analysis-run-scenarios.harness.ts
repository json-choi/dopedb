import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { MemberAuthority } from "./d1/member-authority";
import type { SharedAnalysisArticleCreate } from "./workspace-analysis-articles";
import { registerAnalysisRunner, revokeAnalysisRunner } from "./workspace-analysis-runner-store";
import { analysisRunnerCapabilityVersion, hashAnalysisRunnerCapability } from "./workspace-analysis-runner-capability";
import { commitAnalysisRunCreate, getAnalysisRunControl, requestAnalysisRunCancellation, commitAnalysisRunCompletion } from "./workspace-analysis-run-store";
import { parseAnalysisRunCompletion } from "./workspace-analysis-runs";
import { canonicalHash } from "./workspace-versioning";
import { buildAnalysisPublicSnapshot, parseAnalysisPublicationRequest } from "./workspace-analysis-publications";
import { commitAnalysisPublication, revokeAnalysisPublication } from "./workspace-analysis-publication-store";

export async function verifyD1AnalysisRuns(db: D1Database, organizationId: string, article: SharedAnalysisArticleCreate, authority: MemberAuthority) {
  const runner = await registerAnalysisRunner({ organizationId, authority, runnerCapability: null,
    capabilityVersion: analysisRunnerCapabilityVersion, registration: { deviceId: randomUUID(), displayName: "Run fixture" } });
  if (!runner || runner.status !== "created") throw new Error("Missing run fixture runner");
  const runnerCapabilityHash = hashAnalysisRunnerCapability(runner.runnerCapability!);
  const runInput = { organizationId, articleId: article.id, authority, runnerCapabilityHash,
    definitionHash: canonicalHash(article.definition), run: { id: randomUUID(), articleRevision: 1, runnerId: runner.id, trigger: "manual" as const } };
  expect(await commitAnalysisRunCreate({ ...runInput, runnerCapabilityHash: "0".repeat(64) })).toBeNull();
  const started = await commitAnalysisRunCreate(runInput);
  expect(started?.run.state).toBe("running");
  expect(started?.run.schemaFingerprints).toEqual({});
  expect(started?.connectionContentRevision).toBe(article.connectionRevision);
  const control = { organizationId, articleId: article.id, runId: runInput.run.id,
    membershipId: authority.membershipId, runnerCapabilityHash };
  expect(await getAnalysisRunControl(control)).toMatchObject({ state: "running", authorized: true });
  const receipt = { queryNodeId: article.definition.query.id, connectionId: article.connectionId,
    connectionRevision: article.connectionRevision, queryRunId: randomUUID(), queryHash: canonicalHash({ sql: article.definition.query.sql }),
    schemaFingerprint: canonicalHash(article.definition.query.columns), state: "succeeded", rowCount: 2, byteCount: 257, durationMs: 9 };
  const completion = parseAnalysisRunCompletion({ state: "succeeded", queryReceipts: [receipt], error: null }, article.definition);
  const completionInput = { organizationId, articleId: article.id, runId: runInput.run.id, runnerId: runner.id,
    runnerCapabilityHash, authority, completion };
  const completed = await Promise.all(Array.from({ length: 4 }, () => commitAnalysisRunCompletion(completionInput)));
  expect(completed.every((value) => value?.state === "succeeded")).toBe(true);
  expect(completed[0]?.schemaFingerprints).toEqual({ [receipt.queryNodeId]: receipt.schemaFingerprint });
  expect(await db.prepare("SELECT count(*) AS count FROM workspace_analysis_article_query_receipt WHERE run_id = ?")
    .bind(runInput.run.id).first("count")).toBe(1);
  expect(await commitAnalysisRunCompletion({ ...completionInput, completion: { ...completion,
    queryReceipts: [{ ...completion.queryReceipts[0], rowCount: 1 }] } })).toBeNull();
  const publicationRequest = parseAnalysisPublicationRequest({ id: randomUUID(), runId: runInput.run.id,
    slug: `fixture-${randomUUID()}`, replacePublicationId: null, visibility: "unlisted", searchIndexable: false });
  const publicationInput = { organizationId, articleId: article.id, articleRevision: 1, authority, request: publicationRequest,
    snapshot: buildAnalysisPublicSnapshot({ request: publicationRequest, definition: article.definition, publishedAt: new Date() }) };
  const published = await commitAnalysisPublication(publicationInput);
  expect(published?.version).toBe(1);
  expect(await commitAnalysisPublication({ ...publicationInput, request: { ...publicationRequest, id: randomUUID() } })).toBeNull();
  const replacementId = randomUUID();
  expect((await commitAnalysisPublication({ ...publicationInput,
    request: { ...publicationRequest, id: replacementId, replacePublicationId: publicationRequest.id } }))?.version).toBe(2);
  await expect(db.prepare("UPDATE workspace_analysis_publication SET title = 'Forbidden' WHERE id = ?")
    .bind(replacementId).run()).rejects.toThrow();
  expect((await revokeAnalysisPublication({ organizationId, articleId: article.id, publicationId: replacementId, authority }))?.id)
    .toBe(replacementId);
  const cancelId = randomUUID();
  expect((await commitAnalysisRunCreate({ ...runInput, run: { ...runInput.run, id: cancelId } }))?.run.state).toBe("running");
  expect((await requestAnalysisRunCancellation({ organizationId, articleId: article.id, runId: cancelId, authority }))?.cancelRequestedAt)
    .toEqual(expect.any(String));
  expect(await commitAnalysisRunCompletion({ ...completionInput, runId: cancelId })).toBeNull();
  expect((await commitAnalysisRunCompletion({ ...completionInput, runId: cancelId, completion: {
    state: "cancelled", queryReceipts: [], error: { kind: "cancelled", message: "Fixture cancellation" },
  } }))?.state).toBe("cancelled");
  const orphanId = randomUUID();
  await commitAnalysisRunCreate({ ...runInput, run: { ...runInput.run, id: orphanId } });
  expect(await revokeAnalysisRunner({ organizationId, runnerId: runner.id, authority })).toEqual({ id: runner.id, activeRunCount: 1 });
  expect(await getAnalysisRunControl({ ...control, runId: orphanId })).toMatchObject({ authorized: false, state: "stale" });
  expect(await commitAnalysisRunCompletion(completionInput)).toBeNull();
}
