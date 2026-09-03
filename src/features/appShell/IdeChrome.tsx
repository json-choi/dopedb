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
import ManualTransactionsMenu from "../queries/ManualTransactionsMenu";
import type { WorkspaceManualTransaction } from "../queries/useWorkspaceManualTransactions";
import { SQL_EDITOR_INDENT_SIZE } from "../queries/editorStatus";
import { useSqlEditorCursor } from "../queries/editorStatusStore";
import { Icon } from "../../components/Icon";
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
  databaseExplorerOpen,
  localHistoryOpen,
  servicesOpen,
  agentDockOpen,
  actionSearchOpen,
  settingsOpen,
  workspace,
  account,
  onNewQuery,
  onToggleDatabaseExplorer,
  onToggleLocalHistory,
  onToggleServices,
  onOpenAgent,
  agentButtonRef,
  actionSearchButtonRef,
  onActionSearch,
  onSettings,
}: {
  selected: ConnectionProfile | null;
  supportsSql: boolean;
  databaseExplorerOpen: boolean;
  localHistoryOpen: boolean;
  servicesOpen: boolean;
  agentDockOpen: boolean;
  actionSearchOpen: boolean;
  settingsOpen: boolean;
  workspace: ReactNode;
  account: ReactNode;
  onNewQuery: () => void;
  onToggleDatabaseExplorer: () => void;
  onToggleLocalHistory: () => void;
  onToggleServices: () => void;
  onOpenAgent: () => void;
  agentButtonRef: RefObject<HTMLButtonElement | null>;
  actionSearchButtonRef: RefObject<HTMLButtonElement | null>;
  onActionSearch: (returnFocus?: HTMLElement | null) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const queryDisabled = !selected || !supportsSql;

  return (
    <IdeTitleToolbar
      macosInset={IS_MACOS}
      context={workspace}
      launchersLabel={t("ide.mainToolbar")}
      launchers={
        <>
        <IdeToolbarLauncher
          active={databaseExplorerOpen}
          onClick={() => {
            onToggleDatabaseExplorer();
          }}
          title={t("ide.action.databaseExplorer")}
          aria-label={t("ide.action.databaseExplorer")}
        >
          <Icon name="database" />
        </IdeToolbarLauncher>
        <IdeToolbarLauncher
          active={servicesOpen}
          onClick={onToggleServices}
          title={t("services.title")}
          aria-label={t("services.title")}
        >
          <Icon name="list" />
        </IdeToolbarLauncher>
        <IdeToolbarLauncher
          buttonRef={agentButtonRef}
          active={agentDockOpen}
          disabled={!selected}
          onClick={onOpenAgent}
          title={t("agent.acpTitle")}
          aria-label={t("agent.acpTitle")}
        >
          <Icon name="user" />
        </IdeToolbarLauncher>
        <ToolbarMenu
          align="start"
          icon="moreHorizontal"
          label={t("ide.action.more")}
        >
          <ToolbarMenuItem
            icon={localHistoryOpen ? "check" : "history"}
            disabled={!selected || !supportsSql}
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
        <div className="tw:size-8 tw:shrink-0">{account}</div>
        <IdeToolbarLauncher
          buttonRef={actionSearchButtonRef}
          active={actionSearchOpen}
          onClick={(event) => {
            onActionSearch(event.currentTarget);
          }}
          title={t("ide.action.actionSearch")}
          aria-label={t("ide.action.actionSearch")}
        >
          <Icon name="search" />
        </IdeToolbarLauncher>
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
  }> = [
    {
      id: "database",
      label: t("ide.databaseRoot"),
      onSelect: onRevealDatabaseContext,
    },
  ];
  if (selected) {
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
        label: databaseDisplayLabel(selected.engine, selectedDatabase),
        onSelect: onRevealDatabaseContext,
      });
    }
    if (selectedNamespace) {
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
          activeDocument?.kind === "sql" ? activeDocument.id : null
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
