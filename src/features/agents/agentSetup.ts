// The one vocabulary and action set for Agent adapter setup, shared by the
// startup gate, Settings → Agent tools, and AI Chat's setup guidance: the
// installation-state label, the CLI login command, and the install step.
import type { I18nKey } from "../../lib/i18n";
import type {
  AcpPluginId,
  AcpPluginInstallationState,
  AcpPluginStatus,
  AgentProvider,
} from "./domain";
import { installAgentAcpPlugin, setAgentAcpPluginEnabled } from "./tauriAdapter";

export const pluginStateLabel: Record<AcpPluginInstallationState, I18nKey> = {
  not_installed: "agentTools.pluginState.notInstalled",
  checking: "agentTools.pluginState.checking",
  downloading: "agentTools.pluginState.downloading",
  verifying: "agentTools.pluginState.verifying",
  staged: "agentTools.pluginState.staged",
  ready: "agentTools.pluginState.ready",
  update_available: "agentTools.pluginState.updateAvailable",
  removing: "agentTools.pluginState.removing",
  failed: "agentTools.pluginState.failed",
  rollback_required: "agentTools.pluginState.rollbackRequired",
};

export function loginCommand(provider: AgentProvider) {
  return provider === "claude" ? "claude auth login" : "codex login";
}

export function copyAgentLoginCommand(provider: AgentProvider) {
  return navigator.clipboard.writeText(loginCommand(provider));
}

/**
 * Makes one adapter usable: a verified install is only enabled, anything else
 * (not installed, failed, or an earlier contract) is installed again.
 */
export async function prepareAgentPlugin(
  pluginId: AcpPluginId,
  current: AcpPluginStatus | undefined,
) {
  if ((current?.state === "ready" || current?.state === "staged") && !current.failure) {
    if (!current.enabled) await setAgentAcpPluginEnabled(pluginId, true);
    return;
  }
  await installAgentAcpPlugin(pluginId);
}
