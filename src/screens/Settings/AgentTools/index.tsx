// Composes the bounded Agent plugin, local CLI, and Skill settings.
import InfoTip from "../../../components/InfoTip";
import { Button } from "../../../design-system/components/Button";
import { AgentPluginSection } from "../../../features/settings/agentTools/AgentPluginSection";
import { AgentSkillSection } from "../../../features/settings/agentTools/AgentSkillSection";
import { useAgentToolsController } from "../../../features/settings/agentTools/useAgentToolsController";
import { useI18n } from "../../../lib/i18n";

export default function AgentTools() {
  const { t } = useI18n();
  const controller = useAgentToolsController();
  const {
    busy,
    statusQuery,
    pluginQuery,
    cliQuery,
    combinedSetupPlan,
    anyCurrent,
    runInstall,
    runSelfTest,
    refresh,
  } = controller;

  return (
    <div
      className="tw:w-full tw:max-w-[800px] tw:p-4 tw:@max-[700px]:p-0"
      data-primary-flow
    >
      <div className="tw:inline-flex tw:items-center tw:gap-2">
        <h2>{t("agentTools.title")}</h2>
        <InfoTip label={t("agentTools.description")} />
      </div>

      <AgentPluginSection controller={controller} />
      <AgentSkillSection controller={controller} />
      <div className="ds-control-row tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-[var(--ds-control-gap)]">
        {combinedSetupPlan?.selection ? (
          <Button
            variant="primary"
            data-agent-skill-batch-action={combinedSetupPlan.action}
            disabled={busy !== null}
            onClick={() => void runInstall(combinedSetupPlan.selection!)}
          >
            {t(
              combinedSetupPlan.action === "update"
                ? "agentTools.updateAll"
                : combinedSetupPlan.action === "install-and-update"
                  ? "agentTools.installAndUpdate"
                  : "agentTools.installAll",
            )}
          </Button>
        ) : null}
        {anyCurrent ? (
          <Button disabled={busy !== null} onClick={() => void runSelfTest()}>
            {t("agentTools.selfTest")}
          </Button>
        ) : null}
        <Button
          disabled={
            busy !== null ||
            statusQuery.isFetching ||
            pluginQuery.isFetching ||
            cliQuery.isFetching
          }
          onClick={() => void refresh()}
        >
          {t(
            busy === "plugin-check"
              ? "agentTools.checkingUpdates"
              : "agentTools.checkAgain",
          )}
        </Button>
      </div>
    </div>
  );
}
