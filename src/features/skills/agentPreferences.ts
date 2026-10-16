// Persists supported Agent target preferences and broadcasts setup requests and changes.

import { useEffect, useState } from "react";

import type { AgentProvider } from "../agents/domain";
import type { SkillTarget } from "../../ipc/types";

const STORAGE_KEY = "dopedb.agent-providers.v1";
/** Set by "Later" so the startup prompt stops covering every launch. */
const SETUP_DEFERRED_KEY = "dopedb.agent-setup-deferred.v1";
const CHANGE_EVENT = "dopedb:agent-providers-changed";
export const OPEN_AGENT_SETUP_EVENT = "dopedb:open-agent-setup";

export const SUPPORTED_AGENT_TARGETS = [
  {
    provider: "claude",
    target: "claude-code",
    label: "Claude",
  },
  {
    provider: "codex",
    target: "codex",
    label: "Codex",
  },
] as const satisfies ReadonlyArray<{
  provider: AgentProvider;
  target: SkillTarget;
  label: string;
}>;

export function hasSavedAgentTargets() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function agentSetupDeferred() {
  try {
    return localStorage.getItem(SETUP_DEFERRED_KEY) !== null;
  } catch {
    return false;
  }
}

/** Agent setup stays reachable from the Agent panel and Settings afterwards. */
export function deferAgentSetup() {
  try {
    localStorage.setItem(SETUP_DEFERRED_KEY, "1");
  } catch {
    // Unavailable storage only means the prompt returns on the next launch.
  }
}

export function loadAgentTargets(): SkillTarget[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set<SkillTarget>(
      SUPPORTED_AGENT_TARGETS.map((entry) => entry.target),
    );
    const targets = parsed.filter(
      (value): value is SkillTarget =>
        typeof value === "string" && allowed.has(value as SkillTarget),
    );
    return [...new Set(targets)];
  } catch {
    return [];
  }
}

export function saveAgentTargets(targets: readonly SkillTarget[]) {
  const allowed = new Set<SkillTarget>(
    SUPPORTED_AGENT_TARGETS.map((entry) => entry.target),
  );
  const normalized = [...new Set(targets.filter((target) => allowed.has(target)))];
  if (normalized.length === 0) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function openAgentSetup() {
  window.dispatchEvent(new Event(OPEN_AGENT_SETUP_EVENT));
}

export function useEnabledAgentProviders(): AgentProvider[] {
  const [providers, setProviders] = useState(() => providersFromTargets());
  useEffect(() => {
    const sync = () => setProviders(providersFromTargets());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return providers;
}

function providersFromTargets() {
  const targets = new Set(loadAgentTargets());
  return SUPPORTED_AGENT_TARGETS.filter((entry) => targets.has(entry.target)).map(
    (entry) => entry.provider,
  );
}
