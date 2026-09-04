import { useCallback, useMemo, useState } from "react";

import type { ConnectionProfile } from "../connections/domain";
import type {
  EnvironmentConnection,
  KnowledgeProject,
} from "../knowledge/domain";
import type { CatalogScope } from "../../lib/queries";
import { useI18n } from "../../lib/i18n";
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
  const { t } = useI18n();
  const scopeKey = preferenceScope(scope);
  const [memory, setMemory] = useState<MemoryOrders>({
    scope: scopeKey,
    byProject: {},
  });
  const [announcement, setAnnouncement] = useState<{
    id: number;
    message: string;
  } | null>(null);
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
            blockConnectionIds: bounds.connectionIds,
            previousBlockBindingId: bounds.previousBlockBindingId,
            nextBlockBindingId: bounds.nextBlockBindingId,
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
      if (!rows) return false;
      const current = rows.map(({ resource }) => resource.id);
      const next = moveProjectDatabaseResource(
        rows,
        connections,
        draggedBindingId,
        targetBindingId,
        placement,
      );
      if (current.every((id, index) => id === next[index])) return false;
      setMemory((previous) => ({
        scope: scopeKey,
        byProject: {
          ...(previous.scope === scopeKey ? previous.byProject : {}),
          [projectId]: next,
        },
      }));
      writeStoredOrder(scopeKey, projectId, next);
      const reorderedRows = orderProjectDatabaseResources(
        rows,
        connections,
        next,
      );
      const nextBounds = projectDatabaseBlockBounds(
        reorderedRows,
        connections,
      );
      const movedBounds = nextBounds.get(draggedBindingId);
      const blockFirstIds = Array.from(
        new Set(
          reorderedRows.flatMap(({ resource }) => {
            const bounds = nextBounds.get(resource.id);
            return bounds ? [bounds.firstBindingId] : [];
          }),
        ),
      );
      const position = movedBounds
        ? blockFirstIds.indexOf(movedBounds.firstBindingId) + 1
        : 0;
      const blockConnections = (movedBounds?.connectionIds ?? []).flatMap(
        (connectionId) => {
          const connection = connections.find(
            (candidate) => candidate.id === connectionId,
          );
          return connection ? [connection] : [];
        },
      );
      const firstConnection = blockConnections[0];
      const schemaGroup = firstConnection?.schemaGroup?.trim();
      const item =
        blockConnections.length > 1 && schemaGroup
          ? t("connections.schemaGroupTitle", { group: schemaGroup })
          : firstConnection?.name ||
            firstConnection?.database ||
            t("app.unnamed");
      setAnnouncement((currentAnnouncement) => ({
        id: (currentAnnouncement?.id ?? 0) + 1,
        message: t("connections.projectDatabaseOrderUpdated", {
          item,
          position,
          total: blockFirstIds.length,
        }),
      }));
      return true;
    },
    [connections, orderedRowsByProject, scopeKey, t],
  );

  const move = useCallback(
    (context: ProjectDatabaseOrderDrag, direction: "up" | "down") => {
      const targetBindingId =
        direction === "up"
          ? context.previousBlockBindingId
          : context.nextBlockBindingId;
      if (!targetBindingId) return false;
      return reorder(
        context.projectId,
        context.bindingId,
        targetBindingId,
        direction === "up" ? "before" : "after",
      );
    },
    [reorder],
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

  return { bindingOrder, dragContext, reorder, move, announcement };
}
