// Projects one auditable safe-run journey (checkpoint → isolate → run and inspect →
// return and discard) from durable provider operations and the live branch tree, and
// decides which next plan the journey may offer. Pure functions only.
import {
  neonBranchEnvironment,
  type NeonBranchConnectionReference,
  type NeonBranchInventory,
  type NeonBranchOperation,
  type NeonEnvironment,
  type NeonSafeRun,
  type NeonSafeRunPhase,
} from "./domain";

export type NeonSafeRunStepState = "complete" | "active" | "pending";

function operationTime(operation: NeonBranchOperation) {
  return Date.parse(operation.plan.issuedAt);
}

function newestFirst(left: NeonBranchOperation, right: NeonBranchOperation) {
  return operationTime(right) - operationTime(left) || right.id.localeCompare(left.id);
}

/** The newest isolated (read/write endpoint) branch creation and where it stands now. */
export function deriveNeonSafeRun(
  inventory: NeonBranchInventory,
  operations: readonly NeonBranchOperation[],
): NeonSafeRun | null {
  const candidate = operations
    .filter((operation) => (
      operation.plan.kind === "neon.branch.create"
      && operation.plan.source.projectId === inventory.projectId
      && operation.plan.target.endpoint === "read_write"
      && operation.state !== "cancelled"
    ))
    .sort(newestFirst)[0];
  if (!candidate || candidate.plan.kind !== "neon.branch.create") return null;
  const createOperation = candidate as NeonSafeRun["createOperation"];
  const branchId = createOperation.branchId;
  const branch = branchId
    ? inventory.branches.find((item) => item.id === branchId) ?? null
    : null;
  const sourceBranch = inventory.branches.find(
    (item) => item.id === createOperation.plan.source.branchId,
  ) ?? null;
  const base = {
    createOperation,
    branch,
    sourceBranch,
    activeConnection: null,
    switchedConnectionId: null,
    switchedFromSource: false,
  } satisfies Omit<NeonSafeRun, "phase">;

  if (branchId) {
    const deletion = operations.find((operation) => (
      operation.plan.kind === "neon.branch.delete"
      && operation.state === "succeeded"
      && operation.plan.target.projectId === inventory.projectId
      && operation.plan.target.branchId === branchId
      && operationTime(operation) >= operationTime(createOperation)
    ));
    if (deletion && !branch) return { ...base, phase: "discarded" };
  }
  if (createOperation.state !== "succeeded") {
    return {
      ...base,
      phase: createOperation.state === "failed" || createOperation.state === "needs_repair"
        ? "needs_attention"
        : "checkpointing",
    };
  }
  if (!branchId || !branch || !sourceBranch) return { ...base, phase: "needs_attention" };

  const successfulSwitches = operations
    .filter((operation) => (
      operation.plan.kind === "neon.branch.switch"
      && operation.state === "succeeded"
      && operation.plan.source.projectId === inventory.projectId
      && operationTime(operation) >= operationTime(createOperation)
      && (
        operation.plan.source.branchId === branchId
        || operation.plan.target.branchId === branchId
      )
    ))
    .sort(newestFirst);
  const latestSwitch = successfulSwitches[0];
  const switchedConnectionId = latestSwitch?.plan.kind === "neon.branch.switch"
    ? latestSwitch.plan.source.connectionId
    : null;
  const activeConnection = switchedConnectionId
    ? branch.connections.find((connection) => connection.connectionId === switchedConnectionId) ?? null
    : branch.connections[0] ?? null;
  const switchedFromSource = successfulSwitches.some((operation) => (
    operation.plan.kind === "neon.branch.switch"
    && operation.plan.source.branchId === sourceBranch.id
    && operation.plan.target.branchId === branch.id
    && operation.plan.source.connectionId === switchedConnectionId
  ));
  const enriched = { ...base, activeConnection, switchedConnectionId, switchedFromSource };

  if (activeConnection) return { ...enriched, phase: "isolated_active" };
  const returnedConnectionId = latestSwitch?.plan.kind === "neon.branch.switch"
    && latestSwitch.plan.source.branchId === branch.id
    && latestSwitch.plan.target.branchId !== branch.id
    ? latestSwitch.plan.source.connectionId
    : null;
  if (
    returnedConnectionId
    && sourceBranch.connections.some((connection) => connection.connectionId === returnedConnectionId)
  ) {
    return { ...enriched, phase: "ready_to_discard" };
  }
  if (
    createOperation.managedAccessState === "bootstrap_required"
    || createOperation.managedAccessState === "not_requested"
    || createOperation.managedAccessState === "waiting_for_provider"
  ) {
    return { ...enriched, phase: "access_required" };
  }
  if (createOperation.managedAccessState === "ready") return { ...enriched, phase: "ready_to_isolate" };
  return { ...enriched, phase: "needs_attention" };
}

/** Step 1 checkpoint, 2 isolate, 3 run and inspect, 4 return and discard. */
export function neonSafeRunStepState(phase: NeonSafeRunPhase, step: number): NeonSafeRunStepState {
  const checkpointComplete = phase !== "checkpointing" && phase !== "needs_attention";
  const isolated = phase === "isolated_active" || phase === "ready_to_discard" || phase === "discarded";
  const inspected = phase === "ready_to_discard" || phase === "discarded";
  if (step === 1) return checkpointComplete ? "complete" : "active";
  if (step === 2) return isolated ? "complete" : checkpointComplete ? "active" : "pending";
  if (step === 3) return inspected ? "complete" : phase === "isolated_active" ? "active" : "pending";
  return phase === "discarded" ? "complete" : phase === "ready_to_discard" ? "active" : "pending";
}

export type NeonSafeRunActions = Readonly<{
  sourceConnections: readonly NeonBranchConnectionReference[];
  /** The one source connection an isolation switch can move without asking. */
  sourceConnection: NeonBranchConnectionReference | null;
  targetEnvironment: NeonEnvironment | "";
  canIsolate: boolean;
  canReturn: boolean;
}>;

export function neonSafeRunActions(safeRun: NeonSafeRun | null): NeonSafeRunActions {
  const sourceConnections = safeRun?.sourceBranch?.connections ?? [];
  const sourceConnection = sourceConnections.length === 1 ? sourceConnections[0] ?? null : null;
  const targetEnvironment: NeonEnvironment | "" = !safeRun
    ? ""
    : safeRun.createOperation.risk === "production_data"
      ? "production"
      : neonBranchEnvironment(safeRun.branch) || safeRun.createOperation.plan.source.environment;
  const canIsolate = Boolean(
    safeRun?.phase === "ready_to_isolate"
    && safeRun.branch
    && sourceConnection
    && sourceConnection.database
    && !safeRun.branch.connections.some((connection) => (
      connection.connectionId !== sourceConnection.connectionId
      && connection.database === sourceConnection.database
    ))
    && targetEnvironment,
  );
  const canReturn = Boolean(
    safeRun?.phase === "isolated_active"
    && safeRun.switchedFromSource
    && safeRun.activeConnection
    && safeRun.sourceBranch,
  );
  return { sourceConnections, sourceConnection, targetEnvironment, canIsolate, canReturn };
}
