// One owner for the result-cell inspector across SQL, Tables, and Documents. The
// open cell is bounded local state: opening remembers the grid cell that asked so
// closing can hand focus back, and a new result, page, or streaming operation
// closes it rather than re-opening a different value under the old coordinates.
import { useCallback, useRef, useState } from "react";

import {
  useDataGridSelectionReset,
  type DataGridResultIdentity,
} from "./useDataGridSelectionReset";

export type InspectedResultCell = {
  value: unknown;
  column: string;
  /** Row number as shown in the grid, so the panel names the exact cell. */
  rowNumber: number;
};

export type ResultCellInspector = {
  cell: InspectedResultCell | null;
  /** Open from a grid cell; the currently focused element becomes the trigger. */
  open: (cell: InspectedResultCell) => void;
  /** Close and return focus to the grid cell that opened the panel. */
  close: () => void;
};

export function useResultCellInspector(
  identity: DataGridResultIdentity,
): ResultCellInspector {
  const [cell, setCell] = useState<InspectedResultCell | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useDataGridSelectionReset(identity, () => {
    triggerRef.current = null;
    setCell(null);
  });

  const open = useCallback((next: InspectedResultCell) => {
    const active =
      typeof document === "undefined" ? null : document.activeElement;
    triggerRef.current = active instanceof HTMLElement ? active : null;
    setCell(next);
  }, []);

  const close = useCallback(() => {
    const trigger = triggerRef.current;
    triggerRef.current = null;
    setCell(null);
    // A windowed grid can drop the cell while the panel is open; focus the grid
    // rather than leaving focus on a removed node.
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  }, []);

  return { cell, open, close };
}
