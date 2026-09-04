// One Agent session owns an immutable, user-selected resource set from one
// Project. Read resources are independent; at most one selected database is a
// write target, and every deeper Safety/workspace/database gate still applies.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ConnectionId, ConnectionProfile } from "../connections/domain";
import type {
  AcpSessionSummary,
  AgentComposerRequest,
  AgentResourceScopeSelection,
} from "./domain";
import type {
  AgentDatabaseResourceChoice,
  AgentProjectResourceChoice,
  AgentSourceResourceChoice,
  useAgentEnvironmentInventory,
} from "./useAgentEnvironmentInventory";

type EnvironmentInventory = ReturnType<typeof useAgentEnvironmentInventory>;

type ResourceSelection = {
  projectId: string | null;
  databaseIds: ConnectionId[];
  sourceIds: string[];
  writeConnectionId: ConnectionId | null;
};

const EMPTY_SELECTION: ResourceSelection = {
  projectId: null,
  databaseIds: [],
  sourceIds: [],
  writeConnectionId: null,
};

export function useAgentScopeConnection(
  defaultConnection: ConnectionProfile,
  connections: ConnectionProfile[],
) {
  const [connectionId, setConnectionId] = useState(defaultConnection.id);
  const connection = useMemo(
    () =>
      connections.find((candidate) => candidate.id === connectionId) ??
      defaultConnection,
    [connectionId, connections, defaultConnection],
  );
  return { connection, select: setConnectionId };
}

function selectedResources(
  projects: AgentProjectResourceChoice[],
  selection: ResourceSelection,
) {
  const project = projects.find(
    (candidate) => candidate.id === selection.projectId,
  );
  const databaseIds = new Set(selection.databaseIds);
  const sourceIds = new Set(selection.sourceIds);
  return {
    project,
    databases:
      project?.databases.filter((database) =>
        databaseIds.has(database.connectionId),
      ) ?? [],
    sources:
      project?.sources.filter((source) => sourceIds.has(source.sourceId)) ?? [],
  };
}

function sameSelection(left: ResourceSelection, right: ResourceSelection) {
  return (
    left.projectId === right.projectId &&
    left.writeConnectionId === right.writeConnectionId &&
    left.databaseIds.join("\u0000") === right.databaseIds.join("\u0000") &&
    left.sourceIds.join("\u0000") === right.sourceIds.join("\u0000")
  );
}

export function agentResourceScopes(
  databases: AgentDatabaseResourceChoice[],
  sources: AgentSourceResourceChoice[],
): AgentResourceScopeSelection[] {
  const grouped = new Map<
    string,
    {
      authorityConnectionId: ConnectionId;
      connectionIds: ConnectionId[];
      sourceIds: string[];
    }
  >();
  for (const database of databases) {
    const scope = grouped.get(database.environmentId) ?? {
      authorityConnectionId: database.authorityConnectionId,
      connectionIds: [],
      sourceIds: [],
    };
    scope.connectionIds.push(database.connectionId);
    grouped.set(database.environmentId, scope);
  }
  for (const source of sources) {
    const scope = grouped.get(source.environmentId) ?? {
      authorityConnectionId: source.authorityConnectionId,
      connectionIds: [],
      sourceIds: [],
    };
    scope.sourceIds.push(source.sourceId);
    grouped.set(source.environmentId, scope);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectEnvironmentId, scope]) => ({
      projectEnvironmentId,
      authorityConnectionId: scope.authorityConnectionId,
      connectionIds: [...scope.connectionIds].sort(),
      sourceIds: [...scope.sourceIds].sort(),
    }));
}

export function useAgentScopeSelection({
  active,
  composerRequest,
  connectionId,
  inventory,
  onClearError,
  onSelectConnection,
  selectionLocked,
}: {
  active: AcpSessionSummary | null;
  composerRequest: AgentComposerRequest | null;
  connectionId: ConnectionId;
  inventory: EnvironmentInventory;
  onClearError: () => void;
  onSelectConnection: (connectionId: ConnectionId) => void;
  selectionLocked: boolean;
}) {
  const [selection, setSelection] = useState<ResourceSelection>(EMPTY_SELECTION);
  const inventoryProjects = inventory.projects;

  useEffect(() => {
    if (!inventory.success) return;
    if (active) {
      const scopes = active.knowledgeScopes;
      const databaseIds = scopes
        .flatMap((scope) => scope.connections)
        .map((connection) => connection.connectionId);
      const sourceIds = scopes
        .flatMap((scope) => scope.sources)
        .map((source) => source.sourceId);
      const project = inventoryProjects.find((candidate) =>
        scopes.some((scope) => scope.projectId === candidate.id) ||
        candidate.databases.some((database) =>
          databaseIds.includes(database.connectionId),
        ) ||
        candidate.sources.some((source) => sourceIds.includes(source.sourceId)),
      );
      const next = {
        projectId: project?.id ?? null,
        databaseIds,
        sourceIds,
        writeConnectionId: active.writeConnectionId,
      };
      setSelection((current) => sameSelection(current, next) ? current : next);
      return;
    }
    if (composerRequest) {
      const project = inventoryProjects.find((candidate) =>
        candidate.databases.some(
          (database) =>
            database.connectionId === composerRequest.connectionId &&
            database.environmentId === composerRequest.projectEnvironmentId,
        ),
      );
      if (project) {
        const next = {
          projectId: project.id,
          databaseIds: [composerRequest.connectionId],
          sourceIds: [],
          writeConnectionId: null,
        };
        setSelection((current) => sameSelection(current, next) ? current : next);
        onSelectConnection(composerRequest.connectionId);
        return;
      }
    }
    const currentResources = selectedResources(inventoryProjects, selection);
    if (currentResources.databases.length + currentResources.sources.length > 0) {
      return;
    }
    const project =
      inventoryProjects.find((candidate) =>
        candidate.databases.some(
          (database) => database.connectionId === connectionId,
        ),
      ) ?? inventoryProjects[0];
    const database =
      project?.databases.find(
        (candidate) => candidate.connectionId === connectionId,
      ) ?? project?.databases[0];
    const source = database ? undefined : project?.sources[0];
    const anchor = database?.connectionId ?? source?.authorityConnectionId;
    if (anchor) onSelectConnection(anchor);
    const next = {
      projectId: project?.id ?? null,
      databaseIds: database ? [database.connectionId] : [],
      sourceIds: source ? [source.sourceId] : [],
      writeConnectionId: null,
    };
    setSelection((current) => sameSelection(current, next) ? current : next);
  }, [
    active,
    composerRequest,
    connectionId,
    inventory.success,
    inventoryProjects,
    onSelectConnection,
    selection,
  ]);

  const resources = useMemo(
    () => selectedResources(inventoryProjects, selection),
    [inventoryProjects, selection],
  );
  const scopes = useMemo(
    () => agentResourceScopes(resources.databases, resources.sources),
    [resources.databases, resources.sources],
  );
  const selectedResourceKeys = useMemo(
    () =>
      new Set([
        ...resources.databases.map((database) => database.key),
        ...resources.sources.map((source) => source.key),
      ]),
    [resources.databases, resources.sources],
  );

  const toggle = useCallback(
    (resourceKey: string) => {
      if (selectionLocked || inventory.updatingEnvironmentId !== null) return;
      const database = inventoryProjects
        .flatMap((project) => project.databases)
        .find((candidate) => candidate.key === resourceKey);
      const source = inventoryProjects
        .flatMap((project) => project.sources)
        .find((candidate) => candidate.key === resourceKey);
      const resource = database ?? source;
      if (!resource) return;
      onClearError();
      const sameProject = selection.projectId === resource.projectId;
      const databaseIds = sameProject ? [...selection.databaseIds] : [];
      const sourceIds = sameProject ? [...selection.sourceIds] : [];
      if (database) {
        const index = databaseIds.indexOf(database.connectionId);
        if (index >= 0) databaseIds.splice(index, 1);
        else databaseIds.push(database.connectionId);
      } else if (source) {
        const index = sourceIds.indexOf(source.sourceId);
        if (index >= 0) sourceIds.splice(index, 1);
        else sourceIds.push(source.sourceId);
      }
      if (databaseIds.length + sourceIds.length === 0) return;
      const writeConnectionId =
        sameProject &&
        selection.writeConnectionId !== null &&
        databaseIds.includes(selection.writeConnectionId)
          ? selection.writeConnectionId
          : null;
      const next: ResourceSelection = {
        projectId: resource.projectId,
        databaseIds,
        sourceIds,
        writeConnectionId,
      };
      const nextResources = selectedResources(inventoryProjects, next);
      const anchor =
        writeConnectionId ??
        nextResources.databases[0]?.connectionId ??
        nextResources.sources[0]?.authorityConnectionId;
      if (anchor) onSelectConnection(anchor);
      setSelection(next);
    }, [
      inventory.updatingEnvironmentId,
      inventoryProjects,
      onClearError,
      onSelectConnection,
      selection,
      selectionLocked,
    ],
  );

  const selectWriteTarget = useCallback(
    (writeConnectionId: ConnectionId | null) => {
      if (selectionLocked) return;
      if (
        writeConnectionId !== null &&
        !resources.databases.some(
          (database) =>
            database.connectionId === writeConnectionId && database.writable,
        )
      ) {
        return;
      }
      onClearError();
      setSelection((current) => ({ ...current, writeConnectionId }));
      if (writeConnectionId) onSelectConnection(writeConnectionId);
    }, [
      onClearError,
      onSelectConnection,
      resources.databases,
      selectionLocked,
    ],
  );

  const ensureSelected = useCallback(async () => {
    const selected = [...resources.databases, ...resources.sources];
    const boundaries = new Map(
      selected.map((resource) => [
        resource.environmentId,
        {
          authorityConnectionId: resource.authorityConnectionId,
          stale: resource.needsReconfirmation,
        },
      ]),
    );
    for (const [environmentId, boundary] of boundaries) {
      if (!boundary.stale) continue;
      if (
        !(await inventory.ensureAvailable(
          environmentId,
          boundary.authorityConnectionId,
        ))
      ) {
        return false;
      }
    }
    return true;
  }, [inventory, resources.databases, resources.sources]);

  const anchorConnectionId =
    selection.writeConnectionId ??
    resources.databases[0]?.connectionId ??
    resources.sources[0]?.authorityConnectionId ??
    null;
  const newScopeReady =
    inventory.success &&
    inventory.updatingEnvironmentId === null &&
    scopes.length > 0 &&
    anchorConnectionId !== null;

  return {
    anchorConnectionId,
    ensureSelected,
    newScopeReady,
    project: resources.project,
    resourceScopes: scopes,
    selectedDatabases: resources.databases,
    selectedResourceKeys,
    selectedSources: resources.sources,
    selectWriteTarget,
    toggle,
    writeConnectionId: selection.writeConnectionId,
  };
}
