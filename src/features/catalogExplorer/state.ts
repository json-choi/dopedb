import { useReducer } from "react";

import type {
  CatalogExplorerState,
  DdlDialogState,
  WorkspaceDialogState,
} from "./domain";
import type { CatalogLoadIssue } from "./catalogDomain";

type CatalogExplorerAction =
  | { type: "scopeChanged"; scopeKey: string }
  | { type: "patch"; patch: Partial<CatalogExplorerState> }
  | { type: "want"; id: string }
  | { type: "forget"; id: string }
  | { type: "toggleConnection"; id: string }
  | { type: "openConnection"; id: string }
  | { type: "clearRefreshError"; id: string }
  | { type: "setRefreshError"; id: string; issue: CatalogLoadIssue }
  | { type: "toggleObjectSection"; key: string }
  | { type: "toggleCollapsedSection"; key: string };

export function isCatalogSearchResultActive(
  resultKey: string | undefined,
  activeResultKey: string | null | undefined,
) {
  return resultKey !== undefined && activeResultKey === resultKey;
}

export function initialCatalogExplorerState(
  scopeKey: string,
): CatalogExplorerState {
  return {
    scopeKey,
    wanted: new Set(),
    refreshErrors: {},
    openConnections: new Set(),
    refreshingId: null,
    deletingId: null,
    collapsedSections: new Set(),
    objectSectionsOpen: new Set(),
    showRowCounts: true,
    openMenuId: null,
    workspaceDialog: null,
    ddlDialog: null,
  };
}

export function catalogExplorerReducer(
  state: CatalogExplorerState,
  action: CatalogExplorerAction,
): CatalogExplorerState {
  switch (action.type) {
    case "scopeChanged":
      return initialCatalogExplorerState(action.scopeKey);
    case "patch":
      return { ...state, ...action.patch };
    case "want":
      return state.wanted.has(action.id)
        ? state
        : { ...state, wanted: new Set(state.wanted).add(action.id) };
    case "forget": {
      if (!state.wanted.has(action.id)) return state;
      const wanted = new Set(state.wanted);
      wanted.delete(action.id);
      return { ...state, wanted };
    }
    case "toggleConnection":
      return {
        ...state,
        openConnections: toggled(state.openConnections, action.id),
      };
    case "openConnection":
      return state.openConnections.has(action.id)
        ? state
        : {
            ...state,
            openConnections: new Set(state.openConnections).add(action.id),
          };
    case "clearRefreshError": {
      if (!(action.id in state.refreshErrors)) return state;
      const refreshErrors = { ...state.refreshErrors };
      delete refreshErrors[action.id];
      return { ...state, refreshErrors };
    }
    case "setRefreshError":
      return {
        ...state,
        refreshErrors: {
          ...state.refreshErrors,
          [action.id]: action.issue,
        },
      };
    case "toggleObjectSection":
      return {
        ...state,
        objectSectionsOpen: toggled(
          state.objectSectionsOpen,
          action.key,
        ),
      };
    case "toggleCollapsedSection":
      return {
        ...state,
        collapsedSections: toggled(
          state.collapsedSections,
          action.key,
        ),
      };
  }
}

function toggled(values: Set<string>, value: string) {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function useCatalogExplorerState(scopeKey: string) {
  const [state, dispatch] = useReducer(
    catalogExplorerReducer,
    scopeKey,
    initialCatalogExplorerState,
  );
  if (state.scopeKey !== scopeKey) {
    dispatch({ type: "scopeChanged", scopeKey });
  }

  return {
    state,
    commands: {
      patch: (patch: Partial<CatalogExplorerState>) =>
        dispatch({ type: "patch", patch }),
      want: (id: string) => dispatch({ type: "want", id }),
      forget: (id: string) => dispatch({ type: "forget", id }),
      toggleConnection: (id: string) =>
        dispatch({ type: "toggleConnection", id }),
      openConnection: (id: string) =>
        dispatch({ type: "openConnection", id }),
      clearRefreshError: (id: string) =>
        dispatch({ type: "clearRefreshError", id }),
      setRefreshError: (id: string, issue: CatalogLoadIssue) =>
        dispatch({ type: "setRefreshError", id, issue }),
      toggleObjectSection: (key: string) =>
        dispatch({ type: "toggleObjectSection", key }),
      toggleCollapsedSection: (key: string) =>
        dispatch({ type: "toggleCollapsedSection", key }),
      openWorkspaceDialog: (workspaceDialog: WorkspaceDialogState) =>
        dispatch({ type: "patch", patch: { workspaceDialog } }),
      openDdlDialog: (ddlDialog: DdlDialogState) =>
        dispatch({ type: "patch", patch: { ddlDialog } }),
    },
  };
}
