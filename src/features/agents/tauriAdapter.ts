import { invoke } from "../../ipc/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ConnectionId } from "../connections/domain";
import type {
  AcpPromptContext,
  AcpPluginId,
  AcpPluginMutationReceipt,
  AcpPluginStatus,
  AcpSessionChanged,
  AcpSessionFocus,
  AcpSessionId,
  AcpSessionSummary,
  AgentCliInfo,
  AgentKnowledgeEnvironment,
  AgentProvider,
  AgentResourceScopeSelection,
} from "./domain";

export function listAgentAcpPlugins(): Promise<AcpPluginStatus[]> {
  return invoke("list_agent_acp_plugins");
}

export function checkAgentAcpPluginUpdates(): Promise<AcpPluginStatus[]> {
  return invoke("check_agent_acp_plugin_updates");
}

export function installAgentAcpPlugin(
  pluginId: AcpPluginId,
): Promise<AcpPluginMutationReceipt> {
  return invoke("install_agent_acp_plugin", { pluginId });
}

export function removeAgentAcpPlugin(
  pluginId: AcpPluginId,
): Promise<AcpPluginMutationReceipt> {
  return invoke("remove_agent_acp_plugin", { pluginId });
}

export function setAgentAcpPluginEnabled(
  pluginId: AcpPluginId,
  enabled: boolean,
): Promise<AcpPluginStatus> {
  return invoke("set_agent_acp_plugin_enabled", { pluginId, enabled });
}

export function startAgentAcpSession(
  connectionId: ConnectionId,
  provider: AgentProvider,
  resourceScopes: AgentResourceScopeSelection[],
  writeConnectionId: ConnectionId | null,
): Promise<AcpSessionFocus> {
  return invoke("start_agent_acp_session", {
    connectionId,
    provider,
    resourceScopes,
    writeConnectionId,
  });
}

export function listAgentKnowledgeEnvironments(
  connectionId: ConnectionId,
): Promise<AgentKnowledgeEnvironment[]> {
  return invoke("list_agent_knowledge_environments", { connectionId });
}

export function resumeAgentAcpSession(
  id: AcpSessionId,
): Promise<AcpSessionFocus> {
  return invoke("resume_agent_acp_session", { id });
}

export function listAgentAcpSessions(): Promise<AcpSessionSummary[]> {
  return invoke("list_agent_acp_sessions");
}

export function focusAgentAcpSession(
  id: AcpSessionId,
  afterSequence?: number,
): Promise<AcpSessionFocus> {
  return invoke("focus_agent_acp_session", {
    id,
    afterSequence: afterSequence ?? null,
  });
}

export function promptAgentAcpSession(
  id: AcpSessionId,
  prompt: string,
  context: AcpPromptContext,
): Promise<void> {
  return invoke("prompt_agent_acp_session", {
    id,
    prompt,
    context,
  });
}

export function cancelAgentAcpSession(id: AcpSessionId): Promise<void> {
  return invoke("cancel_agent_acp_session", { id });
}

export function respondAgentAcpPermission(
  id: AcpSessionId,
  requestId: string,
  optionId: string | null,
): Promise<void> {
  return invoke("respond_agent_acp_permission", {
    id,
    requestId,
    optionId,
  });
}

export function closeAgentAcpSession(id: AcpSessionId): Promise<void> {
  return invoke("close_agent_acp_session", { id });
}

export function setAgentAcpConfigOption(
  id: AcpSessionId,
  configId: string,
  value: string,
): Promise<void> {
  return invoke("set_agent_acp_config_option", {
    id,
    configId,
    value,
  });
}

/** Opens an Agent-supplied external link only after native validation and consent. */
export function openAgentExternalLink(
  href: string,
  language: "en" | "ko",
): Promise<boolean> {
  return invoke("open_agent_external_link", { href, language });
}

export function onAgentAcpChanged(
  listener: (event: AcpSessionChanged) => void,
): Promise<UnlistenFn> {
  return listen<AcpSessionChanged>("agent-acp:changed", (event) =>
    listener(event.payload)
  );
}

/** Detects local Agent CLI readiness without reading or transferring credentials. */
export function detectAgentClis(): Promise<AgentCliInfo[]> {
  return invoke("detect_agent_clis");
}
