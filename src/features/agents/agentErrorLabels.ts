// Agent failures reach the screen only through stable machine codes from the
// Rust Agent boundary (`code[:cli]` plus an optional detail line). This module
// maps them to product copy and keeps an unrecognized failure's raw text as a
// copyable detail inside the same failure value; no English sentence is ever
// interpreted.

import { errMessage } from "../../ipc/types";
import type { useI18n } from "../../lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];
type MessageKey = Parameters<Translate>[0];

export type StableAgentErrorCode = {
  code: string;
  /** The official CLI involved, when the code names one. */
  param: string | null;
  /** A diagnostic the person may copy; never the main message. */
  detail: string | null;
};

// The Rust error variant prefixes `AppError` adds in front of a stable code.
const ERROR_VARIANT_PREFIX =
  /^(?:agent error|blocked|not found|config error|safety violation|network error|timeout): /;
const STABLE_CODE = /^([a-z][a-z0-9_]*)(?::([a-z0-9_-]+))?(?:\n([\s\S]*))?$/;

/**
 * The stable machine code inside an error or session message (`code[:cli]`
 * plus an optional detail line), after the error variant's prefix. Free text
 * returns `null`.
 */
export function stableAgentErrorCode(message: string): StableAgentErrorCode | null {
  const match = STABLE_CODE.exec(message.replace(ERROR_VARIANT_PREFIX, ""));
  if (!match?.[1]) return null;
  return { code: match[1], param: match[2] ?? null, detail: match[3] ?? null };
}

// Every stable code the Rust Agent boundary produces, mapped to product copy.
const AGENT_ERROR_MESSAGES = new Map<string, MessageKey>([
  ["workspace_authority_changed", "agent.acpInterruptedWorkspaceAuthority"],
  ["connection_authority_changed", "agent.acpInterruptedConnectionAuthority"],
  ["agent_process_closed", "agent.acpInterruptedProcessClosed"],
  ["agent_process_unavailable", "agent.acpInterruptedProcessUnavailable"],
  ["agent_session_metadata_unavailable", "agent.acpInterruptedSessionMetadataUnavailable"],
  ["agent_start_cancelled", "agent.acpStartCancelled"],
  ["agent_session_limit", "agent.acpSessionLimit"],
  ["agent_session_revoked", "agent.acpSqlApprovalRevokedError"],
  ["agent_scope_changed", "agent.acpScopeChanged"],
  ["agent_scope_unverified", "agent.acpScopeUnverified"],
  ["auth_probe_timeout", "agent.acpAuthProbeTimeout"],
  ["agent_cli_missing", "agent.acpNotInstalled"],
  ["agent_cli_not_authenticated", "agent.acpNotAuthenticated"],
  ["agent_cli_node_missing", "agent.acpCliNodeMissing"],
  ["agent_cli_unexpected_version", "agent.acpCliUnexpectedVersion"],
  ["agent_cli_probe_failed", "agent.acpCliProbeFailed"],
  ["agent_start_timed_out", "agent.acpStartTimedOut"],
  ["agent_history_unavailable", "agent.acpHistoryUnavailable"],
  ["agent_not_resumable", "agent.acpNotResumable"],
  ["agent_already_running", "agent.acpAlreadyRunning"],
  ["agent_busy", "agent.acpBusy"],
  ["agent_session_unavailable", "agent.acpSessionUnavailable"],
  ["agent_resources_required", "agent.acpSelectResourcesFirst"],
  ["agent_scope_unavailable", "agent.acpScopeUnavailable"],
  ["agent_editor_context_outside_scope", "agent.acpEditorContextOutsideScope"],
  ["agent_context_too_large", "agent.acpContextTooLarge"],
  ["agent_plugin_disabled", "agent.acpPluginDisabled"],
  ["agent_config_unavailable", "agent.acpConfigUnavailable"],
  ["agent_permission_unavailable", "agent.acpPermissionUnavailable"],
  ["agent_event_dropped", "agent.acpEventDropped"],
  ["agent_authority_revalidating", "agent.acpAuthorityRevalidating"],
]);

function knownAgentErrorLabel(message: string, t: Translate): string | null {
  const parsed = stableAgentErrorCode(message);
  if (!parsed) return null;
  const provider = parsed.param === "codex" ? "Codex" : "Claude";
  if (parsed.code === "agent_provider_error" && parsed.detail) {
    // Text produced by the provider's own CLI is shown inside DopeDB copy;
    // it is the provider's actionable explanation, not a DopeDB sentence.
    return t("agent.acpProviderError", { provider, error: parsed.detail });
  }
  const key = AGENT_ERROR_MESSAGES.get(parsed.code);
  if (!key) return null;
  return t(key, {
    provider,
    command: provider === "Codex" ? "codex login" : "claude auth login",
  });
}

/**
 * A failure as the panel shows it: the sentence, the recognized stable code
 * that may offer a recovery, and raw text to copy.
 */
export type AgentFailure = { message: string; detail: string | null; code: string | null };

function describeAgentError(message: string, t: Translate) {
  const known = knownAgentErrorLabel(message, t);
  if (!known) return { label: t("agent.acpUnexpectedError"), detail: message, code: null };
  const parsed = stableAgentErrorCode(message);
  return { label: known, detail: parsed?.detail ?? null, code: parsed?.code ?? null };
}

/**
 * Maps ACP command failures to product copy by stable code. Unknown text
 * becomes generic copy; callers that can offer the raw text use
 * `agentFailure` instead.
 */
export function agentErrorLabel(message: string, t: Translate) {
  return describeAgentError(message, t).label;
}

/**
 * One panel failure: `sentence` wraps the mapped label in the action's own
 * copy, and the reason's raw text (or its code's detail line) travels in the
 * same value, only for copying.
 */
export function agentFailure(
  reason: unknown,
  t: Translate,
  sentence: (error: string) => string,
): AgentFailure {
  const { label, detail, code } = describeAgentError(errMessage(reason), t);
  return { message: sentence(label), detail, code };
}

/**
 * Session and transcript errors use the same closed mapping. Text that matches
 * no DopeDB code is the provider adapter's own explanation and is kept so the
 * person can act on it.
 */
export function agentSessionErrorLabel(message: string, t: Translate) {
  return knownAgentErrorLabel(message, t) ?? message;
}
