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

import {
  executionResultProjection,
  managedAccessStates,
  operationStates,
  optionalDate,
  safeRedactedValue,
  type ProviderManagedAccessState,
  type ProviderOperationReconciliationInput,
  type ProviderOperationReconciliationRecord,
  type ProviderOperationState,
} from "./provider-operation-records";
import { assertExecutionIdentity, type ProviderOperationExecutionIdentity } from "./provider-operation-authority";

export type ProviderOperationReconciliationRow = {
  id: string;
  state: string;
  claimId: string;
  providerOperationId: string | null;
  providerResourceId: string | null;
  reconcileAfter: Date | string | null;
  redactedResult: unknown;
  failureCode: string | null;
};

export function validProviderReconciliation(input: ProviderOperationReconciliationInput) {
  const branchValid = input.branchId === null
    || /^[a-z0-9][a-z0-9-]{0,59}$/.test(input.branchId);
  const endpointValid = input.endpointId === null
    || /^[a-z0-9][a-z0-9-]{0,59}$/.test(input.endpointId);
  const operationValid = input.providerOperationId === null
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.providerOperationId);
  const statusValid = input.providerOperationStatus === null
    || NEON_OPERATION_STATUSES.includes(
      input.providerOperationStatus as typeof NEON_OPERATION_STATUSES[number],
    );
  const failureValid = input.failureCode === null
    || /^[A-Z][A-Z0-9_]{0,95}$/.test(input.failureCode);
  const databaseValid = (
    input.databaseCount === null
    && input.databaseFingerprint === null
  ) || (
    Number.isInteger(input.databaseCount)
    && input.databaseCount !== null
    && input.databaseCount >= 0
    && input.databaseCount <= 200
    && typeof input.databaseFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(input.databaseFingerprint)
  );
  const credentialFenceValid = (
    input.retiredInheritedRoleCount === null
    && input.credentialFenceFingerprint === null
  ) || (
    Number.isInteger(input.retiredInheritedRoleCount)
    && input.retiredInheritedRoleCount !== null
    && input.retiredInheritedRoleCount >= 0
    && input.retiredInheritedRoleCount <= 200
    && typeof input.credentialFenceFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(input.credentialFenceFingerprint)
  );
  return ["missing", "pending", "ready", "conflict", "failed"].includes(input.status)
    && branchValid
    && endpointValid
    && operationValid
    && statusValid
    && failureValid
    && databaseValid
    && credentialFenceValid
    && managedAccessStates.includes(input.managedAccessState)
    && (input.status !== "missing" || input.branchId === null)
    && (input.status !== "pending" || input.branchId !== null)
    && (input.status !== "ready" || (
      input.branchId !== null
      && input.failureCode === null
      && input.databaseCount !== null
      && input.databaseCount > 0
      && input.databaseFingerprint !== null
      && (
        (input.managedAccessState === "not_requested"
          && input.retiredInheritedRoleCount === null
          && input.credentialFenceFingerprint === null)
        || (input.managedAccessState === "bootstrap_required"
          && input.retiredInheritedRoleCount !== null
          && input.credentialFenceFingerprint !== null)
      )
    ))
    && (input.status !== "missing"
      || input.managedAccessState === "waiting_for_provider")
    && (input.status !== "pending" || (
      input.managedAccessState === "waiting_for_provider"
      && input.databaseCount === null
      && input.databaseFingerprint === null
      && input.retiredInheritedRoleCount === null
      && input.credentialFenceFingerprint === null
    ))
    && (input.status === "ready" || (
      input.retiredInheritedRoleCount === null
      && input.credentialFenceFingerprint === null
    ))
    && (input.status !== "conflict"
      || input.managedAccessState === "needs_repair")
    && (input.status !== "failed" || input.managedAccessState === (
      input.branchId === null ? "unavailable" : "needs_repair"
    ))
    && ((input.status !== "conflict" && input.status !== "failed")
      || input.failureCode !== null)
    && ((input.status === "conflict" || input.status === "failed")
      || input.failureCode === null);
}

export async function applyProviderOperationReconciliation(
  input: ProviderOperationExecutionIdentity & {
    claimId: string;
    result: ProviderOperationReconciliationInput;
    now: Date;
  },
): Promise<ProviderOperationReconciliationRecord | null> {
  assertExecutionIdentity(input);
  if (
    Number.isNaN(input.now.valueOf())
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.claimId)
    || !validProviderReconciliation(input.result)
  ) {
    throw new Error("Invalid provider operation reconciliation");
  }
  const redactedResult = {
    version: 1,
    status: input.result.status,
    branchId: input.result.branchId,
    providerOperationId: input.result.providerOperationId,
    providerOperationStatus: input.result.providerOperationStatus,
    endpointId: input.result.endpointId,
    databaseCount: input.result.databaseCount,
    databaseFingerprint: input.result.databaseFingerprint,
    retiredInheritedRoleCount: input.result.retiredInheritedRoleCount,
    credentialFenceFingerprint: input.result.credentialFenceFingerprint,
    managedAccessState: input.result.managedAccessState,
    failureCode: input.result.failureCode,
    observedAt: input.now.toISOString(),
  };
  safeRedactedValue(redactedResult);
  const reconcileAuditId = workspaceAuditEventId(
    input.result.credentialFenceFingerprint
      ? "provider-operation:reconcile-fenced"
      : "provider-operation:reconcile",
    input.claimId,
  );
  const completionAuditId = workspaceAuditEventId(
    input.result.credentialFenceFingerprint
      ? "provider-operation:complete-fenced"
      : "provider-operation:complete",
    input.claimId,
  );
  const missingCutoff = new Date(input.now.valueOf() - 2 * 60 * 1_000);
  const targetState = sql`CASE
    WHEN ${input.result.status} = 'ready' THEN 'succeeded'
    WHEN ${input.result.status} = 'conflict' THEN 'needs_repair'
    WHEN ${input.result.status} = 'failed' AND ${input.result.branchId} IS NULL
      THEN 'failed'
    WHEN ${input.result.status} = 'failed' THEN 'needs_repair'
    WHEN ${input.result.status} = 'missing'
      AND operation."remote_started_at" <= ${missingCutoff} THEN 'needs_repair'
    ELSE 'reconciling'
  END`;
  const targetFailureCode = sql`CASE
    WHEN ${input.result.status} IN ('conflict', 'failed')
      THEN ${input.result.failureCode}
    WHEN ${input.result.status} = 'missing'
      AND operation."remote_started_at" <= ${missingCutoff}
      THEN 'NEON_CREATE_RESULT_AMBIGUOUS'
    ELSE NULL
  END`;
  // Once the remote-start fence exists, the branch-create POST is never issued
  // again. Reconciliation may apply only the approved, idempotent inherited
  // credential fence before recording success. A current manager may therefore
  // finish the exact fenced recovery even after the original session expires.
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
        AND operation."claim_id" = ${input.claimId}
        AND (
          operation."state" IN ('remote_started', 'reconciling')
          OR (
            operation."state" = 'succeeded'
            AND operation."redacted_plan"->'target'->>'endpoint' = 'read_write'
            AND operation."redacted_result"->>'credentialFenceFingerprint' IS NULL
            AND ${input.result.status} = 'ready'
            AND ${input.result.managedAccessState} = 'bootstrap_required'
            AND ${input.result.credentialFenceFingerprint} IS NOT NULL
          )
        )
        AND (
          operation."provider_operation_id" IS NULL
          OR ${input.result.providerOperationId} IS NULL
          OR operation."provider_operation_id" = ${input.result.providerOperationId}
        )
        AND (
          operation."provider_resource_id" IS NULL
          OR ${input.result.branchId} IS NULL
          OR operation."provider_resource_id" = ${input.result.branchId}
        )
        AND (
          operation."redacted_result" IS NULL
          OR operation."redacted_result"->>'endpointId' IS NULL
          OR ${input.result.endpointId} IS NULL
          OR operation."redacted_result"->>'endpointId' = ${input.result.endpointId}
        )
        AND (
          operation."redacted_result" IS NULL
          OR operation."redacted_result"->>'databaseFingerprint' IS NULL
          OR ${input.result.databaseFingerprint} IS NULL
          OR operation."redacted_result"->>'databaseFingerprint'
            = ${input.result.databaseFingerprint}
        )
        AND (
          operation."redacted_result" IS NULL
          OR operation."redacted_result"->>'credentialFenceFingerprint' IS NULL
          OR ${input.result.credentialFenceFingerprint} IS NULL
          OR operation."redacted_result"->>'credentialFenceFingerprint'
            = ${input.result.credentialFenceFingerprint}
        )
        AND ${authority}

    )
      SELECT json_object('id', candidate."id", 'organization_id', candidate."organization_id", 'state', candidate."state", 'claim_id', candidate."claim_id", 'risk', candidate."risk", 'approval_policy', candidate."approval_policy") AS payload FROM candidate`,
    statements: (scope) => {
      const candidate = sql`SELECT json_extract(payload, '$.id') AS "id", json_extract(payload, '$.organization_id') AS "organization_id", json_extract(payload, '$.state') AS "state", json_extract(payload, '$.claim_id') AS "claim_id", json_extract(payload, '$.risk') AS "risk", json_extract(payload, '$.approval_policy') AS "approval_policy" FROM (${scope})`;
      const updated = sql`SELECT operation."id" AS "id", operation."state" AS "state",
        operation."claim_id" AS "claimId",
        operation."provider_operation_id" AS "providerOperationId",
        operation."provider_resource_id" AS "providerResourceId",
        operation."reconcile_after" AS "reconcileAfter",
        operation."redacted_result" AS "redactedResult",
        operation."failure_code" AS "failureCode",
        operation."organization_id" AS "organizationId",
        candidate."state" AS "previousState",
        candidate."risk" AS "risk",
        candidate."approval_policy" AS "approvalPolicy"
        FROM ${workspaceProviderOperation} AS operation JOIN (${candidate}) AS candidate ON operation.id = candidate.id`;
      return [sql`UPDATE ${workspaceProviderOperation} AS operation
      SET "state" = ${targetState},
        "provider_operation_id" = COALESCE(
          operation."provider_operation_id", ${input.result.providerOperationId}
        ),
        "provider_resource_id" = COALESCE(
          operation."provider_resource_id", ${input.result.branchId}
        ),
        "redacted_result" = json_set(${JSON.stringify(redactedResult)}, '$.endpointId', COALESCE(
              ${input.result.endpointId},
              operation."redacted_result"->>'endpointId'
            )
          ),
        "failure_code" = ${targetFailureCode},
        "reconcile_after" = CASE
          WHEN ${targetState} = 'reconciling'
            THEN ${new Date(input.now.valueOf() + 3_000)}
          ELSE NULL
        END,
        "completed_at" = CASE
          WHEN ${targetState} = 'reconciling' THEN NULL
          ELSE ${input.now}
        END,
        "updated_at" = ${input.now}
      FROM (${candidate}) AS candidate
      WHERE operation."id" = candidate."id"
        AND operation."organization_id" = candidate."organization_id"
        AND operation."state" = candidate."state"`, sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${reconcileAuditId}, updated."organizationId",
        ${input.authority.userId}, 'provider.operation.reconciling',
        'provider_operation', updated."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'observation', ${input.result.status},
          'branchId', ${input.result.branchId},
          'providerOperationId', ${input.result.providerOperationId},
          'risk', updated."risk",
          'approvalPolicy', updated."approvalPolicy"
        ), updated."claimId"
      FROM (${updated}) AS updated
      WHERE updated."previousState" = 'remote_started'
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`, sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${completionAuditId}, updated."organizationId",
        ${input.authority.userId},
        'provider.operation.' || updated."state",
        'provider_operation', updated."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'state', updated."state",
          'branchId', updated."providerResourceId",
          'providerOperationId', updated."providerOperationId",
          'endpointId', updated."redactedResult"->>'endpointId',
          'databaseCount', updated."redactedResult"->'databaseCount',
          'databaseFingerprint', updated."redactedResult"->>'databaseFingerprint',
          'retiredInheritedRoleCount',
            updated."redactedResult"->'retiredInheritedRoleCount',
          'credentialFenceFingerprint',
            updated."redactedResult"->>'credentialFenceFingerprint',
          'managedAccessState', updated."redactedResult"->>'managedAccessState',
          'failureCode', updated."failureCode",
          'risk', updated."risk",
          'approvalPolicy', updated."approvalPolicy"
        ), updated."claimId"
      FROM (${updated}) AS updated
      WHERE updated."state" <> 'reconciling'
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`, updated];
    },
  });
  const row = result.rows.at(-1)?.[0] as ProviderOperationReconciliationRow | undefined;
  const reconcileAfter = row ? optionalDate(row.reconcileAfter) : null;
  const executionResult = row ? executionResultProjection(row.redactedResult) : null;
  if (
    !row
    || !executionResult
    || row.id !== input.operationId
    || row.claimId !== input.claimId
    || !operationStates.includes(row.state as ProviderOperationState)
    || (row.providerOperationId !== null
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(row.providerOperationId))
    || (row.providerResourceId !== null
      && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(row.providerResourceId))
    || (row.failureCode !== null && !/^[A-Z][A-Z0-9_]{0,95}$/.test(row.failureCode))
  ) {
    return null;
  }
  return {
    id: row.id,
    state: row.state as ProviderOperationState,
    claimId: row.claimId,
    providerOperationId: row.providerOperationId,
    providerResourceId: row.providerResourceId,
    reconcileAfter,
    ...executionResult,
    managedAccessState: executionResult.managedAccessState ?? "unavailable",
    failureCode: row.failureCode,
  };
}
