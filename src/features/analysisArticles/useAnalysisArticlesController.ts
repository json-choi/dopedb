// Owns the intentionally small Analysis Article workflow: select, edit one HTML
// document, manually rerun one saved query, recover its local result, and inspect
// immutable history. Lists carry titles only; the selected body loads per revision,
// runs live in the app-lifetime run store, and role decides which commands exist.
// Before a rerun it checks this device's connection pin and credential from cached
// state and offers the matching recovery step instead of starting a doomed run;
// after a re-check it offers the real fix (reconfirm the binding, edit the Article)
// or says whom to ask.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../../lib/i18n";
import { useCatalogScope } from "../../lib/queries";
import { connectionAccessIssue, type ConnectionProfile } from "../connections/domain";
import { connectionQueryKeys, connectionsQuery } from "../connections/queries";
import { bindKnowledgeEnvironmentConnectionWithRefresh } from "../knowledge/bindEnvironmentConnection";
import type {
  BindEnvironmentConnectionInput,
  EnvironmentConnection,
  KnowledgeEnvironment,
} from "../knowledge/domain";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { useWorkspaceAdminScope } from "../workspaceAdmin/scope";
import { canManageWorkspaceConnections } from "../workspaces/choices";
import {
  analysisFailure,
  analysisPinFailure,
  analysisRunPinIssue,
  type AnalysisFailure,
  type AnalysisRecovery,
} from "./analysisFeedback";
import {
  analysisQuerySignature,
  cancelAnalysisRun,
  dismissAnalysisRunNotice,
  startAnalysisRun,
  useAnalysisRunSession,
} from "./analysisRunStore";
import type {
  AnalysisArticleDocument,
  AnalysisArticleRecord,
  SharedAnalysisArticleCreate,
} from "./domain";
import { analysisQueryKeys } from "./queryKeys";
import {
  deleteAnalysisArticle,
  getAnalysisArticle,
  getLocalAnalysisArticleResult,
  listAnalysisArticleRevisions,
  listAnalysisArticleRuns,
  listAnalysisArticles,
  onAnalysisArticleChanged,
  updateAnalysisArticle,
} from "./tauriAdapter";

export type AnalysisArticleDetailTab = "article" | "history";

/** One editing session; `base` is the revision the unsaved draft applies to. */
export type AnalysisEditorState = Readonly<{
  base: AnalysisArticleDocument;
  failure: AnalysisFailure | null;
  /** Set after a revision conflict. The draft is kept and now applies to `base`. */
  conflict: Readonly<{ latestUnavailable: boolean }> | null;
  /** Why the editor was opened to fix the database pin, if it was. */
  notice?: string;
}>;

// The workspace service authorizes every command; this only avoids offering
// commands a viewer or analyst can never complete. Ownership stays server-checked.
const WRITE_ROLES = new Set(["editor", "admin", "owner"]);

type Params = {
  environment: KnowledgeEnvironment;
  bindings: readonly EnvironmentConnection[];
  sharedWorkspace: boolean;
  scopeKey: string;
  focusId?: string | null;
  onOpenAgent?: (connectionId: string, environmentId?: string, prompt?: string, articleId?: string) => void;
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
  const workspaceRole = useWorkspaceAdminScope()?.role ?? null;
  const canWrite = workspaceRole === null || WRITE_ROLES.has(workspaceRole);
  // Environment bindings are workspace-managed (admin or owner), like the Databases view.
  const canManageBindings = workspaceRole === null || canManageWorkspaceConnections(workspaceRole);
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
  const [editor, setEditor] = useState<AnalysisEditorState | null>(null);
  const [actionFailure, setActionFailure] = useState<AnalysisFailure | null>(null);

  useEffect(() => {
    if (focusId && articles.data?.some((article) => article.id === focusId)) {
      setSelectedId(focusId);
      return;
    }
    if (selectedId && articles.data?.some((article) => article.id === selectedId)) return;
    setSelectedId(articles.data?.[0]?.id ?? null);
  }, [articles.data, focusId, selectedId]);

  const selected = articles.data?.find((article) => article.id === selectedId) ?? null;
  // A revision's HTML and SQL never change, so each body is fetched once per revision.
  const documentQuery = useQuery({
    queryKey: analysisQueryKeys.document(scopeKey, selected?.id, selected?.revision),
    queryFn: async () => {
      const current = await getAnalysisArticle(selected!.id);
      if (current.revision !== selected!.revision) {
        queryClient.setQueryData(
          analysisQueryKeys.document(scopeKey, current.id, current.revision),
          current,
        );
        void queryClient.invalidateQueries({ queryKey: analysisQueryKeys.articles(scopeKey) });
      }
      return current;
    },
    enabled: Boolean(selected),
    staleTime: Infinity,
    retry: false,
  });
  const articleDocument = documentQuery.data?.id === selected?.id ? documentQuery.data ?? null : null;
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
  const runSession = useAnalysisRunSession(scopeKey, selected?.id ?? null);
  // Results are shown only for the exact query that produced them. After the SQL or
  // connection pin changes, an older result is hidden and marked as outdated.
  const memoryResult = runSession.result;
  const currentMemoryResult = memoryResult && articleDocument
    && memoryResult.querySignature === analysisQuerySignature(articleDocument)
    ? memoryResult.receipt
    : null;
  const recovered = recoveredResult.data ?? null;
  const currentRecovered = recovered && articleDocument
    && recovered.articleRevision === articleDocument.revision
    ? recovered
    : null;
  const localResult = currentMemoryResult ?? currentRecovered;
  const resultOutdated = !localResult && Boolean(articleDocument) && Boolean(memoryResult || recovered);

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
    mutationFn: ({ input, expectedRevision }: {
      input: SharedAnalysisArticleCreate;
      expectedRevision: number;
    }) => updateAnalysisArticle(input.id, expectedRevision, input),
    onSuccess: async (result) => {
      if (result.outcome === "saved") {
        queryClient.setQueryData(
          analysisQueryKeys.document(scopeKey, result.article.id, result.article.revision),
          result.article,
        );
        setEditor(null);
        setSelectedId(result.article.id);
        await refreshArticle(result.article.id);
        return;
      }
      // Nothing was written. Keep the draft open on top of the latest revision.
      if (result.latest) {
        queryClient.setQueryData(
          analysisQueryKeys.document(scopeKey, result.latest.id, result.latest.revision),
          result.latest,
        );
      }
      setEditor((current) => current && {
        base: result.latest ?? current.base,
        failure: null,
        conflict: { latestUnavailable: result.latest === null },
      });
      void queryClient.invalidateQueries({ queryKey: articleKey });
    },
    onError: (error) => setEditor((current) => current && {
      ...current,
      failure: analysisFailure(t, error),
    }),
  });
  const reloadEditorBase = useMutation({
    mutationFn: (articleId: string) => getAnalysisArticle(articleId),
    onSuccess: (latest) => setEditor((current) => current && {
      base: latest,
      failure: null,
      conflict: { latestUnavailable: false },
    }),
    onError: (error) => setEditor((current) => current && {
      ...current,
      failure: analysisFailure(t, error),
    }),
  });
  const remove = useMutation({
    mutationFn: (article: AnalysisArticleRecord) => deleteAnalysisArticle(article.id, article.revision),
    onSuccess: async (_, article) => {
      setActionFailure(null);
      setSelectedId(null);
      await refreshArticle(article.id);
    },
    onError: async (error, article) => {
      setActionFailure(analysisFailure(t, error));
      // A concurrent edit is the usual cause; reload so a retry uses the new revision.
      await refreshArticle(article.id);
    },
  });

  const agentBinding = bindings.find((binding) =>
    binding.connectionId && !binding.stale && (
      !selected || (
        binding.remoteConnectionId === selected.connectionId
        && binding.connectionContentRevision === selected.connectionRevision
      )
    ),
  );
  const askAgent = () => {
    if (!agentBinding?.connectionId || !onOpenAgent) return;
    onOpenAgent(agentBinding.connectionId, environment.id,
      selected ? undefined : t("analysis.simpleAgentPrompt"), selected?.id);
  };

  // Pre-run check from cached state, mirroring the Desktop runner's preconditions:
  // the Article's pinned connection must still be bound, current, mirrored on this
  // device, and carry this member's credential. The runner repeats every check and
  // reports the same typed failures, which map to the same recovery steps.
  const connections = useQuery({ ...connectionsQuery(catalogScope.key), enabled: sharedWorkspace });
  const runBinding = selected
    ? bindings.find((binding) => binding.remoteConnectionId === selected.connectionId) ?? null
    : null;
  const runConnection = runBinding?.connectionId
    ? connections.data?.find((connection) => connection.id === runBinding.connectionId) ?? null
    : null;
  const runAccessIssue = runConnection ? connectionAccessIssue(runConnection) : undefined;
  const [credentialTarget, setCredentialTarget] = useState<ConnectionProfile | null>(null);
  const clearRunFailure = (articleId: string | undefined) => {
    setActionFailure(null);
    if (articleId) dismissAnalysisRunNotice(scopeKey, articleId);
  };
  const recheckConnection = useMutation({
    mutationFn: async (articleId: string | undefined) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionQueryKeys.all(catalogScope.key) }),
        queryClient.invalidateQueries({ queryKey: knowledgeQueryKeys.environmentConnections() }),
        queryClient.invalidateQueries({ queryKey: articleKey }),
      ]);
      return articleId;
    },
    onSuccess: clearRunFailure,
  });
  // The same rebind the Databases view's Reconfirm runs, for a binding that went stale
  // after its shared connection changed. The workspace service still authorizes it.
  const reconfirmBinding = useMutation({
    mutationFn: async ({ input, articleId }: {
      input: BindEnvironmentConnectionInput;
      articleId: string | undefined;
    }) => {
      await bindKnowledgeEnvironmentConnectionWithRefresh(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeQueryKeys.environmentConnections() }),
        queryClient.invalidateQueries({ queryKey: knowledgeQueryKeys.agentEnvironments() }),
      ]);
      return articleId;
    },
    onSuccess: clearRunFailure,
    onError: (error) => setActionFailure(analysisFailure(t, error)),
  });
  const resetRecheck = recheckConnection.reset;
  const resetReconfirm = reconfirmBinding.reset;
  useEffect(() => {
    resetRecheck();
    resetReconfirm();
  }, [resetRecheck, resetReconfirm, selected?.id]);
  // An empty binding list may still be loading, so the runner decides until the person
  // re-checks; after a re-check an empty list means the database was unbound.
  const pinIssue = selected && (bindings.length > 0 || recheckConnection.isSuccess)
    ? analysisRunPinIssue(selected, runBinding, !connections.isSuccess || runConnection !== null)
    : null;
  const runBlocker: AnalysisFailure | null = !selected
    ? null
    : pinIssue
      ? analysisPinFailure(t, pinIssue, selected, {
          rechecked: recheckConnection.isSuccess,
          canWrite,
          canManage: canManageBindings,
        })
      : runAccessIssue === "credentials"
        ? { message: t("analysis.errorCredentialBinding"), detail: null, recovery: "connectCredentials" }
        : runAccessIssue === "grant"
          ? { message: t("analysis.errorPermission"), detail: null }
          : null;

  return {
    actionFailure,
    agentBinding,
    articles,
    askAgent,
    canWrite,
    articleDocument,
    credentialTarget,
    documentQuery,
    editor,
    localResult,
    recoveredResult,
    reloadEditorBase,
    remove,
    resultOutdated,
    revisions,
    runBlocker,
    runSession,
    runs,
    saveArticle,
    selected,
    setTab,
    tab,
    /** The recovery step still in flight, so only its button shows progress. */
    recovering: recheckConnection.isPending
      ? "recheckConnection"
      : reconfirmBinding.isPending
        ? "reconfirmBinding"
        : null satisfies AnalysisRecovery | null as AnalysisRecovery | null,
    /** A re-check or reconfirm finished and the pin and credential now allow a rerun. */
    connectionRechecked: (recheckConnection.isSuccess || reconfirmBinding.isSuccess)
      && runBlocker === null,
    recover: (recovery: AnalysisRecovery) => {
      if (recovery === "connectCredentials" && runConnection && canBindCredentials(runConnection)) {
        setCredentialTarget(runConnection);
        return;
      }
      if (recovery === "reconfirmBinding" && canManageBindings && runBinding?.connectionId) {
        reconfirmBinding.mutate({
          input: {
            projectEnvironmentId: runBinding.projectEnvironmentId,
            connectionId: runBinding.connectionId,
            role: runBinding.role,
            alias: runBinding.alias,
          },
          articleId: selected?.id,
        });
        return;
      }
      if (recovery === "editArticle" && canWrite && articleDocument) {
        // Saving re-pins the Article to the chosen binding's current content.
        setEditor({
          base: articleDocument,
          failure: null,
          conflict: null,
          notice: runBlocker
            ? `${runBlocker.message} ${t("analysis.editorRepinHint")}`
            : t("analysis.editorRepinHint"),
        });
        return;
      }
      recheckConnection.mutate(selected?.id);
    },
    closeCredentials: () => setCredentialTarget(null),
    credentialsBound: () => {
      void queryClient.invalidateQueries({ queryKey: connectionQueryKeys.all(catalogScope.key) });
      clearRunFailure(selected?.id);
    },
    cancelRun: () => {
      if (selected) cancelAnalysisRun(scopeKey, selected.id);
    },
    closeEditor: () => setEditor(null),
    dismissRunNotice: () => {
      if (selected) dismissAnalysisRunNotice(scopeKey, selected.id);
    },
    openEditor: () => {
      if (articleDocument && canWrite) setEditor({ base: articleDocument, failure: null, conflict: null });
    },
    saveDraft: (input: SharedAnalysisArticleCreate) => {
      if (editor) saveArticle.mutate({ input, expectedRevision: editor.base.revision });
    },
    startRun: () => {
      // A blocked rerun is never started; the run area offers its recovery instead.
      if (!articleDocument || runBlocker) return;
      setActionFailure(null);
      resetRecheck();
      resetReconfirm();
      startAnalysisRun({ queryClient, scopeKey, catalogScope, article: articleDocument });
    },
  };
}

/** The same member-local credential binding the Connections screen offers. */
function canBindCredentials(connection: ConnectionProfile) {
  return connection.credentialMode === "memberLocal"
    && connection.workspaceAccess !== "view"
    && connection.workspaceAccess !== "local"
    && connection.engine !== "bigquery";
}
