// Settings deep links stay pinned to the requested Workspace and optional
// resource ids. Every unavailable cause collapses to one non-enumerating state.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestedId = Readonly<{
  requested: boolean;
  id: string | null;
}>;

export type RequestedSettingsScope = Readonly<{
  workspace: RequestedId;
  connection: RequestedId;
  integration: RequestedId;
  setup: RequestedId;
}>;

type ScopeParam = string | string[] | undefined;

function requestedId(value: ScopeParam): RequestedId {
  return {
    requested: value !== undefined,
    id: typeof value === "string" && UUID_PATTERN.test(value) ? value : null,
  };
}

export function requestedSettingsScope(params: {
  workspace?: ScopeParam;
  connection?: ScopeParam;
  integration?: ScopeParam;
  gcpSetup?: ScopeParam;
}): RequestedSettingsScope {
  return {
    workspace: requestedId(params.workspace),
    connection: requestedId(params.connection),
    integration: requestedId(params.integration),
    setup: requestedId(params.gcpSetup),
  };
}

export function hasRequestedSettingsResource(scope: RequestedSettingsScope) {
  return scope.connection.requested
    || scope.integration.requested
    || scope.setup.requested;
}

export function selectSettingsWorkspace<T extends { id: string }>(input: {
  requested: RequestedSettingsScope;
  visibleWorkspaces: readonly T[];
  sessionWorkspaceId: string | null | undefined;
}): T | null {
  if (input.requested.workspace.requested) {
    return input.visibleWorkspaces.find(
      (workspace) => workspace.id === input.requested.workspace.id,
    ) ?? null;
  }
  return input.visibleWorkspaces.find(
    (workspace) => workspace.id === input.sessionWorkspaceId,
  ) ?? input.visibleWorkspaces[0] ?? null;
}

export function requestedSettingsScopeState(input: {
  requested: RequestedSettingsScope;
  activeWorkspaceId: string | null;
  requestedSectionAvailable: boolean;
  connection: Readonly<{
    id: string;
    providerIntegrationId: string | null;
  }> | null;
  integrationId: string | null;
  setupId: string | null;
}): "available" | "unavailable" {
  const resourceRequested = hasRequestedSettingsResource(input.requested);
  if (!input.requested.workspace.requested && !resourceRequested) return "available";
  if (
    !input.requested.workspace.requested
    || !input.requested.workspace.id
    || input.activeWorkspaceId !== input.requested.workspace.id
    || !input.requestedSectionAvailable
  ) return "unavailable";
  if (
    input.requested.connection.requested
    && (
      !input.requested.connection.id
      || input.connection?.id !== input.requested.connection.id
    )
  ) return "unavailable";
  if (
    input.requested.integration.requested
    && (
      !input.requested.integration.id
      || input.integrationId !== input.requested.integration.id
    )
  ) return "unavailable";
  if (
    input.requested.setup.requested
    && (
      !input.requested.setup.id
      || input.setupId !== input.requested.setup.id
    )
  ) return "unavailable";
  if (
    input.requested.connection.requested
    && input.requested.integration.requested
    && input.connection?.providerIntegrationId !== input.requested.integration.id
  ) return "unavailable";
  return "available";
}
