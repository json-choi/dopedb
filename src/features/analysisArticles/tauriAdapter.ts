import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invoke } from "../../ipc/core";
import type {
  AnalysisArticleRecord,
  AnalysisArticleChanged,
  AnalysisArticleRevision,
  AnalysisPublication,
  AnalysisPublicationRequest,
  AnalysisRun,
  AnalysisRunCommandResult,
  AnalysisRunPage,
  SharedAnalysisArticleCreate,
} from "./domain";

export function listAnalysisArticles(
  projectEnvironmentId?: string | null,
): Promise<AnalysisArticleRecord[]> {
  return invoke("list_analysis_articles_command", {
    projectEnvironmentId: projectEnvironmentId ?? null,
  });
}

export function updateAnalysisArticle(
  articleId: string,
  expectedRevision: number,
  article: SharedAnalysisArticleCreate,
): Promise<AnalysisArticleRecord> {
  return invoke("update_analysis_article_command", {
    articleId,
    expectedRevision,
    article,
  });
}

export function deleteAnalysisArticle(
  articleId: string,
  expectedRevision: number,
): Promise<number> {
  return invoke("delete_analysis_article_command", { articleId, expectedRevision });
}

export function listAnalysisArticleRevisions(
  articleId: string,
): Promise<AnalysisArticleRevision[]> {
  return invoke("list_analysis_article_revisions_command", { articleId });
}

export function listAnalysisArticleRuns(
  articleId: string,
  before?: string | null,
): Promise<AnalysisRunPage> {
  return invoke("list_analysis_article_runs_command", {
    articleId,
    before: before ?? null,
  });
}

export function getLocalAnalysisArticleResult(
  articleId: string,
  runId?: string | null,
): Promise<import("./domain").AnalysisDefinitionRunReceipt | null> {
  return invoke("get_local_analysis_article_result_command", {
    articleId,
    runId: runId ?? null,
  });
}

export function runAnalysisArticle(
  articleId: string,
  articleRevision: number,
  runId: string,
): Promise<AnalysisRunCommandResult> {
  return invoke("run_analysis_article_command", {
    articleId,
    articleRevision,
    runId,
  });
}

export function cancelAnalysisArticleRun(
  articleId: string,
  runId: string,
): Promise<AnalysisRun> {
  return invoke("cancel_analysis_article_run", { articleId, runId });
}

export function onAnalysisArticleChanged(
  listener: (change: AnalysisArticleChanged) => void,
): Promise<UnlistenFn> {
  return listen<AnalysisArticleChanged>("analysis-article:changed", (event) =>
    listener(event.payload),
  );
}

export function listAnalysisPublications(
  articleId: string,
): Promise<AnalysisPublication[]> {
  return invoke("list_analysis_publications_command", { articleId });
}

export function publishAnalysisSnapshot(
  articleId: string,
  request: AnalysisPublicationRequest,
): Promise<AnalysisPublication> {
  return invoke("create_analysis_publication_command", { articleId, request });
}

export function revokeAnalysisPublication(
  articleId: string,
  publicationId: string,
): Promise<string> {
  return invoke("revoke_analysis_publication_command", { articleId, publicationId });
}

export function analysisPublicationUrl(slug: string): Promise<string> {
  return invoke("analysis_publication_url_command", { slug });
}

export type ArticleSharingScope = { accountId: string; workspaceId: string; articleId: string };
export type ArticleInvitation = { id: string; recipientEmail: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null };
export type ArticleSharing = {
  workspaceId: string; articleId: string; projectEnvironmentId: string;
  title: string; workspaceName: string; connectionName: string; credentialMode: string;
  canInvite: boolean; url: string; invitations: ArticleInvitation[];
};
export function getArticleSharing(scope: ArticleSharingScope): Promise<ArticleSharing> {
  return invoke("article_sharing_command", scope);
}
export function createArticleInvitation(scope: ArticleSharingScope, email: string): Promise<{ id: string; url: string }> {
  return invoke("create_article_invitation_command", { ...scope, email });
}
export function revokeArticleInvitation(scope: ArticleSharingScope, invitationId: string): Promise<void> {
  return invoke("revoke_article_invitation_command", { ...scope, invitationId });
}
export type DesktopArticleLink = { requestId: string; workspaceId: string; articleId: string };
export function pendingArticleLink(): Promise<DesktopArticleLink | null> {
  return invoke("pending_article_link_command");
}
export function dismissArticleLink(requestId: string): Promise<void> {
  return invoke("dismiss_article_link_command", { requestId });
}
export function onArticleLink(listener: () => void): Promise<UnlistenFn> {
  return listen("analysis-article:open-link", listener);
}
