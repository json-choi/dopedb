// HTTP transport owns the bounded Article, run, and publication requests.
import type {
  AnalysisArticle,
  AnalysisPublication,
  AnalysisRun,
  Detail,
} from "./domain";

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function responseError(response: Response | null, fallback: string) {
  const body = await response?.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

export type AnalysisOverview = Readonly<{
  articles: AnalysisArticle[];
}>;

export async function loadAnalysisOverview(
  workspaceId: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<AnalysisOverview> {
  const base = `/api/v1/workspaces/${workspaceId}/analyses`;
  const articleResponse = await fetch(base, { cache: "no-store", signal }).catch(() => null);
  if (!articleResponse?.ok) throw new Error(await responseError(articleResponse, fallback));
  const articleBody = await articleResponse.json().catch(() => null);
  return {
    articles: array<AnalysisArticle>(object(articleBody)?.articles),
  };
}

export async function loadAnalysisDetail(
  workspaceId: string,
  articleId: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<Detail> {
  const prefix = `/api/v1/workspaces/${workspaceId}/analyses/${articleId}`;
  const [runResponse, publicationResponse] = await Promise.all([
    fetch(`${prefix}/runs`, { cache: "no-store", signal }).catch(() => null),
    fetch(`${prefix}/publications`, { cache: "no-store", signal }).catch(() => null),
  ]);
  const failed = [runResponse, publicationResponse].find((response) => !response?.ok) ?? null;
  if (failed) throw new Error(await responseError(failed, fallback));
  const [runBody, publicationBody] = await Promise.all([
    runResponse!.json().catch(() => null),
    publicationResponse!.json().catch(() => null),
  ]);
  return {
    runs: array<AnalysisRun>(object(runBody)?.runs),
    publications: array<AnalysisPublication>(object(publicationBody)?.publications),
  };
}
