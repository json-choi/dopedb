// One row per Agent combines in-app readiness with optional external setup details.
import { openUrl } from "@tauri-apps/plugin-opener";

import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import Skeleton from "../../../components/Skeleton";
import { useToast } from "../../../components/Toast";
import { AgentProviderMark } from "../../../design-system/components/Agent";
import { Button } from "../../../design-system/components/Button";
import { ProgressBar } from "../../../design-system/components/Progress";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { StatusIndicator } from "../../../design-system/components/Status";
import { errMessage } from "../../../ipc/types";
import { AGENT_SETUP_URLS } from "../../../lib/externalLinks";
import { useI18n } from "../../../lib/i18n";
import {
  AgentCliDetectionNotice,
  AgentCliStatusIndicators,
} from "../../agents/AgentCliStatus";
import type { AcpPluginStatus, AgentCliInfo } from "../../agents/domain";
import { SUPPORTED_AGENT_TARGETS, useEnabledAgentProviders } from "../../skills/agentPreferences";
import { AgentSkillSection } from "./AgentSkillSection";
import {
  activePluginStates,
  agentToolPlugins,
  pluginStateIndicator,
  pluginStateLabel,
  pluginTone,
} from "./model";
import type { AgentToolsController } from "./useAgentToolsController";

function agentStatus(
  plugin: AcpPluginStatus,
  cli: AgentCliInfo | undefined,
  cliPending: boolean,
  cliFailed: boolean,
) {
  if (activePluginStates.has(plugin.state)) return { key: pluginStateLabel[plugin.state], icon: "refresh" as const, tone: "warning" as const, spinning: true };
  if (plugin.failure || plugin.state === "failed" || plugin.state === "rollback_required") return { key: "agentTools.agentSetupFailed" as const, icon: "alert" as const, tone: "danger" as const, spinning: false };
  if (plugin.state === "not_installed" || !plugin.enabled) return { key: "agentTools.agentNotReady" as const, icon: "download" as const, tone: "warning" as const, spinning: false };
  if (cliPending) return { key: "agentTools.detecting" as const, icon: "refresh" as const, tone: "neutral" as const, spinning: true };
  if (cliFailed || !cli || cli.detectionError) return { key: "agentTools.detectionFailed" as const, icon: "alert" as const, tone: "danger" as const, spinning: false };
  if (!cli.installed) return { key: "agentTools.cliMissing" as const, icon: "terminal" as const, tone: "warning" as const, spinning: false };
  if (!cli.authenticated) return { key: "agentTools.notAuthenticated" as const, icon: "user" as const, tone: "warning" as const, spinning: false };
  if (plugin.state === "update_available") return { key: "agentTools.pluginState.updateAvailable" as const, icon: "refresh" as const, tone: "warning" as const, spinning: false };
  return { key: "agentTools.agentReady" as const, icon: "check" as const, tone: "success" as const, spinning: false };
}

export function AgentPluginSection({ controller }: { controller: AgentToolsController }) {
  const { t } = useI18n();
  const toast = useToast();
  const enabledProviders = useEnabledAgentProviders();
  const { busy, pluginQuery, cliQuery, prepareAgent, removePlugin, togglePlugin } = controller;

  async function openGuide(provider: "claude" | "codex") {
    try {
      await openUrl(AGENT_SETUP_URLS[provider]);
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  return (
    <section>
      <SettingsSectionHeader title={t("agentTools.agentsTitle")} />
      <p className="tw:mt-0 tw:mb-3 tw:text-ui tw:text-muted-foreground">
        {t("agentTools.agentsDescription")}
      </p>
      {pluginQuery.isPending ? <Skeleton lines={4} /> : pluginQuery.error ? (
        <p className="tw:text-ui tw:text-danger" role="alert">
          {t("agentTools.pluginsError", { error: errMessage(pluginQuery.error) })}
        </p>
      ) : (
        <SettingsList>
          {agentToolPlugins.map((agent) => {
            const plugin = pluginQuery.data?.find((entry) => entry.pluginId === agent.id);
            if (!plugin) return null;
            const target = SUPPORTED_AGENT_TARGETS.find((entry) => entry.provider === agent.provider);
            if (!target) return null;
            const cli = cliQuery.data?.find((entry) => entry.id === agent.provider);
            const state = agentStatus(plugin, cli, cliQuery.isPending || cliQuery.isFetching, cliQuery.isError);
            const selected = enabledProviders.includes(agent.provider);
            const installed = Boolean(plugin.installedVersion || plugin.candidateVersion || plugin.lastKnownGoodVersion);
            const needsPlugin = !selected || !installed || !plugin.enabled || Boolean(plugin.failure) || plugin.state === "rollback_required";
            const needsCli = selected && installed && plugin.enabled && !cliQuery.isPending && !cliQuery.isFetching && !cliQuery.isError && cli && (!cli.installed || !cli.authenticated);
            const busyAgent = busy === agent.id || activePluginStates.has(plugin.state);
            return (
              <SettingsRow
                key={agent.id}
                identity={
                  <span className="tw:flex tw:items-center tw:gap-2">
                    <AgentProviderMark provider={agent.provider} />
                    <strong>{agent.label}</strong>
                  </span>
                }
                details={
                  <span className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                    <StatusIndicator
                      tone={!selected && state.key === "agentTools.agentReady" ? "neutral" : state.tone}
                      icon={!selected && state.key === "agentTools.agentReady" ? "circleSlash" : state.icon}
                      spinning={state.spinning}
                      label={t(!selected && state.key === "agentTools.agentReady" ? "agentTools.agentNotSelected" : state.key)}
                    />
                    <span className="tw:truncate tw:text-ui tw:text-muted-foreground">
                      {t(!selected && state.key === "agentTools.agentReady" ? "agentTools.agentNotSelected" : state.key)}
                    </span>
                  </span>
                }
                actions={needsPlugin || plugin.state === "update_available" ? (
                  <Button
                    size="compact"
                    disabled={busy !== null || busyAgent}
                    onClick={() => void prepareAgent(agent.id)}
                  >
                    {t(
                      installed && plugin.enabled && !selected && plugin.state !== "update_available"
                        ? "agentTools.useAgent"
                        : plugin.state === "update_available"
                          ? "agentTools.update"
                          : "agentTools.prepareAgent",
                    )}
                  </Button>
                ) : needsCli ? (
                  <Button size="compact" disabled={busy !== null} onClick={() => void openGuide(agent.provider)}>
                    {t(cli?.installed ? "agentTools.loginGuide" : "agentTools.setupGuide")}
                  </Button>
                ) : undefined}
              >
                {busyAgent ? (
                  <ProgressBar value={null} density="compact" label={t("agentTools.preparingAgent", { provider: agent.label })} />
                ) : null}
                {plugin.failure ? <p className="tw:m-0 tw:text-ui tw:text-danger" role="alert">{plugin.failure}</p> : null}
                <details className="tw:group tw:mt-1">
                  <summary className="tw:cursor-pointer tw:text-xs tw:text-muted-foreground tw:hover:text-foreground">
                    {t("agentTools.agentDetails")}
                  </summary>
                  <div className="tw:mt-3 tw:grid tw:gap-3">
                    <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
                        <strong className="tw:text-ui">{t("agentTools.localRuntime")}</strong>
                        <AgentCliStatusIndicators
                          cli={cli}
                          detecting={cliQuery.isPending || cliQuery.isFetching}
                          queryFailed={cliQuery.isError}
                          showDetected
                        />
                      </div>
                      {cli && (!cli.installed || !cli.authenticated) ? (
                        <Button size="compact" variant="ghost" onClick={() => void openGuide(agent.provider)}>
                          {t(cli.installed ? "agentTools.loginGuide" : "agentTools.setupGuide")}
                        </Button>
                      ) : null}
                    </div>
                    <AgentSkillSection controller={controller} target={target.target} />
                    <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-t tw:border-border-subtle tw:pt-3">
                      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
                        <strong className="tw:text-ui">{t("agentTools.connectionComponent")}</strong>
                        <StatusIndicator
                          tone={pluginTone(plugin.state)}
                          icon={pluginStateIndicator(plugin.state).icon}
                          label={t(pluginStateLabel[plugin.state])}
                        />
                        {plugin.installedVersion ? <code className="tw:text-xs tw:text-muted-foreground">{plugin.installedVersion}</code> : null}
                      </div>
                      {installed ? (
                        <span className="tw:flex tw:items-center tw:gap-2">
                          <Button
                            size="compact"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => void togglePlugin(agent.id, !plugin.enabled)}
                          >
                            {t(plugin.enabled ? "agentTools.disablePlugin" : "agentTools.enablePlugin")}
                          </Button>
                          <ConfirmButton
                            iconOnly
                            label={t("agentTools.removePlugin")}
                            size="compact"
                            tone="danger"
                            disabled={busy !== null}
                            confirmLabel={t("agentTools.removePluginConfirm", { provider: agent.label })}
                            onConfirm={() => void removePlugin(agent.id)}
                          >
                            <Icon name="trash" />
                          </ConfirmButton>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </details>
              </SettingsRow>
            );
          })}
        </SettingsList>
      )}
      <AgentCliDetectionNotice
        clis={cliQuery.data}
        queryError={cliQuery.error}
        onRetry={() => void cliQuery.refetch()}
        retrying={cliQuery.isFetching}
      />
    </section>
  );
}
