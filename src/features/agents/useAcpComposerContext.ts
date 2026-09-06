// Projects the open Article into a small pointer owned by the active session's
// exact resource grant. Article HTML, SQL, and result rows stay behind its tools.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { CatalogTable } from "../../ipc/types";
import type { AnalysisArticleRecord } from "../analysisArticles/domain";
import { analysisQueryKeys } from "../analysisArticles/queryKeys";
import { listAnalysisArticles } from "../analysisArticles/tauriAdapter";
import type { KnowledgeEnvironmentFocus } from "../knowledge/domain";
import type { ConnectionProfile } from "../connections/domain";
import type { WorkbenchDocument } from "../workbench/domain";
import { buildAcpPromptContext, EMPTY_ACP_PROMPT_CONTEXT, summarizeAcpPromptContext } from "./acpPromptContext";
import type { AcpPromptContext, AgentKnowledgeScope } from "./domain";
import { useAgentSelection } from "./selectionContext";

type ArticlePointer = Pick<AnalysisArticleRecord,
  "id" | "revision" | "projectEnvironmentId" | "environmentRevision" |
  "connectionId" | "connectionRevision"
> & { definition: Pick<AnalysisArticleRecord["definition"], "title"> };

export function buildAcpArticleContext(
  article: ArticlePointer | undefined,
  scopes: readonly AgentKnowledgeScope[],
): AcpPromptContext | null {
  if (!article) return null;
  const scope = scopes.find((candidate) =>
    candidate.projectEnvironmentId === article.projectEnvironmentId
    && candidate.environmentRevision === article.environmentRevision,
  );
  const grant = scope?.connections.find((candidate) =>
    candidate.remoteConnectionId === article.connectionId
    && candidate.connectionContentRevision === article.connectionRevision,
  );
  if (!grant) return null;
  return {
    connectionId: grant.connectionId,
    database: null,
    documentName: article.definition.title,
    documentText: JSON.stringify({
      kind: "analysis_article",
      articleId: article.id,
      revision: article.revision,
      title: article.definition.title,
      projectEnvironmentId: article.projectEnvironmentId,
    }),
    table: null,
  };
}

function useAcpArticleContext(
  scopeKey: string,
  focus: KnowledgeEnvironmentFocus | null,
  scopes: readonly AgentKnowledgeScope[],
) {
  const environmentId = focus?.view === "analyses" ? focus.environmentId : null;
  const articleId = environmentId ? focus?.resourceId : null;
  const articles = useQuery({
    queryKey: analysisQueryKeys.articles(scopeKey, environmentId ?? undefined),
    queryFn: () => listAnalysisArticles(environmentId!),
    enabled: Boolean(articleId && scopes.some((scope) => scope.projectEnvironmentId === environmentId)),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return buildAcpArticleContext(
    articleId ? articles.data?.find((article) => article.id === articleId) : undefined,
    scopes,
  );
}

export function useAcpComposerContext({
  scopeKey, focus, scopes, connection, documents, activeDocumentId, selectedTable, editorConnectionSelected,
}: {
  scopeKey: string;
  focus: KnowledgeEnvironmentFocus | null;
  scopes: readonly AgentKnowledgeScope[];
  connection: ConnectionProfile;
  documents: readonly WorkbenchDocument[];
  activeDocumentId: string | null;
  selectedTable: CatalogTable | null;
  editorConnectionSelected: boolean;
}) {
  const { selection } = useAgentSelection();
  const [includeEditorContext, setIncludeEditorContext] = useState(false);
  const [excludedArticleId, setExcludedArticleId] = useState<string | null>(null);
  const articleContext = useAcpArticleContext(scopeKey, focus, scopes);
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const editorContext = useMemo(() =>
    !focus && editorConnectionSelected
      ? buildAcpPromptContext(connection, activeDocument, selectedTable, selection)
      : EMPTY_ACP_PROMPT_CONTEXT,
  [activeDocument, connection, editorConnectionSelected, focus, selectedTable, selection]);
  const context = articleContext ?? editorContext;
  const included = articleContext ? excludedArticleId !== focus?.resourceId : includeEditorContext;
  return {
    context,
    included,
    labels: summarizeAcpPromptContext(context),
    setIncludeEditorContext,
    toggle: () => {
      if (articleContext) setExcludedArticleId(included ? focus?.resourceId ?? null : null);
      else setIncludeEditorContext((current) => !current);
    },
  };
}
