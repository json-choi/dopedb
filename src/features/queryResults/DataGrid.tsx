// Shared results table. Renders whatever rows it's handed (callers window/cap first).
// Sticky header + row numbers + null styling. All interactivity is opt-in via callbacks
// so plain read-only callers (SQL, document, and Analysis Article results) render unchanged:
//   - onSort     → clickable headers that cycle asc/desc/none (arrow on the sorted col)
//   - onFilter   → compact value/count popup from a header filter action
//   - onSelectRow/onCellClick → row highlight + click-to-open a cell in the side viewer
//   - startIndex → row numbers continue across pages (rows 101-200, not 1-100 again)
// A cell the backend could not decode is never rendered or copied as a value: both
// renderers read its state from `cellReadState` and refuse the copy instead.
// Columns are drag-resizable: first drag snapshots every rendered width so only the
// dragged column moves. Double-click resets the compact default widths.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { QueryResult } from "../../ipc/types";
import type { GridSort } from "../../lib/sqlBuild";
import type { SqlStreamRowSource } from "../queries/domain";
import {
  DATA_GRID_DEFAULT_COLUMN_WIDTH,
  DATA_GRID_HEADER_HEIGHT,
  DATA_GRID_ROW_HEIGHT,
  DATA_GRID_ROW_NUMBER_WIDTH,
} from "../../design-system/dataGridGeometry";
import {
  DataGridNotice,
  DataGridViewport,
  type DataGridSurface,
} from "../../design-system/components/DataGridViewport";
import { ResizeSeparator } from "../../design-system/components/ResizeSeparator";
import { Icon } from "../../components/Icon";
import DataGridColumnFilterMenu from "./DataGridColumnFilterMenu";
import DataGridVirtual from "./DataGridVirtual";
import { useI18n } from "../../lib/i18n";
import {
  extendGridSelection,
  gridSelectionBounds,
  gridSelectionClipboardText,
  gridSelectionIncludes,
  singleGridCell,
  type GridCellSelection,
} from "./dataGridSelection";
import {
  dataGridKeyboardTarget,
  type DataGridFocus,
} from "./dataGridKeyboard";
import {
  unreadableCellLookup,
  type UnreadableCellLookup,
} from "./cellReadState";
import { numericGridColumns } from "./numericColumns";
import { useDataGridSelectionReset } from "./useDataGridSelectionReset";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Clipboard text for a selected cell — same rules as CellViewer's Copy:
// null/undefined → "NULL", objects → pretty JSON, JSON-string → pretty JSON, else String.
function copyText(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  const s = String(v);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(s);
      if (p && typeof p === "object") return JSON.stringify(p, null, 2);
    } catch {
      /* not JSON — plain text */
    }
  }
  return s;
}

type DataGridProps = {
  result: QueryResult;
  startIndex?: number;
  sort?: GridSort | null;
  onSort?: (col: string) => void;
  filters?: Record<string, string>;
  onFilter?: (col: string, value: string) => void;
  selectedRow?: number | null;
  onSelectRow?: (i: number) => void;
  onCellClick?: (value: unknown, rowIndex: number, col: string) => void;
  columnMeta?: Record<string, { dataType: string; pk: boolean }>;
  /** A chunked streaming source; rows are never flattened for the grid. */
  rowSource?: SqlStreamRowSource;
  /** Flush workbench grids fill their pane without a card border or radius. */
  surface?: DataGridSurface;
  /** Reserve scrollable room beneath a floating workbench status footer. */
  footerInset?: boolean;
};

export function shouldVirtualizeDataGrid(
  result: QueryResult,
  rowSource?: SqlStreamRowSource,
) {
  return !!rowSource || result.rows.length > 200 || result.columns.length > 18;
}

export default function DataGrid(props: DataGridProps) {
  // This wrapper must stay O(columns). In particular, do not add table-only
  // scans here: virtual results may carry 50k × 50 rows.
  const shouldVirtualize = shouldVirtualizeDataGrid(
    props.result,
    props.rowSource,
  );
  if (shouldVirtualize) {
    return (
      <DataGridVirtual
        result={props.result}
        startIndex={props.startIndex ?? 0}
        sort={props.sort}
        onSort={props.onSort}
        filters={props.filters}
        onFilter={props.onFilter}
        selectedRow={props.selectedRow}
        onSelectRow={props.onSelectRow}
        onCellClick={props.onCellClick}
        columnMeta={props.columnMeta}
        rowSource={props.rowSource}
        surface={props.surface}
        footerInset={props.footerInset}
      />
    );
  }
  return <DataGridTable {...props} />;
}

function DataGridTable({
  result,
  startIndex = 0,
  sort,
  onSort,
  filters,
  onFilter,
  selectedRow,
  onSelectRow,
  onCellClick,
  columnMeta,
  rowSource: _rowSource,
  surface,
  footerInset,
}: DataGridProps) {
  const { t } = useI18n();
  const interactive = !!onSelectRow || !!onCellClick;
  // Column widths keyed by header-cell index (0 = rownum).
  const [widths, setWidths] = useState<Record<number, number>>({});
  // Selected cell (click to select, ⌘C to copy, Esc to clear). Independent of onCellClick.
  const [sel, setSel] = useState<GridCellSelection | null>(null);
  const [focus, setFocus] = useState<DataGridFocus>({ row: 0, column: 0 });
  const [copyBlocked, setCopyBlocked] = useState(false);
  const focusRequestedRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const sig = result.columns.join(" ");
  useEffect(() => {
    setWidths({}); // new column set → stale widths dropped
  }, [sig]);
  useDataGridSelectionReset(
    { result, operationId: null, columnKey: sig, startIndex },
    () => {
      setSel(null);
      setFocus({ row: 0, column: 0 });
      setCopyBlocked(false);
    },
  );
  useEffect(() => {
    if (!focusRequestedRef.current) return;
    focusRequestedRef.current = false;
    const target = tableRef.current?.querySelector<HTMLElement>(
      `[data-grid-focus="${focus.row}:${focus.column}"]`,
    );
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);
  // Read state travels with the exact result, so re-indexing it per result keeps a
  // stale coordinate from ever describing a different page's cell.
  const unreadable: UnreadableCellLookup = useMemo(
    () => unreadableCellLookup(result.unreadableCells),
    [result],
  );
  const resized = Object.keys(widths).length > 0;
  const columnWidths = [
    widths[0] ?? DATA_GRID_ROW_NUMBER_WIDTH,
    ...result.columns.map(
      (_, index) => widths[index + 1] ?? DATA_GRID_DEFAULT_COLUMN_WIDTH,
    ),
  ];
  const totalW = columnWidths.reduce((total, width) => total + width, 0);

  // Right-align numeric columns from the shared judgement the virtual renderer
  // uses, so the same column is aligned identically in both grids.
  const numericCols = useMemo(
    () => numericGridColumns(result.columns.length, result.rows),
    [result],
  );

  function startResize(
    e: { preventDefault(): void; stopPropagation(): void; clientX: number },
    colIdx: number,
  ) {
    e.preventDefault();
    e.stopPropagation(); // don't trigger the sort click on the header
    const table = tableRef.current;
    if (!table) return;
    const ths = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child th"),
    );
    const snap: Record<number, number> = { ...widths };
    ths.forEach((th, i) => {
      if (snap[i] == null) snap[i] = th.offsetWidth;
    });
    const startX = e.clientX;
    const startW = snap[colIdx];
    // Coalesce mousemoves to one setWidths per frame — reconciling the whole tbody
    // on every pointer event churns badly on large result sets.
    let raf = 0;
    let pendingW = startW;
    const flush = () => {
      raf = 0;
      setWidths({ ...snap, [colIdx]: pendingW });
    };
    const move = (ev: MouseEvent) => {
      pendingW = Math.min(1200, Math.max(50, startW + ev.clientX - startX));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      flush(); // commit the final position (a queued frame may not have run)
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  // Click and Enter (see below) both land here so keyboard nav opens the same viewer a click does.
  function selectCell(i: number, j: number, extend: boolean) {
    focusRequestedRef.current = true;
    setFocus({ row: i, column: j + 1 });
    setCopyBlocked(false);
    if (extend && sel) {
      setSel(extendGridSelection(sel, i, j));
      return;
    }
    setSel(singleGridCell(i, j));
    onSelectRow?.(i);
    // An unreadable cell has no value to inspect; handing `null` to the viewer
    // would show it as a SQL NULL.
    if (unreadable.typeAt(i, j)) return;
    onCellClick?.(result.rows[i]?.[j], i, result.columns[j]);
  }

  // ⌘C/Ctrl+C copies the selected cell — but yield to a real text selection so users
  // can still copy dragged-over text normally. Esc clears the cell selection. Arrow keys
  // roving-select a cell (mirrors App.tsx's tab-bar pattern: move sel, then focus the td —
  // valid even at tabIndex=-1, only Tab-order membership depends on that). Enter opens it.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && (sel || copyBlocked)) {
      setSel(null);
      setCopyBlocked(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C") && sel) {
      if ((window.getSelection()?.toString() ?? "") !== "") return; // real selection wins
      e.preventDefault();
      const bounds = gridSelectionBounds(sel);
      // Refuse rather than copy a placeholder: the clipboard must carry the same
      // thing the grid shows, and an unread cell has no value to carry.
      if (
        unreadable.hasRange(
          bounds.firstRow,
          bounds.lastRow,
          bounds.firstCol,
          bounds.lastCol,
        )
      ) {
        setCopyBlocked(true);
        return;
      }
      setCopyBlocked(false);
      void navigator.clipboard.writeText(
        gridSelectionClipboardText(
          sel,
          (row) => result.rows[row],
          cell,
          copyText,
        ),
      );
      return;
    }
    if (
      focus.column === 0 &&
      (e.key === "Enter" || e.key === " ") &&
      onSelectRow
    ) {
      e.preventDefault();
      onSelectRow(focus.row);
      return;
    }
    if (e.key === "Enter" && focus.column > 0) {
      e.preventDefault();
      selectCell(focus.row, focus.column - 1, false);
      return;
    }
    const target = dataGridKeyboardTarget({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      current: focus,
      rowCount: result.rows.length,
      dataColumnCount: result.columns.length,
      pageRows: Math.max(
        1,
        Math.floor(
          ((viewportRef.current?.clientHeight ?? 280) -
            DATA_GRID_HEADER_HEIGHT) /
            DATA_GRID_ROW_HEIGHT,
        ),
      ),
    });
    if (!target) return;
    e.preventDefault();
    focusRequestedRef.current = true;
    setFocus(target);
    if (target.column > 0) {
      const dataColumn = target.column - 1;
      setSel(
        e.shiftKey && sel
          ? extendGridSelection(sel, target.row, dataColumn)
          : singleGridCell(target.row, dataColumn),
      );
    }
  }

  return (
    <DataGridViewport
      ref={viewportRef}
      surface={surface}
      footerInset={footerInset}
      tabIndex={result.rows.length === 0 ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      {copyBlocked ? (
        <DataGridNotice tone="warning">
          {t("grid.copyBlockedUnreadable")}
        </DataGridNotice>
      ) : null}
      <table
        ref={tableRef}
        role="grid"
        aria-rowcount={Math.max(result.rowCount, startIndex + result.rows.length) + 1}
        aria-colcount={result.columns.length + 1}
        className="tw:table-fixed tw:border-separate tw:border-spacing-0 tw:bg-background tw:font-mono tw:text-ui tw:[&_td]:box-border tw:[&_td]:max-w-none tw:[&_td]:overflow-hidden tw:[&_td]:border-b tw:[&_td]:border-border-subtle tw:[&_td]:px-2 tw:[&_td]:py-1 tw:[&_td]:leading-ui tw:[&_td]:text-left tw:[&_td]:text-ellipsis tw:[&_td]:whitespace-nowrap tw:[&_th]:box-border tw:[&_th]:max-w-none tw:[&_th]:overflow-hidden tw:[&_th]:border-r tw:[&_th]:border-b tw:[&_th]:border-border-subtle tw:[&_th]:px-2 tw:[&_th]:py-px tw:[&_th]:leading-ui tw:[&_th]:text-left tw:[&_th]:text-ellipsis tw:[&_th]:whitespace-nowrap tw:[&_thead_th]:sticky tw:[&_thead_th]:top-0 tw:[&_thead_th]:z-[var(--ds-z-raised)] tw:[&_thead_th]:h-control-sm tw:[&_thead_th]:bg-card"
        style={{ tableLayout: "fixed", width: totalW }}
      >
        <colgroup>
          <col style={{ width: columnWidths[0] }} />
          {result.columns.map((_, j) => (
            <col key={j} style={{ width: columnWidths[j + 1] }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row" aria-rowindex={1}>
            <th
              role="columnheader"
              aria-colindex={1}
              className="tw:left-0 tw:z-[calc(var(--ds-z-raised)+1)] tw:text-right tw:text-muted-foreground"
            >
              #
            </th>
            {result.columns.map((c, j) => (
              <th
                key={c}
                role="columnheader"
                aria-colindex={j + 2}
                aria-sort={
                  onSort
                    ? sort?.col === c
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                    : undefined
                }
              >
                <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1">
                  {onSort ? (
                    <button
                      type="button"
                      className="tw:inline-flex tw:h-control-xs tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:gap-1 tw:overflow-hidden tw:border-0 tw:bg-transparent tw:p-0 tw:font-sans tw:text-left tw:text-ui tw:font-semibold tw:text-inherit tw:hover:text-primary tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
                      title={columnMeta?.[c]?.dataType}
                      onClick={() => onSort(c)}
                    >
                      {columnMeta?.[c] ? (
                        <Icon
                          name={columnMeta[c].pk ? "key" : "columns"}
                          className="tw:shrink-0 tw:text-xs tw:text-muted-foreground"
                        />
                      ) : null}
                      <span className="tw:overflow-hidden tw:text-ellipsis">
                        {c}
                      </span>
                      {sort?.col === c ? (
                        <Icon
                          name={sort.dir === "asc" ? "caretUp" : "caretDown"}
                          className="tw:shrink-0 tw:text-2xs tw:text-primary"
                        />
                      ) : null}
                    </button>
                  ) : (
                    <span
                      className="tw:inline-flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1 tw:overflow-hidden"
                      title={columnMeta?.[c]?.dataType}
                    >
                      {columnMeta?.[c] ? (
                        <Icon
                          name={columnMeta[c].pk ? "key" : "columns"}
                          className="tw:shrink-0 tw:text-xs tw:text-muted-foreground"
                        />
                      ) : null}
                      <span className="tw:overflow-hidden tw:text-ellipsis">
                        {c}
                      </span>
                    </span>
                  )}
                  {onFilter ? (
                    <DataGridColumnFilterMenu
                      column={c}
                      values={result.rows.map((row) => row[j])}
                      filter={filters?.[c] ?? ""}
                      onFilter={(value) => onFilter(c, value)}
                    />
                  ) : null}
                </span>
                <ResizeSeparator
                  data-grid-resize-handle
                  className="tw:absolute tw:top-0 tw:right-0 tw:z-[var(--ds-z-sticky)] tw:h-full tw:w-2 tw:cursor-col-resize tw:hover:bg-primary/55 tw:active:bg-primary/55"
                  label={`${c}: ${t("grid.resizeHint")}`}
                  orientation="vertical"
                  value={columnWidths[j + 1]}
                  minimum={50}
                  maximum={1200}
                  onChange={(width) =>
                    setWidths((current) => ({ ...current, [j + 1]: width }))
                  }
                  onReset={() => setWidths({})}
                  onMouseDown={(e) => startResize(e, j + 1)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr
              key={i}
              role="row"
              aria-rowindex={startIndex + i + 2}
              data-selected={selectedRow === i}
              className="tw:group tw:[contain-intrinsic-size:0_var(--ds-control-sm)] tw:[content-visibility:auto] tw:hover:[&>td]:bg-muted tw:data-[selected=true]:[&>td]:bg-selection"
            >
              <td
                data-interactive={onSelectRow ? "true" : undefined}
                data-focused={focus.row === i && focus.column === 0}
                data-grid-focus={`${i}:0`}
                className="tw:sticky tw:left-0 tw:z-[var(--ds-z-base)] tw:border-r tw:bg-card tw:text-right tw:text-muted-foreground tw:data-[interactive=true]:cursor-pointer tw:data-[focused=true]:shadow-[inset_0_0_0_var(--ds-border-width-strong)_var(--ds-ring)]"
                role="rowheader"
                aria-colindex={1}
                aria-selected={selectedRow === i}
                tabIndex={focus.row === i && focus.column === 0 ? 0 : -1}
                onFocus={() => setFocus({ row: i, column: 0 })}
                onClick={() => {
                  focusRequestedRef.current = true;
                  setFocus({ row: i, column: 0 });
                  onSelectRow?.(i);
                }}
              >
                {startIndex + i + 1}
              </td>
              {row.map((v, j) => {
                const unreadableType = unreadable.typeAt(i, j);
                const text = unreadableType
                  ? t("grid.unreadableCell", { type: unreadableType })
                  : cell(v);
                const isSel = gridSelectionIncludes(sel, i, j);
                const isFocus = focus.row === i && focus.column === j + 1;
                return (
                  <td
                    key={j}
                    data-null={v === null && !unreadableType}
                    data-unreadable={!!unreadableType}
                    data-numeric={numericCols[j]}
                    data-interactive={interactive}
                    data-selected={isSel}
                    data-focused={isFocus}
                    data-grid-focus={`${i}:${j + 1}`}
                    className="tw:max-w-[480px] tw:overflow-hidden tw:bg-background tw:text-ellipsis tw:data-[null=true]:text-muted-foreground tw:data-[null=true]:italic tw:data-[unreadable=true]:text-warning tw:data-[unreadable=true]:italic tw:data-[numeric=true]:text-right tw:data-[numeric=true]:tabular-nums tw:data-[interactive=true]:cursor-pointer tw:data-[selected=true]:!bg-selection tw:data-[focused=true]:shadow-[inset_0_0_0_var(--ds-border-width-strong)_var(--ds-ring)]"
                    // Compact fixed columns can truncate any value.
                    title={
                      resized || text.length > 40 || text.includes("\n")
                        ? text
                        : undefined
                    }
                    // Roving tabindex: only the selected cell is a tab stop; arrows move it (onKeyDown above).
                    tabIndex={isFocus ? 0 : -1}
                    role="gridcell"
                    aria-colindex={j + 2}
                    aria-selected={isSel}
                    data-grid-value
                    onFocus={() => setFocus({ row: i, column: j + 1 })}
                    onClick={(event: ReactMouseEvent) =>
                      selectCell(i, j, event.shiftKey)
                    }
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </DataGridViewport>
  );
}
