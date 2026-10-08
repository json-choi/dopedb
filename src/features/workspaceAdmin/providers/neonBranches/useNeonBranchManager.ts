// Per-project Neon branch controller and the single writer of its UI state: branch
// selection, the create and switch drafts, the one in-flight mutation, plan
// idempotency keys and the reconcile timer. Reads stay in TanStack Query; the
// control plane decides every plan, approval, execution and reconciliation.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../../../components/Toast";
import { useI18n, type I18nKey } from "../../../../lib/i18n";
import { useCatalogScope } from "../../../../lib/queries";
import { queryResultPhase } from "../../../../lib/queryResultPhase";
import { useEventCallback } from "../../../../lib/useEventCallback";
import { refreshDesktopConnections } from "../../desktopConnections";
import type { NeonDecision, NeonPlanAction, WorkspaceAdminScope } from "../../domain";
import { workspaceAdminQueryKey } from "../../queryKeys";
import { runWorkspaceAdmin } from "../../requests";
import type { ManagedConnection } from "../domain";
import { providerQueryRoots } from "../queries";
import {
  neonExecutionState,
  neonOperationsBelongTo,
  parseNeonBranchPlanResponse,
} from "./branchOperations";
import {
  neonBranchEnvironment,
  neonOperationBusy,
  neonOperationProjectId,
  type NeonBranchInventoryItem,
  type NeonBranchOperation,
  type NeonBranchOperations,
  type NeonBranchPlan,
  type NeonEnvironment,
} from "./domain";
import {
  filterNeonBranches,
  isUncertainNeonFailure,
  NeonActionError,
  neonBranchNameError,
  neonBranchReadyAsTarget,
  neonDecideAction,
  neonErrorMessage,
  neonExecuteAction,
  neonPlanFingerprint,
  neonReconcileDelay,
  neonReferenceFingerprint,
  neonSourcePoint,
  neonSourcePointError,
  neonSwitchConnections,
  neonSwitchTargetConflict,
  resolveSelectedBranch,
  type NeonProjectTarget,
  type NeonSourcePointKind,
} from "./model";
import {
  neonBranchInventoryQuery,
  neonBranchOperationsQuery,
  neonBranchQueryRoots,
} from "./queries";
import { deriveNeonSafeRun, neonSafeRunActions } from "./safeRun";

export type NeonPendingAction =
  | Readonly<{
    kind: "createPlan" | "switchPlan" | "deletePlan" | "isolatePlan" | "returnPlan" | "discardPlan";
  }>
  | Readonly<{ kind: "approve" | "reject" | "execute"; operationId: string }>;

/** Where an action's failure is shown: next to the control that caused it. */
export type NeonErrorScope = "create" | "switch" | "delete" | "safeRun" | `operation:${string}`;

export type NeonCreateDraft = Readonly<{
  targetName: string;
  initSource: "parent-data" | "schema-only";
  endpoint: "none" | "read_write";
  pointKind: NeonSourcePointKind;
  pointValue: string;
}>;

type BranchEnvironmentChoice = Readonly<{ branchId: string; value: NeonEnvironment | "" }>;

type ActionFailure = Readonly<{
  scope: NeonErrorScope;
  error: unknown;
  fallback: I18nKey;
  conflict: I18nKey;
}>;

type PlanSubmission = Readonly<{
  pending: NeonPendingAction;
  errorScope: NeonErrorScope;
  fallback: I18nKey;
  shapeError: I18nKey;
  action: NeonPlanAction;
  expectedKind: NeonBranchPlan["kind"];
  request: Readonly<Record<string, unknown>>;
  onPlanned?: () => void;
}>;

const initialDraft: NeonCreateDraft = {
  targetName: "",
  initSource: "parent-data",
  endpoint: "read_write",
  pointKind: "head",
  pointValue: "",
};
const noEnvironmentChoice: BranchEnvironmentChoice = { branchId: "", value: "" };

function withPlannedOperation(
  current: NeonBranchOperations | undefined,
  operation: NeonBranchOperation,
): NeonBranchOperations | undefined {
  return current
    ? { ...current, operations: [operation, ...current.operations.filter((item) => item.id !== operation.id)] }
    : current;
}

export function useNeonBranchManager({
  scope,
  target,
  managedConnections,
}: {
  scope: WorkspaceAdminScope;
  target: NeonProjectTarget;
  managedConnections: readonly ManagedConnection[];
}) {
  const i18n = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const { integration, projectId } = target;
  const integrationRef = useMemo(
    () => ({ id: integration.id, generation: integration.generation }),
    [integration.generation, integration.id],
  );
  const references = useMemo(
    () => neonReferenceFingerprint(managedConnections, integration.id),
    [integration.id, managedConnections],
  );
  const operationsOptions = neonBranchOperationsQuery(scope, integrationRef, references);
  const inventoryQuery = useQuery(
    neonBranchInventoryQuery(scope, integrationRef, projectId, references),
  );
  const operationsQuery = useQuery(operationsOptions);

  const inventoryData = inventoryQuery.data;
  const inventory = inventoryData
    && inventoryData.projectId === projectId
    && inventoryData.integrationGeneration === integrationRef.generation
    ? inventoryData
    : null;
  const catalog = operationsQuery.data;
  const operations = useMemo(() => (
    catalog && neonOperationsBelongTo(catalog, integrationRef)
      ? catalog.operations.filter((operation) => neonOperationProjectId(operation) === projectId)
      : []
  ), [catalog, integrationRef, projectId]);

  const [chosenBranchId, setChosenBranchId] = useState("");
  const [search, setSearch] = useState("");
  const selectedBranch = useMemo(
    () => (inventory ? resolveSelectedBranch(inventory.branches, chosenBranchId) : null),
    [chosenBranchId, inventory],
  );
  const visibleBranches = useMemo(
    () => filterNeonBranches(inventory?.branches ?? [], search),
    [inventory, search],
  );
  const sourceBranches = useMemo(
    () => inventory?.branches.filter((branch) => branch.ready && !branch.pendingState) ?? [],
    [inventory],
  );
  const knownEnvironment = neonBranchEnvironment(selectedBranch);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<NeonCreateDraft>(initialDraft);
  const [createEnvironment, setCreateEnvironment] = useState(noEnvironmentChoice);
  const createEnvironmentChoice = createEnvironment.branchId === selectedBranch?.id
    ? createEnvironment.value
    : "";
  const effectiveEnvironment = knownEnvironment || createEnvironmentChoice;
  const nameError = neonBranchNameError(draft.targetName);
  const pointError = neonSourcePointError(draft.pointKind, draft.pointValue);

  const switchConnections = useMemo(() => neonSwitchConnections(inventory), [inventory]);
  const [chosenSwitchConnectionId, setChosenSwitchConnectionId] = useState("");
  const selectedSwitchConnection = switchConnections.find(
    (connection) => connection.connectionId === chosenSwitchConnectionId,
  ) ?? switchConnections[0] ?? null;
  const [switchEnvironment, setSwitchEnvironment] = useState(noEnvironmentChoice);
  const switchEnvironmentChoice = switchEnvironment.branchId === selectedBranch?.id
    ? switchEnvironment.value
    : "";
  const effectiveSwitchEnvironment = knownEnvironment || switchEnvironmentChoice;
  const switchTargetReady = neonBranchReadyAsTarget(selectedBranch);
  const switchTargetConflict = neonSwitchTargetConflict(selectedBranch, selectedSwitchConnection);

  const safeRun = useMemo(
    () => (inventory ? deriveNeonSafeRun(inventory, operations) : null),
    [inventory, operations],
  );
  const safeRunActions = useMemo(() => neonSafeRunActions(safeRun), [safeRun]);

  // One mutation at a time: the ref closes the double-click window before React
  // re-renders the disabled controls.
  const busyRef = useRef(false);
  // Keys of plans whose outcome is unknown, so a retry replays rather than duplicates.
  const planKeysRef = useRef(new Map<string, string>());
  const [pending, setPending] = useState<NeonPendingAction | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  async function refreshBranchState(includeSharedConnections: boolean) {
    const keys: (readonly unknown[])[] = [
      workspaceAdminQueryKey(scope, neonBranchQueryRoots.inventory, integrationRef.id),
      workspaceAdminQueryKey(scope, neonBranchQueryRoots.operations, integrationRef.id),
    ];
    if (includeSharedConnections) {
      keys.push(
        workspaceAdminQueryKey(scope, providerQueryRoots.inventory),
        workspaceAdminQueryKey(scope, providerQueryRoots.sharedConnections),
      );
    }
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  }

  async function runExclusive(
    action: NeonPendingAction,
    errorScope: NeonErrorScope,
    fallback: I18nKey,
    conflict: I18nKey,
    task: () => Promise<void>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(action);
    setFailure(null);
    try {
      await task();
    } catch (error) {
      setFailure({ scope: errorScope, error, fallback, conflict });
    } finally {
      busyRef.current = false;
      setPending(null);
    }
  }

  function submitPlan(input: PlanSubmission) {
    void runExclusive(input.pending, input.errorScope, input.fallback, input.fallback, async () => {
      const fingerprint = neonPlanFingerprint(integrationRef.id, input.action, input.request);
      const planKeys = planKeysRef.current;
      const idempotencyKey = planKeys.get(fingerprint) ?? crypto.randomUUID();
      planKeys.set(fingerprint, idempotencyKey);
      let body: unknown;
      try {
        body = await runWorkspaceAdmin(scope.accountId, {
          kind: "planNeonBranchOperation",
          workspaceId: scope.workspaceId,
          integrationId: integrationRef.id,
          action: input.action,
          request: { idempotencyKey, ...input.request },
        });
      } catch (error) {
        if (!isUncertainNeonFailure(error)) planKeys.delete(fingerprint);
        throw error;
      }
      const operation = parseNeonBranchPlanResponse(body);
      if (
        !operation
        || operation.plan.kind !== input.expectedKind
        || operation.plan.integrationId !== integrationRef.id
        || operation.plan.integrationGeneration !== integrationRef.generation
      ) {
        throw new NeonActionError(input.shapeError);
      }
      planKeys.delete(fingerprint);
      queryClient.setQueryData(
        operationsOptions.queryKey,
        (current) => withPlannedOperation(current, operation),
      );
      input.onPlanned?.();
      toast(i18n.t("workspaceNeonBranches.planCreated"));
      await refreshBranchState(false);
    });
  }

  function planCreate() {
    const targetName = draft.targetName.trim();
    const sourcePoint = neonSourcePoint(draft.pointKind, draft.pointValue);
    if (busyRef.current || !selectedBranch || !targetName || nameError || !effectiveEnvironment) return;
    if (!sourcePoint) {
      setFailure({
        scope: "create",
        error: new NeonActionError(draft.pointKind === "lsn"
          ? "workspaceNeonBranches.lsnInvalid"
          : "workspaceNeonBranches.errors.timestamp"),
        fallback: "workspaceNeonBranches.errors.createPlan",
        conflict: "workspaceNeonBranches.errors.createPlan",
      });
      return;
    }
    submitPlan({
      pending: { kind: "createPlan" },
      errorScope: "create",
      fallback: "workspaceNeonBranches.errors.createPlan",
      shapeError: "workspaceNeonBranches.errors.createPlanShape",
      action: "planCreate",
      expectedKind: "neon.branch.create",
      request: {
        projectId,
        sourceBranchId: selectedBranch.id,
        targetName,
        initSource: draft.initSource,
        sourcePoint,
        endpoint: draft.endpoint,
        sourceEnvironment: effectiveEnvironment,
      },
      onPlanned: () => {
        setDraft((current) => ({ ...current, targetName: "" }));
        setShowCreate(false);
      },
    });
  }

  function planDelete(branch: NeonBranchInventoryItem | null, kind: "deletePlan" | "discardPlan") {
    if (!branch?.deletion?.canPlan) return;
    submitPlan({
      pending: { kind },
      errorScope: kind === "discardPlan" ? "safeRun" : "delete",
      fallback: "workspaceNeonBranches.errors.deletePlan",
      shapeError: "workspaceNeonBranches.errors.deletePlanShape",
      action: "planDelete",
      expectedKind: "neon.branch.delete",
      request: { projectId, branchId: branch.id },
    });
  }

  function planSwitch(
    connectionId: string | undefined,
    targetBranch: NeonBranchInventoryItem | null,
    targetEnvironment: NeonEnvironment | "",
    kind: "switchPlan" | "isolatePlan" | "returnPlan",
  ) {
    const connection = switchConnections.find((item) => item.connectionId === connectionId) ?? null;
    if (
      !targetBranch
      || !connection
      || connection.branchId === targetBranch.id
      || !neonBranchReadyAsTarget(targetBranch)
      || neonSwitchTargetConflict(targetBranch, connection)
      || !targetEnvironment
    ) {
      return;
    }
    submitPlan({
      pending: { kind },
      errorScope: kind === "switchPlan" ? "switch" : "safeRun",
      fallback: "workspaceNeonBranches.errors.switchPlan",
      shapeError: "workspaceNeonBranches.errors.switchPlanShape",
      action: "planSwitch",
      expectedKind: "neon.branch.switch",
      request: {
        projectId,
        connectionId: connection.connectionId,
        targetBranchId: targetBranch.id,
        targetEnvironment,
      },
    });
  }

  function decide(operation: NeonBranchOperation, decision: NeonDecision) {
    void runExclusive(
      { kind: decision === "approved" ? "approve" : "reject", operationId: operation.id },
      `operation:${operation.id}`,
      "workspaceNeonBranches.errors.operation",
      "workspaceNeonBranches.errors.conflict",
      async () => {
        try {
          await runWorkspaceAdmin(scope.accountId, {
            kind: "decideNeonBranchOperation",
            workspaceId: scope.workspaceId,
            integrationId: integrationRef.id,
            action: neonDecideAction[operation.plan.kind],
            operationId: operation.id,
            planHash: operation.planHash,
            decision,
          });
        } finally {
          await refreshBranchState(false);
        }
      },
    );
  }

  // Stable identity so the reconcile timer is not reset on every render.
  const execute = useEventCallback((operation: NeonBranchOperation) => {
    const plan = operation.plan;
    void runExclusive(
      { kind: "execute", operationId: operation.id },
      `operation:${operation.id}`,
      "workspaceNeonBranches.errors.operation",
      "workspaceNeonBranches.errors.conflict",
      async () => {
        // Only a switch changes a shared connection: it is pinned to a new revision on
        // the target branch when the server reports the commit, or possibly when the
        // response was lost after an atomic commit.
        let connectionChanged = false;
        try {
          const body = await runWorkspaceAdmin(scope.accountId, {
            kind: "executeNeonBranchOperation",
            workspaceId: scope.workspaceId,
            integrationId: integrationRef.id,
            action: neonExecuteAction[plan.kind],
            operationId: operation.id,
            planHash: operation.planHash,
          });
          connectionChanged = neonExecutionState(body) === "succeeded";
        } catch (error) {
          connectionChanged = isUncertainNeonFailure(error);
          throw error;
        } finally {
          const switched = plan.kind === "neon.branch.switch";
          await refreshBranchState(switched);
          if (switched && connectionChanged) {
            // Best effort and not part of the command: the next workspace refresh
            // converges the Explorer if this pull cannot complete now.
            // The synchronized template now carries the new branch-bound revision.
            void refreshDesktopConnections(queryClient, catalogScope.key, [plan.source.connectionId])
              .catch(() => undefined);
          }
        }
      },
    );
  });

  // A started provider operation keeps advancing while this panel is mounted. Any
  // failure, a running mutation or an unreadable history stops it until the user acts.
  const reconcileTarget = useMemo(
    () => operations.find((operation) => operation.canExecute && neonOperationBusy(operation)) ?? null,
    [operations],
  );
  const reconcileBlocked = pending !== null || failure !== null || operationsQuery.isError;
  useEffect(() => {
    if (!reconcileTarget || reconcileBlocked) return undefined;
    const timer = window.setTimeout(
      () => execute(reconcileTarget),
      neonReconcileDelay(reconcileTarget, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [execute, reconcileBlocked, reconcileTarget]);

  function refresh() {
    if (busyRef.current) return;
    setFailure(null);
    void inventoryQuery.refetch();
    void operationsQuery.refetch();
  }

  function errorFor(errorScope: NeonErrorScope): string | null {
    return failure?.scope === errorScope
      ? neonErrorMessage(failure.error, i18n, failure.fallback, failure.conflict)
      : null;
  }

  const busy = pending !== null;
  return {
    target,
    busy,
    pending,
    errorFor,
    refresh,
    refreshing: inventoryQuery.isFetching || operationsQuery.isFetching,
    inventory,
    inventoryPhase: queryResultPhase(inventory ?? undefined, inventoryQuery.error),
    inventoryError: inventoryQuery.error
      ? neonErrorMessage(inventoryQuery.error, i18n, "workspaceNeonBranches.errors.load")
      : null,
    operations,
    operationsPhase: queryResultPhase(catalog, operationsQuery.error),
    operationsError: operationsQuery.error
      ? neonErrorMessage(operationsQuery.error, i18n, "workspaceNeonBranches.errors.loadOperations")
      : null,
    search,
    setSearch,
    visibleBranches,
    selectedBranch,
    selectBranch: setChosenBranchId,
    knownEnvironment,
    showCreate,
    toggleCreate: () => setShowCreate((current) => !current),
    draft,
    updateDraft: (patch: Partial<NeonCreateDraft>) => setDraft((current) => ({ ...current, ...patch })),
    sourceBranches,
    createEnvironmentChoice,
    chooseCreateEnvironment: (value: NeonEnvironment | "") => {
      if (selectedBranch) setCreateEnvironment({ branchId: selectedBranch.id, value });
    },
    effectiveEnvironment,
    nameError,
    pointError,
    canPlanCreate: Boolean(
      !busy
      && selectedBranch
      && draft.targetName.trim()
      && !nameError
      && effectiveEnvironment
      && (draft.pointKind === "head" || (draft.pointValue.trim() && !pointError)),
    ),
    planCreate,
    switchConnections,
    selectedSwitchConnection,
    chooseSwitchConnection: setChosenSwitchConnectionId,
    switchEnvironmentChoice,
    chooseSwitchEnvironment: (value: NeonEnvironment | "") => {
      if (selectedBranch) setSwitchEnvironment({ branchId: selectedBranch.id, value });
    },
    switchTargetReady,
    switchTargetConflict,
    canPlanSwitch: Boolean(
      selectedBranch
      && selectedSwitchConnection
      && selectedSwitchConnection.branchId !== selectedBranch.id
      && switchTargetReady
      && !switchTargetConflict
      && effectiveSwitchEnvironment,
    ),
    planSelectedSwitch: () => planSwitch(
      selectedSwitchConnection?.connectionId,
      selectedBranch,
      effectiveSwitchEnvironment,
      "switchPlan",
    ),
    planSelectedDelete: () => planDelete(selectedBranch, "deletePlan"),
    safeRun,
    safeRunActions,
    selectSafeRunConnection: () => {
      if (!safeRun?.branch) return;
      setChosenBranchId(safeRun.branch.id);
      setChosenSwitchConnectionId(safeRunActions.sourceConnections[0]?.connectionId ?? "");
    },
    planIsolation: () => planSwitch(
      safeRunActions.sourceConnection?.connectionId,
      safeRun?.branch ?? null,
      safeRunActions.targetEnvironment,
      "isolatePlan",
    ),
    planReturn: () => planSwitch(
      safeRun?.activeConnection?.connectionId,
      safeRun?.sourceBranch ?? null,
      safeRun?.createOperation.plan.source.environment ?? "",
      "returnPlan",
    ),
    planDiscard: () => planDelete(safeRun?.branch ?? null, "discardPlan"),
    decide,
    execute,
  };
}

export type NeonBranchController = ReturnType<typeof useNeonBranchManager>;
