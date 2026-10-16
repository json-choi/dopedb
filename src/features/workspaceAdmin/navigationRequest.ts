// Routes "open workspace management" from anywhere in the shell to the one
// shell-owned dialog route; an "account" request opens Settings instead. A one-time
// focus (a database to reveal, or the add-database flow) travels beside the request
// and is taken once by the Providers section, so no screen writes another's state.
import type { WorkspaceAdminScope } from "./domain";
import type { WorkspaceAdminDestination } from "./sections";

const WORKSPACE_ADMIN_REQUEST_EVENT = "dopedb:request-workspace-admin";
const FOCUS_TTL_MS = 60_000;

/** What the Providers section opens when the request arrives. */
export type WorkspaceAdminFocus =
  | { kind: "connection"; connectionId: string }
  | { kind: "addDatabase" };

let pendingFocus: { focus: WorkspaceAdminFocus; requestedAt: number } | null = null;

export function requestWorkspaceAdmin(
  destination: WorkspaceAdminDestination,
  focus?: WorkspaceAdminFocus,
) {
  pendingFocus = focus ? { focus, requestedAt: Date.now() } : null;
  window.dispatchEvent(
    new CustomEvent<WorkspaceAdminDestination>(WORKSPACE_ADMIN_REQUEST_EVENT, {
      detail: destination,
    }),
  );
}

export function onWorkspaceAdminRequested(
  handler: (destination: WorkspaceAdminDestination) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkspaceAdminDestination>).detail);
  };
  window.addEventListener(WORKSPACE_ADMIN_REQUEST_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_ADMIN_REQUEST_EVENT, listener);
}

/** Props every scoped administration panel receives from the Workspace management dialog. */
export interface WorkspaceAdminPanelProps {
  scope: WorkspaceAdminScope;
  /** Moves to another section, or to Settings → Account for "account". */
  onNavigate: (destination: WorkspaceAdminDestination) => void;
}

/** Returns the requested focus once; a stale or superseded focus is discarded. */
export function takePendingWorkspaceAdminFocus(now = Date.now()): WorkspaceAdminFocus | null {
  const pending = pendingFocus;
  pendingFocus = null;
  return pending && now - pending.requestedAt <= FOCUS_TTL_MS ? pending.focus : null;
}
