// Bounded read adapter for retired expanded Analysis Article definitions.
// It extracts only HTML and one exact query; no retired behavior is returned.

import {
  analysisArticleSources,
  type AnalysisArticleDefinition,
  type AnalysisArticleSource,
  type AnalysisQueryNode,
} from "./workspace-analysis-article-contracts";
import {
  legacyArticleHtml,
  sanitizeAnalysisArticleHtml,
  type LegacyNarrativeBlock,
} from "./workspace-analysis-html";
import { displayText, exactRecord } from "./workspace-analysis-validation";

type QueryParser = (value: unknown) => AnalysisQueryNode;

function parseLegacyQuery(value: unknown, parseQuery: QueryParser): AnalysisQueryNode {
  const row = exactRecord(value, [
    "id", "title", "connectionRole", "sql", "parameterIds",
    "maxRows", "maxBytes", "cacheTtlSeconds", "columns",
  ]);
  if (!row || !Array.isArray(row.parameterIds) || row.parameterIds.length !== 0
    || row.cacheTtlSeconds !== 0) {
    throw new Error("Parameterized or cached retired Analysis queries require manual migration");
  }
  return parseQuery({
    id: row.id,
    title: row.title,
    connectionRole: row.connectionRole,
    sql: row.sql,
    maxRows: row.maxRows,
    maxBytes: row.maxBytes,
    columns: row.columns,
  });
}

function legacyBlocks(value: unknown): LegacyNarrativeBlock[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new Error("Invalid retired Analysis Article blocks");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid retired Analysis Article block");
    }
    const block = candidate as Record<string, unknown>;
    if (typeof block.kind !== "string" || !block.config || typeof block.config !== "object"
      || Array.isArray(block.config)) {
      throw new Error("Invalid retired Analysis Article block");
    }
    return { kind: block.kind, config: block.config as Readonly<Record<string, unknown>> };
  });
}

function boundedLegacyArrays(row: Record<string, unknown>) {
  const bounds: ReadonlyArray<readonly [string, number]> = [
    ["parameters", 32],
    ["queries", 64],
    ["transforms", 128],
    ["metrics", 128],
    ["blocks", 128],
    ["claims", 128],
    ["warnings", 64],
  ];
  if (bounds.some(([key, maximum]) => !Array.isArray(row[key])
    || (row[key] as unknown[]).length > maximum)) {
    throw new Error("Invalid retired Analysis Article definition bounds");
  }
}

function parseSharedFields(row: Record<string, unknown>, parseQuery: QueryParser) {
  const title = displayText(row.title, 160);
  const question = displayText(row.question, 8_000, true);
  const summary = displayText(row.summary, 20_000, true);
  const timezone = displayText(row.timezone, 128);
  if (typeof row.source !== "string"
    || !analysisArticleSources.includes(row.source as AnalysisArticleSource)
    || title === null || question === null || summary === null || timezone === null) {
    throw new Error("Invalid retired Analysis Article definition");
  }
  boundedLegacyArrays(row);
  const queries = row.queries as unknown[];
  if (queries.length < 1) throw new Error("Retired Analysis Article has no saved query");
  const query = parseLegacyQuery(queries[0], parseQuery);
  return { title, question, summary, timezone, query, source: row.source as AnalysisArticleSource };
}

function parseExpandedV2(value: unknown, parseQuery: QueryParser): AnalysisArticleDefinition {
  const row = exactRecord(value, [
    "version", "source", "title", "html", "question", "summary", "timezone", "parameters",
    "queries", "transforms", "metrics", "blocks", "claims", "refresh", "warnings",
  ]);
  if (!row || row.version !== 2) throw new Error("Invalid retired Analysis Article version");
  const shared = parseSharedFields(row, parseQuery);
  const refresh = exactRecord(row.refresh, [
    "mode", "cron", "timezone", "runnerId", "maxStalenessSeconds",
    "resultRetentionDays", "shareReviewedResults",
  ]);
  const blocks = legacyBlocks(row.blocks);
  const firstBlock = (row.blocks as unknown[])[0] as Record<string, unknown>;
  if (shared.question !== "" || shared.summary !== "" || shared.timezone !== "UTC"
    || (row.parameters as unknown[]).length !== 0 || (row.queries as unknown[]).length !== 1
    || (row.transforms as unknown[]).length !== 0 || (row.metrics as unknown[]).length !== 0
    || (row.claims as unknown[]).length !== 0 || (row.warnings as unknown[]).length !== 0
    || blocks.length !== 1 || firstBlock.id !== "query_result" || firstBlock.kind !== "table"
    || firstBlock.sourceNodeId !== shared.query.id || firstBlock.width !== 12
    || !refresh || refresh.mode !== "manual" || refresh.cron !== null
    || refresh.timezone !== "UTC" || refresh.runnerId !== null
    || refresh.shareReviewedResults !== false) {
    throw new Error("Retired Analysis Article is not a normalized manual definition");
  }
  return {
    version: 3,
    source: shared.source,
    title: shared.title,
    html: sanitizeAnalysisArticleHtml(row.html),
    query: shared.query,
  };
}

function parseV1(value: unknown, parseQuery: QueryParser): AnalysisArticleDefinition {
  const row = exactRecord(value, [
    "version", "source", "title", "question", "summary", "timezone", "parameters",
    "queries", "transforms", "metrics", "blocks", "claims", "refresh", "warnings",
  ]);
  if (!row || row.version !== 1) throw new Error("Invalid retired Analysis Article version");
  const shared = parseSharedFields(row, parseQuery);
  if ((row.parameters as unknown[]).length !== 0) {
    throw new Error("Parameterized retired Analysis Articles require manual migration");
  }
  return {
    version: 3,
    source: shared.source,
    title: shared.title,
    html: legacyArticleHtml(shared.question, shared.summary, legacyBlocks(row.blocks)),
    query: shared.query,
  };
}

export function parseLegacyAnalysisArticleDefinition(
  value: unknown,
  parseQuery: QueryParser,
): AnalysisArticleDefinition {
  const version = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).version
    : null;
  if (version === 2) return parseExpandedV2(value, parseQuery);
  if (version === 1) return parseV1(value, parseQuery);
  throw new Error("Unsupported retired Analysis Article definition");
}
