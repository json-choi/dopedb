// Desktop chrome: project context and real tool-window launchers share
// one quiet title toolbar. macOS owns its native File/Edit/View menus, so the
// WebView must not draw a second application menu inside the window.
import type { ReactNode, RefObject } from "react";
import type { CatalogTable } from "../../ipc/types";
import BackgroundTasksMenu from "../backgroundTasks/BackgroundTasksMenu";
import type { BackgroundTask } from "../backgroundTasks/domain";
import {
  databaseDisplayLabel,
  type ConnectionProfile,
} from "../connections/domain";
import { providerTargetDisplayName } from "../connections/ProviderTargetLabel";
import type { WorkbenchDocument } from "../workbench/domain";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import ManualTransactionsMenu from "../queries/ManualTransactionsMenu";
import type { WorkspaceManualTransaction } from "../queries/useWorkspaceManualTransactions";
import { SQL_EDITOR_INDENT_SIZE } from "../queries/editorStatus";
import { useSqlEditorCursor } from "../queries/editorStatusStore";
import { Icon } from "../../components/Icon";
import { DopeDBMark } from "../../design-system/components/DopeDBMark";
import ToolbarMenu, {
  ToolbarMenuItem,
} from "../../components/ToolbarMenu";
import {
  IdeStatusBarSurface,
  IdeToolbarLauncher,
  IdeTitleToolbar,
} from "../../design-system/components/AppChrome";
import {
  StatusBarBreadcrumbs,
  StatusBarIconButton,
  StatusBarItem,
} from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import { tableLabel } from "../../lib/tableRef";

const IS_MACOS =
  typeof navigator !== "undefined" &&
  /Macintosh|Mac OS X/.test(navigator.userAgent);

export function IdeTopBar({
  selected,
  supportsSql,
  leftPanelOpen,
  localHistoryOpen,
  agentDockOpen,
  actionSearchOpen,
  settingsOpen,
  workspace,
  account,
  onNewQuery,
  onWelcome,
  onToggleLeftPanel,
  onToggleLocalHistory,
  onToggleAgent,
  agentButtonRef,
  actionSearchButtonRef,
  onActionSearch,
  onSettings,
}: {
  selected: ConnectionProfile | null;
  supportsSql: boolean;
  leftPanelOpen: boolean;
  localHistoryOpen: boolean;
  agentDockOpen: boolean;
  actionSearchOpen: boolean;
  settingsOpen: boolean;
  workspace?: ReactNode;
  account: ReactNode;
  onNewQuery: () => void;
  onWelcome: () => void;
  onToggleLeftPanel: () => void;
  onToggleLocalHistory: () => void;
  onToggleAgent: () => void;
  agentButtonRef: RefObject<HTMLButtonElement | null>;
  actionSearchButtonRef: RefObject<HTMLButtonElement | null>;
  onActionSearch: (returnFocus?: HTMLElement | null) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const queryDisabled = !selected || !supportsSql;
  const agentLauncherLabel = selected
    ? t("agent.acpTitle")
    : t("agent.acpSelectDatabaseToOpen");
  const panelLabel = t(leftPanelOpen ? "ide.action.hideLeftPanel" : "ide.action.showLeftPanel");

  return (
    <IdeTitleToolbar
      macosInset={IS_MACOS}
      context={workspace ?? <span className="tw:flex tw:items-center tw:gap-1.5 tw:text-foreground"><DopeDBMark /><span className="tw:font-serif tw:text-lg tw:leading-none tw:font-bold tw:tracking-tight">DopeDB</span></span>}
      contextAction={
        <IdeToolbarLauncher
          active={leftPanelOpen}
          onClick={onToggleLeftPanel}
          title={panelLabel}
          aria-label={panelLabel}
          aria-expanded={leftPanelOpen}
          aria-controls="left-tool-window"
        >
          <Icon name="sidebar" />
        </IdeToolbarLauncher>
      }
      launchersLabel={t("ide.mainToolbar")}
      launchers={
        <>
        <IdeToolbarLauncher onClick={onWelcome} title={t("onboarding.openWelcome")} aria-label={t("onboarding.openWelcome")}>
          <Icon name="home" />
        </IdeToolbarLauncher>
        <button
          ref={actionSearchButtonRef}
          type="button"
          aria-pressed={actionSearchOpen}
          aria-label={t("ide.action.actionSearch")}
          className="tw:flex tw:h-control-md tw:w-[min(320px,30vw)] tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-none tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-0 tw:font-sans tw:text-sm tw:text-muted-foreground tw:hover:border-border-strong tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:max-[760px]:w-control-md tw:max-[760px]:justify-center tw:max-[760px]:px-0"
          onClick={(event) => onActionSearch(event.currentTarget)}
        ><Icon name="search" /><span className="tw:truncate tw:max-[760px]:hidden">{t("ide.action.actionSearch")}</span><kbd className="tw:ml-auto tw:font-sans tw:text-xs tw:max-[760px]:hidden">⇧ ⇧</kbd></button>
        <ToolbarMenu
          align="start"
          icon="moreHorizontal"
          label={t("ide.action.more")}
        >
          <ToolbarMenuItem
            icon={localHistoryOpen ? "check" : "history"}
            disabled={!localHistoryOpen && (!selected || !supportsSql)}
            onClick={onToggleLocalHistory}
            aria-pressed={localHistoryOpen}
          >
            {t("localHistory.title")}
          </ToolbarMenuItem>
          <ToolbarMenuItem
            icon="play"
            disabled={queryDisabled}
            onClick={onNewQuery}
          >
            {t("ide.action.newQuery")}
          </ToolbarMenuItem>
        </ToolbarMenu>
        </>
      }
      actions={
        <>
        <IdeToolbarLauncher buttonRef={agentButtonRef} active={agentDockOpen} disabled={!selected} onClick={onToggleAgent} title={agentLauncherLabel} aria-label={agentLauncherLabel}><Icon name="chat" /></IdeToolbarLauncher>
        {account}
        <IdeToolbarLauncher
          active={settingsOpen}
          onClick={onSettings}
          title={t("common.settings")}
          aria-label={t("common.settings")}
        >
          <Icon name="gear" />
        </IdeToolbarLauncher>
        </>
      }
    />
  );
}

export function IdeStatusBar({
  selected,
  selectedTable,
  selectedDatabase,
  selectedNamespace,
  activeDocument,
  knowledgeFocus,
  backgroundTasks,
  cancellingBackgroundTaskKeys,
  manualTransactions,
  settlingManualTransactionIds,
  writeEnabled,
  unseenOperationCount,
  onOpenQueryTask,
  onOpenAgentTask,
  onOpenManualTransaction,
  onCommitManualTransaction,
  onRollbackManualTransaction,
  onCancelBackgroundTask,
  onRevealDatabaseContext,
  onOpenNotifications,
  onSafetySettings,
}: {
  selected: ConnectionProfile | null;
  selectedTable: CatalogTable | null;
  selectedDatabase: string | null;
  selectedNamespace: string | null;
  activeDocument: WorkbenchDocument | null;
  knowledgeFocus: KnowledgeEnvironmentFocus | null;
  backgroundTasks: BackgroundTask[];
  cancellingBackgroundTaskKeys: ReadonlySet<string>;
  manualTransactions: WorkspaceManualTransaction[];
  settlingManualTransactionIds: ReadonlySet<string>;
  writeEnabled: boolean;
  unseenOperationCount: number;
  onOpenQueryTask: (sessionId: string) => void;
  onOpenAgentTask: (connectionId: string) => void;
  onOpenManualTransaction: (
    transaction: WorkspaceManualTransaction,
  ) => void;
  onCommitManualTransaction: (
    transaction: WorkspaceManualTransaction,
  ) => Promise<void>;
  onRollbackManualTransaction: (
    transaction: WorkspaceManualTransaction,
  ) => Promise<void>;
  onCancelBackgroundTask: (task: BackgroundTask) => Promise<void>;
  onRevealDatabaseContext: () => void;
  onOpenNotifications: () => void;
  onSafetySettings: () => void;
}) {
  const { t } = useI18n();
  const breadcrumbs: Array<{
    id: string;
    label: string;
    onSelect?: () => void;
  }> = knowledgeFocus
    ? [
        {
          id: "projects",
          label: t("connections.projects"),
        },
        {
          id: `knowledge:${knowledgeFocus.view}`,
          label: t(
            knowledgeFocus.view === "analyses"
              ? "analysis.title"
              : knowledgeFocus.view === "sources"
                ? "knowledge.sources"
                : "connections.environmentDatabases",
          ),
        },
      ]
    : [
        {
          id: "database",
          label: t("ide.databaseRoot"),
          onSelect: onRevealDatabaseContext,
        },
      ];
  if (!knowledgeFocus && selected) {
    const selectedDatabaseLabel = selectedDatabase
      ? databaseDisplayLabel(selected.engine, selectedDatabase)
      : null;
    breadcrumbs.push({
      id: `connection:${selected.id}`,
      label: selected.name || t("app.unnamed"),
      onSelect: onRevealDatabaseContext,
    });
    if (selected.providerTarget) {
      const target = selected.providerTarget;
      const state = target.pendingState ?? target.currentState;
      breadcrumbs.push({
        id: `provider-target:${target.branchId}`,
        label: state
          ? `${providerTargetDisplayName(target)} · ${state}`
          : providerTargetDisplayName(target),
        onSelect: onRevealDatabaseContext,
      });
    }
    if (selectedDatabase) {
      breadcrumbs.push({
        id: `database:${selectedDatabase}`,
        label: selectedDatabaseLabel ?? selectedDatabase,
        onSelect: onRevealDatabaseContext,
      });
    }
    if (
      selectedNamespace &&
      selectedNamespace.toLocaleLowerCase() !==
        selectedDatabase?.toLocaleLowerCase() &&
      selectedNamespace.toLocaleLowerCase() !==
        selectedDatabaseLabel?.toLocaleLowerCase()
    ) {
      breadcrumbs.push({
        id: `namespace:${selectedNamespace}`,
        label: selectedNamespace,
        onSelect: onRevealDatabaseContext,
      });
    }
    if (selectedTable) {
      const relationGroup =
        selected.engine === "mongodb"
          ? t("ide.collections")
          : selectedTable.kind.toLocaleLowerCase().includes("view")
            ? t("ide.views")
            : t("ide.tables");
      breadcrumbs.push(
        {
          id: `group:${relationGroup}`,
          label: relationGroup,
          onSelect: onRevealDatabaseContext,
        },
        {
          id: `relation:${selectedTable.name}`,
          label: tableLabel(selected.engine, selectedTable),
          onSelect: onRevealDatabaseContext,
        },
      );
    } else if (activeDocument?.kind === "sql") {
      breadcrumbs.push({
        id: `document:${activeDocument.id}`,
        label: activeDocument.title,
      });
    } else if (
      activeDocument?.kind === "schema" ||
      activeDocument?.kind === "activity" ||
      activeDocument?.kind === "documents"
    ) {
      breadcrumbs.push({
        id: `document:${activeDocument.id}`,
        label: t(`tabs.${activeDocument.kind}`),
      });
    }
  }

  return (
    <IdeStatusBarSurface
      label={t("ide.statusBar")}
      breadcrumbs={
        <StatusBarBreadcrumbs
          label={t("ide.databaseNavigation")}
          items={breadcrumbs}
        />
      }
    >
      {manualTransactions.length > 0 ? (
        <ManualTransactionsMenu
          transactions={manualTransactions}
          settlingIds={settlingManualTransactionIds}
          onOpen={onOpenManualTransaction}
          onCommit={onCommitManualTransaction}
          onRollback={onRollbackManualTransaction}
        />
      ) : null}
      {backgroundTasks.length > 0 ? (
        <BackgroundTasksMenu
          tasks={backgroundTasks}
          cancellingKeys={cancellingBackgroundTaskKeys}
          onCancel={onCancelBackgroundTask}
          onOpenAgent={onOpenAgentTask}
          onOpenQuery={onOpenQueryTask}
        />
      ) : null}
      <SqlEditorStatusItems
        documentId={
          !knowledgeFocus && activeDocument?.kind === "sql"
            ? activeDocument.id
            : null
        }
      />
      {selected ? (
        <StatusBarIconButton
          icon={writeEnabled ? "unlock" : "lock"}
          label={writeEnabled ? t("ide.writeEnabled") : t("ide.readOnly")}
          onClick={onSafetySettings}
        />
      ) : null}
      <StatusBarIconButton
        icon="bell"
        label={
          unseenOperationCount > 0
            ? t("ide.notificationsUnread", {
                count: unseenOperationCount,
              })
            : t("ide.notifications")
        }
        onClick={onOpenNotifications}
        attention={unseenOperationCount > 0}
        disabled={!selected}
      />
    </IdeStatusBarSurface>
  );
}

function SqlEditorStatusItems({ documentId }: { documentId: string | null }) {
  const { t } = useI18n();
  const editorStatus = useSqlEditorCursor(documentId);
  return (
    <>
      {editorStatus ? (
        <>
          <StatusBarItem>
            {editorStatus.line}:{editorStatus.column}
          </StatusBarItem>
          <StatusBarItem>LF</StatusBarItem>
        </>
      ) : null}
      <StatusBarItem>UTF-8</StatusBarItem>
      {editorStatus ? (
        <StatusBarItem>
          {t("ide.indentSpaces", {
            count: SQL_EDITOR_INDENT_SIZE,
          })}
        </StatusBarItem>
      ) : null}
    </>
  );
}
