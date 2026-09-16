// Locates and remaps decode failures so invalid cells cannot become inspected values.

import type { CellDecodeFailure } from "../../ipc/types";
import {
  gridSelectionBounds,
  type GridCellSelection,
} from "./dataGridSelection";

export function cellDecodeFailureAt(
  failures: readonly CellDecodeFailure[] | undefined,
  rowIndex: number,
  columnIndex: number,
) {
  return failures?.find(
    (failure) =>
      failure.rowIndex === rowIndex && failure.columnIndex === columnIndex,
  );
}

export function firstDecodeFailureInSelection(
  failures: readonly CellDecodeFailure[] | undefined,
  selection: GridCellSelection,
) {
  const bounds = gridSelectionBounds(selection);
  return failures?.find(
    (failure) =>
      failure.rowIndex >= bounds.firstRow &&
      failure.rowIndex <= bounds.lastRow &&
      failure.columnIndex >= bounds.firstCol &&
      failure.columnIndex <= bounds.lastCol,
  );
}

export function firstDecodeFailureInRow(
  failures: readonly CellDecodeFailure[] | undefined,
  rowIndex: number,
) {
  return failures?.find((failure) => failure.rowIndex === rowIndex);
}

export function gridCellInspection(
  failures: readonly CellDecodeFailure[] | undefined,
  rowIndex: number,
  value: unknown,
) {
  const failure = firstDecodeFailureInRow(failures, rowIndex);
  return failure
    ? { blocked: true as const, failure }
    : { blocked: false as const, value };
}

export function remapDecodeFailures(
  failures: readonly CellDecodeFailure[] | undefined,
  sourceRowIndexes: readonly number[],
) {
  if (!failures?.length) return [];
  const targetRows = new Map(
    sourceRowIndexes.map((sourceRow, targetRow) => [sourceRow, targetRow]),
  );
  return failures.flatMap((failure) => {
    const rowIndex = targetRows.get(failure.rowIndex);
    return rowIndex === undefined ? [] : [{ ...failure, rowIndex }];
  });
}
