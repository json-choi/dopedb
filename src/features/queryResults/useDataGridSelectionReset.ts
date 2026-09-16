// Both result renderers clear cell selection and focus on the same signal: the grid
// now shows a different result. A selection is row/column coordinates into the rows
// on screen, so a new result, a page turn, or a new streaming operation leaves the
// old coordinates pointing at data the user never selected — and ⌘C would copy it.
import { useEffect, useEffectEvent } from "react";

export type DataGridResultIdentity = {
  /** The result object the renderer was handed; callers keep it stable per result. */
  result: unknown;
  /** Operation owning the streamed rows, when the renderer reads pages. */
  operationId: string | null;
  /** Stable key for the current column set. */
  columnKey: string;
  /** Absolute number of the first row on screen; a page turn moves it. */
  startIndex: number;
};

export function useDataGridSelectionReset(
  identity: DataGridResultIdentity,
  onReset: () => void,
) {
  const reset = useEffectEvent(onReset);
  useEffect(() => {
    reset();
  }, [
    identity.result,
    identity.operationId,
    identity.columnKey,
    identity.startIndex,
  ]);
}
