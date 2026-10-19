// Pure Project-resource selection rules shared by the in-app scope menu and the
// external Agent configuration picker: the last selected resource cannot be
// removed, at most one selected database is the write target, and removing a
// database (or switching Project) clears it as the write target.
import type { ConnectionId } from "../connections/domain";
import type {
  AgentDatabaseResourceChoice,
  AgentProjectResourceChoice,
  AgentSourceResourceChoice,
} from "./useAgentEnvironmentInventory";

export type AgentResourceSelection = {
  projectId: string | null;
  databaseIds: ConnectionId[];
  sourceIds: string[];
  writeConnectionId: ConnectionId | null;
};

export const EMPTY_AGENT_RESOURCE_SELECTION: AgentResourceSelection = {
  projectId: null,
  databaseIds: [],
  sourceIds: [],
  writeConnectionId: null,
};

export function selectedAgentResources(
  projects: AgentProjectResourceChoice[],
  selection: AgentResourceSelection,
) {
  const project = projects.find((candidate) => candidate.id === selection.projectId);
  const databaseIds = new Set(selection.databaseIds);
  const sourceIds = new Set(selection.sourceIds);
  return {
    project,
    databases:
      project?.databases.filter((database) => databaseIds.has(database.connectionId)) ?? [],
    sources: project?.sources.filter((source) => sourceIds.has(source.sourceId)) ?? [],
  };
}

/** Toggles one resource; returns null when the change is not allowed. */
export function toggleAgentResource(
  selection: AgentResourceSelection,
  resource: AgentDatabaseResourceChoice | AgentSourceResourceChoice,
): AgentResourceSelection | null {
  const sameProject = selection.projectId === resource.projectId;
  const databaseIds = sameProject ? [...selection.databaseIds] : [];
  const sourceIds = sameProject ? [...selection.sourceIds] : [];
  const ids: string[] = resource.kind === "database" ? databaseIds : sourceIds;
  const id = resource.kind === "database" ? resource.connectionId : resource.sourceId;
  const index = ids.indexOf(id);
  if (index >= 0) ids.splice(index, 1);
  else ids.push(id);
  if (databaseIds.length + sourceIds.length === 0) return null;
  return {
    projectId: resource.projectId,
    databaseIds,
    sourceIds,
    writeConnectionId:
      sameProject &&
      selection.writeConnectionId !== null &&
      databaseIds.includes(selection.writeConnectionId)
        ? selection.writeConnectionId
        : null,
  };
}

/** Sets the write target; only a selected, writable database (or null) is accepted. */
export function selectAgentWriteTarget(
  selection: AgentResourceSelection,
  selectedDatabases: AgentDatabaseResourceChoice[],
  writeConnectionId: ConnectionId | null,
): AgentResourceSelection | null {
  if (
    writeConnectionId !== null &&
    activeAgentWriteTarget(selectedDatabases, writeConnectionId) === null
  ) {
    return null;
  }
  return { ...selection, writeConnectionId };
}

/** The write target only while that selected database is still writable. */
export function activeAgentWriteTarget(
  selectedDatabases: AgentDatabaseResourceChoice[],
  writeConnectionId: ConnectionId | null,
): ConnectionId | null {
  return selectedDatabases.some(
    (database) => database.connectionId === writeConnectionId && database.writable,
  )
    ? writeConnectionId
    : null;
}

/** The last selected resource cannot be unchecked. */
export function isLastSelectedAgentResource(checked: boolean, selectedCount: number) {
  return checked && selectedCount === 1;
}
