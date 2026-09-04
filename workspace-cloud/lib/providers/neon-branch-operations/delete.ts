// Plan, approval, remote-start fencing, and reconciliation for deletion of a
// DopeDB-owned Neon branch. Provider ambiguity is preserved for later recovery.
import "server-only";

import { verifiedNeonProjectCredential } from "../../provider-integrations/integration";
import { providerOperationOwnershipMarker } from "../../provider-operation-marker";
import {
  applyProviderOperationReconciliation,
  cancelExpiredProviderOperationExecution,
  claimProviderOperationExecution,
  decideProviderOperation,
  loadProviderOperationExecution,
  loadProviderOperationPlan,
  markProviderOperationRemoteStarted,
  recordProviderOperationPlan,
  type ProviderOperationReconciliationInput,
} from "../../provider-operation-store";
import { canonicalHash } from "../../workspace-versioning";
import type { NeonBranchOperationCommand } from "../neon-branch-operation-command";
import {
  buildNeonBranchDeletePlan,
  parseNeonBranchDeletePlanRequest,
  revalidateNeonBranchDeletePlan,
} from "../neon-branch-delete-plan";
import {
  deleteNeonBranch,
  NeonBranchMutationRequestError,
  reconcileNeonBranchDelete,
} from "../neon";
import {
  executionResponse,
  jsonError,
  privateJson,
  type NeonBranchOperationContext,
  type NeonBranchOperationOutcome,
} from "./contracts";
import { liveDeletePlanContext } from "./live-contexts";

type NeonBranchDeleteCommand = Extract<
  NeonBranchOperationCommand,
  { action: "planDelete" | "decideDelete" | "executeDelete" }
>;

export async function runNeonBranchDeleteOperation(
  context: NeonBranchOperationContext,
  body: NeonBranchDeleteCommand,
): Promise<NeonBranchOperationOutcome> {
  const { workspaceId, integrationId, integration, authority } = context;

  if (body.action === "executeDelete") {
    const operation = await loadProviderOperationExecution({
      organizationId: workspaceId,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: body.operationId,
      kind: "neon.branch.delete",
    });
    if (
      !operation
      || operation.plan.kind !== "neon.branch.delete"
      || operation.planHash !== body.planHash
    ) {
      return jsonError("Neon branch delete plan changed or is unavailable", 409);
    }
    if (["succeeded", "failed", "needs_repair", "cancelled"].includes(operation.state)) {
      return privateJson(executionResponse(operation));
    }
    if (operation.state === "awaiting_approval") {
      return jsonError("Neon branch deletion is awaiting approval", 409);
    }
    const identity = {
      authority,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: operation.id,
      kind: "neon.branch.delete" as const,
      planHash: operation.planHash,
      ownershipMarker: operation.ownershipMarker,
    };
    if (
      (operation.state === "approved" || operation.state === "claimed")
      && operation.planExpiresAt.valueOf() <= Date.now()
    ) {
      const cancelled = await cancelExpiredProviderOperationExecution({
        ...identity,
        now: new Date(),
      });
      if (!cancelled) {
        return jsonError("Neon branch deletion authority or operation changed", 409);
      }
      return privateJson(executionResponse(cancelled));
    }
    if (
      operation.state === "reconciling"
      && operation.reconcileAfter
      && operation.reconcileAfter.valueOf() > Date.now()
    ) {
      return privateJson(executionResponse(operation), { status: 202 });
    }

    let credential;
    let claimId = operation.claimId;
    let startedNow = false;
    if (operation.state === "approved" || operation.state === "claimed") {
      const live = await liveDeletePlanContext({
        workspaceId,
        integrationId,
        integration,
        projectId: operation.plan.target.projectId,
        branchId: operation.plan.target.branchId,
      });
      revalidateNeonBranchDeletePlan({
        plan: operation.plan,
        inventory: live.inventory,
        ownership: live.ownership,
        references: live.references,
        now: new Date(),
      });
      credential = live.credential;
      const claim = await claimProviderOperationExecution({
        ...identity,
        now: new Date(),
      });
      if (!claim) {
        return jsonError("Neon branch deletion authority or operation changed", 409);
      }
      const remoteStart = await markProviderOperationRemoteStarted({
        ...identity,
        claimId: claim.claimId,
        now: new Date(),
      });
      if (!remoteStart) {
        return jsonError("Neon branch deletion remote-start fence changed", 409);
      }
      if (remoteStart.state === "cancelled") {
        return privateJson(executionResponse({
          id: remoteStart.id,
          state: remoteStart.state,
          providerOperationId: null,
          providerResourceId: null,
          reconcileAfter: null,
          endpointId: null,
          databaseCount: null,
          databaseFingerprint: null,
          retiredInheritedRoleCount: null,
          credentialFenceFingerprint: null,
          managedAccessState: "unavailable",
          failureCode: null,
        }));
      }
      claimId = claim.claimId;
      startedNow = remoteStart.startedNow;
    } else {
      credential = await verifiedNeonProjectCredential(
        integration,
        operation.plan.target.projectId,
      );
    }
    if (!claimId) {
      return jsonError("Neon branch deletion claim is unavailable", 409);
    }

    let providerOperationId = operation.providerOperationId;
    if (startedNow) {
      let observation: ProviderOperationReconciliationInput;
      try {
        const receipt = await deleteNeonBranch({
          credential,
          plan: operation.plan,
        });
        observation = {
          status: "pending",
          branchId: receipt.branchId,
          providerOperationId: receipt.providerOperationId,
          providerOperationStatus: receipt.providerOperationStatus,
          endpointId: null,
          databaseCount: null,
          databaseFingerprint: null,
          retiredInheritedRoleCount: null,
          credentialFenceFingerprint: null,
          managedAccessState: "unavailable",
          failureCode: null,
        };
      } catch (error) {
        observation = error instanceof NeonBranchMutationRequestError
          && error.responseReceived
          ? {
            status: "failed",
            branchId: null,
            providerOperationId: null,
            providerOperationStatus: null,
            endpointId: null,
            databaseCount: null,
            databaseFingerprint: null,
            retiredInheritedRoleCount: null,
            credentialFenceFingerprint: null,
            managedAccessState: "unavailable",
            failureCode: error.explicitlyRetrySafe
              ? "NEON_DELETE_RETRY_SAFE_REJECTED"
              : "NEON_DELETE_REJECTED",
          }
          : {
            status: "pending",
            branchId: operation.plan.target.branchId,
            providerOperationId: null,
            providerOperationStatus: null,
            endpointId: null,
            databaseCount: null,
            databaseFingerprint: null,
            retiredInheritedRoleCount: null,
            credentialFenceFingerprint: null,
            managedAccessState: "unavailable",
            failureCode: null,
          };
      }
      const recorded = await applyProviderOperationReconciliation({
        ...identity,
        claimId,
        result: observation,
        now: new Date(),
      });
      if (!recorded) {
        return jsonError("Neon branch deletion receipt could not be recorded", 409);
      }
      if (recorded.state !== "reconciling") {
        return privateJson(executionResponse(recorded));
      }
      providerOperationId = recorded.providerOperationId;
    }

    let reconciled: ProviderOperationReconciliationInput = await reconcileNeonBranchDelete({
      credential,
      plan: operation.plan,
      providerOperationId,
    });
    const remoteStartedAt = operation.remoteStartedAt?.valueOf() ?? Date.now();
    if (
      reconciled.status === "pending"
      && remoteStartedAt <= Date.now() - 2 * 60 * 1_000
    ) {
      reconciled = {
        ...reconciled,
        status: "conflict",
        failureCode: "NEON_DELETE_RESULT_AMBIGUOUS",
      };
    }
    const recorded = await applyProviderOperationReconciliation({
      ...identity,
      claimId,
      result: reconciled,
      now: new Date(),
    });
    if (!recorded) {
      return jsonError("Neon branch deletion reconciliation authority changed", 409);
    }
    return privateJson(
      executionResponse(recorded),
      recorded.state === "reconciling" ? { status: 202 } : undefined,
    );
  }

  if (body.action === "decideDelete") {
    const operation = await loadProviderOperationPlan({
      organizationId: workspaceId,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: body.operationId,
      kind: "neon.branch.delete",
    });
    if (
      !operation
      || operation.plan.kind !== "neon.branch.delete"
      || operation.planHash !== body.planHash
    ) {
      return jsonError("Neon branch delete plan changed or is unavailable", 409);
    }
    if (body.decision === "approved" && operation.state === "awaiting_approval") {
      const live = await liveDeletePlanContext({
        workspaceId,
        integrationId,
        integration,
        projectId: operation.plan.target.projectId,
        branchId: operation.plan.target.branchId,
      });
      revalidateNeonBranchDeletePlan({
        plan: operation.plan,
        inventory: live.inventory,
        ownership: live.ownership,
        references: live.references,
        now: new Date(),
      });
    }
    const decided = await decideProviderOperation({
      authority,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: operation.id,
      kind: "neon.branch.delete",
      planHash: operation.planHash,
      ownershipMarker: operation.ownershipMarker,
      decision: body.decision,
      now: new Date(),
    });
    if (!decided) {
      return jsonError("Neon branch deletion approval authority changed", 409);
    }
    return privateJson({
      operation: {
        id: decided.id,
        state: decided.state,
        planHash: operation.planHash,
        decision: decided.decision,
        approvalId: decided.approvalId,
        replayed: decided.replayed,
      },
    });
  }

  const planRequest = parseNeonBranchDeletePlanRequest(body.request);
  const live = await liveDeletePlanContext({
    workspaceId,
    integrationId,
    integration,
    projectId: planRequest.projectId,
    branchId: planRequest.branchId,
  });
  const operationId = crypto.randomUUID();
  const now = new Date();
  const plan = buildNeonBranchDeletePlan({
    request: planRequest,
    inventory: live.inventory,
    ownership: live.ownership,
    references: live.references,
    operationId,
    integrationId,
    integrationGeneration: integration.generation,
    now,
  });
  const requestHash = canonicalHash({
    version: 1,
    organizationId: workspaceId,
    integrationId,
    integrationGeneration: integration.generation.toString(),
    requestedByMemberId: authority.membershipId,
    requestedByUserId: authority.userId,
    requestedBySessionId: authority.sessionId,
    requestedByRole: authority.role,
    request: planRequest,
    targetSnapshot: plan.target,
    referenceSnapshot: plan.references,
    createOwnership: plan.ownership,
  });
  const planHash = canonicalHash(plan);
  const ownershipMarker = providerOperationOwnershipMarker({
    organizationId: workspaceId,
    integrationId,
    integrationGeneration: integration.generation,
    operationId,
    planHash,
  });
  const recorded = await recordProviderOperationPlan({
    authority,
    integrationId,
    integrationGeneration: integration.generation,
    operationId,
    idempotencyKey: planRequest.idempotencyKey,
    requestHash,
    planHash,
    ownershipMarker,
    plan,
    now,
  });
  if (!recorded || recorded.plan.kind !== "neon.branch.delete") {
    return jsonError("Neon branch delete plan authority changed", 409);
  }
  return privateJson({
    operation: {
      id: recorded.id,
      state: recorded.state,
      planHash: recorded.planHash,
      planExpiresAt: recorded.planExpiresAt.toISOString(),
      expired: recorded.planExpiresAt.valueOf() <= Date.now(),
      risk: recorded.risk,
      approvalPolicy: recorded.approvalPolicy,
      replayed: recorded.replayed,
      plan: recorded.plan,
    },
  });
}
