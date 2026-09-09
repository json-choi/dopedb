// Central result presentation. Local snapshots survive editor and document closure;
// every result stays scoped to its original connection and workspace store.
import { useState } from "react";

import { Icon } from "../../components/Icon";
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
import QueryServiceResult from "./QueryServiceResult";
import { type QueryServiceStore, useQueryServiceSnapshot } from "./store";

export default function QueryResultsPane({
  store,
  connection,
  documentId,
  onOpenSafety,
}: {
  store: QueryServiceStore;
  connection: ConnectionProfile;
  documentId?: string;
  onOpenSafety: (connectionId: string) => void;
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
          />
        )}
      </WorkbenchContainedBody>
    </WorkbenchPane>
  );
}
