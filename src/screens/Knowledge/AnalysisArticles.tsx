import { useState } from "react";

import ConfirmButton from "../../components/ConfirmButton";
import { Icon } from "../../components/Icon";
import { AnalysisArticleEditor } from "../../features/analysisArticles/AnalysisArticleEditor";
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
import { PanelTabs } from "../../design-system/components/PanelTabs";
import { InlineNotice, LoadingLabel, StatusBadge } from "../../design-system/components/Status";
import {
  WorkbenchButton,
  WorkbenchDivider,
  WorkbenchEmptyState,
  WorkbenchToolbar,
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
  onOpenAgent?: (connectionId: string, environmentId?: string, prompt?: string) => void;
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
    <div className="tw:flex tw:min-h-[calc(100dvh-90px)] tw:min-w-0 tw:flex-col tw:bg-background">
      <WorkbenchToolbar label={t("analysis.title")}>
        {controller.agentBinding?.connectionId && onOpenAgent ? (
          <>
            <WorkbenchButton onClick={controller.askAgent}>
              <Icon name="terminal" />
              {t("analysis.askAgent")}
            </WorkbenchButton>
            <WorkbenchDivider />
          </>
        ) : null}
        <WorkbenchButton
          iconOnly
          title={t("analysis.refresh")}
          aria-label={t("analysis.refresh")}
          onClick={() => void controller.articles.refetch()}
        >
          <Icon name="refresh" className={controller.articles.isFetching ? "tw:animate-spin tw:motion-reduce:animate-none" : undefined} />
        </WorkbenchButton>
      </WorkbenchToolbar>

      {controller.actionError ? (
        <div className="tw:px-3 tw:pt-3">
          <InlineNotice tone="danger" icon="alert" role="alert">{controller.actionError}</InlineNotice>
        </div>
      ) : null}

      <main className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden">
        {!selected ? (
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
            <header className="tw:flex tw:shrink-0 tw:flex-wrap tw:items-start tw:justify-between tw:gap-3 tw:border-b tw:border-border-subtle tw:px-4 tw:py-3">
              <div className="tw:grid tw:min-w-0 tw:gap-1">
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <h1 className="tw:m-0 tw:truncate tw:text-title tw:font-semibold tw:tracking-tight">{selected.definition.title}</h1>
                  <StatusBadge density="compact">{sourceLabel(selected, t)}</StatusBadge>
                  <span className="tw:font-mono tw:text-2xs tw:text-muted-foreground">r{selected.revision}</span>
                </div>
                <span className="tw:text-xs tw:text-muted-foreground">
                  {connectionLabel(selected, bindings)} · {t("analysis.manualOnly")}
                </span>
              </div>
              <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1">
                {controller.running?.articleId === selected.id ? (
                  <Button variant="danger" size="compact" onClick={() => controller.running && controller.cancel.mutate(controller.running)}>
                    <Icon name="stop" /> {t("analysis.cancelRun")}
                  </Button>
                ) : (
                  <Button variant="primary" size="compact" disabled={controller.execute.isPending} onClick={() => controller.startRun(selected)}>
                    <Icon name="play" /> {t("analysis.runAgain")}
                  </Button>
                )}
                <Button size="compact" onClick={() => controller.setEditorArticle(selected)}>
                  <Icon name="pencil" /> {t("analysis.edit")}
                </Button>
                <Button size="compact" onClick={() => setShowPublication((value) => !value)}>
                  <Icon name="upload" /> {t("analysis.publishHtml")}
                </Button>
                <ConfirmButton
                  iconOnly
                  size="xs"
                  variant="ghost"
                  label={t("analysis.deleteLabel")}
                  disabled={controller.remove.isPending}
                  onConfirm={() => controller.remove.mutate(selected)}
                >
                  <Icon name="trash" />
                </ConfirmButton>
              </div>
            </header>
            <PanelTabs tabs={controller.detailTabs} active={controller.tab} onChange={controller.setTab} label={t("analysis.details")} />
            <div className="scrollbar-sleek tw:min-h-0 tw:flex-1 tw:overflow-auto tw:overscroll-contain">
              {controller.tab === "article" ? (
                <ArticleDocument
                  article={selected}
                  result={controller.resultData}
                  resultLoading={controller.recoveredResult.isFetching || controller.execute.isPending}
                  ranAt={controller.localResult?.finishedAt ?? null}
                  showPublication={showPublication}
                  scopeKey={scopeKey}
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
  result,
  resultLoading,
  ranAt,
  showPublication,
  scopeKey,
  connectionLabel,
}: {
  article: AnalysisArticleRecord;
  result: AnalysisResultData | null;
  resultLoading: boolean;
  ranAt: string | null;
  showPublication: boolean;
  scopeKey: string;
  connectionLabel: string;
}) {
  const { t } = useI18n();
  const query = article.definition.query;
  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[1100px] tw:gap-8 tw:p-6 tw:@max-[760px]:p-3">
      <article
        className="tw:grid tw:gap-4 tw:text-base tw:leading-relaxed tw:[&_a]:text-primary tw:[&_a]:underline tw:[&_blockquote]:border-l-2 tw:[&_blockquote]:border-border tw:[&_blockquote]:pl-4 tw:[&_code]:font-mono tw:[&_h2]:font-serif tw:[&_h2]:text-3xl tw:[&_h2]:font-medium tw:[&_h3]:text-xl tw:[&_h3]:font-semibold tw:[&_h4]:text-base tw:[&_h4]:font-semibold tw:[&_ol]:pl-6 tw:[&_p]:m-0 tw:[&_pre]:overflow-auto tw:[&_pre]:rounded-surface tw:[&_pre]:bg-surface-inset tw:[&_pre]:p-4 tw:[&_table]:w-full tw:[&_table]:border-collapse tw:[&_td]:border tw:[&_td]:border-border tw:[&_td]:p-2 tw:[&_th]:border tw:[&_th]:border-border tw:[&_th]:p-2 tw:[&_ul]:pl-6"
        dangerouslySetInnerHTML={{ __html: article.definition.html }}
      />

      <section className="tw:grid tw:gap-3 tw:border-t tw:border-border-subtle tw:pt-5">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
          <h2 className="tw:m-0 tw:text-sm tw:font-semibold">{t("analysis.savedQuery")}</h2>
          <span className="tw:text-xs tw:text-muted-foreground">{connectionLabel}</span>
        </div>
        <pre className="tw:m-0 tw:max-h-72 tw:overflow-auto tw:rounded-surface tw:border tw:border-border-subtle tw:bg-surface-inset tw:p-4 tw:text-xs tw:leading-relaxed"><code>{query.sql}</code></pre>
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

      {showPublication ? (
        <section className="tw:grid tw:gap-4 tw:border-t tw:border-border-subtle tw:pt-5">
          <AnalysisPublicationPanel article={article} scopeKey={scopeKey} />
        </section>
      ) : null}
    </div>
  );
}

function ResultTable({ result, title }: { result: AnalysisResultData; title: string }) {
  const { t } = useI18n();
  return (
    <div className="tw:max-h-[520px] tw:overflow-auto tw:rounded-surface tw:border tw:border-border">
      <table className="tw:w-full tw:min-w-max tw:border-collapse tw:text-left tw:text-xs">
        <caption className="tw:sr-only">{title}</caption>
        <thead className="tw:sticky tw:top-0 tw:bg-surface">
          <tr>{result.columns.map((column) => (
            <th className="tw:border-r tw:border-b tw:border-border tw:px-2 tw:py-1.5 tw:font-medium tw:text-muted-foreground" key={column.name}>{column.name}</th>
          ))}</tr>
        </thead>
        <tbody>{result.rows.slice(0, 500).map((row, rowIndex) => (
          <tr className="tw:odd:bg-surface-inset" key={rowIndex}>{result.columns.map((column, index) => {
            const value = cellText(row[index] ?? null);
            return <td className="tw:max-w-[420px] tw:truncate tw:border-r tw:border-b tw:border-border tw:px-2 tw:py-1.5 tw:font-mono tw:tabular-nums" title={value} key={column.name}>{value}</td>;
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
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[900px] tw:gap-6 tw:p-5">
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
