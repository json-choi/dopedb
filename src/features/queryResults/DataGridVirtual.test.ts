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
import {
  clearSqlResultPageCache,
  SQL_RESULT_CACHE_MAX_PAGES,
  retainSqlStreamBatch,
  sqlResultRowAt,
  sqlResultRowUnreadable,
  subscribeSqlResultPages,
} from "../queries/resultPageCache";
import {
  remapUnreadableCells,
  unreadableCellLookup,
} from "./cellReadState";
import {
  acceptSqlStreamBatch,
  emptySqlStreamView,
} from "../queries/domain";

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

  it("keeps boundary coordinates and rectangular selection deterministic", () => {
    expect(
      shouldVirtualizeDataGrid({
        columns: Array.from({ length: 19 }, (_, index) => `column_${index}`),
        rows: [[1]],
        rowCount: 1,
        truncated: false,
        durationMs: 1,
        unreadableCells: [],
      }),
    ).toBe(true);
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
      rowCount: 1_000_000,
      complete: true,
    };
    for (let sequence = 0; sequence <= SQL_RESULT_CACHE_MAX_PAGES; sequence += 1) {
      retainSqlStreamBatch(source, {
        operationId: source.operationId!,
        resultCapability: capability,
        sequence,
        columns: ["id"],
        rows: Array.from({ length: 256 }, (_, row) => [sequence * 256 + row]),
        unreadable: [],
      });
    }
    expect(sqlResultRowAt(source, 0)).toBeUndefined();
    expect(sqlResultRowAt(source, SQL_RESULT_CACHE_MAX_PAGES * 256)).toEqual([
      SQL_RESULT_CACHE_MAX_PAGES * 256,
    ]);

    clearSqlResultPageCache();
    retainSqlStreamBatch(source, {
      operationId: source.operationId!,
      resultCapability: capability,
      sequence: 0,
      columns: ["id"],
      rows: [[0]],
      unreadable: [],
    });
    let evictionNotifications = 0;
    const unsubscribe = subscribeSqlResultPages(source, () => {
      evictionNotifications += 1;
    });
    for (let index = 0; index < 4; index += 1) {
      const other = {
        ...source,
        operationId: `00000000-0000-0000-0000-${String(index + 200).padStart(12, "0")}`,
        capability: String(index + 1).repeat(64),
      };
      retainSqlStreamBatch(other, {
        operationId: other.operationId,
        resultCapability: other.capability,
        sequence: 0,
        columns: ["id"],
        rows: [[index]],
        unreadable: [],
      });
    }
    expect(sqlResultRowAt(source, 0)).toBeUndefined();
    expect(evictionNotifications).toBe(1);
    unsubscribe();
    clearSqlResultPageCache();

    // A cell the backend could not decode is addressed, never valued: the grid,
    // the clipboard, the export, and a generated INSERT all read it from here.
    const unreadable = unreadableCellLookup([
      { row: 1, column: 2, typeName: "geometry" },
    ]);
    expect(unreadable.typeAt(1, 2)).toBe("geometry");
    expect(unreadable.typeAt(1, 1)).toBeNull();
    expect(unreadable.hasRow(1)).toBe(true);
    expect(unreadable.hasRow(0)).toBe(false);
    expect(unreadable.hasRange(0, 2, 2, 3)).toBe(true);
    expect(unreadable.hasRange(0, 2, 0, 1)).toBe(false);
    // Filtering renumbers rows; a coordinate whose row is gone is dropped rather
    // than left pointing at whatever row now sits at that index.
    expect(
      remapUnreadableCells(
        [
          { row: 1, column: 2, typeName: "geometry" },
          { row: 3, column: 0, typeName: "money" },
        ],
        [3, 1],
      ),
    ).toEqual([
      { row: 1, column: 2, typeName: "geometry" },
      { row: 0, column: 0, typeName: "money" },
    ]);

    const readState: SqlStreamRowSource = {
      operationId: "00000000-0000-0000-0000-000000000456",
      capability,
      pageRows: 256,
      rowCount: 2,
      complete: true,
    };
    retainSqlStreamBatch(readState, {
      operationId: readState.operationId!,
      resultCapability: capability,
      sequence: 0,
      columns: ["id", "shape"],
      rows: [
        [1, null],
        [2, null],
      ],
      unreadable: [{ row: 0, column: 1, typeName: "geometry" }],
    });
    expect(sqlResultRowUnreadable(readState, 0)?.get(1)).toBe("geometry");
    expect(sqlResultRowUnreadable(readState, 1)).toBeUndefined();
    clearSqlResultPageCache();

    // A page naming a cell outside its own rows/columns cannot be projected onto
    // the result, so the whole batch is refused instead of partly trusted.
    const connecting = {
      ...emptySqlStreamView(7),
      phase: "connecting" as const,
    };
    expect(
      acceptSqlStreamBatch(connecting, 7, {
        operationId: "00000000-0000-0000-0000-000000000456",
        resultCapability: capability,
        sequence: 0,
        columns: ["id"],
        rows: [[1]],
        unreadable: [{ row: 4, column: 0, typeName: "geometry" }],
      }),
    ).toBeNull();
    expect(
      acceptSqlStreamBatch(connecting, 7, {
        operationId: "00000000-0000-0000-0000-000000000456",
        resultCapability: capability,
        sequence: 0,
        columns: ["id"],
        rows: [[null]],
        unreadable: [{ row: 0, column: 0, typeName: "geometry" }],
      })?.unreadableCells,
    ).toBe(1);
    clearSqlResultPageCache();
  });
});
