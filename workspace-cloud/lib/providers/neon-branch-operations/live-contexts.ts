// Fresh Provider and workspace snapshots used to plan, approve, and execute
// Neon branch mutations. Every caller revalidates against these exact shapes.
import "server-only";

import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "../../db";
import type { ActiveProviderIntegration } from "../../provider-integrations/authority";
import { verifiedNeonProjectCredential } from "../../provider-integrations/integration";
import { neonBranchManagedAccessBoundaryFor } from "../../provider-operation-store";
import {
  workspaceConnection,
  workspaceCredentialLease,
  workspaceProviderResource,
} from "../../schema";
import { providerResourceSupportsWrite } from "../../workspace-connections";
import { canonicalHash } from "../../workspace-versioning";
import { MAX_PROVIDER_RESULTS } from "../adapter-contract";
import { providerImportProjection } from "../import-projection";
import {
  listNeonBranchEndpointIds,
  listNeonBranchInventory,
  listNeonDatabases,
  neonBranchDatabaseFingerprint,
  validateNeonResource,
  verifyNeonBranchOwnership,
} from "../neon";
import { parseNeonResource } from "../neon-core";
import { ProviderRequestError } from "../provider-types";

export async function liveCreatePlanContext(input: {
  workspaceId: string;
  integrationId: string;
  integration: ActiveProviderIntegration;
  projectId: string;
  sourceBranchId: string;
}) {
  const credential = await verifiedNeonProjectCredential(
    input.integration,
    input.projectId,
  );
  const [inventory, connectionRows] = await Promise.all([
    listNeonBranchInventory(credential, input.projectId),
    db.select({
      environment: workspaceConnection.environment,
      resource: workspaceConnection.providerResource,
    }).from(workspaceConnection).where(and(
      eq(workspaceConnection.organizationId, input.workspaceId),
      eq(workspaceConnection.providerIntegrationId, input.integrationId),
      eq(workspaceConnection.credentialMode, "managed"),
      isNull(workspaceConnection.deletedAt),
      isNull(workspaceConnection.revocationPendingAt),
    )).limit(MAX_PROVIDER_RESULTS + 1),
  ]);
  if (connectionRows.length > MAX_PROVIDER_RESULTS) {
    throw new ProviderRequestError(
      "neon",
      "Workspace Neon connection scope is too large to plan safely",
      409,
    );
  }
  let workspaceProductionReference = false;
  for (const row of connectionRows) {
    let resource;
    try {
      resource = parseNeonResource(row.resource);
    } catch {
      throw new ProviderRequestError(
        "neon",
        "Workspace Neon connection target is invalid",
        409,
      );
    }
    if (
      resource.project === input.projectId
      && resource.branch === input.sourceBranchId
      && row.environment === "production"
    ) {
      workspaceProductionReference = true;
    }
  }
  return { credential, inventory, workspaceProductionReference };
}

export async function liveDeletePlanContext(input: {
  workspaceId: string;
  integrationId: string;
  integration: ActiveProviderIntegration;
  projectId: string;
  branchId: string;
}) {
  const credential = await verifiedNeonProjectCredential(
    input.integration,
    input.projectId,
  );
  const now = new Date();
  const [inventory, connectionRows, activeLeaseRows, ownership, endpointIds] = await Promise.all([
    listNeonBranchInventory(credential, input.projectId),
    db.select({
      id: workspaceConnection.id,
      resource: workspaceConnection.providerResource,
      deletedAt: workspaceConnection.deletedAt,
    }).from(workspaceConnection).where(and(
      eq(workspaceConnection.organizationId, input.workspaceId),
      eq(workspaceConnection.providerIntegrationId, input.integrationId),
      eq(workspaceConnection.credentialMode, "managed"),
    )).limit(MAX_PROVIDER_RESULTS + 1),
    db.select({
      connectionId: workspaceCredentialLease.connectionId,
      activeLeaseCount: count(),
    }).from(workspaceCredentialLease).where(and(
      eq(workspaceCredentialLease.organizationId, input.workspaceId),
      eq(workspaceCredentialLease.organizationId, input.workspaceId),
      eq(workspaceCredentialLease.integrationId, input.integrationId),
      isNull(workspaceCredentialLease.revokedAt),
      gt(workspaceCredentialLease.expiresAt, now),
    )).groupBy(workspaceCredentialLease.connectionId).limit(MAX_PROVIDER_RESULTS + 1),
    neonBranchManagedAccessBoundaryFor({
      organizationId: input.workspaceId,
      integrationId: input.integrationId,
      integrationGeneration: input.integration.generation,
      projectId: input.projectId,
      branchId: input.branchId,
    }),
    listNeonBranchEndpointIds(credential, input.projectId, input.branchId),
  ]);
  if (
    connectionRows.length > MAX_PROVIDER_RESULTS
    || activeLeaseRows.length > MAX_PROVIDER_RESULTS
  ) {
    throw new ProviderRequestError(
      "neon",
      "Workspace Neon reference scope is too large to plan safely",
      409,
    );
  }
  if (!ownership) {
    throw new ProviderRequestError(
      "neon",
      "Only a DopeDB-owned Neon branch can be deleted",
      409,
    );
  }
  const owned = await verifyNeonBranchOwnership({
    credential,
    projectId: input.projectId,
    branchId: input.branchId,
    operationId: ownership.operationId,
    planHash: ownership.planHash,
    ownershipMarker: ownership.ownershipMarker,
  });
  if (!owned) {
    throw new ProviderRequestError(
      "neon",
      "Neon branch ownership marker changed",
      409,
    );
  }
  const activeLeases = new Map(
    activeLeaseRows.map((row) => [row.connectionId, row.activeLeaseCount]),
  );
  let connectionCount = 0;
  let activeLeaseCount = 0;
  for (const row of connectionRows) {
    let resource;
    try {
      resource = parseNeonResource(row.resource);
    } catch {
      throw new ProviderRequestError(
        "neon",
        "Workspace Neon connection target is invalid",
        409,
      );
    }
    if (
      resource.project !== input.projectId
      || resource.branch !== input.branchId
    ) {
      continue;
    }
    if (row.deletedAt === null) connectionCount += 1;
    activeLeaseCount += activeLeases.get(row.id) ?? 0;
  }
  return {
    credential,
    inventory,
    ownership,
    references: {
      connectionCount,
      activeLeaseCount,
      endpointIds,
    },
  };
}

export async function liveSwitchTargetContext(input: {
  workspaceId: string;
  integrationId: string;
  integration: ActiveProviderIntegration;
  projectId: string;
  targetBranchId: string;
  database: string;
  schemas: readonly string[];
  targetEnvironment: "development" | "production";
}) {
  const credential = await verifiedNeonProjectCredential(
    input.integration,
    input.projectId,
  );
  const [inventory, databases, boundary] = await Promise.all([
    listNeonBranchInventory(credential, input.projectId),
    listNeonDatabases(credential, input.projectId, input.targetBranchId),
    neonBranchManagedAccessBoundaryFor({
      organizationId: input.workspaceId,
      integrationId: input.integrationId,
      integrationGeneration: input.integration.generation,
      projectId: input.projectId,
      branchId: input.targetBranchId,
    }),
  ]);
  const targetBranches = inventory.branches.filter(
    (branch) => branch.id === input.targetBranchId,
  );
  const targetBranch = targetBranches.length === 1 ? targetBranches[0] : null;
  const matchingDatabases = databases.filter(
    (database) => database.name === input.database,
  );
  const targetDatabase = matchingDatabases.length === 1 ? matchingDatabases[0] : null;
  const databaseFingerprint = neonBranchDatabaseFingerprint(databases);
  if (
    !targetBranch
    || !targetDatabase
    || (boundary !== null && (
      boundary.state !== "succeeded"
      || boundary.managedAccessState !== "ready"
      || boundary.branchId !== input.targetBranchId
      || boundary.endpointId === null
      || boundary.databaseFingerprint !== databaseFingerprint
    ))
  ) {
    throw new ProviderRequestError(
      "neon",
      "Neon target branch managed access is not ready",
      409,
    );
  }
  const resource = parseNeonResource({
    project: input.projectId,
    branch: input.targetBranchId,
    databaseId: targetDatabase.id,
    database: targetDatabase.name,
    engine: "postgres",
    schemas: [...input.schemas],
  });
  const verification = await validateNeonResource(
    credential,
    resource,
    "write",
    input.targetEnvironment === "production",
  );
  if (boundary && verification.endpointId !== boundary.endpointId) {
    throw new ProviderRequestError(
      "neon",
      "Neon target endpoint identity changed",
      409,
    );
  }
  const projection = providerImportProjection("neon", resource, {
    production: input.targetEnvironment === "production",
    writeAvailable: true,
    neonBranchTarget: {
      provider: "neon",
      projectId: input.projectId,
      branchId: targetBranch.id,
      name: targetBranch.name,
      currentState: targetBranch.currentState,
      pendingState: targetBranch.pendingState,
      default: targetBranch.default,
      protected: targetBranch.protected,
    },
  });
  return {
    credential,
    inventory,
    projection,
    target: {
      branch: targetBranch,
      databaseId: targetDatabase.id,
      database: targetDatabase.name,
      endpointId: verification.endpointId,
      databaseFingerprint,
      resourceFingerprint: projection.fingerprint,
      managedAccessOperationId: boundary?.operationId ?? null,
    },
  };
}

export async function liveSwitchPlanContext(input: {
  workspaceId: string;
  integrationId: string;
  integration: ActiveProviderIntegration;
  connectionId: string;
  projectId: string;
  targetBranchId: string;
  targetEnvironment: "development" | "production";
}) {
  const now = new Date();
  const [connectionRows, activeLeaseRows] = await Promise.all([
    db.select({
      id: workspaceConnection.id,
      name: workspaceConnection.name,
      providerResourceId: workspaceConnection.providerResourceId,
      resource: workspaceConnection.providerResource,
      canonicalResource: workspaceProviderResource.resource,
      capabilityManifest: workspaceProviderResource.capabilityManifest,
      environment: workspaceConnection.environment,
      readonlyDefault: workspaceConnection.readonlyDefault,
      allowWrites: workspaceConnection.allowWrites,
      schemaGroup: workspaceConnection.schemaGroup,
      contentRevision: workspaceConnection.contentRevision,
      authorityRevision: workspaceConnection.revision,
      revocationPendingAt: workspaceConnection.revocationPendingAt,
    }).from(workspaceConnection).innerJoin(
      workspaceProviderResource,
      and(
        eq(workspaceProviderResource.organizationId, workspaceConnection.organizationId),
        eq(workspaceProviderResource.id, workspaceConnection.providerResourceId),
        eq(workspaceProviderResource.provider, workspaceConnection.provider),
      ),
    ).where(and(
      eq(workspaceConnection.organizationId, input.workspaceId),
      eq(workspaceConnection.id, input.connectionId),
      eq(workspaceConnection.providerIntegrationId, input.integrationId),
      eq(workspaceConnection.provider, "neon"),
      eq(workspaceConnection.credentialMode, "managed"),
      isNull(workspaceConnection.deletedAt),
    )).limit(2),
    db.select({ activeLeaseCount: count() }).from(workspaceCredentialLease).where(and(
      eq(workspaceCredentialLease.organizationId, input.workspaceId),
      eq(workspaceCredentialLease.connectionId, input.connectionId),
      eq(workspaceCredentialLease.integrationId, input.integrationId),
      isNull(workspaceCredentialLease.revokedAt),
      gt(workspaceCredentialLease.expiresAt, now),
    )),
  ]);
  const connection = connectionRows.length === 1 ? connectionRows[0] : null;
  const connectionEnvironment = connection?.environment;
  if (
    !connection
    || !connection.providerResourceId
    || connection.revocationPendingAt !== null
    || (connectionEnvironment !== "development" && connectionEnvironment !== "production")
    || canonicalHash(connection.resource) !== canonicalHash(connection.canonicalResource)
    || (connection.allowWrites
      && !providerResourceSupportsWrite(connection.capabilityManifest))
  ) {
    throw new ProviderRequestError(
      "neon",
      "Neon source connection is not ready for a target switch",
      409,
    );
  }
  const stableEnvironment: "development" | "production" = connectionEnvironment;
  const source = parseNeonResource(connection.resource);
  if (source.project !== input.projectId || source.branch === input.targetBranchId) {
    throw new ProviderRequestError(
      "neon",
      "Neon connection target does not match the switch request",
      409,
    );
  }
  const targetReferences = await db.select({ id: workspaceConnection.id })
    .from(workspaceConnection).where(and(
      eq(workspaceConnection.organizationId, input.workspaceId),
      eq(workspaceConnection.providerIntegrationId, input.integrationId),
      eq(workspaceConnection.provider, "neon"),
      eq(workspaceConnection.credentialMode, "managed"),
      isNull(workspaceConnection.deletedAt),
      sql`${workspaceConnection.id} <> ${input.connectionId}`,
      sql`${workspaceConnection.providerResource} ->> 'project' = ${input.projectId}`,
      sql`${workspaceConnection.providerResource} ->> 'branch' = ${input.targetBranchId}`,
      sql`${workspaceConnection.providerResource} ->> 'database' = ${source.database}`,
    )).limit(1);
  if (targetReferences.length > 0) {
    throw new ProviderRequestError(
      "neon",
      "Neon target database is already shared by another connection",
      409,
    );
  }
  const target = await liveSwitchTargetContext({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    integration: input.integration,
    projectId: input.projectId,
    targetBranchId: input.targetBranchId,
    database: source.database,
    schemas: source.schemas,
    targetEnvironment: input.targetEnvironment,
  });
  const activeLeaseCount = activeLeaseRows[0]?.activeLeaseCount ?? 0;
  return {
    ...target,
    connection: {
      connectionId: connection.id,
      connectionName: connection.name,
      providerResourceId: connection.providerResourceId,
      projectId: source.project,
      sourceBranchId: source.branch,
      databaseId: source.databaseId,
      database: source.database,
      schemas: source.schemas,
      environment: stableEnvironment,
      readonlyDefault: connection.readonlyDefault,
      allowWrites: connection.allowWrites,
      schemaGroup: connection.schemaGroup,
      contentRevision: connection.contentRevision,
      authorityRevision: connection.authorityRevision,
      activeLeaseCount,
    },
  };
}
