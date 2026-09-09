import "server-only";

import { sql } from "drizzle-orm";

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

import { executionResultProjection, operationStates, type ProviderManagedAccessState, type ProviderOperationState } from "./provider-operation-records";

export type NeonBranchManagedAccessBoundary = Readonly<{
  operationId: string;
  state: ProviderOperationState;
  planHash: string;
  ownershipMarker: string;
  branchId: string;
  endpointId: string | null;
  databaseFingerprint: string | null;
  credentialFenceFingerprint: string | null;
  managedAccessState: ProviderManagedAccessState;
  bootstrapProviderAuditId: string | null;
  bootstrapResourceFingerprint: string | null;
  bootstrapPlanHash: string | null;
  bootstrapReadyAt: Date | null;
}>;

export type NeonBranchManagedAccessRow = {
  id: string;
  state: string;
  planHash: string;
  ownershipMarker: string;
  providerResourceId: string;
  redactedResult: unknown;
};

export function bootstrapResultProjection(
  value: unknown,
  branchId: string,
): Pick<
  NeonBranchManagedAccessBoundary,
  | "bootstrapProviderAuditId"
  | "bootstrapResourceFingerprint"
  | "bootstrapPlanHash"
  | "bootstrapReadyAt"
> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const providerAuditId = result.bootstrapProviderAuditId ?? null;
  const resourceFingerprint = result.bootstrapResourceFingerprint ?? null;
  const planHash = result.bootstrapPlanHash ?? null;
  const readyAtValue = result.bootstrapReadyAt ?? null;
  const allNull = providerAuditId === null
    && resourceFingerprint === null
    && planHash === null
    && readyAtValue === null;
  if (allNull) {
    return {
      bootstrapProviderAuditId: null,
      bootstrapResourceFingerprint: null,
      bootstrapPlanHash: null,
      bootstrapReadyAt: null,
    };
  }
  const readyAt = typeof readyAtValue === "string" ? new Date(readyAtValue) : null;
  if (
    typeof providerAuditId !== "string"
    || !providerAuditId.startsWith(`${branchId}:`)
    || providerAuditId.length > 512
    || /[\u0000-\u001f\u007f]/.test(providerAuditId)
    || typeof resourceFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(resourceFingerprint)
    || typeof planHash !== "string"
    || !/^[0-9a-f]{64}$/.test(planHash)
    || !readyAt
    || Number.isNaN(readyAt.valueOf())
  ) {
    return null;
  }
  return {
    bootstrapProviderAuditId: providerAuditId,
    bootstrapResourceFingerprint: resourceFingerprint,
    bootstrapPlanHash: planHash,
    bootstrapReadyAt: readyAt,
  };
}

export function neonBranchManagedAccessBoundary(
  row: NeonBranchManagedAccessRow,
): NeonBranchManagedAccessBoundary | null {
  const execution = executionResultProjection(row.redactedResult);
  const bootstrap = bootstrapResultProjection(row.redactedResult, row.providerResourceId);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(row.id)
    || !operationStates.includes(row.state as ProviderOperationState)
    || !/^[0-9a-f]{64}$/.test(row.planHash)
    || !/^v1\.[A-Za-z0-9_-]{43}$/.test(row.ownershipMarker)
    || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(row.providerResourceId)
    || !execution
    || !execution.managedAccessState
    || !bootstrap
    || (
      (execution.managedAccessState === "bootstrap_required"
        || execution.managedAccessState === "ready")
      && (
        execution.endpointId === null
        || execution.databaseFingerprint === null
        || execution.credentialFenceFingerprint === null
      )
    )
    || (execution.managedAccessState === "ready"
      && bootstrap.bootstrapReadyAt === null)
    || (execution.managedAccessState !== "ready"
      && bootstrap.bootstrapReadyAt !== null)
  ) {
    return null;
  }
  return {
    operationId: row.id,
    state: row.state as ProviderOperationState,
    planHash: row.planHash,
    ownershipMarker: row.ownershipMarker,
    branchId: row.providerResourceId,
    endpointId: execution.endpointId,
    databaseFingerprint: execution.databaseFingerprint,
    credentialFenceFingerprint: execution.credentialFenceFingerprint,
    managedAccessState: execution.managedAccessState,
    ...bootstrap,
  };
}

export async function listNeonBranchManagedAccessBoundaries(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  projectId: string;
}): Promise<readonly NeonBranchManagedAccessBoundary[]> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(input.integrationId)
    || input.integrationGeneration < 1n
    || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(input.projectId)
  ) {
    throw new Error("Invalid Neon branch managed-access scope");
  }
  const result = await db.execute<NeonBranchManagedAccessRow>(sql`
    SELECT operation."id" AS "id", operation."state" AS "state",
      operation."plan_hash" AS "planHash",
      operation."ownership_marker" AS "ownershipMarker",
      operation."provider_resource_id" AS "providerResourceId",
      operation."redacted_result" AS "redactedResult"
    FROM ${workspaceProviderOperation} AS operation
    WHERE operation."organization_id" = ${input.organizationId}
      AND operation."integration_id" = ${input.integrationId}
      AND operation."provider" = 'neon'
      AND operation."kind" = 'neon.branch.create'
      AND operation."integration_generation" = ${input.integrationGeneration}
      AND operation."resource_scope" = ${input.projectId}
      AND operation."provider_resource_id" IS NOT NULL
      AND operation."state" <> 'cancelled'
      AND NOT EXISTS (
        SELECT 1
        FROM ${workspaceProviderOperation} AS deletion
        WHERE deletion."organization_id" = operation."organization_id"
          AND deletion."integration_id" = operation."integration_id"
          AND deletion."integration_generation" = operation."integration_generation"
          AND deletion."provider" = 'neon'
          AND deletion."kind" = 'neon.branch.delete'
          AND deletion."resource_scope" = operation."resource_scope"
          AND deletion."source_resource_id" = operation."provider_resource_id"
          AND deletion."state" = 'succeeded'
      )
    ORDER BY operation."created_at" DESC, operation."id" DESC
    LIMIT ${MAX_PROVIDER_RESULTS + 1}
  `);
  if (result.rows.length > MAX_PROVIDER_RESULTS) {
    throw new ProviderRequestError(
      "neon",
      "Workspace Neon branch operation scope is too large",
      409,
    );
  }
  const boundaries: NeonBranchManagedAccessBoundary[] = [];
  const seen = new Set<string>();
  for (const row of result.rows) {
    const boundary = neonBranchManagedAccessBoundary(row);
    if (!boundary || seen.has(row.providerResourceId)) {
      throw new ProviderRequestError(
        "neon",
        "Neon branch managed-access authority is inconsistent",
        409,
      );
    }
    seen.add(row.providerResourceId);
    boundaries.push(boundary);
  }
  return boundaries;
}

export async function neonBranchManagedAccessBoundaryFor(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  projectId: string;
  branchId: string;
}) {
  const boundaries = await listNeonBranchManagedAccessBoundaries(input);
  return boundaries.find((boundary) => boundary.branchId === input.branchId) ?? null;
}

export async function requireNeonBranchManagedAccessReady(input: {
  organizationId: string;
  integrationId: string;
  integrationGeneration: bigint;
  projectId: string;
  branchId: string;
}) {
  const boundary = await neonBranchManagedAccessBoundaryFor(input);
  if (!boundary) return null;
  if (
    boundary.state !== "succeeded"
    || boundary.managedAccessState !== "ready"
  ) {
    throw new ProviderRequestError(
      "neon",
      boundary.managedAccessState === "bootstrap_required"
        ? "Complete Neon branch bootstrap before managed access"
        : "Neon branch managed access needs repair",
      409,
    );
  }
  return boundary;
}
