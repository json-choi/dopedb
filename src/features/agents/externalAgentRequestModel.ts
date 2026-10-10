// Pure selection and exact-resource projection for external Agent approval.
import type { ConnectionId } from "../connections/domain";
import type { ExternalAgentConfig } from "./externalAgentDomain";
import type {
  AgentDatabaseResourceChoice,
  AgentProjectResourceChoice,
  AgentSourceResourceChoice,
} from "./useAgentEnvironmentInventory";

export type ExternalAgentResourceSelection = {
  projectId: string | null;
  databaseIds: ConnectionId[];
  sourceIds: string[];
  writeConnectionId: ConnectionId | null;
};

export const EMPTY_EXTERNAL_AGENT_SELECTION: ExternalAgentResourceSelection = {
  projectId: null,
  databaseIds: [],
  sourceIds: [],
  writeConnectionId: null,
};

export function selectedExternalAgentResources(
  projects: AgentProjectResourceChoice[],
  selection: ExternalAgentResourceSelection,
) {
  const project = projects.find((candidate) => candidate.id === selection.projectId);
  return {
    project,
    databases:
      project?.databases.filter((database) =>
        selection.databaseIds.includes(database.connectionId),
      ) ?? [],
    sources:
      project?.sources.filter((source) => selection.sourceIds.includes(source.sourceId)) ?? [],
  };
}

export function requestedExternalAgentResources(
  config: ExternalAgentConfig | undefined,
  projects: AgentProjectResourceChoice[],
) {
  const project = projects.find((candidate) => candidate.id === config?.projectId);
  const databases: AgentDatabaseResourceChoice[] = [];
  const sources: AgentSourceResourceChoice[] = [];
  let exact = Boolean(config && project);
  for (const scope of config?.resourceScopes ?? []) {
    const scopedDatabases = scope.connectionIds.flatMap((connectionId) => {
      const database = project?.databases.find(
        (candidate) =>
          candidate.connectionId === connectionId
          && candidate.environmentId === scope.projectEnvironmentId,
      );
      return database ? [database] : [];
    });
    const scopedSources = scope.sourceIds.flatMap((sourceId) => {
      const source = project?.sources.find(
        (candidate) =>
          candidate.sourceId === sourceId
          && candidate.environmentId === scope.projectEnvironmentId,
      );
      return source ? [source] : [];
    });
    const authorityAvailable = [...scopedDatabases, ...scopedSources].some(
      (resource) => resource.authorityConnectionId === scope.authorityConnectionId,
    );
    exact &&=
      scopedDatabases.length === scope.connectionIds.length
      && scopedSources.length === scope.sourceIds.length
      && authorityAvailable;
    databases.push(...scopedDatabases);
    sources.push(...scopedSources);
  }
  const selectedDatabaseIds = new Set(
    databases.map((database) => database.connectionId),
  );
  const selectedSourceIds = new Set(sources.map((source) => source.sourceId));
  const anchorAvailable = Boolean(
    config
      && (selectedDatabaseIds.has(config.anchorConnectionId)
        || [...databases, ...sources].some(
          (resource) => resource.authorityConnectionId === config.anchorConnectionId,
        )),
  );
  const writeAvailable =
    !config?.writeConnectionId
    || databases.some(
      (database) =>
        database.connectionId === config.writeConnectionId && database.writable,
    );
  return {
    project,
    databases,
    sources,
    complete:
      exact
      && anchorAvailable
      && writeAvailable
      && selectedDatabaseIds.size === databases.length
      && selectedSourceIds.size === sources.length
      && databases.length + sources.length > 0,
    needsRefresh: [...databases, ...sources].some(
      (resource) => resource.needsReconfirmation,
    ),
  };
}

/**
 * One reconfirmation boundary per Environment of the selected resources, with
 * exactly the selected resources' stale connection bindings to rebind.
 */
export function externalAgentResourceBoundaries(
  databases: AgentDatabaseResourceChoice[],
  sources: AgentSourceResourceChoice[],
) {
  const boundaries = new Map<
    string,
    {
      environmentId: string;
      authorityConnectionId: ConnectionId;
      stale: boolean;
      connectionIds: ConnectionId[];
    }
  >();
  for (const resource of [...databases, ...sources]) {
    const current = boundaries.get(resource.environmentId);
    const connectionIds = current?.connectionIds ?? [];
    const changed = resource.reconfirmation?.connectionId;
    if (changed && !connectionIds.includes(changed)) connectionIds.push(changed);
    boundaries.set(resource.environmentId, {
      environmentId: resource.environmentId,
      authorityConnectionId:
        current?.authorityConnectionId ?? resource.authorityConnectionId,
      stale: Boolean(current?.stale || resource.needsReconfirmation),
      connectionIds,
    });
  }
  return [...boundaries.values()];
}
