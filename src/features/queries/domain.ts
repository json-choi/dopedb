// Query's public DTOs are generated from the Rust model/receipt contracts.  Keeping this
// module as the only frontend owner preserves existing imports without a hand-written mirror.
import { retainSqlStreamBatch } from "./resultPageCache";
import type { OperationState } from "../../ipc/generated/protocol-contracts";
import type { UnreadableCell } from "../../ipc/types";

export type {
  Classification,
  PreviewMode,
  PreviewReport,
  RiskLevel,
} from "../../ipc/generated/model";
export type {
  SqlInspection,
  SqlOperationProposal,
} from "./generated/contracts";

/** Trusted local payload rendered before an Agent-created SQL operation is decided. */
export type SqlApprovalReview = {
  operationId: string;
  connectionId: string;
  payloadHash: string;
  state: OperationState;
  riskLevel: "low" | "medium" | "high" | "critical";
  sql: string;
  database: string;
  namespace: string | null;
  affected: number | null;
  expiresAt: string | null;
};

// Desktop-only channel payload. Broker, CLI, and bounded Analysis Article receipts
// deliberately keep their bounded materialized contract.
export type SqlStreamBatchWire = {
  operationId: string;
  sequence: number;
  columns: string[];
  rows: unknown[][];
  /** Cells of THIS page the backend could not decode; never a value in `rows`. */
  unreadable: UnreadableCell[];
};

export type SqlStreamBatch = SqlStreamBatchWire & {
  /** One renderer-local bearer capability; never included in a row page file. */
  resultCapability: string;
};

/** Small Channel notification; row data is pulled with this exact capability. */
export type SqlStreamReady = {
  operationId: string;
  sequence: number;
  capability: string;
};

/** Capability-bound cancellation supplied only after the owning ready event. */
export type SqlStreamCancellation = {
  operationId: string;
  capability: string;
  cancel: () => Promise<void>;
};

export type SqlStreamBatchHandler = (
  batch: SqlStreamBatch,
  cancellation: SqlStreamCancellation,
) => void | Promise<void>;

/** Returned synchronously so callers can cancel before the first ready event. */
export type SqlStreamController = {
  completion: Promise<SqlStreamReceipt>;
  cancel: () => Promise<void>;
};

export type SqlStreamReceipt = {
  operationId: string;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  /** Cells across every page the backend could not decode. */
  unreadableCells: number;
  /** Present only in the isolated packaged-benchmark build. */
  benchmarkStages?: {
    operationClaimMs: number;
    poolConnectStartMs: number;
    poolConnectReadyMs: number;
    backendExecuteStartMs: number;
    firstRowMs: number | null;
    firstIpcBatchMs: number | null;
  };
};

export type ManualTransactionStatus = {
  transactionId: string;
  connectionId: string;
  database: string;
  phase: "active" | "failed";
  statementCount: number;
  startedAt: string;
  expiresAt: string;
};

export type ManualTransactionChangedEvent = {
  connectionId: string;
  status: ManualTransactionStatus | null;
};

// The SQL screen is the single writer for a desktop stream.  Keeping the reducer
// with the transport DTOs makes stale-run and sequence validation testable without
// giving a component permission to acknowledge a batch before it is accepted.
export type SqlStreamPhase =
  | "idle"
  | "connecting"
  | "streaming"
  | "complete"
  | "cancelled"
  | "error"
  | "outcome_unknown";

export type SqlStreamViewState = {
  runId: number;
  phase: SqlStreamPhase;
  operationId: string | null;
  nextSequence: number;
  columns: string[];
  rowSource: SqlStreamRowSource;
  rowCount: number;
  truncated: boolean;
  /** Cells the backend could not decode, across the whole result. */
  unreadableCells: number;
  durationMs: number | null;
  error: string | null;
};

/** Serializable handle over a Rust-owned, immutable local result artifact. */
export type SqlStreamRowSource = {
  operationId: string | null;
  capability: string | null;
  pageRows: number;
  rowCount: number;
  complete: boolean;
};

export const SQL_STREAM_MAX_ROWS_PER_BATCH = 256;

export function emptySqlStreamRows(): SqlStreamRowSource {
  return {
    operationId: null,
    capability: null,
    pageRows: SQL_STREAM_MAX_ROWS_PER_BATCH,
    rowCount: 0,
    complete: false,
  };
}

export function emptySqlStreamView(runId = 0): SqlStreamViewState {
  return {
    runId,
    phase: "idle",
    operationId: null,
    nextSequence: 0,
    columns: [],
    rowSource: emptySqlStreamRows(),
    rowCount: 0,
    truncated: false,
    unreadableCells: 0,
    durationMs: null,
    error: null,
  };
}

function sameColumns(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((column, index) => column === right[index])
  );
}

/** Accept exactly the next bounded batch; callers ACK only after this returns true. */
export function acceptSqlStreamBatch(
  state: SqlStreamViewState,
  runId: number,
  batch: SqlStreamBatch,
): SqlStreamViewState | null {
  if (
    state.runId !== runId ||
    state.phase !== "connecting" && state.phase !== "streaming"
  )
    return null;
  if (
    batch.sequence !== state.nextSequence ||
    batch.rows.length > SQL_STREAM_MAX_ROWS_PER_BATCH
  )
    return null;
  if (state.operationId && state.operationId !== batch.operationId) return null;
  if (batch.rows.some((row) => row.length !== batch.columns.length))
    return null;
  // A read failure is addressed, never valued: a page naming a cell outside its
  // own rows/columns cannot be projected onto this result.
  if (
    batch.unreadable.some(
      (cell) =>
        cell.row >= batch.rows.length || cell.column >= batch.columns.length,
    )
  )
    return null;
  if (state.columns.length && !sameColumns(state.columns, batch.columns))
    return null;
  const sourceOperationId = state.rowSource.operationId ?? batch.operationId;
  const sourceCapability =
    state.rowSource.capability ?? batch.resultCapability;
  if (
    sourceOperationId !== batch.operationId ||
    sourceCapability !== batch.resultCapability ||
    batch.resultCapability.length !== 64 ||
    !/^[0-9a-f]+$/i.test(batch.resultCapability)
  )
    return null;
  const rowSource = {
    operationId: sourceOperationId,
    capability: sourceCapability,
    pageRows: SQL_STREAM_MAX_ROWS_PER_BATCH,
    rowCount: state.rowCount + batch.rows.length,
    complete: false,
  } satisfies SqlStreamRowSource;
  retainSqlStreamBatch(rowSource, batch);
  return {
    ...state,
    phase: "streaming",
    operationId: batch.operationId,
    nextSequence: state.nextSequence + 1,
    columns: state.columns.length ? state.columns : [...batch.columns],
    rowSource,
    rowCount: state.rowCount + batch.rows.length,
    unreadableCells: state.unreadableCells + batch.unreadable.length,
  };
}

export function finishSqlStream(
  state: SqlStreamViewState,
  runId: number,
  receipt: SqlStreamReceipt,
): SqlStreamViewState {
  if (
    state.runId !== runId ||
    (state.phase !== "connecting" && state.phase !== "streaming")
  )
    return state;
  if (
    (state.operationId !== null && state.operationId !== receipt.operationId) ||
    state.rowCount !== receipt.rowCount
  ) {
    return {
      ...state,
      phase: "outcome_unknown",
      error: "stream completion receipt did not match accepted batches",
    };
  }
  return {
    ...state,
    phase: "complete",
    operationId: receipt.operationId,
    rowCount: receipt.rowCount,
    truncated: receipt.truncated,
    // Never under-report: pages already seen are evidence the receipt cannot undo.
    unreadableCells: Math.max(state.unreadableCells, receipt.unreadableCells),
    durationMs: receipt.durationMs,
    rowSource: {
      ...state.rowSource,
      rowCount: receipt.rowCount,
      complete: true,
    },
  };
}
