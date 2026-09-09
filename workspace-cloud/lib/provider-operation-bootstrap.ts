import "server-only";

import { sql } from "drizzle-orm";

import { atomicD1 } from "./d1/atomic";
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

import { assertExecutionIdentity, type ProviderOperationExecutionIdentity } from "./provider-operation-authority";

export type ProviderOperationBootstrapCompletionRecord = Readonly<{
  operationId: string;
  managedAccessState: "ready";
  transitioned: boolean;
}>;

export async function completeProviderOperationBootstrap(
  input: ProviderOperationExecutionIdentity & {
    projectId: string;
    branchId: string;
    databaseFingerprint: string;
    credentialFenceFingerprint: string;
    providerAuditId: string;
    resourceFingerprint: string;
    bootstrapPlanHash: string;
    now: Date;
  },
): Promise<ProviderOperationBootstrapCompletionRecord | null> {
  assertExecutionIdentity(input);
  if (
    input.kind !== "neon.branch.create"
    || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(input.projectId)
    || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(input.branchId)
    || !/^[0-9a-f]{64}$/.test(input.databaseFingerprint)
    || !/^[0-9a-f]{64}$/.test(input.credentialFenceFingerprint)
    || !input.providerAuditId.startsWith(`${input.branchId}:`)
    || input.providerAuditId.length > 512
    || /[\u0000-\u001f\u007f]/.test(input.providerAuditId)
    || !/^[0-9a-f]{64}$/.test(input.resourceFingerprint)
    || !/^[0-9a-f]{64}$/.test(input.bootstrapPlanHash)
    || Number.isNaN(input.now.valueOf())
  ) {
    throw new Error("Invalid provider operation bootstrap completion");
  }
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
  const auditId = workspaceAuditEventId(
    "provider-operation:bootstrap",
    input.operationId,
  );
  const readyAt = input.now.toISOString();
  const result = await atomicD1({
    scope: sql`    WITH candidate AS MATERIALIZED (
      SELECT operation."id", operation."organization_id",
        operation."redacted_result"->>'managedAccessState'
          AS "previousManagedAccessState"
      FROM ${workspaceProviderOperation} AS operation
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."provider" = 'neon'
        AND operation."kind" = ${input.kind}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND operation."resource_scope" = ${input.projectId}
        AND operation."provider_resource_id" = ${input.branchId}
        AND operation."state" = 'succeeded'
        AND operation."redacted_result"->>'databaseFingerprint'
          = ${input.databaseFingerprint}
        AND operation."redacted_result"->>'credentialFenceFingerprint'
          = ${input.credentialFenceFingerprint}
        AND operation."redacted_result"->>'managedAccessState'
          IN ('bootstrap_required', 'ready')
        AND (
          operation."redacted_result"->>'managedAccessState' = 'bootstrap_required'
          OR (
            operation."redacted_result"->>'bootstrapProviderAuditId'
              = ${input.providerAuditId}
            AND operation."redacted_result"->>'bootstrapResourceFingerprint'
              = ${input.resourceFingerprint}
            AND operation."redacted_result"->>'bootstrapPlanHash'
              = ${input.bootstrapPlanHash}
          )
        )
        AND ${authority}

    )
      SELECT json_object('id', id, 'organization_id', organization_id, 'previousManagedAccessState', previousManagedAccessState) AS payload FROM candidate`,
    statements: (scope) => {
      const candidate = sql`SELECT json_extract(payload, '$.id') AS id, json_extract(payload, '$.organization_id') AS organization_id,
        json_extract(payload, '$.previousManagedAccessState') AS previousManagedAccessState FROM (${scope})`;
      return [sql`INSERT INTO ${workspaceAuditEvent} AS existing
        ("id", "organization_id", "actor_user_id", "action", "resource_type",
         "resource_id", "redacted_summary", "request_id")
      SELECT ${auditId}, candidate."organization_id",
        ${input.authority.userId}, 'provider.operation.bootstrap_ready',
        'provider_operation', candidate."id",
        json_object(
          'provider', 'neon',
          'kind', ${input.kind},
          'branchId', ${input.branchId},
          'providerAuditId', ${input.providerAuditId},
          'resourceFingerprint', ${input.resourceFingerprint},
          'bootstrapPlanHash', ${input.bootstrapPlanHash},
          'databaseFingerprint', ${input.databaseFingerprint},
          'credentialFenceFingerprint', ${input.credentialFenceFingerprint},
          'managedAccessState', 'ready'
        ), ${input.operationId}
      FROM (${candidate}) AS candidate
      WHERE candidate."previousManagedAccessState" = 'bootstrap_required'
      ON CONFLICT ("id") DO UPDATE SET "id" = CASE WHEN existing."organization_id" = EXCLUDED."organization_id"
        AND existing."actor_user_id" = EXCLUDED."actor_user_id"
        AND existing."action" = EXCLUDED."action"
        AND existing."resource_type" = EXCLUDED."resource_type"
        AND existing."resource_id" = EXCLUDED."resource_id"
        AND ${jsonEqual(sql`existing."redacted_summary"`, sql`EXCLUDED."redacted_summary"`)}
        AND existing."request_id" = EXCLUDED."request_id" THEN existing."id" ELSE NULL END`,
        sql`UPDATE workspace_provider_operation SET redacted_result = json_set(redacted_result,
            '$.managedAccessState', 'ready', '$.bootstrapProviderAuditId', ${input.providerAuditId},
            '$.bootstrapResourceFingerprint', ${input.resourceFingerprint}, '$.bootstrapPlanHash', ${input.bootstrapPlanHash},
            '$.bootstrapReadyAt', ${readyAt}), updated_at = ${input.now}
          WHERE id = ${input.operationId} AND EXISTS (SELECT 1 FROM (${candidate}) WHERE previousManagedAccessState = 'bootstrap_required')`,
        sql`SELECT operation.id, candidate.previousManagedAccessState, operation.redacted_result ->> 'managedAccessState' AS managedAccessState
          FROM workspace_provider_operation operation JOIN (${candidate}) candidate ON candidate.id = operation.id`,
      ];
    },
  });
  const row = result.rows[2][0];
  if (
    !row
    || row.id !== input.operationId
    || row.managedAccessState !== "ready"
    || (row.previousManagedAccessState !== "bootstrap_required"
      && row.previousManagedAccessState !== "ready")
  ) {
    return null;
  }
  return {
    operationId: row.id,
    managedAccessState: "ready",
    transitioned: row.previousManagedAccessState === "bootstrap_required",
  };
}
