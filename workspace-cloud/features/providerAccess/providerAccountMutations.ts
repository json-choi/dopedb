// Cloud-account mutation orchestration stays separate from the account snapshot
// and GCP setup controllers so each boundary remains small and auditable.
import {
  emptyNeon,
  emptyVault,
  vaultConfigurationPayload,
  type Integration,
  type ManagedConnection,
  type Provider,
} from "./domain";
import {
  connectProviderIntegration,
  disconnectProviderIntegration,
} from "./integrationMutations";
import type { ProviderAccessFieldSetter, ProviderAccessState } from "./state";
import { providerResponseError } from "./transport";
import type { WorkspaceLocale } from "../../lib/workspace-locale";
import { workspaceMessages } from "../../lib/workspace-messages";

type ProviderAccessCopy = (typeof workspaceMessages)[WorkspaceLocale]["providerAccess"];

export function providerAccountMutations(input: {
  workspaceId: string;
  locale: WorkspaceLocale;
  copy: ProviderAccessCopy;
  state: ProviderAccessState;
  setField: ProviderAccessFieldSetter;
  loadAccountAccess: (signal?: AbortSignal) => Promise<void>;
  repairManagedConnection: (managed: ManagedConnection) => Promise<void>;
  restartGcpSetup: (connect: (provider: Provider) => Promise<void>) => void;
}) {
  const {
    providers,
    managedConnections,
    managedConnectionsLoaded,
    setupProviderId,
    neonConfiguration,
    vaultConfiguration,
    mutation,
  } = input.state;
  const setSetupProviderId = input.setField("setupProviderId");
  const setNeonConfiguration = input.setField("neonConfiguration");
  const setVaultConfiguration = input.setField("vaultConfiguration");
  const setMutation = input.setField("mutation");
  const setError = input.setField("error");

  async function connect(provider: Provider, configuration?: object) {
    if (mutation) return;
    setMutation(`connect:${provider.id}`);
    setError("");
    try {
      const response = await connectProviderIntegration(
        input.workspaceId,
        provider.id,
        provider.id === "vault"
          ? vaultConfigurationPayload(vaultConfiguration)
          : configuration,
      );
      if (!response?.ok) {
        setError(await providerResponseError(
          response,
          input.copy.connectError,
          input.locale,
        ));
        return;
      }
      const body = await response.json().catch(() => null);
      if (provider.setupKind === "oauth") {
        if (typeof body?.authorizationUrl !== "string") {
          setError(input.copy.authorizationUrlError);
          return;
        }
        window.location.assign(body.authorizationUrl);
        return;
      }
      setNeonConfiguration(emptyNeon);
      setVaultConfiguration(emptyVault);
      setSetupProviderId("");
      await input.loadAccountAccess();
    } finally {
      setMutation("");
    }
  }

  function beginConnect(provider: Provider) {
    if (provider.setupKind === "oauth") {
      void connect(provider);
      return;
    }
    const next = setupProviderId === provider.id ? "" : provider.id;
    if (next !== "neon") setNeonConfiguration(emptyNeon);
    if (next !== "vault") setVaultConfiguration(emptyVault);
    setSetupProviderId(next);
    setError("");
  }

  function beginReconnect(integration: Integration) {
    const provider = providers.find((item) => item.id === integration.provider);
    if (!provider) return;
    if (provider.id === "gcpCloudSql" && !managedConnectionsLoaded) {
      setError(input.copy.gcpRepairTargetUnavailable);
      return;
    }
    const managed = managedConnections.find(
      (item) => item.integrationId === integration.id,
    );
    if (provider.id === "gcpCloudSql" && managed) {
      void input.repairManagedConnection(managed);
      return;
    }
    beginConnect(provider);
  }

  function reconnectGcpSetup() {
    input.restartGcpSetup((provider) => connect(provider));
  }

  async function disconnect(integration: Integration) {
    if (mutation || !window.confirm(input.copy.disconnectConfirm)) return;
    setMutation(`disconnect:${integration.id}`);
    setError("");
    try {
      const response = await disconnectProviderIntegration(
        input.workspaceId,
        integration.id,
      );
      if (!response?.ok) {
        setError(await providerResponseError(
          response,
          input.copy.disconnectError,
          input.locale,
        ));
        return;
      }
      await input.loadAccountAccess();
    } finally {
      setMutation("");
    }
  }

  return {
    beginConnect,
    beginReconnect,
    connect,
    disconnect,
    reconnectGcpSetup,
    setNeonConfiguration,
    setVaultConfiguration,
  };
}
