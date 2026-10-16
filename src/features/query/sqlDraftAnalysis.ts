// Pure client-side SQL draft analysis shared by the main-thread hook and the
// worker: statement splitting, parameter detection, run-signal risk tones, and
// the leading-comment result-tab title. No IPC; inputs and outputs are plain text.
import type { ConnectionEngine } from "../connections/domain";
import { splitStatements } from "../../lib/sqlStatements";
import { findSqlParameters } from "./sqlParameters";
import {
  analyzeRunSignal,
  type RunSignalAnalysis,
  type RunSignalSafety,
} from "./runSignal";

export interface SqlDraftAnalysisRequest {
  requestId: number;
  version: number;
  sql: string;
  engine: ConnectionEngine;
  safety: RunSignalSafety;
}

export interface SqlDraftAnalysisResult {
  requestId: number;
  version: number;
  statementCount: number;
  parameterCount: number;
  runSignal: RunSignalAnalysis | null;
}

/**
 * Result-tab title from the comment section before a statement: the first
 * non-empty `--` line or block-comment line before the first code token, as in
 * `-- 월별 매출` above a query. Returns null when the text starts with code,
 * is comments only, or the leading comments carry no text.
 */
export function sqlResultTitle(sql: string): string | null {
  let index = 0;
  while (index < sql.length) {
    while (index < sql.length && /\s/.test(sql[index])) index += 1;
    if (sql.startsWith("--", index)) {
      const lineEnd = sql.indexOf("\n", index);
      const comment = sql
        .slice(index + 2, lineEnd === -1 ? sql.length : lineEnd)
        .trim();
      if (comment) return comment;
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      // An unterminated block comment is unfinished code, not a title.
      if (end === -1) return null;
      const comment = sql
        .slice(index + 2, end)
        .split("\n")
        .map((line) => line.replace(/^\*+/, "").replace(/\*+$/, "").trim())
        .find((line) => line.length > 0);
      if (comment) return comment;
      index = end + 2;
      continue;
    }
    return null;
  }
  return null;
}

export function analyzeSqlDraft({
  requestId,
  version,
  sql,
  engine,
  safety,
}: SqlDraftAnalysisRequest): SqlDraftAnalysisResult {
  const statements = splitStatements(sql);
  return {
    requestId,
    version,
    statementCount: statements.length,
    parameterCount: findSqlParameters(sql, engine).length,
    runSignal: analyzeRunSignal(sql, statements, safety),
  };
}
