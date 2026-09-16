// Query options for provider integrations, credential bindings and provisioning
// status. Every inventory call is raced against a timeout and never retried, so a
// provider that stops answering surfaces as an error instead of a hung screen.
import { queryOptions } from "@tanstack/react-query";

import {
  listProviderCredentialBindings,
  listProviderIntegrations,
  listProviderProvisioningForConnection,
  listProviderProvisioningStatuses,
} from "./tauriAdapter";

const PROVIDER_INVENTORY_TIMEOUT_MS = 8_000;

async function withProviderInventoryTimeout<T>(
  operation: Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Provider inventory request timed out")),
      PROVIDER_INVENTORY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

export const providerCredentialQueryKeys = {
  bindings: () => ["providerCredentials", "bindings"] as const,
  integrations: () => ["providerCredentials", "integrations"] as const,
  provisioning: (connectionId: string) => ["providerProvisioning", connectionId] as const,
  provisioners: () => ["providerProvisioning", "drivers"] as const,
};

export function providerIntegrationsQuery() {
  return queryOptions({
    queryKey: providerCredentialQueryKeys.integrations(),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      withProviderInventoryTimeout(listProviderIntegrations()),
  });
}

export function providerCredentialBindingsQuery() {
  return queryOptions({
    queryKey: providerCredentialQueryKeys.bindings(),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      withProviderInventoryTimeout(
        listProviderCredentialBindings(),
      ),
  });
}

export function providerProvisioningStatusesQuery() {
  return queryOptions({
    queryKey: providerCredentialQueryKeys.provisioners(),
    staleTime: 30_000,
    retry: false,
    queryFn: () => withProviderInventoryTimeout(listProviderProvisioningStatuses()),
  });
}

export function providerProvisioningForConnectionQuery(connectionId: string) {
  return queryOptions({
    queryKey: providerCredentialQueryKeys.provisioning(connectionId),
    staleTime: 5_000,
    retry: false,
    queryFn: () => withProviderInventoryTimeout(
      listProviderProvisioningForConnection(connectionId),
    ),
  });
}
