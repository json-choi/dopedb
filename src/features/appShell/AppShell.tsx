// Desktop workbench shell composes workspace, tool-window, search, and Agent controllers.
import { useCallback, useState } from "react";

import { ToastProvider, useToast } from "../../components/Toast";
import { errMessage } from "../../ipc/types";
import ActionSearch from "../actionSearch/ActionSearch";
import { useActionSearchDialog } from "../actionSearch/useActionSearchDialog";
import { useActionSearchItems } from "../actionSearch/useActionSearchItems";
import type { BackgroundTask } from "../backgroundTasks/domain";
import { useBackgroundTasks } from "../backgroundTasks/useBackgroundTasks";
import type { AgentComposerRequest } from "../agents/domain";
import { ArticleLinkGate } from "../analysisArticles/ArticleLinkGate";
import { ExternalAgentRequestGate } from "../agents/ExternalAgentRequestGate";
import { useGuidedDemoCommands } from "../onboarding/useGuidedDemoCommands";
import { useQueryServices } from "../queryServices/useQueryServices";
import SkillStartupGate from "../skills/SkillStartupGate";
import { useSkillStartupObserver } from "../skills/useSkillStartupObserver";
import {
  useWorkspaceManualTransactions,
  type WorkspaceManualTransaction,
} from "../queries/useWorkspaceManualTransactions";
import { useI18n } from "../../lib/i18n";
import { OperationActivityProvider, useOperationActivity } from "../../lib/operationActivity";
import { useCatalogScope } from "../../lib/queries";
import { useWorkspaceResourceQueryRecovery } from "../../lib/queryClient";
import { useAppUpdater } from "../updater/useAppUpdater";
import ShellLayout from "./ShellLayout";
import WorkbenchContent from "./WorkbenchContent";
import { useOperationNudge } from "./useOperationNudge";
import { useResponsiveShell } from "./useResponsiveShell";
import { useSidebarWidth } from "./useSidebarWidth";
import { useAgentDock } from "./useAgentDock";
import { useToolWindowLayout } from "./useToolWindowLayout";
import { useAppShellWorkbenchController } from "./useAppShellWorkbenchController";
import { useConnectionProjectNames } from "./useConnectionProjectNames";

export default function App() {
  return (
    <ToastProvider>
      <OperationActivityProvider>
        <Shell />
      </OperationActivityProvider>
    </ToastProvider>
  );
}

function Shell() {
  const { t } = useI18n();
  const toast = useToast();
  const catalogScope = useCatalogScope();
  useWorkspaceResourceQueryRecovery(catalogScope.key, catalogScope.ready);
  const activity = useOperationActivity();
  useSkillStartupObserver();

  const toolWindows = useToolWindowLayout();
  const {
    viewportWidth,
    compact: compactShell,
    mobileExplorerOpen,
    setMobileExplorerOpen,
    mainRef,
    dismissMobileExplorer,
    focusMainAfterMobileSelection,
  } = useResponsiveShell();
  const agentDock = useAgentDock();
  const search = useActionSearchDialog();
  const reportQueryServicesPersistenceError = useCallback(
    (error: unknown) => toast(errMessage(error), "error"),
    [toast],
  );
  const queryServices = useQueryServices(
    catalogScope,
    reportQueryServicesPersistenceError,
  );
  const controller = useAppShellWorkbenchController({
    scope: catalogScope,
    mobileExplorer: {
      open: mobileExplorerOpen,
      setOpen: setMobileExplorerOpen,
      focusMainAfterSelection: focusMainAfterMobileSelection,
    },
    activity: {
      unseen: activity.unseen,
      markSeen: activity.markSeen,
    },
  });
  const {
    route,
    connections,
    safety,
    documents,
    commands,
  } = controller;
  const projectNamesByConnectionId = useConnectionProjectNames(
    catalogScope,
    connections.selected === null,
  );
  const backgroundTasks = useBackgroundTasks({
    connections: connections.items,
    queryServiceStore: queryServices.store,
    workspaceScopeKey: catalogScope.key,
  });
  const manualTransactions = useWorkspaceManualTransactions(connections.items);
  const {
    width: sidebarWidth,
    minimum: sidebarMinimum,
    maximum: sidebarMaximum,
    startDrag: startSidebarDrag,
    resize: resizeSidebar,
    reset: resetSidebarWidth,
  } = useSidebarWidth(
    toolWindows.localHistoryOpen ? "localHistory" : "databaseExplorer",
  );
  const updater = useAppUpdater();
  const [explorerRevealRequest, setExplorerRevealRequest] = useState(0);
  const [agentComposerRequest, setAgentComposerRequest] =
    useState<AgentComposerRequest | null>(null);
  const showAgentDock =
    agentDock.open && !!connections.selected && route.editing === null;


  const notifyOperation = useCallback(
    () => toast(t("app.toastAgentQuery")),
    [t, toast],
  );
  useOperationNudge(
    activity.latest?.id ?? null,
    showAgentDock,
    notifyOperation,
  );

  function openOrFocusAgentDock() {
    if (!connections.selected) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setAgentComposerRequest(null);
    if (compactShell) {
      setMobileExplorerOpen(false);
    }
    if (showAgentDock) {
      focusActiveAgentControl();
      return;
    }
    commands.route.focusToolWindow();
    setMobileExplorerOpen(false);
    agentDock.show(returnFocus);
  }

  function openAgentTask(
    connectionId: string,
    environmentId?: string,
    prompt?: string,
    articleId?: string,
  ) {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const target = connections.items.find((connection) => connection.id === connectionId);
    if (!target) return;
    setAgentComposerRequest(
      environmentId
        ? {
            id: crypto.randomUUID(),
            connectionId: target.id,
            projectEnvironmentId: environmentId,
            prompt: prompt ?? "",
          }
        : null,
    );
    if (connections.selected?.id !== connectionId) commands.connections.select(connectionId);
    const analysisFocus = route.knowledgeEnvironmentFocus;
    if (environmentId && (articleId || (analysisFocus?.view === "analyses" && analysisFocus.environmentId === environmentId))) {
      commands.route.openKnowledge(environmentId, "analyses", articleId ?? analysisFocus?.resourceId);
    } else {
      commands.route.focusToolWindow();
    }
    setMobileExplorerOpen(false);
    if (!showAgentDock) agentDock.show(returnFocus);
    focusActiveAgentControl();
  }

  const guidedDemo = useGuidedDemoCommands({
    scope: catalogScope,
    connection: connections.selected,
    openTable: commands.documents.openTable,
    openAgentTask,
    openSafety: () => commands.route.openSettings("safety"),
  });

  async function cancelBackgroundTask(task: BackgroundTask) {
    try {
      await backgroundTasks.cancelTask(task);
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  function openQueryResult(sessionId: string) {
    const session = queryServices.store.session(sessionId);
    if (!session) return;
    queryServices.store.activate(sessionId);
    const source = documents.items.find((document) => document.id === session.documentId);
    if (source && (session.status === "running" || session.status === "waiting")) {
      commands.documents.activate(source);
    } else {
      commands.documents.openResults(session.connectionId);
    }
    setMobileExplorerOpen(false);
  }

  function openManualTransaction(transaction: WorkspaceManualTransaction) {
    if (connections.selectedId !== transaction.connectionId) {
      commands.connections.select(transaction.connectionId);
      return;
    }
    commands.route.showWorkbench();
    focusMainAfterMobileSelection();
  }

  async function settleManualTransaction(
    transaction: WorkspaceManualTransaction,
    action: "commit" | "rollback",
  ) {
    try {
      if (action === "commit") {
        await manualTransactions.commit(transaction);
      } else {
        await manualTransactions.rollback(transaction);
      }
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  function toggleLeftPanel(panel: "current" | "database" | "history") {
    if (panel === "current" && route.knowledgeEnvironmentFocus) panel = "database";
    const open = panel === "database" ? toolWindows.databaseExplorerOpen
      : panel === "history" ? toolWindows.localHistoryOpen
      : toolWindows.databaseExplorerOpen || toolWindows.localHistoryOpen;
    const toggle = panel === "database" ? toolWindows.toggleDatabaseExplorer
      : panel === "history" ? toolWindows.toggleLocalHistory
      : toolWindows.toggleLeftToolWindow;
    if (!compactShell) {
      toggle();
      return;
    }
    agentDock.close();
    if (open && mobileExplorerOpen) {
      if (panel === "history") toolWindows.closeLocalHistory();
      else dismissMobileExplorer();
      return;
    }
    if (!open) toggle();
    setMobileExplorerOpen(true);
  }

  function openShellSettings(section?: "safety", connectionId?: string) {
    if (connectionId && !connections.items.some(({ id }) => id === connectionId)) return;
    if (connectionId && connections.selectedId !== connectionId) {
      commands.connections.select(connectionId);
    }
    commands.route.openSettings(section);
    setMobileExplorerOpen(false);
    if (compactShell) {
      agentDock.close();
    }
  }

  function revealDatabaseContext() {
    commands.route.showWorkbench();
    toolWindows.showDatabaseExplorer();
    if (compactShell) {
      agentDock.close();
      setMobileExplorerOpen(true);
    }
    setExplorerRevealRequest((request) => request + 1);
  }

  const searchItems = useActionSearchItems({
    open: search.open,
    scope: catalogScope,
    connections: connections.items,
    selected: connections.selected,
    documents: documents.items,
    supportsSql: connections.supportsSql,
    commands: {
      newConnection: () => commands.connections.new(),
      newQuery: commands.documents.openQuery,
      openResults: () => commands.documents.openStable("results"),
      toggleDatabaseExplorer: toolWindows.toggleDatabaseExplorer,
      showLocalHistory: () => {
        toolWindows.showLocalHistory();
        if (compactShell) {
          agentDock.close();
          setMobileExplorerOpen(true);
        }
      },
      openAgent: openOrFocusAgentDock,
      openSettings: (section) => {
        commands.route.openSettings(section);
        setMobileExplorerOpen(false);
      },
      selectConnection: commands.connections.select,
      activateDocument: commands.documents.activate,
      openTable: commands.documents.openTable,
    },
  });

  const mainContent = (
    <WorkbenchContent
      model={{
        route,
        connection: {
          selected: connections.selected,
          items: connections.items,
          projectNamesByConnectionId,
          loadError: connections.loadError,
          supportsSql: connections.supportsSql,
          creatingDemo: connections.creatingDemo,
          guidedDemoAvailable: catalogScope.workspaceKind === "personal",
          safety: safety.value,
          safetyError: safety.error,
        },
        workbench: documents,
        update: { snapshot: updater.snapshot },
      }}
      commands={{
        route: {
          openSafety: (connectionId: string) => openShellSettings("safety", connectionId),
          closeSettings: commands.route.closeSettings,
          closeSurface: commands.route.showWorkbench,
        },
        connections: commands.connections,
        safety: commands.safety,
        documents: {
          ...commands.documents,
          openAgentTask,
        },
        queryServices: {
          updateSession: queryServices.updateSession,
          store: queryServices.store,
        },
        update: {
          refresh: updater.refresh,
          install: updater.install,
        },
        guidedDemo,
      }}
    />
  );

  return (
    <>
      <ArticleLinkGate
        onScopeChanged={commands.connections.reloadWorkspaceScope}
        onOpen={(environmentId, articleId) => commands.route.openKnowledge(environmentId, "analyses", articleId)}
      />
      <ExternalAgentRequestGate
        catalogScopeKey={catalogScope.key}
        connections={connections.items}
        selectedConnection={connections.selected}
      />
      <ShellLayout
        model={{
          workspace: {
            connections: connections.items,
            selected: connections.selected,
            selectedId: connections.selectedId,
            supportsSql: connections.supportsSql,
            writeEnabled: safety.writeEnabled,
            settingsOpen: route.settingsOpen,
            updater: updater.snapshot,
            creatingDemo: connections.creatingDemo,
          },
          explorer: {
            databaseOpen: toolWindows.databaseExplorerOpen,
            localHistoryOpen: toolWindows.localHistoryOpen,
            activeSchemaGroupKey: route.schemaDiffGroupKey,
            knowledgeFocus: route.knowledgeEnvironmentFocus,
            revealRequest: explorerRevealRequest,
          },
          workbench: {
            documents: documents.items,
            activeDocumentId: documents.activeId,
            selectedTable: documents.selectedTable,
            content: mainContent,
          },
          agent: {
            open: showAgentDock,
            composerRequest: agentComposerRequest,
            width: agentDock.width,
            buttonRef: agentDock.buttonRef,
            returnFocusRef: agentDock.returnFocusRef,
          },
          status: {
            backgroundTasks: backgroundTasks.tasks,
            cancellingBackgroundTaskKeys: backgroundTasks.cancellingKeys,
            manualTransactions: manualTransactions.transactions,
            settlingManualTransactionIds: manualTransactions.settlingIds,
            unseenOperationCount: activity.unseen,
          },
          viewport: {
            width: viewportWidth,
            compact: compactShell,
            mobileExplorerOpen,
            sidebarWidth,
            sidebarMinimum,
            sidebarMaximum,
            mainRef,
          },
          search: {
            open: search.open,
            buttonRef: search.buttonRef,
          },
        }}
        commands={{
          workspace: {
            scopeChanged: commands.connections.reloadWorkspaceScope,
            newConnection: commands.connections.new,
            createDemo: commands.connections.createDemo,
            editConnection: commands.connections.edit,
            deleteConnection: commands.connections.delete,
            updateConnection: commands.connections.update,
            settings: () => openShellSettings(),
            safetySettings: (connectionId) =>
              openShellSettings("safety", connectionId),
            openUpdateSettings: () => commands.route.openSettings("updates"),
          },
          explorer: {
            togglePanel: () => toggleLeftPanel("current"),
            toggleDatabase: () => toggleLeftPanel("database"),
            toggleLocalHistory: () => toggleLeftPanel("history"),
            closeLocalHistory: toolWindows.closeLocalHistory,
            selectConnection: commands.connections.select,
            openTable: commands.documents.openTable,
            openSchemaDiff: (group) =>
              commands.route.openSchemaDiff(group.key),
            openProjectEnvironment: (environmentId, view, resourceId) => {
              commands.route.openKnowledge(environmentId, view, resourceId);
              if (!compactShell) toolWindows.showDatabaseExplorer();
              setMobileExplorerOpen(false);
            },
            dismissMobile: () => dismissMobileExplorer(true),
          },
          workbench: {
            activateDocument: commands.documents.activateId,
            restoreDocument: commands.documents.restoreDraft,
            newQuery: commands.documents.newQuery,
          },
          agent: {
            toggle: showAgentDock ? agentDock.close : openOrFocusAgentDock,
            openTask: openAgentTask,
            widthChanged: agentDock.resize,
            close: agentDock.close,
          },
          status: {
            openQueryResult,
            cancelBackgroundTask,
            openManualTransaction,
            commitManualTransaction: (transaction) =>
              settleManualTransaction(transaction, "commit"),
            rollbackManualTransaction: (transaction) =>
              settleManualTransaction(transaction, "rollback"),
            revealDatabaseContext,
            openNotifications: () => {
              activity.markSeen();
              commands.documents.openStable("activity");
            },
          },
          viewport: {
            startSidebarDrag,
            resizeSidebar,
            resetSidebar: resetSidebarWidth,
          },
          search: { open: search.show },
        }}
      />
      <SkillStartupGate />
      {search.open ? (
        <ActionSearch items={searchItems} onClose={search.close} />
      ) : null}
    </>
  );
}

function focusActiveAgentControl() {
  window.requestAnimationFrame(() => {
    const target =
      document.querySelector<HTMLElement>(
        '[data-agent-focus-target="composer"]:not(:disabled)',
      ) ??
      document.querySelector<HTMLElement>(
        '[data-agent-focus-target="session-control"]:not(:disabled), [data-agent-focus-target="recovery"]:not(:disabled)',
      ) ??
      document.querySelector<HTMLElement>("[data-agent-surface]");
    target?.focus({ preventScroll: true });
  });
}
