// Remembers only a user-selected ACP mode for one workspace/account and provider,
// and carries an in-panel model choice to a replacement session. A new session
// applies either only when its official adapter advertises that exact value.

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
  await applyAdvertisedChoice(focus, "mode", value);
}

/**
 * Carries a model the person chose in this panel to the session that replaces
 * a prepared one (for example after a resource change). Not persisted, and
 * applied only when the new session's adapter advertises the same value.
 */
export async function applyPanelModelChoice(
  focus: AcpSessionFocus,
  value: string | undefined,
) {
  if (!value) return;
  await applyAdvertisedChoice(focus, "model", value);
}

async function applyAdvertisedChoice(
  focus: AcpSessionFocus,
  category: "mode" | "model",
  value: string,
) {
  const configuration = [...focus.events].reverse().find(
    (event) => event.type === "sessionConfiguration",
  );
  if (configuration?.type !== "sessionConfiguration") return;
  const option = configuration.configOptions.find(
    (candidate) => candidate.category === category && candidate.type === "select",
  );
  if (!option || option.currentValue === value) return;
  if (!configSelectChoices(option).some((choice) => choice.value === value)) return;
  await setAgentAcpConfigOption(focus.session.id, option.id, value);
}
