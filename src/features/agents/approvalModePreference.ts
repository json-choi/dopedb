// Owns workspace/account-scoped draft model and mode choices. Remembered modes
// and in-panel models apply only when the official adapter advertises the value.

import { useCallback, useState } from "react";

import type {
  AcpSessionConfigOption,
  AcpSessionFocus,
  AgentProvider,
} from "./domain";
import { setAgentAcpConfigOption } from "./tauriAdapter";

const STORAGE_PREFIX = "dopedb.agent-approval-mode.v1";
type PanelChoices = Partial<Record<"mode" | "model", string>>;
type ProviderChoices = Partial<Record<AgentProvider, PanelChoices>>;
const EMPTY_CHOICES: ProviderChoices = {};

export function useAcpPanelConfigChoices(scopeKey: string) {
  const [state, setState] = useState<{ scopeKey: string; choices: ProviderChoices }>({ scopeKey, choices: {} });
  const choose = useCallback((provider: AgentProvider, category: "mode" | "model", value: string) => {
    setState((current) => {
      const choices = current.scopeKey === scopeKey ? current.choices : EMPTY_CHOICES;
      return { scopeKey, choices: { ...choices, [provider]: { ...choices[provider], [category]: value } } };
    });
  }, [scopeKey]);
  return { choices: state.scopeKey === scopeKey ? state.choices : EMPTY_CHOICES, choose };
}

function storageKey(scopeKey: string, provider: AgentProvider) {
  return `${STORAGE_PREFIX}:${scopeKey}:${provider}`;
}

export function configSelectChoices(option: AcpSessionConfigOption) {
  return option.options?.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  ) ?? [];
}

/** Drafts reuse only values actually advertised by a prior session's adapter. */
export function draftAcpConfigOptions(
  options: readonly AcpSessionConfigOption[],
  choices: PanelChoices | undefined,
  scopeKey: string,
  provider: AgentProvider,
) {
  return options.map((option) => {
    const value = option.category === "model" ? choices?.model
      : option.category === "mode" ? choices?.mode ?? savedMode(scopeKey, provider) : undefined;
    return value && option.type === "select" && configSelectChoices(option).some((choice) => choice.value === value)
      ? { ...option, currentValue: value } : option;
  });
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
 * a prior one (for example after a resource change). Not persisted, and
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
