import {
  analysisArticleSources,
  type AnalysisArticleConnection,
  type AnalysisArticleDefinition,
  type AnalysisArticleSource,
  type AnalysisArticleVersionPayload,
  type AnalysisQueryNode,
  type SharedAnalysisArticleCreate,
} from "./workspace-analysis-article-contracts";
import { parseColumns } from "./workspace-analysis-column-parser";
import { sanitizeAnalysisArticleHtml } from "./workspace-analysis-html";
import { parseLegacyAnalysisArticleDefinition } from "./workspace-analysis-legacy-definition";
import {
  parseRetiredAnalysisArticleVersionPayload,
  withRetiredArticleRecordFields,
} from "./workspace-analysis-version-compat";
import {
  analysisId as id,
  displayText,
  exactRecord,
  safeInteger,
  uniqueValues as unique,
} from "./workspace-analysis-validation";

export * from "./workspace-analysis-article-contracts";
export { sanitizeAnalysisArticleHtml } from "./workspace-analysis-html";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sqlTokens(sql: string) {
  const tokens: string[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index]!;
    const next = sql[index + 1];
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      index = sql.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unterminated Analysis Article SQL comment");
      index = end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        if (sql[index] === "\\" && quote !== '"') index += 1;
        index += 1;
      }
      if (!closed) throw new Error("Unterminated Analysis Article SQL string");
      continue;
    }
    if (char === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u.exec(sql.slice(index))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        if (end < 0) throw new Error("Unterminated Analysis Article SQL string");
        index = end + tag.length;
        continue;
      }
    }
    if (/[A-Za-z_]/u.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/u.exec(sql.slice(index))![0];
      tokens.push(match.toLowerCase());
      index += match.length;
      continue;
    }
    if (char === ";") tokens.push(";");
    index += 1;
  }
  return tokens;
}

function validateReadOnlySql(sql: string) {
  const tokens = sqlTokens(sql);
  const first = tokens[0];
  if (!first || !["select", "with", "show", "describe", "desc", "explain"].includes(first)
    || tokens.filter((token) => token === ";").length > 1
    || (tokens.includes(";") && tokens.at(-1) !== ";")) {
    throw new Error("Analysis Article source must be one read-only statement");
  }
  const prohibited = new Set([
    "insert", "update", "delete", "merge", "replace", "upsert", "copy", "call", "do",
    "create", "alter", "drop", "truncate", "grant", "revoke", "attach", "detach",
    "vacuum", "analyze", "refresh", "reindex", "cluster", "lock", "set", "reset",
  ]);
  if (tokens.some((token) => prohibited.has(token))) {
    throw new Error("Analysis Article source contains a write or session command");
  }
}

function parseConnection(value: unknown): AnalysisArticleConnection {
  const row = exactRecord(value, ["connectionId", "connectionRevision", "role", "alias"]);
  const revision = safeInteger(row?.connectionRevision, 1, Number.MAX_SAFE_INTEGER);
  const role = id(row?.role);
  const alias = displayText(row?.alias, 128);
  if (!row || typeof row.connectionId !== "string" || !UUID.test(row.connectionId)
    || revision === null || role === null || alias === null) {
    throw new Error("Invalid Analysis Article connection");
  }
  return { connectionId: row.connectionId, connectionRevision: revision, role, alias };
}

function parseQuery(value: unknown): AnalysisQueryNode {
  const row = exactRecord(value, [
    "id", "title", "connectionRole", "sql", "maxRows", "maxBytes", "columns",
  ]);
  const queryId = id(row?.id);
  const title = displayText(row?.title, 256);
  const connectionRole = id(row?.connectionRole);
  const maxRows = safeInteger(row?.maxRows, 1, 50_000);
  const maxBytes = safeInteger(row?.maxBytes, 1_024, 16 * 1024 * 1024);
  if (!row || queryId === null || title === null || connectionRole === null
    || typeof row.sql !== "string" || row.sql.trim().length === 0
    || new TextEncoder().encode(row.sql).byteLength > 100_000 || row.sql.includes("\u0000")
    || maxRows === null || maxBytes === null) {
    throw new Error("Invalid Analysis Article query");
  }
  validateReadOnlySql(row.sql);
  return {
    id: queryId,
    title,
    connectionRole,
    sql: row.sql,
    maxRows,
    maxBytes,
    columns: parseColumns(row.columns),
  };
}

function parseCurrentDefinition(value: unknown): AnalysisArticleDefinition | null {
  const row = exactRecord(value, ["version", "source", "title", "html", "query"]);
  if (!row) return null;
  const title = displayText(row.title, 160);
  if (row.version !== 3 || typeof row.source !== "string"
    || !analysisArticleSources.includes(row.source as AnalysisArticleSource) || title === null) {
    throw new Error("Invalid Analysis Article definition");
  }
  return {
    version: 3,
    source: row.source as AnalysisArticleSource,
    title,
    html: sanitizeAnalysisArticleHtml(row.html),
    query: parseQuery(row.query),
  };
}

function parseDefinition(value: unknown) {
  return parseCurrentDefinition(value) ?? parseLegacyAnalysisArticleDefinition(value, parseQuery);
}

export function parseSharedAnalysisArticleCreate(value: unknown): SharedAnalysisArticleCreate {
  const row = exactRecord(value, [
    "id", "projectEnvironmentId", "environmentRevision", "sourceKnowledgeGrantId",
    "graphRevisionIds", "connections", "definition",
  ]);
  const environmentRevision = safeInteger(row?.environmentRevision, 1, Number.MAX_SAFE_INTEGER);
  if (!row || typeof row.id !== "string" || !UUID.test(row.id)
    || typeof row.projectEnvironmentId !== "string" || !UUID.test(row.projectEnvironmentId)
    || environmentRevision === null
    || row.sourceKnowledgeGrantId !== null
    || !Array.isArray(row.graphRevisionIds) || row.graphRevisionIds.length !== 0
    || !Array.isArray(row.connections) || row.connections.length < 1 || row.connections.length > 32) {
    throw new Error("Invalid Analysis Article authority");
  }
  const connections = row.connections.map(parseConnection);
  if (!unique(connections.map((connection) => connection.connectionId))
    || !unique(connections.map((connection) => connection.role))) {
    throw new Error("Duplicate Analysis Article connection authority");
  }
  const definition = parseDefinition(row.definition);
  const queryConnection = connections.find(
    (connection) => connection.role === definition.query.connectionRole,
  );
  if (!queryConnection) throw new Error("Analysis Article query connection is unavailable");
  return {
    id: row.id,
    projectEnvironmentId: row.projectEnvironmentId,
    environmentRevision,
    sourceKnowledgeGrantId: null,
    graphRevisionIds: [],
    connections: [queryConnection],
    definition,
  };
}

export function analysisArticleVersionPayload(input: SharedAnalysisArticleCreate & {
  ownerMemberId: string;
  deleted?: boolean;
}): AnalysisArticleVersionPayload {
  const parsed = parseSharedAnalysisArticleCreate(input);
  if (!input.ownerMemberId) {
    throw new Error("Invalid Analysis Article version authority");
  }
  return { ...parsed, ownerMemberId: input.ownerMemberId, deleted: input.deleted ?? false };
}

export function parseAnalysisArticleVersionPayload(value: unknown): AnalysisArticleVersionPayload {
  const row = exactRecord(value, [
    "id", "projectEnvironmentId", "environmentRevision", "sourceKnowledgeGrantId",
    "graphRevisionIds", "connections", "definition", "ownerMemberId", "deleted",
  ]);
  if (row && typeof row.ownerMemberId === "string"
    && row.ownerMemberId.length > 0 && typeof row.deleted === "boolean") {
    const article = parseSharedAnalysisArticleCreate(row);
    return { ...article, ownerMemberId: row.ownerMemberId, deleted: row.deleted };
  }
  const retired = parseRetiredAnalysisArticleVersionPayload(
    value,
    parseSharedAnalysisArticleCreate,
  );
  if (retired) return retired;
  throw new Error("Invalid Analysis Article revision payload");
}

export function publicAnalysisArticle(row: {
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  sourceKnowledgeGrantId: string | null;
  graphRevisionIds: readonly string[];
  connections: readonly AnalysisArticleConnection[];
  definition: unknown;
  ownerMemberId: string;
  updatedByMemberId: string;
  revision: number;
  latestSuccessfulRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const parsed = parseSharedAnalysisArticleCreate(row);
  if (!row.ownerMemberId || !row.updatedByMemberId
    || safeInteger(row.revision, 1, Number.MAX_SAFE_INTEGER) === null
    || !(row.latestSuccessfulRunId === null || UUID.test(row.latestSuccessfulRunId))
    || Number.isNaN(row.createdAt.valueOf()) || Number.isNaN(row.updatedAt.valueOf())) {
    throw new Error("Invalid stored Analysis Article");
  }
  return withRetiredArticleRecordFields({
    ...parsed,
    ownerMemberId: row.ownerMemberId,
    updatedByMemberId: row.updatedByMemberId,
    revision: row.revision,
    latestSuccessfulRunId: row.latestSuccessfulRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
