// App-lifetime owner of manual Analysis Article runs. A run keeps executing when its
// screen unmounts, so its lifecycle, latest in-memory result, and terminal notice live
// here; every reader of the same workspace scope and Article sees one state.
import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { CatalogScope } from "../../lib/queries";
import type { AnalysisArticleDocument, AnalysisDefinitionRunReceipt } from "./domain";
import { beginManualAnalysisRunOutcome } from "./productAnalytics";
import { analysisQueryKeys } from "./queryKeys";
import {
  cancelAnalysisArticleRun,
  listAnalysisArticleRuns,
  runAnalysisArticle,
} from "./tauriAdapter";

export type AnalysisRunNotice =
  | { kind: "cancelled" }
  | { kind: "failed"; error: unknown }
  | { kind: "cancelFailed"; error: unknown };

export type AnalysisRunSession = Readonly<{
  running: Readonly<{ runId: string; articleRevision: number; cancelRequested: boolean }> | null;
  /** `querySignature` is the exact connection pin and SQL the result came from. */
  result: Readonly<{ receipt: AnalysisDefinitionRunReceipt; querySignature: string }> | null;
  notice: AnalysisRunNotice | null;
}>;

const IDLE: AnalysisRunSession = { running: null, result: null, notice: null };
const sessions = new Map<string, AnalysisRunSession>();
const listeners = new Set<() => void>();

function sessionKey(scopeKey: string, articleId: string) {
  return `${scopeKey}\u0000${articleId}`;
}

function read(key: string) {
  return sessions.get(key) ?? IDLE;
}

function update(key: string, next: (current: AnalysisRunSession) => AnalysisRunSession) {
  sessions.set(key, next(read(key)));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A result is current only while the Article still pins the same connection and SQL. */
export function analysisQuerySignature(article: AnalysisArticleDocument) {
  return JSON.stringify([
    article.connectionId,
    article.connectionRevision,
    article.definition.query.sql,
  ]);
}

export function useAnalysisRunSession(scopeKey: string, articleId: string | null) {
  return useSyncExternalStore(subscribe, () =>
    articleId ? read(sessionKey(scopeKey, articleId)) : IDLE,
  );
}

async function refreshRunViews(queryClient: QueryClient, scopeKey: string, articleId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: analysisQueryKeys.articles(scopeKey) }),
    queryClient.invalidateQueries({ queryKey: analysisQueryKeys.runs(scopeKey, articleId) }),
    queryClient.invalidateQueries({ queryKey: analysisQueryKeys.localResult(scopeKey, articleId) }),
  ]);
}

/** Starts one manual rerun unless this Article already has one in flight. */
export function startAnalysisRun({
  queryClient,
  scopeKey,
  catalogScope,
  article,
}: {
  queryClient: QueryClient;
  scopeKey: string;
  catalogScope: CatalogScope;
  article: AnalysisArticleDocument;
}) {
  const key = sessionKey(scopeKey, article.id);
  if (read(key).running) return;
  const runId = crypto.randomUUID();
  const querySignature = analysisQuerySignature(article);
  const completeAnalytics = beginManualAnalysisRunOutcome(catalogScope);
  update(key, (current) => ({
    ...current,
    running: { runId, articleRevision: article.revision, cancelRequested: false },
    notice: null,
  }));
  void runAnalysisArticle(article.id, article.revision, runId).then(
    async (value) => {
      completeAnalytics(value.run);
      update(key, () => ({
        running: null,
        result: { receipt: value.result, querySignature },
        notice: null,
      }));
      await refreshRunViews(queryClient, scopeKey, article.id);
    },
    async (error: unknown) => {
      // Only the person's own cancellation is neutral; losing run authority or a
      // database failure stays a failure even when the backend stopped the query.
      const cancelled = read(key).running?.cancelRequested === true;
      update(key, (current) => ({
        ...current,
        running: null,
        notice: cancelled ? { kind: "cancelled" } : { kind: "failed", error },
      }));
      try {
        const page = await listAnalysisArticleRuns(article.id);
        completeAnalytics(page.runs.find((run) => run.id === runId));
      } catch {
        // Do not infer a terminal analytics state without a durable run receipt.
      }
      await refreshRunViews(queryClient, scopeKey, article.id);
    },
  );
}

/** Idempotent: a second request while one is pending, or after the run ended, is ignored. */
export function cancelAnalysisRun(scopeKey: string, articleId: string) {
  const key = sessionKey(scopeKey, articleId);
  const running = read(key).running;
  if (!running || running.cancelRequested) return;
  update(key, (current) => current.running
    ? { ...current, running: { ...current.running, cancelRequested: true } }
    : current);
  void cancelAnalysisArticleRun(articleId, running.runId).catch((error: unknown) => {
    // A run that already finished rejects cancellation; its own completion settles
    // the state. Only a cancel that failed while the run continues is reported.
    update(key, (current) => current.running?.runId === running.runId
      ? {
          ...current,
          running: { ...current.running, cancelRequested: false },
          notice: { kind: "cancelFailed", error },
        }
      : current);
  });
}

export function dismissAnalysisRunNotice(scopeKey: string, articleId: string) {
  update(sessionKey(scopeKey, articleId), (current) => ({ ...current, notice: null }));
}
