import { useEffect, useState } from "react";

import type { AgentProvider } from "../agents/domain";
import type { SkillTarget } from "../../ipc/types";

const STORAGE_KEY = "dopedb.agent-providers.v1";
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

export function loadAgentTargets(): SkillTarget[] {
  if (typeof localStorage === "undefined") return defaultTargets();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return SUPPORTED_AGENT_TARGETS.map((entry) => entry.target);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultTargets();
    const allowed = new Set<SkillTarget>(
      SUPPORTED_AGENT_TARGETS.map((entry) => entry.target),
    );
    const targets = parsed.filter(
      (value): value is SkillTarget =>
        typeof value === "string" && allowed.has(value as SkillTarget),
    );
    return targets.length > 0 ? [...new Set(targets)] : defaultTargets();
  } catch {
    return defaultTargets();
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

function defaultTargets(): SkillTarget[] {
  return SUPPORTED_AGENT_TARGETS.map((entry) => entry.target);
}
