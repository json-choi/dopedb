// Bounded desktop stream projection. The grid and exports consume the immutable
// chunk source directly; this component never flattens a partial result.
import { useMemo, useState } from "react";

import { type SqlStreamViewState } from "../queries/domain";
import {
  collectCachedSqlResultRows,
  collectCachedSqlResultUnreadable,
  SQL_RESULT_CACHE_MAX_PAGES,
} from "../queries/resultPageCache";
import { remapUnreadableCells } from "../queryResults/cellReadState";
import { useSqlResultPages } from "../queries/useSqlResultPages";
import DataGrid from "../queryResults/DataGrid";
import {
  ResultWorkbenchFooter,
  ResultWorkbenchToolbar,
  resultCellText,
} from "../queryResults/ResultWorkbench";
import {
  ResultMeta,
  SqlSnippet,
  WorkbenchContainedBody,
} from "../../design-system/components/Workbench";
import type { JsonValue, UnreadableCell } from "../../ipc/types";
import { stamp } from "../../lib/export";
import { useI18n } from "../../lib/i18n";

export default function StreamOutcome({
  stream,
  sql,
  maxRows,
}: {
  stream: SqlStreamViewState;
  sql: string;
  maxRows: number;
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
  const filterableUnreadable = partial
    ? null
    : collectCachedSqlResultUnreadable(stream.rowSource);
  // Filtering renumbers rows, so the read-failure coordinates are re-addressed in
  // the same pass; a stale coordinate would mark a different row's cell unread.
  const filtered = useMemo<{
    rows: JsonValue[][];
    unreadable: UnreadableCell[];
  } | null>(() => {
    if (!filterableRows || !normalizedFilter) return null;
    const rows: JsonValue[][] = [];
    const keptRows: number[] = [];
    filterableRows.forEach((row, index) => {
      if (
        row.some((value) =>
          resultCellText(value).toLocaleLowerCase().includes(normalizedFilter),
        )
      ) {
        rows.push([...row] as JsonValue[]);
        keptRows.push(index);
      }
    });
    return {
      rows,
      unreadable: remapUnreadableCells(filterableUnreadable ?? [], keptRows),
    };
  }, [filterableRows, filterableUnreadable, normalizedFilter]);
  const filteredRows = filtered?.rows ?? null;
  // The grid treats a new result object as a new result, so this identity must
  // change when the rows do and not on every render.
  const gridResult = useMemo(
    () => ({
      columns: stream.columns,
      rows: filteredRows ?? [],
      rowCount: filteredRows?.length ?? stream.rowCount,
      truncated: stream.truncated,
      durationMs: stream.durationMs ?? 0,
      unreadableCells: filtered?.unreadable ?? [],
    }),
    [
      filtered,
      filteredRows,
      stream.columns,
      stream.durationMs,
      stream.rowCount,
      stream.truncated,
    ],
  );
  const phaseLabel =
    stream.phase === "cancelled"
      ? t("sql.cancelled")
      : stream.phase === "outcome_unknown"
        ? t("common.unknown")
        : stream.phase === "error"
          ? (stream.error ?? t("sql.errorTitle"))
          : t("sql.running");

  return (
    <WorkbenchContainedBody aria-live="polite">
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
            rowSource={filteredRows === null ? stream.rowSource : undefined}
            filenameBase={`query-${stamp()}`}
            partial={partial}
            unreadableCells={stream.unreadableCells}
            filterOpen={filterOpen}
            filter={filter}
            filterDisabled={partial || filterableRows === null}
            onToggleFilter={() => {
              setFilterOpen((open) => !open);
              if (filterOpen) setFilter("");
            }}
            onFilterChange={setFilter}
          />
          <DataGrid
            result={gridResult}
            rowSource={filteredRows === null ? stream.rowSource : undefined}
            surface="workbench"
            footerInset
          />
          <ResultWorkbenchFooter
            visible={filteredRows?.length ?? stream.rowCount}
            total={stream.rowCount}
            duration={stream.durationMs}
            state={phaseLabel}
            truncated={stream.truncated}
            maxRows={maxRows}
          />
        </>
      )}
    </WorkbenchContainedBody>
  );
}
