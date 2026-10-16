// Locates and remaps decode failures so invalid cells cannot become inspected values.

import type { CellDecodeFailure } from "../../ipc/types";
import { truncatedCellBytes } from "../queries/resultPageCache";
import {
  gridSelectionBounds,
  type GridCellSelection,
} from "./dataGridSelection";

/** Extra facts about an activated cell beyond its value. */
export type GridCellDetail = { truncatedBytes: number | null };

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

/**
 * Inspection is blocked only for the exact cell that failed to decode; the rest
 * of its row stays inspectable. A shortened cell is inspectable as its preview.
 */
export function gridCellInspection(
  failures: readonly CellDecodeFailure[] | undefined,
  rowIndex: number,
  columnIndex: number,
  value: unknown,
) {
  const failure = cellDecodeFailureAt(failures, rowIndex, columnIndex);
  if (!failure) return { blocked: false as const, value, truncatedBytes: null };
  const truncatedBytes = truncatedCellBytes(failure);
  return truncatedBytes === null
    ? { blocked: true as const, failure }
    : { blocked: false as const, value, truncatedBytes };
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
