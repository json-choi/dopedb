// Bounded desktop stream projection. The grid and exports consume the immutable
// chunk source directly; this component never flattens a partial result. A small
// polite live region announces the outcome instead of the whole grid being live.
import { DataGridStatusScope } from "../../design-system/components/DataGridStatusScope";
import { useMemo, useState } from "react";

import { type SqlStreamViewState } from "../queries/domain";
import {
  collectCachedSqlResultDecodeFailures,
  collectCachedSqlResultRows,
  SQL_RESULT_CACHE_MAX_PAGES,
} from "../queries/resultPageCache";
import { readsOidAliases } from "../queries/sqlWorkbenchModel";
import { useSqlResultPages } from "../queries/useSqlResultPages";
import InspectableResultGrid from "../queryResults/InspectableResultGrid";
import {
  ResultWorkbenchFooter,
  ResultWorkbenchToolbar,
} from "../queryResults/ResultWorkbench";
import { gridCellText } from "../queryResults/dataGridSelection";
import {
  ResultMeta,
  SqlSnippet,
  WorkbenchContainedBody,
} from "../../design-system/components/Workbench";
import type { JsonValue } from "../../ipc/types";
import { remapDecodeFailures } from "../queryResults/decodeFailures";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";

export default function StreamOutcome({
  stream,
  sql,
  maxRows,
  onRerun,
}: {
  stream: SqlStreamViewState;
  sql: string;
  maxRows: number;
  /** Re-runs the query when its stored rows can no longer be read back. */
  onRerun?: () => void;
}) {
  const { t } = useI18n();
  const running = stream.phase === "connecting" || stream.phase === "streaming";
  const partial = stream.phase !== "complete";
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRowLimit = stream.rowSource.pageRows * SQL_RESULT_CACHE_MAX_PAGES;
  useSqlResultPages(
    stream.rowSource,
    0,
    stream.rowCount <= filterRowLimit ? stream.rowCount : 0,
    stream.columns,
  );
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  // The page cache is an external bounded store. The page hook triggers this
  // render when async reads land, so this lookup must not be memoized only by
  // the stable result handle.
  const filterableRows = partial
    ? null
    : collectCachedSqlResultRows(stream.rowSource);
  const filteredResult = useMemo<{
    rows: JsonValue[][];
    sourceRows: number[];
  } | null>(() => {
    if (!filterableRows || !normalizedFilter) return null;
    const rows: JsonValue[][] = [];
    const sourceRows: number[] = [];
    for (const [index, row] of filterableRows.entries()) {
      if (
        row.some((value) =>
          gridCellText(value).toLocaleLowerCase().includes(normalizedFilter),
        )
      ) {
        rows.push([...row] as JsonValue[]);
        sourceRows.push(index);
      }
    }
    return { rows, sourceRows };
  }, [filterableRows, normalizedFilter]);
  const filteredRows = filteredResult?.rows ?? null;
  const filteredDecodeFailures = filteredResult
    ? remapDecodeFailures(
        collectCachedSqlResultDecodeFailures(stream.rowSource),
        filteredResult.sourceRows,
      )
    : undefined;
  const phaseLabel =
    stream.phase === "cancelled"
      ? t("sql.cancelled")
      : stream.phase === "outcome_unknown"
        ? t("sql.outcomeUnknownShort")
        : stream.phase === "error"
          ? t("sql.errorTitle")
          : t("sql.running");
  const filterDisabledReason = partial
    ? t("results.filterUnavailablePartial")
    : stream.rowCount > filterRowLimit
      ? t("results.filterUnavailableLarge", { count: filterRowLimit })
      : undefined;
  const announcement =
    stream.phase === "complete"
      ? t("results.liveComplete", {
          count: stream.rowCount,
          duration: stream.durationMs ?? 0,
        })
      : stream.phase === "cancelled"
        ? t("sql.cancelled")
        : stream.phase === "error" || stream.phase === "outcome_unknown"
          ? t("results.liveFailed")
          : "";

  return (
    <DataGridStatusScope>
      <span className="tw:sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <WorkbenchContainedBody>
        {stream.columns.length === 0 ? (
          <ResultMeta>
            <SqlSnippet>{sql}</SqlSnippet>
            {" · "}
            {running ? t("sql.running") : phaseLabel}
          </ResultMeta>
        ) : (
          <>
            <ResultWorkbenchToolbar
              columns={stream.columns}
              rows={filteredRows ?? undefined}
              decodeFailures={filteredDecodeFailures}
              rowSource={filteredRows === null ? stream.rowSource : undefined}
              filenameBase={`query-${stamp()}`}
              partial={partial}
              filterOpen={filterOpen}
              filter={filter}
              filterDisabled={partial || filterableRows === null}
              filterDisabledReason={filterDisabledReason}
              onToggleFilter={() => {
                setFilterOpen((open) => !open);
                if (filterOpen) setFilter("");
              }}
              onFilterChange={setFilter}
            />
            <InspectableResultGrid
              result={{
                columns: stream.columns,
                rows: filteredRows ?? [],
                decodeFailures: filteredDecodeFailures,
                rowCount: filteredRows?.length ?? stream.rowCount,
                truncated: stream.truncated,
                durationMs: stream.durationMs ?? 0,
              }}
              inspectionKey={stream}
              rowSource={filteredRows === null ? stream.rowSource : undefined}
              surface="workbench"
              footerInset
              onRerun={onRerun}
            />
            <ResultWorkbenchFooter
              visible={filteredRows?.length ?? stream.rowCount}
              total={stream.rowCount}
              onClearFilter={filteredRows !== null ? () => setFilter("") : undefined}
              duration={stream.durationMs}
              state={phaseLabel}
              truncated={stream.truncated}
              maxRows={maxRows}
              hint={readsOidAliases(sql) ? t("results.oidAliasHint") : undefined}
            />
          </>
        )}
      </WorkbenchContainedBody>
    </DataGridStatusScope>
  );
}
