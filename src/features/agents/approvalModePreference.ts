// Remembers only a user-selected ACP mode for one workspace/account and provider.
// A new session applies it only when its official adapter advertises that value.

import type {
  AcpSessionConfigOption,
  AcpSessionFocus,
  AgentProvider,
} from "./domain";
import { setAgentAcpConfigOption } from "./tauriAdapter";

const STORAGE_PREFIX = "dopedb.agent-approval-mode.v1";

function storageKey(scopeKey: string, provider: AgentProvider) {
  return `${STORAGE_PREFIX}:${scopeKey}:${provider}`;
}

export function configSelectChoices(option: AcpSessionConfigOption) {
  return option.options?.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  ) ?? [];
}

function savedMode(scopeKey: string, provider: AgentProvider) {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(storageKey(scopeKey, provider));
  } catch {
    return null;
  }
}

export function rememberAcpMode(
  scopeKey: string,
  provider: AgentProvider,
  value: string,
) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(scopeKey, provider), value);
  } catch {
    // A storage failure leaves the current session's explicit selection intact.
  }
}

export async function applyRememberedAcpMode(
  focus: AcpSessionFocus,
  scopeKey: string,
) {
  const value = savedMode(scopeKey, focus.session.provider);
  if (!value) return;
  const configuration = [...focus.events].reverse().find(
    (event) => event.type === "sessionConfiguration",
  );
  if (configuration?.type !== "sessionConfiguration") return;
  const mode = configuration.configOptions.find(
    (option) => option.category === "mode" && option.type === "select",
  );
  if (!mode || mode.currentValue === value) return;
  if (!configSelectChoices(mode).some((choice) => choice.value === value)) return;
  await setAgentAcpConfigOption(focus.session.id, mode.id, value);
}
