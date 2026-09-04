import { useCallback, useMemo, useState } from "react";

import type { ConnectionProfile } from "../connections/domain";
import type {
  EnvironmentConnection,
  KnowledgeProject,
} from "../knowledge/domain";
import type { CatalogScope } from "../../lib/queries";
import type { ProjectDatabaseOrderDrag } from "./catalogDomain";
import {
  flattenProjectEnvironmentResources,
  moveProjectDatabaseResource,
  orderProjectDatabaseResources,
  projectDatabaseBlockBounds,
  type ProjectDatabaseOrderPlacement,
  type ProjectEnvironmentResource,
} from "./projectResources";

const STORAGE_PREFIX = "dopedb.project-database-order.v1";
const MAX_STORED_BINDINGS = 512;
const EMPTY_BINDING_ORDER: readonly string[] = [];

type MemoryOrders = {
  scope: string | null;
  byProject: Record<string, string[]>;
};

function preferenceScope(
  scope: Pick<CatalogScope, "workspaceKind" | "workspaceId" | "accountScope">,
): string | null {
  return scope.workspaceKind && scope.workspaceId
    ? `${scope.workspaceKind}:${scope.workspaceId}:account:${scope.accountScope ?? "anonymous"}`
    : null;
}

function storageKey(scope: string, projectId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(scope)}:${projectId}`;
}

function readStoredOrder(
  scope: string | null,
  projectId: string,
  allowedIds: ReadonlySet<string>,
): string[] {
  if (!scope || typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(storageKey(scope, projectId)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.flatMap((value) => {
      if (
        typeof value !== "string" ||
        !allowedIds.has(value) ||
        seen.has(value) ||
        seen.size >= MAX_STORED_BINDINGS
      ) {
        return [];
      }
      seen.add(value);
      return [value];
    });
  } catch {
    return [];
  }
}

function writeStoredOrder(
  scope: string | null,
  projectId: string,
  bindingIds: readonly string[],
) {
  if (!scope || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(scope, projectId),
      JSON.stringify(bindingIds.slice(0, MAX_STORED_BINDINGS)),
    );
  } catch {
    // A display preference remains usable for this session when storage is unavailable.
  }
}

export function useProjectDatabaseOrder(
  scope: Pick<CatalogScope, "workspaceKind" | "workspaceId" | "accountScope">,
  projects: readonly KnowledgeProject[] | undefined,
  bindings: readonly EnvironmentConnection[] | undefined,
  connections: readonly ConnectionProfile[],
) {
  const scopeKey = preferenceScope(scope);
  const [memory, setMemory] = useState<MemoryOrders>({
    scope: scopeKey,
    byProject: {},
  });
  const memoryOrders = useMemo(
    () => (memory.scope === scopeKey ? memory.byProject : {}),
    [memory, scopeKey],
  );
  const orderedRowsByProject = useMemo(() => {
    const result = new Map<
      string,
      ProjectEnvironmentResource<EnvironmentConnection>[]
    >();
    for (const project of projects ?? []) {
      const rows = flattenProjectEnvironmentResources(project, (environmentId) =>
        (bindings ?? []).filter(
          (binding) => binding.projectEnvironmentId === environmentId,
        ),
      );
      const allowedIds = new Set(rows.map(({ resource }) => resource.id));
      const preferred =
        memoryOrders[project.id] ??
        readStoredOrder(scopeKey, project.id, allowedIds);
      result.set(
        project.id,
        orderProjectDatabaseResources(rows, connections, preferred),
      );
    }
    return result;
  }, [bindings, connections, memoryOrders, projects, scopeKey]);
  const bindingOrderByProject = useMemo(
    () =>
      new Map(
        [...orderedRowsByProject].map(([projectId, rows]) => [
          projectId,
          rows.map(({ resource }) => resource.id),
        ]),
      ),
    [orderedRowsByProject],
  );
  const dragContextByBindingId = useMemo(
    () => {
      const result = new Map<string, ProjectDatabaseOrderDrag>();
      for (const [projectId, rows] of orderedRowsByProject) {
        const boundsByBindingId = projectDatabaseBlockBounds(rows, connections);
        for (const { resource } of rows) {
          const bounds = boundsByBindingId.get(resource.id);
          if (!bounds) continue;
          result.set(resource.id, {
            projectId,
            bindingId: resource.id,
            blockFirstBindingId: bounds.firstBindingId,
            blockLastBindingId: bounds.lastBindingId,
          });
        }
      }
      return result;
    },
    [connections, orderedRowsByProject],
  );

  const reorder = useCallback(
    (
      projectId: string,
      draggedBindingId: string,
      targetBindingId: string,
      placement: ProjectDatabaseOrderPlacement,
    ) => {
      const rows = orderedRowsByProject.get(projectId);
      if (!rows) return;
      const current = rows.map(({ resource }) => resource.id);
      const next = moveProjectDatabaseResource(
        rows,
        connections,
        draggedBindingId,
        targetBindingId,
        placement,
      );
      if (current.every((id, index) => id === next[index])) return;
      setMemory((previous) => ({
        scope: scopeKey,
        byProject: {
          ...(previous.scope === scopeKey ? previous.byProject : {}),
          [projectId]: next,
        },
      }));
      writeStoredOrder(scopeKey, projectId, next);
    },
    [connections, orderedRowsByProject, scopeKey],
  );

  const bindingOrder = useCallback(
    (projectId: string) =>
      bindingOrderByProject.get(projectId) ?? EMPTY_BINDING_ORDER,
    [bindingOrderByProject],
  );
  const dragContext = useCallback(
    (binding: EnvironmentConnection): ProjectDatabaseOrderDrag | undefined =>
      dragContextByBindingId.get(binding.id),
    [dragContextByBindingId],
  );

  return { bindingOrder, dragContext, reorder };
}
