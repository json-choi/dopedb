import {
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";

import type {
  GcpEnvironmentClassification,
  GcpSetupInstance,
  GcpSetupInventory,
  GcpSetupPermissionCheck,
  Integration,
  ManagedConnection,
  NeonBootstrapState,
  NeonConfiguration,
  NeonEnvironmentClassification,
  Provider,
  Resource,
  SharedConnection,
  VaultConfiguration,
} from "./domain";
import { emptyNeon, emptyNeonBootstrap, emptyVault } from "./domain";

export type ProviderAccessState = {
  providers: Provider[];
  integrations: Integration[];
  connections: SharedConnection[];
  managedConnections: ManagedConnection[];
  managedConnectionsLoaded: boolean;
  selectedIntegrationId: string;
  selection: Record<string, string>;
  resourceOptions: Record<string, Resource[]>;
  setupProviderId: string;
  neonConfiguration: NeonConfiguration;
  vaultConfiguration: VaultConfiguration;
  neonEnvironmentClassification: NeonEnvironmentClassification;
  neonBootstrap: NeonBootstrapState;
  neonPublicAclApproved: boolean;
  neonProductionApproved: boolean;
  gcpSetupInventory: GcpSetupInventory | null;
  gcpSetupInstances: GcpSetupInstance[];
  selectedGcpProjectId: string;
  selectedGcpInstanceId: string;
  gcpEnvironmentClassification: GcpEnvironmentClassification;
  gcpProductionApproved: boolean;
  gcpIamAuthenticationChangeApproved: boolean;
  gcpPermissionCheck: GcpSetupPermissionCheck | null;
  gcpIamRoleGrantApproved: boolean;
  gcpSetupError: string;
  gcpSetupReconnectRequired: boolean;
  loading: boolean;
  resourcePending: boolean;
  mutation: string;
  error: string;
};

type FieldUpdate = {
  [Key in keyof ProviderAccessState]: {
    type: "field";
    key: Key;
    update: SetStateAction<ProviderAccessState[Key]>;
  };
}[keyof ProviderAccessState];

export type ProviderAccessFieldSetter = <Key extends keyof ProviderAccessState>(
  key: Key,
) => (update: SetStateAction<ProviderAccessState[Key]>) => void;

export const initialProviderAccessState: ProviderAccessState = {
  providers: [],
  integrations: [],
  connections: [],
  managedConnections: [],
  managedConnectionsLoaded: false,
  selectedIntegrationId: "",
  selection: {},
  resourceOptions: {},
  setupProviderId: "",
  neonConfiguration: emptyNeon,
  vaultConfiguration: emptyVault,
  neonEnvironmentClassification: "",
  neonBootstrap: emptyNeonBootstrap,
  neonPublicAclApproved: false,
  neonProductionApproved: false,
  gcpSetupInventory: null,
  gcpSetupInstances: [],
  selectedGcpProjectId: "",
  selectedGcpInstanceId: "",
  gcpEnvironmentClassification: "",
  gcpProductionApproved: false,
  gcpIamAuthenticationChangeApproved: false,
  gcpPermissionCheck: null,
  gcpIamRoleGrantApproved: false,
  gcpSetupError: "",
  gcpSetupReconnectRequired: false,
  loading: true,
  resourcePending: false,
  mutation: "",
  error: "",
};

export function providerAccessReducer(
  state: ProviderAccessState,
  action: FieldUpdate,
): ProviderAccessState {
  const current = state[action.key];
  const next =
    typeof action.update === "function"
      ? (
          action.update as (
            value: typeof current,
          ) => typeof current
        )(current)
      : action.update;
  return { ...state, [action.key]: next };
}

export function useProviderAccessState() {
  const [state, dispatch] = useReducer(
    providerAccessReducer,
    initialProviderAccessState,
  );
  const setter = useMemo(() => {
    const setters = new Map<keyof ProviderAccessState, (update: unknown) => void>();
    return (<Key extends keyof ProviderAccessState>(key: Key) => {
      const existing = setters.get(key);
      if (existing) {
        return existing as (
          update: SetStateAction<ProviderAccessState[Key]>,
        ) => void;
      }
      const fieldSetter = (update: unknown) => {
        dispatch({ type: "field", key, update } as FieldUpdate);
      };
      setters.set(key, fieldSetter);
      return fieldSetter as (
        update: SetStateAction<ProviderAccessState[Key]>,
      ) => void;
    }) as ProviderAccessFieldSetter;
  }, []);
  return [state, setter] as const;
}
