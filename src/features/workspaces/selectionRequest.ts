const WORKSPACE_SELECTION_REQUEST_EVENT = "dopedb:request-workspace-selection";

/** Route contextual recovery actions through the shell-owned workspace menu. */
export function requestWorkspaceSelection() {
  window.dispatchEvent(new Event(WORKSPACE_SELECTION_REQUEST_EVENT));
}

export function onWorkspaceSelectionRequested(handler: () => void) {
  window.addEventListener(WORKSPACE_SELECTION_REQUEST_EVENT, handler);
  return () => window.removeEventListener(WORKSPACE_SELECTION_REQUEST_EVENT, handler);
}
