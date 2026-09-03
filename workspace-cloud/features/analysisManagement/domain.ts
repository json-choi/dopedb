// Analysis management exposes the shared HTML document, manual run history,
// and publication history. Query results stay local to Desktop.
import type { AnalysisArticleDefinition } from "../../lib/workspace-analysis-articles";

export type AnalysisArticle = {
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connections: Array<{ connectionId: string; connectionRevision: number; alias: string }>;
  definition: AnalysisArticleDefinition;
  revision: number;
  latestSuccessfulRunId: string | null;
  updatedAt: string;
};

export type AnalysisRun = {
  id: string;
  articleRevision: number;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";
  rowCount: number;
  byteCount: number;
  errorKind: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AnalysisPublication = {
  id: string;
  slug: string;
  version: number;
  visibility: "unlisted" | "public";
  title: string;
  publishedAt: string;
  revokedAt: string | null;
};

export type Detail = {
  runs: AnalysisRun[];
  publications: AnalysisPublication[];
};
