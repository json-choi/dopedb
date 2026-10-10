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
import { useI18n } from "../../lib/i18n";
import type { ConnectionProfile } from "../connections/domain";
import QueryServiceResult, { type SqlErrorNavigation } from "./QueryServiceResult";
import type { QueryServiceSession } from "./domain";
import { type QueryServiceStore, useQueryServiceSnapshot } from "./store";

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
  const output = [
    `[${active.startedLabel}] ${t("services.started", { connection: active.connectionName })}`,
    "",
    active.sql,
    "",
    status,
  ].join("\n");

  return (
    <WorkbenchPane>
      <IdeToolTabStrip
        label={t("services.tabs")}
        density="compact"
        status={
          <WorkbenchSelect
            label={t("sql.executionResults")}
            title={`${active.consoleTitle} · ${active.startedLabel} · ${status}`}
            value={active.id}
            onChange={(sessionId) => store.activate(sessionId)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.consoleTitle} · {session.startedLabel} · {t(`services.status.${session.status}`)}
              </option>
            ))}
          </WorkbenchSelect>
        }
      >
        {Array.from({ length: Math.max(1, statementCount) }, (_, index) => (
          <IdeToolTab
            key={index}
            active={tab === index}
            size="compact"
            onClick={() => selectTab(index)}
          >
            <Icon name="table" />
            {statementCount > 1
              ? t("services.resultNumber", { number: index + 1 })
              : t("services.resultTab")}
          </IdeToolTab>
        ))}
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
