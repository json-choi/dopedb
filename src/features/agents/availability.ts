// One readiness rule drives both the chat picker and Agent settings.
import type { AcpPluginStatus, AgentCliInfo } from "./domain";

export function agentReadyForChat(
  plugin: AcpPluginStatus | undefined,
  cli: AgentCliInfo | undefined,
) {
  return Boolean(
    plugin?.enabled &&
    !plugin.failure &&
    ["ready", "staged", "update_available"].includes(plugin.state) &&
    (plugin.installedVersion || plugin.candidateVersion || plugin.lastKnownGoodVersion) &&
    cli?.installed &&
    cli.authenticated &&
    !cli.detectionError,
  );
}
