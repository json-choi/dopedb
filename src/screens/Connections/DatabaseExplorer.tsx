// DopeDB-style Database Explorer sidebar: connection tree, DDL modal, schema-group
// drag-and-drop. Split out of the old Connections/index.tsx (see ConnectionForm.tsx
// for the connection create/edit form that used to live alongside it).
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import {
  connectionAccessIssue,
  type ConnectionProfile,
} from "../../features/connections/domain";
import type { ConnectionLaunchPreset } from "../../features/connections/presets";
import {
  deleteConnection,
  upsertConnection,
} from "../../features/connections/tauriAdapter";
import { SCHEMA_SCOPE_PARAMETER } from "../../features/catalogExplorer/scopeFilter";
import { ProviderCredentialDialog } from "../../features/providers/ProviderCredentialDialog";
import { connectionQueryKeys } from "../../features/connections/queries";
import type { ProviderKind } from "../../features/providers/domain";
import type {
  EnvironmentConnection,
  KnowledgeEnvironment,
  KnowledgeEnvironmentView,
  KnowledgeProject,
  KnowledgeSource,
} from "../../features/knowledge/domain";
import {
  listKnowledgeEnvironmentConnections,
  listKnowledgeProjects,
  listKnowledgeSources,
  onKnowledgeSourceChanged,
} from "../../features/knowledge/tauriAdapter";
import type { AnalysisArticleRecord } from "../../features/analysisArticles/domain";
import { listAnalysisArticles } from "../../features/analysisArticles/tauriAdapter";
import { analysisQueryKeys } from "../../features/analysisArticles/queryKeys";
import { EnvironmentSetupDialog } from "../../features/knowledge/components/EnvironmentSetupDialog";
import { ProjectSetupDialog } from "../../features/knowledge/components/ProjectSetupDialog";
import {
  knowledgeEnvironmentBadge,
  knowledgeRevisionLabel,
} from "../../features/knowledge/presentation";
import { knowledgeQueryKeys } from "../../features/knowledge/queryKeys";
import { useCatalogExplorerState } from "../../features/catalogExplorer/state";
import { useSchemaGroupDrag } from "../../features/catalogExplorer/useSchemaGroupDrag";
import {
  qk,
  useCatalogScope,
} from "../../lib/queries";
import {
  buildConnectionSections,
  compareCatalogs,
  defaultSchemaBaseline,
  diffCounts,
  schemaGroupIsCompatible,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";
import EngineMark from "../../components/EngineMark";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import {
  InlineNotice,
  LoadingLabel,
  StatusDot,
  type StatusTone,
} from "../../design-system/components/Status";
import ToolbarMenu, {
  ToolbarMenuItem,
} from "../../components/ToolbarMenu";
import {
  ToolWindowAction,
  ToolWindowHideButton,
  ToolWindowSearchRow,
  ToolWindowSection,
  ToolWindowSideSurface,
} from "../../design-system/components/ToolWindow";
import {
  TreeRowActions,
  TreeSearch,
  TreeSectionButton,
} from "../../design-system/components/TreeControls";
import WorkspaceConnectionDialog from "../../features/workspaces/components/WorkspaceConnectionDialog";
import { deleteWorkspaceConnection } from "../../features/workspaces/tauriAdapter";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../lib/i18n";
import ConnectionNode from "./ConnectionNode";
import type { CatalogTreeSearchResult } from "./CatalogTree";
import DdlModal from "./DdlModal";
import { useCatalogTree } from "./useCatalogTree";

// Roving keyboard focus for the whole explorer tree. Rows declare themselves as
// `role="treeitem"` with an `aria-level`; the focus target is the row when it
// carries its own `tabindex` and otherwise the shared `TreeSectionButton`
// toggle. Leaf rows are windowed by `VirtualTreeRows`, so a neighbour can be
// unmounted at the viewport edge: edge jumps and boundary steps scroll first and
// re-read the mounted rows on the next frame instead of trusting one snapshot.
const TREE_ROW_SELECTOR = '[role="treeitem"]';
const TREE_ROW_STEP = 24;

// Explorer folder depths. Everything below a connection continues from
// `connectionLevel + 1` inside `ConnectionNode`/`CatalogTree`, so the whole
// chain Project → Environment → folder → connection → database → schema →
// section → object → metadata → column stays strictly increasing by one.
const PROJECT_LEVEL = 1;
const ENVIRONMENT_LEVEL = PROJECT_LEVEL + 1;
const ENVIRONMENT_RESOURCE_LEVEL = ENVIRONMENT_LEVEL + 1;
const ENVIRONMENT_CONNECTION_LEVEL = ENVIRONMENT_RESOURCE_LEVEL + 1;
// `Unassigned` and the driver-only tree are siblings of a Project, not of an
// Environment resource folder, so they restart at the root level.
const ROOT_LEVEL = 1;

function treeRowsOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(TREE_ROW_SELECTOR));
}

function treeRowFocusTarget(row: HTMLElement) {
  if (row.hasAttribute("tabindex")) return row;
  return row.querySelector<HTMLElement>("button") ?? row;
}

function treeRowToggle(row: HTMLElement) {
  return (
    row.querySelector<HTMLElement>("[data-tree-toggle]") ??
    row.querySelector<HTMLElement>("button")
  );
}

function treeRowExpanded(row: HTMLElement) {
  return (
    treeRowFocusTarget(row).getAttribute("aria-expanded") ??
    row.getAttribute("aria-expanded")
  );
}

function treeRowLevel(row: HTMLElement) {
  return Number(row.getAttribute("aria-level") ?? "1");
}

function focusTreeRow(row: HTMLElement) {
  row.scrollIntoView({ block: "nearest" });
  treeRowFocusTarget(row).focus({ preventScroll: true });
}

function activeTreeRow(container: HTMLElement) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active)) {
    return null;
  }
  return active.closest<HTMLElement>(TREE_ROW_SELECTOR);
}

function stepTreeRow(container: HTMLElement, delta: 1 | -1) {
  const rows = treeRowsOf(container);
  if (rows.length === 0) return;
  const current = activeTreeRow(container);
  const index = current ? rows.indexOf(current) : -1;
  if (index < 0) {
    focusTreeRow(delta > 0 ? rows[0] : rows[rows.length - 1]);
    return;
  }
  const next = rows[index + delta];
  if (next) {
    focusTreeRow(next);
    return;
  }
  const canScroll =
    delta > 0
      ? container.scrollTop + container.clientHeight <
        container.scrollHeight - 1
      : container.scrollTop > 0;
  if (!canScroll || !current) return;
  container.scrollTop += delta * TREE_ROW_STEP;
  requestAnimationFrame(() => {
    const mounted = treeRowsOf(container);
    const anchor = mounted.indexOf(current);
    // Windowing can unmount the anchor row during the scroll. Falling back to the
    // first or last mounted row would teleport to the opposite end of the tree, so
    // a lost anchor keeps focus where it is instead.
    if (anchor < 0) return;
    const target = mounted[anchor + delta];
    if (target) focusTreeRow(target);
  });
}

// A row without `aria-expanded` can still be a parent whose children are always
// visible, like the schema group. ArrowRight descends into the next deeper row
// instead of doing nothing.
function treeRowHasVisibleChild(container: HTMLElement, row: HTMLElement) {
  const rows = treeRowsOf(container);
  const next = rows[rows.indexOf(row) + 1];
  return next !== undefined && treeRowLevel(next) > treeRowLevel(row);
}

function jumpTreeRow(container: HTMLElement, edge: "end" | "start") {
  container.scrollTop = edge === "start" ? 0 : container.scrollHeight;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const rows = treeRowsOf(container);
      const target = edge === "start" ? rows[0] : rows[rows.length - 1];
      if (target) focusTreeRow(target);
    });
  });
}

function focusTreeParent(container: HTMLElement, row: HTMLElement) {
  const rows = treeRowsOf(container);
  const level = treeRowLevel(row);
  for (let cursor = rows.indexOf(row) - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (treeRowLevel(candidate) < level) {
      focusTreeRow(candidate);
      return;
    }
  }
}

function knowledgeSourceTone(source: KnowledgeSource): StatusTone {
  if (source.health === "ready") return "success";
  if (source.health === "failed") return "danger";
  return "warning";
}

function environmentAnalysisTone(
  article: AnalysisArticleRecord,
): StatusTone {
  if (article.state === "live") return "success";
  if (article.state === "review") return "warning";
  return "neutral";
}

// DopeDB-style Database Explorer: connections in the sidebar, the selected one
// expanded to reveal its tables. Clicking a table opens its data in the main area.
export function DatabaseExplorer({
  connections,
  selectedId,
  selectedTableKey,
  activeSchemaGroupKey,
  onSelectConn,
  onOpenTable,
  onOpenSchemaDiff,
  onEdit,
  onDeleted,
  onConnectionUpdated,
  workspaceAccount,
  workspaceHeader,
  onNewConnection,
  onClose,
  onCreateDemoDatabase,
  creatingDemo = false,
  compact = false,
  compactOpen = false,
  revealRequest: externalRevealRequest = 0,
  revealDatabase = null,
  revealNamespace = null,
  activeProjectEnvironmentId = null,
  activeProjectEnvironmentView = null,
  activeProjectEnvironmentResourceId = null,
  onOpenProjectEnvironment,
}: {
  connections: ConnectionProfile[];
  selectedId: string | null;
  selectedTableKey: string | null;
  activeSchemaGroupKey: string | null;
  onSelectConn: (id: string) => void;
  onOpenTable: (conn: ConnectionProfile, table: CatalogTable) => void;
  onOpenSchemaDiff: (group: SchemaConnectionGroup) => void;
  onEdit: (conn: ConnectionProfile) => void;
  onDeleted: (id: string) => void;
  onConnectionUpdated: (conn: ConnectionProfile) => void;
  workspaceAccount?: ReactNode;
  workspaceHeader?: ReactNode;
  onNewConnection: (preset?: ConnectionLaunchPreset) => void;
  onClose: () => void;
  onCreateDemoDatabase: () => void;
  creatingDemo?: boolean;
  compact?: boolean;
  compactOpen?: boolean;
  revealRequest?: number;
  revealDatabase?: string | null;
  revealNamespace?: string | null;
  activeProjectEnvironmentId?: string | null;
  activeProjectEnvironmentView?: KnowledgeEnvironmentView | null;
  activeProjectEnvironmentResourceId?: string | null;
  onOpenProjectEnvironment: (
    environmentId: string | null,
    view: KnowledgeEnvironmentView,
    resourceId?: string | null,
  ) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const catalogScopeKeyRef = useRef(catalogScope.key);
  const knowledgeEnabled =
    catalogScope.ready &&
    catalogScope.accountScope !== null;
  const sharedKnowledgeWorkspace = knowledgeEnabled;
  const knowledgeProjects = useQuery({
    queryKey: knowledgeQueryKeys.projects(catalogScope.key),
    queryFn: listKnowledgeProjects,
    enabled: knowledgeEnabled,
    retry: false,
  });
  const knowledgeSources = useQuery({
    queryKey: knowledgeQueryKeys.sources(catalogScope.key),
    queryFn: listKnowledgeSources,
    enabled: knowledgeEnabled,
    retry: false,
  });
  const projectEnvironmentIds = useMemo(
    () =>
      (knowledgeProjects.data ?? []).flatMap((project) =>
        project.environments.map((environment) => environment.id),
      ),
    [knowledgeProjects.data],
  );
  const environmentConnectionQueries = useQueries({
    queries: projectEnvironmentIds.map((environmentId) => ({
      queryKey: knowledgeQueryKeys.environmentConnections(
        environmentId,
        catalogScope.key,
      ),
      queryFn: () => listKnowledgeEnvironmentConnections(environmentId),
      enabled: knowledgeEnabled,
      retry: false,
    })),
  });
  const [globalFilter, setGlobalFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResultsByCatalog, setSearchResultsByCatalog] = useState<
    Record<string, CatalogTreeSearchResult[]>
  >({});
  const [activeSearchResultKey, setActiveSearchResultKey] = useState<
    string | null
  >(null);
  const [projectSetupOpen, setProjectSetupOpen] = useState(false);
  const [environmentSetupProjectId, setEnvironmentSetupProjectId] =
    useState<string | null>(null);
  // The per-Project "add environment" row action is inside the roving-focus tree
  // and is therefore not a Tab stop, so the toolbar has to carry the same
  // command for the Project the user is standing in. A Project with no
  // environment can never be named by `activeProjectEnvironmentId`, which is why
  // the last focused Project subtree is remembered instead.
  const focusedProjectIdRef = useRef<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedEnvironmentIds, setExpandedEnvironmentIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedResourceKeys, setExpandedResourceKeys] = useState<Set<string>>(
    new Set(),
  );
  const environmentAnalysisQueries = useQueries({
    queries: projectEnvironmentIds.map((environmentId) => ({
      queryKey: analysisQueryKeys.articles(catalogScope.key, environmentId),
      queryFn: () => listAnalysisArticles(environmentId),
      enabled:
        sharedKnowledgeWorkspace &&
        expandedResourceKeys.has(`${environmentId}:analyses`),
      retry: false,
    })),
  });
  const knownKnowledgeScopeRef = useRef<{
    key: string;
    projectIds: Set<string>;
    environmentIds: Set<string>;
  } | null>(null);
  const [treeScrollElement, setTreeScrollElement] =
    useState<HTMLDivElement | null>(null);
  const onTreeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const container = event.currentTarget;
      const origin = event.target as HTMLElement;
      if (origin.closest('input, textarea, [role="menu"], [role="dialog"]')) {
        return;
      }
      const row = origin.closest<HTMLElement>(TREE_ROW_SELECTOR);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        stepTreeRow(container, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        stepTreeRow(container, -1);
      } else if (event.key === "Home") {
        event.preventDefault();
        jumpTreeRow(container, "start");
      } else if (event.key === "End") {
        event.preventDefault();
        jumpTreeRow(container, "end");
      } else if (event.key === "ArrowRight" && row) {
        const expanded = treeRowExpanded(row);
        if (expanded === "false") {
          event.preventDefault();
          treeRowToggle(row)?.click();
        } else if (
          expanded === "true" ||
          treeRowHasVisibleChild(container, row)
        ) {
          event.preventDefault();
          stepTreeRow(container, 1);
        }
      } else if (event.key === "ArrowLeft" && row) {
        event.preventDefault();
        if (treeRowExpanded(row) === "true") treeRowToggle(row)?.click();
        else focusTreeParent(container, row);
      }
    },
    [],
  );
  const [savingScopeId, setSavingScopeId] = useState<string | null>(null);
  const [localRevealRequest, setLocalRevealRequest] = useState(0);
  const [providerCredentialsOpen, setProviderCredentialsOpen] =
    useState<ProviderKind | null>(null);
  const providerReturnFocusRef = useRef<HTMLElement | null>(null);
  const {
    state: {
      wanted,
      refreshErrors: refreshErrs,
      openConnections: open,
      refreshingId: refreshing,
      deletingId: deleting,
      collapsedSections,
      objectSectionsOpen,
      showRowCounts,
      openMenuId,
      workspaceDialog,
      ddlDialog,
    },
    commands,
  } = useCatalogExplorerState(catalogScope.key);
  const closeOpenMenu = useEffectEvent(() => {
    commands.patch({ openMenuId: null });
  });

  useEffect(() => {
    if (!knowledgeProjects.data) return;
    const projectIds = new Set(
      knowledgeProjects.data.map((project) => project.id),
    );
    const environmentIds = new Set(projectEnvironmentIds);
    const previous =
      knownKnowledgeScopeRef.current?.key === catalogScope.key
        ? knownKnowledgeScopeRef.current
        : null;
    const newProjectIds = [...projectIds].filter(
      (id) => !previous?.projectIds.has(id),
    );
    const newEnvironmentIds = [...environmentIds].filter(
      (id) => !previous?.environmentIds.has(id),
    );

    if (previous === null) {
      setExpandedProjectIds(projectIds);
      setExpandedEnvironmentIds(environmentIds);
      setExpandedResourceKeys(
        new Set([
          "unassigned",
          ...projectEnvironmentIds.map(
            (environmentId) => `${environmentId}:databases`,
          ),
        ]),
      );
    } else {
      setExpandedProjectIds((current) =>
        new Set([...current, ...newProjectIds]),
      );
      setExpandedEnvironmentIds((current) =>
        new Set([...current, ...newEnvironmentIds]),
      );
      setExpandedResourceKeys(
        (current) =>
          new Set([
            ...current,
            ...newEnvironmentIds.map(
              (environmentId) => `${environmentId}:databases`,
            ),
          ]),
      );
    }
    knownKnowledgeScopeRef.current = {
      key: catalogScope.key,
      projectIds,
      environmentIds,
    };
  }, [catalogScope.key, knowledgeProjects.data, projectEnvironmentIds]);

  useEffect(() => {
    if (!knowledgeEnabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onKnowledgeSourceChanged(() => {
      if (disposed) return;
      void queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.sources(),
      });
      void queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [knowledgeEnabled, queryClient]);

  const environmentConnectionsById = new Map<string, EnvironmentConnection[]>();
  projectEnvironmentIds.forEach((environmentId, index) => {
    environmentConnectionsById.set(
      environmentId,
      environmentConnectionQueries[index]?.data ?? [],
    );
  });
  const environmentBindingsReady =
    environmentConnectionQueries.length === projectEnvironmentIds.length &&
    environmentConnectionQueries.every((query) => query.isSuccess);
  const boundConnectionIds = new Set(
    environmentBindingsReady
      ? [...environmentConnectionsById.values()].flatMap((bindings) =>
          bindings.flatMap((binding) =>
            binding.connectionId ? [binding.connectionId] : [],
          ),
        )
      : [],
  );
  const unassignedConnections =
    knowledgeProjects.isSuccess && environmentBindingsReady
      ? connections.filter((connection) => !boundConnectionIds.has(connection.id))
      : connections;
  const unassignedSections = buildConnectionSections(unassignedConnections);

  function openProviderCredentials(provider: ProviderKind) {
    providerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProviderCredentialsOpen(provider);
  }
  const {
    groupByConnectionId,
    draggingId,
    dropTarget,
    dragPreview,
    suppressClickRef,
    pointerDown: pointerDownConnection,
    pointerMove: pointerMoveConnection,
    pointerUp: pointerUpConnection,
    pointerCancel: pointerCancelConnection,
  } = useSchemaGroupDrag(connections, onConnectionUpdated);

  useEffect(() => {
    if (!openMenuId) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".db-menu")) return;
      closeOpenMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [openMenuId]);

  // Query observers survive the shell while a workspace changes. Clear the explorer's
  // per-connection intent at the same boundary as its scoped keys so no hidden row can
  // resubscribe an old connection in the newly active account.
  useEffect(() => {
    catalogScopeKeyRef.current = catalogScope.key;
  }, [catalogScope.key]);

  useEffect(() => {
    setProjectSetupOpen(false);
    setEnvironmentSetupProjectId(null);
  }, [catalogScope.key]);

  const wantedIds = useMemo(() => [...wanted].sort(), [wanted]);
  const readableWantedIds = useMemo(() => {
    const byId = new Map<string, ConnectionProfile>(
      connections.map((connection) => [connection.id, connection]),
    );
    return wantedIds.filter((id) => {
      const connection = byId.get(id);
      return connection !== undefined
        && connectionAccessIssue(connection) === undefined;
    });
  }, [connections, wantedIds]);
  const {
    databasesByConnection,
    databaseOverviews,
    overviewErrsByDatabase,
    databaseCatalogs,
    detailErrsByDatabase,
    overviews,
    overviewErrs,
    catalogs,
    detailErrs,
    requestOverview,
    requestDetails,
    forgetOverview,
    forgetConnection,
  } = useCatalogTree(readableWantedIds, catalogScope);
  const errs = { ...overviewErrs, ...refreshErrs };

  // Expanding a node subscribes to its catalog; the query cache decides whether that is a
  // fetch or a free read. Retries are not automatic (see the query defaults), so a node
  // that failed refetches when the user expands it again.
  function ensureLoaded(id: string) {
    commands.want(id);
    commands.clearRefreshError(id);
    if (
      queryClient.getQueryState(qk.connectionDatabases(id, catalogScope.key))
        ?.status === "error"
    ) {
      void queryClient.refetchQueries({
        queryKey: qk.connectionDatabases(id, catalogScope.key),
      });
    }
  }

  function ensureGroupLoaded(id: string) {
    const group = groupByConnectionId.get(id);
    if (!group) {
      ensureLoaded(id);
      return;
    }
    for (const conn of group.connections) ensureLoaded(conn.id);
  }

  function toggleOpen(id: string) {
    const willOpen = !open.has(id);
    commands.toggleConnection(id);
    if (willOpen) {
      ensureGroupLoaded(id);
      return;
    }
    commands.forget(id);
    forgetConnection(id);
  }

  function expandAllConnections() {
    for (const connection of connections) ensureGroupLoaded(connection.id);
    setExpandedProjectIds(
      new Set((knowledgeProjects.data ?? []).map((project) => project.id)),
    );
    setExpandedEnvironmentIds(new Set(projectEnvironmentIds));
    setExpandedResourceKeys(
      new Set(
        ["unassigned", ...projectEnvironmentIds.flatMap((environmentId) => [
          `${environmentId}:databases`,
          `${environmentId}:sources`,
          `${environmentId}:analyses`,
        ])],
      ),
    );
    commands.patch({
      openConnections: new Set(
        connections.map((connection) => connection.id),
      ),
    });
  }

  function collapseAllConnections() {
    for (const id of readableWantedIds) forgetConnection(id);
    setExpandedProjectIds(new Set());
    setExpandedEnvironmentIds(new Set());
    setExpandedResourceKeys(new Set());
    commands.patch({
      openConnections: new Set(),
      wanted: new Set(),
      objectSectionsOpen: new Set(),
    });
  }

  function updateGlobalFilter(value: string) {
    setGlobalFilter(value);
  }

  const onSearchResultsChange = useCallback(
    (catalogKey: string, results: CatalogTreeSearchResult[]) => {
      setSearchResultsByCatalog((current) => {
        if (results.length === 0) {
          if (!(catalogKey in current)) return current;
          const next = { ...current };
          delete next[catalogKey];
          return next;
        }
        if (
          current[catalogKey]?.length === results.length &&
          current[catalogKey]?.every((result, index) =>
            result.key === results[index]?.key,
          )
        ) {
          return current;
        }
        return { ...current, [catalogKey]: results };
      });
    },
    [],
  );

  const searchResults = useMemo(
    () => Object.values(searchResultsByCatalog).flat(),
    [searchResultsByCatalog],
  );
  const navigableSearchResults = useMemo(
    () => searchResults.filter((result) => result.kind === "relation"),
    [searchResults],
  );
  const activeSearchResult = activeSearchResultKey
    ? searchResults.find((result) => result.key === activeSearchResultKey)
    : undefined;

  useEffect(() => {
    if (globalFilter) return;
    setSearchResultsByCatalog({});
    setActiveSearchResultKey(null);
  }, [globalFilter]);

  function moveSearchResult(direction: 1 | -1) {
    if (navigableSearchResults.length === 0) return;
    const currentIndex = activeSearchResultKey
      ? navigableSearchResults.findIndex(
          (result) => result.key === activeSearchResultKey,
        )
      : -1;
    const nextIndex =
      (currentIndex + direction + navigableSearchResults.length) %
      navigableSearchResults.length;
    setActiveSearchResultKey(navigableSearchResults[nextIndex]?.key ?? null);
  }

  function openExplorerSearch() {
    setSearchOpen(true);
  }

  const openSelectedConnection = useEffectEvent((id: string) => {
    commands.openConnection(id);
    ensureGroupLoaded(id);
  });

  // Selecting a connection auto-expands it (collapse stays a free action after).
  useEffect(() => {
    if (!selectedId) return;
    openSelectedConnection(selectedId);
  }, [selectedId]);

  // Refresh every database target discovered through this server connection. The
  // database-scoped endpoints are live reads; invalidating their exact prefix replaces
  // relation and detail projections without reusing the legacy configured-database cache.
  async function refreshSchema(id: string) {
    const scopeKey = catalogScope.key;
    commands.patch({ refreshingId: id });
    commands.clearRefreshError(id);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: qk.connectionDatabases(id, scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: ["databaseCatalogOverview", id],
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: ["databaseCatalog", id],
          refetchType: "active",
        }),
      ]);
      if (catalogScopeKeyRef.current !== scopeKey) return;
      commands.want(id);
    } catch (e) {
      if (catalogScopeKeyRef.current !== scopeKey) return;
      commands.setRefreshError(id, errMessage(e));
    } finally {
      if (catalogScopeKeyRef.current === scopeKey) {
        commands.patch({ refreshingId: null });
      }
    }
  }

  async function refreshExplorer() {
    const scopeKey = catalogScope.key;
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionQueryKeys.all(scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.projects(scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.sources(scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.environmentConnections(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: analysisQueryKeys.articles(scopeKey),
          refetchType: "active",
        }),
        selectedId ? refreshSchema(selectedId) : Promise.resolve(),
      ]);
    } catch (error) {
      if (catalogScopeKeyRef.current === scopeKey) {
        toast(errMessage(error), "error");
      }
    }
  }

  async function removeConnection(conn: ConnectionProfile) {
    commands.patch({ deletingId: conn.id });
    try {
      if (conn.workspaceAccess === "manage") {
        await deleteWorkspaceConnection(conn.id);
      } else {
        await deleteConnection(conn.id);
      }
      commands.forget(conn.id);
      forgetConnection(conn.id);
      queryClient.removeQueries({ queryKey: qk.catalog(conn.id, catalogScope.key) });
      queryClient.removeQueries({
        queryKey: qk.catalogOverview(conn.id, catalogScope.key),
      });
      queryClient.removeQueries({
        queryKey: qk.catalogSnapshot(conn.id, catalogScope.key),
      });
      queryClient.removeQueries({
        queryKey: qk.connectionDatabases(conn.id, catalogScope.key),
      });
      queryClient.removeQueries({
        queryKey: ["databaseCatalogOverview", conn.id],
      });
      queryClient.removeQueries({
        queryKey: ["databaseCatalog", conn.id],
      });
      toast(t("connections.connectionDeleted"));
      onDeleted(conn.id);
    } catch (e) {
      toast(errMessage(e), "error");
    } finally {
      commands.patch({ deletingId: null });
    }
  }

  async function setSchemaScope(
    connection: ConnectionProfile,
    schemas: string[],
  ) {
    if (
      savingScopeId !== null ||
      connection.workspaceAccess === "view"
    ) {
      return;
    }
    setSavingScopeId(connection.id);
    try {
      const extraParams = { ...connection.extraParams };
      if (schemas.length > 0) {
        extraParams[SCHEMA_SCOPE_PARAMETER] = JSON.stringify(schemas);
      } else {
        delete extraParams[SCHEMA_SCOPE_PARAMETER];
      }
      const updated = await upsertConnection({
        ...connection,
        extraParams,
      });
      onConnectionUpdated(updated);
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setSavingScopeId(null);
    }
  }

  function toggleObjectSection(connectionId: string, kind: string) {
    const key = `${connectionId}:${kind}`;
    if (!objectSectionsOpen.has(key)) {
      const separator = kind.indexOf("\u0000");
      const connection = connections.find(
        (candidate) => candidate.id === connectionId,
      );
      const database =
        separator >= 0
          ? kind.slice(0, separator)
          : connection?.database;
      if (database) requestDetails(connectionId, database);
    }
    commands.toggleObjectSection(key);
  }

  function toggleRelationSection(connectionId: string, sectionKey: string) {
    const key = `${connectionId}:${sectionKey}`;
    commands.toggleCollapsedSection(key);
  }

  function renderConnection(
    connection: ConnectionProfile,
    nested: boolean,
    level: number,
  ) {
    return (
      <ConnectionNode
        key={connection.id}
        connection={connection}
        nested={nested}
        level={level}
        selected={connection.id === selectedId}
        selectedTableKey={selectedTableKey}
        expanded={open.has(connection.id)}
        draggingId={draggingId}
        dropTarget={dropTarget}
        suppressClickRef={suppressClickRef}
        openMenuId={openMenuId}
        onOpenMenu={(id) => commands.patch({ openMenuId: id })}
        refreshingId={refreshing}
        deletingId={deleting}
        showRowCounts={showRowCounts}
        onShowRowCounts={(show) => commands.patch({ showRowCounts: show })}
        schemaScopeSaving={savingScopeId === connection.id}
        onSetSchemaScope={(schemas) =>
          void setSchemaScope(connection, schemas)
        }
        overview={overviews[connection.id]}
        fullCatalog={catalogs[connection.id]}
        error={errs[connection.id]}
        detailError={detailErrs[connection.id]}
        databases={databasesByConnection[connection.id]}
        databaseOverviews={databaseOverviews}
        databaseCatalogs={databaseCatalogs}
        overviewErrorsByDatabase={overviewErrsByDatabase}
        detailErrorsByDatabase={detailErrsByDatabase}
        treeScrollElement={treeScrollElement}
        filter={globalFilter}
        activeSearchResultKey={activeSearchResultKey}
        onSearchResultsChange={onSearchResultsChange}
        groupByConnectionId={groupByConnectionId}
        catalogs={catalogs}
        collapsedSections={collapsedSections}
        objectSectionsOpen={objectSectionsOpen}
        onPointerDown={pointerDownConnection}
        onPointerMove={pointerMoveConnection}
        onPointerUp={pointerUpConnection}
        onPointerCancel={pointerCancelConnection}
        onToggleOpen={() => toggleOpen(connection.id)}
        onSelect={() => onSelectConn(connection.id)}
        onEdit={() => onEdit(connection)}
        onWorkspaceDialog={(mode) =>
          commands.openWorkspaceDialog({ connection, mode })
        }
        onRefresh={() => void refreshSchema(connection.id)}
        onDelete={() => void removeConnection(connection)}
        onOpenTable={(table) => onOpenTable(connection, table)}
        onRequestDetails={(database) =>
          requestDetails(connection.id, database)
        }
        onRequestOverview={(database) =>
          requestOverview(connection.id, database)
        }
        onForgetOverview={(database) =>
          forgetOverview(connection.id, database)
        }
        onRetryOverview={(database) => {
          commands.clearRefreshError(connection.id);
          void queryClient.refetchQueries({
            queryKey: qk.databaseCatalogOverview(
              connection.id,
              database,
              catalogScope.key,
            ),
            exact: true,
          });
        }}
        onToggleRelationSection={(sectionKey) =>
          toggleRelationSection(connection.id, sectionKey)
        }
        onToggleObjectSection={(kind) =>
          toggleObjectSection(connection.id, kind)
        }
        revealRequest={externalRevealRequest + localRevealRequest}
        revealDatabase={revealDatabase}
        revealNamespace={revealNamespace}
      />
    );
  }

  function renderGroup(group: SchemaConnectionGroup, level: number) {
    const isDropTarget =
      dropTarget?.kind === "group" && dropTarget.key === group.key;
    const engine = group.connections[0]?.engine;
    const baseline = defaultSchemaBaseline(group);
    const baselineCatalog = baseline ? catalogs[baseline.id] : undefined;
    const targets = group.connections.filter((connection) => connection.id !== baseline?.id);
    const diffs = baselineCatalog
      ? targets.flatMap((connection) => {
          const catalog = catalogs[connection.id];
          return catalog ? [compareCatalogs(catalog, baselineCatalog)] : [];
        })
      : [];
    const complete = targets.length > 0 && diffs.length === targets.length;
    const groupCounts = diffs.reduce(
      (total, diff) => {
        const counts = diffCounts(diff);
        total.added += counts.added;
        total.missing += counts.missing;
        total.changed += counts.changed;
        return total;
      },
      { added: 0, missing: 0, changed: 0 },
    );
    const groupTotal = groupCounts.added + groupCounts.missing + groupCounts.changed;
    // The row itself is the focus target, so the diff command has to be reachable
    // from the row rather than from a second Tab stop inside the tree.
    const openGroupDiff = () => {
      for (const connection of group.connections) ensureLoaded(connection.id);
      onOpenSchemaDiff(group);
    };
    return (
      <div
        key={`group-${group.key}`}
        data-schema-group-key={group.key}
        data-drop-target={isDropTarget}
        className="tw:relative tw:my-1 tw:border-l tw:border-border-strong tw:pt-0 tw:pr-0 tw:pb-1 tw:pl-1 tw:transition-colors tw:data-[drop-target=true]:border-ring tw:data-[drop-target=true]:bg-muted"
      >
        <div
          data-active={activeSchemaGroupKey === group.key}
          className="tw:flex tw:min-h-control-sm tw:items-center tw:gap-1 tw:px-1 tw:text-xs tw:text-muted-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[active=true]:text-primary"
          role="treeitem"
          aria-level={level}
          tabIndex={-1}
          title={t("connections.schemaGroupTitle", { group: group.label })}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openGroupDiff();
          }}
        >
          {engine && <EngineMark engine={engine} size="tree" />}
          <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-bold tw:text-foreground">
            {group.label}
          </span>
          <button
            type="button"
            className="tw:inline-flex tw:min-h-control-xs tw:min-w-0 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-[2px] tw:rounded-full tw:border tw:border-border-subtle tw:bg-card tw:px-1.5 tw:font-sans tw:text-2xs tw:font-bold tw:whitespace-nowrap tw:text-muted-foreground tw:hover:border-ring tw:hover:text-primary"
            tabIndex={-1}
            title={t("schemaDiff.openTitle")}
            aria-label={t("schemaDiff.openTitle")}
            onClick={openGroupDiff}
          >
            {!schemaGroupIsCompatible(group) ? (
              <Icon name="alert" />
            ) : complete && groupTotal === 0 ? (
              <Icon name="check" />
            ) : complete ? (
              <span className="tw:inline-flex tw:gap-[2px] tw:font-mono tw:[font-variant-numeric:tabular-nums]">
                {groupCounts.added > 0 ? (
                  <span className="tw:text-success">
                    +{groupCounts.added}
                  </span>
                ) : null}
                {groupCounts.missing > 0 ? (
                  <span className="tw:text-danger">
                    −{groupCounts.missing}
                  </span>
                ) : null}
                {groupCounts.changed > 0 ? (
                  <span className="tw:text-warning">
                    ~{groupCounts.changed}
                  </span>
                ) : null}
              </span>
            ) : (
              <span>{t("schemaDiff.open")}</span>
            )}
          </button>
        </div>
        {group.connections.map((conn) =>
          renderConnection(conn, true, level + 1),
        )}
      </div>
    );
  }

  function toggleExpandedId(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderUnavailableBinding(binding: EnvironmentConnection) {
    return (
      <button
        key={binding.id}
        type="button"
        role="treeitem"
        aria-level={ENVIRONMENT_CONNECTION_LEVEL}
        tabIndex={-1}
        className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-[var(--ds-tree-row-padding-block)] tw:pl-5 tw:text-left tw:font-sans tw:text-sm tw:text-muted-foreground tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        onClick={() =>
          onOpenProjectEnvironment(
            binding.projectEnvironmentId,
            "databases",
          )
        }
        title={t("connections.environmentDatabaseUnavailable")}
      >
        <StatusDot tone="warning" />
        <Icon name="database" className="tw:shrink-0" />
        <span className="tw:min-w-0 tw:flex-1 tw:truncate">
          {binding.alias || binding.connectionName}
        </span>
        <Icon name="alert" className="tw:shrink-0 tw:text-warning" />
      </button>
    );
  }

  // A folder whose query failed states the failure and offers the retry instead
  // of falling through to the "nothing here yet" branch. The exact error stays
  // on the row title so a 396px sidebar keeps one line. The failure is a real
  // `treeitem`, so ArrowUp/ArrowDown reach it and the retry stays inside the
  // container's single Tab stop with `tabIndex={-1}`; Enter/Space runs it like
  // any other row. The row owns the `tabindex` rather than delegating to the
  // retry button: while the refetch runs that button is `disabled` and
  // `.focus()` on it is a no-op, which would strand ArrowDown on this row.
  // Enter still swallows the key during that refetch, so the row carries
  // `aria-busy` and the wait is announced instead of reading as a dead key.
  function renderTreeQueryFailure(
    label: string,
    error: unknown,
    fetching: boolean,
    level: number,
    onRetry: () => void,
  ) {
    return (
      <div
        role="treeitem"
        aria-level={level}
        aria-busy={fetching}
        tabIndex={-1}
        className="tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!fetching) onRetry();
        }}
      >
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <Button
              size="compact"
              tabIndex={-1}
              disabled={fetching}
              onClick={onRetry}
            >
              <Icon name="refresh" />
              {t("app.retry")}
            </Button>
          }
        >
          <span className="tw:block tw:truncate" title={errMessage(error)}>
            {label}
          </span>
        </InlineNotice>
      </div>
    );
  }

  function renderEnvironmentResources(environment: KnowledgeEnvironment) {
    const databaseKey = `${environment.id}:databases`;
    const sourceKey = `${environment.id}:sources`;
    const analysisKey = `${environment.id}:analyses`;
    const environmentIndex = projectEnvironmentIds.indexOf(environment.id);
    const bindings = environmentConnectionsById.get(environment.id) ?? [];
    const environmentSources = (knowledgeSources.data ?? []).filter(
      (source) => source.projectEnvironmentId === environment.id,
    );
    const databaseExpanded = expandedResourceKeys.has(databaseKey);
    const sourceExpanded = expandedResourceKeys.has(sourceKey);
    const analysisExpanded = expandedResourceKeys.has(analysisKey);
    const databaseQuery = environmentConnectionQueries[environmentIndex];
    const analysisQuery = environmentAnalysisQueries[environmentIndex];
    const environmentAnalyses = analysisQuery?.data ?? [];
    const activeAnalysisIsVisible = environmentAnalyses.some(
      (article) => article.id === activeProjectEnvironmentResourceId,
    );

    return (
      <div className="tw:grid tw:pl-3">
        <div role="treeitem" aria-level={ENVIRONMENT_RESOURCE_LEVEL}>
          <TreeSectionButton
            expanded={databaseExpanded}
            icon="database"
            tabIndex={-1}
            selected={
              activeProjectEnvironmentId === environment.id &&
              activeProjectEnvironmentView === "databases"
            }
            actions={
              <TreeRowActions>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  tabIndex={-1}
                  title={t("connections.environmentAddDatabase")}
                  aria-label={t("connections.environmentAddDatabase")}
                  onClick={() => {
                    onOpenProjectEnvironment(environment.id, "databases");
                    onNewConnection();
                  }}
                >
                  <Icon name="plus" />
                </Button>
              </TreeRowActions>
            }
            onToggle={() => {
              toggleExpandedId(setExpandedResourceKeys, databaseKey);
              onOpenProjectEnvironment(environment.id, "databases");
            }}
          >
            {t("connections.environmentDatabases")}
          </TreeSectionButton>
        </div>
        {databaseExpanded ? (
          <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
            {databaseQuery?.isPending ? (
              <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
                <LoadingLabel>{t("common.loading")}</LoadingLabel>
              </div>
            ) : databaseQuery?.error ? (
              // A failed binding read is not an empty Environment; naming it keeps
              // the "add database" hint from asserting a cause the query never saw.
              renderTreeQueryFailure(
                t("connections.environmentDatabaseLoadFailed"),
                databaseQuery.error,
                databaseQuery.isFetching,
                ENVIRONMENT_CONNECTION_LEVEL,
                () => void databaseQuery.refetch(),
              )
            ) : bindings.length > 0 ? (
              bindings.map((binding) => {
                const connection = binding.connectionId
                  ? connections.find(
                      (candidate) => candidate.id === binding.connectionId,
                    )
                  : null;
                return connection
                  ? renderConnection(
                      connection,
                      true,
                      ENVIRONMENT_CONNECTION_LEVEL,
                    )
                  : renderUnavailableBinding(binding);
              })
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-level={ENVIRONMENT_CONNECTION_LEVEL}
                tabIndex={-1}
                className="tw:min-h-control-sm tw:cursor-pointer tw:border-0 tw:bg-transparent tw:px-5 tw:py-1 tw:text-left tw:font-sans tw:text-xs tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() =>
                  onOpenProjectEnvironment(environment.id, "databases")
                }
              >
                {t("connections.environmentAddDatabase")}
              </button>
            )}
          </div>
        ) : null}

        <div role="treeitem" aria-level={ENVIRONMENT_RESOURCE_LEVEL}>
          <TreeSectionButton
            expanded={sourceExpanded}
            icon="branch"
            tabIndex={-1}
            selected={
              activeProjectEnvironmentId === environment.id &&
              activeProjectEnvironmentView === "sources"
            }
            actions={
              <TreeRowActions>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  tabIndex={-1}
                  title={t("connections.environmentAddSource")}
                  aria-label={t("connections.environmentAddSource")}
                  onClick={() =>
                    onOpenProjectEnvironment(environment.id, "sources")
                  }
                >
                  <Icon name="plus" />
                </Button>
              </TreeRowActions>
            }
            onToggle={() => {
              toggleExpandedId(setExpandedResourceKeys, sourceKey);
              onOpenProjectEnvironment(environment.id, "sources");
            }}
          >
            {t("connections.environmentDataSources")}
          </TreeSectionButton>
        </div>
        {sourceExpanded ? (
          <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
            {knowledgeSources.isPending ? (
              <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
                <LoadingLabel>{t("common.loading")}</LoadingLabel>
              </div>
            ) : knowledgeSources.error ? (
              // Same boundary as the databases folder: a failed source listing
              // must not be reported as "this Environment has no source".
              renderTreeQueryFailure(
                t("connections.environmentSourceLoadFailed"),
                knowledgeSources.error,
                knowledgeSources.isFetching,
                ENVIRONMENT_CONNECTION_LEVEL,
                () => void knowledgeSources.refetch(),
              )
            ) : environmentSources.length > 0 ? (
              environmentSources.map((source) => (
                <button
                  key={source.sourceId}
                  type="button"
                  role="treeitem"
                  aria-level={ENVIRONMENT_CONNECTION_LEVEL}
                  tabIndex={-1}
                  className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-[var(--ds-tree-row-padding-block)] tw:pl-5 tw:text-left tw:font-sans tw:text-sm tw:text-foreground tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                  onClick={() =>
                    onOpenProjectEnvironment(environment.id, "sources")
                  }
                  title={`${source.provider === "github" ? "GitHub" : t("connections.environmentLocalFolder")} · ${knowledgeRevisionLabel(source.revision, {
                    dirty: t("knowledge.revisionDirty"),
                    snapshot: t("knowledge.revisionSnapshot"),
                  })}`}
                >
                  <StatusDot tone={knowledgeSourceTone(source)} />
                  <Icon
                    name={source.provider === "github" ? "branch" : "folder"}
                    className="tw:shrink-0"
                  />
                  <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                    {source.displayName}
                  </span>
                </button>
              ))
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-level={ENVIRONMENT_CONNECTION_LEVEL}
                tabIndex={-1}
                className="tw:min-h-control-sm tw:cursor-pointer tw:border-0 tw:bg-transparent tw:px-5 tw:py-1 tw:text-left tw:font-sans tw:text-xs tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() =>
                  onOpenProjectEnvironment(environment.id, "sources")
                }
              >
                {t("connections.environmentAddSource")}
              </button>
            )}
          </div>
        ) : null}

        <div role="treeitem" aria-level={ENVIRONMENT_RESOURCE_LEVEL}>
          <TreeSectionButton
            expanded={analysisExpanded}
            icon="chart"
            tabIndex={-1}
            selected={
              activeProjectEnvironmentId === environment.id &&
              activeProjectEnvironmentView === "analyses" &&
              !activeAnalysisIsVisible
            }
            onToggle={() => {
              toggleExpandedId(setExpandedResourceKeys, analysisKey);
              onOpenProjectEnvironment(environment.id, "analyses");
            }}
          >
            {t("connections.environmentAnalyses")}
          </TreeSectionButton>
        </div>
        {analysisExpanded ? (
          <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
            {sharedKnowledgeWorkspace && analysisQuery?.isPending ? (
              <div className="tw:min-h-control-sm tw:px-2 tw:py-1 tw:text-xs">
                <LoadingLabel>{t("common.loading")}</LoadingLabel>
              </div>
            ) : sharedKnowledgeWorkspace && analysisQuery?.error ? (
              renderTreeQueryFailure(
                t("connections.environmentAnalysisLoadFailed"),
                analysisQuery.error,
                analysisQuery.isFetching,
                ENVIRONMENT_CONNECTION_LEVEL,
                () => void analysisQuery.refetch(),
              )
            ) : environmentAnalyses.length > 0 ? (
              environmentAnalyses.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  role="treeitem"
                  aria-level={ENVIRONMENT_CONNECTION_LEVEL}
                  tabIndex={-1}
                  data-selected={
                    activeProjectEnvironmentResourceId === article.id
                  }
                  className="tw:flex tw:min-h-[var(--ds-tree-row-height)] tw:w-full tw:min-w-0 tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent tw:px-1 tw:py-[var(--ds-tree-row-padding-block)] tw:pl-5 tw:text-left tw:font-sans tw:text-sm tw:text-foreground tw:data-[selected=true]:bg-selection tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                  onClick={() =>
                    onOpenProjectEnvironment(
                      environment.id,
                      "analyses",
                      article.id,
                    )
                  }
                  title={article.definition.question}
                >
                  <StatusDot tone={environmentAnalysisTone(article)} />
                  <Icon name="chart" className="tw:shrink-0" />
                  <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                    {article.definition.title}
                  </span>
                </button>
              ))
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-level={ENVIRONMENT_CONNECTION_LEVEL}
                tabIndex={-1}
                className="tw:min-h-control-sm tw:cursor-pointer tw:border-0 tw:bg-transparent tw:px-5 tw:py-1 tw:text-left tw:font-sans tw:text-xs tw:text-muted-foreground tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                onClick={() =>
                  onOpenProjectEnvironment(environment.id, "analyses")
                }
              >
                {t("connections.environmentNoAnalyses")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  function renderProject(project: KnowledgeProject) {
    const projectExpanded = expandedProjectIds.has(project.id);
    const activeEnvironmentBelongsToProject = project.environments.some(
      (environment) => environment.id === activeProjectEnvironmentId,
    );
    return (
      <div
        key={project.id}
        className="tw:grid"
        onFocus={() => {
          focusedProjectIdRef.current = project.id;
        }}
      >
        <div role="treeitem" aria-level={PROJECT_LEVEL}>
          <TreeSectionButton
            expanded={projectExpanded}
            icon="folder"
            prominence="project"
            tabIndex={-1}
            selected={activeEnvironmentBelongsToProject && !projectExpanded}
            actions={
              <TreeRowActions>
                <Button
                  iconOnly
                  size="xs"
                  variant="ghost"
                  tabIndex={-1}
                  title={t("connections.addEnvironment")}
                  aria-label={t("connections.addEnvironment")}
                  onClick={() => setEnvironmentSetupProjectId(project.id)}
                >
                  <Icon name="plus" />
                </Button>
              </TreeRowActions>
            }
            onToggle={() => toggleExpandedId(setExpandedProjectIds, project.id)}
          >
            {project.name}
          </TreeSectionButton>
        </div>
        {projectExpanded ? (
          <div className="tw:grid tw:border-l tw:border-border-strong tw:pl-1">
            {project.environments.map((environment) => {
              const environmentExpanded = expandedEnvironmentIds.has(
                environment.id,
              );
              return (
                <div key={environment.id} className="tw:grid">
                  <div role="treeitem" aria-level={ENVIRONMENT_LEVEL}>
                    <TreeSectionButton
                      expanded={environmentExpanded}
                      icon="folder"
                      tabIndex={-1}
                      selected={
                        activeProjectEnvironmentId === environment.id &&
                        !environmentExpanded
                      }
                      trailing={
                        <EnvironmentBadge
                          environment={knowledgeEnvironmentBadge(
                            environment.riskClass,
                          )}
                        />
                      }
                      onToggle={() => {
                        toggleExpandedId(
                          setExpandedEnvironmentIds,
                          environment.id,
                        );
                        onOpenProjectEnvironment(environment.id, "databases");
                      }}
                    >
                      {environment.name}
                    </TreeSectionButton>
                  </div>
                  {environmentExpanded
                    ? renderEnvironmentResources(environment)
                    : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  function handleProjectCreated(project: KnowledgeProject) {
    const environment = project.environments[0] ?? null;
    setExpandedProjectIds((current) => new Set([...current, project.id]));
    if (!environment) return;
    setExpandedEnvironmentIds(
      (current) => new Set([...current, environment.id]),
    );
    setExpandedResourceKeys(
      (current) =>
        new Set([
          ...current,
          `${environment.id}:databases`,
        ]),
    );
    onOpenProjectEnvironment(environment.id, "databases");
  }

  function handleEnvironmentCreated(project: KnowledgeProject) {
    const previousEnvironmentIds = new Set(
      (knowledgeProjects.data ?? [])
        .find((candidate) => candidate.id === project.id)
        ?.environments.map((environment) => environment.id) ?? [],
    );
    const environment =
      project.environments.find(
        (candidate) => !previousEnvironmentIds.has(candidate.id),
      ) ?? project.environments[project.environments.length - 1] ?? null;
    setExpandedProjectIds((current) => new Set([...current, project.id]));
    if (!environment) return;
    setExpandedEnvironmentIds(
      (current) => new Set([...current, environment.id]),
    );
    setExpandedResourceKeys(
      (current) =>
        new Set([...current, `${environment.id}:databases`]),
    );
    onOpenProjectEnvironment(environment.id, "databases");
  }

  function openEnvironmentSetup() {
    const projects = knowledgeProjects.data ?? [];
    const focusedProject = projects.find(
      (project) => project.id === focusedProjectIdRef.current,
    );
    const activeProject = projects.find((project) =>
      project.environments.some(
        (environment) => environment.id === activeProjectEnvironmentId,
      ),
    );
    const projectId =
      focusedProject?.id ?? activeProject?.id ?? projects[0]?.id ?? null;
    if (projectId) setEnvironmentSetupProjectId(projectId);
  }

  const selectedConnection =
    connections.find((connection) => connection.id === selectedId) ?? null;

  function revealEditorObject() {
    if (!selectedConnection || !selectedTableKey) return;
    setGlobalFilter("");
    setSearchOpen(false);
    commands.openConnection(selectedConnection.id);
    ensureGroupLoaded(selectedConnection.id);
    setLocalRevealRequest((request) => request + 1);
  }

  function renderLaunchButton(
    label: string,
    preset: ConnectionLaunchPreset,
  ) {
    return (
      <ToolWindowAction
        leading={<EngineMark engine={preset.engine ?? "postgres"} />}
        trailing={<Icon name="chevronRight" />}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onNewConnection(preset);
        }}
      >
        {label}
      </ToolWindowAction>
    );
  }

  // The scroller only becomes the ARIA tree once it actually holds rows, so this
  // mirrors the three branches below that emit a `treeitem`: a Project list, the
  // Project-read failure row, and the driver-only tree that renders connections
  // flat while knowledge is off. Having connections is not enough — with
  // knowledge on and no Project, the `Unassigned` folder never renders and the
  // scroller would announce an empty tree with a dead Tab stop. The first-run
  // surface is a plain command list, not a tree.
  const explorerTreeReady =
    (knowledgeProjects.data?.length ?? 0) > 0 ||
    (knowledgeEnabled && knowledgeProjects.error !== null) ||
    (!knowledgeEnabled && unassignedSections.length > 0);

  return (
    <ToolWindowSideSurface
      compact={compact}
      compactOpen={compactOpen}
      id="workbench-sidebar"
    >
      <div
        className="tw:group tw:flex tw:min-h-control-md tw:shrink-0 tw:items-center tw:gap-[2px] tw:border-b tw:border-border-subtle tw:bg-background tw:px-1"
        role="toolbar"
        aria-label={t("connections.databaseExplorerActions")}
      >
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={knowledgeProjects.isPending}
          onClick={() => setProjectSetupOpen(true)}
          title={t("connections.addProject")}
          aria-label={t("connections.addProject")}
        >
          <Icon name="folderPlus" />
        </Button>
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={
            knowledgeProjects.isPending ||
            (knowledgeProjects.data?.length ?? 0) === 0
          }
          onClick={openEnvironmentSetup}
          title={t("connections.addEnvironment")}
          aria-label={t("connections.addEnvironment")}
        >
          <Icon name="plus" />
        </Button>
        <Button
          iconOnly
          size="xs"
          variant="ghost"
          disabled={
            knowledgeProjects.isFetching ||
            knowledgeSources.isFetching ||
            refreshing !== null
          }
          onClick={() => void refreshExplorer()}
          title={t("connections.refreshExplorer")}
          aria-label={t("connections.refreshExplorer")}
        >
          <Icon name="refresh" />
        </Button>
        <ToolbarMenu
          icon="view"
          label={t("connections.viewOptions")}
        >
          <ToolbarMenuItem
            icon="target"
            disabled={!selectedTableKey}
            onClick={revealEditorObject}
          >
            {t("connections.scrollFromEditor")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="chevronsRight"
            disabled={
              connections.length === 0 &&
              (knowledgeProjects.data?.length ?? 0) === 0
            }
            onClick={expandAllConnections}
          >
            {t("connections.expandAll")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="chevronsLeft"
            disabled={
              open.size === 0 &&
              expandedProjectIds.size === 0 &&
              expandedEnvironmentIds.size === 0 &&
              expandedResourceKeys.size === 0
            }
            onClick={collapseAllConnections}
          >
            {t("connections.collapseAll")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="search"
            disabled={connections.length === 0}
            onClick={openExplorerSearch}
          >
            {t("connections.filterTables")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon={showRowCounts ? "check" : "list"}
            onClick={() =>
              commands.patch({ showRowCounts: !showRowCounts })
            }
          >
            {t("connections.showRowCounts")}
          </ToolbarMenuItem>
        </ToolbarMenu>
        <span className="tw:pointer-events-none tw:ml-auto tw:opacity-0 tw:transition-opacity tw:group-hover:pointer-events-auto tw:group-hover:opacity-100 tw:group-focus-within:pointer-events-auto tw:group-focus-within:opacity-100">
          <ToolWindowHideButton
            label={t("common.close")}
            onClick={onClose}
          />
        </span>
      </div>
      {workspaceHeader}
      {connections.length > 0 && searchOpen ? (
        <ToolWindowSearchRow>
          <div className="tw:min-w-0 tw:flex-1">
            <TreeSearch
              value={globalFilter}
              placeholder={t("connections.filterTables")}
              clearLabel={t("common.close")}
              onChange={updateGlobalFilter}
              autoFocus
              onEscape={() => {
                if (globalFilter) {
                  setGlobalFilter("");
                  return;
                }
                setSearchOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSearchResult(1);
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSearchResult(-1);
                }
                if (
                  event.key === "Enter" &&
                  activeSearchResult?.kind === "relation" &&
                  activeSearchResult.table
                ) {
                  event.preventDefault();
                  const connection = connections.find(
                    (candidate) => candidate.id === activeSearchResult.connectionId,
                  );
                  if (connection) {
                    onOpenTable(
                      { ...connection, database: activeSearchResult.database },
                      activeSearchResult.table,
                    );
                  }
                }
              }}
            />
          </div>
          {globalFilter ? (
            <span
              className="tw:shrink-0 tw:px-1 tw:text-2xs tw:text-muted-foreground"
              aria-live="polite"
            >
              {t("connections.filterResultCount", {
                count: searchResults.length,
              })}
            </span>
          ) : null}
        </ToolWindowSearchRow>
      ) : null}

      <div
        ref={setTreeScrollElement}
        data-catalog-tree-scroll
        role={explorerTreeReady ? "tree" : undefined}
        aria-label={
          explorerTreeReady ? t("connections.explorerTree") : undefined
        }
        tabIndex={explorerTreeReady ? 0 : undefined}
        onKeyDown={onTreeKeyDown}
        className="tw:min-h-0 tw:flex-1 tw:overflow-x-hidden tw:overflow-y-auto tw:p-1 tw:[container-name:db-sidebar] tw:[container-type:inline-size] tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-ring tw:focus-visible:ring-inset"
      >
        {knowledgeEnabled && knowledgeProjects.isPending ? (
          <div className="tw:min-h-control-md tw:px-2 tw:py-1 tw:text-xs">
            <LoadingLabel>{t("connections.loadingProjects")}</LoadingLabel>
          </div>
        ) : null}
        {knowledgeEnabled && knowledgeProjects.error
          ? renderTreeQueryFailure(
              t("connections.projectLoadFailed"),
              knowledgeProjects.error,
              knowledgeProjects.isFetching,
              ROOT_LEVEL,
              () => void knowledgeProjects.refetch(),
            )
          : null}
        {knowledgeEnabled &&
        knowledgeProjects.isSuccess &&
        (knowledgeProjects.data?.length ?? 0) === 0 ? (
          <div className="tw:px-2 tw:py-3">
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
              {t("connections.projectSetupDescription")}
            </p>
          </div>
        ) : null}
        {knowledgeProjects.data?.map(renderProject)}

        {connections.length === 0 && !knowledgeEnabled ? (
          <div className="tw:grid tw:gap-5 tw:p-3">
            <ToolWindowSection title={t("connections.createDataSource")}>
              {renderLaunchButton("PostgreSQL", {
                engine: "postgres",
                source: "standard",
              })}
              {renderLaunchButton("MySQL / MariaDB", {
                engine: "mysql",
                source: "standard",
              })}
              {renderLaunchButton("SQLite", {
                engine: "sqlite",
                provider: "generic",
                source: "standard",
              })}
              {renderLaunchButton("MongoDB", {
                engine: "mongodb",
                source: "standard",
              })}
              <ToolWindowAction
                leading={<Icon name="moreVertical" />}
                trailing={<Icon name="chevronRight" />}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  onNewConnection();
                }}
              >
                {t("connections.allDataSources")}
              </ToolWindowAction>
            </ToolWindowSection>

            <ToolWindowSection
              title={t("connections.dataSourceFromCloudProvider")}
            >
              <ToolWindowAction
                leading={<Icon name="key" />}
                trailing={<Icon name="chevronRight" />}
                onClick={() =>
                  openProviderCredentials("gcpCloudSql")
                }
              >
                {t("connections.providerGcpCloudSql")}
              </ToolWindowAction>
            </ToolWindowSection>

            <ToolWindowSection title={t("connections.sampleDatabase")}>
              <ToolWindowAction
                leading={<EngineMark engine="sqlite" />}
                trailing={<Icon name="download" />}
                disabled={creatingDemo}
                onClick={onCreateDemoDatabase}
              >
                {creatingDemo
                  ? t("connections.demoCreating")
                  : t("connections.demoSqlite")}
              </ToolWindowAction>
            </ToolWindowSection>
          </div>
        ) : null}
        {knowledgeEnabled &&
        (knowledgeProjects.data?.length ?? 0) > 0 &&
        unassignedSections.length > 0 ? (
          <div className="tw:grid tw:pt-1">
            <div role="treeitem" aria-level={ROOT_LEVEL}>
              <TreeSectionButton
                expanded={expandedResourceKeys.has("unassigned")}
                icon="folder"
                tabIndex={-1}
                onToggle={() =>
                  toggleExpandedId(setExpandedResourceKeys, "unassigned")
                }
              >
                {t("connections.unassigned")}
              </TreeSectionButton>
            </div>
            {expandedResourceKeys.has("unassigned") ? (
              <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
                {unassignedSections.map((section) =>
                  section.kind === "group"
                    ? renderGroup(section.group, ROOT_LEVEL + 1)
                    : renderConnection(
                        section.connection,
                        true,
                        ROOT_LEVEL + 1,
                      ),
                )}
              </div>
            ) : null}
          </div>
        ) : !knowledgeEnabled ? (
          unassignedSections.map((section) =>
            section.kind === "group"
              ? renderGroup(section.group, ROOT_LEVEL)
              : renderConnection(section.connection, false, ROOT_LEVEL),
          )
        ) : null}
      </div>

      {workspaceAccount ? (
        <div className="ds-control-row tw:flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-2 tw:border-t tw:border-border-subtle tw:bg-background tw:p-2">
          {workspaceAccount}
        </div>
      ) : null}

      {projectSetupOpen ? (
        <ProjectSetupDialog
          catalogScopeKey={catalogScope.key}
          onClose={() => setProjectSetupOpen(false)}
          onCreated={handleProjectCreated}
        />
      ) : null}

      {environmentSetupProjectId ? (
        <EnvironmentSetupDialog
          projects={knowledgeProjects.data ?? []}
          preferredProjectId={environmentSetupProjectId}
          catalogScopeKey={catalogScope.key}
          onClose={() => setEnvironmentSetupProjectId(null)}
          onCreated={handleEnvironmentCreated}
        />
      ) : null}

      {dragPreview &&
        (() => {
          const conn =
            connections.find((connection) => connection.id === dragPreview.id) ??
            null;
          if (!conn) return null;
          return (
            <div
              className="tw:pointer-events-none tw:fixed tw:top-0 tw:left-0 tw:z-[var(--ds-z-popover)] tw:inline-flex tw:max-w-[min(280px,70vw)] tw:items-center tw:gap-2 tw:rounded-sm tw:border tw:border-border-strong tw:bg-popover tw:p-2 tw:text-ui tw:font-semibold tw:text-popover-foreground tw:shadow-popover"
              style={{
                transform: `translate3d(${Math.round(dragPreview.x + 12)}px, ${Math.round(dragPreview.y + 12)}px, 0)`,
              }}
            >
              <EngineMark engine={conn.engine} />
              <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {conn.name || t("app.unnamed")}
              </span>
            </div>
          );
        })()}

      {ddlDialog && (
        <DdlModal
          connection={ddlDialog.connection}
          table={ddlDialog.table}
          onClose={() => commands.patch({ ddlDialog: null })}
        />
      )}
      {workspaceDialog ? (
        <WorkspaceConnectionDialog
          connection={workspaceDialog.connection}
          mode={workspaceDialog.mode}
          onBound={onConnectionUpdated}
          onClose={() => commands.patch({ workspaceDialog: null })}
        />
      ) : null}
      {providerCredentialsOpen ? (
        <ProviderCredentialDialog
          initialProvider={providerCredentialsOpen}
          onClose={() => setProviderCredentialsOpen(null)}
          returnFocus={() => providerReturnFocusRef.current?.focus()}
        />
      ) : null}
    </ToolWindowSideSurface>
  );
}
