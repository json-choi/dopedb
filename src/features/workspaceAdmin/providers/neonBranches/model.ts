// Presentation model for the Neon branch manager: project targets, branch selection
// and search, switch and create-plan request rules, the reconcile delay, plan
// idempotency fingerprints, error wording, and the static i18n vocabulary for
// operation, warning, blocker, branch and safe-run states. Pure functions only.
import type { StatusTone } from "../../../../design-system/components/Status";
import type { I18nKey, Lang } from "../../../../lib/i18n";
import type { NeonDecideAction, NeonExecuteAction, NeonPlanAction } from "../../domain";
import { WorkspaceAdminRequestError, workspaceAdminErrorMessage } from "../../requests";
import type { Integration, ManagedConnection } from "../domain";
import {
  NeonBranchResponseError,
  neonOperationBusy,
  neonOperationProjectId,
  type NeonBranchConnectionReference,
  type NeonBranchInventory,
  type NeonBranchInventoryItem,
  type NeonBranchOperation,
  type NeonBranchOperationState,
  type NeonBranchPlan,
  type NeonBranchSourcePoint,
  type NeonBranchState,
  type NeonEnvironment,
  type NeonSafeRunPhase,
} from "./domain";
import { isNeonSegment, isSafeNeonText } from "./parsingPrimitives";
import type { NeonSafeRunStepState } from "./safeRun";

export type NeonProjectTarget = Readonly<{
  key: string;
  integration: Integration;
  projectId: string;
  label: string;
}>;

export type NeonOperationCatalog = Readonly<{
  integration: Integration;
  operations: readonly NeonBranchOperation[];
}>;

export type NeonSwitchConnection = NeonBranchConnectionReference & Readonly<{
  branchId: string;
  branchName: string;
}>;

export type NeonSourcePointKind = "head" | "timestamp" | "lsn";

type Translator = {
  lang: Lang;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
};

const NEON_LSN = /^[0-9a-f]+\/[0-9a-f]+$/i;

/** The control plane names multi-project Neon accounts in Korean; English UI rewrites it. */
export function neonIntegrationDisplayName(value: string, lang: Lang): string {
  if (lang === "ko") return value;
  const projects = value.match(/^Neon · 프로젝트 (\d+)개$/);
  return projects ? `Neon · ${projects[1]} projects` : value;
}

/** Active Neon projects that back a shared database or have branch operation history. */
export function neonProjectTargets(
  integrations: readonly Integration[],
  managedConnections: readonly ManagedConnection[],
  catalogs: readonly NeonOperationCatalog[],
  lang: Lang,
): NeonProjectTarget[] {
  const byId = new Map(integrations.map((integration) => [integration.id, integration]));
  const seen = new Set<string>();
  const targets: NeonProjectTarget[] = [];
  const add = (integration: Integration | undefined, projectId: unknown) => {
    if (
      !integration
      || integration.provider !== "neon"
      || integration.status !== "active"
      || !isNeonSegment(projectId)
    ) {
      return;
    }
    const key = `${integration.id}:${projectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      key,
      integration,
      projectId,
      label: `${neonIntegrationDisplayName(integration.displayName, lang)} · ${projectId}`,
    });
  };
  for (const connection of managedConnections) {
    if (connection.provider === "neon") add(byId.get(connection.integrationId), connection.resource.project);
  }
  for (const catalog of catalogs) {
    for (const operation of catalog.operations) {
      add(byId.get(catalog.integration.id), neonOperationProjectId(operation));
    }
  }
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  return targets.sort((left, right) => (
    neonIntegrationDisplayName(left.integration.displayName, lang).localeCompare(
      neonIntegrationDisplayName(right.integration.displayName, lang),
      locale,
    )
    || left.projectId.localeCompare(right.projectId)
  ));
}

/**
 * Short stable digest of the shared Neon connections of one integration. Branch
 * references and managed-access readiness change when a connection is added, moved
 * or removed, so reads keyed by it refetch after such a change elsewhere in Settings.
 */
export function neonReferenceFingerprint(
  managedConnections: readonly ManagedConnection[],
  integrationId: string,
): string {
  const rows = managedConnections
    .filter((connection) => connection.provider === "neon" && connection.integrationId === integrationId)
    .map((connection) => [
      connection.connectionId,
      connection.resource.project,
      connection.resource.branch,
      connection.resource.database,
    ].map((part) => (typeof part === "string" ? part : "")).join("/"))
    .sort();
  let hash = 0x811c9dc5;
  for (const row of rows) {
    for (const character of `${row}\n`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `${rows.length}-${hash.toString(36)}`;
}

/** The explicit choice while it is still a ready branch, else the first useful ready branch. */
export function resolveSelectedBranch(
  branches: readonly NeonBranchInventoryItem[],
  chosenId: string,
): NeonBranchInventoryItem | null {
  return branches.find((branch) => branch.id === chosenId && branch.ready)
    ?? branches.find((branch) => branch.ready && branch.connections.length > 0)
    ?? branches.find((branch) => branch.ready)
    ?? null;
}

export function filterNeonBranches(
  branches: readonly NeonBranchInventoryItem[],
  search: string,
): readonly NeonBranchInventoryItem[] {
  const query = search.trim().toLowerCase();
  if (!query) return branches;
  return branches.filter((branch) => (
    branch.name.toLowerCase().includes(query)
    || branch.id.toLowerCase().includes(query)
    || branch.connections.some((connection) => connection.connectionName.toLowerCase().includes(query))
  ));
}

export function neonSwitchConnections(inventory: NeonBranchInventory | null): NeonSwitchConnection[] {
  return inventory?.branches.flatMap((branch) => branch.connections.map((connection) => ({
    ...connection,
    branchId: branch.id,
    branchName: branch.name,
  }))) ?? [];
}

/** A DopeDB-created branch must finish least-privilege setup before it can be a target. */
export function neonBranchReadyAsTarget(branch: NeonBranchInventoryItem | null): boolean {
  return Boolean(branch) && (
    branch?.managedAccess === null
    || (branch?.managedAccess?.state === "succeeded" && branch.managedAccess.status === "ready")
  );
}

/** Another shared connection already uses the same database on the target branch. */
export function neonSwitchTargetConflict(
  branch: NeonBranchInventoryItem | null,
  connection: NeonBranchConnectionReference | null,
): boolean {
  return Boolean(branch && connection && branch.connections.some((candidate) => (
    candidate.connectionId !== connection.connectionId
    && candidate.database === connection.database
  )));
}

export function neonSourcePoint(kind: NeonSourcePointKind, value: string): NeonBranchSourcePoint | null {
  if (kind === "head") return { kind: "head" };
  if (kind === "timestamp") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? { kind: "timestamp", value: new Date(time).toISOString() } : null;
  }
  const lsn = value.trim();
  return lsn.length <= 64 && NEON_LSN.test(lsn) ? { kind: "lsn", value: lsn } : null;
}

/** Inline validation for a typed copy point; an empty value only disables the plan. */
export function neonSourcePointError(kind: NeonSourcePointKind, value: string): I18nKey | null {
  if (kind === "head" || !value.trim() || neonSourcePoint(kind, value)) return null;
  return kind === "timestamp"
    ? "workspaceNeonBranches.errors.timestamp"
    : "workspaceNeonBranches.lsnInvalid";
}

export function neonBranchNameError(value: string): I18nKey | null {
  const name = value.trim();
  return !name || isSafeNeonText(name, 256) ? null : "workspaceNeonBranches.nameInvalid";
}

/** Re-run a started operation when the provider asks, bounded to 0.5–5 seconds. */
export function neonReconcileDelay(operation: NeonBranchOperation, now: number): number {
  const providerDelay = operation.reconcileAfter ? Date.parse(operation.reconcileAfter) - now : 1_500;
  return Number.isFinite(providerDelay) ? Math.max(500, Math.min(5_000, providerDelay)) : 1_500;
}

/** Identifies one plan request without its idempotency key. */
export function neonPlanFingerprint(
  integrationId: string,
  action: NeonPlanAction,
  request: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify([integrationId, action, request]);
}

/**
 * Whether a failed request may still have been applied server-side: transport
 * failures, timeouts and server errors. A plan keeps its idempotency key so a retry
 * replays it instead of adding a second plan; a definitive refusal releases it.
 */
export function isUncertainNeonFailure(error: unknown): boolean {
  if (error instanceof WorkspaceAdminRequestError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  return true;
}

export const neonDecideAction: Record<NeonBranchPlan["kind"], NeonDecideAction> = {
  "neon.branch.create": "decideCreate",
  "neon.branch.delete": "decideDelete",
  "neon.branch.switch": "decideSwitch",
};

export const neonExecuteAction: Record<NeonBranchPlan["kind"], NeonExecuteAction> = {
  "neon.branch.create": "executeCreate",
  "neon.branch.delete": "executeDelete",
  "neon.branch.switch": "executeSwitch",
};

/** A client-side refusal or unusable response with its catalogue message. */
export class NeonActionError extends Error {
  readonly key: I18nKey;

  constructor(key: I18nKey) {
    super(key);
    this.name = "NeonActionError";
    this.key = key;
  }
}

export function neonErrorMessage(
  error: unknown,
  i18n: Translator,
  fallback: I18nKey,
  conflict: I18nKey = fallback,
): string {
  if (error instanceof NeonActionError) return i18n.t(error.key);
  if (error instanceof NeonBranchResponseError) {
    return i18n.t(error.reason === "shape"
      ? "workspaceNeonBranches.errors.invalidResponse"
      : "workspaceNeonBranches.errors.mismatch");
  }
  if (error instanceof WorkspaceAdminRequestError && error.status === 409) {
    return workspaceAdminErrorMessage(error, i18n, conflict);
  }
  return workspaceAdminErrorMessage(error, i18n, fallback);
}

export function neonOperationStateKey(operation: NeonBranchOperation): I18nKey {
  const kind = operation.plan.kind;
  switch (operation.state) {
    case "awaiting_approval":
      return "workspaceNeonBranches.state.awaitingApproval";
    case "approved":
      return "workspaceNeonBranches.state.ready";
    case "claimed":
    case "remote_started":
      if (kind === "neon.branch.delete") return "workspaceNeonBranches.state.deleteStarted";
      return kind === "neon.branch.switch"
        ? "workspaceNeonBranches.state.switchStarted"
        : "workspaceNeonBranches.state.createStarted";
    case "reconciling":
      return "workspaceNeonBranches.state.reconciling";
    case "succeeded":
      if (kind === "neon.branch.delete") return "workspaceNeonBranches.state.deleteComplete";
      return kind === "neon.branch.switch"
        ? "workspaceNeonBranches.state.switchComplete"
        : "workspaceNeonBranches.state.createComplete";
    case "needs_repair":
      return "workspaceNeonBranches.state.repairRequired";
    case "failed":
      return "workspaceNeonBranches.state.failed";
    case "cancelled":
      return "workspaceNeonBranches.state.cancelled";
  }
}

export function neonOperationTone(state: NeonBranchOperationState): StatusTone {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "needs_repair") return "danger";
  if (state === "cancelled") return "neutral";
  return "warning";
}

export function neonExecuteLabelKey(operation: NeonBranchOperation): I18nKey {
  const busy = neonOperationBusy(operation);
  if (operation.plan.kind === "neon.branch.delete") {
    return busy ? "workspaceNeonBranches.recheckDelete" : "workspaceNeonBranches.executeDelete";
  }
  if (operation.plan.kind === "neon.branch.switch") {
    return busy ? "workspaceNeonBranches.retrySwitch" : "workspaceNeonBranches.executeSwitch";
  }
  if (operation.needsCredentialFenceRecovery) return "workspaceNeonBranches.recoverCredentials";
  return busy ? "workspaceNeonBranches.recheckState" : "workspaceNeonBranches.executeCreate";
}

const warningKeys = new Map<string, I18nKey>([
  ["NEON_PRODUCTION_DATA_COPY", "workspaceNeonBranches.warning.productionCopy"],
  ["NEON_PROTECTED_PARENT_CREDENTIALS_ROTATE", "workspaceNeonBranches.warning.protectedCredentials"],
  ["NEON_SCHEMA_ONLY_HAS_NO_DATA", "workspaceNeonBranches.warning.schemaOnly"],
  ["NEON_ENDPOINT_CREATES_COMPUTE", "workspaceNeonBranches.warning.endpointCompute"],
  ["NEON_INHERITED_DOPEDB_CREDENTIALS_RETIRED", "workspaceNeonBranches.warning.inheritedCredentials"],
  ["NEON_HEAD_RESOLVED_AT_EXECUTION", "workspaceNeonBranches.warning.executionHead"],
  ["NEON_BRANCH_CONNECTIONS_TERMINATE", "workspaceNeonBranches.warning.connectionsTerminate"],
  ["NEON_SOFT_DELETE_RECOVERY_NOT_GUARANTEED", "workspaceNeonBranches.warning.recoveryNotGuaranteed"],
  ["NEON_CONNECTION_TARGET_CHANGES", "workspaceNeonBranches.warning.targetChanges"],
  ["NEON_ACTIVE_ACCESS_REVOKED", "workspaceNeonBranches.warning.accessRevoked"],
  ["NEON_PRODUCTION_TARGET_SWITCH", "workspaceNeonBranches.warning.productionSwitch"],
]);

const blockerKeys = new Map<string, I18nKey>([
  ["CREATE_OPERATION_INCOMPLETE", "workspaceNeonBranches.blocker.createIncomplete"],
  ["BRANCH_NOT_READY", "workspaceNeonBranches.blocker.branchNotReady"],
  ["ROOT_BRANCH", "workspaceNeonBranches.blocker.rootBranch"],
  ["DEFAULT_BRANCH", "workspaceNeonBranches.blocker.defaultBranch"],
  ["PROTECTED_BRANCH", "workspaceNeonBranches.blocker.protectedBranch"],
  ["CHILD_BRANCHES", "workspaceNeonBranches.blocker.childBranches"],
  ["WORKSPACE_CONNECTIONS", "workspaceNeonBranches.blocker.workspaceConnections"],
  ["ACTIVE_LEASES", "workspaceNeonBranches.blocker.activeLeases"],
  ["PROVIDER_RESTRICTED", "workspaceNeonBranches.blocker.providerRestricted"],
]);

/** Known warning codes are translated; an unknown code is shown verbatim. */
export function neonWarningKey(code: string): I18nKey | null {
  return warningKeys.get(code) ?? null;
}

export function neonBlockerKey(code: string): I18nKey | null {
  return blockerKeys.get(code) ?? null;
}

export const neonBranchStateKey: Record<NeonBranchState, I18nKey> = {
  init: "workspaceNeonBranches.branchState.init",
  resetting: "workspaceNeonBranches.branchState.resetting",
  ready: "workspaceNeonBranches.branchState.ready",
  archived: "workspaceNeonBranches.branchState.archived",
  unknown: "workspaceNeonBranches.branchState.unknown",
};

export function neonBranchStateTone(state: NeonBranchState): StatusTone {
  if (state === "ready") return "success";
  return state === "init" || state === "resetting" ? "warning" : "neutral";
}

export const neonEnvironmentKey: Record<NeonEnvironment, I18nKey> = {
  development: "workspaceNeonBranches.environmentDevelopment",
  production: "workspaceNeonBranches.environmentProduction",
};

/** Same dot semantics as the database environment marker elsewhere in the app. */
export const neonEnvironmentTone: Record<NeonEnvironment, StatusTone> = {
  development: "success",
  production: "danger",
};

export const neonSafeRunPhaseKey: Record<NeonSafeRunPhase, I18nKey> = {
  checkpointing: "workspaceNeonBranches.safeRun.phase.checkpointing",
  access_required: "workspaceNeonBranches.safeRun.phase.accessRequired",
  ready_to_isolate: "workspaceNeonBranches.safeRun.phase.readyToIsolate",
  isolated_active: "workspaceNeonBranches.safeRun.phase.isolatedActive",
  ready_to_discard: "workspaceNeonBranches.safeRun.phase.readyToDiscard",
  discarded: "workspaceNeonBranches.safeRun.phase.discarded",
  needs_attention: "workspaceNeonBranches.safeRun.phase.attention",
};

export const neonSafeRunDescriptionKey: Record<NeonSafeRunPhase, I18nKey> = {
  checkpointing: "workspaceNeonBranches.safeRun.description.checkpointing",
  access_required: "workspaceNeonBranches.safeRun.description.accessRequired",
  ready_to_isolate: "workspaceNeonBranches.safeRun.description.readyToIsolate",
  isolated_active: "workspaceNeonBranches.safeRun.description.isolatedActive",
  ready_to_discard: "workspaceNeonBranches.safeRun.description.readyToDiscard",
  discarded: "workspaceNeonBranches.safeRun.description.discarded",
  needs_attention: "workspaceNeonBranches.safeRun.description.attention",
};

export function neonSafeRunTone(phase: NeonSafeRunPhase): StatusTone {
  if (phase === "discarded") return "success";
  if (phase === "needs_attention") return "danger";
  return phase === "access_required" ? "warning" : "neutral";
}

export const neonSafeRunSteps: readonly I18nKey[] = [
  "workspaceNeonBranches.safeRun.step.checkpoint",
  "workspaceNeonBranches.safeRun.step.isolate",
  "workspaceNeonBranches.safeRun.step.execute",
  "workspaceNeonBranches.safeRun.step.return",
];

export const neonSafeRunStepStateKey: Record<NeonSafeRunStepState, I18nKey> = {
  complete: "workspaceNeonBranches.safeRun.stepComplete",
  active: "workspaceNeonBranches.safeRun.stepCurrent",
  pending: "workspaceNeonBranches.safeRun.stepWaiting",
};

export function formatNeonTime(value: string, lang: Lang, includeDate = true): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat(
    lang === "ko" ? "ko-KR" : "en-US",
    includeDate
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { hour: "numeric", minute: "2-digit", second: "2-digit" },
  ).format(new Date(time));
}
