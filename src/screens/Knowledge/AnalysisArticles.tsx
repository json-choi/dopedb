// Composes Article commands, editorial reading and immutable execution history.
// Commands appear only for roles that can complete them; run, failure, and cancel
// states come from the feature controller and its app-lifetime run store. A rerun
// blocked by this device's connection pin or credential shows its recovery step.
import { useState, type ReactNode } from "react";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon, type IconName } from "../../components/Icon";
import InfoTip from "../../components/InfoTip";
import { AnalysisArticleEditor } from "../../features/analysisArticles/AnalysisArticleEditor";
import { AnalysisShareButton } from "../../features/analysisArticles/AnalysisShareButton";
import { AnalysisPublicationPanel } from "../../features/analysisArticles/AnalysisPublicationPanel";
import {
  analysisFailure,
  type AnalysisFailure,
  type AnalysisRecovery,
} from "../../features/analysisArticles/analysisFeedback";
import WorkspaceConnectionDialog from "../../features/workspaces/components/WorkspaceConnectionDialog";
import type {
  AnalysisArticleDocument,
  AnalysisArticleRecord,
  AnalysisArticleRevision,
  AnalysisResultData,
  AnalysisRun,
} from "../../features/analysisArticles/domain";
import { useAnalysisArticlesController } from "../../features/analysisArticles/useAnalysisArticlesController";
import type { EnvironmentConnection, KnowledgeEnvironment } from "../../features/knowledge/domain";
import { Button } from "../../design-system/components/Button";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "../../design-system/components/Modal";
import { catalogLoadIssue, catalogLoadIssueAction, catalogLoadIssueMessage } from "../../features/catalogExplorer/catalogDomain";
import { AnalysisArticleReader } from "../../features/analysisArticles/AnalysisArticleReader";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../design-system/components/Status";
import {
  WorkbenchEmptyState,
} from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import type { I18nKey } from "../../lib/i18n";
import { fullTime } from "../../lib/relTime";

const RESULT_ROW_LIMIT = 500;

function cellText(value: string | number | boolean | null) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

function sourceLabel(article: AnalysisArticleRecord, t: Translate) {
  if (article.definition.source === "dopedb.acp.claude") return "Claude";
  if (article.definition.source === "dopedb.acp.codex") return "Codex";
  return t("analysis.sourceHuman");
}

const RUN_STATE_LABELS: Readonly<Record<AnalysisRun["state"], I18nKey>> = {
  queued: "analysis.runState.queued",
  running: "analysis.runState.running",
  succeeded: "analysis.runState.succeeded",
  failed: "analysis.runState.failed",
  cancelled: "analysis.runState.cancelled",
  stale: "analysis.runState.stale",
};

const RECOVERY_VIEWS: Readonly<Record<AnalysisRecovery, Readonly<{
  label: I18nKey;
  busy: I18nKey | null;
  icon: IconName;
}>>> = {
  connectCredentials: { label: "analysis.connectCredentials", busy: null, icon: "key" },
  recheckConnection: {
    label: "analysis.recheckConnection",
    busy: "analysis.recheckingConnection",
    icon: "refresh",
  },
  reconfirmBinding: {
    label: "analysis.reconfirmBinding",
    busy: "analysis.reconfirmingBinding",
    icon: "link",
  },
  editArticle: { label: "analysis.editArticleConnection", busy: null, icon: "pencil" },
};

function RecoveryButton({
  recovery,
  pending,
  size,
  onRecover,
}: {
  recovery: AnalysisRecovery;
  /** The recovery step currently in flight, if any. */
  pending: AnalysisRecovery | null;
  size: "compact" | "xs";
  onRecover: (recovery: AnalysisRecovery) => void;
}) {
  const { t } = useI18n();
  const view = RECOVERY_VIEWS[recovery];
  const busy = pending === recovery && view.busy !== null;
  return (
    <Button
      size={size}
      disabledBehavior="focusable"
      disabled={pending !== null}
      aria-busy={busy}
      onClick={() => onRecover(recovery)}
    >
      <Icon name={view.icon} />
      {busy && view.busy ? t(view.busy) : t(view.label)}
    </Button>
  );
}

function FailureNotice({ failure, action }: { failure: AnalysisFailure; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <InlineNotice tone="danger" icon="alert" role="alert" action={action}>
      <span className="tw:grid tw:gap-1">
        <span>{failure.message}</span>
        {failure.detail ? (
          <details>
            <summary className="tw:cursor-pointer tw:text-muted-foreground">{t("analysis.errorDetails")}</summary>
            <code className="tw:mt-1 tw:block tw:max-h-32 tw:overflow-auto tw:font-mono tw:whitespace-pre-wrap tw:break-words">{failure.detail}</code>
          </details>
        ) : null}
      </span>
    </InlineNotice>
  );
}

function revisionOperationLabel(t: Translate, operation: string) {
  if (operation === "create") {
    return t("analysis.revisionCreated");
  }
  if (operation === "propose" || operation === "proposed") {
    return t("analysis.revisionProposed");
  }
  if (operation === "update" || operation === "updated") {
    return t("analysis.revisionUpdated");
  }
  if (operation === "delete" || operation === "deleted") {
    return t("analysis.revisionDeleted");
  }
  return t("analysis.revisionChanged");
}

function connectionLabel(
  article: AnalysisArticleRecord,
  bindings: readonly EnvironmentConnection[],
) {
  const binding = bindings.find(
    (candidate) => candidate.remoteConnectionId === article.connectionId,
  );
  return binding ? binding.alias || binding.connectionName : article.connectionId;
}

export default function AnalysisArticles({
  projectName,
  environment,
  bindings,
  sharedWorkspace,
  scopeKey,
  focusId,
  onOpenAgent,
  onNewConnection,
  onRequestTeamWorkspace,
  teamWorkspaceAction = "signIn",
}: {
  projectName: string;
  environment: KnowledgeEnvironment;
  bindings: readonly EnvironmentConnection[];
  sharedWorkspace: boolean;
  scopeKey: string;
  focusId?: string | null;
  onOpenAgent?: (connectionId: string, environmentId?: string, prompt?: string, articleId?: string) => void;
  onNewConnection?: () => void;
  onRequestTeamWorkspace?: () => void;
  teamWorkspaceAction?: "signIn" | "select";
}) {
  const { t } = useI18n();
  const [showPublication, setShowPublication] = useState(false);
  const controller = useAnalysisArticlesController({
    environment,
    bindings,
    sharedWorkspace,
    scopeKey,
    focusId,
    onOpenAgent,
  });

  if (!sharedWorkspace) {
    return (
      <WorkbenchEmptyState icon="chart">
        <strong>{t("analysis.teamOnlyTitle")}</strong>
        <span>{t("analysis.teamOnlyBody")}</span>
        {onRequestTeamWorkspace ? (
          <Button variant="primary" onClick={onRequestTeamWorkspace}>
            <Icon name="user" />
            {t(
              teamWorkspaceAction === "select"
                ? "analysis.chooseTeamWorkspace"
                : "analysis.signInForTeamWorkspace",
            )}
          </Button>
        ) : null}
      </WorkbenchEmptyState>
    );
  }

  const selected = controller.selected;
  const articleDocument = controller.articleDocument;
  const running = controller.runSession.running;
  const runNotice = controller.runSession.notice;
  const runFailure: AnalysisFailure | null = runNotice?.kind === "failed"
    ? analysisFailure(t, runNotice.error)
    : runNotice?.kind === "cancelFailed"
      ? { message: t("analysis.cancelFailed"), detail: null }
      : null;
  const runBlocker = running ? null : controller.runBlocker;
  const runAction = running ? (
    <Button
      size="compact"
      disabledBehavior="focusable"
      disabled={running.cancelRequested}
      aria-busy={running.cancelRequested}
      onClick={controller.cancelRun}
    >
      <Icon name="stop" />
      {running.cancelRequested ? t("analysis.cancellingRun") : t("analysis.cancelRun")}
    </Button>
  ) : runBlocker?.recovery ? (
    <RecoveryButton
      recovery={runBlocker.recovery}
      pending={controller.recovering}
      size="compact"
      onRecover={controller.recover}
    />
  ) : (
    <Button
      size="compact"
      disabledBehavior="focusable"
      disabled={!articleDocument || runBlocker !== null}
      onClick={controller.startRun}
    >
      <Icon name="play" />
      {t("analysis.runAgain")}
    </Button>
  );
  return (
    <div className="tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:bg-background">

      {controller.actionFailure ? (
        <div className="tw:px-3 tw:pt-3">
          <FailureNotice failure={controller.actionFailure} />
        </div>
      ) : null}
      {runFailure ? (
        <div className="tw:px-3 tw:pt-3">
          <FailureNotice
            failure={runFailure}
            action={
              <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                {runFailure.recovery ? (
                  <RecoveryButton
                    recovery={runFailure.recovery}
                    pending={controller.recovering}
                    size="xs"
                    onRecover={controller.recover}
                  />
                ) : null}
                <Button size="xs" onClick={controller.dismissRunNotice}>{t("common.close")}</Button>
              </span>
            }
          />
        </div>
      ) : null}

      <main className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
        {!selected && controller.articles.isPending ? <div className="tw:p-8"><LoadingLabel>{t("analysis.loading")}</LoadingLabel></div> : !selected && controller.articles.isError ? <WorkbenchEmptyState icon="alert"><strong>{t("analysis.loadFailed")}</strong><span>{catalogLoadIssueMessage(t, catalogLoadIssue(controller.articles.error))}</span>{catalogLoadIssueAction(catalogLoadIssue(controller.articles.error)) === "retry" ? <Button onClick={() => void controller.articles.refetch()}>{t("analysis.refresh")}</Button> : null}</WorkbenchEmptyState> : !selected ? (
          <WorkbenchEmptyState icon="chart">
            <strong>{projectName}</strong>
            <span>{t("analysis.simpleEmptyBody")}</span>
            <span className="tw:flex tw:flex-wrap tw:items-center tw:justify-center tw:gap-2">
              {controller.agentBinding?.connectionId && onOpenAgent ? (
                <Button variant="primary" onClick={controller.askAgent}>
                  <Icon name="terminal" /> {t("analysis.askAgent")}
                </Button>
              ) : null}
              {bindings.length === 0 && onNewConnection ? (
                <Button variant="primary" onClick={onNewConnection}>
                  <Icon name="database" /> {t("analysis.connectDatabase")}
                </Button>
              ) : null}
            </span>
          </WorkbenchEmptyState>
        ) : (
          <>
            <header className="tw:flex tw:shrink-0 tw:items-center tw:justify-between tw:gap-3 tw:px-[clamp(20px,4.5cqw,60px)] tw:pt-5 tw:pb-2">
              <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground">
                <span className="tw:truncate">{projectName}</span><span aria-hidden="true">/</span><span>{t("analysis.navigation")}</span>
              </div>
              <div className="ds-control-row tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                {!controller.canWrite ? (
                  <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-xs tw:text-muted-foreground">
                    <span className="tw:truncate">{t("analysis.readOnlyRole")}</span>
                    <InfoTip label={t("analysis.readOnlyRoleDetail")} />
                  </span>
                ) : null}
                <ToolbarMenu label={t("ide.action.more")} icon="moreHorizontal">
                  {controller.canWrite && controller.agentBinding?.connectionId && onOpenAgent ? <ToolbarMenuItem icon="terminal" onClick={controller.askAgent}>{t("analysis.editWithAgent")}</ToolbarMenuItem> : null}
                  <ToolbarMenuItem icon="history" onClick={() => controller.setTab(controller.tab === "history" ? "article" : "history")}>{t(controller.tab === "history" ? "analysis.tabArticle" : "analysis.tabHistory")}</ToolbarMenuItem>
                  {controller.canWrite ? <ToolbarMenuItem icon="upload" onClick={() => { controller.setTab("article"); setShowPublication(true); }}>{t("analysis.publishHtml")}</ToolbarMenuItem> : null}
                  <ToolbarMenuItem icon="refresh" onClick={() => void controller.articles.refetch()}>{t("analysis.refresh")}</ToolbarMenuItem>
                  {controller.canWrite ? (
                    <div role="none" data-menu-keep-open>
                      <ConfirmButton
                        presentation="menuItem"
                        variant="ghost"
                        tone="danger"
                        disabled={controller.remove.isPending}
                        confirmLabel={t("analysis.deleteConfirm")}
                        onConfirm={() => controller.remove.mutate(selected)}
                      >
                        {t("analysis.deleteLabel")}
                      </ConfirmButton>
                    </div>
                  ) : null}
                </ToolbarMenu>
                {controller.canWrite ? (
                  <Button size="compact" disabled={!articleDocument} onClick={controller.openEditor}><Icon name="pencil" />{t("analysis.edit")}</Button>
                ) : null}
                <AnalysisShareButton key={`${scopeKey}:${selected.id}`} articleId={selected.id} />
              </div>
            </header>
            <div className="tw:min-h-0 tw:flex-1 tw:overflow-hidden">
              {controller.tab === "history" ? (
                <HistoryView
                  revisions={controller.revisions.data ?? []}
                  runs={controller.runs.data?.runs ?? []}
                  loading={controller.revisions.isPending || controller.runs.isPending}
                />
              ) : articleDocument ? (
                <ArticleDocument
                  key={`${scopeKey}:${selected.id}`}
                  article={articleDocument}
                  projectName={projectName}
                  source={sourceLabel(selected, t)}
                  runAction={runAction}
                  runStatus={running
                    ? <LoadingLabel>{t("analysis.runningQuery")}</LoadingLabel>
                    : runBlocker
                      ? <span role="status" className="tw:max-w-[360px] tw:text-xs tw:leading-ui tw:text-warning">{runBlocker.message}</span>
                      : controller.connectionRechecked
                        ? <span role="status" className="tw:text-xs tw:text-muted-foreground">{t("analysis.connectionRechecked")}</span>
                        : runNotice?.kind === "cancelled"
                          ? <span role="status" className="tw:text-xs tw:text-muted-foreground">{t("analysis.runCancelled")}</span>
                          : null}
                  result={controller.localResult?.result ?? null}
                  resultLoading={controller.recoveredResult.isFetching}
                  resultOutdated={controller.resultOutdated}
                  ranAt={controller.localResult?.finishedAt ?? null}
                  connectionLabel={connectionLabel(selected, bindings)}
                />
              ) : controller.documentQuery.isError ? (
                <WorkbenchEmptyState icon="alert">
                  <strong>{t("analysis.documentLoadFailed")}</strong>
                  <span>{analysisFailure(t, controller.documentQuery.error).message}</span>
                  <Button onClick={() => void controller.documentQuery.refetch()}>{t("analysis.retry")}</Button>
                </WorkbenchEmptyState>
              ) : (
                <div className="tw:p-8"><LoadingLabel>{t("analysis.loadingDocument")}</LoadingLabel></div>
              )}
            </div>
          </>
        )}
      </main>

      {selected && showPublication && controller.canWrite ? <ModalBackdrop onMouseDown={() => setShowPublication(false)}>
        <ModalSurface aria-labelledby="article-publication-title" onRequestClose={() => setShowPublication(false)}>
          <ModalHeader title={t("analysis.publishHtml")} titleId="article-publication-title" />
          <div className="scrollbar-sleek tw:min-h-0 tw:overflow-auto tw:p-5"><AnalysisPublicationPanel key={`${scopeKey}:${selected.id}`} article={selected} scopeKey={scopeKey} /></div>
          <ModalFooter><Button onClick={() => setShowPublication(false)}>{t("common.close")}</Button></ModalFooter>
        </ModalSurface>
      </ModalBackdrop> : null}

      {controller.editor ? (
        <AnalysisArticleEditor
          key={controller.editor.base.id}
          base={controller.editor.base}
          failure={controller.editor.failure}
          conflict={controller.editor.conflict}
          notice={controller.editor.notice ?? null}
          bindings={bindings}
          saving={controller.saveArticle.isPending}
          reloading={controller.reloadEditorBase.isPending}
          onSave={controller.saveDraft}
          onReloadLatest={() => controller.reloadEditorBase.mutate(controller.editor!.base.id)}
          onClose={controller.closeEditor}
        />
      ) : null}

      {controller.credentialTarget ? (
        <WorkspaceConnectionDialog
          connection={controller.credentialTarget}
          mode="credentials"
          onBound={controller.credentialsBound}
          onClose={controller.closeCredentials}
        />
      ) : null}
    </div>
  );
}

function ArticleDocument({
  article,
  projectName,
  source,
  runAction,
  runStatus,
  result,
  resultLoading,
  resultOutdated,
  ranAt,
  connectionLabel,
}: {
  article: AnalysisArticleDocument;
  projectName: string;
  source: string;
  runAction: ReactNode;
  runStatus: ReactNode;
  result: AnalysisResultData | null;
  resultLoading: boolean;
  resultOutdated: boolean;
  ranAt: string | null;
  connectionLabel: string;
}) {
  const { t, lang } = useI18n();
  const query = article.definition.query;
  return (
    <AnalysisArticleReader
      article={article}
      projectName={projectName}
      source={source}
      connectionName={connectionLabel}
      runAction={<span className="tw:flex tw:flex-wrap tw:items-center tw:gap-3">{runStatus}{runAction}</span>}
    >
      <section data-article-saved-query tabIndex={-1} className="tw:grid tw:scroll-mt-8 tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-6 tw:outline-none">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.savedQuery")}</h2>
          <span className="tw:text-xs tw:text-muted-foreground">{connectionLabel}</span>
        </div>
        <pre className="tw:m-0 tw:max-h-72 tw:overflow-auto tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-4 tw:text-xs tw:leading-relaxed"><code>{query.sql}</code></pre>
      </section>

      <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.latestLocalResult")}</h2>
          {ranAt ? <time className="tw:text-xs tw:text-muted-foreground" dateTime={ranAt}>{fullTime(ranAt, lang)}</time> : null}
        </div>
        {resultLoading ? <LoadingLabel>{t("analysis.loadingLocalResult")}</LoadingLabel> : null}
        {!resultLoading && result ? <ResultTable result={result} title={t("analysis.latestLocalResult")} /> : null}
        {!resultLoading && !result ? (
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
            {t(resultOutdated ? "analysis.resultOutdated" : "analysis.noLocalResult")}
          </p>
        ) : null}
      </section>

    </AnalysisArticleReader>
  );
}

function ResultTable({ result, title }: { result: AnalysisResultData; title: string }) {
  const { t } = useI18n();
  const shownRows = result.rows.slice(0, RESULT_ROW_LIMIT);
  return (
    <div className="tw:grid tw:gap-2">
      <div className="tw:max-h-[520px] tw:overflow-auto tw:rounded-md tw:border tw:border-border-subtle">
        <table className="tw:w-full tw:min-w-max tw:border-collapse tw:text-left tw:text-xs">
          <caption className="tw:sr-only">{title}</caption>
          <thead className="tw:sticky tw:top-0 tw:bg-background">
            <tr>{result.columns.map((column) => (
              <th className="tw:border-r tw:border-b tw:border-border-subtle tw:px-2 tw:py-1.5 tw:font-medium tw:text-muted-foreground" key={column.name}>{column.name}</th>
            ))}</tr>
          </thead>
          <tbody>{shownRows.map((row, rowIndex) => (
            <tr className="tw:odd:bg-card" key={rowIndex}>{result.columns.map((column, index) => {
              const value = cellText(row[index] ?? null);
              return <td className="tw:max-w-[420px] tw:truncate tw:border-r tw:border-b tw:border-border-subtle tw:px-2 tw:py-1.5 tw:font-mono tw:tabular-nums" title={value} key={column.name}>{value}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
      {result.rows.length > RESULT_ROW_LIMIT ? (
        <p className="tw:m-0 tw:text-xs tw:text-muted-foreground" role="note">
          {t("analysis.resultRowsShown", { shown: RESULT_ROW_LIMIT, total: result.rows.length })}
        </p>
      ) : null}
      {result.truncated ? <p className="tw:m-0 tw:text-xs tw:text-warning">{t("analysis.resultSafetyLimit")}</p> : null}
    </div>
  );
}

function HistoryView({
  revisions,
  runs,
  loading,
}: {
  revisions: AnalysisArticleRevision[];
  runs: AnalysisRun[];
  loading: boolean;
}) {
  const { t, lang } = useI18n();
  if (loading) return <div className="tw:p-5"><LoadingLabel>{t("analysis.loadingHistory")}</LoadingLabel></div>;
  return (
    <div className="scrollbar-sleek tw:mx-auto tw:grid tw:h-full tw:w-full tw:max-w-[1000px] tw:content-start tw:gap-8 tw:overflow-auto tw:p-8">
      <h1 className="tw:m-0 tw:text-heading tw:font-semibold">{t("analysis.tabHistory")}</h1>
      <section className="tw:grid tw:gap-2">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.revisions")}</h2>
        {revisions.map((revision) => (
          <div className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:p-3" key={revision.revision}>
            <strong className="tw:font-mono tw:text-xs">r{revision.revision}</strong>
            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:text-muted-foreground">{revisionOperationLabel(t, revision.operation)} · {fullTime(revision.createdAt, lang)}</span>
          </div>
        ))}
      </section>
      <section className="tw:grid tw:gap-2">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.runs")}</h2>
        {runs.map((run) => (
          <div className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:p-3" key={run.id}>
            <StatusBadge density="compact" tone={run.state === "succeeded" ? "success" : run.state === "failed" ? "danger" : run.state === "stale" ? "warning" : "neutral"}>{t(RUN_STATE_LABELS[run.state])}</StatusBadge>
            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:text-muted-foreground">r{run.articleRevision} · {fullTime(run.finishedAt ?? run.createdAt, lang)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
