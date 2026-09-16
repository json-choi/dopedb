// Windowed row-and-column renderer for large query results. The scroll spacer owns
// geometry; only cells intersecting the viewport (+ a small overscan) enter the DOM.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { QueryResult } from "../../ipc/types";
import { type SqlStreamRowSource } from "../queries/domain";
import {
  collectCachedSqlResultDecodeFailures,
  ensureSqlResultRange,
  sqlResultDecodeFailureAt,
  sqlResultRangeIsCached,
  sqlResultRowAt,
} from "../queries/resultPageCache";
import { readSqlResultPage } from "../queries/tauriAdapter";
import { useSqlResultPages } from "../queries/useSqlResultPages";
import type { GridSort } from "../../lib/sqlBuild";
import { Icon } from "../../components/Icon";
import DataGridColumnFilterMenu from "./DataGridColumnFilterMenu";
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
  DATA_GRID_DEFAULT_COLUMN_WIDTH,
  DATA_GRID_HEADER_HEIGHT,
  DATA_GRID_ROW_HEIGHT,
  DATA_GRID_ROW_NUMBER_WIDTH,
} from "../../design-system/dataGridGeometry";
import {
  DataGridViewport,
  type DataGridSurface,
} from "../../design-system/components/DataGridViewport";
import { ResizeSeparator } from "../../design-system/components/ResizeSeparator";
import {
  createFrameCoalescer,
  type FrameCoalescer,
} from "../../lib/frameCoalescer";
import {
  dataGridKeyboardTarget,
  type DataGridFocus,
} from "./dataGridKeyboard";
import {
  cellDecodeFailureAt,
  firstDecodeFailureInSelection,
  gridCellInspection,
} from "./decodeFailures";

const OVERSCAN = 4;

type VirtualScroll = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type Props = {
  result: QueryResult;
  rowSource?: SqlStreamRowSource;
  startIndex: number;
  sort?: GridSort | null;
  onSort?: (col: string) => void;
  filters?: Record<string, string>;
  onFilter?: (col: string, value: string) => void;
  selectedRow?: number | null;
  onSelectRow?: (i: number) => void;
  onCellClick?: (value: unknown, rowIndex: number, col: string) => void;
  columnMeta?: Record<string, { dataType: string; pk: boolean }>;
  surface?: DataGridSurface;
  footerInset?: boolean;
};

export function virtualGridWindow(
  rowCount: number,
  columnCount: number,
  offsets: number[],
  scroll: { top: number; left: number; width: number; height: number },
) {
  const startRow = Math.max(
    0,
    Math.floor(scroll.top / DATA_GRID_ROW_HEIGHT) - OVERSCAN,
  );
  const endRow = Math.min(
    rowCount,
    Math.ceil((scroll.top + scroll.height) / DATA_GRID_ROW_HEIGHT) + OVERSCAN,
  );
  let firstColumn = 0;
  while (firstColumn < columnCount && offsets[firstColumn + 1] <= scroll.left)
    firstColumn += 1;
  const visibleColumns: number[] = [];
  for (
    let index = Math.max(0, firstColumn - OVERSCAN);
    index < columnCount;
    index += 1
  ) {
    if (
      offsets[index] >
      scroll.left + scroll.width + DATA_GRID_DEFAULT_COLUMN_WIDTH * OVERSCAN
    )
      break;
    visibleColumns.push(index);
  }
  return { startRow, endRow, visibleColumns };
}

function display(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function copy(value: unknown) {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}

export default function DataGridVirtual(props: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollCoalescerRef = useRef<FrameCoalescer<VirtualScroll> | null>(null);
  const [scroll, setScroll] = useState<VirtualScroll>({
    top: 0,
    left: 0,
    width: 720,
    height: 320,
  });
  const [selection, setSelection] = useState<GridCellSelection | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [focus, setFocus] = useState<DataGridFocus>({ row: 0, column: 0 });
  const focusRequestedRef = useRef(false);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const interactive = !!props.onCellClick || !!props.onSelectRow;
  const rowCount = props.rowSource?.rowCount ?? props.result.rows.length;
  const rowAt = (index: number) =>
    props.rowSource
      ? sqlResultRowAt(props.rowSource, index)
      : props.result.rows[index];
  const failureAt = (rowIndex: number, columnIndex: number) =>
    props.rowSource
      ? sqlResultDecodeFailureAt(props.rowSource, rowIndex, columnIndex)
      : cellDecodeFailureAt(
          props.result.decodeFailures,
          rowIndex,
          columnIndex,
        );
  const columnWidths = useMemo(
    () =>
      props.result.columns.map(
        (_, index) => widths[index] ?? DATA_GRID_DEFAULT_COLUMN_WIDTH,
      ),
    [props.result.columns, widths],
  );
  const offsets = useMemo(() => {
    const next = [DATA_GRID_ROW_NUMBER_WIDTH];
    for (const width of columnWidths) next.push(next[next.length - 1] + width);
    return next;
  }, [columnWidths]);
  const totalWidth = offsets[offsets.length - 1] ?? DATA_GRID_ROW_NUMBER_WIDTH;
  const { startRow, endRow, visibleColumns } = virtualGridWindow(
    rowCount,
    props.result.columns.length,
    offsets,
    scroll,
  );
  const pageError = useSqlResultPages(
    props.rowSource,
    startRow,
    endRow,
    props.result.columns,
  );
  const columnSelectionKey = props.result.columns.join("\u0000");
  const visibleColumnWindowKey = visibleColumns.join(",");

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const coalescer = createFrameCoalescer<VirtualScroll>(setScroll);
    scrollCoalescerRef.current = coalescer;
    const update = () =>
      coalescer.push({
        top: element.scrollTop,
        left: element.scrollLeft,
        width: element.clientWidth,
        height: element.clientHeight,
      });
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      coalescer.cancel();
      if (scrollCoalescerRef.current === coalescer) {
        scrollCoalescerRef.current = null;
      }
    };
  }, []);
  useEffect(() => {
    setSelection(null);
    setCopyError(null);
    setFocus({ row: 0, column: 0 });
  }, [columnSelectionKey]);

  const activate = (row: number, col: number, extend = false) => {
    focusRequestedRef.current = true;
    setFocus({ row, column: col + 1 });
    if (extend && selection) {
      setSelection(extendGridSelection(selection, row, col));
      return;
    }
    setSelection(singleGridCell(row, col));
    const loadedRow = rowAt(row);
    if (!loadedRow && props.rowSource) {
      setCopyError(t("grid.incompleteInspectionBlocked"));
      return;
    }
    const failures = props.rowSource
      ? collectCachedSqlResultDecodeFailures(props.rowSource)
      : props.result.decodeFailures;
    const inspection = gridCellInspection(
      failures,
      row,
      loadedRow?.[col],
    );
    if (inspection.blocked) {
      setCopyError(
        t("grid.decodeFailureInspectionBlocked", {
          row: inspection.failure.rowIndex + 1,
          column: inspection.failure.columnIndex + 1,
          type: inspection.failure.databaseType,
        }),
      );
      return;
    }
    setCopyError(null);
    props.onSelectRow?.(row);
    props.onCellClick?.(inspection.value, row, props.result.columns[col]);
  };
  const copySelection = async (selected: GridCellSelection) => {
    if (props.rowSource) {
      const bounds = gridSelectionBounds(selected);
      await ensureSqlResultRange(
        props.rowSource,
        bounds.firstRow,
        bounds.lastRow + 1,
        props.result.columns,
        readSqlResultPage,
      );
      if (
        !sqlResultRangeIsCached(
          props.rowSource,
          bounds.firstRow,
          bounds.lastRow + 1,
        )
      ) {
        setCopyError(t("grid.incompleteCopyBlocked"));
        return;
      }
    }
    const failure = firstDecodeFailureInSelection(
      props.rowSource
        ? collectCachedSqlResultDecodeFailures(props.rowSource)
        : props.result.decodeFailures,
      selected,
    );
    if (failure) {
      setCopyError(
        t("grid.decodeFailureCopyBlocked", {
          row: failure.rowIndex + 1,
          column: failure.columnIndex + 1,
          type: failure.databaseType,
        }),
      );
      return;
    }
    setCopyError(null);
    await navigator.clipboard.writeText(
      gridSelectionClipboardText(selected, rowAt, display, copy),
    );
  };
  useEffect(() => {
    if (!focusRequestedRef.current) return;
    const cell = scrollRef.current?.querySelector<HTMLElement>(
      `[data-grid-focus="${focus.row}:${focus.column}"]`,
    );
    if (!cell) return;
    focusRequestedRef.current = false;
    cell?.focus({ preventScroll: true });
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus, startRow, endRow, visibleColumnWindowKey]);
  useEffect(() => {
    const activeElement = document.activeElement;
    if (activeElement && scrollRef.current?.contains(activeElement)) return;
    const focusColumnVisible =
      focus.column === 0 || visibleColumns.includes(focus.column - 1);
    if (
      focus.row >= startRow &&
      focus.row < endRow &&
      focusColumnVisible
    ) {
      return;
    }
    setFocus({ row: Math.min(Math.max(0, startRow), Math.max(0, rowCount - 1)), column: 0 });
  }, [endRow, focus, rowCount, startRow, visibleColumns]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") return setSelection(null);
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "c" &&
      selection
    ) {
      if (window.getSelection()?.toString()) return;
      event.preventDefault();
      void copySelection(selection);
      return;
    }
    if (
      focus.column === 0 &&
      (event.key === "Enter" || event.key === " ") &&
      props.onSelectRow
    ) {
      event.preventDefault();
      props.onSelectRow(focus.row);
      return;
    }
    if (event.key === "Enter" && focus.column > 0) {
      event.preventDefault();
      activate(focus.row, focus.column - 1);
      return;
    }
    const target = dataGridKeyboardTarget({
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      current: focus,
      rowCount,
      dataColumnCount: props.result.columns.length,
      pageRows: Math.max(
        1,
        Math.floor(
          (scroll.height - DATA_GRID_HEADER_HEIGHT) / DATA_GRID_ROW_HEIGHT,
        ),
      ),
    });
    if (!target) return;
    event.preventDefault();
    focusRequestedRef.current = true;
    setFocus(target);
    if (target.column > 0) {
      const dataColumn = target.column - 1;
      setSelection((current) =>
        event.shiftKey && current
          ? extendGridSelection(current, target.row, dataColumn)
          : singleGridCell(target.row, dataColumn),
      );
    }
    scrollRef.current?.scrollTo({
      top: Math.max(
        0,
        DATA_GRID_HEADER_HEIGHT +
          target.row * DATA_GRID_ROW_HEIGHT -
          DATA_GRID_ROW_HEIGHT,
      ),
      left:
        target.column === 0
          ? 0
          : Math.max(
              0,
              offsets[target.column - 1] - DATA_GRID_ROW_NUMBER_WIDTH,
            ),
    });
  };
  const resize = (event: ReactMouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const initial = columnWidths[index];
    const widthAt = (clientX: number) =>
      Math.max(72, Math.min(1200, initial + clientX - startX));
    const coalescer = createFrameCoalescer<number>((width) =>
      setWidths((current) => ({
        ...current,
        [index]: width,
      })),
    );
    const onMove = (moveEvent: MouseEvent) => {
      coalescer.push(widthAt(moveEvent.clientX));
    };
    const onUp = (upEvent: MouseEvent) => {
      coalescer.push(widthAt(upEvent.clientX));
      coalescer.flush();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <DataGridViewport
      ref={scrollRef}
      surface={props.surface}
      virtual
      footerInset={props.footerInset}
      role="grid"
      aria-rowcount={Math.max(props.result.rowCount, props.startIndex + rowCount) + 1}
      aria-colcount={props.result.columns.length + 1}
      tabIndex={rowCount === 0 ? 0 : undefined}
      onKeyDown={move}
      onScroll={(event) =>
        scrollCoalescerRef.current?.push({
          top: event.currentTarget.scrollTop,
          left: event.currentTarget.scrollLeft,
          width: event.currentTarget.clientWidth,
          height: event.currentTarget.clientHeight,
        })
      }
    >
      {pageError ? (
        <div
          className="tw:sticky tw:top-control-sm tw:left-0 tw:z-[var(--ds-z-sticky)] tw:w-fit tw:max-w-[min(520px,90%)] tw:bg-danger-muted tw:px-2 tw:py-1 tw:font-sans tw:text-xs tw:text-danger"
          role="status"
        >
          {pageError}
        </div>
      ) : null}
      {copyError ? (
        <div
          className="tw:sticky tw:top-control-sm tw:left-0 tw:z-[var(--ds-z-sticky)] tw:w-fit tw:max-w-[min(520px,90%)] tw:bg-danger-muted tw:px-2 tw:py-1 tw:font-sans tw:text-xs tw:text-danger"
          role="alert"
        >
          {copyError}
        </div>
      ) : null}
      <div
        className="tw:relative tw:min-w-full tw:font-mono tw:[&_[data-grid-box]]:absolute tw:[&_[data-grid-box]]:box-border tw:[&_[data-grid-box]]:h-control-sm tw:[&_[data-grid-box]]:overflow-hidden tw:[&_[data-grid-box]]:border-b tw:[&_[data-grid-box]]:border-border-subtle tw:[&_[data-grid-box]]:bg-background tw:[&_[data-grid-box]]:px-2 tw:[&_[data-grid-box]]:py-1 tw:[&_[data-grid-box]]:leading-ui tw:[&_[data-grid-box]]:text-ellipsis tw:[&_[data-grid-box]]:whitespace-nowrap"
        style={{
          width: totalWidth,
          height: DATA_GRID_HEADER_HEIGHT + rowCount * DATA_GRID_ROW_HEIGHT,
        }}
      >
        <div
          className="tw:sticky tw:top-0 tw:left-0 tw:right-0 tw:z-[var(--ds-z-raised)] tw:h-control-sm tw:overflow-visible tw:bg-card"
          role="row"
          aria-rowindex={1}
        >
          <div
            data-grid-box
            className="tw:top-0 tw:left-0 tw:z-[calc(var(--ds-z-raised)+1)] tw:border-r tw:!bg-card tw:text-right tw:text-muted-foreground"
            role="columnheader"
            aria-colindex={1}
            style={{ width: DATA_GRID_ROW_NUMBER_WIDTH }}
          >
            #
          </div>
          {visibleColumns.map((index) => {
            const name = props.result.columns[index];
            const sortableHeaderProps = props.onSort
              ? {
                  tabIndex: 0,
                  "aria-sort": (props.sort?.col === name
                    ? props.sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none") as "ascending" | "descending" | "none",
                  onClick: () => props.onSort?.(name),
                  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      props.onSort?.(name);
                    }
                  },
                }
              : {};
            return (
              <div
                key={name}
                data-grid-box
                data-sortable={props.onSort ? "true" : undefined}
                className="tw:top-0 tw:border-r tw:!bg-card tw:font-semibold tw:data-[sortable=true]:cursor-pointer tw:data-[sortable=true]:hover:text-primary"
                role="columnheader"
                aria-colindex={index + 2}
                style={{ left: offsets[index], width: columnWidths[index] }}
                {...sortableHeaderProps}
              >
                <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:pr-1">
                  <span
                    className="tw:inline-flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1 tw:overflow-hidden tw:align-middle tw:[&_.icon]:shrink-0 tw:[&_.icon]:text-xs tw:[&_.icon]:text-muted-foreground tw:[&>span]:overflow-hidden tw:[&>span]:text-ellipsis"
                    title={props.columnMeta?.[name]?.dataType}
                  >
                    {props.columnMeta?.[name] ? (
                      <Icon
                        name={props.columnMeta[name].pk ? "key" : "columns"}
                      />
                    ) : null}
                    <span>{name}</span>
                    {props.sort?.col === name ? (
                      <Icon
                        name={
                          props.sort.dir === "asc" ? "caretUp" : "caretDown"
                        }
                        className="tw:text-2xs tw:text-primary"
                      />
                    ) : null}
                  </span>
                  {props.onFilter ? (
                    <DataGridColumnFilterMenu
                      column={name}
                      values={props.result.rows.map((row) => row[index])}
                      filter={props.filters?.[name] ?? ""}
                      onFilter={(value) => props.onFilter?.(name, value)}
                    />
                  ) : null}
                </span>
                <ResizeSeparator
                  data-grid-resize-handle
                  className="tw:absolute tw:top-0 tw:right-0 tw:z-[var(--ds-z-sticky)] tw:h-full tw:w-2 tw:cursor-col-resize tw:hover:bg-primary/55 tw:active:bg-primary/55"
                  label={`${name}: ${t("grid.resizeHint")}`}
                  orientation="vertical"
                  value={columnWidths[index]}
                  minimum={72}
                  maximum={1200}
                  onChange={(width) =>
                    setWidths((current) => ({ ...current, [index]: width }))
                  }
                  onReset={() =>
                    setWidths((current) => {
                      const next = { ...current };
                      delete next[index];
                      return next;
                    })
                  }
                  onMouseDown={(event) => resize(event, index)}
                />
              </div>
            );
          })}
        </div>
        {Array.from(
          { length: Math.max(0, endRow - startRow) },
          (_, offset) => startRow + offset,
        ).map((rowIndex) => (
          <div
            key={rowIndex}
            data-selected={props.selectedRow === rowIndex}
            className="tw:group tw:absolute tw:top-0 tw:left-0 tw:right-0 tw:h-control-sm"
            role="row"
            aria-rowindex={props.startIndex + rowIndex + 2}
            style={{
              transform: `translateY(${
                DATA_GRID_HEADER_HEIGHT + rowIndex * DATA_GRID_ROW_HEIGHT
              }px)`,
            }}
          >
            <div
              data-grid-box
              data-interactive={props.onSelectRow ? "true" : undefined}
              data-focused={focus.row === rowIndex && focus.column === 0}
              data-grid-focus={`${rowIndex}:0`}
              className="tw:left-0 tw:z-[var(--ds-z-base)] tw:border-r tw:!bg-card tw:text-right tw:text-muted-foreground tw:group-data-[selected=true]:!bg-selection tw:data-[interactive=true]:cursor-pointer tw:data-[focused=true]:shadow-[inset_0_0_0_var(--ds-border-width-strong)_var(--ds-ring)]"
              role="rowheader"
              aria-colindex={1}
              aria-selected={props.selectedRow === rowIndex}
              tabIndex={focus.row === rowIndex && focus.column === 0 ? 0 : -1}
              style={{ width: DATA_GRID_ROW_NUMBER_WIDTH }}
              onFocus={() => setFocus({ row: rowIndex, column: 0 })}
              onClick={() => {
                focusRequestedRef.current = true;
                setFocus({ row: rowIndex, column: 0 });
                props.onSelectRow?.(rowIndex);
              }}
            >
              {props.startIndex + rowIndex + 1}
            </div>
            {visibleColumns.map((columnIndex) => {
              const value = rowAt(rowIndex)?.[columnIndex];
              const loading = value === undefined && !!props.rowSource;
              const decodeFailure = failureAt(rowIndex, columnIndex);
              const text = loading
                ? "…"
                : decodeFailure
                  ? t("grid.decodeFailure", {
                      type: decodeFailure.databaseType,
                    })
                  : display(value);
              const selected = gridSelectionIncludes(
                selection,
                rowIndex,
                columnIndex,
              );
              const focused =
                focus.row === rowIndex && focus.column === columnIndex + 1;
              return (
                <div
                  key={columnIndex}
                  data-grid-cell={`${rowIndex}:${columnIndex}`}
                  data-grid-focus={`${rowIndex}:${columnIndex + 1}`}
                  data-grid-box
                  data-null={value === null && !decodeFailure}
                  data-decode-failure={decodeFailure ? "true" : undefined}
                  data-loading={loading}
                  data-interactive={interactive}
                  data-selected={selected}
                  data-focused={focused}
                  className="tw:group-data-[selected=true]:!bg-selection tw:data-[null=true]:text-muted-foreground tw:data-[null=true]:italic tw:data-[decode-failure=true]:text-danger tw:data-[loading=true]:text-muted-foreground tw:data-[interactive=true]:cursor-pointer tw:data-[selected=true]:!bg-selection tw:data-[focused=true]:shadow-[inset_0_0_0_var(--ds-border-width-strong)_var(--ds-ring)]"
                  role="gridcell"
                  aria-colindex={columnIndex + 2}
                  aria-selected={selected}
                  tabIndex={focused ? 0 : -1}
                  title={
                    text.length > 40 || text.includes("\n") ? text : undefined
                  }
                  style={{
                    left: offsets[columnIndex],
                    width: columnWidths[columnIndex],
                  }}
                  onClick={(event) =>
                    activate(rowIndex, columnIndex, event.shiftKey)
                  }
                  onFocus={() =>
                    setFocus({ row: rowIndex, column: columnIndex + 1 })
                  }
                >
                  {text}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </DataGridViewport>
  );
}
