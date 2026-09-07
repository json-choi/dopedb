// Composes Article commands, editorial reading and immutable execution history.
import { useState, type ReactNode } from "react";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { AnalysisArticleEditor } from "../../features/analysisArticles/AnalysisArticleEditor";
import { AnalysisShareButton } from "../../features/analysisArticles/AnalysisShareButton";
import { AnalysisPublicationPanel } from "../../features/analysisArticles/AnalysisPublicationPanel";
import type {
  AnalysisArticleRecord,
  AnalysisArticleRevision,
  AnalysisResultData,
  AnalysisRun,
} from "../../features/analysisArticles/domain";
import { useAnalysisArticlesController } from "../../features/analysisArticles/useAnalysisArticlesController";
import type { EnvironmentConnection, KnowledgeEnvironment } from "../../features/knowledge/domain";
import { Button } from "../../design-system/components/Button";
import { ModalBackdrop, ModalFooter, ModalHeader, ModalSurface } from "../../design-system/components/Modal";
import { errMessage } from "../../ipc/types";
import { AnalysisArticleReader } from "../../features/analysisArticles/AnalysisArticleReader";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../design-system/components/Status";
import {
  WorkbenchEmptyState,
} from "../../design-system/components/Workbench";
import { useI18n } from "../../lib/i18n";
import type { I18nKey } from "../../lib/i18n";

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

function runStateLabel(t: Translate, state: AnalysisRun["state"]) {
  return t(`analysis.runState.${state}`);
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
  return (
    <div className="tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:bg-background">

      {controller.actionError ? (
        <div className="tw:px-3 tw:pt-3">
          <InlineNotice tone="danger" icon="alert" role="alert">{controller.actionError}</InlineNotice>
        </div>
      ) : null}

      <main className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
        {!selected && controller.articles.isPending ? <div className="tw:p-8"><LoadingLabel>{t("analysis.loading")}</LoadingLabel></div> : !selected && controller.articles.isError ? <WorkbenchEmptyState icon="alert"><strong>{t("analysis.loadFailed")}</strong><span>{errMessage(controller.articles.error)}</span><Button onClick={() => void controller.articles.refetch()}>{t("analysis.refresh")}</Button></WorkbenchEmptyState> : !selected ? (
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
              <div className="ds-control-row tw:flex tw:shrink-0 tw:items-center tw:gap-2">
                <ToolbarMenu label={t("ide.action.more")} icon="moreHorizontal">
                  {controller.agentBinding?.connectionId && onOpenAgent ? <ToolbarMenuItem icon="terminal" onClick={controller.askAgent}>{t("analysis.editWithAgent")}</ToolbarMenuItem> : null}
                  <ToolbarMenuItem icon="history" onClick={() => controller.setTab(controller.tab === "history" ? "article" : "history")}>{t(controller.tab === "history" ? "analysis.tabArticle" : "analysis.tabHistory")}</ToolbarMenuItem>
                  <ToolbarMenuItem icon="upload" onClick={() => { controller.setTab("article"); setShowPublication((value) => !value); }}>{t("analysis.publishHtml")}</ToolbarMenuItem>
                  <ToolbarMenuItem icon="refresh" onClick={() => void controller.articles.refetch()}>{t("analysis.refresh")}</ToolbarMenuItem>
                  <div role="none" data-menu-keep-open>
                    <ConfirmButton presentation="menuItem" variant="ghost" tone="danger" disabled={controller.remove.isPending} onConfirm={() => controller.remove.mutate(selected)}>{t("analysis.deleteLabel")}</ConfirmButton>
                  </div>
                </ToolbarMenu>
                <Button size="compact" onClick={() => controller.setEditorArticle(selected)}><Icon name="pencil" />{t("analysis.edit")}</Button>
                <AnalysisShareButton key={`${scopeKey}:${selected.id}`} articleId={selected.id} />
              </div>
            </header>
            <div className="tw:min-h-0 tw:flex-1 tw:overflow-hidden">
              {controller.tab === "article" ? (
                <ArticleDocument
                  key={`${scopeKey}:${selected.id}`}
                  article={selected}
                  projectName={projectName}
                  source={sourceLabel(selected, t)}
                  runAction={controller.running?.articleId === selected.id ? (
                    <Button variant="danger" size="compact" onClick={() => controller.running && controller.cancel.mutate(controller.running)}><Icon name="stop" />{t("analysis.cancelRun")}</Button>
                  ) : (
                    <Button size="compact" disabled={controller.execute.isPending} onClick={() => controller.startRun(selected)}><Icon name="play" />{t("analysis.runAgain")}</Button>
                  )}
                  result={controller.resultData}
                  resultLoading={controller.recoveredResult.isFetching || controller.execute.isPending}
                  ranAt={controller.localResult?.finishedAt ?? null}
                  connectionLabel={connectionLabel(selected, bindings)}
                />
              ) : (
                <HistoryView
                  revisions={controller.revisions.data ?? []}
                  runs={controller.runs.data?.runs ?? []}
                  loading={controller.revisions.isPending || controller.runs.isPending}
                />
              )}
            </div>
          </>
        )}
      </main>

      {selected && showPublication ? <ModalBackdrop onMouseDown={() => setShowPublication(false)}>
        <ModalSurface aria-labelledby="article-publication-title" onRequestClose={() => setShowPublication(false)}>
          <ModalHeader title={t("analysis.publishHtml")} titleId="article-publication-title" />
          <div className="scrollbar-sleek tw:min-h-0 tw:overflow-auto tw:p-5"><AnalysisPublicationPanel key={`${scopeKey}:${selected.id}`} article={selected} scopeKey={scopeKey} /></div>
          <ModalFooter><Button onClick={() => setShowPublication(false)}>{t("common.close")}</Button></ModalFooter>
        </ModalSurface>
      </ModalBackdrop> : null}

      {controller.editorArticle ? (
        <AnalysisArticleEditor
          article={controller.editorArticle}
          bindings={bindings}
          saving={controller.saveArticle.isPending}
          onSave={(input) => controller.saveArticle.mutate(input)}
          onClose={() => controller.setEditorArticle(null)}
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
  result,
  resultLoading,
  ranAt,
  connectionLabel,
}: {
  article: AnalysisArticleRecord;
  projectName: string;
  source: string;
  runAction: ReactNode;
  result: AnalysisResultData | null;
  resultLoading: boolean;
  ranAt: string | null;
  connectionLabel: string;
}) {
  const { t } = useI18n();
  const query = article.definition.query;
  return (
    <AnalysisArticleReader article={article} projectName={projectName} source={source} connectionName={connectionLabel} runAction={runAction}>
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
          {ranAt ? <time className="tw:text-xs tw:text-muted-foreground" dateTime={ranAt}>{new Date(ranAt).toLocaleString()}</time> : null}
        </div>
        {resultLoading ? <LoadingLabel>{t("analysis.runningQuery")}</LoadingLabel> : null}
        {!resultLoading && result ? <ResultTable result={result} title={t("analysis.latestLocalResult")} /> : null}
        {!resultLoading && !result ? (
          <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">{t("analysis.noLocalResult")}</p>
        ) : null}
      </section>

    </AnalysisArticleReader>
  );
}

function ResultTable({ result, title }: { result: AnalysisResultData; title: string }) {
  const { t } = useI18n();
  return (
    <div className="tw:max-h-[520px] tw:overflow-auto tw:rounded-md tw:border tw:border-border-subtle">
      <table className="tw:w-full tw:min-w-max tw:border-collapse tw:text-left tw:text-xs">
        <caption className="tw:sr-only">{title}</caption>
        <thead className="tw:sticky tw:top-0 tw:bg-background">
          <tr>{result.columns.map((column) => (
            <th className="tw:border-r tw:border-b tw:border-border-subtle tw:px-2 tw:py-1.5 tw:font-medium tw:text-muted-foreground" key={column.name}>{column.name}</th>
          ))}</tr>
        </thead>
        <tbody>{result.rows.slice(0, 500).map((row, rowIndex) => (
          <tr className="tw:odd:bg-card" key={rowIndex}>{result.columns.map((column, index) => {
            const value = cellText(row[index] ?? null);
            return <td className="tw:max-w-[420px] tw:truncate tw:border-r tw:border-b tw:border-border-subtle tw:px-2 tw:py-1.5 tw:font-mono tw:tabular-nums" title={value} key={column.name}>{value}</td>;
          })}</tr>
        ))}</tbody>
      </table>
      {result.truncated ? <p className="tw:m-0 tw:p-2 tw:text-xs tw:text-warning">{t("analysis.resultSafetyLimit")}</p> : null}
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
  const { t } = useI18n();
  if (loading) return <div className="tw:p-5"><LoadingLabel>{t("analysis.loadingHistory")}</LoadingLabel></div>;
  return (
    <div className="scrollbar-sleek tw:mx-auto tw:grid tw:h-full tw:w-full tw:max-w-[1000px] tw:content-start tw:gap-8 tw:overflow-auto tw:p-8">
      <h1 className="tw:m-0 tw:font-serif tw:text-4xl tw:font-normal">{t("analysis.tabHistory")}</h1>
      <section className="tw:grid tw:gap-2">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.revisions")}</h2>
        {revisions.map((revision) => (
          <div className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:p-3" key={revision.revision}>
            <strong className="tw:font-mono tw:text-xs">r{revision.revision}</strong>
            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:text-muted-foreground">{revisionOperationLabel(t, revision.operation)} · {new Date(revision.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </section>
      <section className="tw:grid tw:gap-2">
        <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.runs")}</h2>
        {runs.map((run) => (
          <div className="tw:flex tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:p-3" key={run.id}>
            <StatusBadge density="compact" tone={run.state === "succeeded" ? "success" : run.state === "failed" ? "danger" : "neutral"}>{runStateLabel(t, run.state)}</StatusBadge>
            <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:text-muted-foreground">r{run.articleRevision} · {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : run.createdAt}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
