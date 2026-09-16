// Idle-debounced analysis of the current draft: statement and parameter counts
// plus the run signal the toolbar shows. Results carry the draft version they were
// computed from, so an answer for older text is discarded instead of displayed.
import { useEffect, useRef, useState } from "react";
import type { SafetySettings } from "../../ipc/types";
import type { ConnectionEngine } from "../connections/domain";
import {
  analyzeSqlDraft,
  type SqlDraftAnalysisRequest,
  type SqlDraftAnalysisResult,
} from "./sqlDraftAnalysis";

const ANALYSIS_IDLE_DELAY_MS = 140;

const EMPTY_ANALYSIS: SqlDraftAnalysisResult = {
  requestId: 0,
  version: -1,
  statementCount: 0,
  parameterCount: 0,
  runSignal: null,
};

export function useSqlDraftAnalysis({
  sql,
  version,
  engine,
  safety,
}: {
  sql: string;
  version: number;
  engine: ConnectionEngine;
  safety: SafetySettings;
}) {
  const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
  const workerRef = useRef<Worker | null>(null);
  const requestSequenceRef = useRef(0);
  const latestRequestRef = useRef<SqlDraftAnalysisRequest | null>(null);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./sqlDraftAnalysis.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      return;
    }
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SqlDraftAnalysisResult>) => {
      if (event.data.requestId !== requestSequenceRef.current) return;
      setAnalysis(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      const latest = latestRequestRef.current;
      if (
        latest &&
        latest.requestId === requestSequenceRef.current
      ) {
        window.setTimeout(() => setAnalysis(analyzeSqlDraft(latest)), 0);
      }
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const request: SqlDraftAnalysisRequest = {
      requestId: ++requestSequenceRef.current,
      version,
      sql,
      engine,
      safety: {
        allowWrites: safety.allowWrites,
        allowSchemaChanges: safety.allowSchemaChanges,
        maxRows: safety.maxRows,
      },
    };
    latestRequestRef.current = request;
    if (sql.length === 0) {
      setAnalysis({ ...EMPTY_ANALYSIS, requestId: request.requestId, version });
      return;
    }
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (worker) worker.postMessage(request);
      else setAnalysis(analyzeSqlDraft(request));
    }, ANALYSIS_IDLE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    engine,
    safety.allowSchemaChanges,
    safety.allowWrites,
    safety.maxRows,
    sql,
    version,
  ]);

  return analysis;
}
