// Plan, approval, remote-start fencing, and reconciliation for Neon branch
// creation, including recovery of a partially recorded credential fence.
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
  buildNeonBranchCreatePlan,
  parseNeonBranchCreatePlanRequest,
  revalidateNeonBranchCreatePlan,
} from "../neon-branch-plan";
import {
  createNeonBranch,
  NeonBranchMutationRequestError,
  reconcileNeonBranchCreate,
} from "../neon";
import {
  executionResponse,
  jsonError,
  privateJson,
  type NeonBranchOperationContext,
  type NeonBranchOperationOutcome,
} from "./contracts";
import { liveCreatePlanContext } from "./live-contexts";

type NeonBranchCreateCommand = Extract<
  NeonBranchOperationCommand,
  { action: "planCreate" | "decideCreate" | "executeCreate" }
>;

export async function runNeonBranchCreateOperation(
  context: NeonBranchOperationContext,
  body: NeonBranchCreateCommand,
): Promise<NeonBranchOperationOutcome> {
  const { workspaceId, integrationId, integration, authority } = context;

  if (body.action === "executeCreate") {
    const operation = await loadProviderOperationExecution({
      organizationId: workspaceId,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: body.operationId,
      kind: "neon.branch.create",
    });
    if (
      !operation
      || operation.plan.kind !== "neon.branch.create"
      || operation.planHash !== body.planHash
    ) {
      return jsonError("Neon branch operation plan changed or is unavailable", 409);
    }
    const needsCredentialFenceRecovery = operation.state === "succeeded"
      && operation.plan.target.endpoint === "read_write"
      && (
        operation.retiredInheritedRoleCount === null
        || operation.credentialFenceFingerprint === null
      );
    if (
      ["succeeded", "failed", "needs_repair", "cancelled"].includes(operation.state)
      && !needsCredentialFenceRecovery
    ) {
      return privateJson(executionResponse(operation));
    }
    if (operation.state === "awaiting_approval") {
      return jsonError("Neon branch operation is awaiting approval", 409);
    }
    const identity = {
      authority,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: operation.id,
      kind: "neon.branch.create" as const,
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
        return jsonError("Neon branch expiration authority or operation changed", 409);
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
      const live = await liveCreatePlanContext({
        workspaceId,
        integrationId,
        integration,
        projectId: operation.plan.source.projectId,
        sourceBranchId: operation.plan.source.branchId,
      });
      revalidateNeonBranchCreatePlan({
        plan: operation.plan,
        inventory: live.inventory,
        workspaceProductionReference: live.workspaceProductionReference,
        now: new Date(),
      });
      credential = live.credential;
      const claim = await claimProviderOperationExecution({
        ...identity,
        now: new Date(),
      });
      if (!claim) {
        return jsonError("Neon branch execution authority or operation changed", 409);
      }
      const remoteStart = await markProviderOperationRemoteStarted({
        ...identity,
        claimId: claim.claimId,
        now: new Date(),
      });
      if (!remoteStart) {
        return jsonError("Neon branch remote-start fence changed", 409);
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
        operation.plan.source.projectId,
      );
    }
    if (!claimId) {
      return jsonError("Neon branch execution claim is unavailable", 409);
    }

    let providerOperationId = operation.providerOperationId;
    if (startedNow) {
      let observation: ProviderOperationReconciliationInput;
      try {
        const receipt = await createNeonBranch({
          credential,
          plan: operation.plan,
          planHash: operation.planHash,
          ownershipMarker: operation.ownershipMarker,
        });
        observation = {
          status: "pending",
          branchId: receipt.branchId,
          providerOperationId: receipt.providerOperationId,
          providerOperationStatus: receipt.providerOperationStatus,
          endpointId: receipt.endpointId,
          databaseCount: null,
          databaseFingerprint: null,
          retiredInheritedRoleCount: null,
          credentialFenceFingerprint: null,
          managedAccessState: "waiting_for_provider",
          failureCode: null,
        };
      } catch (error) {
        observation = error instanceof NeonBranchMutationRequestError
          && error.explicitlyRetrySafe
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
            failureCode: "NEON_RETRY_SAFE_REJECTED",
          }
          : {
            status: "missing",
            branchId: null,
            providerOperationId: null,
            providerOperationStatus: null,
            endpointId: null,
            databaseCount: null,
            databaseFingerprint: null,
            retiredInheritedRoleCount: null,
            credentialFenceFingerprint: null,
            managedAccessState: "waiting_for_provider",
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
        return jsonError("Neon branch creation receipt could not be recorded", 409);
      }
      if (recorded.state !== "reconciling") {
        return privateJson(executionResponse(recorded));
      }
      if (observation.status === "missing") {
        return privateJson(executionResponse(recorded), { status: 202 });
      }
      providerOperationId = recorded.providerOperationId;
    }

    const reconciled = await reconcileNeonBranchCreate({
      credential,
      plan: operation.plan,
      planHash: operation.planHash,
      ownershipMarker: operation.ownershipMarker,
      providerOperationId,
    });
    const recorded = await applyProviderOperationReconciliation({
      ...identity,
      claimId,
      result: reconciled,
      now: new Date(),
    });
    if (!recorded) {
      return jsonError("Neon branch reconciliation authority changed", 409);
    }
    return privateJson(
      executionResponse(recorded),
      recorded.state === "reconciling" ? { status: 202 } : undefined,
    );
  }

  if (body.action === "decideCreate") {
    const operation = await loadProviderOperationPlan({
      organizationId: workspaceId,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: body.operationId,
      kind: "neon.branch.create",
    });
    if (
      !operation
      || operation.plan.kind !== "neon.branch.create"
      || operation.planHash !== body.planHash
    ) {
      return jsonError("Neon branch operation plan changed or is unavailable", 409);
    }
    if (body.decision === "approved" && operation.state === "awaiting_approval") {
      const live = await liveCreatePlanContext({
        workspaceId,
        integrationId,
        integration,
        projectId: operation.plan.source.projectId,
        sourceBranchId: operation.plan.source.branchId,
      });
      revalidateNeonBranchCreatePlan({
        plan: operation.plan,
        inventory: live.inventory,
        workspaceProductionReference: live.workspaceProductionReference,
        now: new Date(),
      });
    }
    const decided = await decideProviderOperation({
      authority,
      integrationId,
      integrationGeneration: integration.generation,
      operationId: operation.id,
      kind: "neon.branch.create",
      planHash: operation.planHash,
      ownershipMarker: operation.ownershipMarker,
      decision: body.decision,
      now: new Date(),
    });
    if (!decided) {
      return jsonError("Neon branch approval authority or operation changed", 409);
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

  const planRequest = parseNeonBranchCreatePlanRequest(body.request);
  const live = await liveCreatePlanContext({
    workspaceId,
    integrationId,
    integration,
    projectId: planRequest.projectId,
    sourceBranchId: planRequest.sourceBranchId,
  });
  const operationId = crypto.randomUUID();
  const now = new Date();
  const plan = buildNeonBranchCreatePlan({
    request: planRequest,
    inventory: live.inventory,
    operationId,
    integrationId,
    integrationGeneration: integration.generation,
    workspaceProductionReference: live.workspaceProductionReference,
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
    sourceSnapshot: plan.source,
    workspaceProductionReference: live.workspaceProductionReference,
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
  if (!recorded) {
    return jsonError("Neon branch plan authority or idempotency key changed", 409);
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
