// The AI Chat entry owns render recovery and composes bounded controller groups
// into the existing tool-window views. Session/query/effect ownership lives in
// useAcpChatController; transcript interpretation lives in its presentation model.

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { Icon } from "../../components/Icon";
import ToolbarMenu, {
  ToolbarMenuItem,
} from "../../components/ToolbarMenu";
import { Button } from "../../design-system/components/Button";
import { useModalBehavior } from "../../design-system/components/Modal";
import { ProgressBar } from "../../design-system/components/Progress";
import RenderRecoveryBoundary from "../../design-system/components/RenderRecoveryBoundary";
import {
  InlineNotice,
  StatusDot,
} from "../../design-system/components/Status";
import {
  ToolWindowHeader,
  ToolWindowHideButton,
} from "../../design-system/components/ToolWindow";
import { useI18n } from "../../lib/i18n";
import { reportRenderFailure } from "../monitoring/client";
import AcpChatComposer from "./AcpChatComposer";
import AcpChatTranscript from "./AcpChatTranscript";
import {
  lifecycleLabel,
  lifecycleTone,
} from "./acpTranscriptPresentation";
import {
  agentDockInteraction,
  shouldDismissAgentOverlayFromEscape,
  type AgentDockLayout,
} from "./layout";
import { sessionMetaLabel } from "./sessionPresentation";
import {
  useAcpChatController,
  type AcpChatControllerInput,
} from "./useAcpChatController";

type AcpChatPanelProps = AcpChatControllerInput & {
  onOpenKnowledgeAnalysis: (environmentId: string, articleId?: string) => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

export default function AcpChatPanel(props: AcpChatPanelProps) {
  return (
    <RenderRecoveryBoundary
      fallback={({ retry }) => (
        <AcpChatPanelRecovery
          compact={props.compact ?? false}
          onClose={props.onClose}
          onRetry={retry}
          overlay={props.overlay}
          returnFocusRef={props.returnFocusRef}
        />
      )}
      onError={(error, errorInfo) =>
        reportRenderFailure("ai_chat", error, errorInfo)
      }
      resetKeys={[props.connection.id]}
    >
      <AcpChatPanelContent {...props} />
    </RenderRecoveryBoundary>
  );
}

function AcpChatPanelContent({
  connection,
  connections,
  composerRequest,
  documents,
  activeDocumentId,
  selectedTable,
  overlay,
  compact = false,
  width,
  onWidthChange,
  onOpenKnowledgeAnalysis,
  onClose,
  returnFocusRef,
}: AcpChatPanelProps) {
  const { t } = useI18n();
  const controller = useAcpChatController({
    connection,
    connections,
    composerRequest,
    documents,
    activeDocumentId,
    selectedTable,
    overlay,
    compact,
    width,
    onWidthChange,
  });
  const { viewport, session, setup, composer, feedback, commands } = controller;
  const active = session.active;

  return (
    <AcpChatSurface
      label={t("agent.acpTitle")}
      layout={viewport.layout}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div
        className="tw:absolute tw:inset-y-0 tw:-left-[3px] tw:z-[var(--ds-z-raised)] tw:w-[7px] tw:cursor-col-resize tw:hover:bg-ring/30 tw:active:bg-ring/30 tw:data-[layout=overlay]:hidden tw:data-[layout=compact]:hidden"
        data-layout={viewport.layout}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("app.dragResize")}
        onMouseDown={viewport.resize.onMouseDown}
        onDoubleClick={viewport.resize.onDoubleClick}
      />
      <ToolWindowHeader
        title={t("agent.acpTitle")}
        divider={false}
        actions={
          <>
            <Button
              size="compact"
              variant="ghost"
              data-agent-focus-target="session-control"
              disabled={session.starting}
              onClick={commands.session.beginNewChat}
              title={t("agent.acpNew")}
            >
              <Icon name="plus" />
              {t("agent.acpNew")}
            </Button>
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              aria-pressed={session.historyOpen}
              onClick={commands.session.toggleHistory}
              title={t("agent.acpSessions")}
              aria-label={t("agent.acpSessions")}
            >
              <Icon name="history" />
            </Button>
            <ToolbarMenu
              align="end"
              icon="moreVertical"
              label={t("agent.acpMore")}
            >
              <ToolbarMenuItem
                icon="gear"
                onClick={commands.setup.openAgentSetup}
              >
                {t("agent.acpAgentSetup")}
              </ToolbarMenuItem>
              {active &&
              active.lifecycle !== "closed" &&
              active.lifecycle !== "failed" ? (
                <ToolbarMenuItem
                  icon="trash"
                  onClick={() => void commands.session.close()}
                >
                  {t("agent.acpCloseSession")}
                </ToolbarMenuItem>
              ) : null}
            </ToolbarMenu>
            <ToolWindowHideButton
              label={t("common.close")}
              onClick={onClose}
            />
          </>
        }
      />

      {session.busy ? (
        <div className="tw:mx-6 tw:mt-2 tw:shrink-0">
          <ProgressBar value={null} label={t("agent.acpWorking")} />
        </div>
      ) : null}

      {feedback.error || session.loadError ? (
        <InlineNotice
          tone="danger"
          icon="alert"
          role="alert"
          action={
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              onClick={
                session.loadError
                  ? commands.session.retryLoad
                  : commands.feedback.dismiss
              }
              title={t(session.loadError ? "common.refresh" : "common.close")}
              aria-label={t(
                session.loadError ? "common.refresh" : "common.close",
              )}
            >
              <Icon name={session.loadError ? "refresh" : "close"} />
            </Button>
          }
        >
          {feedback.error ?? session.loadError}
        </InlineNotice>
      ) : null}

      {session.historyOpen ? (
        <section className="tw:grid tw:max-h-[min(360px,45vh)] tw:shrink-0 tw:overflow-auto tw:border-b tw:border-border-subtle tw:bg-background tw:p-1">
          {session.sessions.length > 0 ? (
            session.sessions.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="tw:flex tw:min-h-control-lg tw:min-w-0 tw:items-center tw:gap-2 tw:rounded-xs tw:border-0 tw:bg-transparent tw:px-2 tw:text-left tw:text-sm tw:text-foreground tw:hover:bg-muted tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring tw:data-[active=true]:bg-selection tw:data-[active=true]:text-selection-foreground"
                data-active={candidate.id === active?.id}
                onClick={() => commands.session.select(candidate.id)}
              >
                <Icon
                  name={candidate.knowledgeScopes.length > 0 ? "folder" : "database"}
                />
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">
                  {candidate.title}
                </span>
                <span className="tw:text-xs tw:text-muted-foreground">
                  {sessionMetaLabel(candidate, setup.knowledge.projects)}
                </span>
                <StatusDot tone={lifecycleTone(candidate.lifecycle)} />
                <span className="tw:sr-only">
                  {lifecycleLabel(candidate.lifecycle, t)}
                </span>
              </button>
            ))
          ) : (
            <p className="tw:m-0 tw:px-2 tw:py-3 tw:text-xs tw:text-muted-foreground">
              {t("agent.acpNoSessions")}
            </p>
          )}
        </section>
      ) : null}

      <AcpChatTranscript
        session={session}
        setup={setup}
        viewport={viewport}
        commands={commands}
        connectionEngine={connection.engine}
        onOpenKnowledgeAnalysis={onOpenKnowledgeAnalysis}
      />
      <AcpChatComposer
        session={session}
        setup={setup}
        composer={composer}
        commands={commands}
      />
    </AcpChatSurface>
  );
}

function AcpChatPanelRecovery({
  compact,
  onClose,
  onRetry,
  overlay,
  returnFocusRef,
}: {
  compact: boolean;
  onClose: () => void;
  onRetry: () => void;
  overlay: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  return (
    <AcpChatSurface
      label={t("agent.acpTitle")}
      layout={compact ? "compact" : overlay ? "overlay" : "docked"}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <ToolWindowHeader
        divider={false}
        title={t("agent.acpTitle")}
        actions={
          <ToolWindowHideButton
            label={t("common.close")}
            onClick={onClose}
          />
        }
      />
      <div
        className="tw:m-auto tw:flex tw:w-[min(360px,calc(100%_-_var(--ds-space-6)))] tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:text-center tw:text-sm tw:text-muted-foreground"
        role="alert"
      >
        <Icon className="tw:size-7 tw:text-warning" name="alert" />
        <strong className="tw:text-title tw:text-foreground">
          {t("agent.acpRenderFailed")}
        </strong>
        <p className="tw:m-0 tw:leading-body">
          {t("agent.acpRenderFailedBody")}
        </p>
        <Button
          data-agent-focus-target="recovery"
          data-modal-initial-focus
          onClick={onRetry}
          size="compact"
          variant="primary"
        >
          <Icon name="refresh" />
          {t("agent.acpRenderRetry")}
        </Button>
      </div>
    </AcpChatSurface>
  );
}

function AcpChatSurface({
  children,
  label,
  layout,
  onClose,
  returnFocusRef,
}: {
  children: ReactNode;
  label: string;
  layout: AgentDockLayout;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const surfaceRef = useRef<HTMLElement>(null);
  const interaction = agentDockInteraction(layout);
  useModalBehavior({
    enabled: interaction.shellInert,
    onRequestClose: onClose,
    returnFocusRef,
    surfaceRef,
  });

  useLayoutEffect(() => {
    if (layout !== "overlay") return;
    const surface = surfaceRef.current;
    if (!surface || surface.contains(document.activeElement)) return;
    const preferred =
      surface.querySelector<HTMLElement>(
        "[data-modal-initial-focus]:not(:disabled)",
      ) ??
      surface.querySelector<HTMLElement>(
        "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ??
      surface;
    preferred.focus({ preventScroll: true });
  }, [layout]);

  useLayoutEffect(() => {
    if (layout !== "overlay") return;
    const handleEscape = (event: KeyboardEvent) => {
      const surface = surfaceRef.current;
      if (event.key !== "Escape" || !surface) return;
      const focusInside =
        event.target instanceof Node && surface.contains(event.target);
      const nestedModal =
        event.target instanceof Element &&
        event.target.closest('[role="dialog"][aria-modal="true"]') !== null;
      if (
        !shouldDismissAgentOverlayFromEscape({
          defaultPrevented: event.defaultPrevented,
          focusInside,
          nestedModal,
        })
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [layout, onClose]);

  return (
    <aside
      ref={surfaceRef}
      className="tw:relative tw:col-start-4 tw:row-start-2 tw:mt-0 tw:mr-1 tw:mb-1 tw:ml-0 tw:flex tw:min-w-0 tw:flex-col tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-background tw:data-[layout=overlay]:fixed tw:data-[layout=overlay]:inset-y-0 tw:data-[layout=overlay]:right-0 tw:data-[layout=overlay]:z-[var(--ds-z-modal)] tw:data-[layout=overlay]:m-0 tw:data-[layout=overlay]:w-[min(520px,calc(100vw_-_44px))] tw:data-[layout=overlay]:rounded-none tw:data-[layout=overlay]:shadow-popover tw:data-[layout=compact]:fixed tw:data-[layout=compact]:top-title-toolbar tw:data-[layout=compact]:right-0 tw:data-[layout=compact]:bottom-status-bar tw:data-[layout=compact]:left-0 tw:data-[layout=compact]:z-[var(--ds-z-modal)] tw:data-[layout=compact]:m-0 tw:data-[layout=compact]:w-screen tw:data-[layout=compact]:rounded-none tw:data-[layout=compact]:border-x-0"
      aria-label={label}
      aria-modal={interaction.ariaModal}
      data-agent-surface
      data-layout={layout}
      role={interaction.role}
      tabIndex={-1}
    >
      {children}
    </aside>
  );
}
