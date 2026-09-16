import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { QueryResult } from "../../ipc/types";
import type { SqlStreamRowSource } from "../queries/domain";
import type { DataGridFocus } from "./dataGridKeyboard";
import type { GridCellSelection } from "./dataGridSelection";

export function dataGridSelectionResetIdentity(
  result: QueryResult,
  rowSource?: SqlStreamRowSource,
) {
  return {
    materializedResult: rowSource ? null : result,
    operationId: rowSource?.operationId ?? null,
    capability: rowSource?.capability ?? null,
    columnKey: JSON.stringify(result.columns),
  };
}

export function useDataGridSelectionReset({
  result,
  rowSource,
  setSelection,
  setCopyError,
  setFocus,
}: {
  result: QueryResult;
  rowSource?: SqlStreamRowSource;
  setSelection: Dispatch<SetStateAction<GridCellSelection | null>>;
  setCopyError: Dispatch<SetStateAction<string | null>>;
  setFocus: Dispatch<SetStateAction<DataGridFocus>>;
}) {
  const { materializedResult, operationId, capability, columnKey } =
    dataGridSelectionResetIdentity(result, rowSource);

  useEffect(() => {
    setSelection(null);
    setCopyError(null);
    setFocus({ row: 0, column: 0 });
  }, [
    materializedResult,
    operationId,
    capability,
    columnKey,
    setSelection,
    setCopyError,
    setFocus,
  ]);
}
