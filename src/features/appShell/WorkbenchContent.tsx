import { lazy, Suspense, type ReactNode } from "react";

import { Icon } from "../../components/Icon";
import WorkbenchDocumentStrip from "../../components/WorkbenchDocumentStrip";
import { Button } from "../../design-system/components/Button";
import RenderRecoveryBoundary from "../../design-system/components/RenderRecoveryBoundary";
import { LoadingLabel } from "../../design-system/components/Status";
import { WorkbenchEmptyState } from "../../design-system/components/Workbench";
import type { CatalogTable, SafetySettings } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { SchemaConnectionGroup } from "../../lib/schemaDiff";
import Onboarding from "../../screens/Onboarding";
import type { ConnectionProfile } from "../connections/domain";
import {
  isDemoSqliteConnection,
  type ConnectionLaunchPreset,
} from "../connections/presets";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import type { QueryServiceSession } from "../queryServices/domain";
import type { SqlResolveMode } from "../queries/resolveMode";
import { effectiveSafetySettings } from "../safetySettings/policy";
import type { SettingsSection } from "../settings/domain";
import type { SqlDocument } from "../sqlDocuments/domain";
import type { AppUpdaterSnapshot } from "../updater/controller";
import type { WorkbenchDocument } from "../workbench/domain";
import ConnectionPicker from "./ConnectionPicker";
import type { EditingConnection } from "./useAppShellWorkbenchController";

const Activity = lazy(() => import("../../screens/Activity"));
const ConnectionForm = lazy(() =>
  import("../../screens/Connections/ConnectionForm").then((module) => ({
    default: module.ConnectionForm,
  })),
);
const Documents = lazy(() => import("../../screens/Documents"));
const Knowledge = lazy(() => import("../../screens/Knowledge"));
const SchemaExplorer = lazy(() => import("../../screens/Schema"));
const SchemaDiff = lazy(() => import("../../screens/SchemaDiff"));
const Settings = lazy(() => import("../../screens/Settings"));
const Sql = lazy(() => import("../../screens/Sql"));
const TableData = lazy(() => import("../../screens/Tables"));

// The editor may render while policy storage is unavailable, but all execution
// remains disabled until the authoritative connection policy arrives.
const BLOCKED_SAFETY_SETTINGS: SafetySettings = {
  allowWrites: false,
  allowSchemaChanges: false,
  wrapWritesInTx: true,
  explainPreview: true,
  autoRunReads: false,
  maxRows: 1_000,
  execPreviewRowLimit: 0,
};

type WorkbenchContentModel = {
  route: {
    settingsOpen: boolean;
    settingsSection?: SettingsSection;
    activeSchemaGroup: SchemaConnectionGroup | null;
    editing: EditingConnection;
    connectionPreset: ConnectionLaunchPreset | null;
    knowledgeEnvironmentFocus: KnowledgeEnvironmentFocus | null;
  };
  connection: {
    selected: ConnectionProfile | null;
    items: ConnectionProfile[];
    loadError: string | null;
    supportsSql: boolean;
    creatingDemo: boolean;
    guidedDemoAvailable: boolean;
    safety: SafetySettings | null;
    safetyError: string | null;
  };
  workbench: {
    items: WorkbenchDocument[];
    active: WorkbenchDocument | null;
    activeId: string | null;
  };
  update: { snapshot: AppUpdaterSnapshot };
};

type WorkbenchContentCommands = {
  route: {
    closeSettings: () => void;
    closeSurface: () => void;
  };
  connections: {
    retry: () => void;
    new: (preset?: ConnectionLaunchPreset) => void;
    edit: (connection: ConnectionProfile) => void;
    delete: (id: string) => Promise<void>;
    select: (id: string) => void;
    save: (
      profile: ConnectionProfile,
      closeEditor: boolean,
    ) => Promise<void>;
    update: (connection: ConnectionProfile) => void;
    createDemo: () => void;
  };
  safety: {
    refresh: () => void;
    accept: (connectionId: string, settings: SafetySettings) => void;
  };
  documents: {
    activateId: (id: string) => void;
    rename: (id: string, title: string) => void;
    close: (id: string) => void;
    newQuery: () => void;
    openAgentTask: (
      connectionId: string,
      environmentId?: string,
      prompt?: string,
    ) => void;
    setTitle: (value: string) => void;
    setDatabase: (value: string) => void;
    setSchema: (value: string | null) => void;
    setResolveMode: (value: SqlResolveMode) => void;
    persisted: (document: SqlDocument) => void;
    openTable: (connection: ConnectionProfile, table: CatalogTable) => void;
    openStable: (kind: "schema" | "activity") => void;
    loadSql: (sql: string) => Promise<void>;
  };
  queryServices: {
    updateSession: (session: QueryServiceSession) => void;
    show: (sessionId: string) => void;
  };
  update: {
    refresh: () => Promise<void>;
    install: () => Promise<void>;
  };
  guidedDemo: {
    browseOrders: () => void;
    analyzeRevenue: () => void;
    practiceApproval: () => void;
    openSafety: () => void;
  } | null;
};

type Props = {
  model: WorkbenchContentModel;
  commands: WorkbenchContentCommands;
};

export default function WorkbenchContent(props: Props) {
  return (
    <Suspense fallback={<WorkbenchLoading />}>
      <WorkbenchContentResolved {...props} />
    </Suspense>
  );
}

function WorkbenchLoading() {
  const { t } = useI18n();
  return (
    <div className="tw:flex tw:h-full tw:min-h-0 tw:items-center tw:justify-center tw:bg-background">
      <LoadingLabel>{t("app.loading")}</LoadingLabel>
    </div>
  );
}

function WorkbenchContentResolved({ model, commands }: Props) {
  const { t } = useI18n();
  const { route, connection, workbench, update } = model;
  const selected = connection.selected;
  const activeDocument = workbench.active;
  const effectiveSafety =
    selected && connection.safety
      ? effectiveSafetySettings(selected, connection.safety)
      : null;
  const guidedDemo =
    selected &&
    isDemoSqliteConnection(selected) &&
    commands.guidedDemo
      ? {
          writeEnabled: Boolean(effectiveSafety?.allowWrites),
          onBrowseOrders: commands.guidedDemo.browseOrders,
          onAnalyzeRevenue: commands.guidedDemo.analyzeRevenue,
          onPracticeApproval: commands.guidedDemo.practiceApproval,
          onOpenSafety: commands.guidedDemo.openSafety,
        }
      : undefined;
  const settingsDialog = route.settingsOpen ? (
    <Settings
      connection={selected}
      initialSection={route.settingsSection}
      refreshSafety={commands.safety.refresh}
      onSafetySaved={commands.safety.accept}
      onConnectionUpdated={commands.connections.update}
      updater={update.snapshot}
      onUpdateRefresh={commands.update.refresh}
      onUpdateInstall={commands.update.install}
      onClose={commands.route.closeSettings}
    />
  ) : null;
  const withSettings = (content: ReactNode) => (
    <>
      {content}
      {settingsDialog}
    </>
  );

  if (route.activeSchemaGroup) {
    return withSettings(
      <SchemaDiff
        key={route.activeSchemaGroup.key}
        group={route.activeSchemaGroup}
        onClose={commands.route.closeSurface}
      />,
    );
  }

  if (route.editing !== null) {
    return withSettings(
      <div className="tw:h-full tw:min-h-0">
        <ConnectionForm
          key={
            route.editing === "new"
              ? `connection-new-${route.connectionPreset?.engine ?? "default"}-${route.connectionPreset?.provider ?? "auto"}-${route.connectionPreset?.source ?? "standard"}`
              : `connection-${route.editing.id}`
          }
          initial={route.editing === "new" ? null : route.editing}
          preset={route.editing === "new" ? route.connectionPreset : null}
          connections={connection.items}
          creatingDemo={connection.creatingDemo}
          onCreateDemoDatabase={commands.connections.createDemo}
          onNewConnection={commands.connections.new}
          onEditConnection={commands.connections.edit}
          onDeletedConnection={commands.connections.delete}
          onSaved={commands.connections.save}
          onCancel={commands.route.closeSurface}
        />
      </div>,
    );
  }

  if (route.knowledgeEnvironmentFocus) {
    const focus = route.knowledgeEnvironmentFocus;
    return withSettings(
      <section className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:bg-background">
        <RenderRecoveryBoundary
          fallback={({ retry }) => (
            <KnowledgeRecovery onRetry={retry} />
          )}
          resetKeys={[focus.requestId]}
        >
          <Knowledge
            environmentFocus={focus}
            onOpenAgent={commands.documents.openAgentTask}
            onNewConnection={() => commands.connections.new()}
          />
        </RenderRecoveryBoundary>
      </section>,
    );
  }

  if (connection.loadError) {
    return withSettings(
      <div className="tw:flex tw:h-full tw:min-w-0 tw:flex-col tw:items-center tw:justify-center tw:gap-2 tw:bg-muted tw:p-[var(--ds-pane-pad)] tw:text-center tw:leading-relaxed tw:[&>*]:max-w-[min(520px,100%)]">
        <div className="tw:break-words tw:text-ui tw:text-danger" role="alert">
          {t("app.couldNotLoadConnections", {
            error: connection.loadError,
          })}
        </div>
        <Button onClick={commands.connections.retry}>{t("app.retry")}</Button>
      </div>,
    );
  }

  if (connection.items.length === 0) {
    return withSettings(
      <Onboarding
        creatingDemo={connection.creatingDemo}
        guidedDemoAvailable={connection.guidedDemoAvailable}
        onCreateDemoDatabase={commands.connections.createDemo}
        onNewConnection={() => commands.connections.new()}
      />,
    );
  }

  const safetyFallback = connection.safetyError ? (
    <div className="tw:text-ui tw:text-danger" role="alert">
      {t("app.loadSafetyFailed", { error: connection.safetyError })}{" "}
      <Button size="compact" onClick={commands.safety.refresh}>
        {t("app.retry")}
      </Button>
    </div>
  ) : (
    <div className="tw:text-muted-foreground">{t("app.loading")}</div>
  );

  return (
    <>
      {selected && (
        <WorkbenchDocumentStrip
          documents={workbench.items}
          activeId={workbench.activeId}
          engine={selected.engine}
          connectionName={selected.name || t("app.unnamed")}
          onActivate={commands.documents.activateId}
          onRename={commands.documents.rename}
          onClose={commands.documents.close}
        />
      )}

      <section
        data-workbench-pane
        data-edge-to-edge={
          activeDocument !== null && activeDocument.kind !== "welcome"
        }
        className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:bg-background tw:p-[var(--ds-pane-pad)] tw:shadow-[inset_0_var(--ds-border-width)_0_var(--ds-border-subtle)] tw:data-[edge-to-edge=true]:overflow-hidden tw:data-[edge-to-edge=true]:p-0 tw:max-[760px]:p-3 tw:max-[760px]:data-[edge-to-edge=true]:p-0"
      >
        {!selected ? (
          <ConnectionPicker
            connections={connection.items}
            onSelect={commands.connections.select}
            onNew={commands.connections.new}
          />
        ) : !activeDocument ? (
          connection.supportsSql ? (
            <WorkbenchEmptyState icon="play">
              <span>{t("tabs.sql")}</span>
              <Button variant="primary" onClick={commands.documents.newQuery}>
                <Icon name="plus" />
                {t("tabs.sql")}
              </Button>
            </WorkbenchEmptyState>
          ) : (
            <Documents key={`${selected.id}:mongo-query`} connection={selected} />
          )
        ) : activeDocument.kind === "welcome" ? (
          <Onboarding
            connectionName={selected.name || selected.database}
            guidedDemo={guidedDemo}
            onNewConnection={() => commands.connections.new()}
            onNewQuery={commands.documents.newQuery}
          />
        ) : activeDocument.kind === "data" ? (
          effectiveSafety ? (
            <TableData
              connection={selected}
              table={activeDocument.table}
              safety={effectiveSafety}
            />
          ) : (
            safetyFallback
          )
        ) : activeDocument.kind === "schema" ? (
          <SchemaExplorer
            key={activeDocument.id}
            connection={selected}
            selectedTable={null}
            onOpenTable={(table) => commands.documents.openTable(selected, table)}
          />
        ) : activeDocument.kind === "sql" ? (
          <Sql
            key={activeDocument.id}
            connection={selected}
            documentId={activeDocument.id}
            safety={effectiveSafety ?? BLOCKED_SAFETY_SETTINGS}
            safetyReady={connection.safety !== null}
            safetyLoadError={connection.safetyError}
            draft={activeDocument.draft}
            title={activeDocument.title}
            setTitle={commands.documents.setTitle}
            selectedDatabase={activeDocument.selectedDatabase}
            setSelectedDatabase={commands.documents.setDatabase}
            selectedSchema={activeDocument.selectedSchema}
            setSelectedSchema={commands.documents.setSchema}
            resolveMode={activeDocument.resolveMode}
            setResolveMode={commands.documents.setResolveMode}
            persistedId={activeDocument.persistedId}
            revision={activeDocument.revision}
            recovered={activeDocument.recovered}
            onPersisted={commands.documents.persisted}
            onQueryServiceSessionChange={commands.queryServices.updateSession}
            onShowQueryServices={commands.queryServices.show}
            onOpenHistory={() => commands.documents.openStable("activity")}
            onRetrySafety={commands.safety.refresh}
          />
        ) : activeDocument.kind === "documents" ? (
          <Documents
            key={activeDocument.id}
            connection={selected}
            draft={activeDocument.draft}
          />
        ) : (
          <Activity
            key={activeDocument.id}
            connection={selected}
            onLoadSql={commands.documents.loadSql}
          />
        )}
      </section>
      {settingsDialog}
    </>
  );
}

function KnowledgeRecovery({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="tw:flex tw:h-full tw:min-h-[240px] tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:p-[var(--ds-pane-pad)] tw:text-center tw:text-sm tw:text-muted-foreground"
      role="alert"
    >
      <Icon className="tw:size-7 tw:text-warning" name="alert" />
      <strong className="tw:text-title tw:text-foreground">
        {t("knowledge.renderFailed")}
      </strong>
      <p className="tw:m-0 tw:max-w-[420px] tw:leading-body">
        {t("knowledge.renderFailedBody")}
      </p>
      <Button onClick={onRetry} size="compact" variant="primary">
        <Icon name="refresh" />
        {t("knowledge.retry")}
      </Button>
    </div>
  );
}
