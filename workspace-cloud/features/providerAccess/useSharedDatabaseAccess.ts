"use client";

// Shared-database access owns connection inventory, provider-resource
// discovery, and import mutations independently from account setup state.
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  providerImportDisplayName,
  type Integration,
  type PendingProviderImport,
  type Resource,
  type ResourceLevel,
  type SharedConnection,
} from "./domain";
import { useProviderAccessState } from "./state";
import {
  fetchProviderAccessWithManagedConnections,
  fetchSharedConnectionsSnapshot,
  providerResponseError,
} from "./transport";
import { useNeonProviderBootstrap } from "./useNeonProviderBootstrap";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";

export function useSharedDatabaseAccess(
  workspaceId: string,
  initialIntegrationId: string | null = null,
) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].providerAccess;
  const [state, setField] = useProviderAccessState();
  const {
    providers,
    integrations,
    connections,
    managedConnections,
    selectedIntegrationId,
    selection,
    resourceOptions,
    neonEnvironmentClassification,
    neonBootstrap,
    neonPublicAclApproved,
    neonProductionApproved,
    loading,
    resourcePending,
    mutation,
    error,
  } = state;
  const setProviders = setField("providers");
  const setIntegrations = setField("integrations");
  const setConnections = setField("connections");
  const setManagedConnections = setField("managedConnections");
  const setManagedConnectionsLoaded = setField("managedConnectionsLoaded");
  const setSelectedIntegrationId = setField("selectedIntegrationId");
  const setSelection = setField("selection");
  const setResourceOptions = setField("resourceOptions");
  const setNeonEnvironmentClassification = setField("neonEnvironmentClassification");
  const setNeonPublicAclApproved = setField("neonPublicAclApproved");
  const setNeonProductionApproved = setField("neonProductionApproved");
  const setLoading = setField("loading");
  const setResourcePending = setField("resourcePending");
  const setMutation = setField("mutation");
  const setError = setField("error");
  const repairManagedConnection = useManagedConnectionRecovery({
    workspaceId,
    providers,
    mutation,
    locale,
    copy,
    setMutation,
    setError,
  });
  const pendingImportRef = useRef<PendingProviderImport | null>(null);
  const selectedIntegration = integrations.find(
    (item) => item.id === selectedIntegrationId,
  ) ?? null;
  const selectedProvider = providers.find(
    (item) => item.id === selectedIntegration?.provider,
  ) ?? null;
  const importReceipt = useMemo(() => {
    if (selectedProvider?.id === "neon") {
      return neonBootstrap.receipt || null;
    }
    const finalLevel = selectedProvider?.resourceLevels.at(-1);
    if (!finalLevel) return null;
    return resourceOptions[finalLevel.key]?.find(
      (item) => item.value === selection[finalLevel.key],
    )?.receipt ?? null;
  }, [
    neonBootstrap.receipt,
    resourceOptions,
    selectedProvider?.id,
    selectedProvider?.resourceLevels,
    selection,
  ]);

  useEffect(() => {
    const pending = pendingImportRef.current;
    if (
      pending
      && (
        pending.integrationId !== selectedIntegrationId
        || pending.receipt !== importReceipt
      )
    ) {
      pendingImportRef.current = null;
    }
  }, [importReceipt, selectedIntegrationId]);

  const clearPendingImport = useCallback(() => {
    pendingImportRef.current = null;
  }, []);
  const {
    applyNeonBootstrap,
    classifyNeonEnvironment,
    preflightNeonBootstrap,
    resetNeonBootstrap,
  } = useNeonProviderBootstrap({
    workspaceId,
    locale,
    copy,
    state,
    setField,
    selectedProvider,
    selectedIntegration,
    clearPendingImport,
  });

  const resetResources = useCallback(() => {
    pendingImportRef.current = null;
    setSelection({});
    setResourceOptions({});
    resetNeonBootstrap();
  }, [resetNeonBootstrap, setResourceOptions, setSelection]);

  const loadSharedDatabaseAccess = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setManagedConnectionsLoaded(false);
    const [providerSnapshot, connectionSnapshot] = await Promise.all([
      fetchProviderAccessWithManagedConnections(workspaceId, signal),
      fetchSharedConnectionsSnapshot(workspaceId, signal),
    ]);
    if (signal?.aborted) return;
    if (!providerSnapshot.response?.ok || !connectionSnapshot.response?.ok) {
      setError(await providerResponseError(
        providerSnapshot.response?.ok
          ? connectionSnapshot.response
          : providerSnapshot.response,
        copy.loadError,
        locale,
      ));
      setLoading(false);
      return;
    }
    if (
      !providerSnapshot.data?.managedConnections
      || !connectionSnapshot.data
    ) {
      setError(copy.shapeError);
      setLoading(false);
      return;
    }
    const nextConnections = connectionSnapshot.data.connections;
    const nextIntegrations = providerSnapshot.data.integrations;
    setProviders(providerSnapshot.data.providers);
    setIntegrations(nextIntegrations);
    setManagedConnections(providerSnapshot.data.managedConnections);
    setManagedConnectionsLoaded(true);
    setConnections(nextConnections);
    setSelectedIntegrationId((current) => (
      nextIntegrations.some((item) => item.id === current)
        ? current
        : nextIntegrations.find((item) => item.id === initialIntegrationId)?.id
          ?? nextIntegrations[0]?.id
          ?? ""
    ));
    setError("");
    setLoading(false);
  }, [
    copy,
    initialIntegrationId,
    locale,
    setConnections,
    setError,
    setIntegrations,
    setLoading,
    setManagedConnections,
    setManagedConnectionsLoaded,
    setProviders,
    setSelectedIntegrationId,
    workspaceId,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSharedDatabaseAccess(controller.signal);
    return () => controller.abort();
  }, [loadSharedDatabaseAccess]);

  const discover = useCallback(async (
    level: ResourceLevel,
    integrationId: string,
    values: Record<string, string>,
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ kind: level.kind, ...values });
    setResourcePending(true);
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/provider-integrations/${
        integrationId
      }/resources?${query}`,
      { cache: "no-store", signal },
    ).catch(() => null);
    if (signal?.aborted) return null;
    setResourcePending(false);
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.resourcesError, locale));
      return null;
    }
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body?.resources)) {
      setError(copy.resourcesShapeError);
      return null;
    }
    setError("");
    return body.resources as Resource[];
  }, [copy, locale, setError, setResourcePending, workspaceId]);

  const firstResourceLevelKey = selectedProvider?.resourceLevels[0]?.key ?? "";
  const firstResourceLevelKind = selectedProvider?.resourceLevels[0]?.kind ?? "";
  const firstResourceLevelLabel = selectedProvider?.resourceLevels[0]?.label ?? "";

  useEffect(() => {
    if (!selectedIntegrationId || !firstResourceLevelKey) {
      resetResources();
      return;
    }
    const controller = new AbortController();
    resetResources();
    void discover(
      {
        key: firstResourceLevelKey,
        kind: firstResourceLevelKind,
        label: firstResourceLevelLabel,
      },
      selectedIntegrationId,
      {},
      controller.signal,
    ).then((rows) => {
      if (!rows || controller.signal.aborted) return;
      setResourceOptions({ [firstResourceLevelKey]: rows });
    });
    return () => controller.abort();
  }, [
    discover,
    firstResourceLevelKey,
    firstResourceLevelKind,
    firstResourceLevelLabel,
    resetResources,
    selectedIntegrationId,
    setResourceOptions,
  ]);

  async function deleteSharedConnection(connection: SharedConnection) {
    if (
      mutation
      || connection.accessMode !== "manage"
      || !Number.isInteger(connection.revision)
      || connection.revision < 1
      || !window.confirm(
        `${copy.deleteConfirmPrefix}${connection.name}${copy.deleteConfirmSuffix}`,
      )
    ) {
      return;
    }
    setMutation(`delete-connection:${connection.id}`);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`
        + `/connections/${encodeURIComponent(connection.id)}`,
        {
          method: "DELETE",
          headers: {
            "x-dopedb-expected-revision": String(connection.revision),
          },
        },
      ).catch(() => null);
      if (!response?.ok) {
        setError(await providerResponseError(response, copy.deleteError, locale));
        return;
      }
      resetResources();
      await loadSharedDatabaseAccess();
    } finally {
      setMutation("");
    }
  }

  async function selectResource(levelIndex: number, value: string) {
    if (!selectedProvider || !selectedIntegrationId) return;
    resetNeonBootstrap();
    const levels = selectedProvider.resourceLevels;
    const level = levels[levelIndex];
    const nextSelection = Object.fromEntries(
      levels.slice(0, levelIndex).map((item) => [
        item.key,
        selection[item.key] ?? "",
      ]),
    );
    nextSelection[level.key] = value;
    setSelection(nextSelection);
    setResourceOptions((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => (
        levels.findIndex((item) => item.key === key) <= levelIndex
      )),
    ));
    const nextLevel = levels[levelIndex + 1];
    if (!value || !nextLevel) return;
    const rows = await discover(nextLevel, selectedIntegrationId, nextSelection);
    if (rows) {
      setResourceOptions((current) => ({ ...current, [nextLevel.key]: rows }));
    }
  }

  async function importDiscoveredResource() {
    if (!selectedIntegration || !selectedProvider || mutation) return;
    const finalLevel = selectedProvider.resourceLevels.at(-1)!;
    const finalResource = resourceOptions[finalLevel.key]?.find(
      (item) => item.value === selection[finalLevel.key],
    );
    const isNeon = selectedProvider.id === "neon";
    if (
      !finalResource?.selectionProof
      || (!isNeon && (
        finalResource.production !== false
        && finalResource.production !== true
      ))
      || finalResource.ready !== true
    ) return;
    if (
      isNeon
      && (
        !neonBootstrap.report
        || !neonBootstrap.receipt
        || !neonBootstrap.receiptExpiresAt
        || Date.parse(neonBootstrap.receiptExpiresAt) <= Date.now()
      )
    ) {
      setError(copy.neonVerificationExpired);
      return;
    }
    const productionApproved = isNeon
      ? neonBootstrap.report?.production === true
      : finalResource.production === true;
    const name = providerImportDisplayName(selectedProvider.name, finalResource.name);
    if (!name) return;
    const confirmation = productionApproved
      ? `${copy.productionConfirmPrefix}${finalResource.name}${copy.productionConfirmBody}`
      : null;
    if (confirmation && !window.confirm(confirmation)) return;
    setMutation(`import:${selectedIntegration.id}`);
    setError("");
    try {
      let receipt = importReceipt;
      if (
        !isNeon
        && (
          !receipt
          || !finalResource.receiptExpiresAt
          || Date.parse(finalResource.receiptExpiresAt) <= Date.now()
        )
      ) {
        const proof = finalResource.selectionProof;
        const receiptResponse = await fetch(
          `/api/v1/workspaces/${workspaceId}/provider-integrations/${
            selectedIntegration.id
          }/resources`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ selectionProof: proof }),
          },
        ).catch(() => null);
        if (!receiptResponse?.ok) {
          setError(await providerResponseError(
            receiptResponse,
            copy.receiptError,
            locale,
          ));
          return;
        }
        const receiptBody = await receiptResponse.json().catch(() => null);
        if (
          typeof receiptBody?.receipt !== "string"
          || typeof receiptBody?.receiptExpiresAt !== "string"
        ) {
          setError(copy.receiptShapeError);
          return;
        }
        receipt = receiptBody.receipt;
        setResourceOptions((current) => ({
          ...current,
          [finalLevel.key]: (current[finalLevel.key] ?? []).map((item) => (
            item.selectionProof === proof
              ? {
                ...item,
                receipt: receiptBody.receipt,
                receiptExpiresAt: receiptBody.receiptExpiresAt,
              }
              : item
          )),
        }));
      }
      if (!receipt) return;
      let pending = pendingImportRef.current;
      if (
        !pending
        || pending.integrationId !== selectedIntegration.id
        || pending.receipt !== receipt
        || pending.name !== name
      ) {
        const idempotencyKey = crypto.randomUUID();
        pending = {
          integrationId: selectedIntegration.id,
          receipt,
          name,
          body: JSON.stringify({
            receipt,
            idempotencyKey,
            name,
            productionApproved,
          }),
        };
        pendingImportRef.current = pending;
      }
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/provider-integrations/${selectedIntegration.id}/imports`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: pending.body,
        },
      ).catch(() => null);
      if (!response?.ok) {
        setError(await providerResponseError(response, copy.importError, locale));
        return;
      }
      pendingImportRef.current = null;
      resetResources();
      await loadSharedDatabaseAccess();
    } finally {
      setMutation("");
    }
  }

  const finalResourceLevel = selectedProvider?.resourceLevels.at(-1);
  const resourceComplete = Boolean(
    selectedProvider?.resourceLevels.every((level) => selection[level.key])
      && finalResourceLevel
      && resourceOptions[finalResourceLevel.key]?.some(
        (item) => (
          item.value === selection[finalResourceLevel.key]
          && item.ready === true
          && typeof item.selectionProof === "string"
          && (
            selectedProvider.id === "neon"
            || item.production === false
            || item.production === true
          )
        ),
      ),
  );
  return {
    providers,
    integrations,
    connections,
    managedConnections,
    selectedIntegrationId,
    selection,
    resourceOptions,
    neonEnvironmentClassification,
    neonBootstrap,
    neonPublicAclApproved,
    neonProductionApproved,
    loading,
    resourcePending,
    mutation,
    error,
    selectedIntegration,
    selectedProvider,
    resourceComplete,
    applyNeonBootstrap,
    classifyNeonEnvironment,
    deleteSharedConnection,
    importDiscoveredResource,
    preflightNeonBootstrap,
    repairManagedConnection,
    resetResources,
    selectResource,
    setNeonEnvironmentClassification,
    setNeonPublicAclApproved,
    setNeonProductionApproved,
    setSelectedIntegrationId,
  };
}

export type SharedDatabaseAccessController = ReturnType<
  typeof useSharedDatabaseAccess
>;
