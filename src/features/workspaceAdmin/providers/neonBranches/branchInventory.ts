// Strict parser for one Neon project's live branch tree: every branch, the shared
// connections pinned to it, DopeDB-owned branch boundaries and the connections whose
// branch disappeared. A malformed branch rejects the whole tree; the answer is then
// bound to the exact integration generation and project that was asked for.
import {
  NEON_BRANCH_STATES,
  NEON_MANAGED_ACCESS_STATES,
  NEON_OPERATION_STATES,
  NeonBranchResponseError,
  type NeonBranchConnectionReference,
  type NeonBranchInventory,
  type NeonBranchInventoryItem,
  type NeonBranchState,
  type NeonIntegrationRef,
  type NeonMissingTarget,
} from "./domain";
import {
  exact,
  generation,
  instant,
  integer,
  isNeonSegment,
  isSafeNeonText,
  nullable,
  oneOf,
  reasonCode,
  record,
  uuid,
} from "./parsingPrimitives";

const branchFields = [
  "id", "projectId", "parentId", "treeParentId", "name", "currentState",
  "pendingState", "stateChangedAt", "createdAt", "updatedAt", "creationSource",
  "initSource", "sourceLsn", "sourceTimestamp", "default", "protected",
  "expiresAt", "restrictedActions", "production", "ready", "depth", "connections",
];
// Present only for branches DopeDB created and still tracks.
const optionalBranchFields = ["managedAccess", "deletion"];

function parseConnection(value: unknown): NeonBranchConnectionReference | null {
  const row = exact(value, [
    "connectionId",
    "connectionName",
    "database",
    "environment",
    "allowWrites",
    "contentRevision",
    "authorityRevision",
    "activeLeaseCount",
  ]);
  if (
    !row
    || !uuid(row.connectionId)
    || !isSafeNeonText(row.connectionName, 120)
    || !isSafeNeonText(row.database, 256)
    || !nullable(row.environment, (candidate): candidate is string => isSafeNeonText(candidate, 32))
    || typeof row.allowWrites !== "boolean"
    || !integer(row.contentRevision)
    || !integer(row.authorityRevision)
    || !integer(row.activeLeaseCount, 10_000)
  ) {
    return null;
  }
  return row as NeonBranchConnectionReference;
}

function parseManagedAccess(value: unknown): NeonBranchInventoryItem["managedAccess"] | undefined {
  if (value === undefined) return null;
  const access = exact(value, ["operationId", "state", "status"]);
  if (
    !access
    || !uuid(access.operationId)
    || !oneOf(access.state, NEON_OPERATION_STATES)
    || !oneOf(access.status, NEON_MANAGED_ACCESS_STATES)
  ) {
    return undefined;
  }
  return { operationId: access.operationId, state: access.state, status: access.status };
}

function parseDeletion(value: unknown): NeonBranchInventoryItem["deletion"] | undefined {
  if (value === undefined) return null;
  const capability = exact(value, ["canPlan", "blockerCodes"]);
  if (
    !capability
    || typeof capability.canPlan !== "boolean"
    || !Array.isArray(capability.blockerCodes)
    || capability.blockerCodes.length > 16
    || !capability.blockerCodes.every(reasonCode)
    || capability.canPlan !== (capability.blockerCodes.length === 0)
  ) {
    return undefined;
  }
  return { canPlan: capability.canPlan, blockerCodes: capability.blockerCodes as string[] };
}

function parseBranch(value: unknown): NeonBranchInventoryItem | null {
  const row = record(value);
  if (
    !row
    || !Object.keys(row).every((key) => branchFields.includes(key) || optionalBranchFields.includes(key))
    || branchFields.some((field) => !Object.prototype.hasOwnProperty.call(row, field))
    || !isNeonSegment(row.id)
    || !isNeonSegment(row.projectId)
    || !nullable(row.parentId, isNeonSegment)
    || !nullable(row.treeParentId, isNeonSegment)
    || !isSafeNeonText(row.name, 256)
    || !oneOf(row.currentState, NEON_BRANCH_STATES)
    || !nullable(
      row.pendingState,
      (candidate): candidate is NeonBranchState => oneOf(candidate, NEON_BRANCH_STATES),
    )
    || !instant(row.stateChangedAt)
    || !instant(row.createdAt)
    || !instant(row.updatedAt)
    || !isSafeNeonText(row.creationSource, 128)
    || !oneOf(row.initSource, ["parent-data", "schema-only", "unknown"] as const)
    || !nullable(row.sourceLsn, (candidate): candidate is string => (
      typeof candidate === "string" && /^[0-9a-f]+\/[0-9a-f]+$/i.test(candidate)
    ))
    || !nullable(row.sourceTimestamp, instant)
    || typeof row.default !== "boolean"
    || typeof row.protected !== "boolean"
    || !nullable(row.expiresAt, instant)
    || (row.production !== "unknown" && typeof row.production !== "boolean")
    || typeof row.ready !== "boolean"
    || !integer(row.depth, 200)
    || !Array.isArray(row.restrictedActions)
    || row.restrictedActions.length > 64
    || !Array.isArray(row.connections)
    || row.connections.length > 200
  ) {
    return null;
  }
  const restrictedActions = row.restrictedActions.map((item) => {
    const action = exact(item, ["name", "reason"]);
    return action && isSafeNeonText(action.name, 64) && isSafeNeonText(action.reason, 512)
      ? { name: action.name, reason: action.reason }
      : null;
  });
  const connections = row.connections.map(parseConnection);
  const managedAccess = parseManagedAccess(row.managedAccess);
  const deletion = parseDeletion(row.deletion);
  if (
    restrictedActions.some((item) => item === null)
    || connections.some((item) => item === null)
    || managedAccess === undefined
    || deletion === undefined
  ) {
    return null;
  }
  return {
    ...(row as Omit<
      NeonBranchInventoryItem,
      "restrictedActions" | "connections" | "managedAccess" | "deletion"
    >),
    restrictedActions: restrictedActions as ReadonlyArray<{ name: string; reason: string }>,
    connections: connections as NeonBranchConnectionReference[],
    managedAccess,
    deletion,
  };
}

/** Display-only projection; a malformed entry is skipped rather than shown. */
function parseMissingTargets(values: readonly unknown[]): NeonMissingTarget[] {
  return values.flatMap((value) => {
    const row = exact(value, [
      "connectionId",
      "connectionName",
      "branchId",
      "database",
      "contentRevision",
      "reason",
    ]);
    return row
      && uuid(row.connectionId)
      && isSafeNeonText(row.connectionName, 120)
      && isNeonSegment(row.branchId)
      && isSafeNeonText(row.database, 256)
      && row.reason === "branch_missing"
      ? [{
        connectionId: row.connectionId,
        connectionName: row.connectionName,
        branchId: row.branchId,
        database: row.database,
      }]
      : [];
  });
}

export function parseNeonBranchInventory(value: unknown): NeonBranchInventory | null {
  const row = exact(value, [
    "projectId",
    "integrationGeneration",
    "observedAt",
    "rootIds",
    "branches",
    "missingTargets",
  ]);
  if (
    !row
    || !isNeonSegment(row.projectId)
    || !generation(row.integrationGeneration)
    || !instant(row.observedAt)
    || !Array.isArray(row.rootIds)
    || !row.rootIds.every(isNeonSegment)
    || !Array.isArray(row.branches)
    || row.branches.length > 200
    || !Array.isArray(row.missingTargets)
    || row.missingTargets.length > 200
  ) {
    return null;
  }
  const branches = row.branches.map(parseBranch);
  if (branches.some((branch) => branch === null)) return null;
  return {
    projectId: row.projectId,
    integrationGeneration: row.integrationGeneration,
    observedAt: row.observedAt,
    rootIds: row.rootIds as string[],
    branches: branches as NeonBranchInventoryItem[],
    missingTargets: parseMissingTargets(row.missingTargets),
  };
}

export function requireNeonBranchInventory(
  value: unknown,
  integration: NeonIntegrationRef,
  projectId: string,
): NeonBranchInventory {
  const inventory = parseNeonBranchInventory(value);
  if (!inventory) throw new NeonBranchResponseError("shape");
  if (
    inventory.projectId !== projectId
    || inventory.integrationGeneration !== integration.generation
  ) {
    throw new NeonBranchResponseError("mismatch");
  }
  return inventory;
}
