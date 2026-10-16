// Central result presentation. Local snapshots survive editor and document closure;
// every result stays scoped to its original connection and workspace store. A
// running query shows its elapsed time and, while its run has registered one, the
// same exact cancel the status bar uses, next to the result it will produce.
import { useEffect, useState } from "react";

import { queryTaskKey, useBackgroundTaskCancels } from "../backgroundTasks/cancelRegistry";
import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import { IdeToolTab, IdeToolTabStrip } from "../../design-system/components/IdeTabs";
import {
  WorkbenchContainedBody,
  WorkbenchEmptyState,
  WorkbenchPane,
  WorkbenchScrollBody,
  WorkbenchSelect,
} from "../../design-system/components/Workbench";
import { useI18n, type I18nKey } from "../../lib/i18n";
import { sqlResultTitle } from "../query/sqlDraftAnalysis";
import type { ConnectionProfile } from "../connections/domain";
import QueryServiceResult, { type SqlErrorNavigation } from "./QueryServiceResult";
import type { QueryServiceSession } from "./domain";
import { type QueryServiceStore, useQueryServiceSnapshot } from "./store";

type Translate = (
  key: I18nKey,
  vars?: Record<string, string | number>,
) => string;

/** Leading-comment title of a session's exact run payload, or null without one. */
function sessionResultTitle(session: QueryServiceSession): string | null {
  if (session.result.kind === "materialized") return sqlResultTitle(session.result.sql);
  if (session.result.kind === "stream") return sqlResultTitle(session.result.sql);
  if (session.result.kind === "error") return sqlResultTitle(session.sql);
  // A script's statements carry their own titles on the per-statement tabs.
  return null;
}

/** Per-statement tab label source; non-script runs use the session title. */
function statementResultTitle(
  session: QueryServiceSession,
  index: number,
): string | null {
  if (session.result.kind !== "script") return null;
  return sqlResultTitle(session.result.outcome.statements[index]?.sql ?? "");
}

/**
 * The Output tab's status text: state, row/affected counts, and the timing
 * split — the backend receipt's duration next to what the renderer observed,
 * so the difference is honestly attributable to the client pipeline. Restored
 * snapshots keep the backend total alone.
 */
function outputSummaryText(session: QueryServiceSession, t: Translate): string {
  const parts = [t(`services.status.${session.status}`)];
  const result = session.result;
  if (result.kind === "none" || result.kind === "error") return parts[0];
  if (result.kind === "script") {
    const lines = [parts[0]];
    result.outcome.statements.forEach((statement, index) => {
      const statementParts = [`${index + 1}.`];
      const title = sqlResultTitle(statement.sql);
      if (title) statementParts.push(title);
      const rows = statement.result
        ? statement.result.rowCount
        : statement.affected;
      if (rows !== null) {
        statementParts.push(t("services.outputRows", { count: rows }));
      }
      const durationMs = statement.result?.durationMs;
      if (durationMs != null) {
        statementParts.push(t("services.outputTotal", { ms: Math.round(durationMs) }));
      }
      if (statement.error) statementParts.push(t("services.status.failed"));
      lines.push(statementParts.join(" · "));
    });
    return lines.join("\n");
  }
  if (result.kind === "stream") {
    parts.push(t("services.outputRows", { count: result.stream.rowCount }));
    const timings = result.stream.timings;
    const durationMs = result.stream.durationMs;
    if (timings && durationMs !== null) {
      parts.push(t("services.outputTotal", { ms: Math.round(timings.clientTotalMs) }));
      parts.push(t("services.outputExecuted", { ms: Math.round(durationMs) }));
      parts.push(
        t("services.outputReceived", {
          ms: Math.max(0, Math.round(timings.clientTotalMs - durationMs)),
        }),
      );
    } else if (durationMs !== null) {
      parts.push(t("services.outputTotal", { ms: Math.round(durationMs) }));
    }
    return parts.join(" · ");
  }
  if (result.outcome.result) {
    parts.push(t("services.outputRows", { count: result.outcome.result.rowCount }));
    if (result.outcome.result.durationMs !== null) {
      parts.push(
        t("services.outputTotal", { ms: Math.round(result.outcome.result.durationMs) }),
      );
    }
  } else if (result.outcome.affected !== null && result.outcome.affected > 0) {
    parts.push(t("services.outputAffected", { count: result.outcome.affected }));
  }
  return parts.join(" · ");
}

/** Whole seconds since `startedAt`, ticking while `running`. */
function useElapsedSeconds(startedAt: string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1_000)) : 0;
}

export default function QueryResultsPane({
  store,
  connection,
  documentId,
  onOpenSafety,
  onRerun,
  onOpenActivity,
  errorNavigation,
}: {
  store: QueryServiceStore;
  connection: ConnectionProfile;
  documentId?: string;
  onOpenSafety: (connectionId: string) => void;
  onRerun?: (session: QueryServiceSession) => void;
  onOpenActivity?: () => void;
  errorNavigation?: SqlErrorNavigation | null;
}) {
  const { t } = useI18n();
  const snapshot = useQueryServiceSnapshot(store);
  const sessions = snapshot.sessions.filter(
    (session) => session.connectionId === connection.id &&
      (!documentId || session.documentId === documentId),
  );
  const active = sessions.find(
    (session) => session.id === snapshot.activeSessionId,
  ) ?? sessions[0];
  const [selection, setSelection] = useState<{
    sessionId: string;
    tab: number | "output";
  } | null>(null);
  const tab = selection?.sessionId === active?.id ? selection?.tab ?? 0 : 0;
  const running = active?.status === "running" || active?.status === "waiting";
  const elapsed = useElapsedSeconds(active?.startedAt, running);
  // Present only while the run that owns this session can still be stopped.
  const cancelRun = useBackgroundTaskCancels().get(queryTaskKey(active?.id ?? ""));

  if (!active) {
    return <WorkbenchEmptyState icon="table">{t("sql.resultsEmpty")}</WorkbenchEmptyState>;
  }
  const statementCount = active.result.kind === "script"
    ? active.result.outcome.statements.length
    : 1;
  const selectTab = (next: number | "output") =>
    setSelection({ sessionId: active.id, tab: next });
  const status = t(`services.status.${active.status}`);
  const title = sessionResultTitle(active);
  const output = [
    `[${active.startedLabel}] ${t("services.started", { connection: active.connectionName })}`,
    "",
    active.sql,
    "",
    outputSummaryText(active, t),
  ].join("\n");

  return (
    <WorkbenchPane>
      <IdeToolTabStrip
        label={t("services.tabs")}
        density="compact"
        status={
          <WorkbenchSelect
            label={t("sql.executionResults")}
            title={`${title ?? active.consoleTitle} · ${active.startedLabel} · ${status}`}
            value={active.id}
            onChange={(sessionId) => store.activate(sessionId)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {`${sessionResultTitle(session) ?? session.consoleTitle} · ${session.startedLabel} · ${t(`services.status.${session.status}`)}`}
              </option>
            ))}
          </WorkbenchSelect>
        }
      >
        {Array.from({ length: Math.max(1, statementCount) }, (_, index) => {
          const label =
            statementCount > 1
              ? statementResultTitle(active, index) ??
                t("services.resultNumber", { number: index + 1 })
              : title ?? t("services.resultTab");
          return (
            <IdeToolTab
              key={index}
              active={tab === index}
              size="compact"
              onClick={() => selectTab(index)}
            >
              <Icon name="table" />
              {label}
            </IdeToolTab>
          );
        })}
        <IdeToolTab
          active={tab === "output"}
          size="compact"
          onClick={() => selectTab("output")}
        >
          <Icon name="terminal" />{t("services.outputTab")}
        </IdeToolTab>
      </IdeToolTabStrip>
      {running ? (
        <div className="tw:flex tw:min-h-control-md tw:items-center tw:gap-2 tw:border-b tw:border-border-subtle tw:px-3 tw:text-ui">
          <Icon name="refresh" className="tw:text-info" />
          {/* A timer is not announced on every tick, unlike a status region. */}
          <span role="timer" className="tw:min-w-0 tw:flex-1 tw:tabular-nums">
            {t("sql.runningFor", { seconds: elapsed })}
          </span>
          {cancelRun ? (
            <Button size="compact" onClick={() => void cancelRun()}>
              {t("sql.cancelRun")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <WorkbenchContainedBody>
        {tab === "output" ? (
          <WorkbenchScrollBody>
            <pre className="tw:m-0 tw:p-3 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre-wrap">
              {output}
            </pre>
          </WorkbenchScrollBody>
        ) : active.result.kind === "none" ? (
          <WorkbenchEmptyState icon="table"><span role="status">{status}</span></WorkbenchEmptyState>
        ) : (
          <QueryServiceResult
            key={`${active.id}:${tab}`}
            result={active.result}
            connection={connection}
            onOpenSafety={onOpenSafety}
            scriptStatementIndex={active.result.kind === "script" ? tab : undefined}
            onRerun={onRerun ? () => onRerun(active) : undefined}
            onOpenActivity={onOpenActivity}
            errorNavigation={
              errorNavigation?.sessionId === active.id ? errorNavigation : null
            }
          />
        )}
      </WorkbenchContainedBody>
    </WorkbenchPane>
  );
}
