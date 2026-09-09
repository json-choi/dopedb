import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { registerAnalysisRunner, revokeAnalysisRunner, removeMemberAfterAnalysisRunnerCleanup } from "./workspace-analysis-runner-store";
import { analysisRunnerCapabilityVersion } from "./workspace-analysis-runner-capability";
import { claimRevocationGate } from "./revocation-gates";
import type { MemberAuthority } from "./d1/member-authority";

export async function verifyD1AnalysisRunners(db: D1Database, organizationId: string, articleId: string, authority: MemberAuthority) {
  const input = { organizationId, authority, runnerCapability: null, capabilityVersion: analysisRunnerCapabilityVersion,
    registration: { deviceId: randomUUID(), displayName: "Fixture Desktop" } };
  const created = await registerAnalysisRunner(input);
  expect(created?.status).toBe("created");
  if (!created || created.status !== "created") throw new Error("Missing fixture runner");
  expect(await registerAnalysisRunner(input)).toEqual({ status: "missing" });
  expect(await registerAnalysisRunner({ ...input, runnerCapability: "0".repeat(64) })).toEqual({ status: "invalid" });
  expect((await registerAnalysisRunner({ ...input, runnerCapability: created.runnerCapability }))?.status).toBe("verified");
  expect(await revokeAnalysisRunner({ organizationId, runnerId: created.id, authority })).toEqual({ id: created.id, activeRunCount: 0 });
  const recreated = await registerAnalysisRunner(input);
  expect(recreated?.status).toBe("created");
  if (recreated?.status === "created") expect(recreated.runnerCapability).not.toBe(created.runnerCapability);

  const userId = randomUUID(), memberId = randomUUID(), sessionId = randomUUID();
  await db.prepare("INSERT INTO user (id, name, email) VALUES (?, 'Removal fixture', ?)")
    .bind(userId, `${userId}@invalid.test`).run();
  await db.prepare("INSERT INTO member (id, organization_id, user_id, role) VALUES (?, ?, ?, 'editor')")
    .bind(memberId, organizationId, userId).run();
  await db.prepare("INSERT INTO session (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, userId, randomUUID(), new Date(Date.now() + 60_000).toISOString()).run();
  const targetAuthority = { membershipId: memberId, userId, sessionId, role: "editor" };
  const targetRunner = await registerAnalysisRunner({ ...input, authority: targetAuthority,
    registration: { deviceId: randomUUID(), displayName: "Removal Desktop" } });
  if (!targetRunner || targetRunner.status !== "created") throw new Error("Missing removal fixture runner");
  const runId = randomUUID();
  await db.prepare("INSERT INTO workspace_analysis_article_run (id, organization_id, article_id, article_revision, runner_id, runner_capability_generation, requested_by_member_id, state, definition_hash, started_at) VALUES (?, ?, ?, 1, ?, 1, ?, 'running', ?, ?)")
    .bind(runId, organizationId, articleId, targetRunner.id, memberId, "1".repeat(64), new Date().toISOString()).run();
  const claim = await claimRevocationGate({ kind: "member", organizationId, memberId, userId });
  expect(claim).not.toBeNull();
  const removal = { organizationId, authority, target: { memberId, userId, role: "editor", claimId: claim!.claimId },
    externalLeaseRevocation: { revoked: 0, deferred: 0 } };
  expect(await removeMemberAfterAnalysisRunnerCleanup({ ...removal, target: { ...removal.target, claimId: randomUUID() } })).toBeNull();
  expect(await removeMemberAfterAnalysisRunnerCleanup(removal)).toEqual({ id: memberId, runnerCount: 1,
    activeRunCount: 1, discardedReceiptCount: 0 });
  const retained = await db.prepare("SELECT organization_id AS organizationId, requested_by_member_id AS memberId, state FROM workspace_analysis_article_run WHERE id = ?")
    .bind(runId).first();
  expect(retained).toEqual({ organizationId, memberId: null, state: "stale" });
  expect(await db.prepare("SELECT member_id FROM workspace_analysis_runner WHERE id = ?").bind(targetRunner.id).first("member_id"))
    .toBeNull();
}
