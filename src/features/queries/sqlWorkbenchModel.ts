// Pure state and text projections shared by the manual SQL workbench controller,
// including the Services projection (status and result) of its latest run.
import type { ConnectionProfile } from "../connections/domain";
import type {
  AppErrorDetails,
  ExecOutcome,
  ScriptOutcome,
} from "../../ipc/types";
import type { SqlParameter } from "../query/sqlParameters";
import type {
  QueryServiceResult,
  QueryServiceStatus,
} from "../queryServices/domain";
import type { SqlStreamViewState } from "./domain";
import type { SqlExecutionStatus, SqlRunSource } from "./editorStatus";

export interface SqlWorkbenchRun {
  sql: string;
  outcome: ExecOutcome;
  at: string;
}

export interface SqlWorkbenchErrorInfo extends AppErrorDetails {
  sql: string;
  at: string;
}

/** A failed Explain, kept typed so the screen frames it in translated copy. */
export interface SqlWorkbenchPlanError {
  kind: string | null;
  message: string;
}

export interface SqlWorkbenchLastAttempt {
  sql: string;
  at: string;
  documentVersion: number;
  source: SqlRunSource;
}

export type SqlWorkbenchResultKind = "single" | "script";

export interface SqlParameterDialogState {
  sql: string;
  source: SqlRunSource;
  parameters: SqlParameter[];
  action: "apply" | "explain" | "run";
}

/** The database's or parser's own diagnostic without DopeDB transport prefixes. */
export function sqlDiagnosticDetail(message: string) {
  return message
    .replace(/^(database error|parse error|sql parse error):\s*/i, "")
    .replace(/^error returned from database:\s*/i, "")
    .trim();
}

const OID_ALIAS_TYPE =
  "reg(?:class|collation|config|dictionary|namespace|oper|operator|proc|procedure|role|type)";
/** A cast to a reg* type (or its array) that is not cast again, as with `::text`. */
const OID_ALIAS_CAST = new RegExp(
  `::\\s*${OID_ALIAS_TYPE}\\b(?!\\s*(?:\\[\\s*\\])?\\s*::)|\\bas\\s+${OID_ALIAS_TYPE}\\s*\\)(?!\\s*::)`,
  "i",
);
/** PostgreSQL functions whose result is a reg* value. */
const OID_ALIAS_CALL = new RegExp(
  `\\b(?:pg_typeof|to_${OID_ALIAS_TYPE})\\s*\\(`,
  "gi",
);

/**
 * Whether PostgreSQL SQL reads reg* values (`::regclass`, `pg_typeof()`, …) without
 * casting them on to text. The result grid shows those values as numeric OIDs, so
 * the result offers a hint that `::text` shows their names. Advisory only.
 */
export function readsOidAliases(sql: string): boolean {
  const text = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
  if (OID_ALIAS_CAST.test(text)) return true;
  for (const call of text.matchAll(OID_ALIAS_CALL)) {
    // Find the call's closing parenthesis, then whether it is cast again.
    let depth = 1;
    let index = (call.index ?? 0) + call[0].length;
    for (; index < text.length && depth > 0; index += 1) {
      if (text[index] === "(") depth += 1;
      else if (text[index] === ")") depth -= 1;
    }
    if (!/^\s*::/.test(text.slice(index))) return true;
  }
  return false;
}

/**
 * Where a failed run points in the live editor. The backend position is a 1-based
 * character offset into exactly the submitted text, so it maps onto the editor only
 * while that text (not a parameter-materialized copy) is still in place.
 */
export function sqlErrorEditorLocation(
  draft: string,
  attempt: SqlWorkbenchLastAttempt | null,
  position: number | null,
) {
  const source = attempt?.source;
  if (position === null || !attempt || !source) return null;
  if (
    attempt.sql !== source.sql ||
    draft.slice(source.from, source.to).trim() !== source.sql
  ) {
    return null;
  }
  const characters = Array.from(source.sql);
  const index = Math.min(Math.max(position - 1, 0), characters.length);
  let from = source.from + characters.slice(0, index).join("").length;
  let to = from;
  while (to < source.to && /[\w$]/u.test(draft[to] ?? "")) to += 1;
  if (to === from) {
    // "at end of input" points past the text: mark its last character instead.
    if (from >= source.to && from > source.from) from -= 1;
    to = from + 1;
  }
  const lineStart = draft.lastIndexOf("\n", from - 1) + 1;
  return {
    from,
    to,
    line: draft.slice(0, from).split("\n").length,
    column: from - lineStart + 1,
  };
}

/** The run outcome drawn at the end of the exact statement it ran. */
export function sqlEditorExecutionStatus(
  attempt: SqlWorkbenchLastAttempt | null,
  documentVersion: number,
  run: {
    failed: boolean;
    running: boolean;
    cancelled: boolean;
    completed: boolean;
    durationMs: number | null;
    labels: Record<"failed" | "running" | "cancelled" | "completed", string>;
  },
): SqlExecutionStatus | null {
  if (!attempt?.sql.trim() || attempt.documentVersion !== documentVersion) {
    return null;
  }
  const status = (state: SqlExecutionStatus["state"], label: string) => ({
    source: attempt.source,
    state,
    label,
  });
  if (run.failed) return status("failed", run.labels.failed);
  if (run.running) return status("running", run.labels.running);
  if (run.cancelled) return status("cancelled", run.labels.cancelled);
  if (!run.completed) return null;
  return status(
    "completed",
    run.durationMs === null
      ? run.labels.completed
      : `${Math.round(run.durationMs)} ms`,
  );
}

/**
 * The Services status and result of the latest run. A stream that ended in error
 * or with an unconfirmable receipt is terminal even when no exception reached the
 * run. A cancel always reports `cancelled`; rows it had already received stay
 * visible as a partial stream result.
 */
export function sqlWorkbenchSessionOutcome(run: {
  sessionSql: string;
  sessionStartedLabel: string;
  runErr: SqlWorkbenchErrorInfo | null;
  prompt: string;
  stream: SqlStreamViewState;
  streamFailed: boolean;
  resultKind: SqlWorkbenchResultKind | null;
  scriptOut: { outcome: ScriptOutcome; at: string } | null;
  materialized: SqlWorkbenchRun | null;
  lastAttempt: SqlWorkbenchLastAttempt | null;
  maxRows: number;
  running: boolean;
  cancelled: boolean;
}): { status: QueryServiceStatus; result: QueryServiceResult } {
  const { stream } = run;
  const sql = run.lastAttempt?.sql ?? run.sessionSql;
  let result: QueryServiceResult = { kind: "none" };
  if (run.runErr) {
    result = { kind: "error", error: run.runErr, prompt: run.prompt };
  } else if (run.streamFailed) {
    result = {
      kind: "error",
      error: {
        kind: stream.phase === "outcome_unknown" ? "outcomeUnknown" : null,
        message: stream.error ?? "",
        position: null,
        raw: stream.error ?? "",
        sql,
        at: run.lastAttempt?.at ?? run.sessionStartedLabel,
      },
      prompt: run.prompt,
    };
  } else if (run.resultKind === "script" && run.scriptOut) {
    result = {
      kind: "script",
      outcome: run.scriptOut.outcome,
      at: run.scriptOut.at,
    };
  } else if (run.resultKind === "single" && run.materialized) {
    result = {
      kind: "materialized",
      sql: run.materialized.sql,
      outcome: run.materialized.outcome,
      at: run.materialized.at,
      maxRows: run.maxRows,
    };
  } else if (
    run.resultKind === "single" &&
    (stream.phase === "connecting" ||
      stream.phase === "streaming" ||
      stream.phase === "complete" ||
      (stream.phase === "cancelled" && stream.rowCount > 0))
  ) {
    result = { kind: "stream", sql, stream, maxRows: run.maxRows };
  }
  const streaming =
    stream.phase === "connecting" || stream.phase === "streaming";
  const status: QueryServiceStatus =
    run.runErr || run.streamFailed
      ? "failed"
      : run.cancelled || stream.phase === "cancelled"
        ? "cancelled"
        : run.running || streaming || result.kind === "none"
          ? "running"
          : "completed";
  return { status, result };
}

export function wholeDocumentRunSource(draft: string): SqlRunSource | null {
  const sql = draft.trim();
  if (!sql) return null;
  const from = draft.indexOf(sql);
  return {
    sql,
    from,
    to: from + sql.length,
  };
}

export function buildSqlHelpPrompt({
  connection,
  database,
  namespace,
  sql,
  error,
}: {
  connection: ConnectionProfile;
  database: string;
  namespace: string;
  sql: string;
  error: SqlWorkbenchErrorInfo | null;
}) {
  const lines = [
    "DopeDB SQL context",
    "",
    `Connection: ${connection.name || "(unnamed)"}`,
    `Engine: ${connection.engine}`,
    `Database: ${database}`,
    `Schema: ${namespace}`,
    "",
    "SQL:",
    "```sql",
    sql.trim(),
    "```",
  ];
  if (error) {
    lines.push(
      "",
      "Error:",
      error.kind ? `Kind: ${error.kind}` : "Kind: unknown",
      `Message: ${error.message}`,
      "",
      "Raw error:",
      "```json",
      error.raw,
      "```",
    );
  }
  return lines.join("\n");
}
