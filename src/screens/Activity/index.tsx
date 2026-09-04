// Unified activity view. Lists use bounded metadata pages; exact SQL and audit
// bodies cross IPC only after the user selects one record.
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  type SyntheticEvent,
} from "react";
import { Icon, type IconName } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { Button } from "../../design-system/components/Button";
import {
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { WorkbenchPane } from "../../design-system/components/Workbench";
import type { ConnectionProfile } from "../../features/connections/domain";
import type {
  AuditCursor,
  AuditEntrySummary,
  HistoryCursor,
  HistoryPageRequest,
} from "../../ipc/types";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import type { I18nKey } from "../../lib/i18n";
import {
  auditEntryQuery,
  auditPageQuery,
  auditVerdictQuery,
  historyEntryQuery,
  historyQuery,
  qk,
} from "../../lib/queries";
import { fullTime, relTime } from "../../lib/relTime";

function duration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function firstLine(sql: string): string {
  const line = sql.trim().split("\n")[0];
  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

function statusIcon(status: string): IconName {
  if (status === "ok" || status === "success" || status === "done") return "check";
  if (status === "error" || status === "blocked" || status === "failed") return "alert";
  return "info";
}

function short(hash: string | null): string {
  if (!hash) return "∅";
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function actionTone(action: string) {
  const value = action.toLowerCase();
  if (value.includes("approve")) return "success";
  if (value.includes("execute")) return "primary";
  if (value.includes("reject") || value.includes("blocked")) return "danger";
  return "neutral";
}

function originTone(origin: string) {
  if (origin === "agent") return "primary";
  return "neutral";
}

function statusTone(status: string) {
  if (status === "ok" || status === "success" || status === "done") return "success";
  if (status === "error" || status === "blocked" || status === "failed") return "danger";
  return "neutral";
}

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

function queryKindLabel(t: Translate, kind: string) {
  if (kind === "read") return t("activity.kindRead");
  if (kind === "write") return t("activity.kindWrite");
  if (kind === "ddl") return t("activity.kindDdl");
  if (kind === "privilege") return t("activity.kindPrivilege");
  return t("activity.kindUnknown");
}

function activityStatusLabel(t: Translate, status: string) {
  if (status === "ok" || status === "success" || status === "done") {
    return t("activity.statusSucceeded");
  }
  if (status === "error" || status === "failed") {
    return t("activity.statusFailed");
  }
  if (status === "blocked") return t("activity.statusBlocked");
  if (status === "outcome_unknown") return t("activity.statusOutcomeUnknown");
  return t("activity.statusUnknown");
}

function activityOriginLabel(t: Translate, origin: string) {
  if (origin === "manual") return t("activity.originManual");
  if (origin === "agent") return t("activity.originAgent");
  if (origin === "analysis_article") return t("activity.originAnalysisArticle");
  if (origin === "table_editor") return t("activity.originTableEditor");
  if (origin === "cli") return t("activity.originCli");
  return t("activity.originOther");
}

function auditActionLabel(t: Translate, action: string) {
  const labels: Readonly<Record<string, I18nKey>> = {
    propose: "activity.actionPropose",
    approve: "activity.actionApprove",
    reject: "activity.actionReject",
    execute: "activity.actionExecute",
    "execute:attempt": "activity.actionExecuteAttempt",
    blocked: "activity.actionBlocked",
    error: "activity.actionError",
    read: "activity.actionRead",
    "script:execute": "activity.actionScriptExecute",
    "script:execute:attempt": "activity.actionScriptExecuteAttempt",
    "analysis_article:run": "activity.actionAnalysisRun",
  };
  const key = labels[action];
  return key ? t(key) : t("activity.actionOther");
}

function AuditRow({
  connectionId,
  entry,
  selected,
  tampered,
  onSelect,
}: {
  connectionId: string;
  entry: AuditEntrySummary;
  selected: boolean;
  tampered: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const detail = useQuery(auditEntryQuery(connectionId, selected ? entry.id : null));
  const exact = detail.data;

  return (
    <li
      data-tampered={tampered}
      className="tw:border-b tw:border-border-subtle tw:pb-2 tw:data-[tampered=true]:border-danger"
    >
      <button
        type="button"
        aria-expanded={selected}
        className="tw:grid tw:w-full tw:grid-cols-[var(--ds-icon-sm)_minmax(0,1fr)_auto] tw:items-start tw:gap-2 tw:rounded-sm tw:px-1 tw:py-1.5 tw:text-left tw:hover:bg-muted tw:focus-visible:outline-2 tw:focus-visible:outline-ring"
        onClick={onSelect}
      >
        <Icon
          name={tampered ? "alert" : "chevronRight"}
          className={selected && !tampered ? "tw:rotate-90" : tampered ? "tw:text-danger" : ""}
        />
        <span className="tw:grid tw:min-w-0 tw:gap-1">
          <span className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <span
              data-tone={actionTone(entry.action)}
              className="badge tw:normal-case tw:data-[tone=danger]:border-danger tw:data-[tone=danger]:text-danger tw:data-[tone=primary]:border-primary tw:data-[tone=primary]:text-primary tw:data-[tone=success]:border-success tw:data-[tone=success]:text-success"
            >
              {auditActionLabel(t, entry.action)}
            </span>
            {entry.kind.toLowerCase() !== entry.action.toLowerCase() && (
              <span className="badge kind">{queryKindLabel(t, entry.kind)}</span>
            )}
            {tampered && (
              <strong className="tw:text-danger">{t("activity.auditTampered")}</strong>
            )}
          </span>
          <code className="tw:block tw:overflow-hidden tw:font-mono tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
            {firstLine(entry.sqlPreview)}{entry.sqlTruncated ? "…" : ""}
          </code>
        </span>
        <span className="tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground" title={fullTime(entry.ts)}>
          {relTime(entry.ts)}
        </span>
      </button>

      {selected && (
        <div className="tw:ml-7 tw:grid tw:min-w-0 tw:gap-2 tw:px-1 tw:pt-2">
          {detail.isPending && <Skeleton lines={3} />}
          {detail.error && (
            <div className="tw:text-ui tw:text-danger">
              {t("activity.auditLoadError", { error: errMessage(detail.error) })}
            </div>
          )}
          {exact && (
            <>
              {exact.approvedBy && (
                <div className="tw:text-sm tw:text-muted-foreground">
                  {t("activity.auditBy", { name: exact.approvedBy })}
                </div>
              )}
              {exact.agentPrompt && (
                <div className="tw:break-words tw:text-sm tw:text-muted-foreground">
                  “{exact.agentPrompt}”
                </div>
              )}
              <code className="tw:block tw:max-h-48 tw:overflow-auto tw:rounded-sm tw:bg-muted tw:px-2 tw:py-1 tw:font-mono tw:text-sm tw:whitespace-pre-wrap tw:break-words">
                {exact.sql}
              </code>
              {exact.error && <div className="tw:text-ui tw:text-danger">{exact.error}</div>}
              <div className="tw:break-words tw:font-mono tw:text-xs tw:text-muted-foreground">
                <span title={exact.prevHash ?? ""}>
                  {t("activity.auditPrev", { hash: short(exact.prevHash) })}
                </span>
                {" → "}
                <span title={exact.hash}>
                  {t("activity.auditHash", { hash: short(exact.hash) })}
                </span>
                {exact.affectedEstimate !== null && (
                  <span>
                    {" · "}
                    {t("activity.auditRowsEstimate", { count: exact.affectedEstimate })}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function Activity({
  connection,
  onLoadSql,
}: {
  connection: ConnectionProfile;
  onLoadSql: (sql: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [historyCursors, setHistoryCursors] = useState<(HistoryCursor | null)[]>([null]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditWanted, setAuditWanted] = useState(false);
  const [auditCursors, setAuditCursors] = useState<(AuditCursor | null)[]>([null]);
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    setHistoryCursors([null]);
  }, [connection.id, debouncedText, statusFilter, originFilter]);

  useEffect(() => {
    setAuditCursors([null]);
    setSelectedAuditId(null);
  }, [connection.id]);

  const historyCursor = historyCursors[historyCursors.length - 1] ?? null;
  const historyRequest = useMemo<HistoryPageRequest>(() => ({
    connectionId: connection.id,
    cursor: historyCursor,
    search: debouncedText || null,
    status: statusFilter || null,
    origin: originFilter || null,
  }), [connection.id, debouncedText, historyCursor, originFilter, statusFilter]);
  const history = useQuery({
    ...historyQuery(historyRequest),
    placeholderData: keepPreviousData,
  });
  const verdictResult = useQuery(auditVerdictQuery(connection.id));
  const auditCursor = auditCursors[auditCursors.length - 1] ?? null;
  const audit = useQuery({
    ...auditPageQuery(connection.id, auditCursor, auditWanted),
    placeholderData: keepPreviousData,
  });
  const auditData = audit.data;
  const auditError = audit.error;
  const auditIsFetching = audit.isFetching;
  const auditIsPending = audit.isPending;
  const refetchAudit = audit.refetch;
  const verdictData = verdictResult.data;
  const verdictError = verdictResult.error;
  const verdictIsFetching = verdictResult.isFetching;
  const refetchVerdict = verdictResult.refetch;

  function refresh() {
    setHistoryCursors([null]);
    setAuditCursors([null]);
    setSelectedAuditId(null);
    void queryClient.invalidateQueries({ queryKey: qk.history(connection.id) });
    void queryClient.invalidateQueries({ queryKey: qk.audit(connection.id) });
  }

  function handleAuditToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const open = event.currentTarget.open;
    setAuditOpen(open);
    if (open) setAuditWanted(true);
  }

  async function load(historyId: string) {
    try {
      const detail = await queryClient.fetchQuery(historyEntryQuery(connection.id, historyId));
      onLoadSql(detail.sql);
      toast(t("activity.loaded"));
    } catch (error) {
      toast(t("activity.historyLoadError", { error: errMessage(error) }), "error");
    }
  }

  const page = history.data;
  const rows = page?.items ?? [];
  const auditPage = auditData;
  const auditEntries = auditPage?.items ?? [];
  const verdict = verdictData ?? null;
  const chainBroken = verdict !== null && !verdict.ok;
  const firstAuditPageMatchesVerdict =
    auditCursor !== null
    || !auditPage
    || !verdict
    || (auditEntries.length === 0
      ? verdict.entryCount === 0
      : verdict.tailHash === auditEntries[0]?.hash);
  const integrityError = verdictError ? errMessage(verdictError) : null;
  const tamperedEntry = verdict?.firstBadId
    ? auditEntries.find((entry) => entry.id === verdict.firstBadId) ?? null
    : null;
  const integrityTitle = integrityError
    ? t("activity.auditUnavailable")
    : verdict === null || !firstAuditPageMatchesVerdict
      ? t("activity.auditVerifying")
      : chainBroken
        ? tamperedEntry
          ? t("activity.auditChainBrokenAt", { time: relTime(tamperedEntry.ts) })
          : t("activity.auditChainBroken")
        : t("activity.auditVerified");
  const integrityDanger = Boolean(integrityError) || chainBroken;
  const integrityIcon: IconName = integrityDanger
    ? "alert"
    : verdict && firstAuditPageMatchesVerdict
      ? "check"
      : "info";
  const busy = history.isFetching || verdictIsFetching || auditIsFetching;
  const hasFilters = Boolean(debouncedText || statusFilter || originFilter);

  useEffect(() => {
    if (!auditOpen || firstAuditPageMatchesVerdict || auditIsFetching || verdictIsFetching) {
      return;
    }
    void Promise.all([refetchAudit(), refetchVerdict()]);
  }, [
    auditOpen,
    auditIsFetching,
    firstAuditPageMatchesVerdict,
    refetchAudit,
    refetchVerdict,
    verdictIsFetching,
  ]);

  return (
    <WorkbenchPane>
      <div className="tw:mx-auto tw:flex tw:min-h-0 tw:w-full tw:max-w-[1120px] tw:flex-1 tw:flex-col tw:overflow-auto">
        <details
          data-danger={integrityDanger}
          className="tw:group tw:shrink-0 tw:border-b tw:border-border-subtle tw:bg-background tw:data-[danger=true]:border-danger tw:data-[danger=true]:bg-danger-muted"
          open={auditOpen}
          onToggle={handleAuditToggle}
        >
          <summary
            id="activity-audit-summary"
            className="tw:grid tw:min-h-workbench-toolbar tw:cursor-pointer tw:list-none tw:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:px-3 tw:py-1 tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-ring tw:[&::-webkit-details-marker]:hidden tw:max-[760px]:grid-cols-[var(--ds-icon-md)_minmax(0,1fr)]"
          >
            <Icon name={integrityIcon} data-danger={integrityDanger} className="tw:text-primary tw:data-[danger=true]:text-danger" />
            <span className="tw:grid tw:min-w-0">
              <strong className="tw:text-sm tw:leading-ui tw:text-foreground" role={integrityDanger ? "alert" : "status"} aria-live="polite">
                {integrityTitle}
              </strong>
              {integrityError && (
                <span className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
                  {t("activity.auditVerifyError", { error: integrityError })}
                </span>
              )}
            </span>
            <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:whitespace-nowrap tw:text-muted-foreground tw:max-[760px]:col-start-2">
              {verdict
                ? t("activity.auditDetailsCount", { count: verdict.entryCount })
                : t("activity.auditDetails")}
              <Icon name="chevronRight" className="tw:transition-transform tw:group-open:rotate-90" />
            </span>
          </summary>

          <section
            className="tw:grid tw:max-h-[min(52vh,520px)] tw:gap-3 tw:overflow-y-auto tw:border-t tw:border-border-subtle tw:bg-background tw:p-3 tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-ring"
            role="region"
            aria-labelledby="activity-audit-summary"
            tabIndex={0}
          >
            <div className="tw:grid tw:min-w-0 tw:gap-1 tw:[&>*]:m-0">
              <h3>{t("activity.auditTitle")}</h3>
              <p className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
                {t("activity.auditRecordsDescription")}
              </p>
            </div>
            {auditError && (
              <div className="tw:text-ui tw:text-danger">
                {t("activity.auditLoadError", { error: errMessage(auditError) })}
              </div>
            )}
            {auditIsPending && <Skeleton lines={4} />}
            {!auditIsPending && !auditError && auditEntries.length === 0 && (
              <div className="tw:text-ui tw:leading-relaxed tw:text-muted-foreground">
                {t("activity.auditEmpty")}
              </div>
            )}
            {auditEntries.length > 0 && (
              <ul className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-2 tw:p-0">
                {auditEntries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    connectionId={connection.id}
                    entry={entry}
                    selected={selectedAuditId === entry.id}
                    tampered={verdict?.firstBadId === entry.id}
                    onSelect={() => setSelectedAuditId((current) => current === entry.id ? null : entry.id)}
                  />
                ))}
              </ul>
            )}
            {(auditCursors.length > 1 || auditPage?.nextCursor) && (
              <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
                <Button
                  type="button"
                  size="compact"
                  disabled={auditCursors.length <= 1 || auditIsFetching}
                  onClick={() => {
                    setSelectedAuditId(null);
                    setAuditCursors((current) => current.slice(0, -1));
                  }}
                >
                  {t("common.prev")}
                </Button>
                <Button
                  type="button"
                  size="compact"
                  disabled={!auditPage?.nextCursor || auditIsFetching}
                  onClick={() => {
                    if (!auditPage?.nextCursor) return;
                    setSelectedAuditId(null);
                    setAuditCursors((current) => [...current, auditPage.nextCursor]);
                  }}
                >
                  {t("common.next")}
                </Button>
              </div>
            )}
          </section>
        </details>

        <section className="tw:grid tw:min-w-0 tw:gap-3 tw:p-3" aria-labelledby="activity-query-title">
          <div className="tw:flex tw:items-start tw:justify-between tw:gap-3">
            <div className="tw:grid tw:min-w-0 tw:gap-1 tw:[&>*]:m-0">
              <h3 id="activity-query-title">{t("activity.queries")}</h3>
              <p className="tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
                {t("activity.queriesDescription")}
              </p>
            </div>
            <Button
              type="button"
              size="compact"
              onClick={refresh}
              disabled={busy}
              aria-busy={busy}
            >
              <Icon
                name="refresh"
                data-loading={busy || undefined}
                className="tw:data-[loading=true]:animate-spin tw:motion-reduce:animate-none"
              />
              {busy ? t("common.refreshing") : t("common.refresh")}
            </Button>
          </div>

          {(page || hasFilters) && (
            <div className="tw:flex tw:items-center tw:gap-2 tw:max-[760px]:flex-col tw:max-[760px]:items-stretch">
              <span className="tw:min-w-0 tw:flex-1">
                <TextInput
                  density="compact"
                  type="search"
                  placeholder={t("activity.filterSql")}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </span>
              <span className="tw:min-w-[140px]">
                <SelectInput
                  density="compact"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label={t("activity.allStatuses")}
                >
                  <option value="">{t("activity.allStatuses")}</option>
                  {page?.statuses.map((status) => (
                    <option key={status} value={status}>
                      {activityStatusLabel(t, status)}
                    </option>
                  ))}
                </SelectInput>
              </span>
              <span className="tw:min-w-[140px]">
                <SelectInput
                  density="compact"
                  value={originFilter}
                  onChange={(event) => setOriginFilter(event.target.value)}
                  aria-label={t("activity.allOrigins")}
                >
                  <option value="">{t("activity.allOrigins")}</option>
                  {page?.origins.map((origin) => (
                    <option key={origin} value={origin}>
                      {activityOriginLabel(t, origin)}
                    </option>
                  ))}
                </SelectInput>
              </span>
            </div>
          )}

          {history.error && (
            <div className="tw:text-ui tw:text-danger">
              {t("activity.historyLoadError", { error: errMessage(history.error) })}
            </div>
          )}
          {history.isPending && <Skeleton lines={5} />}
          {!history.isPending && !history.error && rows.length === 0 && (
            <div className="tw:text-ui tw:leading-relaxed tw:text-muted-foreground">
              {hasFilters
                ? t("activity.noMatches")
                : t("activity.empty", { name: connection.name || t("app.thisConnection") })}
            </div>
          )}

          {rows.length > 0 && (
            <div className="tw:min-w-0 tw:overflow-x-auto">
              <table className="tw:w-full tw:border-collapse tw:text-ui tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:px-3 tw:[&_th]:py-2 tw:[&_th]:text-left tw:[&_th]:text-xs tw:[&_th]:font-semibold tw:[&_th]:tracking-[0.04em] tw:[&_th]:whitespace-nowrap tw:[&_th]:text-muted-foreground tw:[&_th]:uppercase tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:px-3 tw:[&_td]:py-2 tw:[&_td]:align-middle tw:[&_.num]:text-right tw:max-[760px]:min-w-[720px]">
                <thead>
                  <tr>
                    <th>{t("activity.executed")}</th>
                    <th>{t("activity.origin")}</th>
                    <th>{t("activity.kind")}</th>
                    <th>{t("activity.status")}</th>
                    <th className="num">{t("activity.rows")}</th>
                    <th className="num">{t("activity.duration")}</th>
                    <th>{t("activity.sql")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="tw:cursor-pointer tw:hover:bg-muted tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-ring"
                      role="button"
                      tabIndex={0}
                      onClick={() => void load(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void load(row.id);
                        }
                      }}
                      title={t("activity.loadTitle")}
                    >
                      <td className="tw:whitespace-nowrap tw:text-muted-foreground" title={fullTime(row.executedAt)}>{relTime(row.executedAt)}</td>
                      <td>
                        <span data-tone={originTone(row.origin)} className="badge tw:data-[tone=primary]:border-primary tw:data-[tone=primary]:text-primary tw:data-[tone=warning]:border-warning tw:data-[tone=warning]:text-warning">{activityOriginLabel(t, row.origin)}</span>
                      </td>
                      <td><span className="badge kind">{queryKindLabel(t, row.kind)}</span></td>
                      <td>
                        <span
                          data-tone={statusTone(row.status)}
                          className="badge icon-only-badge tw:data-[tone=danger]:border-danger tw:data-[tone=danger]:text-danger tw:data-[tone=success]:border-success tw:data-[tone=success]:text-success"
                          title={row.errorPreview ? `${activityStatusLabel(t, row.status)}: ${row.errorPreview}` : activityStatusLabel(t, row.status)}
                          aria-label={row.errorPreview ? `${activityStatusLabel(t, row.status)}: ${row.errorPreview}` : activityStatusLabel(t, row.status)}
                          role="img"
                        >
                          <Icon name={statusIcon(row.status)} />
                        </span>
                      </td>
                      <td className="num">{row.rowCount ?? "—"}</td>
                      <td className="num">{duration(row.durationMs)}</td>
                      <td className="tw:w-full tw:max-w-0" title={row.sqlPreview}>
                        <code className="tw:block tw:overflow-hidden tw:font-mono tw:text-sm tw:text-ellipsis tw:whitespace-nowrap">
                          {firstLine(row.sqlPreview)}{row.sqlTruncated ? "…" : ""}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(historyCursors.length > 1 || page?.nextCursor) && (
            <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
              <span className="tw:mr-auto tw:text-xs tw:text-muted-foreground">
                {t("activity.pageRows", { count: rows.length })}
              </span>
              <Button
                type="button"
                size="compact"
                disabled={historyCursors.length <= 1 || history.isFetching}
                onClick={() => setHistoryCursors((current) => current.slice(0, -1))}
              >
                {t("common.prev")}
              </Button>
              <Button
                type="button"
                size="compact"
                disabled={!page?.nextCursor || history.isFetching}
                onClick={() => {
                  if (page?.nextCursor) setHistoryCursors((current) => [...current, page.nextCursor]);
                }}
              >
                {t("common.next")}
              </Button>
            </div>
          )}
        </section>
      </div>
    </WorkbenchPane>
  );
}
