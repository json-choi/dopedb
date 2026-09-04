// The ACP composer renders one bounded state group and delegates every mutation
// to controller-owned command groups. It owns no session/query/transport state.

import { Icon } from "../../components/Icon";
import { AgentProviderMark } from "../../design-system/components/Agent";
import { Button } from "../../design-system/components/Button";
import { InlineSelect } from "../../design-system/components/FormControls";
import {
  ToolWindowComposer,
  ToolWindowComposerContext,
  ToolWindowComposerDock,
  ToolWindowComposerInput,
} from "../../design-system/components/ToolWindow";
import { useI18n } from "../../lib/i18n";
import { AcpScopeSelect } from "./AcpScopeSelect";
import type {
  AcpSessionConfigOption,
  AgentProvider,
} from "./domain";
import type { AcpChatController } from "./useAcpChatController";

type AcpChatComposerProps = Pick<
  AcpChatController,
  "session" | "setup" | "composer"
> & {
  commands: Pick<
    AcpChatController["commands"],
    "session" | "composer" | "setup"
  >;
};

export default function AcpChatComposer({
  session,
  setup,
  composer,
  commands,
}: AcpChatComposerProps) {
  const { t } = useI18n();
  const active = session.active;
  if (setup.enabledProviders.length === 0) return null;
  const composerDisabled =
    session.starting ||
    !setup.prerequisitesReady ||
    !composer.environmentScopeReady ||
    (active !== null &&
      active.lifecycle !== "ready" &&
      active.lifecycle !== "closed" &&
      active.lifecycle !== "failed");
  return (
    <ToolWindowComposerDock>
      {active &&
      (active.lifecycle === "closed" || active.lifecycle === "failed") ? (
        <div className="tw:mb-2 tw:flex tw:min-h-control-lg tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2">
          <p className="tw:m-0 tw:min-w-0 tw:flex-1 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {active.acpSessionId === null
              ? t("agent.acpRestartBody")
              : t("agent.acpResumeBody")}
          </p>
          <Button
            size="compact"
            variant="primary"
            disabled={
              session.starting ||
              !setup.prerequisitesReady ||
              (active.acpSessionId === null && !setup.knowledge.newScopeReady)
            }
            onClick={() =>
              void (active.acpSessionId === null
                ? commands.session.start()
                : commands.session.resume())
            }
          >
            <Icon
              name={session.starting ? "refresh" : "play"}
              data-loading={session.starting || undefined}
              className="tw:data-[loading=true]:animate-spin tw:motion-reduce:animate-none"
            />
            {active.acpSessionId === null
              ? t("agent.acpNew")
              : t("agent.acpResume")}
          </Button>
        </div>
      ) : null}
      <ToolWindowComposer
        aria-label={t("agent.acpComposer")}
        onSubmit={commands.composer.submit}
        expanded={composer.expanded}
        busy={session.busy}
      >
        <ToolWindowComposerInput
          data-agent-focus-target="composer"
          data-modal-initial-focus={composerDisabled ? undefined : true}
          value={composer.prompt}
          maxLength={composer.maxPromptChars}
          disabled={composerDisabled}
          placeholder={
            session.busy ? t("agent.acpWaiting") : t("agent.acpPrompt")
          }
          aria-label={t("agent.acpPrompt")}
          onChange={(event) => commands.composer.setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <span className="tw:absolute tw:top-1.5 tw:right-1.5">
          <Button
            type="button"
            iconOnly
            size="xs"
            variant="ghost"
            onClick={commands.composer.toggleExpanded}
            title={
              composer.expanded
                ? t("agent.acpCollapseComposer")
                : t("agent.acpExpandComposer")
            }
            aria-label={
              composer.expanded
                ? t("agent.acpCollapseComposer")
                : t("agent.acpExpandComposer")
            }
          >
            <Icon name={composer.expanded ? "minimize" : "maximize"} />
          </Button>
        </span>
        {composer.includeEditorContext && composer.contextLabels.length > 0 ? (
          <div className="tw:flex tw:flex-wrap tw:gap-1 tw:px-2 tw:pb-1">
            {composer.contextLabels.map((label) => (
              <span
                key={label.text}
                className="tw:inline-flex tw:h-control-sm tw:max-w-full tw:items-center tw:gap-1 tw:rounded-xs tw:bg-muted tw:px-2 tw:text-xs tw:text-foreground"
                title={label.text}
              >
                <Icon name={label.icon} />
                <span className="tw:truncate">{label.text}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="tw:flex tw:min-h-control-lg tw:items-center tw:gap-1 tw:px-2">
          {composer.contextLabels.length > 0 ? (
            <Button
              type="button"
              iconOnly
              size="xs"
              variant="ghost"
              aria-pressed={composer.includeEditorContext}
              onClick={commands.composer.toggleEditorContext}
              title={
                composer.includeEditorContext
                  ? t("agent.acpDetachContext")
                  : t("agent.acpAttachContext")
              }
              aria-label={
                composer.includeEditorContext
                  ? t("agent.acpDetachContext")
                  : t("agent.acpAttachContext")
              }
            >
              <Icon name="plus" />
            </Button>
          ) : null}
          <span className="tw:flex-1" />
          {active?.lifecycle === "running" ||
          active?.lifecycle === "waitingPermission" ? (
            <Button
              iconOnly
              size="compact"
              variant="ghost"
              tone="danger"
              onClick={() => void commands.session.cancelTurn()}
              title={t("agent.acpCancel")}
              aria-label={t("agent.acpCancel")}
            >
              <Icon name="stop" />
            </Button>
          ) : (
            <Button
              type="submit"
              iconOnly
              size="compact"
              variant="ghost"
              disabled={
                session.starting ||
                !setup.prerequisitesReady ||
                !composer.environmentScopeReady ||
                (active !== null &&
                  active.lifecycle !== "ready" &&
                  active.lifecycle !== "closed" &&
                  active.lifecycle !== "failed") ||
                !composer.prompt.trim()
              }
              title={t("agent.acpSend")}
              aria-label={t("agent.acpSend")}
            >
              <Icon name="send" />
            </Button>
          )}
        </div>
      </ToolWindowComposer>
      <ToolWindowComposerContext>
        <AgentProviderMark provider={setup.selectedProvider} />
        <span className="tw:max-w-[10rem]">
          <InlineSelect
            value={setup.selectedProvider}
            disabled={session.starting}
            onChange={(event) =>
              void commands.setup.changeProvider(
                event.target.value as AgentProvider,
              )
            }
            aria-label={t("agent.acpProvider")}
            title={t("agent.acpLocalAuth")}
          >
            {setup.enabledProviders.includes("claude") ? (
              <option value="claude">Claude Agent</option>
            ) : null}
            {setup.enabledProviders.includes("codex") ? (
              <option value="codex">Codex</option>
            ) : null}
          </InlineSelect>
        </span>
        {composer.modelOption ? (
          <ConfigSelect
            option={composer.modelOption}
            changing={composer.configChanging === composer.modelOption.id}
            onChange={(value) =>
              void commands.composer.changeConfigOption(
                composer.modelOption!,
                value,
              )
            }
          />
        ) : null}
        <AcpScopeSelect
          knowledge={setup.knowledge}
          starting={session.starting}
          onToggle={(resourceKey) =>
            void commands.composer.selectEnvironment(resourceKey)
          }
          onWriteTarget={(connectionId) =>
            void commands.composer.selectWriteTarget(connectionId)
          }
        />
      </ToolWindowComposerContext>
    </ToolWindowComposerDock>
  );
}

function ConfigSelect({
  option,
  changing,
  onChange,
}: {
  option: AcpSessionConfigOption;
  changing: boolean;
  onChange: (value: string) => void;
}) {
  const options = flattenConfigSelectOptions(option);
  if (typeof option.currentValue !== "string" || options.length === 0) {
    return null;
  }
  return (
    <span className="tw:max-w-[11rem]">
      <InlineSelect
        value={option.currentValue}
        disabled={changing}
        onChange={(event) => onChange(event.target.value)}
        aria-label={option.name}
        title={option.description ?? option.name}
      >
        {options.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.name}
          </option>
        ))}
      </InlineSelect>
    </span>
  );
}

function flattenConfigSelectOptions(option: AcpSessionConfigOption) {
  if (!Array.isArray(option.options)) return [];
  return option.options.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  );
}
