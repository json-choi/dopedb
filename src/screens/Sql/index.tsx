// Manual SQL console. Editable CodeMirror. Run is the human approval action;
// execution sessions and Output/Result live in the shell-owned Services window.
// Multi-statement scripts execute through the backend script runner and preserve
// per-statement results. ⌘↩ runs the current draft or selected SQL.
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
import type { SqlResolveMode } from "../../features/queries/resolveMode";
import {
  useSqlWorkbenchController,
  type SqlWorkbenchProps,
} from "../../features/queries/useSqlWorkbenchController";
import { databaseDisplayLabel } from "../../features/connections/domain";
import { useI18n } from "../../lib/i18n";
import SqlParameterDialog from "./SqlParameterDialog";

export default function Sql(props: SqlWorkbenchProps) {
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
    formatting,
    handleCursorChange,
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
    setDraft,
  } = useSqlWorkbenchController(props);

  return (
    <WorkbenchPane>
      <WorkbenchToolbar label={t("sql.documentTitle")} compact>
        <div className="ds-control-row scrollbar-sleek tw:flex tw:min-h-0 tw:min-w-0 tw:flex-[0_1_auto] tw:flex-nowrap tw:items-center tw:gap-1 tw:overflow-x-auto tw:overflow-y-hidden tw:max-[760px]:shrink-0">
          <WorkbenchButton
            iconOnly
            tone="success"
            disabled={draft.length === 0 || running || !safetyReady}
            onClick={() => void executeSql()}
            title={t("sql.runHint")}
            aria-label={running ? t("sql.running") : t("sql.run")}
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
              draftIsScript ||
              explaining ||
              running ||
              !safetyReady
            }
            title={
              draftIsScript ? t("sql.explainSingle") : t("sql.explainTitle")
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
            <button
              type="button"
              className="badge tw:cursor-pointer tw:border-warning tw:bg-transparent tw:text-warning"
              onClick={onRetrySafety}
              title={safetyLoadError ?? t("sql.safetyLoading")}
            >
              <Icon name={safetyLoadError ? "alert" : "refresh"} />
              {safetyLoadError ? t("sql.retrySafety") : t("sql.safetyLoading")}
            </button>
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
          <WorkbenchButton
            iconOnly
            disabled={!running}
            onClick={cancelRun}
            title={
              running
                ? `${t("sql.cancel")} · ${t("sql.runningFor", {
                    seconds: elapsed,
                  })}`
                : t("sql.cancel")
            }
            aria-label={t("sql.cancel")}
          >
            <Icon name="stop" />
          </WorkbenchButton>
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
            <span
              data-tone={draftSignal.tone}
              className="badge icon-only-badge tw:data-[tone=danger]:border-danger tw:data-[tone=danger]:text-danger tw:data-[tone=warning]:border-warning tw:data-[tone=warning]:text-warning"
              title={draftSignal.title ?? draftSignal.text}
              aria-label={draftSignal.text}
              role="img"
            >
              <Icon name={draftSignal.icon ?? "info"} />
            </span>
          ) : null}
        </div>
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
      <WorkbenchContainedBody>
        <div
          data-workbench-scroll-owner="sql-editor"
          className="tw:min-h-0 tw:flex-1 tw:overflow-hidden tw:bg-background tw:[&>.cm-theme-dark]:h-full tw:[&_.cm-editor]:h-full tw:[&_.cm-editor]:bg-background tw:[&_.cm-scroller]:min-h-0 tw:[&_.cm-scroller]:overflow-auto tw:[&_.cm-scroller]:overscroll-contain"
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
            onBlur={flushEditorState}
            executionStatus={editorExecutionStatus}
          />
        </div>

        <div
          data-workbench-scroll-owner="document-details"
          className="scrollbar-sleek tw:max-h-[50%] tw:min-h-0 tw:shrink-0 tw:overflow-auto tw:overscroll-contain tw:bg-background"
        >
          {documentConflict && (
            <div
              className="tw:mx-3 tw:flex tw:min-h-control-lg tw:items-center tw:justify-between tw:gap-3 tw:border-y tw:border-warning tw:py-2 tw:text-sm tw:text-warning tw:max-[760px]:flex-col tw:max-[760px]:items-start"
              role="alert"
            >
              <span>{t("sql.saveConflictBody")}</span>
              <div className="ds-control-row">
                <WorkbenchButton
                  variant="default"
                  onClick={loadSavedConflictVersion}
                >
                  {t("sql.loadSaved")}
                </WorkbenchButton>
                <WorkbenchButton
                  variant="default"
                  onClick={keepLocalConflictVersion}
                >
                  {t("sql.keepMine")}
                </WorkbenchButton>
              </div>
            </div>
          )}
          {documentSaveError && documentSaveState === "error" && (
            <div className="tw:mx-3 tw:mt-2 tw:text-ui tw:text-danger">
              {t("sql.saveFailed")}: {documentSaveError}
            </div>
          )}
          {planErr && (
            <div className="tw:mx-3 tw:mt-2 tw:text-ui tw:text-danger">
              {planErr}
            </div>
          )}
          {plan && (
            <details
              open
              className="tw:my-2 tw:border-y tw:border-border-subtle tw:bg-background"
            >
              <summary className="tw:flex tw:min-h-workbench-toolbar tw:cursor-pointer tw:items-center tw:gap-2 tw:px-3 tw:py-1 tw:font-semibold">
                {t("sql.queryPlan")}
                <span className="tw:ml-auto">
                  <WorkbenchButton
                    iconOnly
                    size="xs"
                    onClick={(event) => {
                      event.preventDefault();
                      closePlan();
                    }}
                    title={t("common.close")}
                    aria-label={t("common.close")}
                  >
                    <Icon name="close" />
                  </WorkbenchButton>
                </span>
              </summary>
              {plan.plan ? (
                <pre className="tw:m-0 tw:overflow-x-auto tw:border-t tw:border-border-subtle tw:bg-background tw:p-3 tw:font-mono tw:text-sm tw:whitespace-pre">
                  {plan.plan}
                </pre>
              ) : (
                <div className="tw:border-t tw:border-border-subtle tw:px-3 tw:py-2 tw:text-muted-foreground">
                  {t("sql.noPlan", { mode: plan.mode })}
                </div>
              )}
            </details>
          )}

        </div>
      </WorkbenchContainedBody>
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
