// ACP transcript events stay protocol-shaped in the session store. This module
// derives bounded, user-facing labels and safe navigation references without
// owning React state, transport calls, or tool-window layout.

import type { StatusTone } from "../../design-system/components/Status";
import { canRenderAgentRichText } from "../../design-system/components/AgentRichText";
import type { useI18n } from "../../lib/i18n";
import type {
  AcpSessionLifecycle,
  AgentProvider,
} from "./domain";
import type { AcpTranscriptItem } from "./transcript";

const MAX_RICH_TRANSCRIPT_MESSAGES = 12;
const MAX_RICH_TRANSCRIPT_CHARS = 192 * 1024;
const MAX_RICH_TRANSCRIPT_LINES = 2_400;

type Translate = ReturnType<typeof useI18n>["t"];

export type AnalysisArticleReference = {
  id: string;
  projectEnvironmentId: string;
};

export function showProviderHeading(
  items: readonly AcpTranscriptItem[],
  index: number,
) {
  const item = items[index];
  if (!item || item.kind === "user" || item.kind === "turnEnd") return false;
  const previous = items[index - 1];
  return (
    previous === undefined ||
    previous.kind === "user" ||
    previous.kind === "turnEnd"
  );
}

export function selectRichTranscriptKeys(
  items: readonly AcpTranscriptItem[],
) {
  const selected = new Set<string>();
  let messages = 0;
  let characters = 0;
  let lines = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (
      messages >= MAX_RICH_TRANSCRIPT_MESSAGES ||
      characters >= MAX_RICH_TRANSCRIPT_CHARS ||
      lines >= MAX_RICH_TRANSCRIPT_LINES
    ) {
      break;
    }
    const item = items[index];
    if (!item || item.kind !== "agent") continue;
    if (!canRenderAgentRichText(item.chunks)) continue;
    const itemCharacters = item.chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );
    const itemLines = item.chunks.reduce(
      (total, chunk) => total + countLineBreaks(chunk),
      1,
    );
    if (
      characters + itemCharacters > MAX_RICH_TRANSCRIPT_CHARS ||
      lines + itemLines > MAX_RICH_TRANSCRIPT_LINES
    ) {
      break;
    }
    selected.add(item.key);
    messages += 1;
    characters += itemCharacters;
    lines += itemLines;
  }
  return selected;
}

function countLineBreaks(value: string) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

export function findAnalysisArticle(
  value: unknown,
  depth = 0,
): AnalysisArticleReference | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === "string") {
    try {
      return findAnalysisArticle(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findAnalysisArticle(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const article = record.article;
  if (article && typeof article === "object" && !Array.isArray(article)) {
    const candidate = article as Record<string, unknown>;
    if (
      typeof candidate.id === "string"
      && typeof candidate.projectEnvironmentId === "string"
      && /^[0-9a-f-]{36}$/i.test(candidate.id)
      && /^[0-9a-f-]{36}$/i.test(candidate.projectEnvironmentId)
    ) {
      return {
        id: candidate.id,
        projectEnvironmentId: candidate.projectEnvironmentId,
      };
    }
  }
  for (const key of [
    "result",
    "data",
    "output",
    "rawOutput",
    "content",
    "text",
  ] as const) {
    const found = findAnalysisArticle(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

export function recordString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function contentText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  return block.type === "text" && typeof block.text === "string"
    ? block.text
    : null;
}

export function toolContentText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.text === "string") return [record.text];
    if (record.content) {
      const nested = contentText(record.content);
      return nested ? [nested] : [];
    }
    return [];
  });
  return text.length > 0 ? text.join("\n") : null;
}

export function toolStatusLabel(status: string, t: Translate) {
  if (status === "completed") return t("agent.acpToolStatusCompleted");
  if (status === "failed" || status === "error") {
    return t("agent.acpToolStatusFailed");
  }
  if (status === "in_progress" || status === "running") {
    return t("agent.acpToolStatusRunning");
  }
  if (status === "cancelled") return t("agent.acpTurnCancelled");
  return t("agent.acpToolStatusPending");
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function planEntryLabel(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return String(entry);
  }
  const record = entry as Record<string, unknown>;
  return (
    (typeof record.content === "string" && record.content) ||
    (typeof record.title === "string" && record.title) ||
    safeJson(record)
  );
}

export function providerLabel(provider: AgentProvider) {
  return provider === "claude" ? "Claude Agent" : "Codex";
}

export function loginCommand(provider: AgentProvider) {
  return provider === "claude" ? "claude auth login" : "codex login";
}

export function lifecycleTone(lifecycle: AcpSessionLifecycle): StatusTone {
  if (lifecycle === "ready") return "success";
  if (lifecycle === "running" || lifecycle === "waitingPermission") {
    return "warning";
  }
  if (lifecycle === "failed") return "danger";
  return "neutral";
}

export function toolStatusTone(status: string): StatusTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "in_progress") return "warning";
  return "neutral";
}

export function lifecycleLabel(
  lifecycle: AcpSessionLifecycle,
  t: Translate,
) {
  return t(`agent.acpLifecycle.${lifecycle}` as Parameters<typeof t>[0]);
}

export function agentSessionErrorLabel(message: string, t: Translate) {
  if (message === "workspace_authority_changed") {
    return t("agent.acpInterruptedWorkspaceAuthority");
  }
  if (message === "connection_authority_changed") {
    return t("agent.acpInterruptedConnectionAuthority");
  }
  if (message === "agent_process_closed") {
    return t("agent.acpInterruptedProcessClosed");
  }
  if (message === "agent_process_unavailable") {
    return t("agent.acpInterruptedProcessUnavailable");
  }
  if (message === "agent_session_metadata_unavailable")
    return t("agent.acpInterruptedSessionMetadataUnavailable");
  return message;
}

export function stopReasonLabel(reason: string, t: Translate) {
  if (reason === "cancelled") return t("agent.acpTurnCancelled");
  if (reason === "refusal") return t("agent.acpTurnRefused");
  if (reason === "max_tokens" || reason === "max_turn_requests") {
    return t("agent.acpTurnLimited");
  }
  return t("agent.acpTurnComplete");
}
