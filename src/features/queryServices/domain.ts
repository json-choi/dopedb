import type {
  AppErrorDetails,
  ExecOutcome,
  ScriptOutcome,
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
  return value as QueryServiceSession;
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
        (statement.error === null || typeof statement.error === "string"),
    ) &&
    typeof value.committed === "boolean" &&
    typeof value.allReads === "boolean" &&
    typeof value.manualTransaction === "boolean"
  );
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
    typeof value.rowSource.complete !== "boolean"
  ) {
    return false;
  }
  return (
    isNonNegativeNumber(value.runId) &&
    (value.operationId === null ||
      typeof value.operationId === "string") &&
    isNonNegativeNumber(value.nextSequence) &&
    isNonNegativeNumber(value.rowSource.rowCount) &&
    isNonNegativeNumber(value.rowCount) &&
    value.rowSource.rowCount === value.rowCount &&
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

function isQueryServiceError(value: unknown) {
  return (
    isRecord(value) &&
    (value.kind === null || typeof value.kind === "string") &&
    typeof value.message === "string" &&
    isNullableNumber(value.position) &&
    typeof value.raw === "string" &&
    typeof value.sql === "string" &&
    typeof value.at === "string"
  );
}

function isNullableNumber(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
