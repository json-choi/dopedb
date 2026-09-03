"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceLocale } from "../../app/components/WorkspaceLocale";
import { analysisManagementText } from "./copy";
import type { AnalysisArticle, Detail } from "./domain";
import {
  loadAnalysisDetail,
  loadAnalysisOverview,
} from "./transport";

const emptyDetail: Detail = { runs: [], publications: [] };

export function useAnalysisManagement({
  workspaceId,
  initialArticleId,
}: {
  workspaceId: string;
  initialArticleId: string | null;
}) {
  const locale = useWorkspaceLocale();
  const text = analysisManagementText[locale];
  const [articles, setArticles] = useState<AnalysisArticle[]>([]);
  const [selectedId, setSelectedId] = useState(initialArticleId ?? "");
  const [detail, setDetail] = useState<Detail>(emptyDetail);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");

  const selected = useMemo(
    () => articles.find((article) => article.id === selectedId) ?? null,
    [articles, selectedId],
  );

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const overview = await loadAnalysisOverview(workspaceId, text.loadError, signal);
      if (signal?.aborted) return;
      setArticles(overview.articles);
      setSelectedId((current) => overview.articles.some((article) => article.id === current)
        ? current
        : overview.articles[0]?.id ?? "");
      setError("");
    } catch (nextError) {
      if (!signal?.aborted) {
        setError(nextError instanceof Error ? nextError.message : text.loadError);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [text.loadError, workspaceId]);

  const loadDetail = useCallback(async (articleId: string, signal?: AbortSignal) => {
    if (!articleId) {
      setDetail(emptyDetail);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    try {
      const nextDetail = await loadAnalysisDetail(workspaceId, articleId, text.detailError, signal);
      if (signal?.aborted) return;
      setDetail(nextDetail);
      setDetailError("");
    } catch (nextError) {
      if (!signal?.aborted) {
        setDetailError(nextError instanceof Error ? nextError.message : text.detailError);
      }
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, [text.detailError, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(selectedId, controller.signal);
    return () => controller.abort();
  }, [loadDetail, selectedId]);

  return {
    text,
    articles,
    selectedId,
    setSelectedId,
    detail,
    loading,
    detailLoading,
    error,
    detailError,
    selected,
    load,
  };
}

export type AnalysisManagementController = ReturnType<typeof useAnalysisManagement>;
