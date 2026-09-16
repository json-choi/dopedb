// Owns view-keyed table selection, filtering, sorting, paging, and staged-edit state.

import { useEffect, useReducer } from "react";

import type { GridSort } from "../../lib/sqlBuild";
import type {
  StagedWrite,
  TableDataState,
} from "./domain";

type TableDataAction =
  | { type: "reset"; viewKey: string }
  | { type: "patch"; patch: Partial<TableDataState> }
  | { type: "filter"; column: string; value: string }
  | { type: "settleFilters" }
  | { type: "cycleSort"; column: string }
  | { type: "stage"; write: StagedWrite }
  | { type: "removeStaged"; id: string };

export function initialTableDataState(viewKey: string): TableDataState {
  return {
    viewKey,
    writeError: null,
    page: 0,
    sort: null,
    filters: {},
    appliedFilters: {},
    whereExpression: "",
    appliedWhereExpression: "",
    orderByExpression: "",
    appliedOrderByExpression: "",
    selectedRow: null,
    selectedCell: null,
    editor: null,
    staged: [],
    reviewing: false,
    proposal: null,
    running: false,
    pendingDelete: null,
    structureOpen: false,
    jobsOpen: false,
  };
}

export function tableDataReducer(
  state: TableDataState,
  action: TableDataAction,
): TableDataState {
  switch (action.type) {
    case "reset":
      return initialTableDataState(action.viewKey);
    case "patch":
      return { ...state, ...action.patch };
    case "filter":
      return {
        ...state,
        filters: { ...state.filters, [action.column]: action.value },
      };
    case "settleFilters":
      return {
        ...state,
        appliedFilters: state.filters,
        page: 0,
      };
    case "cycleSort":
      return {
        ...state,
        sort: nextSort(state.sort, action.column),
        page: 0,
      };
    case "stage":
      return {
        ...state,
        staged: [...state.staged, action.write],
        editor: null,
        selectedCell: null,
        reviewing: false,
        proposal: null,
      };
    case "removeStaged":
      return {
        ...state,
        staged: state.staged.filter((change) => change.id !== action.id),
      };
  }
}

function nextSort(sort: GridSort | null, column: string): GridSort | null {
  if (!sort || sort.col !== column) return { col: column, dir: "asc" };
  return sort.dir === "asc" ? { col: column, dir: "desc" } : null;
}

export function useTableDataState(viewKey: string) {
  const [state, dispatch] = useReducer(
    tableDataReducer,
    viewKey,
    initialTableDataState,
  );
  const viewChanged = state.viewKey !== viewKey;
  const activeState = viewChanged ? initialTableDataState(viewKey) : state;
  useEffect(() => {
    if (viewChanged) dispatch({ type: "reset", viewKey });
  }, [viewChanged, viewKey]);

  return {
    state: activeState,
    commands: {
      patch: (patch: Partial<TableDataState>) =>
        dispatch({ type: "patch", patch }),
      filter: (column: string, value: string) =>
        dispatch({ type: "filter", column, value }),
      settleFilters: () => dispatch({ type: "settleFilters" }),
      cycleSort: (column: string) =>
        dispatch({ type: "cycleSort", column }),
      stage: (write: StagedWrite) => dispatch({ type: "stage", write }),
      removeStaged: (id: string) =>
        dispatch({ type: "removeStaged", id }),
    },
  };
}

type PageState = { viewKey: string; page: number };
type PageAction =
  | { type: "reset"; viewKey: string }
  | { type: "select"; page: number };

function pageReducer(state: PageState, action: PageAction): PageState {
  return action.type === "reset"
    ? { viewKey: action.viewKey, page: 0 }
    : { ...state, page: action.page };
}

export function useTablePageState(viewKey: string) {
  const [state, dispatch] = useReducer(pageReducer, {
    viewKey,
    page: 0,
  });
  if (state.viewKey !== viewKey) {
    dispatch({ type: "reset", viewKey });
  }
  return [
    state.page,
    (page: number) => dispatch({ type: "select", page }),
  ] as const;
}
