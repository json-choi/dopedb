// Manual SQL console. Editable CodeMirror. Run is the human approval action;
// execution results and output occupy the central document.
// Multi-statement scripts execute through the backend script runner and preserve
// per-statement results. ⌘↩ and the toolbar Run both run the selection when there
// is one ("Run selection"), otherwise choose current statement/all for a script;
// ⌘. / Ctrl+. cancels a run.
// The editor stays above its results in a resizable split. Executing updates
// results without hiding the editor or moving focus away from the query.
import { useEffect } from "react";
import { StatusBadge } from "../../design-system/components/Status";
import QueryResultsPane from "../../features/queryServices/QueryResultsPane";
import type { QueryServiceStore } from "../../features/queryServices/store";
import { Icon } from "../../components/Icon";
import LazySqlViewer from "../../components/LazySqlViewer";
import {
  WorkbenchButton,
  WorkbenchContainedBody,
  WorkbenchDivider,
  WorkbenchPane,
  WorkbenchSelect,
  WorkbenchToolbar,
} from "../../design-system/components/Workbench";
import ManualTransactionControls from "../../features/queries/ManualTransactionControls";
import SqlResultSplit from "../../features/queries/SqlResultSplit";
import type { SqlResolveMode } from "../../features/queries/resolveMode";
import {
  useSqlWorkbenchController,
  type SqlWorkbenchProps,
} from "../../features/queries/useSqlWorkbenchController";
import { databaseDisplayLabel } from "../../features/connections/domain";
import { useI18n } from "../../lib/i18n";
import SqlDocumentDetails from "./SqlDocumentDetails";
import SqlParameterDialog from "./SqlParameterDialog";
import SqlRunMenu from "./SqlRunMenu";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Macintosh|Mac OS X/.test(navigator.userAgent);

export default function Sql(props: Omit<SqlWorkbenchProps, "onShowResult"> & {
  resultStore: QueryServiceStore;
  onOpenResults: () => void;
  onOpenSafety: (connectionId: string) => void;
}) {
  const { t } = useI18n();
  const {
    connection,
    safety,
    safetyReady,
    safetyLoadError,
    resolveMode,
    setResolveMode,
    setSelectedDatabase,
    setSelectedSchema,
    recovered,
    onOpenHistory,
    onRetrySafety,
  } = props;
  const {
    analysisCurrent,
    applyParameterValues,
    cancelRun,
    catalog,
    closeParameterDialog,
    closePlan,
    databaseOptions,
    documentConflict,
    documentSaveError,
    documentSaveState,
    draft,
    draftIsScript,
    draftParameterCount,
    draftSignal,
    editorExecutionStatus,
    effectiveDatabase,
    effectiveNamespace,
    elapsed,
    executeSql,
    executeSqlFromEditor,
    explain,
    explaining,
    flushEditorState,
    formatDraft,
    formatError,
    formatting,
    handleCursorChange,
    handleEditorReady,
    handleSelectionChange,
    hasSelection,
    errorLocation,
    jumpToError,
    latestSessionId,
    rerunSql,
    keepLocalConflictVersion,
    loadSavedConflictVersion,
    manualTransaction,
    namespaceOptions,
    openParameterDialog,
    parameterDialog,
    parameterValues,
    plan,
    planErr,
    resolveModeHint,
    running,
    runChooser,
    setDraft,
  } = useSqlWorkbenchController({
    ...props,
    onShowResult: (sessionId) => props.resultStore.activate(sessionId),
  });

  // ⌘. (macOS) / Ctrl+. cancels this document's run from anywhere while it runs.
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = IS_MAC
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (event.key !== "." || !modifier || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || event.repeat) return;
      event.preventDefault();
      cancelRun();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelRun, running]);

  const runLabel = hasSelection ? t("sql.runSelection") : t("sql.run");
  const errorNavigation =
    errorLocation && latestSessionId
      ? {
          sessionId: latestSessionId,
          line: errorLocation.line,
          column: errorLocation.column,
          jump: jumpToError,
        }
      : null;

  return (
    <WorkbenchPane>
      <WorkbenchToolbar label={t("sql.documentTitle")} compact>
        <div className="ds-control-row scrollbar-sleek tw:flex tw:min-h-0 tw:min-w-0 tw:flex-[0_1_auto] tw:flex-nowrap tw:items-center tw:gap-1 tw:overflow-x-auto tw:overflow-y-hidden">
          <WorkbenchButton
            iconOnly
            tone="success"
            disabled={draft.length === 0 || running || !safetyReady}
            onClick={() => void executeSql()}
            title={`${runLabel} · ${t(IS_MAC ? "sql.runHintMac" : "sql.runHintOther")}`}
            aria-label={running ? t("sql.running") : runLabel}
          >
            <Icon name={running ? "refresh" : "play"} />
          </WorkbenchButton>
          <WorkbenchButton
            iconOnly
            onClick={onOpenHistory}
            title={t("sql.history")}
            aria-label={t("sql.history")}
          >
            <Icon name="history" />
          </WorkbenchButton>
          <WorkbenchButton
            iconOnly
            disabled={!analysisCurrent || draftParameterCount === 0 || running}
            onClick={openParameterDialog}
            title={
              draftParameterCount > 0
                ? t("sql.viewParametersCount", {
                    count: draftParameterCount,
                  })
                : t("sql.noParameters")
            }
            aria-label={t("sql.viewParameters")}
          >
            <Icon name="parameter" />
          </WorkbenchButton>
          <WorkbenchButton
            iconOnly
            disabled={
              draft.length === 0 ||
              !analysisCurrent ||
              (draftIsScript && !hasSelection) ||
              explaining ||
              running ||
              !safetyReady
            }
            title={
              draftIsScript && !hasSelection
                ? t("sql.explainSingle")
                : hasSelection
                  ? t("sql.explainSelectionTitle")
                  : t("sql.explainTitle")
            }
            aria-label={t("sql.explain")}
            onClick={explain}
          >
            <Icon name={explaining ? "refresh" : "target"} />
          </WorkbenchButton>
          <WorkbenchButton
            iconOnly
            disabled={draft.length === 0 || formatting || running}
            onClick={() => void formatDraft()}
            title={t("sql.formatTitle")}
            aria-label={t("sql.format")}
          >
            <Icon name={formatting ? "refresh" : "list"} />
          </WorkbenchButton>
          <WorkbenchDivider />
          {!safetyReady ? (
            <WorkbenchButton
              size="xs"
              tone={safetyLoadError ? "danger" : "neutral"}
              onClick={onRetrySafety}
              title={safetyLoadError ?? t("sql.safetyLoading")}
            >
              <Icon name={safetyLoadError ? "alert" : "refresh"} />
              {safetyLoadError ? t("sql.retrySafety") : t("sql.safetyLoading")}
            </WorkbenchButton>
          ) : (
            <ManualTransactionControls
              controller={manualTransaction}
              writesEnabled={safety.allowWrites}
              writesDisabledHint={
                safety.allowWrites ? undefined : t("sql.txManualWritesRequired")
              }
              disabled={running}
            />
          )}
          <WorkbenchSelect
            label={t("sql.resolveMode")}
            title={resolveModeHint}
            value={resolveMode}
            disabled={running}
            onChange={(value) => setResolveMode(value as SqlResolveMode)}
          >
            <option value="playground">{t("sql.resolveModePlayground")}</option>
            <option value="script">{t("sql.resolveModeScript")}</option>
          </WorkbenchSelect>
          {!running && draftSignal && draftSignal.tone !== "muted" ? (
            <StatusBadge
              tone={draftSignal.tone === "danger" ? "danger" : draftSignal.tone === "warning" ? "warning" : "neutral"}
              iconOnly
              title={draftSignal.title ?? draftSignal.text}
              aria-label={draftSignal.text}
              role="img"
            >
              <Icon name={draftSignal.icon ?? "info"} />
            </StatusBadge>
          ) : null}
        </div>
        <WorkbenchButton
          iconOnly
          disabled={!running}
          onClick={cancelRun}
          title={[
            t("sql.cancel"),
            t(IS_MAC ? "sql.cancelHintMac" : "sql.cancelHintOther"),
            ...(running ? [t("sql.runningFor", { seconds: elapsed })] : []),
          ].join(" · ")}
          aria-label={t("sql.cancel")}
          aria-keyshortcuts={IS_MAC ? "Meta+." : "Control+."}
        >
          <Icon name="stop" />
        </WorkbenchButton>
        <WorkbenchButton
          iconOnly
          disabled={running}
          onClick={props.onOpenResults}
          title={t("sql.executionResults")}
          aria-label={t("sql.executionResults")}
        >
          <Icon name="table" />
        </WorkbenchButton>
        <span className="tw:min-w-1 tw:flex-1" />
        <WorkbenchSelect
          label={t("sql.databaseSelector")}
          title={t("sql.databaseSelectorHint", {
            connection: connection.name || t("app.unnamed"),
            database: databaseDisplayLabel(
              connection.engine,
              effectiveDatabase,
            ),
          })}
          icon="database"
          value={effectiveDatabase}
          disabled={running || databaseOptions.length < 2}
          onChange={setSelectedDatabase}
        >
          {databaseOptions.map((database) => (
            <option key={database} value={database}>
              {databaseDisplayLabel(connection.engine, database)}
            </option>
          ))}
        </WorkbenchSelect>
        <WorkbenchSelect
          label={t("sql.schemaSelector")}
          title={t("sql.schemaSelectorHint", {
            connection: connection.name || t("app.unnamed"),
            schema: effectiveNamespace,
          })}
          icon="database"
          value={effectiveNamespace}
          disabled={running || namespaceOptions.length === 0}
          onChange={setSelectedSchema}
        >
          {namespaceOptions.map((namespace) => (
            <option key={namespace} value={namespace}>
              {namespace}
            </option>
          ))}
        </WorkbenchSelect>
        {documentSaveState !== "saved" ? (
          <span
            data-state={documentSaveState}
            className="tw:grid tw:size-control-sm tw:shrink-0 tw:place-items-center tw:text-muted-foreground tw:data-[state=conflict]:text-danger tw:data-[state=error]:text-danger tw:data-[state=saving]:text-primary"
            title={
              documentSaveError ??
              (documentSaveState === "saving"
                ? t("common.saving")
                : documentSaveState === "conflict"
                  ? t("sql.saveConflict")
                  : documentSaveState === "error"
                    ? t("sql.saveFailed")
                    : recovered
                      ? t("sql.recovered")
                      : t("sql.unsaved"))
            }
            role="status"
          >
            <Icon
              name={
                documentSaveState === "saving"
                  ? "refresh"
                  : documentSaveState === "conflict" ||
                      documentSaveState === "error"
                    ? "alert"
                    : "info"
              }
            />
          </span>
        ) : null}
      </WorkbenchToolbar>
      <SqlResultSplit editor={
        <WorkbenchContainedBody>
          <div
            data-workbench-scroll-owner="sql-editor"
            className="tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-background tw:[&>.dopedb-sql-viewer]:h-full tw:[&_.cm-editor]:h-full tw:[&_.cm-editor]:bg-background tw:[&_.cm-scroller]:min-h-0 tw:[&_.cm-scroller]:overflow-auto tw:[&_.cm-scroller]:overscroll-contain"
          >
            <LazySqlViewer
              value={draft}
              editable
              onChange={setDraft}
              onRun={executeSqlFromEditor}
              catalog={catalog}
              engine={connection.engine}
              resolveMode={resolveMode}
              defaultSchema={effectiveNamespace}
              namespaceOptions={namespaceOptions}
              minHeight="0px"
              onCursorChange={handleCursorChange}
              onSelectionChange={handleSelectionChange}
              onEditorReady={handleEditorReady}
              onBlur={flushEditorState}
              executionStatus={editorExecutionStatus}
              previewSource={runChooser.previewSource}
              errorRange={errorLocation}
              ariaLabel={t("sql.editorLabel", {
                connection: connection.name || t("app.unnamed"),
              })}
            />
          </div>

          <SqlDocumentDetails
            conflict={!!documentConflict}
            onLoadSaved={loadSavedConflictVersion}
            onKeepMine={keepLocalConflictVersion}
            saveState={documentSaveState}
            saveError={documentSaveError}
            formatError={formatError}
            plan={plan}
            planError={planErr}
            onClosePlan={closePlan}
          />
        </WorkbenchContainedBody>
      } result={
        <QueryResultsPane
          store={props.resultStore}
          connection={connection}
          documentId={props.documentId}
          onOpenSafety={props.onOpenSafety}
          onRerun={(session) => rerunSql(session.sql)}
          onOpenActivity={onOpenHistory}
          errorNavigation={errorNavigation}
        />
      } />
      <SqlRunMenu chooser={runChooser} />
      {parameterDialog ? (
        <SqlParameterDialog
          parameters={parameterDialog.parameters}
          initialValues={parameterValues}
          action={parameterDialog.action}
          onCancel={closeParameterDialog}
          onApply={applyParameterValues}
        />
      ) : null}
    </WorkbenchPane>
  );
}
