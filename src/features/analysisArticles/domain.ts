export type AnalysisArticleSource =
  | "human"
  | "dopedb.acp.claude"
  | "dopedb.acp.codex"
  | "migration";
export type AnalysisCellValue = string | number | boolean | null;

export type AnalysisArticleConnection = {
  connectionId: string;
  connectionRevision: number;
  role: string;
  alias: string;
};

export type AnalysisColumn = {
  name: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "duration"
    | "currency"
    | "percent"
    | "json";
  nullable: boolean;
  role: "dimension" | "measure" | "time" | "identifier" | "free_text";
  sensitivity: "public" | "internal" | "confidential" | "restricted";
  masking: "none" | "redact" | "hash" | "bucket";
};

export type AnalysisQueryNode = {
  id: string;
  title: string;
  connectionRole: string;
  sql: string;
  maxRows: number;
  maxBytes: number;
  columns: AnalysisColumn[];
};

export type AnalysisArticleDefinition = {
  version: 3;
  source: AnalysisArticleSource;
  title: string;
  html: string;
  query: AnalysisQueryNode;
};

export type SharedAnalysisArticleCreate = {
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  sourceKnowledgeGrantId: string | null;
  graphRevisionIds: string[];
  connections: AnalysisArticleConnection[];
  definition: AnalysisArticleDefinition;
};

export type AnalysisArticleVersionPayload = SharedAnalysisArticleCreate & {
  ownerMemberId: string;
  deleted: boolean;
};

export type AnalysisArticleRecord = SharedAnalysisArticleCreate & {
  ownerMemberId: string;
  updatedByMemberId: string;
  revision: number;
  latestSuccessfulRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisQueryReceipt = {
  queryNodeId: string;
  connectionId: string;
  connectionRevision: number;
  queryRunId: string;
  queryHash: string;
  schemaFingerprint: string;
  state: "succeeded" | "failed" | "cancelled" | "stale";
  rowCount: number;
  byteCount: number;
  durationMs: number;
};

export type AnalysisResultData = {
  columns: AnalysisColumn[];
  rows: AnalysisCellValue[][];
  truncated: boolean;
};

export type AnalysisDefinitionRunReceipt = {
  runId: string;
  articleId: string;
  articleRevision: number;
  queryReceipts: AnalysisQueryReceipt[];
  result: AnalysisResultData;
  resultHash: string;
  startedAt: string;
  finishedAt: string;
};

export type AnalysisRun = {
  id: string;
  articleId: string;
  articleRevision: number;
  runnerId: string;
  runnerCapabilityGeneration: number | null;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";
  definitionHash: string;
  schemaFingerprints: Record<string, string>;
  rowCount: number;
  byteCount: number;
  resultHash: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  cancelRequestedAt: string | null;
  cancelRequestedByMemberId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type AnalysisRunCommandResult = {
  run: AnalysisRun;
  result: AnalysisDefinitionRunReceipt;
};

export type AnalysisRunPage = {
  runs: AnalysisRun[];
  nextCursor: string | null;
};

export type AnalysisArticleRevision = {
  revision: number;
  baseRevision: number | null;
  operation: string;
  payload: AnalysisArticleVersionPayload;
  payloadHash: string;
  createdByMemberId: string;
  createdAt: string;
};

export type AnalysisArticleChanged = {
  articleId: string;
  revision: number;
  action: "proposed" | "updated";
};

export type AnalysisPublicationRequest = {
  id: string;
  runId: string;
  slug: string;
  replacePublicationId: string | null;
  visibility: "unlisted" | "public";
  searchIndexable: boolean;
};

export type AnalysisPublication = {
  id: string;
  articleRevision: number;
  sourceRunId: string;
  slug: string;
  version: number;
  replacesPublicationId: string | null;
  visibility: "unlisted" | "public";
  title: string;
  description: string;
  snapshotHash: string;
  publishedAt: string;
  revokedAt: string | null;
};
