// Renders ACP plugin lifecycle and the matching official local CLI inventory.
import ConfirmButton from "../../../components/ConfirmButton";
import { Icon } from "../../../components/Icon";
import InfoTip from "../../../components/InfoTip";
import Skeleton from "../../../components/Skeleton";
import { AgentProviderMark } from "../../../design-system/components/Agent";
import { Button } from "../../../design-system/components/Button";
import { CheckboxField } from "../../../design-system/components/FormControls";
import { ProgressBar } from "../../../design-system/components/Progress";
import {
  SettingsList,
  SettingsRow,
  SettingsSectionHeader,
} from "../../../design-system/components/SettingsList";
import { StatusIndicator } from "../../../design-system/components/Status";
import {
  AgentCliDetectionNotice,
  AgentCliStatusIndicators,
} from "../../agents/AgentCliStatus";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import {
  activePluginStates,
  agentToolPlugins,
  pluginStateLabel,
  pluginStateIndicator,
  pluginTone,
} from "./model";
import type { AgentToolsController } from "./useAgentToolsController";

interface AgentPluginSectionProps {
  controller: AgentToolsController;
}

export function AgentPluginSection({ controller }: AgentPluginSectionProps) {
  const { t } = useI18n();
  const {
    busy,
    pluginQuery,
    cliQuery,
    selectedPlugins,
    setSelectedPlugins,
    installPlugins,
    removePlugin,
    togglePlugin,
  } = controller;

  return (
    <>
      <section>
        <SettingsSectionHeader
          title={t("agentTools.pluginsTitle")}
          info={<InfoTip label={t("agentTools.pluginsDescription")} />}
          trailing={(
            <Button
              size="compact"
              variant="primary"
              disabled={busy !== null || selectedPlugins.length === 0}
              onClick={() => void installPlugins(selectedPlugins)}
            >
              {t("agentTools.installSelected", { count: selectedPlugins.length })}
            </Button>
          )}
        />

        {pluginQuery.isPending ? (
          <Skeleton lines={4} />
        ) : pluginQuery.error ? (
          <div className="tw:mt-3 tw:text-ui tw:text-danger" role="alert">
            {t("agentTools.pluginsError", {
              error: errMessage(pluginQuery.error),
            })}
          </div>
        ) : (
          <SettingsList>
            {agentToolPlugins.map((plugin) => {
              const pluginStatus = pluginQuery.data?.find(
                (candidate) => candidate.pluginId === plugin.id,
              );
              if (!pluginStatus) return null;
              const operationActive =
                activePluginStates.has(pluginStatus.state) ||
                busy === plugin.id ||
                busy === "plugin-batch";
              const installed = Boolean(
                pluginStatus.installedVersion ||
                  pluginStatus.candidateVersion ||
                  pluginStatus.lastKnownGoodVersion,
              );
              const selectable =
                !installed ||
                Boolean(pluginStatus.failure) ||
                pluginStatus.state === "update_available" ||
                pluginStatus.state === "rollback_required";
              const activeVersion =
                pluginStatus.candidateVersion ??
                pluginStatus.installedVersion ??
                pluginStatus.lastKnownGoodVersion;
              const versionLabel =
                pluginStatus.state === "update_available" &&
                pluginStatus.availableVersion &&
                pluginStatus.availableReleaseId
                  ? t("agentTools.pluginUpdateIdentity", {
                      version: pluginStatus.availableVersion,
                      release: pluginStatus.availableReleaseId,
                    })
                  : activeVersion && pluginStatus.installedReleaseId
                    ? t("agentTools.pluginInstalledIdentity", {
                        version: activeVersion,
                        release: pluginStatus.installedReleaseId,
                      })
                    : activeVersion;
              const stateIndicator = pluginStateIndicator(pluginStatus.state);
              return (
                <SettingsRow
                  key={plugin.id}
                  identity={
                    <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      {selectable ? (
                        <CheckboxField
                          checked={selectedPlugins.includes(plugin.id)}
                          disabled={busy !== null}
                          onChange={(event) =>
                            setSelectedPlugins((current) =>
                              event.target.checked
                                ? [...new Set([...current, plugin.id])]
                                : current.filter((id) => id !== plugin.id),
                            )
                          }
                          label={
                            <span className="tw:flex tw:items-center tw:gap-2">
                              <AgentProviderMark provider={plugin.provider} />
                              <strong>{plugin.label}</strong>
                            </span>
                          }
                        />
                      ) : (
                        <span className="tw:flex tw:items-center tw:gap-2 tw:pl-6">
                          <AgentProviderMark provider={plugin.provider} />
                          <strong>{plugin.label}</strong>
                        </span>
                      )}
                    </div>
                  }
                  details={
                    <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                      <StatusIndicator
                        tone={pluginTone(pluginStatus.state)}
                        icon={stateIndicator.icon}
                        spinning={stateIndicator.spinning}
                        label={t(pluginStateLabel[pluginStatus.state])}
                      />
                      <span
                        className="tw:min-w-0 tw:truncate tw:font-mono tw:text-xs tw:text-muted-foreground"
                        title={versionLabel ?? plugin.download}
                      >
                        {versionLabel ??
                          t("agentTools.pluginDownload", { size: plugin.download })}
                      </span>
                    </div>
                  }
                  actions={
                    <>
                      {selectable ? (
                        <Button
                          iconOnly
                          size="compact"
                          disabled={busy !== null}
                          onClick={() => void installPlugins([plugin.id])}
                          title={t(
                            pluginStatus.state === "update_available"
                              ? "agentTools.updatePlugin"
                              : installed
                                ? "agentTools.retryPlugin"
                                : "agentTools.installPlugin",
                          )}
                        >
                          <Icon
                            name={
                              pluginStatus.state === "update_available" || installed
                                ? "refresh"
                                : "download"
                            }
                          />
                        </Button>
                      ) : (
                        <Button
                          iconOnly
                          size="compact"
                          disabled={busy !== null}
                          onClick={() =>
                            void togglePlugin(plugin.id, !pluginStatus.enabled)
                          }
                          title={t(
                            pluginStatus.enabled
                              ? "agentTools.disablePlugin"
                              : "agentTools.enablePlugin",
                          )}
                        >
                          <Icon
                            name={pluginStatus.enabled ? "circleSlash" : "play"}
                          />
                        </Button>
                      )}
                      {installed ? (
                        <ConfirmButton
                          iconOnly
                          label={t("agentTools.removePlugin")}
                          size="compact"
                          tone="danger"
                          disabled={busy !== null}
                          confirmLabel={t("agentTools.removePluginConfirm", {
                            provider: plugin.label,
                          })}
                          onConfirm={() => void removePlugin(plugin.id)}
                        >
                          <Icon name="trash" />
                        </ConfirmButton>
                      ) : null}
                    </>
                  }
                >
                  {operationActive ? (
                    <ProgressBar
                      value={null}
                      density="compact"
                      label={t("agentTools.pluginProgress", {
                        provider: plugin.label,
                      })}
                    />
                  ) : null}
                  {pluginStatus.failure ? (
                    <p className="tw:m-0 tw:text-ui tw:text-danger" role="alert">
                      {pluginStatus.failure}
                    </p>
                  ) : null}
                  {pluginStatus.state === "staged" ? (
                    <p className="tw:m-0 tw:text-ui tw:text-muted-foreground">
                      {t("agentTools.pluginStagedDescription")}
                    </p>
                  ) : null}
                  {pluginStatus.state === "update_available" &&
                  pluginStatus.availableVersion &&
                  pluginStatus.availableReleaseId ? (
                    <p className="tw:m-0 tw:text-ui tw:text-muted-foreground">
                      {t("agentTools.pluginUpdateDescription", {
                        version: pluginStatus.availableVersion,
                        release: pluginStatus.availableReleaseId,
                      })}
                    </p>
                  ) : null}
                </SettingsRow>
              );
            })}
          </SettingsList>
        )}
      </section>

      <section className="tw:mt-3">
        <SettingsSectionHeader
          title={t("agentTools.localClisTitle")}
          info={<InfoTip label={t("agentTools.localClisDescription")} />}
        />
        <SettingsList>
          {agentToolPlugins.map((plugin) => {
            const cli = cliQuery.data?.find(
              (item) => item.id === plugin.provider,
            );
            return (
              <SettingsRow
                key={plugin.provider}
                identity={
                  <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:pl-6">
                    <AgentProviderMark provider={plugin.provider} />
                    <strong>{cli?.name ?? plugin.label}</strong>
                  </div>
                }
                details={
                  <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1">
                  <AgentCliStatusIndicators
                    cli={cli}
                    detecting={cliQuery.isPending || cliQuery.isFetching}
                    queryFailed={cliQuery.isError}
                    showDetected
                  />
                  </div>
                }
              />
            );
          })}
        </SettingsList>
        <AgentCliDetectionNotice
          clis={cliQuery.data}
          queryError={cliQuery.error}
          onRetry={() => void cliQuery.refetch()}
          retrying={cliQuery.isFetching}
        />
      </section>
    </>
  );
}
