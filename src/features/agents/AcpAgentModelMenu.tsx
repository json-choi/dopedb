// The chat header groups the less frequent provider and model choices in one menu.
// The adapter still owns the advertised model values and their current selection.

import { Icon } from "../../components/Icon";
import ToolbarMenu, { ToolbarMenuItem } from "../../components/ToolbarMenu";
import { AgentProviderMark } from "../../design-system/components/Agent";
import { useI18n } from "../../lib/i18n";
import { configSelectChoices } from "./approvalModePreference";
import { providerLabel } from "./acpTranscriptPresentation";
import type { AcpChatController } from "./useAcpChatController";

export function AcpAgentModelMenu({
  session,
  setup,
  composer,
  commands,
}: Pick<AcpChatController, "session" | "setup" | "composer"> & {
  commands: Pick<AcpChatController["commands"], "setup" | "composer">;
}) {
  const { t } = useI18n();
  const model = composer.modelOption;
  const choices = model ? configSelectChoices(model) : [];
  const selectedModel = choices.find((choice) => choice.value === model?.currentValue);
  const modelLabel = selectedModel?.name ?? (typeof model?.currentValue === "string" ? model.currentValue : null);
  const providerName = providerLabel(setup.selectedProvider);
  const modelDisabled = session.starting || session.active?.lifecycle !== "ready" || composer.configChanging !== null;

  return (
    <span className="tw:w-28 tw:min-w-0">
      <ToolbarMenu
        align="end"
        triggerVariant="composer"
        label={`${t("agent.acpProvider")}: ${providerName}${modelLabel ? ` · ${modelLabel}` : ""}`}
        disabled={session.starting}
        trigger={
          <>
            <AgentProviderMark provider={setup.selectedProvider} />
            <span className="tw:min-w-0 tw:flex-1 tw:truncate" title={modelLabel ? `${providerName} · ${modelLabel}` : providerName}>
              {modelLabel ?? providerName}
            </span>
            <Icon name="chevronDown" />
          </>
        }
      >
        <span className="tw:px-2 tw:pt-1 tw:text-2xs tw:font-semibold tw:text-muted-foreground">
          {t("agent.acpProvider")}
        </span>
        {setup.enabledProviders.map((provider) => (
          <ToolbarMenuItem
            key={provider}
            icon={<AgentProviderMark provider={provider} />}
            role="menuitemradio"
            aria-checked={provider === setup.selectedProvider}
            onClick={() => void commands.setup.changeProvider(provider)}
          >
            {providerLabel(provider)}
          </ToolbarMenuItem>
        ))}
        {model && choices.length > 0 ? (
          <>
            <span className="tw:mt-1 tw:border-t tw:border-border-subtle tw:px-2 tw:pt-2 tw:text-2xs tw:font-semibold tw:text-muted-foreground">
              {model.name}
            </span>
            {choices.map((choice) => (
              <ToolbarMenuItem
                key={choice.value}
                icon={<span aria-hidden="true" className="tw:grid tw:size-3.5 tw:shrink-0 tw:place-items-center">{choice.value === model.currentValue ? <Icon name="check" /> : null}</span>}
                role="menuitemradio"
                aria-checked={choice.value === model.currentValue}
                disabled={modelDisabled}
                title={choice.description}
                onClick={() => void commands.composer.changeConfigOption(model, choice.value)}
              >
                {choice.name}
              </ToolbarMenuItem>
            ))}
          </>
        ) : null}
      </ToolbarMenu>
    </span>
  );
}
