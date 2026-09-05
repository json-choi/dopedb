// Desktop workbench shell composes workspace, tool-window, search, and Agent controllers.
import { useCallback, useEffect, useState } from "react";

import { ToastProvider, useToast } from "../../components/Toast";
import { errMessage } from "../../ipc/types";
import ActionSearch from "../actionSearch/ActionSearch";
import { useActionSearchDialog } from "../actionSearch/useActionSearchDialog";
import { useActionSearchItems } from "../actionSearch/useActionSearchItems";
import type { BackgroundTask } from "../backgroundTasks/domain";
import { useBackgroundTasks } from "../backgroundTasks/useBackgroundTasks";
import type { AgentComposerRequest } from "../agents/domain";
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
  const { closeServices, servicesOpen } = toolWindows;
  const {
    agentOverlay,
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

  useEffect(() => {
    if (compactShell && showAgentDock && servicesOpen) {
      closeServices();
    }
  }, [
    compactShell,
    showAgentDock,
    closeServices,
    servicesOpen,
  ]);

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
      toolWindows.closeServices();
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
  ) {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const target = connections.items.find(
      (connection) => connection.id === connectionId,
    );
    if (!target) return;
    setAgentComposerRequest(
      environmentId && prompt
        ? {
            id: crypto.randomUUID(),
            connectionId: target.id,
            projectEnvironmentId: environmentId,
            prompt,
          }
        : null,
    );
    if (connections.selected?.id !== connectionId) {
      commands.connections.select(connectionId);
    }
    if (compactShell) toolWindows.closeServices();
    commands.route.focusToolWindow();
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

  function toggleDatabaseExplorer() {
    if (!compactShell) {
      toolWindows.toggleDatabaseExplorer();
      return;
    }
    toolWindows.closeServices();
    agentDock.close();
    if (toolWindows.databaseExplorerOpen && mobileExplorerOpen) {
      dismissMobileExplorer();
      return;
    }
    toolWindows.showDatabaseExplorer();
    setMobileExplorerOpen(true);
  }

  function toggleLocalHistory() {
    if (!compactShell) {
      toolWindows.toggleLocalHistory();
      return;
    }
    toolWindows.closeServices();
    agentDock.close();
    if (toolWindows.localHistoryOpen && mobileExplorerOpen) {
      dismissMobileExplorer();
      return;
    }
    toolWindows.showLocalHistory();
    setMobileExplorerOpen(true);
  }

  function toggleServices() {
    if (compactShell && !toolWindows.servicesOpen) {
      agentDock.close();
      setMobileExplorerOpen(false);
    }
    toolWindows.toggleServices();
  }

  function openShellSettings(section?: "safety", connectionId?: string) {
    if (connectionId && !connections.items.some(({ id }) => id === connectionId)) return;
    if (connectionId && connections.selectedId !== connectionId) {
      commands.connections.select(connectionId);
    }
    commands.route.openSettings(section);
    setMobileExplorerOpen(false);
    if (compactShell) {
      toolWindows.closeServices();
      agentDock.close();
    }
  }

  function revealDatabaseContext() {
    commands.route.showWorkbench();
    toolWindows.showDatabaseExplorer();
    if (compactShell) {
      toolWindows.closeServices();
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
      toggleDatabaseExplorer: toolWindows.toggleDatabaseExplorer,
      showLocalHistory: toolWindows.showLocalHistory,
      toggleServices: toolWindows.toggleServices,
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
          show: (sessionId) => {
            queryServices.activateNewestSession(sessionId);
            if (compactShell) {
              agentDock.close();
              setMobileExplorerOpen(false);
            }
            toolWindows.showServices();
          },
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
          services: {
            open: toolWindows.servicesOpen,
            height: toolWindows.servicesHeight,
            minimumHeight: toolWindows.servicesMinimumHeight,
            maximumHeight: toolWindows.servicesMaximumHeight,
            store: queryServices.store,
          },
          agent: {
            open: showAgentDock,
            composerRequest: agentComposerRequest,
            overlay: agentOverlay,
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
            toggleDatabase: toggleDatabaseExplorer,
            toggleLocalHistory,
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
          services: {
            toggle: toggleServices,
            close: toolWindows.closeServices,
            startResize: toolWindows.startServicesResize,
            resize: toolWindows.resizeServicesHeight,
            resetHeight: toolWindows.resetServicesHeight,
          },
          agent: {
            toggle: showAgentDock ? agentDock.close : openOrFocusAgentDock,
            openTask: openAgentTask,
            widthChanged: agentDock.resize,
            close: agentDock.close,
          },
          status: {
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
