"use client";

// The controller is the single state owner for Neon branch inventory and operations.
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Integration, ManagedConnection } from "./domain";
import {
  deriveNeonSafeRun,
  neonOperationProjectId,
  parseNeonBranchInventory,
  parseNeonBranchOperations,
  parseNeonBranchPlanResponse,
  type NeonBranchInventory,
  type NeonBranchOperation,
  type NeonBranchOperations,
} from "./neonBranches";
import {
  branchEnvironment,
  operationBusy,
  operationCatalogFingerprint,
  projectTargets,
  type SourcePointKind,
} from "./neonBranchManagerModel";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";
import { providerResponseError } from "./transport";

export function useNeonBranchManager({
  workspaceId,
  integrations,
  managedConnections,
}: {
  workspaceId: string;
  integrations: readonly Integration[];
  managedConnections: readonly ManagedConnection[];
}) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].neonBranches;
  const common = workspaceMessages[locale].common;
  const safeRunSteps = [
    copy.safeRun.steps.checkpoint,
    copy.safeRun.steps.isolate,
    copy.safeRun.steps.execute,
    copy.safeRun.steps.return,
  ];
  const [operationCatalog, setOperationCatalog] = useState<
    Readonly<Record<string, NeonBranchOperations>>
  >({});
  const targets = useMemo(
    () => projectTargets(integrations, managedConnections, operationCatalog, locale),
    [integrations, locale, managedConnections, operationCatalog],
  );
  const [targetKey, setTargetKey] = useState("");
  const [inventory, setInventory] = useState<NeonBranchInventory | null>(null);
  const [operations, setOperations] = useState<readonly NeonBranchOperation[]>([]);
  const [search, setSearch] = useState("");
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [initSource, setInitSource] = useState<"parent-data" | "schema-only">("parent-data");
  const [sourcePointKind, setSourcePointKind] = useState<SourcePointKind>("head");
  const [sourcePointValue, setSourcePointValue] = useState("");
  const [endpoint, setEndpoint] = useState<"none" | "read_write">("read_write");
  const [environment, setEnvironment] = useState<"" | "development" | "production">("");
  const [switchConnectionId, setSwitchConnectionId] = useState("");
  const [switchEnvironment, setSwitchEnvironment] = useState<"" | "development" | "production">("");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutation, setMutation] = useState("");
  const [error, setError] = useState("");

  const selectedTarget = targets.find(
    (target) => `${target.integration.id}:${target.projectId}` === targetKey,
  ) ?? targets[0] ?? null;
  const selectedBranch = inventory?.branches.find(
    (branch) => branch.id === sourceBranchId,
  ) ?? null;
  const knownEnvironment = branchEnvironment(selectedBranch);
  const effectiveEnvironment = knownEnvironment || environment;
  const switchConnections = useMemo(() => (
    inventory?.branches.flatMap((branch) => branch.connections.map((connection) => ({
      ...connection,
      branchId: branch.id,
      branchName: branch.name,
    }))) ?? []
  ), [inventory?.branches]);
  const selectedSwitchConnection = switchConnections.find(
    (connection) => connection.connectionId === switchConnectionId,
  ) ?? switchConnections[0] ?? null;
  const switchKnownEnvironment = branchEnvironment(selectedBranch);
  const effectiveSwitchEnvironment = switchKnownEnvironment || switchEnvironment;

  useEffect(() => {
    const activeIntegrations = integrations.filter((integration) => (
      integration.provider === "neon" && integration.status === "active"
    ));
    if (activeIntegrations.length === 0) {
      setOperationCatalog({});
      return;
    }
    const controller = new AbortController();
    void Promise.all(activeIntegrations.map(async (integration) => {
      const response = await fetch(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
        + `/provider-integrations/${encodeURIComponent(integration.id)}`
        + "/neon-branches/operations",
        { cache: "no-store", signal: controller.signal },
      ).catch(() => null);
      if (!response?.ok) return null;
      const catalog = parseNeonBranchOperations(await response.json().catch(() => null));
      if (
        !catalog
        || catalog.integrationGeneration !== integration.generation
        || catalog.operations.some((operation) => (
          operation.plan.integrationId !== integration.id
        ))
      ) {
        return null;
      }
      return [integration.id, catalog] as const;
    })).then((rows) => {
      if (controller.signal.aborted) return;
      setOperationCatalog(Object.fromEntries(
        rows.filter((row): row is readonly [string, NeonBranchOperations] => row !== null),
      ));
    });
    return () => controller.abort();
  }, [integrations, workspaceId]);

  useEffect(() => {
    if (!targets.length) {
      setTargetKey("");
      return;
    }
    if (!targets.some((target) => (
      `${target.integration.id}:${target.projectId}` === targetKey
    ))) {
      setTargetKey(`${targets[0].integration.id}:${targets[0].projectId}`);
    }
  }, [targetKey, targets]);

  const load = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!selectedTarget) return;
    if (!quiet) setLoading(true);
    setError("");
    const integrationId = encodeURIComponent(selectedTarget.integration.id);
    const projectId = encodeURIComponent(selectedTarget.projectId);
    const base = `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/provider-integrations/${integrationId}/neon-branches`;
    const [inventoryResponse, operationResponse] = await Promise.all([
      fetch(`${base}?project=${projectId}`, { cache: "no-store", signal }).catch(() => null),
      fetch(`${base}/operations`, { cache: "no-store", signal }).catch(() => null),
    ]);
    if (signal?.aborted) return;
    if (!inventoryResponse?.ok || !operationResponse?.ok) {
      setError(await providerResponseError(
        inventoryResponse?.ok ? operationResponse : inventoryResponse,
        copy.errors.load,
        locale,
      ));
      if (!quiet) setLoading(false);
      return;
    }
    const [inventoryBody, operationBody] = await Promise.all([
      inventoryResponse.json().catch(() => null),
      operationResponse.json().catch(() => null),
    ]);
    const nextInventory = parseNeonBranchInventory(inventoryBody);
    const nextOperations = parseNeonBranchOperations(operationBody);
    if (
      !nextInventory
      || !nextOperations
      || nextInventory.projectId !== selectedTarget.projectId
      || nextInventory.integrationGeneration !== selectedTarget.integration.generation
      || nextOperations.integrationGeneration !== selectedTarget.integration.generation
      || nextOperations.operations.some((operation) => (
        operation.plan.integrationId !== selectedTarget.integration.id
      ))
    ) {
      setError(copy.errors.generationMismatch);
      if (!quiet) setLoading(false);
      return;
    }
    const projectOperations = nextOperations.operations.filter((operation) => (
      neonOperationProjectId(operation) === selectedTarget.projectId
    ));
    setInventory(nextInventory);
    setOperations(projectOperations);
    setOperationCatalog((current) => (
      operationCatalogFingerprint(current[selectedTarget.integration.id])
        === operationCatalogFingerprint(nextOperations)
        ? current
        : {
          ...current,
          [selectedTarget.integration.id]: nextOperations,
        }
    ));
    setSourceBranchId((current) => (
      nextInventory.branches.some((branch) => branch.id === current && branch.ready)
        ? current
        : nextInventory.branches.find((branch) => (
          branch.ready && branch.connections.length > 0
        ))?.id
          ?? nextInventory.branches.find((branch) => branch.ready)?.id
          ?? ""
    ));
    if (!quiet) setLoading(false);
  }, [copy.errors, locale, selectedTarget, workspaceId]);

  useEffect(() => {
    setInventory(null);
    setOperations([]);
    setSourceBranchId("");
    setEnvironment("");
    setSwitchConnectionId("");
    setSwitchEnvironment("");
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setEnvironment(branchEnvironment(selectedBranch));
    setSwitchEnvironment(branchEnvironment(selectedBranch));
  }, [selectedBranch]);

  useEffect(() => {
    setSwitchConnectionId((current) => (
      switchConnections.some((connection) => connection.connectionId === current)
        ? current
        : switchConnections[0]?.connectionId ?? ""
    ));
  }, [switchConnections]);

  const visibleBranches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko");
    return inventory?.branches.filter((branch) => (
      !query
      || branch.name.toLocaleLowerCase("ko").includes(query)
      || branch.id.toLocaleLowerCase("ko").includes(query)
      || branch.connections.some((connection) => (
        connection.connectionName.toLocaleLowerCase("ko").includes(query)
      ))
    )) ?? [];
  }, [inventory?.branches, search]);
  const safeRun = useMemo(() => (
    inventory ? deriveNeonSafeRun(inventory, operations) : null
  ), [inventory, operations]);

  async function planCreate() {
    if (
      !selectedTarget
      || !selectedBranch
      || !targetName.trim()
      || !effectiveEnvironment
      || mutation
    ) {
      return;
    }
    const timestamp = sourcePointKind === "timestamp"
      ? Date.parse(sourcePointValue)
      : Number.NaN;
    if (sourcePointKind === "timestamp" && !Number.isFinite(timestamp)) {
      setError(copy.errors.timestamp);
      return;
    }
    const point = sourcePointKind === "head"
      ? { kind: "head" as const }
      : sourcePointKind === "timestamp"
        ? {
          kind: "timestamp" as const,
          value: new Date(timestamp).toISOString(),
        }
        : { kind: "lsn" as const, value: sourcePointValue.trim() };
    setMutation("plan");
    setError("");
    const response = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/provider-integrations/${encodeURIComponent(selectedTarget.integration.id)}`
      + "/neon-branches/operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "planCreate",
          request: {
            idempotencyKey: crypto.randomUUID(),
            projectId: selectedTarget.projectId,
            sourceBranchId: selectedBranch.id,
            targetName: targetName.trim(),
            initSource,
            sourcePoint: point,
            endpoint,
            sourceEnvironment: effectiveEnvironment,
          },
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.errors.createPlan, locale));
      setMutation("");
      return;
    }
    const operation = parseNeonBranchPlanResponse(await response.json().catch(() => null));
    if (!operation || operation.plan.integrationId !== selectedTarget.integration.id) {
      setError(copy.errors.createPlanShape);
      setMutation("");
      return;
    }
    setOperations((current) => [
      operation,
      ...current.filter((item) => item.id !== operation.id),
    ]);
    setTargetName("");
    setShowCreate(false);
    setMutation("");
  }

  async function planDelete(branch = selectedBranch, mutationKey = "delete-plan") {
    if (
      !selectedTarget
      || !branch?.deletion?.canPlan
      || mutation
    ) {
      return;
    }
    setMutation(mutationKey);
    setError("");
    const response = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/provider-integrations/${encodeURIComponent(selectedTarget.integration.id)}`
      + "/neon-branches/operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "planDelete",
          request: {
            idempotencyKey: crypto.randomUUID(),
            projectId: selectedTarget.projectId,
            branchId: branch.id,
          },
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.errors.deletePlan, locale));
      setMutation("");
      return;
    }
    const operation = parseNeonBranchPlanResponse(await response.json().catch(() => null));
    if (
      !operation
      || operation.plan.kind !== "neon.branch.delete"
      || operation.plan.integrationId !== selectedTarget.integration.id
    ) {
      setError(copy.errors.deletePlanShape);
      setMutation("");
      return;
    }
    setOperations((current) => [
      operation,
      ...current.filter((item) => item.id !== operation.id),
    ]);
    setMutation("");
  }

  async function planSwitch(
    connectionId = selectedSwitchConnection?.connectionId ?? "",
    targetBranch = selectedBranch,
    targetEnvironment = effectiveSwitchEnvironment,
    mutationKey = "switch-plan",
  ) {
    const connection = switchConnections.find((item) => (
      item.connectionId === connectionId
    )) ?? null;
    const targetConflict = Boolean(
      targetBranch
      && connection
      && targetBranch.connections.some((item) => (
        item.connectionId !== connection.connectionId
        && item.database === connection.database
      )),
    );
    if (
      !selectedTarget
      || !targetBranch
      || !connection
      || connection.branchId === targetBranch.id
      || (targetBranch.managedAccess !== null && (
        targetBranch.managedAccess.state !== "succeeded"
        || targetBranch.managedAccess.status !== "ready"
      ))
      || targetConflict
      || !targetEnvironment
      || mutation
    ) {
      return;
    }
    setMutation(mutationKey);
    setError("");
    const response = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/provider-integrations/${encodeURIComponent(selectedTarget.integration.id)}`
      + "/neon-branches/operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "planSwitch",
          request: {
            idempotencyKey: crypto.randomUUID(),
            projectId: selectedTarget.projectId,
            connectionId: connection.connectionId,
            targetBranchId: targetBranch.id,
            targetEnvironment,
          },
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.errors.switchPlan, locale));
      setMutation("");
      return;
    }
    const operation = parseNeonBranchPlanResponse(await response.json().catch(() => null));
    if (
      !operation
      || operation.plan.kind !== "neon.branch.switch"
      || operation.plan.integrationId !== selectedTarget.integration.id
    ) {
      setError(copy.errors.switchPlanShape);
      setMutation("");
      return;
    }
    setOperations((current) => [
      operation,
      ...current.filter((item) => item.id !== operation.id),
    ]);
    setMutation("");
  }

  const mutateOperation = useCallback(async (
    operation: NeonBranchOperation,
    action: "approve" | "reject" | "execute",
  ) => {
    if (!selectedTarget || mutation) return;
    setMutation(`${action}:${operation.id}`);
    setError("");
    const deleting = operation.plan.kind === "neon.branch.delete";
    const switching = operation.plan.kind === "neon.branch.switch";
    const body = action === "execute"
      ? {
        action: deleting
          ? "executeDelete"
          : switching
            ? "executeSwitch"
            : "executeCreate",
        operationId: operation.id,
        planHash: operation.planHash,
      }
      : {
        action: deleting
          ? "decideDelete"
          : switching
            ? "decideSwitch"
            : "decideCreate",
        operationId: operation.id,
        planHash: operation.planHash,
        decision: action === "approve" ? "approved" : "rejected",
      };
    const response = await fetch(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
      + `/provider-integrations/${encodeURIComponent(selectedTarget.integration.id)}`
      + "/neon-branches/operations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.errors.operation, locale));
      setMutation("");
      return;
    }
    await load(undefined, true);
    setMutation("");
  }, [copy.errors.operation, load, locale, mutation, selectedTarget, workspaceId]);

  useEffect(() => {
    const active = operations.find((operation) => (
      operation.canExecute && operationBusy(operation)
    ));
    if (!active || mutation || error || !selectedTarget) return;
    const providerDelay = active.reconcileAfter
      ? Date.parse(active.reconcileAfter) - Date.now()
      : 1_500;
    const delay = Math.max(500, Math.min(5_000, providerDelay));
    const timer = window.setTimeout(() => {
      void mutateOperation(active, "execute");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [error, mutateOperation, mutation, operations, selectedTarget]);

  const switchTargetConflict = Boolean(
    selectedBranch
    && selectedSwitchConnection
    && selectedBranch.connections.some((connection) => (
      connection.connectionId !== selectedSwitchConnection.connectionId
      && connection.database === selectedSwitchConnection.database
    )),
  );
  const switchTargetReady = Boolean(selectedBranch) && (
    selectedBranch?.managedAccess === null
    || (
      selectedBranch?.managedAccess?.state === "succeeded"
      && selectedBranch.managedAccess.status === "ready"
    )
  );
  const canPlanSwitch = Boolean(
    selectedBranch
    && selectedSwitchConnection
    && selectedSwitchConnection.branchId !== selectedBranch.id
    && switchTargetReady
    && !switchTargetConflict
    && effectiveSwitchEnvironment,
  );
  const safeRunSourceConnections = safeRun?.sourceBranch?.connections ?? [];
  const safeRunSourceConnection = safeRunSourceConnections.length === 1
    ? safeRunSourceConnections[0]
    : null;
  const safeRunTargetEnvironment: "" | "development" | "production" =
    safeRun?.createOperation.risk === "production_data"
    ? "production"
    : branchEnvironment(safeRun?.branch ?? null) || (
      safeRun?.createOperation.plan.kind === "neon.branch.create"
        ? safeRun.createOperation.plan.source.environment
        : ""
    );
  const safeRunCanIsolate = Boolean(
    safeRun?.phase === "ready_to_isolate"
    && safeRun.branch
    && safeRunSourceConnection
    && safeRunSourceConnection.database
    && !safeRun.branch.connections.some((connection) => (
      connection.connectionId !== safeRunSourceConnection.connectionId
      && connection.database === safeRunSourceConnection.database
    ))
    && safeRunTargetEnvironment,
  );
  const safeRunCanReturn = Boolean(
    safeRun?.phase === "isolated_active"
    && safeRun.switchedFromSource
    && safeRun.activeConnection
    && safeRun.sourceBranch
  );

  return {
    locale,
    copy,
    common,
    safeRunSteps,
    targets,
    targetKey,
    setTargetKey,
    inventory,
    operations,
    search,
    setSearch,
    sourceBranchId,
    setSourceBranchId,
    targetName,
    setTargetName,
    initSource,
    setInitSource,
    sourcePointKind,
    setSourcePointKind,
    sourcePointValue,
    setSourcePointValue,
    endpoint,
    setEndpoint,
    environment,
    setEnvironment,
    switchEnvironment,
    setSwitchEnvironment,
    showCreate,
    setShowCreate,
    loading,
    mutation,
    error,
    selectedTarget,
    selectedBranch,
    knownEnvironment,
    effectiveEnvironment,
    switchConnections,
    selectedSwitchConnection,
    switchKnownEnvironment,
    visibleBranches,
    safeRun,
    load,
    planCreate,
    planDelete,
    planSwitch,
    mutateOperation,
    switchTargetConflict,
    switchTargetReady,
    canPlanSwitch,
    safeRunSourceConnections,
    safeRunSourceConnection,
    safeRunTargetEnvironment,
    safeRunCanIsolate,
    safeRunCanReturn,
    setSwitchConnectionId,
  };
}
