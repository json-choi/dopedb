import "server-only";

import { sql } from "drizzle-orm";

import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
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

import {
  assertPlan,
  isProviderOperationKind,
  operationStates,
  planRecord,
  type NeonBranchOperationPlan,
  type ProviderOperationDecision,
  type ProviderOperationDecisionRecord,
  type ProviderOperationKind,
  type ProviderOperationPlanRecord,
  type ProviderOperationPlanRow,
  type ProviderOperationState,
} from "./provider-operation-records";

export function providerOperationPlanStorage(plan: NeonBranchOperationPlan) {
  if (plan.kind === "neon.branch.create") {
    return {
      projectId: plan.source.projectId,
      sourceResourceId: plan.source.branchId,
      targetName: plan.target.name,
      audit: {
        provider: "neon",
        kind: plan.kind,
        planHash: "",
        risk: plan.risk,
        approvalPolicy: plan.approvalPolicy,
        projectId: plan.source.projectId,
        sourceBranchId: plan.source.branchId,
        targetName: plan.target.name,
        initSource: plan.target.initSource,
        sourcePoint: plan.source.point.kind,
        endpoint: plan.target.endpoint,
        credentialPolicy: plan.target.endpoint === "read_write"
          ? "retire_inherited_dopedb_roles"
          : "no_endpoint",
      },
    };
  }
  if (plan.kind === "neon.branch.switch") {
    return {
      projectId: plan.source.projectId,
      sourceResourceId: plan.source.branchId,
      targetName: plan.target.name,
      audit: {
        provider: "neon",
        kind: plan.kind,
        planHash: "",
        risk: plan.risk,
        approvalPolicy: plan.approvalPolicy,
        projectId: plan.source.projectId,
        connectionId: plan.source.connectionId,
        sourceBranchId: plan.source.branchId,
        targetBranchId: plan.target.branchId,
        sourceEnvironment: plan.source.environment,
        targetEnvironment: plan.target.environment,
        contentRevision: plan.source.contentRevision,
        authorityRevision: plan.source.authorityRevision,
        activeLeaseCount: plan.impact.activeLeaseCount,
      },
    };
  }
  return {
    projectId: plan.target.projectId,
    sourceResourceId: plan.target.branchId,
    targetName: plan.target.name,
    audit: {
      provider: "neon",
      kind: plan.kind,
      planHash: "",
      risk: plan.risk,
      approvalPolicy: plan.approvalPolicy,
      projectId: plan.target.projectId,
      targetBranchId: plan.target.branchId,
      targetName: plan.target.name,
      deletionMode: plan.deletionMode,
      connectionCount: plan.references.connectionCount,
      activeLeaseCount: plan.references.activeLeaseCount,
      endpointCount: plan.references.endpointIds.length,
      createOperationId: plan.ownership.createOperationId,
    },
  };
}

export async function recordProviderOperationPlan(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  idempotencyKey: string;
  requestHash: string;
  planHash: string;
  ownershipMarker: string;
  plan: NeonBranchOperationPlan;
  now: Date;
}): Promise<ProviderOperationPlanRecord | null> {
  assertPlan({
    organizationId: input.authority.organizationId,
    integrationId: input.integrationId,
    integrationGeneration: input.integrationGeneration,
    operationId: input.operationId,
    planHash: input.planHash,
    ownershipMarker: input.ownershipMarker,
    plan: input.plan,
  });
  const planStorage = providerOperationPlanStorage(input.plan);
  const validPlanPolicy = input.plan.kind === "neon.branch.create"
    ? input.plan.risk === (input.plan.target.copiesData
      && input.plan.source.environment === "production" ? "production_data" : "standard")
      && input.plan.approvalPolicy === (input.plan.risk === "production_data"
        ? "separate_admin" : "single_admin")
    : input.plan.kind === "neon.branch.switch"
      ? input.plan.risk === (
        input.plan.source.environment === "production"
          || input.plan.target.environment === "production"
          ? "production_data"
          : "standard"
      )
        && input.plan.approvalPolicy === (input.plan.risk === "production_data"
          ? "separate_admin"
          : "single_admin")
        && input.plan.source.activeLeaseCount === input.plan.impact.activeLeaseCount
        && input.plan.impact.closesExistingSessions === true
        && input.plan.impact.createsConnectionRevision === true
        && input.plan.impact.reintrospectionRequired === true
      : input.plan.risk === "standard"
        && input.plan.approvalPolicy === "single_admin"
        && input.plan.deletionMode === "provider_default_soft_delete"
        && input.plan.references.connectionCount === 0
        && input.plan.references.activeLeaseCount === 0;
  if (
    !/^[0-9a-f]{64}$/.test(input.requestHash)
    || !validPlanPolicy
    || input.plan.expiresAt !== new Date(
      input.now.valueOf() + 10 * 60 * 1_000,
    ).toISOString()
  ) {
    throw new Error("Invalid provider operation plan");
  }

  const auditId = workspaceAuditEventId(
    "provider-operation:plan",
    input.idempotencyKey,
  );
  const authority = providerMutationAuthoritySql({
    ...input.authority,
    requireManager: true,
    integration: {
      id: input.integrationId,
      provider: "neon",
      generation: input.integrationGeneration,
      claimId: null,
    },
  });
  const result = await atomicD1({
    scope: sql`WITH existing AS (SELECT * FROM workspace_provider_operation
        WHERE organization_id = ${input.authority.organizationId} AND idempotency_key = ${input.idempotencyKey})
      SELECT json_object('id', COALESCE((SELECT id FROM existing), ${input.operationId}),
        'created', NOT EXISTS (SELECT 1 FROM existing)) AS payload FROM workspace_provider_integration integration
      WHERE integration.id = ${input.integrationId} AND integration.organization_id = ${input.authority.organizationId}
        AND integration.provider = 'neon' AND integration.generation = ${input.integrationGeneration}
        AND integration.status = 'active' AND integration.refresh_phase = 'idle' AND integration.revoked_at IS NULL
        AND integration.revocation_pending_at IS NULL AND integration.revocation_claim_id IS NULL AND ${authority}
        AND (NOT EXISTS (SELECT 1 FROM existing) OR EXISTS (SELECT 1 FROM existing
          WHERE request_hash = ${input.requestHash} AND provider = 'neon' AND kind = ${input.plan.kind}
            AND integration_id = ${input.integrationId} AND integration_generation = ${input.integrationGeneration}))`,
    statements: (scope) => [
      sql`INSERT INTO workspace_provider_operation (id, organization_id, integration_id, provider, integration_generation,
          kind, state, idempotency_key, request_hash, plan_hash, plan_version, plan_expires_at, risk, approval_policy,
          requested_by_member_id, requested_by_user_id, requested_by_session_id, requested_by_role,
          resource_scope, source_resource_id, target_name, ownership_marker, redacted_plan, created_at, updated_at)
        SELECT ${input.operationId}, ${input.authority.organizationId}, ${input.integrationId}, 'neon', ${input.integrationGeneration},
          ${input.plan.kind}, 'awaiting_approval', ${input.idempotencyKey}, ${input.requestHash}, ${input.planHash}, 1,
          ${new Date(input.plan.expiresAt)}, ${input.plan.risk}, ${input.plan.approvalPolicy}, ${input.authority.membershipId},
          ${input.authority.userId}, ${input.authority.sessionId}, ${input.authority.role}, ${planStorage.projectId},
          ${planStorage.sourceResourceId}, ${planStorage.targetName}, ${input.ownershipMarker}, ${canonicalJson(input.plan)}, ${input.now}, ${input.now}
        FROM (${scope}) WHERE json_extract(payload, '$.created') = 1`,
      sql`INSERT INTO workspace_audit_event (id, organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${auditId}, ${input.authority.organizationId}, ${input.authority.userId}, 'provider.operation.plan', 'provider_operation',
          ${input.operationId}, ${canonicalJson({ ...planStorage.audit, planHash: input.planHash })}, ${input.idempotencyKey}
        FROM (${scope}) WHERE json_extract(payload, '$.created') = 1`,
      sql`SELECT id, kind, state, plan_hash AS planHash, plan_expires_at AS planExpiresAt, risk, approval_policy AS approvalPolicy,
          redacted_plan AS redactedPlan, ownership_marker AS ownershipMarker FROM workspace_provider_operation
        WHERE id = (SELECT json_extract(payload, '$.id') FROM (${scope}))`,
    ],
  });
  return planRecord(result.rows[2][0] as ProviderOperationPlanRow | undefined, {
    organizationId: input.authority.organizationId,
    integrationId: input.integrationId,
    integrationGeneration: input.integrationGeneration,
    operationId: input.operationId,
  });
}

export type ProviderOperationDecisionRow = {
  id: string;
  state: string;
  decision: string;
  approvalId: string;
};

/**
 * Records one terminal approval decision and its audit consequence while the
 * requester, approver, integration generation, plan, and ownership marker are
 * all still authoritative. Production-data approval must come from another
 * administrator identity. Exact retries return the original approval row.
 */
export async function decideProviderOperation(input: {
  authority: ProviderMutationAuthority;
  integrationId: string;
  integrationGeneration: bigint;
  operationId: string;
  kind: ProviderOperationKind;
  planHash: string;
  ownershipMarker: string;
  decision: ProviderOperationDecision;
  now: Date;
}): Promise<ProviderOperationDecisionRecord | null> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.integrationId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.operationId)
    || !/^[0-9a-f]{64}$/.test(input.planHash)
    || !isProviderOperationKind(input.kind)
    || (input.decision !== "approved" && input.decision !== "rejected")
    || input.integrationGeneration < 1n
    || Number.isNaN(input.now.valueOf())
    || !verifyProviderOperationOwnershipMarker({
      organizationId: input.authority.organizationId,
      integrationId: input.integrationId,
      integrationGeneration: input.integrationGeneration,
      operationId: input.operationId,
      planHash: input.planHash,
      marker: input.ownershipMarker,
    })
  ) {
    throw new Error("Invalid provider operation decision");
  }

  const approvalId = crypto.randomUUID();
  const expectedState = input.decision === "approved" ? "approved" : "cancelled";
  const auditId = workspaceAuditEventId(
    "provider-operation:decision",
    input.operationId,
  );
  const authority = providerMutationAuthoritySql({
    ...input.authority,
    requireManager: true,
    integration: {
      id: input.integrationId,
      provider: "neon",
      generation: input.integrationGeneration,
      claimId: null,
    },
  });
  const result = await atomicD1({
    scope: sql`    WITH live_operation AS MATERIALIZED (
      SELECT operation.*
      FROM ${workspaceProviderOperation} AS operation
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
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."provider" = 'neon'
        AND operation."kind" = ${input.kind}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND (
          operation."state" = 'awaiting_approval'
          OR EXISTS (
            SELECT 1
            FROM ${workspaceProviderOperationApproval} AS prior_approval
            WHERE prior_approval."organization_id" = operation."organization_id"
              AND prior_approval."operation_id" = operation."id"
              AND prior_approval."plan_hash" = operation."plan_hash"
              AND prior_approval."decision" = ${input.decision}
              AND prior_approval."actor_member_id" = ${input.authority.membershipId}
              AND prior_approval."actor_user_id" = ${input.authority.userId}
              AND prior_approval."actor_session_id" = ${input.authority.sessionId}
              AND prior_approval."actor_role" = ${input.authority.role}
          )
        )
        AND (
          ${input.decision} = 'approved'
          OR operation."state" IN ('awaiting_approval', 'cancelled')
        )
        AND (
          ${input.decision} <> 'approved'
          OR operation."state" <> 'awaiting_approval'
          OR operation."plan_expires_at" > ${utcNow}
        )
        AND (
          ${input.decision} <> 'approved'
          OR operation."approval_policy" <> 'separate_admin'
          OR (
            operation."requested_by_member_id" <> ${input.authority.membershipId}
            AND operation."requested_by_user_id" <> ${input.authority.userId}
          )
        )
        AND ${authority}

    )
      SELECT json_object('id', operation.id, 'created', NOT EXISTS (SELECT 1 FROM workspace_provider_operation_approval
        WHERE organization_id = operation.organization_id AND operation_id = operation.id)) AS payload
      FROM live_operation operation WHERE NOT EXISTS (SELECT 1 FROM workspace_provider_operation_approval prior
        WHERE prior.organization_id = operation.organization_id AND prior.operation_id = operation.id
          AND NOT (prior.plan_hash = ${input.planHash} AND prior.decision = ${input.decision}
            AND prior.actor_member_id = ${input.authority.membershipId} AND prior.actor_user_id = ${input.authority.userId}
            AND prior.actor_session_id = ${input.authority.sessionId} AND prior.actor_role = ${input.authority.role}))`,
    statements: (scope) => [
      sql`INSERT INTO workspace_provider_operation_approval (id, organization_id, operation_id, plan_hash, decision,
          actor_member_id, actor_user_id, actor_session_id, actor_role, created_at)
        SELECT ${approvalId}, ${input.authority.organizationId}, ${input.operationId}, ${input.planHash}, ${input.decision},
          ${input.authority.membershipId}, ${input.authority.userId}, ${input.authority.sessionId}, ${input.authority.role}, ${input.now}
        FROM (${scope}) WHERE json_extract(payload, '$.created') = 1`,
      sql`UPDATE workspace_provider_operation SET state = ${expectedState},
          completed_at = CASE WHEN ${input.decision} = 'rejected' THEN ${input.now} ELSE completed_at END, updated_at = ${input.now}
        WHERE id = ${input.operationId} AND state = 'awaiting_approval' AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (id, organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${auditId}, ${input.authority.organizationId}, ${input.authority.userId}, 'provider.operation.decision', 'provider_operation', ${input.operationId},
          json_object('provider', 'neon', 'kind', ${input.kind}, 'decision', ${input.decision}, 'planHash', operation.plan_hash,
            'risk', operation.risk, 'approvalPolicy', operation.approval_policy), ${input.operationId}
        FROM workspace_provider_operation operation WHERE id = ${input.operationId}
          AND EXISTS (SELECT 1 FROM (${scope}) WHERE json_extract(payload, '$.created') = 1)`,
      sql`SELECT operation.id, operation.state, approval.decision, approval.id AS approvalId FROM workspace_provider_operation operation
        JOIN workspace_provider_operation_approval approval ON approval.organization_id = operation.organization_id AND approval.operation_id = operation.id
        WHERE operation.id = ${input.operationId} AND EXISTS (${scope})`,
    ],
  });
  const row = result.rows[3][0] as ProviderOperationDecisionRow | undefined;
  if (
    !row
    || row.id !== input.operationId
    || !operationStates.includes(row.state as ProviderOperationState)
    || row.decision !== input.decision
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(row.approvalId)
  ) {
    return null;
  }
  return {
    id: row.id,
    state: row.state as ProviderOperationState,
    decision: row.decision,
    approvalId: row.approvalId,
    replayed: row.approvalId !== approvalId,
  };
}
