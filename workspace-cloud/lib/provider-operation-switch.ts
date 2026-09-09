import "server-only";

import { sql } from "drizzle-orm";

import { atomicD1 } from "./d1/atomic";
import { jsonEqual } from "./d1/json";
import { uuidDefault } from "./d1/schema/values";
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

import { assertPlan, safeRedactedValue } from "./provider-operation-records";
import { assertExecutionIdentity, type ProviderOperationExecutionIdentity } from "./provider-operation-authority";

export type NeonBranchSwitchCompletionRecord = Readonly<{
  operationId: string;
  connectionId: string;
  contentRevision: number;
  authorityRevision: number;
  targetBranchId: string;
}>;

export type NeonBranchSwitchCompletionRow = {
  operationId: string;
  connectionId: string;
  contentRevision: number | string;
  authorityRevision: number | string;
  targetBranchId: string;
};

/**
 * Commits one already approved and provider-verified branch switch. The old
 * lease epoch must be empty and owned by the exact connection revocation claim.
 * Canonical target discovery, connection target/revision, immutable version,
 * operation completion, and both audits succeed or roll back together.
 */
export async function completeNeonBranchSwitch(
  input: ProviderOperationExecutionIdentity & {
    claimId: string;
    connectionClaimId: string;
    plan: NeonBranchSwitchPlan;
    targetProjection: ProviderImportProjection;
    now: Date;
  },
): Promise<NeonBranchSwitchCompletionRecord | null> {
  assertExecutionIdentity(input);
  assertPlan({
    organizationId: input.authority.organizationId,
    integrationId: input.integrationId,
    integrationGeneration: input.integrationGeneration,
    operationId: input.operationId,
    planHash: input.planHash,
    ownershipMarker: input.ownershipMarker,
    plan: input.plan,
  });
  const projection = input.targetProjection;
  const resource = projection.resource;
  const metadata = projection.metadata;
  if (
    input.kind !== "neon.branch.switch"
    || input.plan.kind !== "neon.branch.switch"
    || Number.isNaN(input.now.valueOf())
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.claimId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.connectionClaimId)
    || input.plan.source.authorityRevision >= 9_007_199_254_740_991
    || projection.fingerprint !== input.plan.target.resourceFingerprint
    || projection.fingerprint !== providerResourceFingerprint("neon", resource)
    || resource.project !== input.plan.target.projectId
    || resource.branch !== input.plan.target.branchId
    || resource.databaseId !== input.plan.target.databaseId
    || resource.database !== input.plan.target.database
    || resource.engine !== "postgres"
    || !Array.isArray(resource.schemas)
    || resource.schemas.length !== input.plan.source.schemas.length
    || resource.schemas.some((schema, index) => schema !== input.plan.source.schemas[index])
    || metadata.production !== (input.plan.target.environment === "production")
    || projection.capabilities.discover !== true
    || projection.capabilities.importReadOnly !== true
    || projection.capabilities.managedLease !== true
    || projection.capabilities.write !== true
    || projection.host !== "neon.managed.invalid"
    || projection.port !== 5432
    || projection.database !== input.plan.target.database
    || projection.engine !== "postgres"
    || projection.sslmode !== "verify-full"
  ) {
    throw new Error("Invalid Neon branch switch completion");
  }
  safeRedactedValue({
    resource: projection.resource,
    metadata: projection.metadata,
    capabilities: projection.capabilities,
  });
  const expectedAuthorityRevision = input.plan.source.authorityRevision + 1;
  const nextContentRevision = input.plan.source.contentRevision + 1;
  const committedAt = input.now.toISOString();
  if (
    !Number.isSafeInteger(expectedAuthorityRevision)
    || !Number.isSafeInteger(nextContentRevision)
  ) {
    throw new Error("Invalid Neon branch switch revision");
  }
  const versionPayload = {
    name: input.plan.source.connectionName,
    engine: "postgres" as const,
    provider: "neon" as const,
    driverId: null,
    host: projection.host,
    port: projection.port,
    database: projection.database,
    sslmode: projection.sslmode,
    readonlyDefault: input.plan.source.readonlyDefault,
    allowWrites: input.plan.source.allowWrites,
    env: input.plan.target.environment,
    schemaGroup: input.plan.source.schemaGroup,
    deleted: false,
  };
  const redactedResult = {
    version: 1,
    status: "ready",
    branchId: input.plan.target.branchId,
    providerOperationId: null,
    providerOperationStatus: null,
    endpointId: input.plan.target.endpointId,
    databaseCount: 1,
    databaseFingerprint: input.plan.target.databaseFingerprint,
    retiredInheritedRoleCount: null,
    credentialFenceFingerprint: null,
    managedAccessState: "ready",
    resourceFingerprint: input.plan.target.resourceFingerprint,
    failureCode: null,
    observedAt: input.now.toISOString(),
  };
  safeRedactedValue(redactedResult);
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
  const connectionAuditId = workspaceAuditEventId(
    "connection:neon-branch-switch",
    input.operationId,
  );
  const operationAuditId = workspaceAuditEventId(
    "provider-operation:switch-complete",
    input.claimId,
  );
  const targetResourceId = crypto.randomUUID();
  const result = await atomicD1({
    scope: sql`    WITH operation_scope AS MATERIALIZED (
      SELECT operation."id", operation."organization_id",
        operation."integration_id", operation."risk",
        operation."approval_policy"
      FROM ${workspaceProviderOperation} AS operation
      WHERE operation."id" = ${input.operationId}
        AND operation."organization_id" = ${input.authority.organizationId}
        AND operation."integration_id" = ${input.integrationId}
        AND operation."integration_generation" = ${input.integrationGeneration}
        AND operation."provider" = 'neon'
        AND operation."kind" = 'neon.branch.switch'
        AND operation."state" IN ('remote_started', 'reconciling')
        AND operation."claim_id" = ${input.claimId}
        AND operation."plan_hash" = ${input.planHash}
        AND operation."ownership_marker" = ${input.ownershipMarker}
        AND ${jsonEqual(sql`operation."redacted_plan"`, sql`${canonicalJson(input.plan)}`)}
        AND ${authority}

    ), connection_scope AS MATERIALIZED (
      SELECT connection."id", connection."organization_id",
        connection."content_revision", connection."revision",
        parent."id" AS "parentVersionId"
      FROM ${workspaceConnection} AS connection
      JOIN operation_scope
        ON operation_scope."organization_id" = connection."organization_id"
      JOIN ${workspaceConnectionGrant} AS manager_grant
        ON manager_grant."organization_id" = connection."organization_id"
       AND manager_grant."connection_id" = connection."id"
       AND manager_grant."member_id" = ${input.authority.membershipId}
       AND manager_grant."capability" = 'manage'
      JOIN ${workspaceProviderResource} AS source_resource
        ON source_resource."organization_id" = connection."organization_id"
       AND source_resource."id" = connection."provider_resource_id"
       AND source_resource."provider" = 'neon'
      JOIN ${workspaceResourceVersion} AS parent
        ON parent."organization_id" = connection."organization_id"
       AND parent."resource_type" = 'connection'
       AND parent."resource_id" = connection."id"
       AND parent."branch" = 'main'
       AND parent."revision" = connection."content_revision"
      WHERE connection."id" = ${input.plan.source.connectionId}
        AND connection."provider" = 'neon'
        AND connection."credential_mode" = 'managed'
        AND connection."provider_integration_id" = operation_scope."integration_id"
        AND connection."provider_resource_id" = ${input.plan.source.providerResourceId}
        AND ${jsonEqual(sql`source_resource."resource"`, sql`connection."provider_resource"`)}
        AND connection."provider_resource"->>'project' = ${input.plan.source.projectId}
        AND connection."provider_resource"->>'branch' = ${input.plan.source.branchId}
        AND connection."provider_resource"->>'databaseId' = ${input.plan.source.databaseId}
        AND connection."provider_resource"->>'database' = ${input.plan.source.database}
        AND connection."name" = ${input.plan.source.connectionName}
        AND connection."readonly_default" = ${input.plan.source.readonlyDefault}
        AND connection."allow_writes" = ${input.plan.source.allowWrites}
        AND connection."schema_group" IS ${input.plan.source.schemaGroup}
        AND connection."environment" = ${input.plan.source.environment}
        AND connection."content_revision" = ${input.plan.source.contentRevision}
        AND connection."revision" = ${expectedAuthorityRevision}
        AND connection."revocation_pending_at" IS NOT NULL
        AND connection."revocation_claim_id" = ${input.connectionClaimId}
        AND connection."deleted_at" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ${workspaceCredentialLease} AS live_lease
          WHERE live_lease."organization_id" = connection."organization_id"
            AND live_lease."connection_id" = connection."id"
            AND live_lease."revoked_at" IS NULL
        )

    ), target_resource AS (SELECT id, resource FROM workspace_provider_resource
        WHERE organization_id = ${input.authority.organizationId} AND provider = 'neon' AND resource_fingerprint = ${projection.fingerprint})
      SELECT json_object('targetId', COALESCE((SELECT id FROM target_resource), ${targetResourceId}),
        'parentVersionId', connection_scope.parentVersionId, 'risk', operation_scope.risk, 'approvalPolicy', operation_scope.approval_policy) AS payload
      FROM connection_scope JOIN operation_scope ON TRUE
      WHERE (NOT EXISTS (SELECT 1 FROM target_resource) OR EXISTS (SELECT 1 FROM target_resource
        WHERE ${jsonEqual(sql`resource`, sql`${canonicalJson(projection.resource)}`)}))
        AND NOT EXISTS (SELECT 1 FROM workspace_connection WHERE organization_id = ${input.authority.organizationId}
          AND provider_resource_id = (SELECT id FROM target_resource) AND id <> ${input.plan.source.connectionId} AND deleted_at IS NULL)`,
    statements: (scope) => [
      sql`INSERT INTO workspace_provider_resource (id, organization_id, provider, resource_fingerprint, resource, redacted_metadata, capability_manifest, updated_at)
        SELECT json_extract(payload, '$.targetId'), ${input.authority.organizationId}, 'neon', ${projection.fingerprint},
          ${canonicalJson(projection.resource)}, ${canonicalJson(projection.metadata)}, ${canonicalJson(projection.capabilities)}, ${committedAt}
        FROM (${scope}) WHERE TRUE ON CONFLICT (organization_id, provider, resource_fingerprint) DO UPDATE SET
          resource = excluded.resource, redacted_metadata = excluded.redacted_metadata, capability_manifest = excluded.capability_manifest, updated_at = excluded.updated_at`,
      sql`UPDATE workspace_connection SET host = ${projection.host}, port = ${projection.port}, database_name = ${projection.database},
          sslmode = ${projection.sslmode}, environment = ${input.plan.target.environment},
          provider_resource_id = (SELECT json_extract(payload, '$.targetId') FROM (${scope})), provider_resource = ${canonicalJson(projection.resource)},
          content_revision = content_revision + 1, revocation_pending_at = NULL, revocation_claimed_at = NULL, revocation_claim_id = NULL, updated_at = ${committedAt}
        WHERE id = ${input.plan.source.connectionId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_resource_version (id, organization_id, resource_type, resource_id, revision, base_revision,
          parent_version_id, branch, operation, payload, payload_hash, created_by_user_id)
        SELECT ${uuidDefault}, ${input.authority.organizationId}, 'connection', ${input.plan.source.connectionId}, ${nextContentRevision},
          ${input.plan.source.contentRevision}, json_extract(payload, '$.parentVersionId'), 'main', 'update',
          ${canonicalJson(versionPayload)}, ${canonicalHash(versionPayload)}, ${input.authority.userId} FROM (${scope})`,
      sql`UPDATE workspace_provider_operation SET state = 'succeeded', provider_resource_id = ${input.plan.target.branchId},
          redacted_result = ${canonicalJson(redactedResult)}, failure_code = NULL, reconcile_after = NULL, completed_at = ${committedAt}, updated_at = ${committedAt}
        WHERE id = ${input.operationId} AND EXISTS (${scope})`,
      sql`INSERT INTO workspace_audit_event (id, organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${connectionAuditId}, ${input.authority.organizationId}, ${input.authority.userId}, 'connection.provider_target.switch', 'connection', ${input.plan.source.connectionId},
          json_object('provider', 'neon', 'sourceBranchId', ${input.plan.source.branchId}, 'targetBranchId', ${input.plan.target.branchId},
            'contentRevision', ${nextContentRevision}, 'authorityRevision', ${expectedAuthorityRevision}, 'activeLeaseCount', ${input.plan.impact.activeLeaseCount}), ${input.claimId}
        FROM (${scope})`,
      sql`INSERT INTO workspace_audit_event (id, organization_id, actor_user_id, action, resource_type, resource_id, redacted_summary, request_id)
        SELECT ${operationAuditId}, ${input.authority.organizationId}, ${input.authority.userId}, 'provider.operation.succeeded', 'provider_operation', ${input.operationId},
          json_object('provider', 'neon', 'kind', 'neon.branch.switch', 'connectionId', ${input.plan.source.connectionId},
            'sourceBranchId', ${input.plan.source.branchId}, 'targetBranchId', ${input.plan.target.branchId},
            'resourceFingerprint', ${input.plan.target.resourceFingerprint}, 'risk', json_extract(payload, '$.risk'),
            'approvalPolicy', json_extract(payload, '$.approvalPolicy')), ${input.claimId} FROM (${scope})`,
      sql`SELECT ${input.operationId} AS operationId, id AS connectionId, content_revision AS contentRevision, revision AS authorityRevision,
          ${input.plan.target.branchId} AS targetBranchId FROM workspace_connection WHERE id = ${input.plan.source.connectionId} AND EXISTS (${scope})`,
    ],
  });
  const row = result.rows[6][0];
  const contentRevision = row ? Number(row.contentRevision) : Number.NaN;
  const authorityRevision = row ? Number(row.authorityRevision) : Number.NaN;
  if (
    !row
    || row.operationId !== input.operationId
    || row.connectionId !== input.plan.source.connectionId
    || row.targetBranchId !== input.plan.target.branchId
    || contentRevision !== nextContentRevision
    || authorityRevision !== expectedAuthorityRevision
  ) {
    return null;
  }
  return {
    operationId: row.operationId,
    connectionId: row.connectionId,
    contentRevision,
    authorityRevision,
    targetBranchId: row.targetBranchId,
  };
}
