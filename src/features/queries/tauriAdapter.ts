// The only frontend module that owns SQL query command literals and their camelCase wire shape.
// Mutating execution stays behind the explicit proposal/approval/run flow.

import { Channel, invoke } from "../../ipc/core";

import type {
  ExecOutcome,
  QueryResult,
  ScriptOperationProposal,
  ScriptOutcome,
} from "../../ipc/types";
import type {
  SqlInspection,
  SqlApprovalReview,
  ManualTransactionStatus,
  SqlOperationProposal,
  SqlStreamBatchWire,
  SqlStreamBatchHandler,
  SqlStreamController,
  SqlStreamReady,
  SqlStreamReceipt,
} from "./domain";

export type SqlResultExportFormat = "csv" | "json";

export type SqlResultExportProgress = {
  exportId: string;
  operationId: string;
  rowsWritten: number;
  totalRows: number;
};

export type SqlResultExportReceipt = {
  exportId: string;
  operationId: string;
  rowsWritten: number;
};

export type SqlResultExportController = {
  exportId: string;
  completion: Promise<SqlResultExportReceipt | null>;
  cancel: () => Promise<void>;
};

export type SqlReadPageObserver = {
  onFirstBatchAccepted?: (acceptedAtMs: number) => void;
  onComplete?: (receipt: SqlStreamReceipt) => void;
};

export function formatSqlFragment(
  sql: string,
  language: "sqlite" | "mysql" | "postgresql" | "bigquery",
): Promise<string> {
  return invoke("format_sql_fragment", { sql, language });
}

export function getManualTransaction(
  id: string,
): Promise<ManualTransactionStatus | null> {
  return invoke("get_manual_transaction", { id });
}

export function listManualTransactions(): Promise<ManualTransactionStatus[]> {
  return invoke("list_manual_transactions");
}

export function beginManualTransaction(
  id: string,
  database?: string,
): Promise<ManualTransactionStatus> {
  return invoke("begin_manual_transaction", {
    id,
    database: database ?? null,
  });
}

export function commitManualTransaction(
  id: string,
  transactionId: string,
): Promise<ManualTransactionStatus> {
  return invoke("commit_manual_transaction", { id, transactionId });
}

export function rollbackManualTransaction(
  id: string,
  transactionId: string,
): Promise<ManualTransactionStatus> {
  return invoke("rollback_manual_transaction", { id, transactionId });
}

export function inspectSql(
  id: string,
  sql: string,
  namespace?: string,
  database?: string,
): Promise<SqlInspection> {
  return invoke("inspect_sql", {
    id,
    sql,
    database: database ?? null,
    namespace: namespace ?? null,
  });
}

export function proposeSql(
  id: string,
  sql: string,
  origin?: string,
  namespace?: string,
  database?: string,
): Promise<SqlOperationProposal> {
  return invoke("propose_sql", {
    id,
    sql,
    database: database ?? null,
    namespace: namespace ?? null,
    origin: origin ?? null,
  });
}

export function reviewAgentSqlProposal(
  operationId: string,
  connectionId: string,
  payloadHash: string,
): Promise<SqlApprovalReview> {
  return invoke("review_agent_sql_proposal", {
    operationId,
    connectionId,
    payloadHash,
  });
}

export function runSql(operationId: string): Promise<ExecOutcome> {
  return invoke("run_sql", { operationId });
}

export function cancelQuery(queryId: string): Promise<boolean> {
  return invoke("cancel_query", { queryId });
}

export function runScript(operationId: string): Promise<ScriptOutcome> {
  return invoke("run_script", { operationId });
}

export function proposeScript(
  id: string,
  sql: string,
  origin?: string,
  namespace?: string,
  database?: string,
): Promise<ScriptOperationProposal> {
  return invoke("propose_script", {
    id,
    sql,
    database: database ?? null,
    namespace: namespace ?? null,
    origin: origin ?? null,
  });
}

/** Stream an already-planned desktop read in bounded channel batches. */
export function runSqlStream(
  operationId: string,
  onBatch: SqlStreamBatchHandler,
): SqlStreamController {
  return startSqlStream(operationId, onBatch, (capability, onRows) =>
    invoke<SqlStreamReceipt>("run_sql_stream", {
      operationId,
      capability,
      onRows,
    }),
  );
}

function newStreamCapability(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function startSqlStream(
  operationId: string,
  onBatch: SqlStreamBatchHandler,
  start: (
    capability: string,
    onRows: Channel<SqlStreamReady>,
  ) => Promise<SqlStreamReceipt>,
): SqlStreamController {
  const capability = newStreamCapability();
  let activeOperationId = operationId;
  let terminal: "open" | "cancelled" | "completed" | "error" = "open";
  let terminalError: Error | null = null;
  let firstBatchReceived = false;
  let readyQueue = Promise.resolve();
  const onRows = new Channel<SqlStreamReady>();
  const sendCancellation = (knownOperationId = activeOperationId) =>
    invoke("cancel_sql_stream", {
      operationId: knownOperationId || null,
      capability,
    });
  const bestEffortCancel = async (knownOperationId = activeOperationId) => {
    await Promise.resolve(sendCancellation(knownOperationId)).catch(
      () => undefined,
    );
  };
  const cancel = async () => {
    if (terminal !== "open") return;
    terminal = "cancelled";
    await bestEffortCancel();
  };
  const fail = async (error: unknown) => {
    if (terminal !== "open") return;
    terminal = "error";
    terminalError =
      error instanceof Error ? error : new Error("SQL stream transport failed");
    await bestEffortCancel();
  };
  onRows.onmessage = (ready) => {
    // A late ready never becomes a late pull/ACK. When auto-read cancellation
    // learned its operation only after planning, send the exact cancellation.
    if (terminal !== "open") {
      void bestEffortCancel(ready.operationId);
      return;
    }
    if (
      ready.capability !== capability ||
      (activeOperationId !== "" && ready.operationId !== activeOperationId)
    ) {
      void fail(new Error("stream ready notification did not match its owner"));
      return;
    }
    activeOperationId = ready.operationId;
    // Keep the serialized queue usable after failures; a cancellation transport
    // rejection must not poison later cleanup or make completion hang.
    readyQueue = readyQueue
      .then(() =>
        pullAcceptAndAcknowledgeStreamBatch(
          ready,
          onBatch,
          () => terminal === "open",
          cancel,
          fail,
          bestEffortCancel,
          () => {
            if (firstBatchReceived) return;
            firstBatchReceived = true;
            globalThis.performance?.mark?.(
              "desktop_query_stream_first_batch_received",
            );
          },
        ),
      )
      .catch(() => undefined);
  };
  let startPromise: Promise<SqlStreamReceipt>;
  try {
    startPromise = start(capability, onRows);
  } catch (error) {
    startPromise = Promise.reject(error);
  }
  return {
    completion: startPromise
      .then(async (receipt) => {
        // The backend only completes after its last credit, but awaiting this
        // exact queue makes the frontend contract explicit and testable.
        await readyQueue;
        if (terminal === "error") throw terminalError;
        if (
          activeOperationId !== "" &&
          receipt.operationId !== activeOperationId
        ) {
          terminal = "error";
          terminalError = new Error(
            "stream completion did not match the owning operation",
          );
          await bestEffortCancel();
          throw new Error(
            "stream completion did not match the owning operation",
          );
        }
        if (terminal === "open") terminal = "completed";
        return receipt;
      })
      .catch(async (error) => {
        if (terminal === "open") await fail(error);
        throw error;
      })
      .finally(() => {
        // Keep the handler alive while the start command is pending: a
        // cancellation may learn its exact operation only from a late ready.
        onRows.onmessage = () => undefined;
      }),
    cancel,
  };
}

/** Plan and consume an auto-run read without a proposal/run IPC race. */
export function runSqlReadStream(
  id: string,
  sql: string,
  onBatch: SqlStreamBatchHandler,
  origin?: string,
  namespace?: string,
  database?: string,
): SqlStreamController {
  return startSqlStream("", onBatch, (capability, onRows) =>
    invoke<SqlStreamReceipt>("run_sql_read_stream", {
      id,
      sql,
      database: database ?? null,
      namespace: namespace ?? null,
      origin: origin ?? null,
      capability,
      onRows,
    }),
  );
}

async function pullAcceptAndAcknowledgeStreamBatch(
  ready: SqlStreamReady,
  onBatch: SqlStreamBatchHandler,
  isOpen: () => boolean,
  cancel: () => Promise<void>,
  fail: (error: unknown) => Promise<void>,
  bestEffortCancel: () => Promise<void>,
  markFirstBatchReceived: () => void,
): Promise<void> {
  try {
    if (!isOpen()) {
      await bestEffortCancel();
      return;
    }
    const batch = await invoke<SqlStreamBatchWire | null>("pull_sql_stream_batch", {
      operationId: ready.operationId,
      sequence: ready.sequence,
      capability: ready.capability,
    });
    if (!batch) throw new Error("stream batch is no longer available");
    if (
      batch.operationId !== ready.operationId ||
      batch.sequence !== ready.sequence
    ) {
      throw new Error("stream batch did not match its ready notification");
    }
    // The read-failure list is the only way to tell an unreadable cell from a
    // SQL NULL, so a page that omits it is rejected rather than read as all-NULL.
    if (!Array.isArray(batch.unreadable)) {
      throw new Error("stream batch did not carry its cell read state");
    }
    if (!isOpen()) return;
    markFirstBatchReceived();
    await onBatch({ ...batch, resultCapability: ready.capability }, {
      operationId: ready.operationId,
      capability: ready.capability,
      cancel: async () => {
        await cancel();
      },
    });
    if (!isOpen()) return;
  } catch (error) {
    await fail(error);
    return;
  }
  if (!isOpen()) return;
  try {
    const accepted = await invoke<boolean>("ack_sql_stream", {
      operationId: ready.operationId,
      sequence: ready.sequence,
      capability: ready.capability,
    });
    if (!accepted) throw new Error("stream batch acknowledgement was rejected");
  } catch (error) {
    await fail(error);
  }
}

export function readSqlResultPage(
  source: { operationId: string | null; capability: string | null },
  sequence: number,
): Promise<SqlStreamBatchWire> {
  if (!source.operationId || !source.capability) {
    return Promise.reject(new Error("SQL result handle is incomplete"));
  }
  return invoke("read_sql_result_page", {
    operationId: source.operationId,
    sequence,
    capability: source.capability,
  });
}

export function exportSqlResult(
  source: { operationId: string | null; capability: string | null },
  format: SqlResultExportFormat,
  suggestedName: string,
  onProgress: (progress: SqlResultExportProgress) => void,
): SqlResultExportController {
  if (!source.operationId || !source.capability) {
    return {
      exportId: "",
      completion: Promise.reject(new Error("SQL result handle is incomplete")),
      cancel: async () => undefined,
    };
  }
  const exportId = globalThis.crypto.randomUUID();
  const operationId = source.operationId;
  const capability = source.capability;
  const channel = new Channel<SqlResultExportProgress>();
  channel.onmessage = onProgress;
  const completion = invoke<SqlResultExportReceipt | null>(
    "export_sql_result",
    {
      exportId,
      operationId,
      capability,
      format,
      suggestedName,
      onProgress: channel,
    },
  )
    .then((receipt) => {
      if (
        receipt &&
        (receipt.exportId !== exportId || receipt.operationId !== operationId)
      ) {
        throw new Error("SQL result export receipt did not match its owner");
      }
      return receipt;
    })
    .finally(() => {
      channel.onmessage = () => undefined;
    });
  return {
    exportId,
    completion,
    cancel: async () => {
      await invoke("cancel_sql_result_export", {
        exportId,
        operationId,
        capability,
      });
    },
  };
}

/** Collect one bounded auto-run read through the same atomic stream used by the SQL console. */
export async function runSqlReadPage(
  id: string,
  sql: string,
  origin?: string,
  database?: string,
  observer?: SqlReadPageObserver,
): Promise<QueryResult> {
  let columns: string[] | null = null;
  const rows: unknown[][] = [];
  const unreadableCells: QueryResult["unreadableCells"] = [];
  let firstBatchAccepted = false;
  const controller = startSqlStream("", (batch) => {
    if (
      columns
      && (columns.length !== batch.columns.length
        || columns.some((column, index) => column !== batch.columns[index]))
    ) {
      throw new Error("SQL page stream changed columns between batches");
    }
    if (batch.rows.some((row) => row.length !== batch.columns.length)) {
      throw new Error("SQL page stream returned a row with the wrong width");
    }
    if (!firstBatchAccepted) {
      firstBatchAccepted = true;
      observer?.onFirstBatchAccepted?.(performance.now());
    }
    columns ??= [...batch.columns];
    // Page coordinates become result coordinates: the caller receives one
    // materialized result and must still be able to address every unread cell.
    for (const cell of batch.unreadable) {
      unreadableCells.push({ ...cell, row: rows.length + cell.row });
    }
    rows.push(...batch.rows);
  }, (capability, onRows) =>
    invoke<SqlStreamReceipt>("run_sql_read_page_stream", {
      id,
      sql,
      database: database ?? null,
      namespace: null,
      origin: origin ?? null,
      capability,
      onRows,
    }),
  );
  const receipt = await controller.completion;
  observer?.onComplete?.(receipt);
  if (receipt.rowCount !== rows.length) {
    throw new Error("SQL page stream receipt did not match accepted rows");
  }
  if (receipt.unreadableCells !== unreadableCells.length) {
    throw new Error("SQL page stream receipt did not match accepted read failures");
  }
  return {
    columns: columns ?? [],
    rows: rows as QueryResult["rows"],
    rowCount: rows.length,
    truncated: receipt.truncated,
    durationMs: receipt.durationMs,
    unreadableCells,
  };
}
