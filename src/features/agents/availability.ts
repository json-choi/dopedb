// One readiness rule drives both the chat picker and Agent settings. The chat
// connection (plugin) and the local CLI sign-in are separate so AI Chat can show
// the exact setup step that is missing instead of a generic "not ready".
import type { AcpPluginStatus, AgentCliInfo } from "./domain";

export function agentPluginReady(plugin: AcpPluginStatus | undefined) {
  return Boolean(
    plugin?.enabled &&
    !plugin.failure &&
    ["ready", "staged", "update_available"].includes(plugin.state) &&
    (plugin.installedVersion || plugin.candidateVersion || plugin.lastKnownGoodVersion),
  );
}

export function agentCliReady(cli: AgentCliInfo | undefined) {
  return Boolean(cli?.installed && cli.authenticated && !cli.detectionError);
}

export function agentReadyForChat(
  plugin: AcpPluginStatus | undefined,
  cli: AgentCliInfo | undefined,
) {
  return agentPluginReady(plugin) && agentCliReady(cli);
}
