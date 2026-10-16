// Pure status model shared by the SQL editor and the run path. A run source keeps the exact
// document offsets after whitespace is trimmed off, and the execution marker resolves to null
// once the text under those offsets no longer matches, so a stale marker cannot be drawn.
import { splitStatementRanges } from "../../lib/sqlStatements";
export const SQL_EDITOR_INDENT_SIZE = 4;

export interface SqlCursorPosition {
  line: number;
  column: number;
}

export interface SqlEditorStatus extends SqlCursorPosition {
  documentId: string;
}

export type SqlExecutionState =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface SqlRunSource {
  sql: string;
  from: number;
  to: number;
}

export interface SqlRunChoice {
  kind: "statement" | "script";
  source: SqlRunSource;
}

/** Current statement and whole script, with exact offsets even for repeated SQL. */
export function sqlRunChoices(value: string, caret: number): SqlRunChoice[] {
  const statements = splitStatementRanges(value);
  if (statements.length < 2) return [];
  // At a separator, include the statement immediately before it. Between
  // statements, offer the following one; after the last, offer the last one.
  const current = statements.find((statement) => caret <= statement.to + 1)
    ?? statements[statements.length - 1];
  const sql = value.trim();
  const from = value.length - value.trimStart().length;
  return [
    { kind: "statement", source: current },
    { kind: "script", source: { sql, from, to: from + sql.length } },
  ];
}

export interface SqlExecutionStatus {
  source: SqlRunSource;
  state: SqlExecutionState;
  label: string;
}

export function sqlRunSourceFromSelection(
  value: string,
  from: number,
  to: number,
): SqlRunSource | undefined {
  if (from === to) return undefined;
  const raw = value.slice(from, to);
  const sql = raw.trim();
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  return {
    sql,
    from: from + leadingWhitespace,
    to: to - trailingWhitespace,
  };
}

export function sqlExecutionMarkerPosition(
  value: string,
  status: SqlExecutionStatus | null | undefined,
): number | null {
  const source = status?.source;
  if (
    !source ||
    !source.sql ||
    source.from < 0 ||
    source.to < source.from ||
    source.to > value.length ||
    value.slice(source.from, source.to).trim() !== source.sql
  ) {
    return null;
  }
  return source.to;
}
