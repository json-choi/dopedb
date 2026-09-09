// Owns SQL editor persistence, target resolution, execution approval, streaming,
// cancellation, and Services projection for the manual query workbench.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SqlLanguage } from "sql-formatter";

import type { ConnectionProfile } from "../connections/domain";
import { approveOperation } from "../operations/tauriAdapter";
import {
  localizeRunSignal,
} from "../query/runSignal";
import { useSqlDraftAnalysis } from "../query/useSqlDraftAnalysis";
import { formatSqlDocument } from "../query/sqlFormatter";
import { useSqlEditorBuffer } from "../query/useSqlEditorBuffer";
import {
  findSqlParameters,
  materializeSqlParameters,
} from "../query/sqlParameters";
import {
  nextQueryServiceSessionId,
  type QueryServiceResult,
  type QueryServiceSession,
} from "../queryServices/domain";
import {
  connectionId,
  sqlDocumentId,
  type SqlDocument,
} from "../sqlDocuments/domain";
import { tauriSqlDocumentGateway } from "../sqlDocuments/tauriAdapter";
import { useSqlDocumentAutosave } from "../sqlDocuments/useSqlDocumentAutosave";
import {
  publishWorkbenchDraft,
  useWorkbenchDraft,
} from "../workbench/draftStore";
import type { SafetySettings, ScriptOutcome } from "../../ipc/types";
import { errDetails, errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { useEventCallback } from "../../lib/useEventCallback";
import { splitStatements } from "../../lib/sqlStatements";
import { useQueryRun } from "../../lib/useQueryRun";
import type { PreviewReport } from "./domain";
import type {
  SqlCursorPosition,
  SqlExecutionStatus,
  SqlRunSource,
} from "./editorStatus";
import {
  clearSqlEditorCursor,
  publishSqlEditorCursor,
} from "./editorStatusStore";
import type { SqlResolveMode } from "./resolveMode";
import {
  approveManualOperationIfRequired,
  canFallbackFromCombinedRead,
  initialSqlRunPath,
  proposalSqlRunPath,
} from "./runPath";
import {
  scriptProductAnalyticsSummary,
  streamProductAnalyticsOutcome,
  useQueryExecutionAnalytics,
} from "./productAnalytics";
import {
  inspectSql,
  proposeScript,
  proposeSql,
  runScript,
  runSql as runSqlOperation,
  runSqlReadStream,
  runSqlStream,
} from "./tauriAdapter";
import { useSqlResultStream } from "./useSqlResultStream";
import {
  buildSqlHelpPrompt,
  wholeDocumentRunSource,
  type SqlParameterDialogState,
  type SqlWorkbenchErrorInfo,
  type SqlWorkbenchLastAttempt,
  type SqlWorkbenchResultKind,
  type SqlWorkbenchRun,
} from "./sqlWorkbenchModel";
import { useSqlWorkbenchTarget } from "./useSqlWorkbenchTarget";

export type SqlWorkbenchProps = {
  connection: ConnectionProfile;
  documentId: string;
  safety: SafetySettings;
  safetyReady: boolean;
  safetyLoadError: string | null;
  draft: string;
  title: string;
  setTitle: (title: string) => void;
  selectedDatabase: string;
  setSelectedDatabase: (selectedDatabase: string) => void;
  selectedSchema: string | null;
  setSelectedSchema: (selectedSchema: string | null) => void;
  resolveMode: SqlResolveMode;
  setResolveMode: (resolveMode: SqlResolveMode) => void;
  persistedId: string | null;
  revision: number;
  recovered: boolean;
  onPersisted: (document: SqlDocument) => void;
  onQueryServiceSessionChange: (session: QueryServiceSession) => void;
  onShowResult: (sessionId: string) => void;
  onOpenHistory: () => void;
  onRetrySafety: () => void;
};

export function useSqlWorkbenchController({
  connection,
  documentId,
  safety,
  safetyReady,
  draft: draftSnapshot,
  title,
  setTitle,
  selectedDatabase,
  setSelectedDatabase,
  selectedSchema,
  setSelectedSchema,
  resolveMode,
  setResolveMode,
  persistedId,
  revision,
  recovered,
  onPersisted,
  onQueryServiceSessionChange,
  onShowResult,
}: SqlWorkbenchProps) {
  const { t } = useI18n();
  const shellSnapshot = useWorkbenchDraft(documentId, draftSnapshot);
  const {
    draft,
    draftVersion,
    setDraft,
    flushSnapshot: flushDraftSnapshot,
  } = useSqlEditorBuffer({
    documentId,
    snapshot: shellSnapshot,
    onSnapshot: publishWorkbenchDraft,
  });
  const draftAnalysis = useSqlDraftAnalysis({
    sql: draft,
    version: draftVersion,
    engine: connection.engine,
    safety,
  });
  const analysisCurrent = draftAnalysis.version === draftVersion;
  const draftIsScript = analysisCurrent && draftAnalysis.statementCount > 1;
  const draftParameterCount = analysisCurrent
    ? draftAnalysis.parameterCount
    : 0;
  const draftSignal = useMemo(
    () =>
      analysisCurrent ? localizeRunSignal(draftAnalysis.runSignal, t) : null,
    [analysisCurrent, draftAnalysis.runSignal, t],
  );

  const [resultKind, setResultKind] =
    useState<SqlWorkbenchResultKind | null>(null);
  const [run, setRun] = useState<SqlWorkbenchRun | null>(null);
  const {
    stream,
    start: startDesktopStream,
    cancel: cancelDesktopStream,
    reset: resetDesktopStream,
  } = useSqlResultStream(connection.id);
  const [scriptOut, setScriptOut] = useState<{
    outcome: ScriptOutcome;
    at: string;
  } | null>(null);
  const { running, cancelled, execute, cancel, track } = useQueryRun();
  const [runErr, setRunErr] = useState<SqlWorkbenchErrorInfo | null>(null);
  const [lastAttempt, setLastAttempt] =
    useState<SqlWorkbenchLastAttempt | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [parameterValues, setParameterValues] = useState<
    Record<string, string>
  >({});
  const [parameterDialog, setParameterDialog] =
    useState<SqlParameterDialogState | null>(null);
  const serviceSessionRef = useRef<
    Omit<QueryServiceSession, "status" | "result" | "updatedAt"> | undefined
  >(undefined);

  // EXPLAIN plan (read-only preview) shown above the results, independent of execution.
  const [plan, setPlan] = useState<PreviewReport | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const {
    catalogScope,
    catalog,
    databaseOptions,
    effectiveDatabase,
    effectiveNamespace,
    namespaceOptions,
    manualTransaction,
  } = useSqlWorkbenchTarget({
    connection,
    selectedDatabase,
    setSelectedDatabase,
    selectedSchema,
    setSelectedSchema,
  });
  const scriptAnalytics = scriptOut
    ? scriptProductAnalyticsSummary(scriptOut.outcome)
    : null;
  const queryAnalytics = useQueryExecutionAnalytics({
    scope: catalogScope,
    connectionEngine: connection.engine,
    credentialMode: connection.credentialMode,
    cancelled,
    failed: runErr !== null,
    materializedCompleted: run !== null,
    materializedRowCount: run?.outcome.result?.rowCount ?? null,
    materializedDurationMs: run?.outcome.result?.durationMs ?? null,
    scriptOutcome: scriptAnalytics?.outcome ?? null,
    scriptRowCount: scriptAnalytics?.rowCount ?? null,
    streamRunId: stream.runId,
    streamOutcome: streamProductAnalyticsOutcome(stream.phase),
    streamRowCount: stream.rowCount,
    streamDurationMs: stream.durationMs,
  });
  const resolveModeHint =
    resolveMode === "script"
      ? t("sql.resolveModeScriptHint")
      : t("sql.resolveModePlaygroundHint");

  const {
    saveState: documentSaveState,
    saveError: documentSaveError,
    conflict: documentConflict,
    useSavedVersion: loadSavedConflictVersion,
    keepLocalVersion: keepLocalConflictVersion,
    reportError: reportDocumentSaveError,
    flushRecovery,
  } = useSqlDocumentAutosave({
    gateway: tauriSqlDocumentGateway,
    connectionId: connectionId(connection.id),
    documentId: persistedId ? sqlDocumentId(persistedId) : null,
    revision,
    title,
    selectedDatabase: effectiveDatabase,
    selectedSchema,
    resolveMode,
    content: draft,
    recovered,
    onTitleChange: setTitle,
    onSelectedDatabaseChange: setSelectedDatabase,
    onSelectedSchemaChange: setSelectedSchema,
    onResolveModeChange: setResolveMode,
    onContentChange: setDraft,
    onPersisted,
  });
  const flushEditorState = useEventCallback(() => {
    flushDraftSnapshot();
    flushRecovery();
  });
  const handleCursorChange = useEventCallback((position: SqlCursorPosition) => {
    publishSqlEditorCursor(documentId, position);
  });

  useEffect(() => () => clearSqlEditorCursor(documentId), [documentId]);

  async function formatDraft() {
    if (!draft.trim() || formatting) return;
    setFormatting(true);
    try {
      const language: SqlLanguage =
        connection.engine === "postgres"
          ? "postgresql"
          : connection.engine === "mysql"
            ? "mysql"
            : connection.engine === "bigquery"
              ? "bigquery"
              : "sqlite";
      setDraft(await formatSqlDocument(draft, language));
    } catch (error) {
      reportDocumentSaveError(error);
    } finally {
      setFormatting(false);
    }
  }

  async function runSql(sql: string, source: SqlRunSource) {
    if (!sql || running || !safetyReady) return;
    flushEditorState();
    globalThis.performance?.clearMarks?.("desktop_query_interaction_start");
    globalThis.performance?.mark?.("desktop_query_interaction_start");

    const statements = splitStatements(sql);
    const script = statements.length > 1;
    const analyticsAttempt = queryAnalytics.begin(sql, stream.runId);
    const at = new Date().toLocaleTimeString();
    const sessionId = nextQueryServiceSessionId(documentId);
    serviceSessionRef.current = {
      schemaVersion: 2,
      id: sessionId,
      documentId,
      connectionId: connection.id,
      connectionName: connection.name,
      consoleTitle: title,
      database: effectiveDatabase,
      namespace: effectiveNamespace,
      sql,
      startedAt: new Date().toISOString(),
      startedLabel: at,
    };
    onQueryServiceSessionChange({
      ...serviceSessionRef.current,
      updatedAt: Date.now(),
      status: "running",
      result: { kind: "none" },
    });
    onShowResult(sessionId);
    setRunErr(null);
    setRun(null);
    setScriptOut(null);
    setResultKind(script ? "script" : "single");
    setLastAttempt({ sql, at, documentVersion: draftVersion, source });

    try {
      await execute(async () => {
        await resetDesktopStream();
        queryAnalytics.arm(analyticsAttempt);
        if (script) {
          const proposal = await proposeScript(
            connection.id,
            sql,
            "manual",
            effectiveNamespace,
            effectiveDatabase,
          );
          if (proposal.approvalRequired) {
            queryAnalytics.requireApproval(analyticsAttempt);
          }
          await approveManualOperationIfRequired(proposal, approveOperation);
          track(proposal.operationId);
          const outcome = await runScript(proposal.operationId);
          setScriptOut({ outcome, at });
        } else {
          const runPlannedSql = async () => {
            const proposal = await proposeSql(
              connection.id,
              sql,
              "manual",
              effectiveNamespace,
              effectiveDatabase,
            );
            const approvalRequired =
              proposalSqlRunPath(proposal) === "approval";
            if (approvalRequired) {
              queryAnalytics.requireApproval(analyticsAttempt);
              await approveManualOperationIfRequired(
                proposal,
                approveOperation,
              );
            }
            setRun(null);
            if (approvalRequired || manualTransaction.status) {
              track(proposal.operationId);
              setRun({
                sql,
                outcome: await runSqlOperation(proposal.operationId),
                at: new Date().toLocaleTimeString(),
              });
            } else {
              await startDesktopStream((onBatch) =>
                runSqlStream(proposal.operationId, onBatch),
              );
            }
          };
          if (
            !manualTransaction.status &&
            initialSqlRunPath(safety.autoRunReads, sql) ===
              "combinedReadStream"
          ) {
            queryAnalytics.disarm(analyticsAttempt);
            try {
              // Exactly one IPC for auto reads. Only the backend's typed,
              // pre-target `proposalRequired` signal may enter the proposal UI.
              setRun(null);
              await startDesktopStream((onBatch) =>
                runSqlReadStream(
                  connection.id,
                  sql,
                  onBatch,
                  "manual",
                  effectiveNamespace,
                  effectiveDatabase,
                ),
              );
            } catch (error) {
              if (!canFallbackFromCombinedRead(errDetails(error).kind)) {
                queryAnalytics.arm(analyticsAttempt);
                throw error;
              }
              await resetDesktopStream();
              queryAnalytics.arm(analyticsAttempt);
              await runPlannedSql();
            }
            queryAnalytics.arm(analyticsAttempt);
          } else {
            // Manual/read-only settings still stream after the durable proposal;
            // approved write/DDL returns its bounded materialized outcome.
            await runPlannedSql();
          }
        }
      });
    } catch (e) {
      queryAnalytics.arm(analyticsAttempt);
      if (!script && stream.phase === "cancelled") return;
      const details = errDetails(e);
      setRunErr({ ...details, sql, at: new Date().toLocaleTimeString() });
      // Clear the attempted kind so a failed run can't leave the previous
      // result sitting under the error card looking current.
      if (script) setScriptOut(null);
      else {
        setRun(null);
      }
    }
  }

  function executeSql(selectedSource?: SqlRunSource) {
    const source = selectedSource ?? wholeDocumentRunSource(draft);
    if (!source?.sql || running || !safetyReady) return;
    const parameters = findSqlParameters(source.sql, connection.engine);
    if (parameters.length > 0) {
      setParameterDialog({
        sql: source.sql,
        source,
        parameters,
        action: "run",
      });
      return;
    }
    void runSql(source.sql, source);
  }
  const executeSqlFromEditor = useEventCallback(executeSql);

  function openParameterDialog() {
    const parameters = findSqlParameters(draft, connection.engine);
    if (parameters.length === 0) return;
    setParameterDialog({
      sql: draft,
      source: wholeDocumentRunSource(draft) ?? {
        sql: draft,
        from: 0,
        to: draft.length,
      },
      parameters,
      action: "apply",
    });
  }

  function applyParameterValues(values: Record<string, string>) {
    const pending = parameterDialog;
    if (!pending) return;
    const sql = materializeSqlParameters(
      pending.sql,
      pending.parameters,
      values,
    );
    setParameterValues(values);
    setParameterDialog(null);
    if (pending.action === "run") void runSql(sql, pending.source);
    else if (pending.action === "explain") void explainSql(sql);
  }

  async function explainSql(sql: string) {
    if (!sql.trim() || splitStatements(sql).length > 1 || explaining) return;
    setPlanErr(null);
    setExplaining(true);
    try {
      // One backend inspection owns classification, authority pinning, and the
      // read-only Explain. There is no classify-to-preview IPC race to bridge.
      const inspection = await inspectSql(
        connection.id,
        sql,
        effectiveNamespace,
        effectiveDatabase,
      );
      setPlan(inspection.report);
    } catch (e) {
      setPlanErr(errMessage(e));
      setPlan(null);
    } finally {
      setExplaining(false);
    }
  }

  function explain() {
    if (!draft.trim() || explaining) return;
    if (splitStatements(draft).length > 1) return;
    const parameters = findSqlParameters(draft, connection.engine);
    if (parameters.length > 0) {
      setParameterDialog({
        sql: draft,
        source: wholeDocumentRunSource(draft) ?? {
          sql: draft,
          from: 0,
          to: draft.length,
        },
        parameters,
        action: "explain",
      });
      return;
    }
    void explainSql(draft);
  }

  // A plan describes the draft it was generated from — invalidate it on edit.
  useEffect(() => {
    setPlan(null);
    setPlanErr(null);
  }, [draftVersion]);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const aiPrompt = useMemo(
    () =>
      runErr
        ? buildSqlHelpPrompt({
            connection,
            database: effectiveDatabase,
            namespace: effectiveNamespace,
            sql: lastAttempt?.sql ?? runErr.sql,
            error: runErr,
          })
        : "",
    [
      connection,
      effectiveDatabase,
      effectiveNamespace,
      lastAttempt?.sql,
      runErr,
    ],
  );
  const editorExecutionStatus = useMemo<SqlExecutionStatus | null>(() => {
    const attempt = lastAttempt;
    const sql = attempt?.sql.trim();
    if (!attempt || !sql || attempt.documentVersion !== draftVersion)
      return null;
    if (runErr) {
      return {
        source: attempt.source,
        state: "failed",
        label: t("services.status.failed"),
      };
    }
    if (
      running ||
      stream.phase === "connecting" ||
      stream.phase === "streaming"
    ) {
      return {
        source: attempt.source,
        state: "running",
        label: t("sql.runningFor", { seconds: elapsed }),
      };
    }
    if (cancelled || stream.phase === "cancelled") {
      return {
        source: attempt.source,
        state: "cancelled",
        label: t("services.status.cancelled"),
      };
    }
    const durationMs =
      stream.durationMs ?? run?.outcome.result?.durationMs ?? null;
    if (scriptOut || run || stream.phase === "complete") {
      return {
        source: attempt.source,
        state: "completed",
        label:
          durationMs === null
            ? t("services.status.completed")
            : `${Math.round(durationMs)} ms`,
      };
    }
    return null;
  }, [
    cancelled,
    draftVersion,
    elapsed,
    lastAttempt,
    run,
    runErr,
    running,
    scriptOut,
    stream.durationMs,
    stream.phase,
    t,
  ]);

  useEffect(() => {
    const session = serviceSessionRef.current;
    if (!session) return;

    let result: QueryServiceResult = { kind: "none" };
    if (runErr) {
      result = { kind: "error", error: runErr, prompt: aiPrompt };
    } else if (resultKind === "script" && scriptOut) {
      result = {
        kind: "script",
        outcome: scriptOut.outcome,
        at: scriptOut.at,
      };
    } else if (resultKind === "single" && run) {
      result = {
        kind: "materialized",
        sql: run.sql,
        outcome: run.outcome,
        at: run.at,
        maxRows: safety.maxRows,
      };
    } else if (
      resultKind === "single" &&
      (stream.phase === "connecting" ||
        stream.phase === "streaming" ||
        stream.phase === "complete")
    ) {
      result = {
        kind: "stream",
        sql: lastAttempt?.sql ?? session.sql,
        stream,
        maxRows: safety.maxRows,
      };
    }

    const status = runErr
      ? "failed"
      : cancelled || stream.phase === "cancelled"
        ? "cancelled"
        : running ||
            stream.phase === "connecting" ||
            stream.phase === "streaming"
          ? "running"
          : result.kind === "none"
            ? "running"
            : "completed";

    onQueryServiceSessionChange({
      ...session,
      updatedAt: Date.now(),
      status,
      result,
    });
  }, [
    aiPrompt,
    cancelled,
    lastAttempt?.sql,
    onQueryServiceSessionChange,
    resultKind,
    run,
    runErr,
    running,
    safety.maxRows,
    scriptOut,
    stream,
  ]);

  const cancelRun = () => {
    cancel();
    void cancelDesktopStream();
  };
  const closeParameterDialog = () => setParameterDialog(null);
  const closePlan = () => setPlan(null);
  return {
    analysisCurrent,
    applyParameterValues,
    cancelRun,
    catalog,
    closeParameterDialog,
    closePlan,
    databaseOptions,
    documentConflict,
    documentSaveError,
    documentSaveState,
    draft,
    draftIsScript,
    draftParameterCount,
    draftSignal,
    editorExecutionStatus,
    effectiveDatabase,
    effectiveNamespace,
    elapsed,
    executeSql,
    executeSqlFromEditor,
    explain,
    explaining,
    flushEditorState,
    formatDraft,
    formatting,
    handleCursorChange,
    keepLocalConflictVersion,
    loadSavedConflictVersion,
    manualTransaction,
    namespaceOptions,
    openParameterDialog,
    parameterDialog,
    parameterValues,
    plan,
    planErr,
    resolveModeHint,
    running,
    setDraft,
  };
}
