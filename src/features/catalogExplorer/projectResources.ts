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
