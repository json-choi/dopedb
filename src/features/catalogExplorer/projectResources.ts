import type {
  EnvironmentConnection,
  KnowledgeEnvironment,
  KnowledgeEnvironmentView,
  KnowledgeProject,
} from "../knowledge/domain";
import type { ConnectionProfile } from "../connections/domain";

export type ProjectEnvironmentResource<T> = {
  environment: KnowledgeEnvironment;
  resource: T;
};

export type ProjectDatabaseOrderPlacement = "before" | "after";

const ENVIRONMENT_RISK_ORDER: Record<KnowledgeEnvironment["riskClass"], number> = {
  production: 0,
  staging: 1,
  development: 2,
  test: 3,
  custom: 4,
};

export function projectResourceKey(
  projectId: string,
  view: Extract<KnowledgeEnvironmentView, "databases" | "sources" | "analyses">,
) {
  return `${projectId}:${view}`;
}

export function toggledResourceKeys(
  current: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function preferredProjectEnvironment(
  project: KnowledgeProject,
  activeEnvironmentId: string | null,
) {
  return (
    project.environments.find(
      (environment) => environment.id === activeEnvironmentId,
    ) ??
    project.environments[0] ??
    null
  );
}

export function preferredProjectDatabaseDropTarget(
  project: KnowledgeProject,
  activeEnvironmentId: string | null,
) {
  const environment = preferredProjectEnvironment(project, activeEnvironmentId);
  return environment
    ? { projectId: project.id, environmentId: environment.id }
    : null;
}

export type ProjectDatabasesDropTarget = {
  id: string;
  environmentId: string;
  accepting: boolean;
  connectionIds: ReadonlySet<string>;
};

export function projectDatabasesDropTargets(
  projects: readonly KnowledgeProject[],
  activeEnvironmentId: string | null,
  accepting: boolean,
  bindingsByEnvironment: ReadonlyMap<
    string,
    readonly Pick<EnvironmentConnection, "connectionId">[]
  >,
): ProjectDatabasesDropTarget[] {
  return projects.flatMap((project) => {
    const target = preferredProjectDatabaseDropTarget(
      project,
      activeEnvironmentId,
    );
    if (!target) return [];
    const connectionIds = new Set(
      (bindingsByEnvironment.get(target.environmentId) ?? []).flatMap(
        (binding) => (binding.connectionId ? [binding.connectionId] : []),
      ),
    );
    return [{ ...target, id: target.projectId, accepting, connectionIds }];
  });
}

export function projectConnectionAssignment(
  connections: readonly ConnectionProfile[],
  bindingsReady: boolean,
  bindingsByEnvironment: ReadonlyMap<
    string,
    readonly Pick<EnvironmentConnection, "connectionId">[]
  >,
) {
  const boundConnectionIds = new Set(
    bindingsReady
      ? [...bindingsByEnvironment.values()].flatMap((bindings) =>
          bindings.flatMap((binding) =>
            binding.connectionId ? [binding.connectionId] : [],
          ),
        )
      : [],
  );
  const unassignedConnections = bindingsReady
    ? connections.filter(
        (connection) => !boundConnectionIds.has(connection.id),
      )
    : [...connections];
  return {
    unassignedConnections,
    unassignedConnectionIds: new Set(
      unassignedConnections.map((connection) => connection.id),
    ),
  };
}

/**
 * Team Project assignment may replace a device-local connection with the newly
 * synchronized shared profile. A different binding id is the native command's
 * explicit success receipt; never infer promotion from a name or endpoint.
 */
export function promotedProjectConnectionSourceId(
  connection: Pick<ConnectionProfile, "id" | "workspaceAccess">,
  binding: Pick<EnvironmentConnection, "connectionId">,
) {
  return connection.workspaceAccess === "local"
    && binding.connectionId !== null
    && binding.connectionId !== connection.id
    ? connection.id
    : null;
}

export function flattenProjectEnvironmentResources<T>(
  project: KnowledgeProject,
  resourcesForEnvironment: (environmentId: string) => readonly T[],
): ProjectEnvironmentResource<T>[] {
  return project.environments.flatMap((environment) =>
    resourcesForEnvironment(environment.id).map((resource) => ({
      environment,
      resource,
    })),
  );
}

type ProjectDatabaseResource = Pick<
  EnvironmentConnection,
  "id" | "connectionId"
>;

type ProjectDatabaseBlock<T extends ProjectDatabaseResource> = {
  key: string;
  grouped: boolean;
  rows: ProjectEnvironmentResource<T>[];
};

function normalizedSchemaGroup(
  connection: ConnectionProfile | undefined,
): string | null {
  const label = connection?.schemaGroup?.trim().toLocaleLowerCase();
  return label || null;
}

function projectDatabaseBlocks<T extends ProjectDatabaseResource>(
  rows: readonly ProjectEnvironmentResource<T>[],
  connections: readonly ConnectionProfile[],
): ProjectDatabaseBlock<T>[] {
  const connectionById = new Map<string, ConnectionProfile>(
    connections.map((connection) => [connection.id, connection]),
  );
  const groupCounts = new Map<string, number>();
  for (const { resource } of rows) {
    const group = resource.connectionId
      ? normalizedSchemaGroup(connectionById.get(resource.connectionId))
      : null;
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  const blocks = new Map<string, ProjectDatabaseBlock<T>>();
  for (const row of rows) {
    const connection = row.resource.connectionId
      ? connectionById.get(row.resource.connectionId)
      : undefined;
    const group = normalizedSchemaGroup(connection);
    const grouped = !!group && (groupCounts.get(group) ?? 0) > 1;
    const key = grouped ? `schema-group:${group}` : `binding:${row.resource.id}`;
    const block = blocks.get(key);
    if (block) block.rows.push(row);
    else blocks.set(key, { key, grouped, rows: [row] });
  }

  return [...blocks.values()].map((block) => ({
    ...block,
    rows: block.grouped
      ? [...block.rows].sort((left, right) => {
          const riskOrder =
            ENVIRONMENT_RISK_ORDER[left.environment.riskClass] -
            ENVIRONMENT_RISK_ORDER[right.environment.riskClass];
          if (riskOrder !== 0) return riskOrder;
          const leftConnection = left.resource.connectionId
            ? connectionById.get(left.resource.connectionId)
            : undefined;
          const rightConnection = right.resource.connectionId
            ? connectionById.get(right.resource.connectionId)
            : undefined;
          return (
            (leftConnection?.name || leftConnection?.database || "").localeCompare(
              rightConnection?.name || rightConnection?.database || "",
            ) || left.resource.id.localeCompare(right.resource.id)
          );
        })
      : block.rows,
  }));
}

/**
 * Projects flatten resources by Environment, which can split equivalent prod/dev
 * databases. Display ordering keeps an explicit member preference while treating
 * every multi-row schema group as one contiguous block.
 */
export function orderProjectDatabaseResources<T extends ProjectDatabaseResource>(
  rows: readonly ProjectEnvironmentResource<T>[],
  connections: readonly ConnectionProfile[],
  preferredBindingIds: readonly string[] = [],
): ProjectEnvironmentResource<T>[] {
  const rowIds = new Set(rows.map(({ resource }) => resource.id));
  const rankById = new Map<string, number>();
  for (const id of preferredBindingIds) {
    if (rowIds.has(id) && !rankById.has(id)) rankById.set(id, rankById.size);
  }
  const rankedRows = rows
    .map((row, index) => ({
      row,
      index,
      rank: rankById.get(row.resource.id) ?? preferredBindingIds.length + index,
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => row);
  return projectDatabaseBlocks(rankedRows, connections).flatMap(
    (block) => block.rows,
  );
}

export function projectDatabaseBlockBounds<T extends ProjectDatabaseResource>(
  orderedRows: readonly ProjectEnvironmentResource<T>[],
  connections: readonly ConnectionProfile[],
): Map<string, { firstBindingId: string; lastBindingId: string }> {
  const result = new Map<
    string,
    { firstBindingId: string; lastBindingId: string }
  >();
  for (const block of projectDatabaseBlocks(orderedRows, connections)) {
    const firstBindingId = block.rows[0]?.resource.id;
    const lastBindingId = block.rows[block.rows.length - 1]?.resource.id;
    if (!firstBindingId || !lastBindingId) continue;
    for (const { resource } of block.rows) {
      result.set(resource.id, { firstBindingId, lastBindingId });
    }
  }
  return result;
}

export function moveProjectDatabaseResource<T extends ProjectDatabaseResource>(
  orderedRows: readonly ProjectEnvironmentResource<T>[],
  connections: readonly ConnectionProfile[],
  draggedBindingId: string,
  targetBindingId: string,
  placement: ProjectDatabaseOrderPlacement,
): string[] {
  const blocks = projectDatabaseBlocks(orderedRows, connections);
  const draggedIndex = blocks.findIndex((block) =>
    block.rows.some(({ resource }) => resource.id === draggedBindingId),
  );
  const targetKey = blocks.find((block) =>
    block.rows.some(({ resource }) => resource.id === targetBindingId),
  )?.key;
  if (draggedIndex < 0 || !targetKey || blocks[draggedIndex]?.key === targetKey) {
    return orderedRows.map(({ resource }) => resource.id);
  }

  const next = [...blocks];
  const [dragged] = next.splice(draggedIndex, 1);
  const targetIndex = next.findIndex((block) => block.key === targetKey);
  if (!dragged || targetIndex < 0) {
    return orderedRows.map(({ resource }) => resource.id);
  }
  next.splice(placement === "before" ? targetIndex : targetIndex + 1, 0, dragged);
  return next.flatMap((block) =>
    block.rows.map(({ resource }) => resource.id),
  );
}
