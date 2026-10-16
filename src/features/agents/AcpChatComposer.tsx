// The ACP composer renders one bounded state group and delegates every mutation
// to controller-owned command groups. It owns no session/query/transport state.

import type { ReactNode } from "react";

import { Icon } from "../../components/Icon";
import { Button } from "../../design-system/components/Button";
import {
  ToolWindowComposer,
  ToolWindowComposerContext,
  ToolWindowComposerDock,
  ToolWindowComposerInput,
} from "../../design-system/components/ToolWindow";
import { useI18n } from "../../lib/i18n";
import type { ConnectionId } from "../connections/domain";
import { providerLabel } from "./acpTranscriptPresentation";
import { AcpConfigSelect } from "./AcpConfigSelect";
import { AcpScopeSelect } from "./AcpScopeSelect";
import type { AcpChatController } from "./useAcpChatController";

type AcpChatComposerProps = Pick<
  AcpChatController,
  "session" | "setup" | "composer"
> & {
  commands: Pick<
    AcpChatController["commands"],
    "session" | "composer" | "setup"
  >;
  onOpenProjectDatabases: (environmentId: string | null) => void;
  onOpenSafety: (connectionId: ConnectionId) => void;
};

export default function AcpChatComposer({
  session,
  setup,
  composer,
  commands,
  onOpenProjectDatabases,
  onOpenSafety,
}: AcpChatComposerProps) {
  const { t } = useI18n();
  const active = session.active;
  if (!session.activeLive && setup.pluginReadyProviders.length === 0) return null;
  const configDisabled =
    session.starting ||
    active?.lifecycle !== "ready" ||
    composer.configChanging !== null;
  // Only missing prerequisites disable the input. A running turn or a start in
  // progress keeps it enabled so focus and the next draft are never lost;
  // submission is still blocked until the session is ready.
  const composerDisabled =
    !setup.prerequisitesReady || !composer.environmentScopeReady;
  const submitBlocked =
    session.starting ||
    (active !== null &&
      active.lifecycle !== "ready" &&
      active.lifecycle !== "closed" &&
      active.lifecycle !== "failed");
  return (
    <ToolWindowComposerDock>
      {setup.knowledge.unassignedConnectionName && session.transcript.length === 0 ? (
        <ComposerNoticeBar
          message={t("agent.acpUnassignedConnection", {
            connection: setup.knowledge.unassignedConnectionName,
          })}
          action={
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onOpenProjectDatabases(setup.knowledge.assignEnvironmentId)}
            >
              {t("agent.acpAddToProject")}
            </Button>
          }
        />
      ) : null}
      {!session.activeLive && setup.knowledge.needsReconfirmation ? (
        <ComposerNoticeBar
          message={t("agent.acpReconfirmBody")}
          details={setup.knowledge.reconfirmChanges.map((change) =>
            t("agent.acpReconfirmChange", {
              name: change.name,
              from: change.fromRevision,
              to: change.toRevision,
              target: change.target,
            }),
          )}
          action={
            <Button
              size="xs"
              variant="primary"
              disabled={setup.knowledge.reconfirmingEnvironmentId !== null}
              disabledBehavior="focusable"
              onClick={commands.composer.reconfirmResources}
            >
              {t("agent.acpEnvironmentReconfirm")}
            </Button>
          }
        />
      ) : null}
      {active &&
      (active.lifecycle === "closed" || active.lifecycle === "failed") ? (
        <ComposerNoticeBar
          message={
            !setup.prerequisitesReady
              ? t("agent.acpResumeNeedsSetup", {
                  provider: providerLabel(active.provider),
                })
              : active.acpSessionId === null
                ? t("agent.acpRestartBody")
                : t("agent.acpResumeBody")
          }
          action={
          <Button
            size="xs"
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
          }
        />
      ) : null}
      <ToolWindowComposer
        aria-label={t("agent.acpComposer")}
        onSubmit={commands.composer.submit}
        busy={session.busy}
      >
        <div className="tw:relative tw:min-w-0">
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
                if (!submitBlocked) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="tw:pointer-events-none tw:absolute tw:right-1 tw:bottom-1 tw:left-1 tw:flex tw:h-control-sm tw:items-center tw:gap-1">
            {composer.contextLabels.length > 0 ? (
              <span className="tw:pointer-events-auto tw:inline-flex">
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
              </span>
            ) : null}
            <span className="tw:flex-1" />
            <span className="tw:pointer-events-auto tw:inline-flex">
              {active?.lifecycle === "running" ||
              active?.lifecycle === "waitingPermission" ||
              active?.lifecycle === "starting" ? (
                <Button
                  iconOnly
                  size="xs"
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
                  size="xs"
                  variant="ghost"
                  disabled={
                    composerDisabled || submitBlocked || !composer.prompt.trim()
                  }
                  title={t("agent.acpSend")}
                  aria-label={t("agent.acpSend")}
                >
                  <Icon name="send" />
                </Button>
              )}
            </span>
          </div>
        </div>
        {composer.includeEditorContext && composer.contextLabels.length > 0 ? (
          <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:gap-1 tw:px-2 tw:pb-1">
            {composer.contextLabels.map((label) => (
              <span
                key={label.text}
                className="tw:inline-flex tw:h-control-sm tw:max-w-full tw:min-w-0 tw:items-center tw:gap-1 tw:rounded-xs tw:bg-muted tw:px-2 tw:text-xs tw:text-foreground"
                title={label.text}
              >
                <Icon name={label.icon} className="tw:shrink-0" />
                <span className="tw:min-w-0 tw:truncate">{label.text}</span>
              </span>
            ))}
          </div>
        ) : null}
      </ToolWindowComposer>
      <ToolWindowComposerContext>
        <AcpScopeSelect
          knowledge={setup.knowledge}
          starting={session.starting}
          onToggle={(resourceKey) =>
            void commands.composer.selectEnvironment(resourceKey)
          }
          onWriteTarget={(connectionId) =>
            void commands.composer.selectWriteTarget(connectionId)
          }
          onOpenSafety={onOpenSafety}
        />
        {composer.modeOption ? (
          <span className="tw:w-24 tw:min-w-0 tw:shrink-0">
            <AcpConfigSelect
              provider={setup.selectedProvider}
              option={composer.modeOption}
              disabled={configDisabled}
              onChange={(value) =>
                void commands.composer.changeConfigOption(composer.modeOption!, value)
              }
            />
          </span>
        ) : null}
      </ToolWindowComposerContext>
    </ToolWindowComposerDock>
  );
}

/** One status line above the composer with the single command that resolves it. */
function ComposerNoticeBar({
  message,
  details,
  action,
}: {
  message: string;
  /** Specific items the action applies to, listed before the person acts. */
  details?: readonly string[];
  action: ReactNode;
}) {
  return (
    <div
      className="tw:mb-2 tw:flex tw:min-h-control-lg tw:items-center tw:gap-3 tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:px-3 tw:py-2"
      role="status"
    >
      <div className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
        <p className="tw:m-0 tw:min-w-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
          {message}
        </p>
        {details && details.length > 0 ? (
          <ul className="tw:m-0 tw:grid tw:min-w-0 tw:gap-0.5 tw:pl-4 tw:text-xs tw:leading-body tw:text-muted-foreground">
            {details.map((detail) => (
              <li key={detail} className="tw:break-words">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {action}
    </div>
  );
}
