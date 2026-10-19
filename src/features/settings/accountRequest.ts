// Routes "open Settings → Account" from anywhere (account menu, expired-session
// recovery, a scheduled deletion) to the shell, which owns the Settings route (`useShellDialogRequests` answers it).
import { useEffect } from "react";
import { useEventCallback } from "../../lib/useEventCallback";

const ACCOUNT_SETTINGS_REQUEST_EVENT = "dopedb:request-account-settings";

export function requestAccountSettings() {
  window.dispatchEvent(new Event(ACCOUNT_SETTINGS_REQUEST_EVENT));
}

function onAccountSettingsRequested(handler: () => void) {
  window.addEventListener(ACCOUNT_SETTINGS_REQUEST_EVENT, handler);
  return () => window.removeEventListener(ACCOUNT_SETTINGS_REQUEST_EVENT, handler);
}

/** Lets the shell, which owns the Settings route (`useShellDialogRequests` answers it). answer those requests. */
export function useAccountSettingsRequests(open: () => void) {
  const handleRequest = useEventCallback(open);
  useEffect(() => onAccountSettingsRequested(handleRequest), [handleRequest]);
}
