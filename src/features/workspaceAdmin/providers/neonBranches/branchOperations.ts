// Strict parser for durable Neon branch operations: the create, discard and switch
// plans, the integration's approval and execution history, freshly recorded plan
// responses and the state an execute call reports. A malformed operation rejects the
// whole history so stale or partial authority is never offered as an action.
import {
  NEON_MANAGED_ACCESS_STATES,
  NEON_OPERATION_STATES,
  NeonBranchResponseError,
  type NeonBranchCreatePlan,
  type NeonBranchDeletePlan,
  type NeonBranchOperation,
  type NeonBranchOperations,
  type NeonBranchOperationState,
  type NeonBranchPlan,
  type NeonBranchSourcePoint,
  type NeonBranchSwitchPlan,
  type NeonIntegrationRef,
  type NeonManagedAccessState,
} from "./domain";
import {
  environment,
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
  warningCodes,
} from "./parsingPrimitives";

const operationFields = [
  "id", "state", "planHash", "planExpiresAt", "expired", "risk",
  "approvalPolicy", "requestedByCurrentActor", "canApprove", "canReject",
  "canExecute", "needsCredentialFenceRecovery", "providerOperationId", "branchId",
  "reconcileAfter", "endpointId", "databaseCount", "retiredInheritedRoleCount",
  "managedAccessState", "failureCode", "plan",
];

function planHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function parseSourcePoint(value: unknown): NeonBranchSourcePoint | null {
  const row = record(value);
  if (row?.kind === "head" && Object.keys(row).length === 1) return { kind: "head" };
  if (
    row
    && (row.kind === "lsn" || row.kind === "timestamp")
    && Object.keys(row).length === 2
    && isSafeNeonText(row.value, 64)
  ) {
    return { kind: row.kind, value: row.value };
  }
  return null;
}

function parseCreatePlan(value: unknown): NeonBranchCreatePlan | null {
  const row = record(value);
  const source = record(row?.source);
  const target = record(row?.target);
  const point = parseSourcePoint(source?.point);
  if (
    !row
    || row.version !== 1
    || row.kind !== "neon.branch.create"
    || !uuid(row.operationId)
    || !uuid(row.integrationId)
    || !generation(row.integrationGeneration)
    || !instant(row.issuedAt)
    || !instant(row.expiresAt)
    || !source
    || !isNeonSegment(source.projectId)
    || !isNeonSegment(source.branchId)
    || !isSafeNeonText(source.name, 256)
    || typeof source.protected !== "boolean"
    || typeof source.default !== "boolean"
    || !environment(source.environment)
    || !point
    || !target
    || !isSafeNeonText(target.name, 256)
    || (target.initSource !== "parent-data" && target.initSource !== "schema-only")
    || (target.endpoint !== "none" && target.endpoint !== "read_write")
    || typeof target.copiesData !== "boolean"
    || typeof target.createsCompute !== "boolean"
    || (row.risk !== "standard" && row.risk !== "production_data")
    || (row.approvalPolicy !== "single_admin" && row.approvalPolicy !== "separate_admin")
    || !warningCodes(row.warningCodes)
  ) {
    return null;
  }
  return {
    version: 1,
    kind: "neon.branch.create",
    operationId: row.operationId,
    integrationId: row.integrationId,
    integrationGeneration: row.integrationGeneration,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    source: {
      projectId: source.projectId,
      branchId: source.branchId,
      name: source.name,
      protected: source.protected,
      default: source.default,
      environment: source.environment,
      point,
    },
    target: {
      name: target.name,
      initSource: target.initSource,
      endpoint: target.endpoint,
      copiesData: target.copiesData,
      createsCompute: target.createsCompute,
    },
    risk: row.risk,
    approvalPolicy: row.approvalPolicy,
    warningCodes: row.warningCodes,
  };
}

function parseDeletePlan(value: unknown): NeonBranchDeletePlan | null {
  const row = record(value);
  const target = record(row?.target);
  const references = exact(row?.references, ["connectionCount", "activeLeaseCount", "endpointIds"]);
  const ownership = exact(row?.ownership, ["createOperationId", "createPlanHash"]);
  if (
    !row
    || row.version !== 1
    || row.kind !== "neon.branch.delete"
    || !uuid(row.operationId)
    || !uuid(row.integrationId)
    || !generation(row.integrationGeneration)
    || !instant(row.issuedAt)
    || !instant(row.expiresAt)
    || !target
    || !isNeonSegment(target.projectId)
    || !isNeonSegment(target.branchId)
    || !isSafeNeonText(target.name, 256)
    || target.default !== false
    || target.protected !== false
    || !nullable(target.expiresAt, instant)
    || !references
    || references.connectionCount !== 0
    || references.activeLeaseCount !== 0
    || !Array.isArray(references.endpointIds)
    || references.endpointIds.length > 64
    || !references.endpointIds.every(isNeonSegment)
    || new Set(references.endpointIds).size !== references.endpointIds.length
    || !ownership
    || !uuid(ownership.createOperationId)
    || !planHash(ownership.createPlanHash)
    || row.deletionMode !== "provider_default_soft_delete"
    || row.risk !== "standard"
    || row.approvalPolicy !== "single_admin"
    || !warningCodes(row.warningCodes)
  ) {
    return null;
  }
  return {
    version: 1,
    kind: "neon.branch.delete",
    operationId: row.operationId,
    integrationId: row.integrationId,
    integrationGeneration: row.integrationGeneration,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    target: {
      projectId: target.projectId,
      branchId: target.branchId,
      name: target.name,
      default: false,
      protected: false,
      expiresAt: target.expiresAt,
    },
    references: {
      connectionCount: 0,
      activeLeaseCount: 0,
      endpointIds: references.endpointIds as string[],
    },
    ownership: {
      createOperationId: ownership.createOperationId,
      createPlanHash: ownership.createPlanHash,
    },
    deletionMode: "provider_default_soft_delete",
    risk: "standard",
    approvalPolicy: "single_admin",
    warningCodes: row.warningCodes,
  };
}

function parseSwitchPlan(value: unknown): NeonBranchSwitchPlan | null {
  const row = record(value);
  const source = record(row?.source);
  const target = record(row?.target);
  const impact = exact(row?.impact, [
    "activeLeaseCount",
    "closesExistingSessions",
    "createsConnectionRevision",
    "reintrospectionRequired",
  ]);
  if (
    !row
    || row.version !== 1
    || row.kind !== "neon.branch.switch"
    || !uuid(row.operationId)
    || !uuid(row.integrationId)
    || !generation(row.integrationGeneration)
    || !instant(row.issuedAt)
    || !instant(row.expiresAt)
    || !source
    || !isNeonSegment(source.projectId)
    || !isNeonSegment(source.branchId)
    || !isSafeNeonText(source.name, 256)
    || !uuid(source.connectionId)
    || !isSafeNeonText(source.connectionName, 120)
    || !isSafeNeonText(source.database, 256)
    || !environment(source.environment)
    || !integer(source.activeLeaseCount, 10_000)
    || !target
    || !isNeonSegment(target.projectId)
    || target.projectId !== source.projectId
    || !isNeonSegment(target.branchId)
    || !isSafeNeonText(target.name, 256)
    || !isSafeNeonText(target.database, 256)
    || !environment(target.environment)
    || !impact
    || !integer(impact.activeLeaseCount, 10_000)
    || impact.activeLeaseCount !== source.activeLeaseCount
    || impact.closesExistingSessions !== true
    || impact.createsConnectionRevision !== true
    || impact.reintrospectionRequired !== true
    || (row.risk !== "standard" && row.risk !== "production_data")
    || (row.approvalPolicy !== "single_admin" && row.approvalPolicy !== "separate_admin")
    || !warningCodes(row.warningCodes)
  ) {
    return null;
  }
  return {
    version: 1,
    kind: "neon.branch.switch",
    operationId: row.operationId,
    integrationId: row.integrationId,
    integrationGeneration: row.integrationGeneration,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    source: {
      projectId: source.projectId,
      branchId: source.branchId,
      name: source.name,
      connectionId: source.connectionId,
      connectionName: source.connectionName,
      database: source.database,
      environment: source.environment,
      activeLeaseCount: source.activeLeaseCount,
    },
    target: {
      projectId: target.projectId,
      branchId: target.branchId,
      name: target.name,
      database: target.database,
      environment: target.environment,
    },
    impact: {
      activeLeaseCount: impact.activeLeaseCount,
      closesExistingSessions: true,
      createsConnectionRevision: true,
      reintrospectionRequired: true,
    },
    risk: row.risk,
    approvalPolicy: row.approvalPolicy,
    warningCodes: row.warningCodes,
  };
}

function parsePlan(value: unknown): NeonBranchPlan | null {
  const kind = record(value)?.kind;
  if (kind === "neon.branch.create") return parseCreatePlan(value);
  if (kind === "neon.branch.delete") return parseDeletePlan(value);
  if (kind === "neon.branch.switch") return parseSwitchPlan(value);
  return null;
}

function parseOperation(value: unknown, integrationGeneration: string): NeonBranchOperation | null {
  const operation = exact(value, operationFields);
  const plan = parsePlan(operation?.plan);
  if (
    !operation
    || !uuid(operation.id)
    || !oneOf(operation.state, NEON_OPERATION_STATES)
    || !planHash(operation.planHash)
    || !instant(operation.planExpiresAt)
    || typeof operation.expired !== "boolean"
    || (operation.risk !== "standard" && operation.risk !== "production_data")
    || (operation.approvalPolicy !== "single_admin" && operation.approvalPolicy !== "separate_admin")
    || typeof operation.requestedByCurrentActor !== "boolean"
    || typeof operation.canApprove !== "boolean"
    || typeof operation.canReject !== "boolean"
    || typeof operation.canExecute !== "boolean"
    || typeof operation.needsCredentialFenceRecovery !== "boolean"
    || !nullable(operation.providerOperationId, uuid)
    || !nullable(operation.branchId, isNeonSegment)
    || !nullable(operation.reconcileAfter, instant)
    || !nullable(operation.endpointId, isNeonSegment)
    || !nullable(operation.databaseCount, (candidate): candidate is number => integer(candidate, 200))
    || !nullable(
      operation.retiredInheritedRoleCount,
      (candidate): candidate is number => integer(candidate, 200),
    )
    || !nullable(
      operation.managedAccessState,
      (candidate): candidate is NeonManagedAccessState => oneOf(candidate, NEON_MANAGED_ACCESS_STATES),
    )
    || !nullable(operation.failureCode, reasonCode)
    || !plan
    || plan.operationId !== operation.id
    || plan.integrationGeneration !== integrationGeneration
    || plan.risk !== operation.risk
    || plan.approvalPolicy !== operation.approvalPolicy
  ) {
    return null;
  }
  return { ...operation, plan } as NeonBranchOperation;
}

export function parseNeonBranchOperations(value: unknown): NeonBranchOperations | null {
  const row = exact(value, ["integrationGeneration", "operations"]);
  if (
    !row
    || !generation(row.integrationGeneration)
    || !Array.isArray(row.operations)
    || row.operations.length > 200
  ) {
    return null;
  }
  const integrationGeneration = row.integrationGeneration;
  const operations = row.operations.map((item) => parseOperation(item, integrationGeneration));
  return operations.some((operation) => operation === null)
    ? null
    : { integrationGeneration, operations: operations as NeonBranchOperation[] };
}

/**
 * A freshly recorded (or idempotently replayed) plan. Execution fields are not part
 * of the plan response, so they start empty and the authoritative history refetch
 * replaces this projection.
 */
export function parseNeonBranchPlanResponse(value: unknown): NeonBranchOperation | null {
  const row = exact(value, ["operation"]);
  const operation = record(row?.operation);
  const plan = record(operation?.plan);
  if (!operation || !plan || !generation(plan.integrationGeneration)) return null;
  return parseOperation({
    id: operation.id,
    state: operation.state,
    planHash: operation.planHash,
    planExpiresAt: operation.planExpiresAt,
    expired: operation.expired,
    risk: operation.risk,
    approvalPolicy: operation.approvalPolicy,
    plan: operation.plan,
    providerOperationId: null,
    branchId: null,
    reconcileAfter: null,
    endpointId: null,
    databaseCount: null,
    retiredInheritedRoleCount: null,
    managedAccessState: null,
    failureCode: null,
    requestedByCurrentActor: true,
    canApprove: operation.state === "awaiting_approval" && operation.approvalPolicy === "single_admin",
    canReject: operation.state === "awaiting_approval",
    canExecute: false,
    needsCredentialFenceRecovery: false,
  }, plan.integrationGeneration);
}

/** The state an execute call left the operation in, when its response states one. */
export function neonExecutionState(value: unknown): NeonBranchOperationState | null {
  const state = record(record(value)?.operation)?.state;
  return oneOf(state, NEON_OPERATION_STATES) ? state : null;
}

export function neonOperationsBelongTo(
  catalog: NeonBranchOperations,
  integration: NeonIntegrationRef,
): boolean {
  return catalog.integrationGeneration === integration.generation
    && catalog.operations.every((operation) => operation.plan.integrationId === integration.id);
}

export function requireNeonBranchOperations(
  value: unknown,
  integration: NeonIntegrationRef,
): NeonBranchOperations {
  const catalog = parseNeonBranchOperations(value);
  if (!catalog) throw new NeonBranchResponseError("shape");
  if (!neonOperationsBelongTo(catalog, integration)) throw new NeonBranchResponseError("mismatch");
  return catalog;
}
