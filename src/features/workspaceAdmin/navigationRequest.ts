// Routes "open workspace administration" from anywhere in the shell to the one
// shell-owned Settings route. A database focus travels beside the request and is
// taken once by the Providers section, so no screen writes another screen's state.
import type { SettingsSection } from "../settings/domain";
import type { WorkspaceAdminScope } from "./domain";

const WORKSPACE_ADMIN_REQUEST_EVENT = "dopedb:request-workspace-admin";
const FOCUS_TTL_MS = 60_000;

export type WorkspaceAdminSettingsSection = Extract<
  SettingsSection,
  | "account"
  | "workspace-members"
  | "workspace-access"
  | "workspace-providers"
  | "workspace-lifecycle"
>;

let pendingConnectionFocus: { connectionId: string; requestedAt: number } | null = null;

export function requestWorkspaceAdmin(
  section: WorkspaceAdminSettingsSection,
  focus?: { connectionId: string },
) {
  pendingConnectionFocus = focus
    ? { connectionId: focus.connectionId, requestedAt: Date.now() }
    : null;
  window.dispatchEvent(
    new CustomEvent<WorkspaceAdminSettingsSection>(WORKSPACE_ADMIN_REQUEST_EVENT, {
      detail: section,
    }),
  );
}

export function onWorkspaceAdminRequested(
  handler: (section: WorkspaceAdminSettingsSection) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<WorkspaceAdminSettingsSection>).detail);
  };
  window.addEventListener(WORKSPACE_ADMIN_REQUEST_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_ADMIN_REQUEST_EVENT, listener);
}

/** Props every scoped administration panel receives from the Settings shell. */
export interface WorkspaceAdminPanelProps {
  scope: WorkspaceAdminScope;
  /** Moves the open Settings dialog to another administration section. */
  onNavigate: (section: WorkspaceAdminSettingsSection) => void;
}

/** Returns the requested database focus once; a stale focus is discarded. */
export function takePendingConnectionFocus(now = Date.now()): string | null {
  const focus = pendingConnectionFocus;
  pendingConnectionFocus = null;
  return focus && now - focus.requestedAt <= FOCUS_TTL_MS ? focus.connectionId : null;
}
