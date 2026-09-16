import { describe, expect, it } from "vitest";
import {
  buildPageQuery,
  gridExpressionIssue,
} from "../../lib/sqlBuild";
import type { CatalogTable } from "../../ipc/types";
import { shouldVirtualizeDataGrid } from "./DataGrid";
import { virtualGridWindow } from "./DataGridVirtual";
import {
  extendGridSelection,
  gridSelectionClipboardText,
  gridSelectionIncludes,
  singleGridCell,
} from "./dataGridSelection";
import {
  DATA_GRID_DEFAULT_COLUMN_WIDTH,
  DATA_GRID_ROW_HEIGHT,
  DATA_GRID_ROW_NUMBER_WIDTH,
} from "../../design-system/dataGridGeometry";
import type { SqlStreamRowSource } from "../queries/domain";
import { createFrameCoalescer } from "../../lib/frameCoalescer";
import { resizeSeparatorNextValue } from "../../design-system/components/ResizeSeparator";
import { dataGridKeyboardTarget } from "./dataGridKeyboard";
import type { ButtonProps } from "../../design-system/components/Button";
import type { ConfirmButtonProps } from "../../components/ConfirmButton";
import { tabularResult } from "../agents/AcpStructuredResult";
import {
  clearSqlResultPageCache,
  collectCachedSqlResultRows,
  ensureSqlResultRange,
  SQL_RESULT_CACHE_MAX_PAGES,
  retainSqlStreamBatch,
  sqlResultDecodeFailureAt,
  sqlResultRangeIsCached,
  sqlResultRowAt,
  subscribeSqlResultPages,
} from "../queries/resultPageCache";
import {
  cellDecodeFailureAt,
  firstDecodeFailureInSelection,
  firstDecodeFailureInRow,
  gridCellInspection,
} from "./decodeFailures";
import { dataGridSelectionResetIdentity } from "./useDataGridSelectionReset";

const offsets = Array.from(
  { length: 51 },
  (_, index) =>
    DATA_GRID_ROW_NUMBER_WIDTH + index * DATA_GRID_DEFAULT_COLUMN_WIDTH,
);
type UnnamedIconButtonAllowed = {
  iconOnly: true;
  children: null;
} extends ButtonProps
  ? true
  : false;
type UnnamedConfirmIconButtonAllowed = {
  iconOnly: true;
  children: null;
  onConfirm: () => void;
} extends ConfirmButtonProps
  ? true
  : false;
const unnamedIconButtonAllowed: UnnamedIconButtonAllowed = false;
const unnamedConfirmIconButtonAllowed: UnnamedConfirmIconButtonAllowed = false;

describe("DataGridVirtual window", () => {
  it("keeps a 1m by 50 grid bounded at a 360px viewport", () => {
    const window = virtualGridWindow(1_000_000, 50, offsets, {
      top: 500_000 * DATA_GRID_ROW_HEIGHT,
      left: 2_000,
      width: 360,
      height: 240,
    });
    const cellCount =
      (window.endRow - window.startRow) * window.visibleColumns.length;
    expect(window.startRow).toBeGreaterThan(0);
    expect(unnamedIconButtonAllowed).toBe(false);
    expect(unnamedConfirmIconButtonAllowed).toBe(false);
    expect(window.endRow).toBeLessThan(1_000_000);
    expect(window.visibleColumns.length).toBeLessThan(15);
    expect(cellCount).toBeLessThan(400);

    const scheduled: { frame: FrameRequestCallback | null } = { frame: null };
    let frameRequests = 0;
    const commits: number[] = [];
    const coalescer = createFrameCoalescer<number>(
      (value) => commits.push(value),
      (callback) => {
        frameRequests += 1;
        scheduled.frame = callback;
        return frameRequests;
      },
      () => {
        scheduled.frame = null;
      },
    );
    coalescer.push(1);
    coalescer.push(2);
    coalescer.push(3);
    expect(frameRequests).toBe(1);
    expect(commits).toEqual([]);
    expect(scheduled.frame).not.toBeNull();
    scheduled.frame?.(16);
    expect(commits).toEqual([3]);
    coalescer.push(4);
    coalescer.flush();
    expect(commits).toEqual([3, 4]);
  });

  it("keeps boundary coordinates and rectangular selection deterministic", async () => {
    const wideResult = {
      columns: Array.from({ length: 19 }, (_, index) => `column_${index}`),
      rows: [[1]],
      rowCount: 1,
      truncated: false,
      durationMs: 1,
    };
    expect(shouldVirtualizeDataGrid(wideResult)).toBe(true);
    expect(
      dataGridSelectionResetIdentity(wideResult).materializedResult,
    ).toBe(wideResult);
    const streamIdentity = {
      operationId: "00000000-0000-0000-0000-000000000001",
      capability: "a".repeat(64),
      pageRows: 256,
      pageRanges: [],
      rowCount: 1,
      complete: false,
    } satisfies SqlStreamRowSource;
    expect(
      dataGridSelectionResetIdentity(wideResult, streamIdentity),
    ).toEqual(
      dataGridSelectionResetIdentity(wideResult, {
        ...streamIdentity,
        rowCount: 200,
        pageRanges: [{ sequence: 0, rowStart: 0, rowCount: 200 }],
      }),
    );
    expect(
      dataGridSelectionResetIdentity(wideResult, streamIdentity).operationId,
    ).not.toBe(
      dataGridSelectionResetIdentity(wideResult, {
        ...streamIdentity,
        operationId: "00000000-0000-0000-0000-000000000002",
      }).operationId,
    );
    expect(
      dataGridSelectionResetIdentity(wideResult, streamIdentity).capability,
    ).not.toBe(
      dataGridSelectionResetIdentity(wideResult, {
        ...streamIdentity,
        capability: "b".repeat(64),
      }).capability,
    );
    expect(
      dataGridSelectionResetIdentity(wideResult, streamIdentity).columnKey,
    ).not.toBe(
      dataGridSelectionResetIdentity(
        { ...wideResult, columns: ["replacement"] },
        streamIdentity,
      ).columnKey,
    );
    const table = {
      database: null,
      schema: "public",
      name: "events",
      columns: [{ name: "unindexed_value", pk: false }],
    } as CatalogTable;
    expect(
      buildPageQuery("postgres", table, {
        filters: {},
        sort: null,
        limit: 101,
        offset: 0,
      }),
    ).toBe('SELECT * FROM "public"."events" LIMIT 101 OFFSET 0');
    expect(
      virtualGridWindow(1_000, 50, offsets, {
        top: 0,
        left: 0,
        width: 360,
        height: 240,
      }).startRow,
    ).toBe(0);
    const final = virtualGridWindow(1_000, 50, offsets, {
      top: 999 * DATA_GRID_ROW_HEIGHT,
      left: 8_000,
      width: 360,
      height: 240,
    });
    expect(final.endRow).toBe(1_000);
    expect(final.visibleColumns[final.visibleColumns.length - 1]).toBe(49);

    const selection = extendGridSelection(singleGridCell(0, 1), 1, 2);
    expect(gridSelectionIncludes(selection, 0, 1)).toBe(true);
    expect(gridSelectionIncludes(selection, 1, 2)).toBe(true);
    expect(gridSelectionIncludes(selection, 0, 0)).toBe(false);
    expect(
      dataGridKeyboardTarget({
        key: "ArrowRight",
        current: { row: 3, column: 0 },
        rowCount: 500,
        dataColumnCount: 4,
        pageRows: 10,
      }),
    ).toEqual({ row: 3, column: 1 });
    expect(
      dataGridKeyboardTarget({
        key: "Home",
        current: { row: 3, column: 2 },
        rowCount: 500,
        dataColumnCount: 4,
        pageRows: 10,
      }),
    ).toEqual({ row: 3, column: 0 });
    expect(
      dataGridKeyboardTarget({
        key: "End",
        metaKey: true,
        current: { row: 3, column: 2 },
        rowCount: 500,
        dataColumnCount: 4,
        pageRows: 10,
      }),
    ).toEqual({ row: 499, column: 4 });
    expect(
      dataGridKeyboardTarget({
        key: "PageDown",
        current: { row: 3, column: 2 },
        rowCount: 500,
        dataColumnCount: 4,
        pageRows: 10,
      }),
    ).toEqual({ row: 13, column: 2 });
    expect(
      resizeSeparatorNextValue({
        key: "ArrowLeft",
        value: 52,
        minimum: 50,
        maximum: 1_200,
        step: 8,
      }),
    ).toBe(50);
    expect(
      resizeSeparatorNextValue({
        key: "End",
        value: 144,
        minimum: 50,
        maximum: 1_200,
        step: 8,
      }),
    ).toBe(1_200);
    expect(
      gridSelectionClipboardText(
        selection,
        (row) => [
          ["a", "b", "c"],
          ["d", "e", "f"],
        ][row],
        String,
      ),
    ).toBe("b\tc\ne\tf");

    const ordinaryValues = [
      null,
      "",
      "<unsupported: geometry>",
      { decodeFailure: true, databaseType: "geometry" },
      null,
    ];
    const decodeFailures = [
      { rowIndex: 0, columnIndex: 4, databaseType: "geometry" },
    ];
    expect(cellDecodeFailureAt(decodeFailures, 0, 0)).toBeUndefined();
    expect(cellDecodeFailureAt(decodeFailures, 0, 1)).toBeUndefined();
    expect(cellDecodeFailureAt(decodeFailures, 0, 2)).toBeUndefined();
    expect(cellDecodeFailureAt(decodeFailures, 0, 3)).toBeUndefined();
    expect(cellDecodeFailureAt(decodeFailures, 0, 4)).toEqual(
      decodeFailures[0],
    );
    expect(firstDecodeFailureInRow(decodeFailures, 0)).toEqual(
      decodeFailures[0],
    );
    expect(gridCellInspection(decodeFailures, 0, null)).toEqual({
      blocked: true,
      failure: decodeFailures[0],
    });
    expect(gridCellInspection([], 0, null)).toEqual({
      blocked: false,
      value: null,
    });
    expect(
      gridSelectionClipboardText(singleGridCell(0, 2), () => ordinaryValues, String),
    ).toBe("<unsupported: geometry>");
    expect(
      firstDecodeFailureInSelection(
        decodeFailures,
        extendGridSelection(singleGridCell(0, 0), 0, 3),
      ),
    ).toBeUndefined();
    expect(
      firstDecodeFailureInSelection(
        decodeFailures,
        extendGridSelection(singleGridCell(0, 3), 0, 4),
      ),
    ).toEqual(decodeFailures[0]);
    expect(
      tabularResult({
        columns: ["null", "empty", "marker", "sentinel", "failed"],
        rows: [ordinaryValues],
        decodeFailures,
      }),
    ).toMatchObject({
      rows: [ordinaryValues],
      decodeFailures,
    });

    expect(gridExpressionIssue("where", "city = 'Berlin'")).toBeNull();
    expect(gridExpressionIssue("orderBy", "city DESC, id ASC")).toBeNull();
    expect(gridExpressionIssue("where", "1 = 1; DELETE FROM users")).toBe(
      "statementBoundary",
    );
    expect(gridExpressionIssue("where", "1 = 1 -- swallow LIMIT")).toBe(
      "statementBoundary",
    );
    expect(gridExpressionIssue("orderBy", "city DESC LIMIT 5000")).toBe(
      "clauseBoundary",
    );

    const capability = "a".repeat(64);
    const source: SqlStreamRowSource = {
      operationId: "00000000-0000-0000-0000-000000000123",
      capability,
      pageRows: 256,
      pageRanges: Array.from(
        { length: SQL_RESULT_CACHE_MAX_PAGES + 1 },
        (_, sequence) => ({
          sequence,
          rowStart: sequence * 256,
          rowCount: 256,
        }),
      ),
      rowCount: (SQL_RESULT_CACHE_MAX_PAGES + 1) * 256,
      complete: true,
    };
    for (let sequence = 0; sequence <= SQL_RESULT_CACHE_MAX_PAGES; sequence += 1) {
      retainSqlStreamBatch(source, {
        operationId: source.operationId!,
        resultCapability: capability,
        sequence,
        columns: ["id"],
        rows: Array.from({ length: 256 }, (_, row) => [sequence * 256 + row]),
      });
    }
    expect(sqlResultRowAt(source, 0)).toBeUndefined();
    expect(sqlResultRowAt(source, SQL_RESULT_CACHE_MAX_PAGES * 256)).toEqual([
      SQL_RESULT_CACHE_MAX_PAGES * 256,
    ]);

    clearSqlResultPageCache();
    const variableSource: SqlStreamRowSource = {
      operationId: "00000000-0000-0000-0000-000000000456",
      capability: "b".repeat(64),
      pageRows: 256,
      pageRanges: [
        { sequence: 0, rowStart: 0, rowCount: 2 },
        { sequence: 1, rowStart: 2, rowCount: 3 },
      ],
      rowCount: 5,
      complete: true,
    };
    const variableBatches = [
      {
        operationId: variableSource.operationId!,
        resultCapability: variableSource.capability!,
        sequence: 0,
        rowStart: 0,
        columns: ["id"],
        rows: [[0], [1]],
      },
      {
        operationId: variableSource.operationId!,
        resultCapability: variableSource.capability!,
        sequence: 1,
        rowStart: 2,
        columns: ["id"],
        rows: [[2], [null], [4]],
        decodeFailures: [
          { rowIndex: 3, columnIndex: 0, databaseType: "geometry" },
        ],
      },
    ];
    retainSqlStreamBatch(variableSource, variableBatches[0]);
    retainSqlStreamBatch(variableSource, variableBatches[1]);
    expect(sqlResultRowAt(variableSource, 1)).toEqual([1]);
    expect(sqlResultRowAt(variableSource, 2)).toEqual([2]);
    expect(sqlResultRowAt(variableSource, 4)).toEqual([4]);
    expect(sqlResultDecodeFailureAt(variableSource, 3, 0)?.databaseType).toBe(
      "geometry",
    );
    let evictionNotifications = 0;
    const unsubscribe = subscribeSqlResultPages(variableSource, () => {
      evictionNotifications += 1;
    });
    for (let index = 0; index < 4; index += 1) {
      const other = {
        ...variableSource,
        operationId: `00000000-0000-0000-0000-${String(index + 200).padStart(12, "0")}`,
        capability: String(index + 1).repeat(64),
        pageRanges: [{ sequence: 0, rowStart: 0, rowCount: 1 }],
        rowCount: 1,
      };
      retainSqlStreamBatch(other, {
        operationId: other.operationId,
        resultCapability: other.capability,
        sequence: 0,
        rowStart: 0,
        columns: ["id"],
        rows: [[index]],
      });
    }
    expect(sqlResultRowAt(variableSource, 3)).toBeUndefined();
    expect(evictionNotifications).toBe(1);
    expect(sqlResultRangeIsCached(variableSource, 0, 5)).toBe(false);
    expect(collectCachedSqlResultRows(variableSource)).toBeNull();

    const reloadedSource = JSON.parse(
      JSON.stringify(variableSource),
    ) as SqlStreamRowSource;
    const loadedSequences: number[] = [];
    const readPage = async (_source: SqlStreamRowSource, sequence: number) => {
      loadedSequences.push(sequence);
      const { resultCapability: _resultCapability, ...wire } =
        variableBatches[sequence];
      return wire;
    };
    await ensureSqlResultRange(
      reloadedSource,
      2,
      5,
      ["id"],
      readPage,
    );
    expect(loadedSequences).toEqual([1]);
    expect(sqlResultRangeIsCached(reloadedSource, 0, 5)).toBe(false);
    expect(sqlResultRangeIsCached(reloadedSource, 2, 5)).toBe(true);
    expect(collectCachedSqlResultRows(reloadedSource)).toBeNull();
    expect(sqlResultRowAt(reloadedSource, 3)).toEqual([null]);
    expect(sqlResultDecodeFailureAt(reloadedSource, 3, 0)?.databaseType).toBe(
      "geometry",
    );
    await ensureSqlResultRange(
      reloadedSource,
      0,
      5,
      ["id"],
      readPage,
    );
    expect(loadedSequences).toEqual([1, 0]);
    expect(sqlResultRangeIsCached(reloadedSource, 0, 5)).toBe(true);
    expect(collectCachedSqlResultRows(reloadedSource)).toEqual([
      [0],
      [1],
      [2],
      [null],
      [4],
    ]);
    expect(sqlResultRowAt(reloadedSource, 0)).toEqual([0]);
    expect(sqlResultRowAt(reloadedSource, 4)).toEqual([4]);

    unsubscribe();
    clearSqlResultPageCache();
  });
});
