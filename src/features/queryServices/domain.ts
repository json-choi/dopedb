// Defines query-service sessions and validates persisted result snapshots before recovery.

import type {
  AppErrorDetails,
  ExecOutcome,
  ScriptOutcome,
  ScriptStatement,
  ScriptStatementError,
} from "../../ipc/types";
import type { SqlStreamViewState } from "../queries/domain";

export type QueryServiceStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type QueryServiceError = AppErrorDetails & {
  sql: string;
  at: string;
};

export type QueryServiceResult =
  | { kind: "none" }
  | {
      kind: "materialized";
      sql: string;
      outcome: ExecOutcome;
      at: string;
      maxRows: number;
    }
  | {
      kind: "stream";
      sql: string;
      stream: SqlStreamViewState;
      maxRows: number;
    }
  | {
      kind: "script";
      outcome: ScriptOutcome;
      at: string;
    }
  | {
      kind: "error";
      error: QueryServiceError;
      prompt: string;
    }
  ;

export type QueryServiceSession = {
  schemaVersion: 2;
  id: string;
  documentId: string;
  connectionId: string;
  connectionName: string;
  consoleTitle: string;
  database: string;
  namespace: string;
  sql: string;
  startedAt: string;
  startedLabel: string;
  updatedAt: number;
  status: QueryServiceStatus;
  result: QueryServiceResult;
};

let sessionSequence = 0;

export function nextQueryServiceSessionId(documentId: string) {
  sessionSequence += 1;
  return `${documentId}:${Date.now()}:${sessionSequence}`;
}

export function isTerminalQueryServiceSession(
  session: QueryServiceSession,
) {
  return (
    session.status === "completed" ||
    session.status === "failed" ||
    session.status === "cancelled"
  );
}

/**
 * The snapshot saved for a terminal session. Rows a cancelled run had already
 * received stay visible for this app session only; the saved snapshot records
 * the cancellation alone, the shape every restore path accepts.
 */
export function persistableQueryServiceSession(
  session: QueryServiceSession,
): QueryServiceSession {
  return session.status === "cancelled" && session.result.kind !== "none"
    ? { ...session, result: { kind: "none" } }
    : session;
}

export function parseQueryServiceSession(value: unknown): QueryServiceSession {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2
  ) {
    throw new Error("Unsupported Services session snapshot");
  }
  const strings = [
    "id",
    "documentId",
    "connectionId",
    "connectionName",
    "consoleTitle",
    "database",
    "namespace",
    "sql",
    "startedAt",
    "startedLabel",
  ] as const;
  if (
    strings.some((key) => typeof value[key] !== "string") ||
    typeof value.updatedAt !== "number" ||
    typeof value.status !== "string" ||
    !["completed", "failed", "cancelled"].includes(value.status) ||
    !isQueryServiceResult(value.result)
  ) {
    throw new Error("Invalid Services session snapshot");
  }
  const resultKind = value.result.kind;
  const statusMatchesResult =
    (value.status === "completed" &&
      ["materialized", "stream", "script"].includes(resultKind)) ||
    (value.status === "failed" && resultKind === "error") ||
    (value.status === "cancelled" && resultKind === "none");
  if (!statusMatchesResult) {
    throw new Error("Invalid Services session terminal state");
  }
  return withTypedScriptErrors(value as QueryServiceSession);
}

function isQueryServiceResult(
  value: unknown,
): value is QueryServiceResult {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "none") return true;
  if (value.kind === "materialized") {
    return (
      typeof value.sql === "string" &&
      typeof value.at === "string" &&
      isNonNegativeNumber(value.maxRows) &&
      isExecOutcome(value.outcome)
    );
  }
  if (value.kind === "stream") {
    return (
      typeof value.sql === "string" &&
      isNonNegativeNumber(value.maxRows) &&
      isStreamViewState(value.stream)
    );
  }
  if (value.kind === "script") {
    return typeof value.at === "string" && isScriptOutcome(value.outcome);
  }
  return (
    value.kind === "error" &&
    typeof value.prompt === "string" &&
    isQueryServiceError(value.error)
  );
}

function isExecOutcome(value: unknown) {
  return (
    isRecord(value) &&
    (value.result === null || isQueryResult(value.result)) &&
    isNullableNumber(value.affected) &&
    typeof value.committed === "boolean" &&
    typeof value.manualTransaction === "boolean"
  );
}

function isScriptOutcome(value: unknown) {
  return (
    isRecord(value) &&
    Array.isArray(value.statements) &&
    value.statements.every(
      (statement) =>
        isRecord(statement) &&
        typeof statement.sql === "string" &&
        (statement.result === null || isQueryResult(statement.result)) &&
        isNullableNumber(statement.affected) &&
        isScriptStatementError(statement.error),
    ) &&
    typeof value.committed === "boolean" &&
    typeof value.allReads === "boolean" &&
    typeof value.manualTransaction === "boolean"
  );
}

function isScriptStatementError(value: unknown) {
  return (
    value === null ||
    // Snapshots saved before statement errors were typed carry plain text.
    typeof value === "string" ||
    (isRecord(value) &&
      typeof value.kind === "string" &&
      typeof value.message === "string" &&
      isNullableNumber(value.position) &&
      // Server diagnostics; snapshots saved before they existed omit them.
      (["sqlstate", "detail", "hint"] as const).every(
        (key) => value[key] === undefined || typeof value[key] === "string",
      ))
  );
}

type StoredScriptStatement = Omit<ScriptStatement, "error"> & {
  error: ScriptStatementError | string | null;
};

/** Gives a legacy plain-text statement error the typed shape with no known kind. */
function withTypedScriptErrors(session: QueryServiceSession): QueryServiceSession {
  const result = session.result;
  if (result.kind !== "script") return session;
  const stored = result.outcome.statements as StoredScriptStatement[];
  if (!stored.some((statement) => typeof statement.error === "string")) return session;
  const statements = stored.map((statement) =>
    typeof statement.error === "string"
      ? {
          ...statement,
          error: { kind: "unknown", message: statement.error, position: null },
        }
      : { ...statement, error: statement.error },
  );
  return {
    ...session,
    result: { ...result, outcome: { ...result.outcome, statements } },
  };
}

function isQueryResult(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.columns) ||
    !value.columns.every((column) => typeof column === "string") ||
    !Array.isArray(value.rows)
  ) {
    return false;
  }
  const columnCount = value.columns.length;
  if (
    !value.rows.every(
      (row) => Array.isArray(row) && row.length === columnCount,
    )
  ) {
    return false;
  }
  return (
    isNonNegativeNumber(value.rowCount) &&
    typeof value.truncated === "boolean" &&
    isNonNegativeNumber(value.durationMs)
  );
}

function isStreamViewState(value: unknown) {
  if (
    !isRecord(value) ||
    value.phase !== "complete" ||
    !Array.isArray(value.columns) ||
    !value.columns.every((column) => typeof column === "string") ||
    !isRecord(value.rowSource) ||
    (value.rowSource.operationId !== null &&
      typeof value.rowSource.operationId !== "string") ||
    (value.rowSource.capability !== null &&
      typeof value.rowSource.capability !== "string") ||
    !isNonNegativeNumber(value.rowSource.pageRows) ||
    !Array.isArray(value.rowSource.pageRanges) ||
    typeof value.rowSource.complete !== "boolean"
  ) {
    return false;
  }
  return (
    isNonNegativeNumber(value.runId) &&
    (value.operationId === null ||
      typeof value.operationId === "string") &&
    typeof value.nextSequence === "number" &&
    Number.isSafeInteger(value.nextSequence) &&
    value.nextSequence >= 0 &&
    isNonNegativeNumber(value.rowSource.rowCount) &&
    isNonNegativeNumber(value.rowCount) &&
    value.rowSource.rowCount === value.rowCount &&
    validStreamPageRanges(
      value.rowSource.pageRanges,
      value.nextSequence,
      value.rowCount,
    ) &&
    value.rowSource.pageRows === 256 &&
    value.rowSource.complete === true &&
    typeof value.rowSource.operationId === "string" &&
    typeof value.rowSource.capability === "string" &&
    /^[0-9a-f]{64}$/i.test(value.rowSource.capability) &&
    typeof value.truncated === "boolean" &&
    isNullableNumber(value.durationMs) &&
    (value.error === null || typeof value.error === "string")
  );
}

function validStreamPageRanges(
  ranges: unknown[],
  nextSequence: number,
  rowCount: number,
) {
  if (ranges.length !== nextSequence) return false;
  let expectedStart = 0;
  for (const [sequence, range] of ranges.entries()) {
    const rangeRowStart = isRecord(range) ? range.rowStart : undefined;
    const rangeRowCount = isRecord(range) ? range.rowCount : undefined;
    if (
      !isRecord(range) ||
      range.sequence !== sequence ||
      typeof rangeRowStart !== "number" ||
      typeof rangeRowCount !== "number" ||
      !Number.isSafeInteger(rangeRowStart) ||
      !Number.isSafeInteger(rangeRowCount) ||
      rangeRowStart !== expectedStart ||
      (rangeRowCount === 0 &&
        (ranges.length !== 1 || sequence !== 0 || rowCount !== 0)) ||
      rangeRowCount < 0 ||
      rangeRowCount > 256
    ) {
      return false;
    }
    expectedStart += rangeRowCount;
  }
  return expectedStart === rowCount;
}

function isQueryServiceError(value: unknown) {
  return (
    isRecord(value) &&
    (value.kind === null || typeof value.kind === "string") &&
    typeof value.message === "string" &&
    isNullableNumber(value.position) &&
    typeof value.raw === "string" &&
    typeof value.sql === "string" &&
    typeof value.at === "string" &&
    // Optional diagnostics; snapshots saved before they existed omit them.
    (["code", "sqlstate", "detail", "hint"] as const).every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    )
  );
}

function isNullableNumber(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
