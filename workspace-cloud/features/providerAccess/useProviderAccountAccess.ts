"use client";

// Cloud-account access owns provider inventory, account mutations, and the GCP
// OAuth-return setup flow without depending on shared connection inventory.
import { useCallback, useEffect } from "react";

import { providerAccountMutations } from "./providerAccountMutations";
import { useProviderAccessState } from "./state";
import {
  fetchProviderAccessWithManagedConnections,
  fetchProviderAccountSnapshot,
  providerResponseError,
} from "./transport";
import { useGcpProviderSetup } from "./useGcpProviderSetup";
import { useGcpRecoveryState } from "./useGcpRecoveryState";
import { useManagedConnectionRecovery } from "./useManagedConnectionRecovery";
import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { workspaceMessages } from "../../lib/workspace-messages";

export function useProviderAccountAccess(
  workspaceId: string,
  gcpSetupId: string | null = null,
) {
  const locale = useWorkspaceLocale();
  const copy = workspaceMessages[locale].providerAccess;
  const [state, setField] = useProviderAccessState();
  const {
    providers,
    integrations,
    managedConnections,
    managedConnectionsLoaded,
    setupProviderId,
    neonConfiguration,
    vaultConfiguration,
    gcpSetupInventory,
    gcpSetupInstances,
    selectedGcpProjectId,
    selectedGcpInstanceId,
    gcpEnvironmentClassification,
    gcpProductionApproved,
    gcpIamAuthenticationChangeApproved,
    gcpPermissionCheck,
    gcpIamRoleGrantApproved,
    gcpSetupError,
    gcpSetupReconnectRequired,
    loading,
    mutation,
    error,
  } = state;
  const setProviders = setField("providers");
  const setIntegrations = setField("integrations");
  const setManagedConnections = setField("managedConnections");
  const setManagedConnectionsLoaded = setField("managedConnectionsLoaded");
  const setGcpEnvironmentClassification = setField("gcpEnvironmentClassification");
  const setGcpProductionApproved = setField("gcpProductionApproved");
  const setGcpIamAuthenticationChangeApproved = setField(
    "gcpIamAuthenticationChangeApproved",
  );
  const setGcpIamRoleGrantApproved = setField("gcpIamRoleGrantApproved");
  const setLoading = setField("loading");
  const setMutation = setField("mutation");
  const setError = setField("error");
  const setupProvider = providers.find((item) => item.id === setupProviderId) ?? null;
  const recovery = useGcpRecoveryState({
    workspaceId,
    gcpSetupId,
    managedConnections,
  });
  const { beginInventoryLoad, finishInventoryLoad } = recovery;
  const repairManagedConnection = useManagedConnectionRecovery({
    workspaceId,
    providers,
    mutation,
    locale,
    copy,
    setMutation,
    setError,
  });

  const loadAccountAccess = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setManagedConnectionsLoaded(false);
    beginInventoryLoad();
    const { response, data } = await fetchProviderAccountSnapshot(workspaceId, signal);
    if (signal?.aborted) return;
    if (!response?.ok) {
      setError(await providerResponseError(response, copy.loadError, locale));
      finishInventoryLoad();
      setLoading(false);
      return;
    }
    if (!data) {
      setError(copy.shapeError);
      finishInventoryLoad();
      setLoading(false);
      return;
    }
    setProviders(data.providers);
    setIntegrations(data.integrations);
    setError("");
    setLoading(false);

    // Managed database inventory enriches account cards, but it is not part of
    // the account authorization boundary. Its failure must not hide accounts.
    const inventory = await fetchProviderAccessWithManagedConnections(
      workspaceId,
      signal,
    );
    if (signal?.aborted) return;
    if (inventory.response?.ok && inventory.data?.managedConnections) {
      setManagedConnections(inventory.data.managedConnections);
      setManagedConnectionsLoaded(true);
    }
    finishInventoryLoad();
  }, [
    copy,
    locale,
    setError,
    setIntegrations,
    setLoading,
    setManagedConnections,
    setManagedConnectionsLoaded,
    setProviders,
    beginInventoryLoad,
    finishInventoryLoad,
    workspaceId,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAccountAccess(controller.signal);
    return () => controller.abort();
  }, [loadAccountAccess]);

  const gcpSetup = useGcpProviderSetup({
    workspaceId,
    gcpSetupId,
    locale,
    copy,
    state,
    setField,
    gcpRecoveryTarget: recovery.target,
    gcpRecoveryTargetPending: recovery.pending,
    gcpRecoveryTargetMissing: recovery.targetMissing,
    clearGcpRecoveryIntent: recovery.clear,
  });
  const mutations = providerAccountMutations({
    workspaceId,
    locale,
    copy,
    state,
    setField,
    loadAccountAccess,
    repairManagedConnection,
    restartGcpSetup: gcpSetup.reconnectGcpSetup,
  });

  const { completeGcpSetup, selectGcpInstance, selectGcpProject } = gcpSetup;
  const {
    beginConnect,
    beginReconnect,
    connect,
    disconnect,
    reconnectGcpSetup,
    setNeonConfiguration,
    setVaultConfiguration,
  } = mutations;

  return {
    providers,
    integrations,
    managedConnections,
    managedConnectionsLoaded,
    managedConnectionsSettled: recovery.inventorySettled,
    gcpRecoveryIntent: recovery.intent,
    gcpRecoveryTarget: recovery.target,
    gcpRecoveryTargetPending: recovery.pending,
    gcpRecoveryTargetMissing: recovery.targetMissing,
    setupProvider,
    neonConfiguration,
    vaultConfiguration,
    gcpSetupId,
    gcpSetupInventory,
    gcpSetupInstances,
    selectedGcpProjectId,
    selectedGcpInstanceId,
    gcpEnvironmentClassification,
    gcpProductionApproved,
    gcpIamAuthenticationChangeApproved,
    gcpPermissionCheck,
    gcpIamRoleGrantApproved,
    gcpSetupError,
    gcpSetupReconnectRequired,
    loading,
    mutation,
    error,
    beginConnect,
    beginReconnect,
    completeGcpSetup,
    connect,
    disconnect,
    reconnectGcpSetup,
    selectGcpInstance,
    selectGcpProject,
    setGcpEnvironmentClassification,
    setGcpIamRoleGrantApproved,
    setGcpProductionApproved,
    setGcpIamAuthenticationChangeApproved,
    setNeonConfiguration,
    setVaultConfiguration,
  };
}

export type ProviderAccountAccessController = ReturnType<
  typeof useProviderAccountAccess
>;
