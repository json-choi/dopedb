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
import {
  EMPTY_AGENT_RESOURCE_SELECTION,
  activeAgentWriteTarget,
  selectAgentWriteTarget,
  selectedAgentResources,
  toggleAgentResource,
  type AgentResourceSelection,
} from "./agentResourceSelectionRules";
import { externalAgentResourceBoundaries } from "./externalAgentRequestModel";
import type {
  AgentDatabaseResourceChoice,
  AgentSourceResourceChoice,
  useAgentEnvironmentInventory,
} from "./useAgentEnvironmentInventory";

type EnvironmentInventory = ReturnType<typeof useAgentEnvironmentInventory>;

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

function sameSelection(left: AgentResourceSelection, right: AgentResourceSelection) {
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
  const [selection, setSelection] = useState<AgentResourceSelection>(EMPTY_AGENT_RESOURCE_SELECTION);
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
        // A requested write target is honored only when that exact selected
        // database can enter the write path; otherwise the draft stays read-only.
        const writable = project.databases.some(
          (database) =>
            database.connectionId === composerRequest.writeConnectionId &&
            database.connectionId === composerRequest.connectionId &&
            database.environmentId === composerRequest.projectEnvironmentId &&
            database.writable,
        );
        const next = {
          projectId: project.id,
          databaseIds: [composerRequest.connectionId],
          sourceIds: [],
          writeConnectionId: writable ? composerRequest.connectionId : null,
        };
        setSelection((current) => sameSelection(current, next) ? current : next);
        onSelectConnection(composerRequest.connectionId);
        return;
      }
    }
    const currentResources = selectedAgentResources(inventoryProjects, selection);
    if (currentResources.databases.length + currentResources.sources.length > 0) {
      return;
    }
    const project =
      inventoryProjects.find((candidate) =>
        candidate.databases.some(
          (database) => database.connectionId === connectionId,
        ),
      );
    const database =
      project?.databases.find(
        (candidate) => candidate.connectionId === connectionId,
      );
    const anchor = database?.connectionId;
    if (anchor) onSelectConnection(anchor);
    const next = {
      projectId: project?.id ?? null,
      databaseIds: database ? [database.connectionId] : [],
      sourceIds: [],
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
    () => selectedAgentResources(inventoryProjects, selection),
    [inventoryProjects, selection],
  );

  useEffect(() => {
    // Safety or workspace policy can change after the target was chosen. A
    // draft never keeps a write target that no longer passes the write path;
    // a started conversation's pinned target is re-checked by the Broker.
    if (selectionLocked || selection.writeConnectionId === null) return;
    if (
      activeAgentWriteTarget(resources.databases, selection.writeConnectionId) === null
    ) {
      setSelection((current) => ({ ...current, writeConnectionId: null }));
    }
  }, [resources.databases, selection.writeConnectionId, selectionLocked]);
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
      const next = toggleAgentResource(selection, resource);
      if (!next) return;
      onClearError();
      const writeConnectionId = next.writeConnectionId;
      const nextResources = selectedAgentResources(inventoryProjects, next);
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
      const next = selectAgentWriteTarget(selection, resources.databases, writeConnectionId);
      if (!next) return;
      onClearError();
      setSelection(next);
      if (writeConnectionId) onSelectConnection(writeConnectionId);
    }, [
      onClearError,
      onSelectConnection,
      resources.databases,
      selection,
      selectionLocked,
    ],
  );

  // Rebinding a stale Environment binding is a write (hosted in a Team
  // workspace), so it happens only through this explicit command; background
  // preparation never starts while the selection needs reconfirmation.
  const needsReconfirmation = [...resources.databases, ...resources.sources].some(
    (resource) => resource.needsReconfirmation,
  );
  const reconfirmSelected = useCallback(async () => {
    for (const boundary of externalAgentResourceBoundaries(
      resources.databases,
      resources.sources,
    )) {
      if (!boundary.stale) continue;
      if (
        !(await inventory.ensureAvailable(
          boundary.environmentId,
          boundary.authorityConnectionId,
          boundary.connectionIds,
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
    anchorConnectionId !== null &&
    !needsReconfirmation;

  return {
    anchorConnectionId,
    needsReconfirmation,
    reconfirmSelected,
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
