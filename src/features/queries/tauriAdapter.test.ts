import { beforeEach, describe, expect, it, vi } from "vitest";

const channels: Array<{ onmessage: ((value: unknown) => void) | null }> = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;

    constructor() {
      channels.push(this);
    }
  },
}));

import { invoke } from "@tauri-apps/api/core";

import type { QueryServiceSession } from "../queryServices/domain";
import { RunningQueryUpdateScheduler } from "../queryServices/runningUpdateScheduler";
import { QueryServiceStore } from "../queryServices/store";
import {
  listQueryServiceSessions,
  saveQueryServiceSession,
} from "../queryServices/tauriAdapter";
import type { SqlOperationProposal } from "./domain";
import {
  exportSqlResult,
  inspectSql,
  listManualTransactions,
  proposeSql,
  readSqlResultPage,
  runSqlReadPage,
  runSqlReadStream,
  runSqlStream,
} from "./tauriAdapter";

const invokeMock = vi.mocked(invoke);

const readProposal: SqlOperationProposal = {
  operationId: "operation-1",
  payloadHash: "payload-hash",
  state: "ready",
  approvalRequired: false,
  autoRun: true,
  confirmationPhrase: null,
  expiresAt: "2026-01-01T00:00:00Z",
  classification: {
    kind: "read",
    risk: "low",
    statementCount: 1,
    noWhere: false,
    tables: [],
    notes: [],
    directDml: false,
  },
  preview: {
    mode: "explain",
    estimatedRows: null,
    plan: null,
    note: null,
  },
};

describe("query Tauri adapter", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    channels.length = 0;
  });

  it("uses backend-owned inspection and one consolidated transaction snapshot", async () => {
    invokeMock.mockResolvedValueOnce({
      classification: readProposal.classification,
      report: readProposal.preview,
    });

    await expect(
      inspectSql("connection-1", "SELECT 1", "billing", "analytics"),
    ).resolves.toEqual({
      classification: readProposal.classification,
      report: readProposal.preview,
    });
    expect(invokeMock).toHaveBeenCalledWith("inspect_sql", {
      id: "connection-1",
      sql: "SELECT 1",
      database: "analytics",
      namespace: "billing",
    });

    invokeMock.mockResolvedValueOnce([]);
    await expect(listManualTransactions()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenLastCalledWith("list_manual_transactions");
  });

  it("preserves the propose SQL command and camelCase wire shape", async () => {
    invokeMock.mockResolvedValueOnce(readProposal);

    await proposeSql(
      "connection-1",
      "SELECT 1",
      undefined,
      "billing",
      "analytics",
    );

    expect(invokeMock).toHaveBeenCalledWith("propose_sql", {
      id: "connection-1",
      sql: "SELECT 1",
      database: "analytics",
      namespace: "billing",
      origin: null,
    });

    const serviceSession: QueryServiceSession = {
      schemaVersion: 2,
      id: "document-1:1",
      documentId: "document-1",
      connectionId: "00000000-0000-0000-0000-000000000001",
      connectionName: "Fixture",
      consoleTitle: "Query",
      database: "analytics",
      namespace: "billing",
      sql: "SELECT 1",
      startedAt: "2026-01-01T00:00:00Z",
      startedLabel: "00:00:00",
      updatedAt: 1,
      status: "completed",
      result: {
        kind: "materialized",
        sql: "SELECT 1",
        outcome: {
          result: null,
          affected: null,
          committed: false,
          manualTransaction: false,
        },
        at: "00:00:00",
        maxRows: 1000,
      },
    };
    invokeMock.mockResolvedValueOnce([serviceSession]);
    const serviceScope = {
      workspaceId: "00000000-0000-0000-0000-000000000010",
      accountScope: "account-1",
    };
    await expect(listQueryServiceSessions(serviceScope)).resolves.toEqual([
      serviceSession,
    ]);
    await saveQueryServiceSession(serviceScope, serviceSession);
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "list_query_service_sessions",
      {
        expectedWorkspaceId: serviceScope.workspaceId,
        expectedAccountScope: serviceScope.accountScope,
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "save_query_service_session",
      {
        expectedWorkspaceId: serviceScope.workspaceId,
        expectedAccountScope: serviceScope.accountScope,
        session: serviceSession,
      },
    );
    invokeMock.mockResolvedValueOnce([
      { ...serviceSession, result: { kind: "none" } },
    ]);
    await expect(listQueryServiceSessions(serviceScope)).rejects.toThrow(
      "Invalid Services session terminal state",
    );
    invokeMock.mockResolvedValueOnce([
      {
        ...serviceSession,
        schemaVersion: 1,
        status: "cancelled",
        result: {
          kind: "stream",
          sql: "SELECT retired_rows",
          stream: { rowSource: { chunkIndex: { chunks: [[["secret"]]] } } },
          maxRows: 1000,
        },
      },
    ]);
    await expect(listQueryServiceSessions(serviceScope)).rejects.toThrow(
      "Unsupported Services session snapshot",
    );

    const serviceStore = new QueryServiceStore("workspace:account-1");
    let fullNotifications = 0;
    let activityNotifications = 0;
    serviceStore.subscribe(() => {
      fullNotifications += 1;
    });
    serviceStore.subscribeActivity(() => {
      activityNotifications += 1;
    });
    const runningSession: QueryServiceSession = {
      ...serviceSession,
      updatedAt: 2,
      status: "running",
      result: { kind: "none" },
    };
    serviceStore.merge([runningSession]);
    serviceStore.merge([{ ...runningSession, updatedAt: 3 }]);
    expect(fullNotifications).toBe(2);
    expect(activityNotifications).toBe(1);
    serviceStore.merge([{ ...serviceSession, updatedAt: 4 }]);
    expect(activityNotifications).toBe(2);
    expect(serviceStore.getActivitySnapshot()).toEqual([]);

    let clock = 0;
    let nextTimer = 0;
    const timers = new Map<
      number,
      { at: number; callback: () => void }
    >();
    const published: QueryServiceSession[] = [];
    const runningUpdates = new RunningQueryUpdateScheduler(
      250,
      (session: QueryServiceSession) => published.push(session),
      (scopeKey) => scopeKey === "workspace:account-1",
      () => clock,
      (callback, delay) => {
        nextTimer += 1;
        timers.set(nextTimer, { at: clock + delay, callback });
        return nextTimer;
      },
      (handle) => timers.delete(handle as number),
    );
    runningUpdates.publishNow("workspace:account-1", runningSession);
    for (let updatedAt = 3; updatedAt <= 100; updatedAt += 1) {
      clock += 1;
      runningUpdates.push("workspace:account-1", {
        ...runningSession,
        updatedAt,
      });
    }
    expect(published.map((session) => session.updatedAt)).toEqual([2]);
    clock = 250;
    for (const [id, timer] of [...timers]) {
      if (timer.at > clock) continue;
      timers.delete(id);
      timer.callback();
    }
    expect(published.map((session) => session.updatedAt)).toEqual([2, 100]);
    runningUpdates.push("workspace:account-1", {
      ...runningSession,
      updatedAt: 101,
    });
    runningUpdates.cancel(runningSession.id);
    clock = 1_000;
    for (const timer of timers.values()) timer.callback();
    expect(published.map((session) => session.updatedAt)).toEqual([2, 100]);
  });

  it("collects a bounded table page through one atomic read stream", async () => {
    const firstBatchAccepted = vi.fn();
    const completed = vi.fn();
    let resolveReceipt:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
          benchmarkStages?: {
            operationClaimMs: number;
            poolConnectStartMs: number;
            poolConnectReadyMs: number;
            backendExecuteStartMs: number;
            firstRowMs: number | null;
            firstIpcBatchMs: number | null;
          };
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_read_page_stream") {
        return new Promise((resolve) => {
          resolveReceipt = resolve;
        });
      }
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1]],
        });
      }
      return Promise.resolve(true);
    });

    const resultPromise = runSqlReadPage(
      "connection-1",
      "SELECT 1",
      "data-view",
      "analytics",
      {
        onFirstBatchAccepted: firstBatchAccepted,
        onComplete: completed,
      },
    );
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveReceipt?.({
      operationId: "operation-1",
      rowCount: 1,
      truncated: false,
      durationMs: 4,
      benchmarkStages: {
        operationClaimMs: 1,
        poolConnectStartMs: 2,
        poolConnectReadyMs: 3,
        backendExecuteStartMs: 3,
        firstRowMs: 4,
        firstIpcBatchMs: 5,
      },
    });

    await expect(resultPromise).resolves.toEqual({
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
      durationMs: 4,
    });
    expect(invokeMock.mock.calls.map(([command]) => command)).not.toContain(
      "propose_sql",
    );
    expect(invokeMock.mock.calls.map(([command]) => command)).not.toContain(
      "run_sql",
    );
    expect(firstBatchAccepted).toHaveBeenCalledTimes(1);
    expect(firstBatchAccepted).toHaveBeenCalledWith(expect.any(Number));
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({
      benchmarkStages: expect.objectContaining({ firstRowMs: 4 }),
    }));
  });

  it("rejects and cancels a table page batch with the wrong row width", async () => {
    let resolveReceipt:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_read_page_stream") {
        return new Promise((resolve) => {
          resolveReceipt = resolve;
        });
      }
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1, 2]],
        });
      }
      return Promise.resolve(true);
    });

    const resultPromise = runSqlReadPage("connection-1", "SELECT 1");
    const rejection = expect(resultPromise).rejects.toThrow("wrong width");
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveReceipt?.({
      operationId: "operation-1",
      rowCount: 1,
      truncated: false,
      durationMs: 4,
    });

    await rejection;
    expect(invokeMock).toHaveBeenCalledWith("cancel_sql_stream", {
      operationId: "operation-1",
      capability,
    });
    expect(invokeMock.mock.calls.map(([command]) => command)).not.toContain(
      "ack_sql_stream",
    );
  });

  it("streams an existing read proposal through one bounded-channel command", async () => {
    let resolveReceipt:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command, payload) => {
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1]],
        });
      }
      if (command === "run_sql_stream") {
        return new Promise((resolve) => {
          resolveReceipt = resolve;
        });
      }
      if (command === "read_sql_result_page") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1]],
        });
      }
      if (command === "export_sql_result") {
        const exportId = (payload as { exportId: string }).exportId;
        return Promise.resolve({
          exportId,
          operationId: "operation-1",
          rowsWritten: 3,
        });
      }
      return Promise.resolve(true);
    });
    const batches: unknown[] = [];

    const controller = runSqlStream("operation-1", (batch) => {
      batches.push(batch);
    });
    expect(invokeMock).toHaveBeenCalledWith("run_sql_stream", {
      operationId: "operation-1",
      capability: expect.stringMatching(/^[0-9a-f]{64}$/),
      onRows: channels[0],
    });
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(batches).toEqual([
      {
        operationId: "operation-1",
        sequence: 0,
        columns: ["id"],
        rows: [[1]],
        resultCapability: capability,
      },
    ]);
    expect(invokeMock).toHaveBeenLastCalledWith("ack_sql_stream", {
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    resolveReceipt?.({
      operationId: "operation-1",
      rowCount: 3,
      truncated: false,
      durationMs: 7,
    });
    await expect(controller.completion).resolves.toMatchObject({ rowCount: 3 });

    await expect(
      readSqlResultPage(
        { operationId: "operation-1", capability },
        0,
      ),
    ).resolves.toMatchObject({ sequence: 0, rows: [[1]] });
    expect(invokeMock).toHaveBeenLastCalledWith("read_sql_result_page", {
      operationId: "operation-1",
      sequence: 0,
      capability,
    });

    const progress = vi.fn();
    const exportController = exportSqlResult(
      { operationId: "operation-1", capability },
      "csv",
      "query.csv",
      progress,
    );
    channels[channels.length - 1]?.onmessage?.({
      exportId: exportController.exportId,
      operationId: "operation-1",
      rowsWritten: 1,
      totalRows: 3,
    });
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ rowsWritten: 1, totalRows: 3 }),
    );
    await expect(exportController.completion).resolves.toMatchObject({
      operationId: "operation-1",
      rowsWritten: 3,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      "export_sql_result",
      expect.objectContaining({
        operationId: "operation-1",
        capability,
        format: "csv",
        suggestedName: "query.csv",
      }),
    );
  });

  it("atomically plans and streams an auto-run read in one IPC request", async () => {
    invokeMock.mockResolvedValueOnce({
      operationId: "operation-1",
      rowCount: 1,
      truncated: false,
      durationMs: 4,
    });
    const onBatch = vi.fn();

    const controller = runSqlReadStream(
      "connection-1",
      "SELECT 1",
      onBatch,
      "data-view",
      "billing",
      "analytics",
    );
    await controller.completion;

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("run_sql_read_stream", {
      id: "connection-1",
      sql: "SELECT 1",
      database: "analytics",
      namespace: "billing",
      origin: "data-view",
      capability: expect.stringMatching(/^[0-9a-f]{64}$/),
      onRows: channels[0],
    });
    await controller.cancel();
    expect(invokeMock).toHaveBeenCalledOnce();
  });

  it("cancels the exact stream instead of ACKing when the consumer rejects a batch", async () => {
    let resolveReceipt:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1]],
        });
      }
      if (command === "run_sql_stream") {
        return new Promise((resolve) => {
          resolveReceipt = resolve;
        });
      }
      return Promise.resolve(true);
    });
    const controller = runSqlStream("operation-1", () => {
      throw new Error("grid reducer rejected batch");
    });
    const completion = controller.completion.catch(() => undefined);

    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invokeMock).toHaveBeenLastCalledWith("cancel_sql_stream", {
      operationId: "operation-1",
      capability,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "ack_sql_stream",
      expect.anything(),
    );
    resolveReceipt?.({
      operationId: "operation-1",
      rowCount: 1,
      truncated: false,
      durationMs: 4,
    });
    await completion;
  });

  it("cancels without ACK when ready capability or pulled identity differs", async () => {
    let resolveReceipt:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command, args) => {
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "other-operation",
          sequence: 1,
          columns: ["id"],
          rows: [[1]],
        });
      }
      if (command === "run_sql_stream")
        return new Promise((resolve) => {
          if ((args as { operationId: string }).operationId === "operation-1")
            resolveReceipt = resolve;
          else
            resolve({
              operationId: "operation-2",
              rowCount: 0,
              truncated: false,
              durationMs: 1,
            });
        });
      return Promise.resolve(true);
    });
    const first = runSqlStream("operation-1", () => {});
    const firstCompletion = first.completion.catch(() => undefined);
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invokeMock).toHaveBeenLastCalledWith("cancel_sql_stream", {
      operationId: "operation-1",
      capability,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "ack_sql_stream",
      expect.anything(),
    );
    resolveReceipt?.({
      operationId: "operation-1",
      rowCount: 0,
      truncated: false,
      durationMs: 1,
    });
    await firstCompletion;

  });

  it("rejects and cancels a completion receipt for another operation", async () => {
    let resolveReceipt:
      | ((value: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_stream")
        return new Promise((resolve) => {
          resolveReceipt = resolve;
        });
      return Promise.resolve(true);
    });
    const controller = runSqlStream("operation-1", () => {});
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    resolveReceipt?.({
      operationId: "operation-2",
      rowCount: 0,
      truncated: false,
      durationMs: 1,
    });
    await expect(controller.completion).rejects.toThrow(
      "completion did not match",
    );
    expect(invokeMock).toHaveBeenCalledWith("cancel_sql_stream", {
      operationId: "operation-1",
      capability,
    });
  });

  it("returns a pre-ready controller and never ACKs an async consumer after cancellation", async () => {
    let resolveBatch: (() => void) | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "pull_sql_stream_batch") {
        return Promise.resolve({
          operationId: "operation-1",
          sequence: 0,
          columns: ["id"],
          rows: [[1]],
        });
      }
      if (command === "run_sql_stream")
        return Promise.resolve({
          operationId: "operation-1",
          rowCount: 1,
          truncated: false,
          durationMs: 1,
        });
      return Promise.resolve(true);
    });
    const controller = runSqlStream("operation-1", async () => {
      await new Promise<void>((resolve) => {
        resolveBatch = resolve;
      });
    });
    await controller.cancel();
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability: "c".repeat(64),
    });
    resolveBatch?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "ack_sql_stream",
      expect.anything(),
    );
  });

  it("cancels a late exact auto-read operation while start is pending, then detaches", async () => {
    let resolveStart:
      | ((receipt: {
          operationId: string;
          rowCount: number;
          truncated: boolean;
          durationMs: number;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_read_stream")
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      return Promise.resolve(true);
    });
    const onBatch = vi.fn();
    const controller = runSqlReadStream(
      "connection-1",
      "SELECT 1",
      onBatch,
    );
    await controller.cancel();
    const capability = (invokeMock.mock.calls[0]?.[1] as { capability: string })
      .capability;
    const attachedHandler = channels[0]?.onmessage;
    channels[0]?.onmessage?.({
      operationId: "operation-1",
      sequence: 0,
      capability,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invokeMock).toHaveBeenCalledWith("cancel_sql_stream", {
      operationId: null,
      capability,
    });
    expect(invokeMock).toHaveBeenCalledWith("cancel_sql_stream", {
      operationId: "operation-1",
      capability,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "pull_sql_stream_batch",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "ack_sql_stream",
      expect.anything(),
    );
    expect(onBatch).not.toHaveBeenCalled();

    resolveStart?.({
      operationId: "operation-1",
      rowCount: 0,
      truncated: false,
      durationMs: 1,
    });
    await controller.completion;
    expect(channels[0]?.onmessage).not.toBe(attachedHandler);
  });

  it("bounds cleanup when cancellation and start both reject", async () => {
    let rejectStart: ((error: Error) => void) | undefined;
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_read_stream")
        return new Promise((_, reject) => {
          rejectStart = reject;
        });
      if (command === "cancel_sql_stream")
        return Promise.reject(new Error("cancel transport unavailable"));
      return Promise.resolve(true);
    });
    const controller = runSqlReadStream("connection-1", "SELECT 1", () => {});
    await expect(controller.cancel()).resolves.toBeUndefined();
    rejectStart?.(new Error("start failed"));
    await expect(controller.completion).rejects.toThrow("start failed");
    const cancellationCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "cancel_sql_stream",
    );
    expect(cancellationCalls).toHaveLength(1);
  });

  it("returns a controller whose completion contains a synchronous start error", async () => {
    invokeMock.mockImplementation((command) => {
      if (command === "run_sql_read_stream")
        throw new Error("synchronous invoke failure");
      return Promise.resolve(true);
    });
    const controller = runSqlReadStream("connection-1", "SELECT 1", () => {});
    await expect(controller.completion).rejects.toThrow(
      "synchronous invoke failure",
    );
    expect(invokeMock).toHaveBeenCalledWith("cancel_sql_stream", {
      operationId: null,
      capability: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });
});
