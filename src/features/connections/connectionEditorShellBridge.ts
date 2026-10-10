// The connection editor's contract with shell navigation. Any surface may ask the
// shell to open a connection's editor at its credential, and an editor opened that
// way goes straight to the fix; the shell consults the leave guard before a route
// replaces the editor, so unsaved edits are confirmed first; and a Workspace
// management request the editor makes itself carries a one-shot marker that keeps
// the editor underneath and returns to it. The editor stays the single owner of
// its draft; the shell never reads it.
import { useEffect, useRef } from "react";

import { useEventCallback } from "../../lib/useEventCallback";
import type { ConnectionEditorDialogs } from "./useConnectionEditorDialogs";
import type { ConnectionProfileState } from "./useConnectionProfileState";

type LeaveGuard = (proceed: () => void) => void;

const RETURN_MARKER_TTL_MS = 5_000;
const CREDENTIAL_REQUEST_EVENT = "dopedb:request-connection-credentials";

/** Asks the shell to open this connection's editor at the credential that fixes it. */
export function requestConnectionCredentials(connectionId: string) {
  window.dispatchEvent(
    new CustomEvent<string>(CREDENTIAL_REQUEST_EVENT, { detail: connectionId }),
  );
}

export function onConnectionCredentialsRequested(
  handler: (connectionId: string) => void,
) {
  const listener = (event: Event) => {
    handler((event as CustomEvent<string>).detail);
  };
  window.addEventListener(CREDENTIAL_REQUEST_EVENT, listener);
  return () => window.removeEventListener(CREDENTIAL_REQUEST_EVENT, listener);
}

let activeGuard: LeaveGuard | null = null;
let returnMarkedAt: number | null = null;

/** The mounted editor registers its guard; the returned function unregisters it. */
export function registerConnectionEditorLeaveGuard(guard: LeaveGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** Keeps the mounted editor's latest guard registered while it is mounted. */
export function useConnectionEditorLeaveGuard(guard: LeaveGuard) {
  const current = useEventCallback(guard);
  useEffect(() => registerConnectionEditorLeaveGuard(current), [current]);
}

/**
 * An editor opened to recover a credential this device no longer holds goes to
 * the fix once: a shared member-local connection opens its binding, and a local
 * profile focuses its password field.
 */
export function useCredentialRecoveryEntry(
  requested: boolean,
  profileState: ConnectionProfileState,
  workspaceDialog: ConnectionEditorDialogs["workspace"],
) {
  const pending = useRef(requested);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const { flags, value } = profileState.form;
    if (
      flags.isSharedTemplate &&
      value.credentialMode === "memberLocal" &&
      value.workspaceAccess !== "view" &&
      value.engine !== "bigquery"
    ) {
      workspaceDialog.setMode("credentials");
      return;
    }
    if (!flags.isSharedTemplate && !flags.isBigQuery && !flags.isCloudflareD1) {
      profileState.tabs.focusField("general", "connection-password");
    }
  }, [workspaceDialog, profileState.form, profileState.tabs]);
}

/** Runs `proceed` now, or after the open editor confirms discarding its edits. */
export function leaveConnectionEditor(proceed: () => void) {
  if (activeGuard) activeGuard(proceed);
  else proceed();
}

/** Marks the next Workspace management request as made by the open editor. */
export function markConnectionEditorReturn(now = Date.now()) {
  returnMarkedAt = now;
}

/** Takes the marker once; a stale marker never redirects a later request. */
export function takeConnectionEditorReturn(now = Date.now()): boolean {
  const markedAt = returnMarkedAt;
  returnMarkedAt = null;
  return markedAt !== null && now - markedAt <= RETURN_MARKER_TTL_MS;
}
