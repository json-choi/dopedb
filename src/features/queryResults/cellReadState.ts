// One read-state contract for every result grid. A cell the backend could not
// decode arrives as `null` in `rows` plus its coordinates in `unreadableCells`,
// because no value shape could be told apart from a row that genuinely holds it.
// Both renderers, the clipboard, the exports, and the row editor read a cell's
// state through here so the grid, the copy, the file, and a generated INSERT all
// mean the same thing.
import type { UnreadableCell } from "../../ipc/types";

/** Read state of one cell: the failed database type name, or null when readable. */
export type CellReadState = (row: number, column: number) => string | null;

export type UnreadableCellLookup = {
  /** Database type name when the cell could not be decoded, else null. */
  typeAt: CellReadState;
  /** True when any cell of the row could not be decoded. */
  hasRow: (row: number) => boolean;
  /** True when any cell in the inclusive rectangle could not be decoded. */
  hasRange: (
    firstRow: number,
    lastRow: number,
    firstColumn: number,
    lastColumn: number,
  ) => boolean;
};

export const NO_UNREADABLE_CELLS: UnreadableCellLookup = {
  typeAt: () => null,
  hasRow: () => false,
  hasRange: () => false,
};

/**
 * Index the coordinates of one exact result or page set. The lookup is only ever
 * as authoritative as the coordinates it was built from, so a caller holding a
 * partially loaded stream must also consult the whole-result failure count.
 */
export function unreadableCellLookup(
  cells: readonly UnreadableCell[] | undefined,
): UnreadableCellLookup {
  if (!cells || cells.length === 0) return NO_UNREADABLE_CELLS;
  const rows = new Map<number, Map<number, string>>();
  for (const cell of cells) {
    let columns = rows.get(cell.row);
    if (!columns) {
      columns = new Map();
      rows.set(cell.row, columns);
    }
    columns.set(cell.column, cell.typeName);
  }
  return {
    typeAt: (row, column) => rows.get(row)?.get(column) ?? null,
    hasRow: (row) => rows.has(row),
    hasRange: (firstRow, lastRow, firstColumn, lastColumn) => {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const columns = rows.get(row);
        if (!columns) continue;
        for (const column of columns.keys()) {
          if (column >= firstColumn && column <= lastColumn) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Build a lookup over lazily paged rows. Only loaded pages can answer, so a caller
 * deciding a whole-result action also consults the stream's read-failure count.
 */
export function unreadableCellLookupFromRows(
  rowUnreadable: (row: number) => ReadonlyMap<number, string> | undefined,
): UnreadableCellLookup {
  return {
    typeAt: (row, column) => rowUnreadable(row)?.get(column) ?? null,
    hasRow: (row) => (rowUnreadable(row)?.size ?? 0) > 0,
    hasRange: (firstRow, lastRow, firstColumn, lastColumn) => {
      for (let row = firstRow; row <= lastRow; row += 1) {
        const columns = rowUnreadable(row);
        if (!columns) continue;
        for (const column of columns.keys()) {
          if (column >= firstColumn && column <= lastColumn) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Re-address read failures after rows are filtered or sliced. `keptRows` lists the
 * original row index of each row the caller kept, in its new order. A coordinate
 * that no longer has a row is dropped — never silently moved onto another row.
 */
export function remapUnreadableCells(
  cells: readonly UnreadableCell[],
  keptRows: readonly number[],
): UnreadableCell[] {
  if (cells.length === 0) return [];
  const position = new Map<number, number>();
  keptRows.forEach((original, index) => position.set(original, index));
  const remapped: UnreadableCell[] = [];
  for (const cell of cells) {
    const row = position.get(cell.row);
    if (row === undefined) continue;
    remapped.push({ ...cell, row, typeName: cell.typeName });
  }
  return remapped;
}
