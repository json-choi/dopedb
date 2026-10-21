// Routes workspace and Agent account requests to the shell's single Settings owner.
import { useEffect } from "react";
import { useEventCallback } from "../../lib/useEventCallback";
import type { SettingsSection } from "./domain";

const ACCOUNT_SETTINGS_REQUEST_EVENT = "dopedb:request-account-settings";
type AccountSettingsSection = Extract<SettingsSection, "account" | "agent-tools">;

export function requestAccountSettings() {
  request("account");
}

export function requestAgentAccountSettings() {
  request("agent-tools");
}

function request(section: AccountSettingsSection) {
  window.dispatchEvent(new CustomEvent(ACCOUNT_SETTINGS_REQUEST_EVENT, { detail: section }));
}

export function useAccountSettingsRequests(open: (section: AccountSettingsSection) => void) {
  const handleRequest = useEventCallback(open);
  useEffect(() => {
    const receive = (event: Event) => {
      if (event instanceof CustomEvent && (event.detail === "account" || event.detail === "agent-tools")) {
        handleRequest(event.detail);
      }
    };
    window.addEventListener(ACCOUNT_SETTINGS_REQUEST_EVENT, receive);
    return () => window.removeEventListener(ACCOUNT_SETTINGS_REQUEST_EVENT, receive);
  }, [handleRequest]);
}
