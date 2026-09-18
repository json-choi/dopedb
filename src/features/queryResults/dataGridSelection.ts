// Pure rectangular cell-selection model shared by both grid renderers: anchor/focus
// coordinates, their normalized bounds, and the clipboard projection. A single-cell copy takes
// its own formatter so one value is not reshaped by the tab-separated range format.
export type GridCellCoordinate = {
  row: number;
  col: number;
};

export type GridCellSelection = {
  anchor: GridCellCoordinate;
  focus: GridCellCoordinate;
};

export function singleGridCell(
  row: number,
  col: number,
): GridCellSelection {
  const coordinate = { row, col };
  return { anchor: coordinate, focus: coordinate };
}

export function extendGridSelection(
  selection: GridCellSelection,
  row: number,
  col: number,
): GridCellSelection {
  return { ...selection, focus: { row, col } };
}

export function gridSelectionBounds(selection: GridCellSelection) {
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstCol: Math.min(selection.anchor.col, selection.focus.col),
    lastCol: Math.max(selection.anchor.col, selection.focus.col),
  };
}

export function gridSelectionIncludes(
  selection: GridCellSelection | null,
  row: number,
  col: number,
) {
  if (!selection) return false;
  const bounds = gridSelectionBounds(selection);
  return (
    row >= bounds.firstRow &&
    row <= bounds.lastRow &&
    col >= bounds.firstCol &&
    col <= bounds.lastCol
  );
}

export function gridSelectionClipboardText(
  selection: GridCellSelection,
  rowAt: (row: number) => readonly unknown[] | undefined,
  formatCell: (value: unknown) => string,
  formatSingleCell: (value: unknown) => string = formatCell,
) {
  const bounds = gridSelectionBounds(selection);
  if (
    bounds.firstRow === bounds.lastRow &&
    bounds.firstCol === bounds.lastCol
  ) {
    return formatSingleCell(rowAt(bounds.firstRow)?.[bounds.firstCol]);
  }
  const lines: string[] = [];
  for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
    const values: string[] = [];
    for (let col = bounds.firstCol; col <= bounds.lastCol; col += 1) {
      values.push(formatCell(rowAt(row)?.[col]));
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}
