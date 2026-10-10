// Query feature application state. A run owns its controller and every pending
// React commit acknowledgement, so replacement and lifecycle cleanup cannot
// resolve a callback from another run. A user cancel keeps the rows already
// received as a partial result marked cancelled; a replacement discards them.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type {
  SqlStreamBatch,
  SqlStreamController,
  SqlStreamReceipt,
  SqlStreamViewState,
} from "./domain";
import {
  acceptSqlStreamBatch,
  emptySqlStreamView,
  finishSqlStream,
} from "./domain";
import { clearSqlResultPageCache } from "./resultPageCache";

type ControllerFactory = (
  onBatch: (batch: SqlStreamBatch) => Promise<void>,
) => SqlStreamController;

type PendingCommit = {
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
};

type StreamRun = {
  id: number;
  active: boolean;
  controller: SqlStreamController | null;
  pendingCommits: Set<PendingCommit>;
  invalidated: Promise<void>;
  resolveInvalidated: () => void;
};

const staleRun = () => new Error("SQL stream run is no longer active");
const RUN_INVALIDATED = Symbol("RUN_INVALIDATED");

function newRun(id: number): StreamRun {
  let resolveInvalidated: () => void = () => undefined;
  const invalidated = new Promise<void>((resolve) => {
    resolveInvalidated = resolve;
  });
  return {
    id,
    active: true,
    controller: null,
    pendingCommits: new Set(),
    invalidated,
    resolveInvalidated,
  };
}

export function useSqlResultStream(scopeKey: string) {
  const [stream, setStream] = useState<SqlStreamViewState>(() =>
    emptySqlStreamView(),
  );
  const stateRef = useRef(stream);
  const activeRunRef = useRef<StreamRun | null>(null);
  const nextRunIdRef = useRef(0);
  const mountedRef = useRef(false);

  const owns = useCallback(
    (run: StreamRun) =>
      mountedRef.current && run.active && activeRunRef.current === run,
    [],
  );

  const settlePending = useCallback((run: StreamRun, error?: Error) => {
    for (const pending of run.pendingCommits) {
      if (pending.settled) continue;
      pending.settled = true;
      error ? pending.reject(error) : pending.resolve();
    }
    run.pendingCommits.clear();
  }, []);

  // A batch callback waits for this exact run's post-commit layout effect. A
  // replacement cannot flush it because its pending set is not shared.
  useLayoutEffect(() => {
    const run = activeRunRef.current;
    if (!run || stream.runId !== run.id || !owns(run)) return;
    settlePending(run);
    const perf = globalThis.performance;
    perf?.mark?.("desktop_query_stream_react_commit");
    if (stream.phase === "streaming" && stream.nextSequence === 1) {
      try {
        perf?.measure?.(
          "desktop_query_interaction_to_first_batch",
          "desktop_query_interaction_start",
          "desktop_query_stream_first_batch_received",
        );
        perf?.measure?.(
          "desktop_query_interaction_to_react_interactive",
          "desktop_query_interaction_start",
          "desktop_query_stream_react_commit",
        );
      } catch {
        // Direct hook tests and non-interactive consumers have no click mark.
      }
    }
  }, [owns, settlePending, stream]);

  const commit = useCallback((run: StreamRun, next: SqlStreamViewState) => {
    if (!owns(run)) return Promise.reject(staleRun());
    stateRef.current = next;
    setStream(next);
    return new Promise<void>((resolve, reject) => {
      const pending: PendingCommit = { resolve, reject, settled: false };
      run.pendingCommits.add(pending);
      if (!owns(run)) {
        pending.settled = true;
        run.pendingCommits.delete(pending);
        reject(staleRun());
      }
    });
  }, [owns]);

  // `keepRows` is a user cancel: the rows already received stay as a partial
  // result marked cancelled. A replacement run or unmount discards them.
  const invalidate = useCallback(async (run: StreamRun | null, keepRows = false) => {
    if (!run || !run.active) return;
    run.active = false;
    run.resolveInvalidated();
    if (activeRunRef.current === run) activeRunRef.current = null;
    settlePending(run, staleRun());
    const current = stateRef.current;
    let partial = false;
    if (
      current.runId === run.id &&
      (current.phase === "connecting" || current.phase === "streaming")
    ) {
      partial = keepRows && current.rowCount > 0;
      if (!partial) clearSqlResultPageCache(current.rowSource);
      const cancelled = partial
        ? { ...current, phase: "cancelled" as const }
        : {
            ...current,
            phase: "cancelled" as const,
            rowSource: emptySqlStreamView(run.id).rowSource,
            rowCount: 0,
          };
      stateRef.current = cancelled;
      setStream(cancelled);
    }
    const controller = run.controller;
    run.controller = null;
    // Cancellation is best effort. Its transport failure must never leave a
    // commit callback unresolved or stop the next run from being created.
    await controller?.cancel().catch(() => undefined);
    if (!partial || !controller) return;
    // The backend publishes the pages it wrote before the run settles; only
    // then can rows that left the bounded page cache be read back.
    await controller.completion.catch(() => undefined);
    const latest = stateRef.current;
    if (!mountedRef.current || latest.runId !== run.id || latest.phase !== "cancelled") return;
    const readable = {
      ...latest,
      rowSource: { ...latest.rowSource, complete: true },
    };
    stateRef.current = readable;
    setStream(readable);
  }, [settlePending]);

  const cancel = useCallback(
    async () => invalidate(activeRunRef.current, true),
    [invalidate],
  );

  const start = useCallback(async (factory: ControllerFactory) => {
    await invalidate(activeRunRef.current);
    const run = newRun(++nextRunIdRef.current);
    activeRunRef.current = run;

    try {
      await commit(run, {
        ...emptySqlStreamView(run.id),
        phase: "connecting",
      });
      if (!owns(run)) return;

      const controller = factory(async (batch) => {
        if (!owns(run)) throw staleRun();
        const next = acceptSqlStreamBatch(stateRef.current, run.id, batch);
        if (!next)
          throw new Error("SQL stream batch rejected by the result reducer");
        // The adapter may ACK only after this run's React commit has completed.
        await commit(run, next);
        if (!owns(run)) throw staleRun();
      });
      if (!owns(run)) {
        await controller.cancel().catch(() => undefined);
        return;
      }
      run.controller = controller;

      const receipt = await Promise.race<SqlStreamReceipt | typeof RUN_INVALIDATED>([
        controller.completion,
        run.invalidated.then(() => RUN_INVALIDATED),
      ]);
      if (receipt === RUN_INVALIDATED) return;
      if (!owns(run)) return;
      await commit(run, finishSqlStream(stateRef.current, run.id, receipt));
    } catch (error) {
      if (!owns(run)) {
        if (!mountedRef.current) throw error;
        return;
      }
      if (stateRef.current.phase === "cancelled") return;
      const current = stateRef.current;
      await commit(run, {
        ...current,
        phase: current.operationId ? "outcome_unknown" : "error",
        error: error instanceof Error ? error.message : "stream operation failed",
      });
      throw error;
    } finally {
      if (activeRunRef.current === run) {
        run.controller = null;
        settlePending(run, staleRun());
        run.active = false;
        activeRunRef.current = null;
      }
    }
  }, [commit, invalidate, owns, settlePending]);

  const reset = useCallback(async () => {
    await invalidate(activeRunRef.current);
    if (!mountedRef.current) return;
    const run = newRun(++nextRunIdRef.current);
    activeRunRef.current = run;
    await commit(run, emptySqlStreamView(run.id));
    if (activeRunRef.current === run) {
      run.active = false;
      activeRunRef.current = null;
    }
  }, [commit, invalidate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void invalidate(activeRunRef.current);
    };
  }, [invalidate, scopeKey]);

  return { stream, start, cancel, reset };
}
