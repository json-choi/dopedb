// Presents one setup path per Agent; optional external use stays in row details.
import { Button } from "../../../design-system/components/Button";
import { AgentPluginSection } from "../../../features/settings/agentTools/AgentPluginSection";
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
    anyCurrent,
    runSelfTest,
    refresh,
  } = controller;

  return (
    <div
      className="tw:w-full tw:max-w-[800px] tw:p-4 tw:@max-[700px]:p-0"
      data-primary-flow
    >
      <AgentPluginSection controller={controller} />
      <div className="ds-control-row tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-[var(--ds-control-gap)]">
        <Button
          size="compact"
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
      {anyCurrent ? (
        <details className="tw:mt-4 tw:text-xs tw:text-muted-foreground">
          <summary className="tw:cursor-pointer tw:hover:text-foreground">{t("agentTools.advancedDiagnostics")}</summary>
          <Button size="compact" disabled={busy !== null} onClick={() => void runSelfTest()}>
            {t("agentTools.selfTest")}
          </Button>
        </details>
      ) : null}
    </div>
  );
}
