// Contract shared by the SQL editor and its status bar: cursor position, the exact
// text a run came from, and where the execution marker belongs. The marker is
// withheld unless the recorded range still holds that same statement.
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
