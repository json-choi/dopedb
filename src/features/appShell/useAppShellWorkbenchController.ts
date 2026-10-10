// Composition root for the shell workbench. Connection list, selected connection, route,
// safety policy, and open documents each invalidate the others, so this hook is their single
// writer and the per-concern sub-hooks it composes never write across that boundary.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { CatalogTable } from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useToast } from "../../components/Toast";
import { hasCapability, isDocumentEngine } from "../../lib/capabilities";
import { resetConnectionResourceQueries } from "../../lib/queryClient";
import {
  driversQuery,
  type CatalogScope,
} from "../../lib/queries";
import { buildConnectionSections } from "../../lib/schemaDiff";
import type { ConnectionProfile } from "../connections/domain";
import type { ConnectionLaunchPreset } from "../connections/presets";
import type { KnowledgeEnvironmentView } from "../knowledge/domain";
import { useGuidedDemoSetup } from "../onboarding/useGuidedDemoSetup";
import { connectionCanEnterWritePath } from "../safetySettings/policy";
import type { SqlDocument } from "../sqlDocuments/domain";
import { tauriSqlDocumentGateway } from "../sqlDocuments/tauriAdapter";
import type { SqlResolveMode } from "../queries/resolveMode";
import {
  persistedQueryDocument,
  queryDocument,
  stableDocument,
  tableDocument,
  type HistoryQueryTarget,
  type WorkbenchDocument,
} from "../workbench/domain";
import { publishWorkbenchDraft } from "../workbench/draftStore";
import { openTabScopeKey } from "../workbench/openTabs";
import { useWorkbenchDocuments } from "../workbench/useWorkbenchDocuments";
import { recordStartupMark } from "../runtime/tauriAdapter";
import {
  preloadSqlEditor,
  useAppRouteTransition,
  useActivitySeen,
  usePersistentSelectedConnection,
  useSqlEditorPreload,
} from "./navigationHooks";
import {
  changedConnectionRuntimeIds,
  useConnectionProfiles,
} from "./useConnectionProfiles";
import { useSafetySettings } from "./useSafetySettings";
import {
  connectionEditorDialogCommands,
  connectionEditorRoute,
  useConnectionCredentialRequests,
} from "./connectionEditorRoute";
import { useLaunchPresetBinding } from "./useLaunchPresetBinding";

export type EditingConnection = ConnectionProfile | "new" | null;

type WorkbenchControllerInput = {
  scope: CatalogScope;
  mobileExplorer: {
    open: boolean;
    setOpen: Dispatch<SetStateAction<boolean>>;
    focusMainAfterSelection: () => void;
  };
  activity: {
    unseen: number;
    markSeen: () => void;
  };
};

/** Owns the mutually dependent connection, route, policy, and document lifecycle. */
export function useAppShellWorkbenchController({
  scope,
  mobileExplorer,
  activity,
}: WorkbenchControllerInput) {
  const toast = useToast();
  const [creatingQuery, setCreatingQuery] = useState(false);
  const queryClient = useQueryClient();
  const {
    connections,
    setConnections,
    loaded: connectionsLoaded,
    loadError,
    refresh,
  } = useConnectionProfiles(scope.key);
  const [selectedId, setSelectedId] = usePersistentSelectedConnection();
  const { navigation, navigate, pending: routePending, startTransition: startRouteTransition } = useAppRouteTransition();
  const selectionRestoreMarked = useRef(false);
  const {
    safety,
    error: safetyError,
    refresh: refreshSafety,
    accept: acceptSafety,
    clear: clearSafety,
  } = useSafetySettings(selectedId);
  const selected =
    connections.find((connection) => connection.id === selectedId) ?? null;
  const mainRoute = navigation.route;
  const settingsOpen = navigation.kind === "settings";
  const settingsSection =
    navigation.kind === "settings" ? navigation.section : undefined;
  const workspaceAdminSection = navigation.kind === "workspaceAdmin" ? navigation.section : null;
  const schemaDiffGroupKey =
    mainRoute.kind === "schemaDiff" ? mainRoute.groupKey : null;
  const knowledgeEnvironmentFocus =
    mainRoute.kind === "knowledge" ? mainRoute.focus : null;
  const editorRoute = connectionEditorRoute(mainRoute, connections);
  const connectionPreset = editorRoute.preset;
  const bindLaunchedConnection = useLaunchPresetBinding(connectionPreset);
  const editorDialogs = connectionEditorDialogCommands(navigation, navigate);
  useConnectionCredentialRequests(connections, editConnection);

  useEffect(() => {
    if (!connectionsLoaded || selectionRestoreMarked.current) return;
    selectionRestoreMarked.current = true;
    void recordStartupMark(
      "selected_connection_restored",
      loadError === null,
    ).catch(() => undefined);
  }, [connectionsLoaded, loadError]);

  const schemaGroups = useMemo(
    () =>
      buildConnectionSections(connections).flatMap((section) =>
        section.kind === "group" &&
        !isDocumentEngine(section.group.connections[0]?.engine)
          ? [section.group]
          : [],
      ),
    [connections],
  );
  const activeSchemaGroup =
    schemaGroups.find((group) => group.key === schemaDiffGroupKey) ?? null;
  const drivers = useQuery(driversQuery());
  const supportsSql =
    !selected ||
    (drivers.data
      ? hasCapability(drivers.data, selected, "sql")
      : !isDocumentEngine(selected.engine));
  const workbench = useWorkbenchDocuments({
    selectedConnectionId: selected?.id ?? null,
    selectedConnectionDatabase: selected?.database ?? null,
    supportsSql,
    sqlDocuments: tauriSqlDocumentGateway,
    openTabScope: openTabScopeKey(scope),
    onRestoreError: (error) => {
      console.error("could not restore SQL documents:", error);
    },
    onError: (message) => toast(message, "error"),
  });
  const { selectedDocuments, activeDocument, activeDocumentId } = workbench;
  const selectedTable =
    activeDocument?.kind === "data" ? activeDocument.table : null;

  useSqlEditorPreload(selected?.id ?? null, supportsSql);
  useActivitySeen(activeDocument?.kind ?? null, activity.unseen, activity.markSeen);

  useEffect(() => {
    if (schemaDiffGroupKey && !activeSchemaGroup) {
      navigate({
        type: "schemaGroupUnavailable",
        groupKey: schemaDiffGroupKey,
      });
    }
  }, [activeSchemaGroup, navigate, schemaDiffGroupKey]);

  async function reloadWorkspaceScope() {
    setSelectedId(null);
    workbench.reset();
    navigate({ type: "workspaceScopeChanged" });
    clearSafety();
  }

  async function refreshWorkspaceData() {
    const previous = connections;
    const next = await refresh();
    if (!next) return;
    const changedIds = changedConnectionRuntimeIds(previous, next);
    await resetConnectionResourceQueries(queryClient, changedIds);
  }

  function showWorkbench() {
    navigate({ type: "showWorkbench" });
  }

  const guidedDemo = useGuidedDemoSetup({
    scope,
    connections,
    refreshConnections: refresh,
    selectConnection: setSelectedId,
    showWorkbench,
  });

  function openKnowledge(
    environmentId: string | null,
    view: KnowledgeEnvironmentView,
    resourceId: string | null = null,
  ) {
    if (environmentId === null && view === "databases") {
      showWorkbench();
      return;
    }
    navigate({
      type: "openKnowledge",
      focus: {
        environmentId,
        view,
        resourceId,
        requestId: Date.now(),
      },
    });
  }

  function startNewConnection(preset?: ConnectionLaunchPreset) {
    navigate({
      type: "openConnectionEditor",
      target: { kind: "new", preset: preset ?? null },
    });
    mobileExplorer.setOpen(false);
    mobileExplorer.focusMainAfterSelection();
  }

  /** `initialFocus` opens the editor to re-enter a credential this device lost. */
  function editConnection(
    connection: ConnectionProfile,
    initialFocus?: "credentials",
  ) {
    navigate({
      type: "openConnectionEditor",
      target: { kind: "existing", connectionId: connection.id, initialFocus },
    });
  }

  function selectConnection(id: string) {
    const connection = connections.find((candidate) => candidate.id === id);
    const initial =
      connection && isDocumentEngine(connection.engine)
        ? queryDocument(id, "documents")
        : stableDocument(id, "welcome");
    workbench.prime(initial, true);
    setSelectedId(id);
    showWorkbench();
    mobileExplorer.setOpen(false);
    mobileExplorer.focusMainAfterSelection();
  }

  function activateDocument(document: WorkbenchDocument, closeMobileExplorer = true) {
    const reveal = () => {
      workbench.activate(document);
      showWorkbench();
    };
    if (selectedId === document.connectionId) startRouteTransition(reveal);
    else reveal();
    if (closeMobileExplorer) {
      mobileExplorer.setOpen(false);
      if (mobileExplorer.open) mobileExplorer.focusMainAfterSelection();
    }
  }

  function openTable(connection: ConnectionProfile, table: CatalogTable) {
    const document = tableDocument(connection.id, table);
    if (selectedId !== connection.id) {
      workbench.prime(document);
      setSelectedId(connection.id);
    }
    activateDocument(document);
  }

  function openStableDocument(
    kind: "schema" | "activity" | "results",
    closeMobileExplorer = true,
  ) {
    if (!selected) return;
    activateDocument(
      stableDocument(selected.id, kind),
      closeMobileExplorer,
    );
  }

  async function openQueryDocument() {
    if (!selected || creatingQuery) return;
    setCreatingQuery(true);
    preloadSqlEditor();
    try {
      const document = await workbench.openQuery({
        connectionId: selected.id,
        // A console opened on an Explorer selection starts in that object's target.
        database: selectedTable?.database ?? selected.database,
        selectedSchema: selectedTable?.schema ?? null,
        supportsSql,
      });
      activateDocument(document);
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setCreatingQuery(false);
    }
  }

  async function loadSql(sql: string, target: HistoryQueryTarget) {
    if (!selected || creatingQuery) return;
    setCreatingQuery(true);
    try {
      const document = await workbench.openQuery({
        connectionId: selected.id,
        database: target.database ?? selected.database,
        selectedSchema: target.schema,
        supportsSql,
        title: target.title,
        content: sql,
      });
      activateDocument(document);
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setCreatingQuery(false);
    }
  }

  async function closeDocument(id: string) {
    if (!selected) return;
    try {
      await workbench.close(id, selected.id, supportsSql);
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  function openSavedDocument(document: SqlDocument) {
    if (!selected || String(document.connectionId) !== selected.id) return;
    activateDocument(persistedQueryDocument(document));
  }

  function setActiveQueryTitle(value: string) {
    if (activeDocument?.kind === "sql") {
      workbench.updateTitle(activeDocument.id, value);
    }
  }

  function setActiveQuerySchema(value: string | null) {
    if (activeDocument?.kind === "sql") {
      workbench.updateSelectedSchema(activeDocument.id, value);
    }
  }

  function setActiveQueryDatabase(value: string) {
    if (activeDocument?.kind === "sql") {
      workbench.updateSelectedDatabase(activeDocument.id, value);
    }
  }

  function setActiveQueryResolveMode(value: SqlResolveMode) {
    if (activeDocument?.kind === "sql") {
      workbench.updateResolveMode(activeDocument.id, value);
    }
  }

  function applySavedQuery(saved: SqlDocument) {
    if (activeDocument?.kind === "sql") {
      workbench.applyPersisted(activeDocument.id, saved);
    }
  }

  async function connectionSaved(
    profile: ConnectionProfile,
    closeEditor: boolean,
  ) {
    const previous = connections.find(
      (connection) => connection.id === profile.id,
    );
    // Publish the saved profile at once. The authoritative list refresh, the
    // cache reset, and Project read refreshes run in the background, so the
    // editor reports completion as soon as the save and its binding succeed.
    setConnections((current) =>
      current.some((connection) => connection.id === profile.id)
        ? current.map((connection) =>
            connection.id === profile.id ? profile : connection,
          )
        : [...current, profile],
    );
    if (
      previous &&
      changedConnectionRuntimeIds([previous], [profile]).length > 0
    ) {
      // Saving retires the connection's live pools. Every Explorer, table, and
      // safety read made through the previous endpoint, credential, or scope
      // is stale, including the infinite-staleTime database catalogs.
      void resetConnectionResourceQueries(queryClient, [profile.id]).catch(
        () => undefined,
      );
    }
    void refresh().catch(() => undefined);
    await bindLaunchedConnection(profile);
    setSelectedId(profile.id);
    if (closeEditor) showWorkbench();
  }

  async function deletedConnection(id: string) {
    const remaining = await refresh();
    if (selectedId === id) {
      setSelectedId(null);
      workbench.reset();
    }
    navigate({ type: "connectionDeleted", connectionId: id, remainingConnections: remaining?.length });
  }

  function updateConnection(updated: ConnectionProfile) {
    setConnections((current) =>
      current.map((connection) =>
        connection.id === updated.id ? updated : connection,
      ),
    );
  }

  function activate(document: WorkbenchDocument) {
    activateDocument(document);
  }

  return {
    route: {
      pending: routePending,
      welcomeOpen: mainRoute.kind === "welcome",
      settingsOpen,
      settingsSection,
      workspaceAdminSection,
      schemaDiffGroupKey,
      activeSchemaGroup,
      knowledgeEnvironmentFocus,
      editing: editorRoute.editing,
      editorInitialFocus: editorRoute.initialFocus,
      connectionPreset,
    },
    connections: {
      items: connections,
      selected,
      selectedId,
      loaded: connectionsLoaded,
      loadError,
      supportsSql,
      creatingDemo: guidedDemo.creating,
    },
    safety: {
      value: safety,
      error: safetyError,
      writeEnabled: Boolean(
        selected &&
          safety?.allowWrites &&
          connectionCanEnterWritePath(selected),
      ),
    },
    documents: {
      items: selectedDocuments,
      active: activeDocument,
      activeId: activeDocumentId,
      selectedTable,
      restoring: workbench.restoring,
      creatingQuery,
    },
    commands: {
      route: {
        showWorkbench,
        showWelcome: () => {
          navigate({ type: "showWelcome" });
          mobileExplorer.setOpen(false);
          mobileExplorer.focusMainAfterSelection();
        },
        closeSettings: () => navigate({ type: "closeSettings" }),
        openSettings: editorDialogs.openSettings,
        closeWorkspaceAdmin: () => navigate({ type: "closeWorkspaceAdmin" }),
        openWorkspaceAdmin: editorDialogs.openWorkspaceAdmin,
        focusToolWindow: () => navigate({ type: "focusToolWindow" }),
        openKnowledge,
        openSchemaDiff: (groupKey: string) =>
          navigate({ type: "openSchemaDiff", groupKey }),
      },
      connections: {
        reloadWorkspaceScope,
        refreshWorkspaceData,
        retry: () => void refresh(),
        new: startNewConnection,
        edit: editConnection,
        select: selectConnection,
        save: connectionSaved,
        delete: deletedConnection,
        update: updateConnection,
        createDemo: () => void guidedDemo.create(),
      },
      safety: {
        refresh: refreshSafety,
        accept: acceptSafety,
      },
      documents: {
        activate,
        activateId: (id: string) => startRouteTransition(() => workbench.activateId(id)),
        rename: workbench.updateTitle,
        close: closeDocument,
        openSaved: openSavedDocument,
        newQuery: () => void openQueryDocument(),
        openQuery: openQueryDocument,
        openTable,
        openResults: (connectionId: string) => {
          if (!connections.some((connection) => connection.id === connectionId)) return;
          const document = stableDocument(connectionId, "results");
          if (selectedId !== connectionId) {
            workbench.prime(document);
            setSelectedId(connectionId);
          }
          activateDocument(document);
        },
        openStable: openStableDocument,
        restoreDraft: publishWorkbenchDraft,
        setTitle: setActiveQueryTitle,
        setDatabase: setActiveQueryDatabase,
        setSchema: setActiveQuerySchema,
        setResolveMode: setActiveQueryResolveMode,
        persisted: applySavedQuery,
        loadSql,
      },
    },
  };
}
