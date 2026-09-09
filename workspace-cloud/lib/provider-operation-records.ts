// Durable provider-operation planning boundary. Every inserted or replayed plan
// is conditional on one current member/session/integration snapshot and creates
// the matching audit consequence in the same statement.
import "server-only";

import { sql } from "drizzle-orm";
import { utcNow } from "./d1/schema/values";

import { db } from "./db";
import {
  providerMutationAuthoritySql,
  type ProviderMutationAuthority,
} from "./provider-integrations/authority";
import { verifyProviderOperationOwnershipMarker } from "./provider-operation-marker";
import {
  member,
  session,
  workspaceAuditEvent,
  workspaceConnection,
  workspaceConnectionGrant,
  workspaceCredentialLease,
  workspaceProviderIntegration,
  workspaceProviderOperation,
  workspaceProviderOperationApproval,
  workspaceProviderResource,
  workspaceResourceVersion,
} from "./schema";
import { workspaceAuditEventId } from "./workspace-audit-id";
import { canonicalHash, canonicalJson } from "./workspace-versioning";
import {
  MAX_PROVIDER_RESULTS,
  providerResourceFingerprint,
  type ProviderImportProjection,
} from "./providers/adapter-contract";
import type { NeonBranchCreatePlan } from "./providers/neon-branch-plan";
import type { NeonBranchDeletePlan } from "./providers/neon-branch-delete-plan";
import type { NeonBranchSwitchPlan } from "./providers/neon-branch-switch-plan";
import { NEON_OPERATION_STATUSES } from "./providers/neon-branch-mutation";
import { ProviderRequestError } from "./providers/provider-types";

export const MAX_REDACTED_PLAN_BYTES = 32 * 1_024;
export const operationStates = [
  "awaiting_approval",
  "approved",
  "claimed",
  "remote_started",
  "reconciling",
  "succeeded",
  "failed",
  "needs_repair",
  "cancelled",
] as const;

export type ProviderOperationState = typeof operationStates[number];
export const providerOperationKinds = [
  "neon.branch.create",
  "neon.branch.delete",
  "neon.branch.switch",
] as const;

export type ProviderOperationKind = typeof providerOperationKinds[number];
export type NeonBranchOperationPlan =
  | NeonBranchCreatePlan
  | NeonBranchDeletePlan
  | NeonBranchSwitchPlan;

export function isProviderOperationKind(value: unknown): value is ProviderOperationKind {
  return typeof value === "string"
    && providerOperationKinds.includes(value as ProviderOperationKind);
}

// Keep every durable provider-operation write visible in one review surface.
// Approval, claim, remote-start, reconciliation, and completion transitions
// must be added here when their authority-bound store entrypoints are added.
export const PROVIDER_OPERATION_DURABLE_MUTATION_ENTRYPOINTS = Object.freeze([
  "recordProviderOperationPlan",
  "decideProviderOperation",
  "claimProviderOperationExecution",
  "cancelExpiredProviderOperationExecution",
  "markProviderOperationRemoteStarted",
  "applyProviderOperationReconciliation",
  "completeProviderOperationBootstrap",
  "completeNeonBranchSwitch",
] as const);

export type ProviderOperationPlanRecord = Readonly<{
  id: string;
  state: ProviderOperationState;
  planHash: string;
  planExpiresAt: Date;
  risk: "standard" | "production_data";
  approvalPolicy: "single_admin" | "separate_admin";
  plan: NeonBranchOperationPlan;
  ownershipMarker: string;
  replayed: boolean;
}>;

export type ProviderOperationDecision = "approved" | "rejected";

export type ProviderOperationDecisionRecord = Readonly<{
  id: string;
  state: ProviderOperationState;
  decision: ProviderOperationDecision;
  approvalId: string;
  replayed: boolean;
}>;

export type ProviderOperationExecutionClaim = Readonly<{
  id: string;
  state: ProviderOperationState;
  claimId: string;
  claimedNow: boolean;
}>;

export type ProviderOperationRemoteStart = Readonly<{
  id: string;
  state: "remote_started" | "reconciling" | "cancelled";
  claimId: string;
  startedNow: boolean;
}>;

export type ProviderOperationCancellationRecord = Readonly<{
  id: string;
  state: "cancelled";
  providerOperationId: null;
  providerResourceId: null;
  reconcileAfter: null;
  endpointId: null;
  databaseCount: null;
  databaseFingerprint: null;
  retiredInheritedRoleCount: null;
  credentialFenceFingerprint: null;
  managedAccessState: "unavailable";
  failureCode: null;
}>;

export type ProviderOperationExecutionRecord = ProviderOperationPlanRecord & Readonly<{
  claimId: string | null;
  remoteStartedAt: Date | null;
  providerOperationId: string | null;
  providerResourceId: string | null;
  reconcileAfter: Date | null;
  endpointId: string | null;
  databaseCount: number | null;
  databaseFingerprint: string | null;
  retiredInheritedRoleCount: number | null;
  credentialFenceFingerprint: string | null;
  managedAccessState: ProviderManagedAccessState | null;
  failureCode: string | null;
}>;

export type ProviderOperationListRecord = ProviderOperationExecutionRecord & Readonly<{
  requestedByCurrentActor: boolean;
  executionAuthorityLive: boolean;
}>;

export type ProviderManagedAccessState =
  | "waiting_for_provider"
  | "not_requested"
  | "bootstrap_required"
  | "ready"
  | "needs_repair"
  | "unavailable";

export const managedAccessStates: readonly ProviderManagedAccessState[] = [
  "waiting_for_provider",
  "not_requested",
  "bootstrap_required",
  "ready",
  "needs_repair",
  "unavailable",
];

export type ProviderOperationReconciliationInput = Readonly<{
  status: "missing" | "pending" | "ready" | "conflict" | "failed";
  branchId: string | null;
  providerOperationId: string | null;
  providerOperationStatus: string | null;
  endpointId: string | null;
  databaseCount: number | null;
  databaseFingerprint: string | null;
  retiredInheritedRoleCount: number | null;
  credentialFenceFingerprint: string | null;
  managedAccessState: ProviderManagedAccessState;
  failureCode: string | null;
}>;

export type ProviderOperationReconciliationRecord = Readonly<{
  id: string;
  state: ProviderOperationState;
  claimId: string;
  providerOperationId: string | null;
  providerResourceId: string | null;
  reconcileAfter: Date | null;
  endpointId: string | null;
  databaseCount: number | null;
  databaseFingerprint: string | null;
  retiredInheritedRoleCount: number | null;
  credentialFenceFingerprint: string | null;
  managedAccessState: ProviderManagedAccessState;
  failureCode: string | null;
}>;

export type ProviderOperationPlanRow = {
  id: string;
  kind: string;
  state: string;
  planHash: string;
  planExpiresAt: Date | string;
  risk: string;
  approvalPolicy: string;
  redactedPlan: unknown;
  ownershipMarker: string;
};

export type ProviderOperationExecutionRow = ProviderOperationPlanRow & {
  claimId: string | null;
  remoteStartedAt: Date | string | null;
  providerOperationId: string | null;
  providerResourceId: string | null;
  reconcileAfter: Date | string | null;
  redactedResult: unknown;
  failureCode: string | null;
};

export type ProviderOperationListRow = ProviderOperationExecutionRow & {
  requestedByMemberId: string;
  requestedByUserId: string;
  executionAuthorityLive: boolean;
};

export function safeRedactedValue(value: unknown, depth = 0): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid provider operation plan");
    return;
  }
  if (typeof value === "string") {
    if (
      value.length > 2_048
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    ) {
      throw new Error("Invalid provider operation plan");
    }
    return;
  }
  if (depth >= 8) throw new Error("Invalid provider operation plan");
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error("Invalid provider operation plan");
    value.forEach((item) => safeRedactedValue(item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error("Invalid provider operation plan");
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const approvedNonSecretFingerprint = key === "credentialFenceFingerprint";
    if (
      !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)
      || (!approvedNonSecretFingerprint
        && /token|secret|password|credential|authorization|connectionuri|connectionurl|host/i
          .test(key))
    ) {
      throw new Error("Provider operation plan contains secret-bearing data");
    }
    safeRedactedValue(child, depth + 1);
  }
}

export function assertPlan(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  planHash: string;
  ownershipMarker: string;
  plan: NeonBranchOperationPlan;
}) {
  safeRedactedValue(input.plan);
  if (
    Buffer.byteLength(canonicalJson(input.plan), "utf8") > MAX_REDACTED_PLAN_BYTES
    || canonicalHash(input.plan) !== input.planHash
    || input.plan.operationId !== input.operationId
    || input.plan.integrationId !== input.integrationId
    || input.plan.integrationGeneration !== input.integrationGeneration.toString()
    || !verifyProviderOperationOwnershipMarker({
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      integrationGeneration: input.integrationGeneration,
      operationId: input.operationId,
      planHash: input.planHash,
      marker: input.ownershipMarker,
    })
  ) {
    throw new Error("Invalid provider operation plan");
  }
}

export function planDate(value: Date | string): Date | null {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function planRecord(
  row: ProviderOperationPlanRow | undefined,
  input: {
    organizationId: string;
    integrationId: string;
    integrationGeneration: bigint;
    operationId: string;
  },
): ProviderOperationPlanRecord | null {
  if (row && typeof row.redactedPlan === "string") {
    try { row = { ...row, redactedPlan: JSON.parse(row.redactedPlan) }; } catch { return null; }
  }
  const expiresAt = row ? planDate(row.planExpiresAt) : null;
  if (
    !row
    || !expiresAt
    || !operationStates.includes(row.state as ProviderOperationState)
    || !/^[0-9a-f]{64}$/.test(row.planHash)
    || (row.risk !== "standard" && row.risk !== "production_data")
    || (row.approvalPolicy !== "single_admin" && row.approvalPolicy !== "separate_admin")
    || !row.redactedPlan
    || typeof row.redactedPlan !== "object"
    || Array.isArray(row.redactedPlan)
  ) {
    return null;
  }
  const plan = row.redactedPlan as NeonBranchOperationPlan;
  // A replay verifies the originally persisted operation and marker, never the
  // newly generated candidate that lost the idempotency conflict.
  safeRedactedValue(plan);
  if (
    canonicalHash(plan) !== row.planHash
    || plan.operationId !== row.id
    || plan.version !== 1
    || !isProviderOperationKind(row.kind)
    || plan.kind !== row.kind
    || plan.integrationId !== input.integrationId
    || plan.integrationGeneration !== input.integrationGeneration.toString()
    || plan.expiresAt !== expiresAt.toISOString()
    || plan.risk !== row.risk
    || plan.approvalPolicy !== row.approvalPolicy
    || !verifyProviderOperationOwnershipMarker({
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      integrationGeneration: input.integrationGeneration,
      operationId: row.id,
      planHash: row.planHash,
      marker: row.ownershipMarker,
    })
  ) {
    return null;
  }
  return {
    id: row.id,
    state: row.state as ProviderOperationState,
    planHash: row.planHash,
    planExpiresAt: expiresAt,
    risk: row.risk,
    approvalPolicy: row.approvalPolicy,
    plan,
    ownershipMarker: row.ownershipMarker,
    replayed: row.id !== input.operationId,
  };
}

export async function loadProviderOperationPlan(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  kind: ProviderOperationKind;
}): Promise<ProviderOperationPlanRecord | null> {
  const result = await db.execute<ProviderOperationPlanRow>(sql`
    SELECT operation."id" AS "id", operation."kind" AS "kind",
      operation."state" AS "state",
      operation."plan_hash" AS "planHash",
      operation."plan_expires_at" AS "planExpiresAt",
      operation."risk" AS "risk",
      operation."approval_policy" AS "approvalPolicy",
      operation."redacted_plan" AS "redactedPlan",
      operation."ownership_marker" AS "ownershipMarker"
    FROM ${workspaceProviderOperation} AS operation
    WHERE operation."id" = ${input.operationId}
      AND operation."organization_id" = ${input.organizationId}
      AND operation."integration_id" = ${input.integrationId}
      AND operation."provider" = 'neon'
      AND operation."kind" = ${input.kind}
      AND operation."integration_generation" = ${input.integrationGeneration}
    LIMIT 1
  `);
  return planRecord(result.rows[0], {
    organizationId: input.organizationId,
    integrationId: input.integrationId,
    integrationGeneration: input.integrationGeneration,
    operationId: input.operationId,
  });
}

export function optionalDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = planDate(value);
  if (!date) throw new Error("Invalid provider operation execution state");
  return date;
}

export function executionResultProjection(value: unknown): Readonly<{
  endpointId: string | null;
  databaseCount: number | null;
  databaseFingerprint: string | null;
  retiredInheritedRoleCount: number | null;
  credentialFenceFingerprint: string | null;
  managedAccessState: ProviderManagedAccessState | null;
}> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (value === null) {
    return {
      endpointId: null,
      databaseCount: null,
      databaseFingerprint: null,
      retiredInheritedRoleCount: null,
      credentialFenceFingerprint: null,
      managedAccessState: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const endpointId = result.endpointId === undefined || result.endpointId === null
    ? null
    : result.endpointId;
  const databaseCount = result.databaseCount === undefined
    || result.databaseCount === null
    ? null
    : result.databaseCount;
  const databaseFingerprint = result.databaseFingerprint === undefined
    || result.databaseFingerprint === null
    ? null
    : result.databaseFingerprint;
  const retiredInheritedRoleCount = result.retiredInheritedRoleCount === undefined
    || result.retiredInheritedRoleCount === null
    ? null
    : result.retiredInheritedRoleCount;
  const credentialFenceFingerprint = result.credentialFenceFingerprint === undefined
    || result.credentialFenceFingerprint === null
    ? null
    : result.credentialFenceFingerprint;
  const managedAccessState = result.managedAccessState === undefined
    || result.managedAccessState === null
    ? null
    : result.managedAccessState;
  if (
    (endpointId !== null && (
      typeof endpointId !== "string"
      || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(endpointId)
    ))
    || (databaseCount !== null && (
      typeof databaseCount !== "number"
      || !Number.isInteger(databaseCount)
      || databaseCount < 0
      || databaseCount > 200
    ))
    || (databaseFingerprint !== null && (
      typeof databaseFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(databaseFingerprint)
    ))
    || ((databaseCount === null) !== (databaseFingerprint === null))
    || (retiredInheritedRoleCount !== null && (
      typeof retiredInheritedRoleCount !== "number"
      || !Number.isInteger(retiredInheritedRoleCount)
      || retiredInheritedRoleCount < 0
      || retiredInheritedRoleCount > 200
    ))
    || (credentialFenceFingerprint !== null && (
      typeof credentialFenceFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(credentialFenceFingerprint)
    ))
    || ((retiredInheritedRoleCount === null) !== (credentialFenceFingerprint === null))
    || (managedAccessState !== null && (
      typeof managedAccessState !== "string"
      || !managedAccessStates.includes(managedAccessState as ProviderManagedAccessState)
    ))
  ) {
    return null;
  }
  return {
    endpointId: endpointId as string | null,
    databaseCount: databaseCount as number | null,
    databaseFingerprint: databaseFingerprint as string | null,
    retiredInheritedRoleCount: retiredInheritedRoleCount as number | null,
    credentialFenceFingerprint: credentialFenceFingerprint as string | null,
    managedAccessState: managedAccessState as ProviderManagedAccessState | null,
  };
}

export function executionRecord(
  row: ProviderOperationExecutionRow | undefined,
  input: {
    organizationId: string;
    integrationId: string;
    integrationGeneration: bigint;
    operationId: string;
  },
): ProviderOperationExecutionRecord | null {
  const plan = planRecord(row, input);
  const executionResult = row ? executionResultProjection(row.redactedResult) : null;
  if (
    !row
    || !plan
    || !executionResult
    || (row.claimId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(row.claimId))
    || (row.providerOperationId !== null
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(row.providerOperationId))
    || (row.providerResourceId !== null
      && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(row.providerResourceId))
    || (row.failureCode !== null
      && !/^[A-Z][A-Z0-9_]{0,95}$/.test(row.failureCode))
  ) {
    return null;
  }
  return {
    ...plan,
    claimId: row.claimId,
    remoteStartedAt: optionalDate(row.remoteStartedAt),
    providerOperationId: row.providerOperationId,
    providerResourceId: row.providerResourceId,
    reconcileAfter: optionalDate(row.reconcileAfter),
    ...executionResult,
    failureCode: row.failureCode,
  };
}

export async function loadProviderOperationExecution(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  kind: ProviderOperationKind;
}): Promise<ProviderOperationExecutionRecord | null> {
  const result = await db.execute<ProviderOperationExecutionRow>(sql`
    SELECT operation."id" AS "id", operation."kind" AS "kind",
      operation."state" AS "state",
      operation."plan_hash" AS "planHash",
      operation."plan_expires_at" AS "planExpiresAt",
      operation."risk" AS "risk",
      operation."approval_policy" AS "approvalPolicy",
      operation."redacted_plan" AS "redactedPlan",
      operation."ownership_marker" AS "ownershipMarker",
      operation."claim_id" AS "claimId",
      operation."remote_started_at" AS "remoteStartedAt",
      operation."provider_operation_id" AS "providerOperationId",
      operation."provider_resource_id" AS "providerResourceId",
      operation."reconcile_after" AS "reconcileAfter",
      operation."redacted_result" AS "redactedResult",
      operation."failure_code" AS "failureCode"
    FROM ${workspaceProviderOperation} AS operation
    WHERE operation."id" = ${input.operationId}
      AND operation."organization_id" = ${input.organizationId}
      AND operation."integration_id" = ${input.integrationId}
      AND operation."provider" = 'neon'
      AND operation."kind" = ${input.kind}
      AND operation."integration_generation" = ${input.integrationGeneration}
    LIMIT 1
  `);
  return executionRecord(result.rows[0], {
    organizationId: input.organizationId,
    integrationId: input.integrationId,
    integrationGeneration: input.integrationGeneration,
    operationId: input.operationId,
  });
}

/**
 * Lists one integration generation's redacted operations for the workspace
 * approval surface. Provider secrets, requester identifiers, approval actor
 * identifiers, and ownership markers never leave this store boundary.
 */
export async function listProviderOperationExecutions(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  currentMemberId: string;
  currentUserId: string;
}): Promise<ProviderOperationListRecord[]> {
  const result = await db.execute<ProviderOperationListRow>(sql`
    SELECT operation."id" AS "id", operation."kind" AS "kind",
      operation."state" AS "state",
      operation."plan_hash" AS "planHash",
      operation."plan_expires_at" AS "planExpiresAt",
      operation."risk" AS "risk",
      operation."approval_policy" AS "approvalPolicy",
      operation."redacted_plan" AS "redactedPlan",
      operation."ownership_marker" AS "ownershipMarker",
      operation."claim_id" AS "claimId",
      operation."remote_started_at" AS "remoteStartedAt",
      operation."provider_operation_id" AS "providerOperationId",
      operation."provider_resource_id" AS "providerResourceId",
      operation."reconcile_after" AS "reconcileAfter",
      operation."redacted_result" AS "redactedResult",
      operation."failure_code" AS "failureCode",
      operation."requested_by_member_id" AS "requestedByMemberId",
      operation."requested_by_user_id" AS "requestedByUserId",
      EXISTS (
        SELECT 1
        FROM ${workspaceProviderOperationApproval} AS operation_approval
        JOIN ${session} AS requester_session
          ON requester_session."id" = operation."requested_by_session_id"
         AND requester_session."user_id" = operation."requested_by_user_id"
         AND requester_session."expires_at" > ${utcNow}
        JOIN ${member} AS requester_member
          ON requester_member."id" = operation."requested_by_member_id"
         AND requester_member."organization_id" = operation."organization_id"
         AND requester_member."user_id" = operation."requested_by_user_id"
         AND requester_member."role" = operation."requested_by_role"
         AND requester_member."role" IN ('admin', 'owner')
         AND requester_member."revocation_pending_at" IS NULL
         AND requester_member."revocation_claim_id" IS NULL
        JOIN ${session} AS approver_session
          ON approver_session."id" = operation_approval."actor_session_id"
         AND approver_session."user_id" = operation_approval."actor_user_id"
         AND approver_session."expires_at" > ${utcNow}
        JOIN ${member} AS approver_member
          ON approver_member."id" = operation_approval."actor_member_id"
         AND approver_member."organization_id" = operation_approval."organization_id"
         AND approver_member."user_id" = operation_approval."actor_user_id"
         AND approver_member."role" = operation_approval."actor_role"
         AND approver_member."role" IN ('admin', 'owner')
         AND approver_member."revocation_pending_at" IS NULL
         AND approver_member."revocation_claim_id" IS NULL
        WHERE operation_approval."organization_id" = operation."organization_id"
          AND operation_approval."operation_id" = operation."id"
          AND operation_approval."plan_hash" = operation."plan_hash"
          AND operation_approval."decision" = 'approved'
          AND (
            operation."approval_policy" <> 'separate_admin'
            OR (
              operation_approval."actor_member_id" <> operation."requested_by_member_id"
              AND operation_approval."actor_user_id" <> operation."requested_by_user_id"
            )
          )
      ) AS "executionAuthorityLive"
    FROM ${workspaceProviderOperation} AS operation
    WHERE operation."organization_id" = ${input.organizationId}
      AND operation."integration_id" = ${input.integrationId}
      AND operation."provider" = 'neon'
      AND operation."kind" IN (
        'neon.branch.create', 'neon.branch.delete', 'neon.branch.switch'
      )
      AND operation."integration_generation" = ${input.integrationGeneration}
    ORDER BY operation."updated_at" DESC, operation."id" DESC
    LIMIT ${MAX_PROVIDER_RESULTS + 1}
  `);
  if (result.rows.length > MAX_PROVIDER_RESULTS) {
    throw new ProviderRequestError(
      "neon",
      "Workspace Neon operation scope is too large to inspect safely",
      409,
    );
  }
  return result.rows.map((raw) => {
    const row = { ...raw, executionAuthorityLive: (raw.executionAuthorityLive as unknown) === 1 ? true : (raw.executionAuthorityLive as unknown) === 0 ? false : raw.executionAuthorityLive };
    const operation = executionRecord(row, {
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      integrationGeneration: input.integrationGeneration,
      operationId: row.id,
    });
    if (
      !operation
      || typeof row.executionAuthorityLive !== "boolean"
      || row.requestedByMemberId.length === 0
      || row.requestedByUserId.length === 0
    ) {
      throw new ProviderRequestError(
        "neon",
        "Workspace Neon operation inventory is invalid",
        409,
      );
    }
    return {
      ...operation,
      requestedByCurrentActor: row.requestedByMemberId === input.currentMemberId
        && row.requestedByUserId === input.currentUserId,
      executionAuthorityLive: row.executionAuthorityLive,
    };
  });
}
