// Owns the intentionally small Analysis Article workflow: select, edit one HTML
// document, manually rerun one saved query, recover its local result, and inspect
// immutable history.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import type { EnvironmentConnection, KnowledgeEnvironment } from "../knowledge/domain";
import {
  type AnalysisArticleRecord,
  type AnalysisDefinitionRunReceipt,
  type SharedAnalysisArticleCreate,
} from "./domain";
import { beginManualAnalysisRunOutcome } from "./productAnalytics";
import { analysisQueryKeys } from "./queryKeys";
import {
  cancelAnalysisArticleRun,
  deleteAnalysisArticle,
  getLocalAnalysisArticleResult,
  listAnalysisArticleRevisions,
  listAnalysisArticleRuns,
  listAnalysisArticles,
  onAnalysisArticleChanged,
  runAnalysisArticle,
  updateAnalysisArticle,
} from "./tauriAdapter";

export type AnalysisArticleDetailTab = "article" | "history";

type Params = {
  environment: KnowledgeEnvironment;
  bindings: readonly EnvironmentConnection[];
  sharedWorkspace: boolean;
  scopeKey: string;
  focusId?: string | null;
  onOpenAgent?: (connectionId: string, environmentId?: string, prompt?: string) => void;
};

export function useAnalysisArticlesController({
  environment,
  bindings,
  sharedWorkspace,
  scopeKey,
  focusId,
  onOpenAgent,
}: Params) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const detailTabs = useMemo(() => [
    { id: "article", label: t("analysis.tabArticle") },
    { id: "history", label: t("analysis.tabHistory") },
  ] as const, [t]);
  const articleKey = useMemo(
    () => analysisQueryKeys.articles(scopeKey, environment.id),
    [environment.id, scopeKey],
  );
  const articles = useQuery({
    queryKey: articleKey,
    queryFn: () => listAnalysisArticles(environment.id),
    enabled: sharedWorkspace,
    retry: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [tab, setTab] = useState<AnalysisArticleDetailTab>("article");
  const [editorArticle, setEditorArticle] = useState<AnalysisArticleRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localResults, setLocalResults] = useState(new Map<string, AnalysisDefinitionRunReceipt>());
  const [running, setRunning] = useState<{ articleId: string; runId: string } | null>(null);

  useEffect(() => {
    if (focusId && articles.data?.some((article) => article.id === focusId)) {
      setSelectedId(focusId);
      return;
    }
    if (selectedId && articles.data?.some((article) => article.id === selectedId)) return;
    setSelectedId(articles.data?.[0]?.id ?? null);
  }, [articles.data, focusId, selectedId]);

  const selected = articles.data?.find((article) => article.id === selectedId) ?? null;
  const revisions = useQuery({
    queryKey: analysisQueryKeys.revisions(scopeKey, selected?.id),
    queryFn: () => listAnalysisArticleRevisions(selected!.id),
    enabled: Boolean(selected) && tab === "history",
    retry: false,
  });
  const runs = useQuery({
    queryKey: analysisQueryKeys.runs(scopeKey, selected?.id),
    queryFn: () => listAnalysisArticleRuns(selected!.id),
    enabled: Boolean(selected),
    retry: false,
  });
  const recoveredResult = useQuery({
    queryKey: analysisQueryKeys.localResult(scopeKey, selected?.id),
    queryFn: () => getLocalAnalysisArticleResult(selected!.id),
    enabled: Boolean(selected),
    retry: false,
  });
  const memoryResult = selected ? localResults.get(selected.id) ?? null : null;
  const localResult = memoryResult
    ?? (recoveredResult.data?.articleRevision === selected?.revision ? recoveredResult.data : null);
  const resultData = localResult?.result ?? null;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onAnalysisArticleChanged((change) => {
      if (disposed) return;
      void queryClient.invalidateQueries({ queryKey: articleKey });
      void queryClient.invalidateQueries({ queryKey: analysisQueryKeys.revisions(scopeKey, change.articleId) });
      setSelectedId(change.articleId);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [articleKey, queryClient, scopeKey]);

  const refreshArticle = async (articleId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: articleKey }),
      articleId ? queryClient.invalidateQueries({ queryKey: analysisQueryKeys.runs(scopeKey, articleId) }) : Promise.resolve(),
      articleId ? queryClient.invalidateQueries({ queryKey: analysisQueryKeys.revisions(scopeKey, articleId) }) : Promise.resolve(),
    ]);
  };
  const saveArticle = useMutation({
    mutationFn: (input: SharedAnalysisArticleCreate) => updateAnalysisArticle(input.id, editorArticle!.revision, input),
    onSuccess: async (article) => {
      setActionError(null);
      setEditorArticle(null);
      setSelectedId(article.id);
      await refreshArticle(article.id);
    },
    onError: (error) => setActionError(errMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (article: AnalysisArticleRecord) => deleteAnalysisArticle(article.id, article.revision),
    onSuccess: async (_, article) => {
      setActionError(null);
      setSelectedId(null);
      await refreshArticle(article.id);
    },
    onError: (error) => setActionError(errMessage(error)),
  });
  const execute = useMutation({
    mutationFn: ({ article, runId }: { article: AnalysisArticleRecord; runId: string }) =>
      runAnalysisArticle(article.id, article.revision, runId),
    onMutate: ({ article, runId }) => {
      setActionError(null);
      setRunning({ articleId: article.id, runId });
      return { completeAnalytics: beginManualAnalysisRunOutcome(catalogScope) };
    },
    onSuccess: async (value, _variables, analyticsAttempt) => {
      analyticsAttempt?.completeAnalytics(value.run);
      setLocalResults((current) => new Map(current).set(value.result.articleId, value.result));
      setRunning(null);
      await refreshArticle(value.result.articleId);
    },
    onError: async (error, variables, analyticsAttempt) => {
      setRunning(null);
      setActionError(errMessage(error));
      try {
        const page = await listAnalysisArticleRuns(variables.article.id);
        analyticsAttempt?.completeAnalytics(page.runs.find((run) => run.id === variables.runId));
      } catch {
        // Do not infer a terminal analytics state without a durable run receipt.
      }
    },
  });
  const cancel = useMutation({
    mutationFn: ({ articleId, runId }: { articleId: string; runId: string }) =>
      cancelAnalysisArticleRun(articleId, runId),
    onSuccess: async (run) => {
      setActionError(null);
      setRunning(null);
      await refreshArticle(run.articleId);
    },
    onError: (error) => setActionError(errMessage(error)),
  });

  const agentBinding = bindings.find((binding) => binding.connectionId);
  const askAgent = () => {
    if (!agentBinding?.connectionId || !onOpenAgent) return;
    onOpenAgent(agentBinding.connectionId, environment.id, t("analysis.simpleAgentPrompt"));
  };

  return {
    actionError,
    agentBinding,
    articles,
    askAgent,
    resultData,
    cancel,
    detailTabs,
    editorArticle,
    execute,
    localResult,
    recoveredResult,
    remove,
    revisions,
    running,
    runs,
    saveArticle,
    selected,
    setEditorArticle,
    setTab,
    startRun: (article: AnalysisArticleRecord) => execute.mutate({ article, runId: crypto.randomUUID() }),
    tab,
  };
}
