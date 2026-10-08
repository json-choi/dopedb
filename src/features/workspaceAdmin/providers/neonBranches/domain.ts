// Neon branch domain contract shared by the inventory and operation parsers, the
// safe-run projection and the controller: wire types, the closed state vocabularies,
// the response-binding error, and the small rules every view applies the same way.
// Pure types and functions only; parsing lives in branchInventory/branchOperations.

export type NeonEnvironment = "development" | "production";
export type NeonBranchState = "init" | "resetting" | "ready" | "archived" | "unknown";

export type NeonBranchOperationState =
  | "awaiting_approval"
  | "approved"
  | "claimed"
  | "remote_started"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "needs_repair"
  | "cancelled";

export type NeonManagedAccessState =
  | "waiting_for_provider"
  | "not_requested"
  | "bootstrap_required"
  | "ready"
  | "needs_repair"
  | "unavailable";

export const NEON_BRANCH_STATES: readonly NeonBranchState[] = [
  "init",
  "resetting",
  "ready",
  "archived",
  "unknown",
];

export const NEON_OPERATION_STATES: readonly NeonBranchOperationState[] = [
  "awaiting_approval",
  "approved",
  "claimed",
  "remote_started",
  "reconciling",
  "succeeded",
  "failed",
  "needs_repair",
  "cancelled",
];

export const NEON_MANAGED_ACCESS_STATES: readonly NeonManagedAccessState[] = [
  "waiting_for_provider",
  "not_requested",
  "bootstrap_required",
  "ready",
  "needs_repair",
  "unavailable",
];

export type NeonBranchConnectionReference = Readonly<{
  connectionId: string;
  connectionName: string;
  database: string;
  environment: string | null;
  allowWrites: boolean;
  contentRevision: number;
  authorityRevision: number;
  activeLeaseCount: number;
}>;

export type NeonBranchInventoryItem = Readonly<{
  id: string;
  projectId: string;
  parentId: string | null;
  treeParentId: string | null;
  name: string;
  currentState: NeonBranchState;
  pendingState: NeonBranchState | null;
  stateChangedAt: string;
  createdAt: string;
  updatedAt: string;
  creationSource: string;
  initSource: "parent-data" | "schema-only" | "unknown";
  sourceLsn: string | null;
  sourceTimestamp: string | null;
  default: boolean;
  protected: boolean;
  expiresAt: string | null;
  restrictedActions: readonly Readonly<{ name: string; reason: string }>[];
  production: boolean | "unknown";
  ready: boolean;
  depth: number;
  managedAccess: Readonly<{
    operationId: string;
    state: NeonBranchOperationState;
    status: NeonManagedAccessState;
  }> | null;
  deletion: Readonly<{
    canPlan: boolean;
    blockerCodes: readonly string[];
  }> | null;
  connections: readonly NeonBranchConnectionReference[];
}>;

/** A shared connection whose pinned branch no longer exists in the provider. */
export type NeonMissingTarget = Readonly<{
  connectionId: string;
  connectionName: string;
  branchId: string;
  database: string;
}>;

export type NeonBranchInventory = Readonly<{
  projectId: string;
  integrationGeneration: string;
  observedAt: string;
  rootIds: readonly string[];
  branches: readonly NeonBranchInventoryItem[];
  missingTargets: readonly NeonMissingTarget[];
}>;

export type NeonBranchSourcePoint =
  | Readonly<{ kind: "head" }>
  | Readonly<{ kind: "lsn" | "timestamp"; value: string }>;

export type NeonBranchCreatePlan = Readonly<{
  version: 1;
  kind: "neon.branch.create";
  operationId: string;
  integrationId: string;
  integrationGeneration: string;
  issuedAt: string;
  expiresAt: string;
  source: Readonly<{
    projectId: string;
    branchId: string;
    name: string;
    protected: boolean;
    default: boolean;
    environment: NeonEnvironment;
    point: NeonBranchSourcePoint;
  }>;
  target: Readonly<{
    name: string;
    initSource: "parent-data" | "schema-only";
    endpoint: "none" | "read_write";
    copiesData: boolean;
    createsCompute: boolean;
  }>;
  risk: "standard" | "production_data";
  approvalPolicy: "single_admin" | "separate_admin";
  warningCodes: readonly string[];
}>;

export type NeonBranchDeletePlan = Readonly<{
  version: 1;
  kind: "neon.branch.delete";
  operationId: string;
  integrationId: string;
  integrationGeneration: string;
  issuedAt: string;
  expiresAt: string;
  target: Readonly<{
    projectId: string;
    branchId: string;
    name: string;
    default: false;
    protected: false;
    expiresAt: string | null;
  }>;
  references: Readonly<{
    connectionCount: 0;
    activeLeaseCount: 0;
    endpointIds: readonly string[];
  }>;
  ownership: Readonly<{
    createOperationId: string;
    createPlanHash: string;
  }>;
  deletionMode: "provider_default_soft_delete";
  risk: "standard";
  approvalPolicy: "single_admin";
  warningCodes: readonly string[];
}>;

export type NeonBranchSwitchPlan = Readonly<{
  version: 1;
  kind: "neon.branch.switch";
  operationId: string;
  integrationId: string;
  integrationGeneration: string;
  issuedAt: string;
  expiresAt: string;
  source: Readonly<{
    projectId: string;
    branchId: string;
    name: string;
    connectionId: string;
    connectionName: string;
    database: string;
    environment: NeonEnvironment;
    activeLeaseCount: number;
  }>;
  target: Readonly<{
    projectId: string;
    branchId: string;
    name: string;
    database: string;
    environment: NeonEnvironment;
  }>;
  impact: Readonly<{
    activeLeaseCount: number;
    closesExistingSessions: true;
    createsConnectionRevision: true;
    reintrospectionRequired: true;
  }>;
  risk: "standard" | "production_data";
  approvalPolicy: "single_admin" | "separate_admin";
  warningCodes: readonly string[];
}>;

export type NeonBranchPlan =
  | NeonBranchCreatePlan
  | NeonBranchDeletePlan
  | NeonBranchSwitchPlan;

export type NeonBranchOperation = Readonly<{
  id: string;
  state: NeonBranchOperationState;
  planHash: string;
  planExpiresAt: string;
  expired: boolean;
  risk: "standard" | "production_data";
  approvalPolicy: "single_admin" | "separate_admin";
  requestedByCurrentActor: boolean;
  canApprove: boolean;
  canReject: boolean;
  canExecute: boolean;
  needsCredentialFenceRecovery: boolean;
  providerOperationId: string | null;
  branchId: string | null;
  reconcileAfter: string | null;
  endpointId: string | null;
  databaseCount: number | null;
  retiredInheritedRoleCount: number | null;
  managedAccessState: NeonManagedAccessState | null;
  failureCode: string | null;
  plan: NeonBranchPlan;
}>;

export type NeonBranchOperations = Readonly<{
  integrationGeneration: string;
  operations: readonly NeonBranchOperation[];
}>;

export type NeonSafeRunPhase =
  | "checkpointing"
  | "access_required"
  | "ready_to_isolate"
  | "isolated_active"
  | "ready_to_discard"
  | "discarded"
  | "needs_attention";

export type NeonSafeRun = Readonly<{
  phase: NeonSafeRunPhase;
  createOperation: NeonBranchOperation & Readonly<{ plan: NeonBranchCreatePlan }>;
  branch: NeonBranchInventoryItem | null;
  sourceBranch: NeonBranchInventoryItem | null;
  activeConnection: NeonBranchConnectionReference | null;
  switchedConnectionId: string | null;
  switchedFromSource: boolean;
}>;

/** The integration identity every Neon response must be bound to. */
export type NeonIntegrationRef = Readonly<{ id: string; generation: string }>;

/** Why a Neon response cannot be shown for the current integration and project. */
export class NeonBranchResponseError extends Error {
  readonly reason: "shape" | "mismatch";

  constructor(reason: "shape" | "mismatch") {
    super(reason === "shape"
      ? "Neon branch response is malformed"
      : "Neon branch response belongs to another integration generation or project");
    this.name = "NeonBranchResponseError";
    this.reason = reason;
  }
}

export function neonOperationProjectId(operation: NeonBranchOperation): string {
  return operation.plan.kind === "neon.branch.delete"
    ? operation.plan.target.projectId
    : operation.plan.source.projectId;
}

/** Protected or production-referenced branches are production; unknown stays unclassified. */
export function neonBranchEnvironment(
  branch: NeonBranchInventoryItem | null,
): NeonEnvironment | "" {
  if (!branch) return "";
  if (
    branch.protected
    || branch.production === true
    || branch.connections.some((connection) => connection.environment === "production")
  ) {
    return "production";
  }
  return branch.production === false ? "development" : "";
}

/** The provider has started work the server is still reconciling. */
export function neonOperationBusy(operation: NeonBranchOperation): boolean {
  return operation.state === "claimed"
    || operation.state === "remote_started"
    || operation.state === "reconciling";
}
