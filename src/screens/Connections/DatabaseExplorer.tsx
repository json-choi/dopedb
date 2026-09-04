// Database Explorer sidebar: connection tree, DDL modal, schema-group
// drag-and-drop. Split out of the old Connections/index.tsx (see ConnectionForm.tsx
// for the connection create/edit form that used to live alongside it).
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import {
  connectionAccessIssue,
  type ConnectionProfile,
} from "../../features/connections/domain";
import type { ConnectionLaunchPreset } from "../../features/connections/presets";
import type { ProviderKind } from "../../features/providers/domain";
import type {
  EnvironmentConnection,
  KnowledgeEnvironmentView,
} from "../../features/knowledge/domain";
import {
  projectConnectionAssignment,
  projectDatabasesDropTargets,
  projectResourceKey,
  toggledResourceKeys,
} from "../../features/catalogExplorer/projectResources";
import {
  catalogLoadIssue,
  type CatalogLoadIssue,
} from "../../features/catalogExplorer/catalogDomain";
import { useCatalogExplorerState } from "../../features/catalogExplorer/state";
import { useSchemaGroupDrag } from "../../features/catalogExplorer/useSchemaGroupDrag";
import { useProjectDatabaseOrder } from "../../features/catalogExplorer/useProjectDatabaseOrder";
import { useCatalogScope } from "../../lib/queries";
import {
  buildConnectionSections,
  type SchemaConnectionGroup,
} from "../../lib/schemaDiff";
import { LoadingLabel } from "../../design-system/components/Status";
import { ToolWindowSideSurface } from "../../design-system/components/ToolWindow";
import {
  TreeSectionButton,
} from "../../design-system/components/TreeControls";
import { useTreeKeyboardNavigation } from "../../design-system/treeKeyboard";
import { useI18n } from "../../lib/i18n";
import ConnectionNode from "./ConnectionNode";
import { useCatalogTree } from "./useCatalogTree";
import { KnowledgeProjectTree } from "./KnowledgeProjectTree";
import { DatabaseExplorerToolbar } from "./DatabaseExplorerToolbar";
import { useDatabaseExplorerKnowledge } from "./useDatabaseExplorerKnowledge";
import { DatabaseExplorerOverlays } from "./DatabaseExplorerOverlays";
import { DatabaseExplorerEmptyState } from "./DatabaseExplorerEmptyState";
import { useDatabaseExplorerSearch } from "./useDatabaseExplorerSearch";
import { SchemaConnectionGroupRow } from "./SchemaConnectionGroupRow";
import { useDatabaseExplorerMutations } from "../../features/catalogExplorer/useDatabaseExplorerMutations";
import { useCatalogExplorerLoading } from "../../features/catalogExplorer/useCatalogExplorerLoading";
import { useProjectExplorerActions } from "../../features/catalogExplorer/useProjectExplorerActions";

// Database Explorer: connections in the sidebar, the selected one
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
  const catalogScope = useCatalogScope();
  const {
    enabled: knowledgeEnabled,
    sharedWorkspace: sharedKnowledgeWorkspace,
    projects: knowledgeProjects,
    sources: knowledgeSources,
    sourcesPhase: knowledgeSourcesPhase,
    projectEnvironmentIds,
    environmentConnections,
    environmentConnectionsPhase,
    environmentConnectionsById,
    retryBindings,
    retrySources,
    analysisFilter,
    setAnalysisFilter,
    expandedProjectIds,
    setExpandedProjectIds,
    expandedResourceKeys,
    setExpandedResourceKeys,
    analysisQueries: environmentAnalysisQueries,
  } = useDatabaseExplorerKnowledge({
    catalogScope,
    activeEnvironmentId: activeProjectEnvironmentId,
    activeEnvironmentView: activeProjectEnvironmentView,
  });
  const projectDatabaseOrder = useProjectDatabaseOrder(
    catalogScope,
    knowledgeProjects.data,
    environmentConnections.data,
    connections,
  );
  const [projectSetupOpen, setProjectSetupOpen] = useState(false);
  const [environmentSetupProjectId, setEnvironmentSetupProjectId] =
    useState<string | null>(null);
  const [treeScrollElement, setTreeScrollElement] =
    useState<HTMLDivElement | null>(null);
  const treeRootRef = useRef<HTMLDivElement>(null);
  const treeKeyboard = useTreeKeyboardNavigation(treeRootRef);
  const {
    filter: globalFilter,
    setFilter: setGlobalFilter,
    open: searchOpen,
    openSearch: openExplorerSearch,
    close: closeExplorerSearch,
    results: searchResults,
    activeResult: activeSearchResult,
    activeResultKey: activeSearchResultKey,
    onResultsChange: onSearchResultsChange,
    move: moveSearchResult,
  } = useDatabaseExplorerSearch(treeKeyboard.restoreFocus);
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

  const environmentBindingsReady = environmentConnections.isSuccess;
  const { unassignedConnections, unassignedConnectionIds } =
    projectConnectionAssignment(
      connections,
      knowledgeProjects.isSuccess && environmentBindingsReady,
      environmentConnectionsById,
    );
  const unassignedSections = buildConnectionSections(unassignedConnections);
  const environmentDropTargets = projectEnvironmentIds.map(
    (environmentId) => ({
      id: environmentId,
      accepting: environmentConnections.isSuccess,
      connectionIds: new Set(
        (environmentConnectionsById.get(environmentId) ?? []).flatMap(
          (binding) => (binding.connectionId ? [binding.connectionId] : []),
        ),
      ),
    }),
  );
  const projectDatabaseDropTargets = projectDatabasesDropTargets(
    knowledgeProjects.data ?? [],
    activeProjectEnvironmentId,
    environmentConnections.isSuccess,
    environmentConnectionsById,
  );

  function openProviderCredentials(provider: ProviderKind) {
    providerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setProviderCredentialsOpen(provider);
  }
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
  const {
    ensureLoaded,
    retryOverview,
    connectionRecoveryProps,
  } = useCatalogExplorerLoading(catalogScope, commands);
  const {
    deletingProjectId,
    savingScopeId,
    unbindingBindingId,
    bindDroppedConnection,
    refreshSchema,
    refreshExplorer,
    removeConnection,
    removeEnvironmentConnection,
    removeProject,
    setSchemaScope,
  } = useDatabaseExplorerMutations({
    catalogScope,
    projects: knowledgeProjects.data ?? [],
    activeProjectEnvironmentId,
    environmentSetupProjectId,
    setEnvironmentSetupProjectId,
    setExpandedProjectIds,
    setExpandedResourceKeys,
    commands,
    forgetConnection,
    onDeleted,
    onConnectionUpdated,
    onOpenProjectEnvironment,
  });
  const {
    openCreatedProject,
    openCreatedEnvironment,
    openEnvironmentSetup,
  } = useProjectExplorerActions({
    projects: knowledgeProjects.data ?? [],
    activeEnvironmentId: activeProjectEnvironmentId,
    setEnvironmentSetupProjectId,
    setExpandedProjectIds,
    setExpandedResourceKeys,
    onOpenProjectEnvironment,
  });
  const {
    groupByConnectionId,
    draggingIds,
    dropTarget,
    dragPreview,
    suppressClickRef,
    pointerDown: pointerDownConnection,
    pointerMove: pointerMoveConnection,
    pointerUp: pointerUpConnection,
    pointerCancel: pointerCancelConnection,
  } = useSchemaGroupDrag(connections, onConnectionUpdated, {
    environmentTargets: environmentDropTargets,
    projectDatabasesTargets: projectDatabaseDropTargets,
    unassignedConnectionIds,
    onDropOnEnvironment: bindDroppedConnection,
    onReorderProjectDatabase: projectDatabaseOrder.reorder,
  });
  const errs: Record<string, CatalogLoadIssue> = { ...overviewErrs };
  for (const [connectionId, message] of Object.entries(refreshErrs)) {
    errs[connectionId] = catalogLoadIssue(message);
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
    const projectIds = (knowledgeProjects.data ?? []).map(
      (project) => project.id,
    );
    setExpandedProjectIds(new Set(projectIds));
    setExpandedResourceKeys(
      new Set(
        ["unassigned", ...projectIds.flatMap((projectId) => [
          projectResourceKey(projectId, "databases"),
          projectResourceKey(projectId, "sources"),
          projectResourceKey(projectId, "analyses"),
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
    setExpandedResourceKeys(new Set());
    commands.patch({
      openConnections: new Set(),
      wanted: new Set(),
      objectSectionsOpen: new Set(),
    });
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
    nested = false,
    treeParentKey: string | null = null,
    treeLevel = 1,
    environmentBadge?: string | null,
    environmentDropId?: string,
    treeKey?: string,
    binding?: EnvironmentConnection,
  ) {
    const schemaGroup = groupByConnectionId.get(connection.id);
    const databaseOrder = binding
      ? projectDatabaseOrder.dragContext(binding)
      : undefined;
    const openConnectionSchemaDiff =
      schemaGroup && schemaGroup.connections.length > 1
        ? () => {
            for (const member of schemaGroup.connections) {
              ensureLoaded(member.id);
            }
            onOpenSchemaDiff(schemaGroup);
          }
        : undefined;
    return (
      <ConnectionNode
        key={treeKey ?? connection.id}
        connection={connection}
        environmentBadge={environmentBadge}
        environmentDropId={environmentDropId}
        projectDatabaseOrder={databaseOrder}
        treeKey={treeKey}
        nested={nested}
        selected={connection.id === selectedId}
        selectedTableKey={selectedTableKey}
        expanded={open.has(connection.id) || globalFilter.trim().length > 0}
        draggingIds={draggingIds}
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
        onMoveProjectDatabase={
          databaseOrder
            ? (direction) => projectDatabaseOrder.move(databaseOrder, direction)
            : undefined
        }
        onToggleOpen={() => toggleOpen(connection.id)}
        onSelect={() => onSelectConn(connection.id)}
        onEdit={() => onEdit(connection)}
        onWorkspaceDialog={(mode) =>
          commands.openWorkspaceDialog({ connection, mode })
        }
        onRefresh={() => void refreshSchema(connection.id)}
        onDelete={() => void removeConnection(connection)}
        onUnbind={
          binding
            ? () => void removeEnvironmentConnection(binding)
            : undefined
        }
        unbinding={binding?.id === unbindingBindingId}
        onOpenSchemaDiff={openConnectionSchemaDiff}
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
        onRetryOverview={(database) =>
          retryOverview(connection.id, database)
        }
        {...connectionRecoveryProps(connection, () => {
          void refreshSchema(connection.id);
        })}
        onToggleRelationSection={(sectionKey) =>
          toggleRelationSection(connection.id, sectionKey)
        }
        onToggleObjectSection={(kind) =>
          toggleObjectSection(connection.id, kind)
        }
        revealRequest={externalRevealRequest + localRevealRequest}
        revealDatabase={revealDatabase}
        revealNamespace={revealNamespace}
        treeParentKey={treeParentKey}
        treeLevel={treeLevel}
      />
    );
  }

  function renderGroup(group: SchemaConnectionGroup) {
    return (
      <SchemaConnectionGroupRow
        key={`group-${group.key}`}
        group={group}
        activeGroupKey={activeSchemaGroupKey}
        dropTarget={dropTarget?.kind === "group" && dropTarget.key === group.key}
        catalogs={catalogs}
        onEnsureLoaded={ensureLoaded}
        onOpenSchemaDiff={onOpenSchemaDiff}
        renderConnection={(connection, treeParentKey) =>
          renderConnection(connection, true, treeParentKey, 2)
        }
      />
    );
  }

  const selectedConnection =
    connections.find((connection) => connection.id === selectedId) ?? null;

  function revealEditorObject() {
    if (!selectedConnection || !selectedTableKey) return;
    setGlobalFilter("");
    closeExplorerSearch();
    commands.openConnection(selectedConnection.id);
    ensureGroupLoaded(selectedConnection.id);
    setLocalRevealRequest((request) => request + 1);
  }


  return (
    <ToolWindowSideSurface
      compact={compact}
      compactOpen={compactOpen}
      id="workbench-sidebar"
    >
      <DatabaseExplorerToolbar
        connections={connections}
        projectCount={knowledgeProjects.data?.length ?? 0}
        projectsPending={knowledgeProjects.isPending}
        projectsFetching={knowledgeProjects.isFetching}
        sourcesFetching={knowledgeSources.isFetching}
        refreshing={refreshing !== null}
        searchOpen={searchOpen}
        globalFilter={globalFilter}
        searchResults={searchResults}
        activeSearchResult={activeSearchResult}
        activeEnvironmentId={activeProjectEnvironmentId}
        activeEnvironmentView={activeProjectEnvironmentView}
        analysisFilter={analysisFilter}
        selectedTableKey={selectedTableKey}
        showRowCounts={showRowCounts}
        hasExpandedItems={
          open.size > 0 ||
          expandedProjectIds.size > 0 ||
          expandedResourceKeys.size > 0
        }
        workspaceHeader={workspaceHeader}
        onAddProject={() => setProjectSetupOpen(true)}
        onAddEnvironment={openEnvironmentSetup}
        onRefresh={() => void refreshExplorer(selectedId)}
        onOpenSearch={openExplorerSearch}
        onCloseSearch={closeExplorerSearch}
        onFilterChange={setGlobalFilter}
        onMoveSearchResult={moveSearchResult}
        onOpenSearchResult={(result) => {
          if (!result.table) return;
          const connection = connections.find(
            (candidate) => candidate.id === result.connectionId,
          );
          if (!connection) return;
          onOpenTable(
            { ...connection, database: result.database },
            result.table,
          );
        }}
        onFocusSearchResult={treeKeyboard.focusKey}
        onRevealEditorObject={revealEditorObject}
        onExpandAll={expandAllConnections}
        onCollapseAll={collapseAllConnections}
        onToggleRowCounts={() =>
          commands.patch({ showRowCounts: !showRowCounts })
        }
        onAnalysisFilterChange={setAnalysisFilter}
        onClose={onClose}
      />

      <div
        ref={setTreeScrollElement}
        data-catalog-tree-scroll
        className="tw:min-h-0 tw:flex-1 tw:overflow-x-hidden tw:overflow-y-auto tw:p-1 tw:[container-name:db-sidebar] tw:[container-type:inline-size]"
      >
        {knowledgeEnabled && knowledgeProjects.isPending ? (
          <div className="tw:min-h-control-md tw:px-2 tw:py-1 tw:text-xs">
            <LoadingLabel>{t("connections.loadingProjects")}</LoadingLabel>
          </div>
        ) : null}
        {knowledgeEnabled && knowledgeProjects.error ? (
          <p
            className="tw:m-0 tw:px-2 tw:py-1 tw:text-xs tw:text-danger"
            role="alert"
          >
            {errMessage(knowledgeProjects.error)}
          </p>
        ) : null}
        {knowledgeEnabled &&
        knowledgeProjects.isSuccess &&
        (knowledgeProjects.data?.length ?? 0) === 0 ? (
          <div className="tw:px-2 tw:py-3">
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">
              {t("connections.projectSetupDescription")}
            </p>
          </div>
        ) : null}
        {connections.length === 0 ? (
          <DatabaseExplorerEmptyState
            creatingDemo={creatingDemo}
            onNewConnection={onNewConnection}
            onOpenProviderCredentials={openProviderCredentials}
            onCreateDemoDatabase={onCreateDemoDatabase}
          />
        ) : null}
        <div
          ref={treeRootRef}
          role="tree"
          aria-label={t("connections.databaseExplorer")}
          onFocusCapture={treeKeyboard.onFocusCapture}
          onKeyDown={treeKeyboard.onKeyDown}
        >
          {knowledgeProjects.data?.map((project) => (
            <KnowledgeProjectTree
              key={project.id}
              project={project}
              connections={connections}
              projectEnvironmentIds={projectEnvironmentIds}
              environmentConnections={environmentConnections.data}
              environmentConnectionsError={environmentConnections.error}
              environmentConnectionsPhase={environmentConnectionsPhase}
              sources={knowledgeSources.data}
              sourcesError={knowledgeSources.error}
              sourcesPhase={knowledgeSourcesPhase}
              analysisQueries={environmentAnalysisQueries}
              sharedWorkspace={sharedKnowledgeWorkspace}
              expanded={expandedProjectIds.has(project.id)}
              expandedResourceKeys={expandedResourceKeys}
              deleting={deletingProjectId !== null}
              unbindingBindingId={unbindingBindingId}
              dropTargetEnvironmentId={
                dropTarget?.kind === "environment" ? dropTarget.id : null
              }
              dropTargetProjectId={
                dropTarget?.kind === "projectDatabases"
                  ? dropTarget.projectId
                  : null
              }
              activeEnvironmentId={activeProjectEnvironmentId}
              activeView={activeProjectEnvironmentView}
              activeResourceId={activeProjectEnvironmentResourceId}
              analysisFilter={analysisFilter}
              databaseBindingOrder={projectDatabaseOrder.bindingOrder(project.id)}
              renderConnection={renderConnection}
              onToggleProject={() =>
                setExpandedProjectIds((current) =>
                  toggledResourceKeys(current, project.id),
                )
              }
              onToggleResource={(resourceKey) =>
                setExpandedResourceKeys((current) =>
                  toggledResourceKeys(current, resourceKey),
                )
              }
              onAddEnvironment={() => setEnvironmentSetupProjectId(project.id)}
              onDeleteProject={() => void removeProject(project)}
              onOpenEnvironment={onOpenProjectEnvironment}
              onNewConnection={(projectEnvironmentId) =>
                onNewConnection({ projectEnvironmentId })
              }
              onRetryBindings={() => void retryBindings()}
              onRetrySources={() => void retrySources()}
              onRemoveBinding={(binding) =>
                void removeEnvironmentConnection(binding)
              }
            />
          ))}
          {knowledgeEnabled &&
          (knowledgeProjects.data?.length ?? 0) > 0 &&
          unassignedSections.length > 0 ? (
            <div className="tw:grid tw:pt-1">
              <TreeSectionButton
                expanded={expandedResourceKeys.has("unassigned")}
                icon="folder"
                treeItem={{
                  key: "resource:unassigned",
                  parentKey: null,
                  level: 1,
                }}
                onToggle={() =>
                  setExpandedResourceKeys((current) =>
                    toggledResourceKeys(current, "unassigned"),
                  )
                }
              >
                {t("connections.unassigned")}
              </TreeSectionButton>
              {expandedResourceKeys.has("unassigned") ? (
                <div className="tw:grid tw:border-l tw:border-border-subtle tw:pl-1">
                  {unassignedSections.map((section) =>
                    section.kind === "group"
                      ? renderGroup(section.group)
                      : renderConnection(
                          section.connection,
                          true,
                          "resource:unassigned",
                          2,
                        ),
                  )}
                </div>
              ) : null}
            </div>
          ) : !knowledgeEnabled ? (
            unassignedSections.map((section) =>
              section.kind === "group"
                ? renderGroup(section.group)
                : renderConnection(section.connection),
            )
          ) : null}
        </div>
      </div>

      <DatabaseExplorerOverlays
        workspaceAccount={workspaceAccount}
        catalogScopeKey={catalogScope.key}
        projects={knowledgeProjects.data ?? []}
        projectSetupOpen={projectSetupOpen}
        environmentSetupProjectId={environmentSetupProjectId}
        dragPreview={dragPreview}
        orderAnnouncement={projectDatabaseOrder.announcement}
        connections={connections}
        ddlDialog={ddlDialog}
        workspaceDialog={workspaceDialog}
        providerCredentialsOpen={providerCredentialsOpen}
        providerReturnFocusRef={providerReturnFocusRef}
        onProjectCreated={openCreatedProject}
        onEnvironmentCreated={openCreatedEnvironment}
        onCloseProjectSetup={() => setProjectSetupOpen(false)}
        onCloseEnvironmentSetup={() => setEnvironmentSetupProjectId(null)}
        onConnectionUpdated={onConnectionUpdated}
        onCloseDdl={() => commands.patch({ ddlDialog: null })}
        onCloseWorkspaceDialog={() =>
          commands.patch({ workspaceDialog: null })
        }
        onCloseProviderCredentials={() => setProviderCredentialsOpen(null)}
      />
    </ToolWindowSideSurface>
  );
}
