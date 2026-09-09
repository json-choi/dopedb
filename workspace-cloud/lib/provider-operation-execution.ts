import "server-only";

import { sql } from "drizzle-orm";

import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { jsonEqual } from "./d1/json";
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

import { type ProviderOperationCancellationRecord, type ProviderOperationExecutionClaim, type ProviderOperationRemoteStart, type ProviderOperationState } from "./provider-operation-records";
import { assertExecutionIdentity, currentExecutionAuthoritySql, type ProviderOperationExecutionIdentity } from "./provider-operation-authority";

export type ProviderOperationClaimRow = {
  id: string;
  state: string;
  claimId: string;
  previousState: string;
};

export type ProviderOperationCancellationRow = {
  id: string;
  state: string;
  providerOperationId: string | null;
  providerResourceId: string | null;
  reconcileAfter: Date | string | null;
  failureCode: string | null;
};

// A plan that expired before the remote-start fence can be closed by any
// current workspace manager. This path deliberately does not require the
// requester or approver sessions to remain live: it only removes authority and
// is what lets a claim recover after the process or original session exits.
export async function cancelExpiredProviderOperationExecution(
  input: ProviderOperationExecutionIdentity & { now: Date },
): Promise<ProviderOperationCancellationRecord | null> {
  assertExecutionIdentity(input);
  if (Number.isNaN(input.now.valueOf())) {
    throw new Error("Invalid provider operation cancellation time");
  }
  const auditId = workspaceAuditEventId(
    "provider-operation:cancel-expired",
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
    scope: sql`    WITH candidate AS MATERIALIZED (
      SELECT operation."id", operation."organization_id", operation."state",
        operation."risk", operation."approval_policy"
      FROM ${workspaceProviderOperation} AS operation
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."provider" = 'neon'
        AND operation."kind" = ${input.kind}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND operation."state" IN ('approved', 'claimed')
        AND operation."remote_started_at" IS NULL
        AND operation."plan_expires_at" <= ${utcNow}
        AND ${authority}

    )
      SELECT json_object('id', candidate."id", 'organization_id', candidate."organization_id", 'state', candidate."state", 'risk', candidate."risk", 'approval_policy', candidate."approval_policy") AS payload FROM candidate`,
    statements: (scope) => {
      const candidate = sql`SELECT json_extract(payload, '$.id') AS "id", json_extract(payload, '$.organization_id') AS "organization_id", json_extract(payload, '$.state') AS "state", json_extract(payload, '$.risk') AS "risk", json_extract(payload, '$.approval_policy') AS "approval_policy" FROM (${scope})`;
      const updated = sql`SELECT operation."id" AS "id", operation."state" AS "state",
        operation."provider_operation_id" AS "providerOperationId",
        operation."provider_resource_id" AS "providerResourceId",
        operation."reconcile_after" AS "reconcileAfter",
        operation."failure_code" AS "failureCode",
        operation."organization_id" AS "organizationId",
        candidate."risk" AS "risk",
        candidate."approval_policy" AS "approvalPolicy"
        FROM ${workspaceProviderOperation} AS operation JOIN (${candidate}) AS candidate ON operation.id = candidate.id`;
      return [sql`UPDATE ${workspaceProviderOperation} AS operation
      SET "state" = 'cancelled',
        "reconcile_after" = NULL,
        "completed_at" = ${input.now},
        "updated_at" = ${input.now}
      FROM (${candidate}) AS candidate
      WHERE operation."id" = candidate."id"
        AND operation."organization_id" = candidate."organization_id"
        AND operation."state" = candidate."state"`, sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${auditId}, updated."organizationId",
        ${input.authority.userId}, 'provider.operation.cancelled',
        'provider_operation', updated."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'reason', 'plan_expired_before_remote_start',
          'risk', updated."risk",
          'approvalPolicy', updated."approvalPolicy"
        ), ${input.operationId}
      FROM (${updated}) AS updated WHERE TRUE
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`, updated];
    },
  });
  const row = result.rows.at(-1)?.[0] as ProviderOperationCancellationRow | undefined;
  if (
    !row
    || row.id !== input.operationId
    || row.state !== "cancelled"
    || row.providerOperationId !== null
    || row.providerResourceId !== null
    || row.reconcileAfter !== null
    || row.failureCode !== null
  ) {
    return null;
  }
  return {
    id: row.id,
    state: "cancelled",
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
  };
}

export async function claimProviderOperationExecution(
  input: ProviderOperationExecutionIdentity & { now: Date },
): Promise<ProviderOperationExecutionClaim | null> {
  assertExecutionIdentity(input);
  if (Number.isNaN(input.now.valueOf())) {
    throw new Error("Invalid provider operation claim time");
  }
  const claimId = crypto.randomUUID();
  const auditId = workspaceAuditEventId("provider-operation:claim", claimId);
  const authority = currentExecutionAuthoritySql(input);
  const result = await atomicD1({
    scope: sql`    WITH candidate AS MATERIALIZED (
      SELECT operation."id", operation."organization_id", operation."state",
        operation."claim_id", operation."risk", operation."approval_policy"
      FROM ${workspaceProviderOperation} AS operation
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."provider" = 'neon'
        AND operation."kind" = ${input.kind}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND operation."state" IN (
          'approved', 'claimed', 'remote_started', 'reconciling'
        )
        AND (
          operation."state" <> 'approved'
          OR operation."plan_expires_at" > ${utcNow}
        )
        AND ${authority}

    )
      SELECT json_object('id', candidate."id", 'organization_id', candidate."organization_id", 'state', candidate."state", 'risk', candidate."risk", 'approval_policy', candidate."approval_policy", 'claim_id', candidate."claim_id") AS payload FROM candidate`,
    statements: (scope) => {
      const candidate = sql`SELECT json_extract(payload, '$.id') AS "id", json_extract(payload, '$.organization_id') AS "organization_id", json_extract(payload, '$.state') AS "state", json_extract(payload, '$.risk') AS "risk", json_extract(payload, '$.approval_policy') AS "approval_policy", json_extract(payload, '$.claim_id') AS "claim_id" FROM (${scope})`;
      const updated = sql`SELECT operation."id" AS "id", operation."state" AS "state",
        operation."claim_id" AS "claimId",
        candidate."state" AS "previousState",
        operation."organization_id" AS "organizationId",
        candidate."risk" AS "risk",
        candidate."approval_policy" AS "approvalPolicy"
        FROM ${workspaceProviderOperation} AS operation JOIN (${candidate}) AS candidate ON operation.id = candidate.id`;
      return [sql`UPDATE ${workspaceProviderOperation} AS operation
      SET "state" = CASE
          WHEN candidate."state" = 'approved' THEN 'claimed'
          ELSE operation."state"
        END,
        "claim_id" = CASE
          WHEN candidate."state" = 'approved' THEN ${claimId}
          ELSE operation."claim_id"
        END,
        "claimed_at" = CASE
          WHEN candidate."state" = 'approved' THEN ${input.now}
          ELSE operation."claimed_at"
        END,
        "updated_at" = CASE
          WHEN candidate."state" = 'approved' THEN ${input.now}
          ELSE operation."updated_at"
        END
      FROM (${candidate}) AS candidate
      WHERE operation."id" = candidate."id"
        AND operation."organization_id" = candidate."organization_id"
        AND operation."state" = candidate."state"`, sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${auditId}, updated."organizationId",
        ${input.authority.userId}, 'provider.operation.claim',
        'provider_operation', updated."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'risk', updated."risk",
          'approvalPolicy', updated."approvalPolicy"
        ), updated."claimId"
      FROM (${updated}) AS updated
      WHERE updated."previousState" = 'approved'
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`, updated];
    },
  });
  const row = result.rows.at(-1)?.[0] as ProviderOperationClaimRow | undefined;
  if (
    !row
    || row.id !== input.operationId
    || !["claimed", "remote_started", "reconciling"].includes(row.state)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(row.claimId)
  ) {
    return null;
  }
  return {
    id: row.id,
    state: row.state as ProviderOperationState,
    claimId: row.claimId,
    claimedNow: row.previousState === "approved",
  };
}

export type ProviderOperationRemoteStartRow = ProviderOperationClaimRow;

export async function markProviderOperationRemoteStarted(
  input: ProviderOperationExecutionIdentity & { claimId: string; now: Date },
): Promise<ProviderOperationRemoteStart | null> {
  assertExecutionIdentity(input);
  if (
    Number.isNaN(input.now.valueOf())
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.claimId)
  ) {
    throw new Error("Invalid provider operation remote-start context");
  }
  const auditId = workspaceAuditEventId(
    "provider-operation:remote-start",
    input.claimId,
  );
  const authority = currentExecutionAuthoritySql(input);
  const result = await atomicD1({
    scope: sql`    WITH authorized_operation AS MATERIALIZED (
      SELECT operation."id", operation."organization_id", operation."state",
        operation."claim_id", operation."risk", operation."approval_policy",
        operation."plan_expires_at", operation."integration_id",
        operation."provider", operation."kind", operation."resource_scope",
        operation."source_resource_id", operation."redacted_plan"
      FROM ${workspaceProviderOperation} AS operation
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."provider" = 'neon'
        AND operation."kind" = ${input.kind}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND operation."claim_id" = ${input.claimId}
        AND operation."state" IN ('claimed', 'remote_started', 'reconciling')
        AND ${authority}
    ), switch_connection AS MATERIALIZED (
      SELECT branch_connection."id", authorized_operation."id" AS "operationId"
      FROM authorized_operation
      JOIN ${workspaceConnection} AS branch_connection
        ON branch_connection."organization_id" = authorized_operation."organization_id"
       AND branch_connection."id" = (
         authorized_operation."redacted_plan"->'source'->>'connectionId'
       )
      JOIN ${workspaceConnectionGrant} AS manager_grant
        ON manager_grant."organization_id" = branch_connection."organization_id"
       AND manager_grant."connection_id" = branch_connection."id"
       AND manager_grant."member_id" = ${input.authority.membershipId}
       AND manager_grant."capability" = 'manage'
      WHERE authorized_operation."kind" = 'neon.branch.switch'
        AND branch_connection."provider" = 'neon'
        AND branch_connection."credential_mode" = 'managed'
        AND branch_connection."provider_integration_id" = authorized_operation."integration_id"
        AND branch_connection."provider_resource_id"
          = authorized_operation."redacted_plan"->'source'->>'providerResourceId'
        AND branch_connection."provider_resource"->>'project'
          = authorized_operation."resource_scope"
        AND branch_connection."provider_resource"->>'branch'
          = authorized_operation."source_resource_id"
        AND branch_connection."provider_resource"->>'databaseId'
          = authorized_operation."redacted_plan"->'source'->>'databaseId'
        AND branch_connection."content_revision" = (
          authorized_operation."redacted_plan"->'source'->>'contentRevision'
        )
        AND branch_connection."revision" = (
          authorized_operation."redacted_plan"->'source'->>'authorityRevision'
        )
        AND branch_connection."deleted_at" IS NULL
        AND branch_connection."revocation_pending_at" IS NULL
        AND branch_connection."revocation_claim_id" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${workspaceConnection} AS target_connection
          WHERE target_connection."organization_id" = branch_connection."organization_id"
            AND target_connection."id" <> branch_connection."id"
            AND target_connection."provider" = 'neon'
            AND target_connection."credential_mode" = 'managed'
            AND target_connection."provider_integration_id" = authorized_operation."integration_id"
            AND target_connection."provider_resource"->>'project'
              = authorized_operation."resource_scope"
            AND target_connection."provider_resource"->>'branch'
              = authorized_operation."redacted_plan"->'target'->>'branchId'
            AND target_connection."provider_resource"->>'databaseId'
              = authorized_operation."redacted_plan"->'target'->>'databaseId'
            AND target_connection."deleted_at" IS NULL
        )
    ), candidate AS MATERIALIZED (
      SELECT authorized_operation.*
      FROM authorized_operation
      LEFT JOIN switch_connection
        ON switch_connection."operationId" = authorized_operation."id"
      WHERE (
        authorized_operation."kind" <> 'neon.branch.delete'
        OR (
          NOT EXISTS (
            SELECT 1
            FROM ${workspaceConnection} AS branch_connection
            WHERE branch_connection."organization_id" = authorized_operation."organization_id"
              AND branch_connection."provider_integration_id" = authorized_operation."integration_id"
              AND branch_connection."provider" = authorized_operation."provider"
              AND branch_connection."credential_mode" = 'managed'
              AND branch_connection."provider_resource" ->> 'project'
                = authorized_operation."resource_scope"
              AND branch_connection."provider_resource" ->> 'branch'
                = authorized_operation."source_resource_id"
              AND branch_connection."deleted_at" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${workspaceConnection} AS leased_connection
            JOIN ${workspaceCredentialLease} AS active_lease
              ON active_lease."organization_id" = leased_connection."organization_id"
             AND active_lease."connection_id" = leased_connection."id"
             AND active_lease."integration_id" = authorized_operation."integration_id"
             AND active_lease."revoked_at" IS NULL
             AND active_lease."expires_at" > ${utcNow}
            WHERE leased_connection."organization_id" = authorized_operation."organization_id"
              AND leased_connection."provider_integration_id" = authorized_operation."integration_id"
              AND leased_connection."provider" = authorized_operation."provider"
              AND leased_connection."credential_mode" = 'managed'
              AND leased_connection."provider_resource" ->> 'project'
                = authorized_operation."resource_scope"
              AND leased_connection."provider_resource" ->> 'branch'
                = authorized_operation."source_resource_id"
          )
        )
      )
        AND (
          authorized_operation."kind" <> 'neon.branch.switch'
          OR switch_connection."id" IS NOT NULL
        )
    )
      SELECT json_object('id', candidate."id", 'organization_id', candidate."organization_id", 'state', candidate."state", 'risk', candidate."risk", 'approval_policy', candidate."approval_policy", 'claim_id', candidate."claim_id", 'plan_expires_at', candidate."plan_expires_at") AS payload FROM candidate`,
    statements: (scope) => {
      const candidate = sql`SELECT json_extract(payload, '$.id') AS "id", json_extract(payload, '$.organization_id') AS "organization_id", json_extract(payload, '$.state') AS "state", json_extract(payload, '$.risk') AS "risk", json_extract(payload, '$.approval_policy') AS "approval_policy", json_extract(payload, '$.claim_id') AS "claim_id", json_extract(payload, '$.plan_expires_at') AS "plan_expires_at" FROM (${scope})`;
      const updated = sql`SELECT operation."id" AS "id", operation."state" AS "state",
        operation."claim_id" AS "claimId",
        candidate."state" AS "previousState",
        operation."organization_id" AS "organizationId",
        candidate."risk" AS "risk",
        candidate."approval_policy" AS "approvalPolicy"
        FROM ${workspaceProviderOperation} AS operation JOIN (${candidate}) AS candidate ON operation.id = candidate.id`;
      return [sql`UPDATE ${workspaceProviderOperation} AS operation
      SET "state" = CASE
          WHEN candidate."state" = 'claimed'
            AND candidate."plan_expires_at" <= ${utcNow} THEN 'cancelled'
          WHEN candidate."state" = 'claimed' THEN 'remote_started'
          ELSE operation."state"
        END,
        "remote_started_at" = CASE
          WHEN candidate."state" = 'claimed'
            AND candidate."plan_expires_at" > ${utcNow} THEN ${input.now}
          ELSE operation."remote_started_at"
        END,
        "completed_at" = CASE
          WHEN candidate."state" = 'claimed'
            AND candidate."plan_expires_at" <= ${utcNow} THEN ${input.now}
          ELSE operation."completed_at"
        END,
        "updated_at" = CASE
          WHEN candidate."state" = 'claimed' THEN ${input.now}
          ELSE operation."updated_at"
        END
      FROM (${candidate}) AS candidate
      WHERE operation."id" = candidate."id"
        AND operation."organization_id" = candidate."organization_id"
        AND operation."state" = candidate."state"`, sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${auditId}, updated."organizationId",
        ${input.authority.userId}, CASE
          WHEN updated."state" = 'cancelled' THEN 'provider.operation.cancelled'
          ELSE 'provider.operation.remote_started'
        END,
        'provider_operation', updated."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'reason', CASE
            WHEN updated."state" = 'cancelled'
              THEN 'plan_expired_before_remote_start'
            ELSE NULL
          END,
          'risk', updated."risk",
          'approvalPolicy', updated."approvalPolicy"
        ), updated."claimId"
      FROM (${updated}) AS updated
      WHERE updated."previousState" = 'claimed'
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`, updated];
    },
  });
  const row = result.rows.at(-1)?.[0] as ProviderOperationRemoteStartRow | undefined;
  if (
    !row
    || row.id !== input.operationId
    || !["remote_started", "reconciling", "cancelled"].includes(row.state)
    || row.claimId !== input.claimId
  ) {
    return null;
  }
  return {
    id: row.id,
    state: row.state as ProviderOperationRemoteStart["state"],
    claimId: row.claimId,
    startedNow: row.previousState === "claimed" && row.state === "remote_started",
  };
}
