// Renders ACP plugin lifecycle and the matching official local CLI inventory.
import ConfirmButton from "../../../components/ConfirmButton";
import Skeleton from "../../../components/Skeleton";
import { AgentProviderMark } from "../../../design-system/components/Agent";
import { Button } from "../../../design-system/components/Button";
import { CheckboxField } from "../../../design-system/components/FormControls";
import { ProgressBar } from "../../../design-system/components/Progress";
import { StatusBadge } from "../../../design-system/components/Status";
import {
  AgentCliDetectionNotice,
  AgentCliStatusBadges,
} from "../../agents/AgentCliStatus";
import { errMessage } from "../../../ipc/types";
import { useI18n } from "../../../lib/i18n";
import {
  activePluginStates,
  agentToolPlugins,
  pluginStateLabel,
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
      <section className="tw:mt-5 tw:border-t tw:border-border-subtle tw:pt-5">
        <div className="tw:flex tw:items-start tw:justify-between tw:gap-4 tw:@max-[520px]:flex-col">
          <div>
            <h3 className="tw:m-0">{t("agentTools.pluginsTitle")}</h3>
            <p className="tw:mt-1 tw:mb-0 tw:text-muted-foreground">
              {t("agentTools.pluginsDescription")}
            </p>
          </div>
          <Button
            variant="primary"
            disabled={busy !== null || selectedPlugins.length === 0}
            onClick={() => void installPlugins(selectedPlugins)}
          >
            {t("agentTools.installSelected", { count: selectedPlugins.length })}
          </Button>
        </div>

        {pluginQuery.isPending ? (
          <Skeleton lines={4} />
        ) : pluginQuery.error ? (
          <div className="tw:mt-3 tw:text-ui tw:text-danger" role="alert">
            {t("agentTools.pluginsError", {
              error: errMessage(pluginQuery.error),
            })}
          </div>
        ) : (
          <div className="tw:mt-3 tw:divide-y tw:divide-border-subtle tw:border-y tw:border-border-subtle">
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
              return (
                <div className="tw:grid tw:gap-3 tw:py-4" key={plugin.id}>
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-4 tw:@max-[520px]:flex-col tw:@max-[520px]:items-start">
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
                        <span className="tw:flex tw:items-center tw:gap-2">
                          <AgentProviderMark provider={plugin.provider} />
                          <strong>{plugin.label}</strong>
                        </span>
                      )}
                      <StatusBadge tone={pluginTone(pluginStatus.state)}>
                        {t(pluginStateLabel[pluginStatus.state])}
                      </StatusBadge>
                    </div>
                    <span className="tw:text-ui tw:text-muted-foreground">
                      {versionLabel ??
                        t("agentTools.pluginDownload", { size: plugin.download })}
                    </span>
                  </div>
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
                  <div className="ds-control-row tw:flex tw:flex-wrap tw:items-center tw:gap-[var(--ds-control-gap)]">
                    {selectable ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => void installPlugins([plugin.id])}
                      >
                        {t(
                          pluginStatus.state === "update_available"
                            ? "agentTools.updatePlugin"
                            : installed
                              ? "agentTools.retryPlugin"
                              : "agentTools.installPlugin",
                        )}
                      </Button>
                    ) : (
                      <Button
                        disabled={busy !== null}
                        onClick={() =>
                          void togglePlugin(plugin.id, !pluginStatus.enabled)
                        }
                      >
                        {t(
                          pluginStatus.enabled
                            ? "agentTools.disablePlugin"
                            : "agentTools.enablePlugin",
                        )}
                      </Button>
                    )}
                    {installed ? (
                      <ConfirmButton
                        disabled={busy !== null}
                        confirmLabel={t("agentTools.removePluginConfirm", {
                          provider: plugin.label,
                        })}
                        onConfirm={() => void removePlugin(plugin.id)}
                      >
                        {t("agentTools.removePlugin")}
                      </ConfirmButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="tw:border-t tw:border-border-subtle tw:pt-5 tw:pb-2">
        <h3 className="tw:m-0">{t("agentTools.localClisTitle")}</h3>
        <p className="tw:mt-1 tw:mb-0 tw:text-muted-foreground">
          {t("agentTools.localClisDescription")}
        </p>
        <div className="tw:mt-3 tw:divide-y tw:divide-border-subtle tw:border-y tw:border-border-subtle">
          {agentToolPlugins.map((plugin) => {
            const cli = cliQuery.data?.find(
              (item) => item.id === plugin.provider,
            );
            return (
              <div
                className="tw:flex tw:items-start tw:justify-between tw:gap-4 tw:py-3 tw:@max-[520px]:flex-col"
                key={plugin.provider}
              >
                <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
                  <AgentProviderMark provider={plugin.provider} />
                  <strong>{cli?.name ?? plugin.label}</strong>
                </div>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <AgentCliStatusBadges
                    cli={cli}
                    detecting={cliQuery.isPending || cliQuery.isFetching}
                    queryFailed={cliQuery.isError}
                    showDetected
                  />
                </div>
              </div>
            );
          })}
        </div>
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
