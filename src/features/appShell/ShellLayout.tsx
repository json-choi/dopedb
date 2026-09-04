import { useRef, type ReactNode, type RefObject } from "react";

import { Icon } from "../../components/Icon";
import { ResizeSeparator } from "../../design-system/components/ResizeSeparator";
import type { CatalogTable } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { SchemaConnectionGroup } from "../../lib/schemaDiff";
import { tableKey } from "../../lib/tableRef";
import { DatabaseExplorer } from "../../screens/Connections";
import AcpChatPanel from "../agents/AcpChatPanel";
import type { AgentComposerRequest } from "../agents/domain";
import {
  agentDockInteraction,
  agentDockLayout,
  clampAgentDockWidth,
  shouldOverlayAgentDock,
} from "../agents/layout";
import { AgentSelectionProvider } from "../agents/selectionContext";
import type { BackgroundTask } from "../backgroundTasks/domain";
import type { ConnectionProfile } from "../connections/domain";
import type { ConnectionLaunchPreset } from "../connections/presets";
import type {
  KnowledgeEnvironmentFocus,
  KnowledgeEnvironmentView,
} from "../knowledge/domain";
import LocalHistoryToolWindow from "../localHistory/LocalHistoryToolWindow";
import QueryServicesToolWindow from "../queryServices/QueryServicesToolWindow";
import type { QueryServiceStore } from "../queryServices/store";
import { defaultSqlNamespace } from "../queries/namespace";
import type { WorkspaceManualTransaction } from "../queries/useWorkspaceManualTransactions";
import {
  appUpdaterProgress,
  type AppUpdaterSnapshot,
} from "../updater/controller";
import type { WorkbenchDocument } from "../workbench/domain";
import WorkspaceAccount from "../workspaces/components/WorkspaceAccount";
import WorkspaceSwitcher from "../workspaces/components/WorkspaceSwitcher";
import { IdeStatusBar, IdeTopBar } from "./IdeChrome";
import { useInertShellBackground } from "./useInertShellBackground";

const IS_MACOS =
  typeof navigator !== "undefined" &&
  /Macintosh|Mac OS X/.test(navigator.userAgent);

type ShellLayoutModel = {
  workspace: {
    connections: ConnectionProfile[];
    selected: ConnectionProfile | null;
    selectedId: string | null;
    supportsSql: boolean;
    writeEnabled: boolean;
    settingsOpen: boolean;
    updater: AppUpdaterSnapshot;
    creatingDemo: boolean;
  };
  explorer: {
    databaseOpen: boolean;
    localHistoryOpen: boolean;
    activeSchemaGroupKey: string | null;
    knowledgeFocus: KnowledgeEnvironmentFocus | null;
    revealRequest: number;
  };
  workbench: {
    documents: WorkbenchDocument[];
    activeDocumentId: string | null;
    selectedTable: CatalogTable | null;
    content: ReactNode;
  };
  services: {
    open: boolean;
    height: number;
    minimumHeight: number;
    maximumHeight: number;
    store: QueryServiceStore;
  };
  agent: {
    open: boolean;
    composerRequest: AgentComposerRequest | null;
    overlay: boolean;
    width: number;
    buttonRef: RefObject<HTMLButtonElement | null>;
    returnFocusRef: RefObject<HTMLElement | null>;
  };
  status: {
    backgroundTasks: BackgroundTask[];
    cancellingBackgroundTaskKeys: ReadonlySet<string>;
    manualTransactions: WorkspaceManualTransaction[];
    settlingManualTransactionIds: ReadonlySet<string>;
    unseenOperationCount: number;
  };
  viewport: {
    compact: boolean;
    mobileExplorerOpen: boolean;
    sidebarWidth: number;
    sidebarMinimum: number;
    sidebarMaximum: number;
    mainRef: RefObject<HTMLElement | null>;
  };
  search: {
    open: boolean;
    buttonRef: RefObject<HTMLButtonElement | null>;
  };
};

type ShellLayoutCommands = {
  workspace: {
    scopeChanged: () => Promise<void>;
    newConnection: (preset?: ConnectionLaunchPreset) => void;
    createDemo: () => void;
    editConnection: (connection: ConnectionProfile) => void;
    deleteConnection: (id: string) => Promise<void>;
    updateConnection: (connection: ConnectionProfile) => void;
    settings: () => void;
    safetySettings: (connectionId?: ConnectionProfile["id"]) => void;
    openUpdateSettings: () => void;
  };
  explorer: {
    toggleDatabase: () => void;
    toggleLocalHistory: () => void;
    closeLocalHistory: () => void;
    selectConnection: (id: string) => void;
    openTable: (connection: ConnectionProfile, table: CatalogTable) => void;
    openSchemaDiff: (group: SchemaConnectionGroup) => void;
    openProjectEnvironment: (
      environmentId: string | null,
      view: KnowledgeEnvironmentView,
      resourceId?: string | null,
    ) => void;
    dismissMobile: () => void;
  };
  workbench: {
    activateDocument: (id: string) => void;
    restoreDocument: (id: string, content: string) => void;
    newQuery: () => void;
  };
  services: {
    toggle: () => void;
    close: () => void;
    startResize: (event: {
      preventDefault(): void;
      clientY: number;
    }) => void;
    resize: (height: number) => void;
    resetHeight: () => void;
  };
  agent: {
    open: () => void;
    openTask: (
      connectionId: string,
      environmentId?: string,
      prompt?: string,
    ) => void;
    widthChanged: (width: number) => void;
    close: () => void;
  };
  status: {
    cancelBackgroundTask: (task: BackgroundTask) => Promise<void>;
    openManualTransaction: (transaction: WorkspaceManualTransaction) => void;
    commitManualTransaction: (
      transaction: WorkspaceManualTransaction,
    ) => Promise<void>;
    rollbackManualTransaction: (
      transaction: WorkspaceManualTransaction,
    ) => Promise<void>;
    revealDatabaseContext: () => void;
    openNotifications: () => void;
  };
  viewport: {
    startSidebarDrag: (event: {
      preventDefault(): void;
      clientX: number;
    }) => void;
    resizeSidebar: (width: number) => void;
    resetSidebar: () => void;
  };
  search: {
    open: (returnFocus?: HTMLElement | null) => void;
  };
};

type Props = {
  model: ShellLayoutModel;
  commands: ShellLayoutCommands;
};

export default function ShellLayout(props: Props) {
  return (
    <AgentSelectionProvider>
      <ShellLayoutContent {...props} />
    </AgentSelectionProvider>
  );
}

function ShellLayoutContent({ model, commands }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const {
    workspace,
    explorer,
    workbench,
    services,
    agent,
    status,
    viewport,
    search,
  } = model;
  const updateProgress = appUpdaterProgress(workspace.updater);
  const showUpdateBadge =
    workspace.updater.phase !== "idle" &&
    workspace.updater.phase !== "current" &&
    !workspace.settingsOpen;
  const updateBadgeLabel =
    workspace.updater.phase === "available"
      ? t("updates.badge", {
          version: workspace.updater.availableVersion ?? "",
        })
      : workspace.updater.phase === "checking"
        ? t("updates.checking")
        : workspace.updater.phase === "downloading"
          ? updateProgress === null
            ? t("updates.downloading")
            : t("updates.downloadingPercent", { progress: updateProgress })
          : workspace.updater.phase === "installing"
            ? t("updates.installing")
            : workspace.updater.phase === "ready"
              ? t("updates.relaunching")
              : t("updates.error");
  const databaseExplorerVisible = explorer.databaseOpen;
  const environmentDetailOpen = explorer.knowledgeFocus !== null;
  const localHistoryVisible =
    !environmentDetailOpen && explorer.localHistoryOpen;
  const leftToolWindowVisible =
    databaseExplorerVisible || localHistoryVisible;
  const servicesVisible = services.open;
  const agentOverlay =
    agent.overlay ||
    (agent.open && shouldOverlayAgentDock({
      viewportWidth: typeof window === "undefined" ? 1_280 : window.innerWidth,
      leftToolWindowWidth: leftToolWindowVisible ? viewport.sidebarWidth : 0,
      requestedAgentWidth: agent.width,
    }));
  const agentLayout = agentDockLayout(viewport.compact, agentOverlay);
  const compactAgentModalOpen =
    agent.open &&
    workspace.selected !== null &&
    agentDockInteraction(agentLayout).shellInert;
  useInertShellBackground(shellRef, compactAgentModalOpen);
  const rightDockWidth = agent.open && !agentOverlay
    ? clampAgentDockWidth(
        agent.width,
        typeof window === "undefined" ? 1_280 : window.innerWidth,
      )
    : 0;
  const activeWorkbenchDocument =
    workbench.documents.find(
      (document) => document.id === workbench.activeDocumentId,
    ) ?? null;
  const selectedNamespace = workspace.selected
    ? activeWorkbenchDocument?.kind === "sql"
      ? activeWorkbenchDocument.selectedSchema ??
        defaultSqlNamespace(workspace.selected)
      : activeWorkbenchDocument?.kind === "data"
        ? activeWorkbenchDocument.table.schema ??
          defaultSqlNamespace(workspace.selected)
        : defaultSqlNamespace(workspace.selected)
    : null;
  const selectedDatabase = workspace.selected
    ? activeWorkbenchDocument?.kind === "sql"
      ? activeWorkbenchDocument.selectedDatabase || workspace.selected.database
      : activeWorkbenchDocument?.kind === "data"
        ? activeWorkbenchDocument.table.database ?? workspace.selected.database
        : workspace.selected.database
    : null;

  return (
    <div
      ref={shellRef}
      className="app tw:grid tw:h-dvh tw:overflow-hidden tw:bg-muted"
      data-compact={viewport.compact}
      data-platform={IS_MACOS ? "macos" : "other"}
      data-agent-open={agent.open}
      data-mobile-explorer-open={viewport.mobileExplorerOpen}
      data-database-explorer-open={databaseExplorerVisible}
      data-local-history-open={localHistoryVisible}
      data-services-open={servicesVisible}
      style={{
        gridTemplateColumns: viewport.compact
          ? "minmax(0, 1fr)"
          : leftToolWindowVisible
            ? `${viewport.sidebarWidth}px 4px minmax(0, 1fr) ${rightDockWidth}px`
            : `0 0 minmax(0, 1fr) ${rightDockWidth}px`,
        gridTemplateRows: viewport.compact
          ? "var(--ds-title-toolbar-height) minmax(0, 1fr) var(--ds-status-bar-height)"
          : `var(--ds-title-toolbar-height) minmax(0, 1fr) ${
              servicesVisible ? services.height : 0
            }px var(--ds-status-bar-height)`,
      }}
    >
      <IdeTopBar
        selected={workspace.selected}
        supportsSql={workspace.supportsSql}
        databaseExplorerOpen={
          databaseExplorerVisible &&
          (!viewport.compact || viewport.mobileExplorerOpen)
        }
        localHistoryOpen={
          localHistoryVisible &&
          (!viewport.compact || viewport.mobileExplorerOpen)
        }
        servicesOpen={servicesVisible}
        agentDockOpen={agent.open}
        actionSearchOpen={search.open}
        settingsOpen={workspace.settingsOpen}
        account={
          <WorkspaceAccount
            compact
            menuPlacement="topbar"
            onScopeChanged={commands.workspace.scopeChanged}
          />
        }
        onNewQuery={commands.workbench.newQuery}
        onToggleDatabaseExplorer={commands.explorer.toggleDatabase}
        onToggleLocalHistory={commands.explorer.toggleLocalHistory}
        onToggleServices={commands.services.toggle}
        onOpenAgent={commands.agent.open}
        agentButtonRef={agent.buttonRef}
        actionSearchButtonRef={search.buttonRef}
        onActionSearch={commands.search.open}
        onSettings={commands.workspace.settings}
        workspace={
          <WorkspaceSwitcher
            onNew={commands.workspace.newConnection}
            onChanged={commands.workspace.scopeChanged}
          />
        }
      />

      <div
        className="tw:col-start-1 tw:row-start-2 tw:min-h-0 tw:min-w-0 tw:overflow-hidden tw:max-[561px]:contents"
        aria-hidden={!leftToolWindowVisible}
        inert={!leftToolWindowVisible ? true : undefined}
      >
        {localHistoryVisible ? (
          <LocalHistoryToolWindow
            connection={workspace.selected}
            documents={workbench.documents}
            activeDocumentId={workbench.activeDocumentId}
            onActivateDocument={commands.workbench.activateDocument}
            onRestoreRevision={commands.workbench.restoreDocument}
            onClose={commands.explorer.closeLocalHistory}
            compact={viewport.compact}
            compactOpen={viewport.mobileExplorerOpen}
          />
        ) : (
          <DatabaseExplorer
            connections={workspace.connections}
            selectedId={
              environmentDetailOpen ? null : workspace.selectedId
            }
            selectedTableKey={
              !environmentDetailOpen && workbench.selectedTable
                ? tableKey(workbench.selectedTable)
                : null
            }
            activeSchemaGroupKey={
              environmentDetailOpen ? null : explorer.activeSchemaGroupKey
            }
            onSelectConn={commands.explorer.selectConnection}
            onOpenTable={commands.explorer.openTable}
            onOpenSchemaDiff={commands.explorer.openSchemaDiff}
            onEdit={commands.workspace.editConnection}
            onDeleted={commands.workspace.deleteConnection}
            onConnectionUpdated={commands.workspace.updateConnection}
            onNewConnection={commands.workspace.newConnection}
            onClose={commands.explorer.toggleDatabase}
            onCreateDemoDatabase={commands.workspace.createDemo}
            creatingDemo={workspace.creatingDemo}
            compact={viewport.compact}
            compactOpen={viewport.mobileExplorerOpen}
            revealRequest={explorer.revealRequest}
            revealDatabase={selectedDatabase}
            revealNamespace={selectedNamespace}
            activeProjectEnvironmentId={
              explorer.knowledgeFocus?.environmentId ?? null
            }
            activeProjectEnvironmentView={
              explorer.knowledgeFocus?.view ?? null
            }
            activeProjectEnvironmentResourceId={
              explorer.knowledgeFocus?.resourceId ?? null
            }
            onOpenProjectEnvironment={commands.explorer.openProjectEnvironment}
          />
        )}
      </div>

      <button
        type="button"
        data-open={viewport.mobileExplorerOpen}
        className="tw:hidden tw:max-[561px]:fixed tw:max-[561px]:inset-x-0 tw:max-[561px]:top-title-toolbar tw:max-[561px]:bottom-status-bar tw:max-[561px]:z-[var(--ds-z-sticky)] tw:max-[561px]:block tw:max-[561px]:cursor-default tw:max-[561px]:border-0 tw:max-[561px]:bg-overlay tw:max-[561px]:p-0 tw:max-[561px]:opacity-0 tw:max-[561px]:pointer-events-none tw:max-[561px]:transition-opacity tw:max-[561px]:duration-150 tw:max-[561px]:data-[open=true]:opacity-100 tw:max-[561px]:data-[open=true]:pointer-events-auto"
        aria-label={t("common.close")}
        aria-hidden={!viewport.mobileExplorerOpen}
        tabIndex={viewport.mobileExplorerOpen ? 0 : -1}
        onClick={commands.explorer.dismissMobile}
      />
      <ResizeSeparator
        className="tw:col-start-2 tw:row-start-2 tw:ml-[var(--ds-active-offset)] tw:cursor-col-resize tw:bg-transparent tw:hover:bg-muted tw:active:bg-muted tw:max-[561px]:hidden"
        hidden={!leftToolWindowVisible}
        label={t("app.dragResize")}
        orientation="vertical"
        value={viewport.sidebarWidth}
        minimum={viewport.sidebarMinimum}
        maximum={viewport.sidebarMaximum}
        step={12}
        onChange={commands.viewport.resizeSidebar}
        onReset={commands.viewport.resetSidebar}
        onMouseDown={commands.viewport.startSidebarDrag}
      />
      <main
        ref={viewport.mainRef}
        data-compact={viewport.compact}
        className="main tw:col-start-3 tw:row-start-2 tw:mt-0 tw:mr-panel-gutter tw:mb-panel-gutter tw:ml-0 tw:flex tw:min-w-0 tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-background tw:outline-none tw:[container-name:main-pane] tw:[container-type:inline-size] tw:data-[compact=true]:col-start-1 tw:data-[compact=true]:m-0 tw:data-[compact=true]:min-h-0 tw:data-[compact=true]:rounded-none tw:data-[compact=true]:border-0"
        tabIndex={-1}
        inert={viewport.mobileExplorerOpen ? true : undefined}
      >
        {workbench.content}
        {showUpdateBadge && (
          <div className="ds-attention-stack">
            <button
              className="ds-attention-badge ds-tone-trust"
              onClick={commands.workspace.openUpdateSettings}
              title={`${t("updates.badgeTitle")}: ${updateBadgeLabel}`}
              aria-label={`${t("updates.badgeTitle")}: ${updateBadgeLabel}`}
            >
              <Icon
                name={workspace.updater.phase === "error" ? "alert" : "download"}
              />
              <span>{updateBadgeLabel}</span>
            </button>
          </div>
        )}
      </main>

      {servicesVisible && (
        <QueryServicesToolWindow
          store={services.store}
          connections={workspace.connections}
          documents={workbench.documents}
          activeDocumentId={workbench.activeDocumentId}
          onActivateDocument={commands.workbench.activateDocument}
          onOpenSafety={commands.workspace.safetySettings}
          onClose={commands.services.close}
          onStartResize={commands.services.startResize}
          height={services.height}
          minimumHeight={services.minimumHeight}
          maximumHeight={services.maximumHeight}
          onHeightChange={commands.services.resize}
          onResetHeight={commands.services.resetHeight}
          compact={viewport.compact}
        />
      )}

      <IdeStatusBar
        selected={workspace.selected}
        selectedTable={workbench.selectedTable}
        selectedDatabase={selectedDatabase}
        selectedNamespace={selectedNamespace}
        activeDocument={activeWorkbenchDocument}
        backgroundTasks={status.backgroundTasks}
        cancellingBackgroundTaskKeys={status.cancellingBackgroundTaskKeys}
        manualTransactions={status.manualTransactions}
        settlingManualTransactionIds={status.settlingManualTransactionIds}
        writeEnabled={workspace.writeEnabled}
        unseenOperationCount={status.unseenOperationCount}
        onOpenQueryTask={(sessionId) => {
          services.store.activate(sessionId);
          if (!servicesVisible) commands.services.toggle();
        }}
        onOpenAgentTask={commands.agent.openTask}
        onOpenManualTransaction={commands.status.openManualTransaction}
        onCommitManualTransaction={commands.status.commitManualTransaction}
        onRollbackManualTransaction={commands.status.rollbackManualTransaction}
        onCancelBackgroundTask={commands.status.cancelBackgroundTask}
        onRevealDatabaseContext={commands.status.revealDatabaseContext}
        onOpenNotifications={commands.status.openNotifications}
        onSafetySettings={commands.workspace.safetySettings}
      />
      {agent.open && workspace.selected && (
        <AcpChatPanel
          connection={workspace.selected}
          connections={workspace.connections}
          composerRequest={agent.composerRequest}
          documents={workbench.documents}
          activeDocumentId={workbench.activeDocumentId}
          selectedTable={workbench.selectedTable}
          overlay={agentOverlay}
          compact={viewport.compact}
          width={rightDockWidth}
          onWidthChange={commands.agent.widthChanged}
          onOpenKnowledgeAnalysis={(environmentId, articleId) =>
            commands.explorer.openProjectEnvironment(
              environmentId,
              "analyses",
              articleId,
            )
          }
          onClose={commands.agent.close}
          returnFocusRef={agent.returnFocusRef}
        />
      )}
    </div>
  );
}
