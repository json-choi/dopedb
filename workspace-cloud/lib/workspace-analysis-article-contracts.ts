// Current credential-free Analysis Article wire contract.

export const analysisArticleSources = [
  "human",
  "dopedb.acp.claude",
  "dopedb.acp.codex",
] as const;
export const analysisColumnTypes = [
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "duration",
  "currency",
  "percent",
  "json",
] as const;
export const analysisColumnRoles = [
  "dimension",
  "measure",
  "time",
  "identifier",
  "free_text",
] as const;
export const analysisColumnSensitivities = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export const analysisColumnMasking = ["none", "redact", "hash", "bucket"] as const;

export type AnalysisArticleSource = (typeof analysisArticleSources)[number];
export type AnalysisColumnType = (typeof analysisColumnTypes)[number];
export type AnalysisColumnRole = (typeof analysisColumnRoles)[number];
export type AnalysisColumnSensitivity = (typeof analysisColumnSensitivities)[number];
export type AnalysisColumnMasking = (typeof analysisColumnMasking)[number];

export type AnalysisColumn = Readonly<{
  name: string;
  type: AnalysisColumnType;
  nullable: boolean;
  role: AnalysisColumnRole;
  sensitivity: AnalysisColumnSensitivity;
  masking: AnalysisColumnMasking;
}>;

export type AnalysisQueryNode = Readonly<{
  id: string;
  title: string;
  sql: string;
  maxRows: number;
  maxBytes: number;
  columns: readonly AnalysisColumn[];
}>;

export type AnalysisArticleDefinition = Readonly<{
  version: 3;
  source: AnalysisArticleSource;
  title: string;
  html: string;
  query: AnalysisQueryNode;
}>;

export type SharedAnalysisArticleCreate = Readonly<{
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connectionId: string;
  connectionRevision: number;
  definition: AnalysisArticleDefinition;
}>;

export type AnalysisArticleVersionPayload = SharedAnalysisArticleCreate & Readonly<{
  ownerMemberId: string;
  deleted: boolean;
}>;
