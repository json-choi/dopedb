// Unified activity view. Lists use bounded metadata pages; exact SQL and audit
// bodies cross IPC only after the user selects one record. Every status, origin,
// and action is projected through closed catalog labels, never raw wire values.
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import Skeleton from "../../components/Skeleton";
import { Button } from "../../design-system/components/Button";
import { StatusBadge } from "../../design-system/components/Status";
import {
  SelectInput,
  TextInput,
} from "../../design-system/components/FormControls";
import { WorkbenchPane } from "../../design-system/components/Workbench";
import type { ConnectionProfile } from "../../features/connections/domain";
import type {
  HistoryCursor,
  HistoryEntryDetail,
  HistoryEntrySummary,
  HistoryPageRequest,
} from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import {
  historyEntryQuery,
  historyQuery,
  qk,
} from "../../lib/queries";
import { fullTime, relTime } from "../../lib/relTime";
import AuditTrail from "./AuditTrail";
import {
  activityOriginLabel,
  historyStatusView,
  queryKindLabel,
  sqlFirstLine,
  type Translate,
} from "./activityLabels";

function duration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function HistoryStatus({ t, row }: { t: Translate; row: HistoryEntrySummary }) {
  const view = historyStatusView(t, row.status, row.kind);
  // The recorded database/driver message is evidence, so it stays verbatim but is
  // labeled as such instead of becoming the status copy itself.
  const recorded = row.errorPreview
    ? `${t("activity.auditRecordedError")}: ${row.errorPreview}${row.errorTruncated ? "…" : ""}`
    : undefined;
  return (
    <span className="tw:grid tw:min-w-0 tw:justify-items-start tw:gap-1" title={recorded}>
      <StatusBadge tone={view.tone}>
        <Icon name={view.icon} />
        {view.label}
      </StatusBadge>
      {view.detail ? (
        <span
          data-tone={view.tone}
          className="tw:max-w-[220px] tw:text-xs tw:leading-ui tw:text-muted-foreground tw:data-[tone=warning]:text-warning"
        >
          {view.detail}
        </span>
      ) : null}
    </span>
  );
}

export default function Activity({
  connection,
  onLoadSql,
}: {
  connection: ConnectionProfile;
  /** Opens the exact recorded statement; the entry lets it reopen in its run's target. */
  onLoadSql: (entry: HistoryEntryDetail) => void | Promise<void>;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [historyCursors, setHistoryCursors] = useState<(HistoryCursor | null)[]>([null]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailedId, setOpenFailedId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    setHistoryCursors([null]);
    setOpenFailedId(null);
  }, [connection.id, debouncedText, statusFilter, originFilter]);

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
  // Rust returns the connection-wide filter facets only with a first page, so keep
  // the latest first-page facets while the reader pages further back.
  const [facets, setFacets] = useState<{
    connectionId: string;
    statuses: readonly string[];
    origins: readonly string[];
  } | null>(null);
  const page = history.data;
  useEffect(() => {
    if (!page || historyCursor !== null || history.isPlaceholderData) return;
    setFacets({ connectionId: connection.id, statuses: page.statuses, origins: page.origins });
  }, [connection.id, history.isPlaceholderData, historyCursor, page]);
  const statusFacets = facets?.connectionId === connection.id ? facets.statuses : [];
  const originFacets = facets?.connectionId === connection.id ? facets.origins : [];

  function refresh() {
    setHistoryCursors([null]);
    setOpenFailedId(null);
    void queryClient.invalidateQueries({ queryKey: qk.history(connection.id) });
  }

  // Opening resolves only after the SQL document exists, so the row keeps its own
  // pending state instead of announcing success before the editor is ready.
  async function openStatement(historyId: string) {
    if (openingId) return;
    setOpeningId(historyId);
    setOpenFailedId(null);
    try {
      const detail = await queryClient.fetchQuery(historyEntryQuery(connection.id, historyId));
      await onLoadSql(detail);
    } catch {
      setOpenFailedId(historyId);
    } finally {
      setOpeningId(null);
    }
  }

  const rows = page?.items ?? [];
  const busy = history.isFetching;
  const hasFilters = Boolean(debouncedText || statusFilter || originFilter);

  return (
    <WorkbenchPane>
      <div className="tw:mx-auto tw:flex tw:min-h-0 tw:w-full tw:max-w-[1120px] tw:flex-1 tw:flex-col tw:overflow-auto">
        <AuditTrail key={connection.id} connectionId={connection.id} />

        <section className="tw:grid tw:min-w-0 tw:gap-3 tw:p-3" aria-labelledby="activity-query-title">
          <div className="tw:flex tw:items-start tw:justify-between tw:gap-3">
            <div className="tw:grid tw:min-w-0 tw:gap-1 tw:[&>*]:m-0">
              <h2 id="activity-query-title" className="tw:text-title tw:font-semibold">{t("activity.queries")}</h2>
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
                  {statusFacets.map((status) => (
                    <option key={status} value={status}>
                      {historyStatusView(t, status, "").label}
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
                  {originFacets.map((origin) => (
                    <option key={origin} value={origin}>
                      {activityOriginLabel(t, origin)}
                    </option>
                  ))}
                </SelectInput>
              </span>
            </div>
          )}

          {history.error ? (
            <p role="alert" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-ui tw:text-danger">
              {t("activity.historyLoadError")}
              <Button size="xs" onClick={() => void history.refetch()}>{t("activity.retry")}</Button>
            </p>
          ) : null}
          {openFailedId ? (
            <p role="alert" className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-ui tw:text-danger">
              {t("activity.historyEntryLoadError")}
              <Button size="xs" onClick={() => void openStatement(openFailedId)}>{t("activity.retry")}</Button>
            </p>
          ) : null}
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
                  {rows.map((row) => {
                    const statement = sqlFirstLine(row.sqlPreview, row.sqlTruncated);
                    const opening = openingId === row.id;
                    return (
                      <tr key={row.id} data-failed={openFailedId === row.id} className="tw:hover:bg-muted tw:data-[failed=true]:bg-danger-muted">
                        <td className="tw:whitespace-nowrap tw:text-muted-foreground">
                          <time dateTime={row.executedAt} title={fullTime(row.executedAt, lang)}>
                            {relTime(row.executedAt, lang)}
                          </time>
                        </td>
                        <td>
                          <StatusBadge>{activityOriginLabel(t, row.origin)}</StatusBadge>
                        </td>
                        <td><span className="badge kind">{queryKindLabel(t, row.kind)}</span></td>
                        <td><HistoryStatus t={t} row={row} /></td>
                        <td className="num">{row.rowCount ?? "—"}</td>
                        <td className="num">{duration(row.durationMs)}</td>
                        <td className="tw:w-full tw:max-w-0">
                          <Button
                            presentation="listItem"
                            variant="ghost"
                            size="compact"
                            disabledBehavior="focusable"
                            disabled={openingId !== null}
                            aria-busy={opening}
                            aria-label={t("activity.openStatement", { sql: statement })}
                            title={row.sqlPreview}
                            onClick={() => void openStatement(row.id)}
                          >
                            {opening ? <Icon name="refresh" className="tw:animate-spin tw:motion-reduce:animate-none" /> : null}
                            <code className="tw:block tw:min-w-0 tw:truncate tw:font-mono tw:text-sm tw:font-normal">
                              {statement}
                            </code>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
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
