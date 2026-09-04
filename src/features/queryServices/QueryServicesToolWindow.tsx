import { useEffect, useMemo, useState } from "react";

import { Icon } from "../../components/Icon";
import { StatusDot } from "../../design-system/components/Status";
import { ResizeSeparator } from "../../design-system/components/ResizeSeparator";
import {
  ToolWindowHeader,
  ToolWindowHideButton,
} from "../../design-system/components/ToolWindow";
import {
  IdeToolTab,
  IdeToolTabStrip,
} from "../../design-system/components/IdeTabs";
import { TreeSectionButton } from "../../design-system/components/TreeControls";
import {
  WorkbenchContainedBody,
  WorkbenchScrollBody,
} from "../../design-system/components/Workbench";
import type { ConnectionProfile } from "../connections/domain";
import type { WorkbenchDocument } from "../workbench/domain";
import { useI18n } from "../../lib/i18n";
import type { QueryServiceSession, QueryServiceStatus } from "./domain";
import QueryServiceResult from "./QueryServiceResult";
import {
  type QueryServiceStore,
  useQueryServiceSnapshot,
} from "./store";

type ServicesTab = "output" | `result:${number}`;
type ServiceDocument = Extract<
  WorkbenchDocument,
  { kind: "data" | "sql" | "documents" }
>;

export default function QueryServicesToolWindow({
  store,
  connections,
  documents,
  activeDocumentId,
  onActivateDocument,
  onOpenSafety,
  onClose,
  onStartResize,
  height,
  minimumHeight,
  maximumHeight,
  onHeightChange,
  onResetHeight,
  compact = false,
}: {
  store: QueryServiceStore;
  connections: ConnectionProfile[];
  documents: WorkbenchDocument[];
  activeDocumentId: string | null;
  onActivateDocument: (id: string) => void;
  onOpenSafety: (connectionId: ConnectionProfile["id"]) => void;
  onClose: () => void;
  onStartResize: (event: { preventDefault(): void; clientY: number }) => void;
  height: number;
  minimumHeight: number;
  maximumHeight: number;
  onHeightChange: (height: number) => void;
  onResetHeight: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { sessions, activeSessionId } = useQueryServiceSnapshot(store);
  const [tab, setTab] = useState<ServicesTab>("result:0");
  const [databaseOpen, setDatabaseOpen] = useState(true);
  const [collapsedConnections, setCollapsedConnections] = useState<Set<string>>(
    () => new Set(),
  );
  const serviceDocuments = useMemo(
    () => documents.filter(isServiceDocument),
    [documents],
  );
  const active =
    sessions.find((session) => session.id === activeSessionId) ??
    sessions[0] ??
    null;

  useEffect(() => {
    if (!activeSessionId && sessions[0]) store.activate(sessions[0].id);
  }, [activeSessionId, sessions, store]);

  const serviceConnections = useMemo(() => {
    const byId = new Map<string, ConnectionProfile>(
      connections.map((connection) => [connection.id, connection]),
    );
    const visibleIds = new Set([
      ...serviceDocuments.map((document) => document.connectionId),
      ...sessions.map((session) => session.connectionId),
    ]);
    return [...visibleIds].flatMap((id) => {
      const connection = byId.get(id);
      return connection ? [connection] : [];
    });
  }, [connections, serviceDocuments, sessions]);
  const activeConnection =
    connections.find((connection) => connection.id === active?.connectionId) ??
    null;
  const resultTabs = active
    ? sessionResultTabs(active, activeConnection, t)
    : [];
  const activeResultIndex =
    tab === "output" ? 0 : Number(tab.slice("result:".length));
  const activeResultTab =
    resultTabs[activeResultIndex] ?? resultTabs[0] ?? null;

  useEffect(() => {
    setTab("result:0");
  }, [active?.id]);

  function toggleConnection(id: string) {
    setCollapsedConnections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      className="tw:relative tw:col-[1/-1] tw:row-start-3 tw:mx-[2px] tw:mb-1 tw:flex tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-background tw:data-[compact=true]:fixed tw:data-[compact=true]:top-title-toolbar tw:data-[compact=true]:right-0 tw:data-[compact=true]:bottom-status-bar tw:data-[compact=true]:left-0 tw:data-[compact=true]:z-[var(--ds-z-modal)] tw:data-[compact=true]:m-0 tw:data-[compact=true]:rounded-none tw:data-[compact=true]:border-x-0"
      data-compact={compact}
      aria-label={t("services.title")}
    >
      <ResizeSeparator
        data-services-resize-handle
        className="tw:absolute tw:-top-1 tw:right-0 tw:left-0 tw:z-[var(--ds-z-raised)] tw:h-2 tw:cursor-row-resize tw:hover:bg-ring/30 tw:active:bg-ring/30"
        label={t("app.dragResize")}
        orientation="horizontal"
        value={height}
        minimum={minimumHeight}
        maximum={maximumHeight}
        step={12}
        onChange={onHeightChange}
        onReset={onResetHeight}
        onMouseDown={onStartResize}
      />
      <ToolWindowHeader
        title={t("services.title")}
        actions={
          <ToolWindowHideButton label={t("common.close")} onClick={onClose} />
        }
      />

      <div className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1">
        <aside className="tw:flex tw:w-[32%] tw:min-w-[220px] tw:max-w-[460px] tw:shrink-0 tw:flex-col tw:border-r tw:border-border-subtle tw:bg-background">
          <div
            className="tw:min-h-0 tw:flex-1 tw:overflow-auto tw:p-1"
            role="tree"
            aria-label={t("services.sessions")}
          >
            {serviceConnections.length === 0 ? (
              <p className="tw:m-0 tw:p-3 tw:text-sm tw:text-muted-foreground">
                {t("services.sessionsEmpty")}
              </p>
            ) : (
              <>
                <TreeSectionButton
                  expanded={databaseOpen}
                  icon="folder"
                  onToggle={() => setDatabaseOpen((open) => !open)}
                >
                  {t("connections.database")}
                </TreeSectionButton>
                {databaseOpen && (
                  <div
                    className="tw:flex tw:flex-col tw:gap-px tw:pl-3"
                    role="group"
                  >
                    {serviceConnections.map((connection) => {
                      const connectionOpen = !collapsedConnections.has(
                        connection.id,
                      );
                      const connectionDocuments = serviceDocuments.filter(
                        (document) => document.connectionId === connection.id,
                      );
                      const documentIds = new Set(
                        connectionDocuments.map((document) => document.id),
                      );
                      const detachedSessions = sessions.filter(
                        (session) =>
                          session.connectionId === connection.id &&
                          !documentIds.has(session.documentId),
                      );
                      return (
                        <div
                          className="tw:flex tw:flex-col tw:gap-px"
                          key={connection.id}
                          role="treeitem"
                          aria-expanded={connectionOpen}
                        >
                          <TreeSectionButton
                            expanded={connectionOpen}
                            icon="database"
                            onToggle={() => toggleConnection(connection.id)}
                          >
                            {connection.name}
                          </TreeSectionButton>
                          {connectionOpen && (
                            <div
                              className="tw:flex tw:flex-col tw:gap-px tw:pl-3"
                              role="group"
                            >
                              {connectionDocuments.map((document) => (
                                <ServiceDocumentNode
                                  key={document.id}
                                  document={document}
                                  active={
                                    active === null &&
                                    document.id === activeDocumentId
                                  }
                                  sessions={sessions.filter(
                                    (session) =>
                                      session.documentId === document.id,
                                  )}
                                  activeSessionId={active?.id ?? null}
                                  onActivateDocument={onActivateDocument}
                                  onActivateSession={store.activate}
                                />
                              ))}
                              {detachedSessions.map((session) => (
                                <ServiceSessionRow
                                  key={session.id}
                                  session={session}
                                  active={session.id === active?.id}
                                  onActivate={store.activate}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        <div className="tw:flex tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col">
          <IdeToolTabStrip
            label={t("services.tabs")}
            density="compact"
            status={
              active ? (
                <span className="tw:inline-flex tw:h-control-sm tw:max-w-[min(30vw,320px)] tw:shrink-0 tw:items-center tw:gap-1 tw:overflow-hidden tw:px-2 tw:text-xs tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap tw:max-[760px]:hidden">
                  <StatusDot tone={statusTone(active.status)} />
                  {statusLabel(active.status, t)}
                </span>
              ) : null
            }
          >
            <IdeToolTab
              active={tab === "output"}
              size="compact"
              onClick={() => setTab("output")}
            >
              <Icon name="terminal" />
              <span className="tw:overflow-hidden tw:text-ellipsis">
                {t("services.outputTab")}
              </span>
            </IdeToolTab>
            {resultTabs.map((resultTab, index) => (
              <IdeToolTab
                key={resultTab.id}
                active={tab === `result:${index}`}
                size="document"
                onClick={() => setTab(`result:${index}`)}
              >
                <Icon name="table" />
                <span className="tw:overflow-hidden tw:text-ellipsis">
                  {resultTab.label}
                </span>
              </IdeToolTab>
            ))}
          </IdeToolTabStrip>

          <WorkbenchContainedBody>
            {!active ? (
              <div className="tw:m-auto tw:grid tw:justify-items-center tw:gap-2 tw:p-6 tw:text-center tw:text-sm tw:text-muted-foreground">
                <Icon name="list" className="tw:text-xl" />
                {t("services.outputEmpty")}
              </div>
            ) : tab === "output" ? (
              <ServiceOutput session={active} />
            ) : (
              <QueryServiceResult
                key={`${active.id}:${activeResultTab?.id ?? "result"}`}
                result={active.result}
                connection={activeConnection}
                onOpenSafety={onOpenSafety}
                scriptStatementIndex={activeResultTab?.statementIndex}
              />
            )}
          </WorkbenchContainedBody>
        </div>
      </div>
    </section>
  );
}

function ServiceDocumentNode({
  document,
  active,
  sessions,
  activeSessionId,
  onActivateDocument,
  onActivateSession,
}: {
  document: ServiceDocument;
  active: boolean;
  sessions: QueryServiceSession[];
  activeSessionId: string | null;
  onActivateDocument: (id: string) => void;
  onActivateSession: (id: string) => void;
}) {
  const { t } = useI18n();
  const latest = sessions[0] ?? null;
  const icon = document.kind === "data" ? "table" : "terminal";
  const title =
    document.kind === "data"
      ? document.table.name
      : document.kind === "sql"
        ? document.title
        : t("tabs.documents");
  const duration = latest ? sessionDuration(latest) : null;
  const activeSessionInDocument = sessions.some(
    (session) => session.id === activeSessionId,
  );
  return (
    <div className="tw:flex tw:flex-col tw:gap-px">
      <button
        type="button"
        role="treeitem"
        data-active={active && !activeSessionInDocument}
        aria-selected={active && !activeSessionInDocument}
        className="ds-object-row tw:w-full tw:min-w-0 tw:cursor-pointer tw:gap-1 tw:rounded-xs tw:border-0 tw:bg-transparent tw:font-sans tw:text-left tw:text-ui tw:data-[active=true]:bg-secondary tw:data-[active=true]:text-secondary-foreground tw:hover:bg-muted"
        onClick={() => onActivateDocument(document.id)}
      >
        <Icon
          name={icon}
          className="tw:shrink-0 tw:text-[length:var(--ds-icon-sm)] tw:text-muted-foreground"
        />
        <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
          {title}
        </span>
        {duration !== null ? (
          <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
            {duration} ms
          </span>
        ) : null}
        {latest ? <StatusDot tone={statusTone(latest.status)} /> : null}
      </button>
      {sessions.length > 0 && (
        <div className="tw:flex tw:flex-col tw:gap-px tw:pl-3" role="group">
          {sessions.map((session) => (
            <ServiceSessionRow
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onActivate={onActivateSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceSessionRow({
  session,
  active,
  onActivate,
}: {
  session: QueryServiceSession;
  active: boolean;
  onActivate: (id: string) => void;
}) {
  const duration = sessionDuration(session);
  const label = sessionResultLabel(session, null) ?? session.consoleTitle;
  return (
    <button
      type="button"
      role="treeitem"
      data-active={active}
      className="ds-object-row tw:w-full tw:min-w-0 tw:cursor-pointer tw:gap-1 tw:rounded-xs tw:border-0 tw:bg-transparent tw:font-sans tw:text-left tw:text-ui tw:data-[active=true]:bg-secondary tw:data-[active=true]:text-secondary-foreground tw:hover:bg-muted"
      onClick={() => onActivate(session.id)}
      aria-selected={active}
      title={`${label} · ${session.startedLabel}`}
    >
      <StatusDot tone={statusTone(session.status)} />
      <span className="tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {label}
      </span>
      <span className="tw:shrink-0 tw:text-xs tw:text-muted-foreground">
        {duration !== null ? `${duration} ms` : session.startedLabel}
      </span>
    </button>
  );
}

function ServiceOutput({ session }: { session: QueryServiceSession }) {
  const { t } = useI18n();
  const lines = useMemo(
    () => [
      `[${session.startedLabel}] ${t("services.started", {
        connection: session.connectionName,
      })}`,
      "",
      session.sql,
      "",
      statusLabel(session.status, t),
    ],
    [session, t],
  );

  return (
    <WorkbenchScrollBody>
      <pre className="tw:m-0 tw:min-h-full tw:p-3 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre-wrap tw:text-foreground">
        {lines.join("\n")}
      </pre>
    </WorkbenchScrollBody>
  );
}

function statusTone(status: QueryServiceStatus) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "running" || status === "waiting") return "warning" as const;
  return "neutral" as const;
}

function statusLabel(
  status: QueryServiceStatus,
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(`services.status.${status}`);
}

function isServiceDocument(
  document: WorkbenchDocument,
): document is ServiceDocument {
  return (
    document.kind === "data" ||
    document.kind === "sql" ||
    document.kind === "documents"
  );
}

function sessionDuration(session: QueryServiceSession) {
  if (session.result.kind === "materialized") {
    return session.result.outcome.result?.durationMs ?? null;
  }
  if (session.result.kind === "stream") {
    return session.result.stream.durationMs;
  }
  if (session.result.kind === "script") {
    const durations = session.result.outcome.statements.flatMap((statement) =>
      statement.result ? [statement.result.durationMs] : [],
    );
    return durations.length > 0
      ? durations.reduce((total, duration) => total + duration, 0)
      : null;
  }
  return null;
}

function sessionResultLabel(
  session: QueryServiceSession,
  connection: ConnectionProfile | null,
) {
  const tabular =
    (session.result.kind === "materialized" &&
      session.result.outcome.result !== null) ||
    session.result.kind === "stream";
  if (!tabular) return null;
  return (
    sqlResultLabel(session, session.sql, connection) ?? session.consoleTitle
  );
}

function sessionResultTabs(
  session: QueryServiceSession,
  connection: ConnectionProfile | null,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (session.result.kind === "script") {
    const resultLabels = session.result.outcome.statements.map((statement) =>
      sqlResultLabel(session, statement.sql, connection),
    );
    const duplicateLabels = new Set(
      resultLabels.filter(
        (label, index) =>
          label !== null && resultLabels.indexOf(label) !== index,
      ),
    );
    const statements = resultLabels.map((label, index) => ({
      id: `statement:${index}`,
      label:
        label && !duplicateLabels.has(label)
          ? label
          : t("services.resultNumber", { number: index + 1 }),
      statementIndex: index,
    }));
    if (statements.length > 0) return statements;
  }
  return [
    {
      id: "result",
      label: sessionResultLabel(session, connection) ?? t("services.resultTab"),
      statementIndex: undefined,
    },
  ];
}

function sqlResultLabel(
  session: QueryServiceSession,
  sql: string,
  connection: ConnectionProfile | null,
) {
  const source =
    /\bfrom\s+([A-Za-z_][\w$]*)(?:\s*\.\s*([A-Za-z_][\w$]*))?/i.exec(sql);
  if (!source) return null;
  if (source[2]) return `${source[1]}.${source[2]}`;
  const target = [session.database, session.namespace]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(".");
  return target
    ? `${target}.${source[1]}`
    : connection?.engine === "sqlite"
      ? `main.${source[1]}`
      : source[1];
}
