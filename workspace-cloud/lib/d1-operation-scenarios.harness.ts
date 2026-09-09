import { verifyD1BranchSwitch } from "./d1-switch-scenarios.harness";
import { randomBytes, randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import type { ProviderMutationAuthority } from "./provider-integrations/authority";
import { providerOperationOwnershipMarker } from "./provider-operation-marker";
import { recordProviderOperationPlan, decideProviderOperation } from "./provider-operation-plan";
import { claimProviderOperationExecution, markProviderOperationRemoteStarted, cancelExpiredProviderOperationExecution } from "./provider-operation-execution";
import { applyProviderOperationReconciliation } from "./provider-operation-reconciliation";
import { completeProviderOperationBootstrap } from "./provider-operation-bootstrap";
import { listNeonBranchManagedAccessBoundaries } from "./provider-operation-managed-access";
import { loadProviderOperationExecution, listProviderOperationExecutions } from "./provider-operation-records";
import { canonicalHash } from "./workspace-versioning";
import type { NeonBranchCreatePlan } from "./providers/neon-branch-plan";

export async function verifyD1Operations(db: D1Database, authority: ProviderMutationAuthority) {
  const priorKey = process.env.WORKSPACE_CREDENTIAL_KEY;
  process.env.WORKSPACE_CREDENTIAL_KEY = randomBytes(32).toString("base64url");
  try {
    const integrationId = randomUUID();
    await db.prepare(`INSERT INTO workspace_provider_integration (id, organization_id, provider, display_name, external_account_id, encrypted_credential)
      VALUES (?, ?, 'neon', 'Operation fixture', ?, 'fixture')`).bind(integrationId, authority.organizationId, randomUUID()).run();
    const create = async (options: { production?: boolean; expired?: boolean } = {}) => {
      const now = new Date(Date.now() - (options.expired ? 11 * 60_000 : 0));
      const operationId = randomUUID(); const idempotencyKey = randomUUID();
      const plan: NeonBranchCreatePlan = { version: 1, kind: "neon.branch.create", operationId, integrationId,
        integrationGeneration: "1", issuedAt: now.toISOString(), expiresAt: new Date(now.valueOf() + 600_000).toISOString(),
        source: { projectId: "fixture-project", branchId: "fixture-source", parentId: null, treeParentId: null,
          name: "Source", currentState: "ready", pendingState: null, stateChangedAt: now.toISOString(),
          createdAt: now.toISOString(), updatedAt: now.toISOString(), creationSource: "console", initSource: "parent-data",
          sourceLsn: null, sourceTimestamp: null, default: false, protected: false, expiresAt: null,
          environment: options.production ? "production" : "development", point: { kind: "head" }, restrictedActions: [] },
        target: { name: "Fixture branch", initSource: "parent-data", endpoint: "read_write", protected: false,
          expiresAt: null, copiesData: true, createsCompute: true },
        risk: options.production ? "production_data" : "standard", approvalPolicy: options.production ? "separate_admin" : "single_admin", warningCodes: [],
      };
      const planHash = canonicalHash(plan);
      const ownershipMarker = providerOperationOwnershipMarker({ organizationId: authority.organizationId, integrationId,
        integrationGeneration: 1n, operationId, planHash });
      const input = { authority, integrationId, integrationGeneration: 1n, operationId, idempotencyKey,
        requestHash: canonicalHash({ idempotencyKey }), planHash, ownershipMarker, plan, now };
      const planned = await recordProviderOperationPlan(input);
      expect(planned?.id).toBe(operationId);
      expect((await recordProviderOperationPlan(input))?.id).toBe(operationId);
      expect(await recordProviderOperationPlan({ ...input, requestHash: "f".repeat(64) })).toBeNull();
      return { ...input, kind: plan.kind };
    };
    const input = await create();
    expect(await claimProviderOperationExecution(input)).toBeNull();
    const decision = { ...input, decision: "approved" as const };
    const approvals = await Promise.all(Array.from({ length: 4 }, () => decideProviderOperation(decision)));
    expect(approvals.filter((value) => value && !value.replayed)).toHaveLength(1);
    expect(await decideProviderOperation({ ...decision, decision: "rejected" })).toBeNull();
    const claims = await Promise.all(Array.from({ length: 4 }, () => claimProviderOperationExecution(input)));
    expect(claims.filter((value) => value?.claimedNow)).toHaveLength(1);
    expect(new Set(claims.map((value) => value?.claimId)).size).toBe(1);
    const claimId = claims[0]!.claimId;
    expect(await markProviderOperationRemoteStarted({ ...input, claimId: randomUUID() })).toBeNull();
    const starts = await Promise.all(Array.from({ length: 4 }, () => markProviderOperationRemoteStarted({ ...input, claimId })));
    expect(starts.filter((value) => value?.startedNow)).toHaveLength(1);
    const observation = { status: "pending" as const, branchId: "fixture-created", endpointId: null,
      providerOperationId: randomUUID(), providerOperationStatus: "running", databaseCount: null, databaseFingerprint: null,
      retiredInheritedRoleCount: null, credentialFenceFingerprint: null, managedAccessState: "waiting_for_provider" as const, failureCode: null };
    expect((await applyProviderOperationReconciliation({ ...input, claimId, result: observation }))?.state).toBe("reconciling");
    const ready = { ...observation, status: "ready" as const, endpointId: "fixture-endpoint", providerOperationStatus: "finished",
      databaseCount: 1, databaseFingerprint: "a".repeat(64), retiredInheritedRoleCount: 0, credentialFenceFingerprint: "b".repeat(64),
      managedAccessState: "bootstrap_required" as const };
    expect((await applyProviderOperationReconciliation({ ...input, claimId, result: ready }))?.state).toBe("succeeded");
    const bootstrap = { ...input, projectId: "fixture-project", branchId: "fixture-created",
      databaseFingerprint: ready.databaseFingerprint, credentialFenceFingerprint: ready.credentialFenceFingerprint,
      providerAuditId: "fixture-created:fixture-audit", resourceFingerprint: "c".repeat(64), bootstrapPlanHash: "d".repeat(64) };
    expect((await completeProviderOperationBootstrap(bootstrap))?.transitioned).toBe(true);
    expect((await completeProviderOperationBootstrap(bootstrap))?.transitioned).toBe(false);
    expect(await completeProviderOperationBootstrap({ ...bootstrap, resourceFingerprint: "e".repeat(64) })).toBeNull();
    expect((await listNeonBranchManagedAccessBoundaries({ organizationId: authority.organizationId, integrationId, integrationGeneration: 1n,
      projectId: "fixture-project" }))[0]?.managedAccessState).toBe("ready");
    expect((await loadProviderOperationExecution({ ...input, organizationId: authority.organizationId }))?.managedAccessState).toBe("ready");
    const inventory = await listProviderOperationExecutions({ organizationId: authority.organizationId, integrationId, integrationGeneration: 1n,
      currentMemberId: authority.membershipId, currentUserId: authority.userId });
    expect(inventory).toHaveLength(1);
    await verifyD1BranchSwitch(db, authority, integrationId);
    const production = await create({ production: true });
    expect(await decideProviderOperation({ ...production, decision: "approved" })).toBeNull();
    expect((await decideProviderOperation({ ...production, decision: "rejected" }))?.state).toBe("cancelled");
    const expired = await create({ expired: true });
    expect(await decideProviderOperation({ ...expired, decision: "approved" })).toBeNull();
    await db.prepare("UPDATE workspace_provider_operation SET state = 'approved' WHERE id = ?").bind(expired.operationId).run();
    expect((await cancelExpiredProviderOperationExecution({ ...expired, now: new Date() }))?.state).toBe("cancelled");
    const fenced = await create();
    await decideProviderOperation({ ...fenced, decision: "approved" });
    await db.prepare("UPDATE member SET role = 'viewer' WHERE id = ?").bind(authority.membershipId).run();
    expect(await claimProviderOperationExecution(fenced)).toBeNull();
    await db.prepare("UPDATE member SET role = 'owner' WHERE id = ?").bind(authority.membershipId).run();
  } finally {
    if (priorKey === undefined) delete process.env.WORKSPACE_CREDENTIAL_KEY; else process.env.WORKSPACE_CREDENTIAL_KEY = priorKey;
  }
}
