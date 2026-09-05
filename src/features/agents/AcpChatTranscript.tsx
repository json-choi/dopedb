// The ACP transcript view renders controller-owned session/setup groups and
// presentation-only event models. It owns no asynchronous query or transport
// lifecycle, so replay and focus ordering remain in useAcpChatController.

import { Fragment, memo, type ReactNode } from "react";

import { Icon } from "../../components/Icon";
import {
  AgentActivityLine,
  AgentPermissionCard,
  AgentProviderMark,
  AgentToolCallCard,
} from "../../design-system/components/Agent";
import {
  AgentPlainText,
  AgentRichText,
  AgentStreamingText,
} from "../../design-system/components/AgentRichText";
import { Button } from "../../design-system/components/Button";
import {
  InlineNotice,
  LoadingLabel,
  StatusDot,
} from "../../design-system/components/Status";
import { useI18n } from "../../lib/i18n";
import type { ConnectionEngine } from "../connections/domain";
import { reportRenderFailure } from "../monitoring/client";
import AcpSqlApproval from "./AcpSqlApproval";
import AcpStructuredResult from "./AcpStructuredResult";
import {
  agentSessionErrorLabel,
  findAnalysisArticle,
  loginCommand,
  planEntryLabel,
  providerLabel,
  recordString,
  safeJson,
  showProviderHeading,
  stopReasonLabel,
  toolContentText,
  toolStatusLabel,
  toolStatusTone,
} from "./acpTranscriptPresentation";
import { toolActivityLabel } from "./acpActivityLabels";
import type { AcpPermissionOption, AgentProvider } from "./domain";
import { findAgentSqlProposal, isSqlProposalTool } from "./sqlProposal";
import {
  closedBeforeTurnCompleted,
  type AcpTranscriptItem,
} from "./transcript";
import type { AcpChatController } from "./useAcpChatController";

type AcpChatTranscriptProps = Pick<AcpChatController, "session" | "setup"> & {
  viewport: Pick<
    AcpChatController["viewport"],
    "transcriptRef" | "onTranscriptScroll"
  >;
  commands: Pick<
    AcpChatController["commands"],
    "setup" | "permission" | "links"
  >;
  connectionEngine: ConnectionEngine;
  onOpenKnowledgeAnalysis: (environmentId: string, articleId?: string) => void;
};

export default function AcpChatTranscript({
  session,
  setup,
  viewport,
  commands,
  connectionEngine,
  onOpenKnowledgeAnalysis,
}: AcpChatTranscriptProps) {
  const { t } = useI18n();
  const active = session.active;
  const activeError = active?.error
    ? agentSessionErrorLabel(active.error, t)
    : null;
  const transcriptContainsActiveError = Boolean(
    active?.error && session.transcript.some(
      (item) => item.kind === "error" && item.message === active.error,
    ),
  );
  const incompleteClosedTurn = Boolean(
    active && closedBeforeTurnCompleted(
      active.lifecycle,
      active.error,
      session.transcript,
    ),
  );
  return (
    <div
      ref={viewport.transcriptRef}
      className="tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:bg-background tw:px-6 tw:pt-10 tw:pb-5"
      aria-live="polite"
      onScroll={viewport.onTranscriptScroll}
    >
      {session.loading ||
      setup.cliPending ||
      setup.pluginPending ||
      (!active && setup.knowledge.pending) ||
      (active && !session.activeEventsLoaded) ? (
        <AgentEmpty>
          <LoadingLabel>{t("common.loading")}</LoadingLabel>
        </AgentEmpty>
      ) : session.starting && !active ? (
        <AgentEmpty>
          <LoadingLabel>{t("agent.acpStarting")}</LoadingLabel>
        </AgentEmpty>
      ) : !setup.selectedPluginReady ? (
        <AgentEmpty>
          <Icon name="gear" />
          <strong>{t("agent.acpPluginRequired")}</strong>
          <p>{t("agent.acpPluginRequiredBody")}</p>
          <Button
            size="compact"
            variant="primary"
            onClick={commands.setup.openAgentSetup}
          >
            {t("agent.acpOpenSetup")}
          </Button>
        </AgentEmpty>
      ) : setup.cliDetectionError ? (
        <AgentEmpty>
          <Icon name="alert" />
          <strong>{t("agentTools.detectionFailed")}</strong>
          <p>
            {t("agentTools.detectError", {
              error: setup.cliDetectionError,
            })}
          </p>
          <Button
            size="compact"
            variant="ghost"
            disabled={setup.cliFetching}
            onClick={() => void commands.setup.refreshCli()}
          >
            <Icon
              name="refresh"
              data-loading={setup.cliFetching || undefined}
              className="tw:data-[loading=true]:animate-spin tw:motion-reduce:animate-none"
            />
            {t("agentTools.checkAgain")}
          </Button>
        </AgentEmpty>
      ) : setup.selectedCliStatus && !setup.selectedCliReady ? (
        <AgentSetupGuidance
          cli={setup.selectedCliStatus}
          copied={setup.copiedSetupCommand === setup.selectedProvider}
          checking={setup.cliFetching}
          onPrimary={() =>
            void (setup.selectedCliStatus?.installed
              ? commands.setup.copyLoginCommand(setup.selectedProvider)
              : commands.setup.openSetupGuide(setup.selectedProvider))
          }
          onCheck={() => void commands.setup.refreshCli()}
        />
      ) : !active && setup.knowledge.loadError ? (
        <AgentEmpty>
          <Icon name="alert" />
          <strong>{t("agent.acpEnvironmentLoadFailed")}</strong>
          <p>
            {t("agent.acpEnvironmentLoadFailedBody", {
              error: setup.knowledge.loadError,
            })}
          </p>
          <Button
            size="compact"
            variant="ghost"
            onClick={() =>
              void commands.setup.refreshKnowledgeEnvironments()
            }
          >
            <Icon name="refresh" />
            {t("agentTools.checkAgain")}
          </Button>
        </AgentEmpty>
      ) : !active &&
        setup.knowledge.projects.length === 0 ? (
        <AgentEmpty>
          <Icon name="folder" />
          <strong>{t("agent.acpEnvironmentRequired")}</strong>
          <p>{t("agent.acpEnvironmentRequiredBody")}</p>
        </AgentEmpty>
      ) : !active ? (
        <AgentEmpty>
          <h2 className="tw:sr-only">{t("agent.acpEmptyTitle")}</h2>
          <ul className="tw:m-0 tw:grid tw:w-full tw:max-w-[18rem] tw:gap-3 tw:p-0 tw:text-left tw:list-none">
            <li>{t("agent.acpEmptyFeatureSql")}</li>
            <li>{t("agent.acpEmptyFeatureInspect")}</li>
            <li>{t("agent.acpEmptyFeatureApprove")}</li>
          </ul>
        </AgentEmpty>
      ) : session.transcript.length === 0 ? (
        <AgentEmpty>
          {active.lifecycle === "starting" ? (
            <LoadingLabel>{t("agent.acpStarting")}</LoadingLabel>
          ) : active.lifecycle === "failed" ? (
            <>
              <Icon name="alert" />
              <strong>{t("agent.acpFailed")}</strong>
              <p>{activeError}</p>
            </>
          ) : (
            <>
              <Icon name="database" />
              <strong>{t("agent.acpReadyTitle")}</strong>
              <p>{t("agent.acpReadyBody")}</p>
            </>
          )}
        </AgentEmpty>
      ) : (
        <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-6 tw:overflow-hidden">
          {session.replayTruncated ? (
            <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:leading-body tw:text-muted-foreground">
              <Icon name="history" />
              <span>{t("agent.acpReplayTruncated")}</span>
            </div>
          ) : null}
          {session.transcript.map((item, index) => (
            <Fragment key={item.key}>
              {showProviderHeading(session.transcript, index) ? (
                <ProviderHeading provider={active.provider} />
              ) : null}
              <TranscriptItemView
                item={item}
                revision={item.revision}
                debugDetails={session.debugDetails}
                richText={session.richTranscriptKeys.has(item.key)}
                streaming={
                  active.lifecycle === "running" &&
                  item.kind === "agent" &&
                  index === session.transcript.length - 1
                }
                pendingPermissionId={session.pendingPermissionId}
                permissionSubmitting={session.permissionSubmitting}
                onPermission={commands.permission.respond}
                onOpenLink={commands.links.openMessage}
                onOpenKnowledgeAnalysis={onOpenKnowledgeAnalysis}
                expectedConnectionId={active.writeConnectionId ?? ""}
                expectedConnectionEngine={connectionEngine}
              />
            </Fragment>
          ))}
          {active.lifecycle === "failed" && activeError && !transcriptContainsActiveError ? (
            <InlineNotice tone="danger" icon="alert" role="alert">
              {activeError}
            </InlineNotice>
          ) : null}
          {incompleteClosedTurn ? (
            <InlineNotice tone="warning" icon="alert" role="status">
              {t("agent.acpClosedBeforeTurnCompleted")}
            </InlineNotice>
          ) : null}
          {active.lifecycle === "running" ? (
            <div className="tw:flex tw:items-center tw:gap-2 tw:py-1 tw:text-xs tw:text-muted-foreground">
              <StatusDot tone="success" />
              {t("agent.acpWorking")}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AgentEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="tw:m-auto tw:flex tw:min-h-full tw:w-[min(360px,calc(100%_-_var(--ds-space-6)))] tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:text-center tw:text-sm tw:text-muted-foreground tw:[&>.icon]:size-7 tw:[&>.icon]:text-foreground tw:[&>strong]:text-title tw:[&>strong]:text-foreground tw:[&>p]:m-0 tw:[&>p]:leading-body tw:[&>small]:max-w-[320px] tw:[&>small]:leading-body">
      {children}
    </div>
  );
}

function AgentSetupGuidance({
  cli,
  copied,
  checking,
  onPrimary,
  onCheck,
}: {
  cli: NonNullable<AcpChatController["setup"]["selectedCliStatus"]>;
  copied: boolean;
  checking: boolean;
  onPrimary: () => void;
  onCheck: () => void;
}) {
  const { t } = useI18n();
  const provider = providerLabel(cli.id);
  return (
    <div className="tw:grid tw:gap-5">
      <ProviderHeading provider={cli.id} />
      <AgentPermissionCard
        title={t("agent.acpSetupTitle", { provider })}
        description={
          cli.installed
            ? t("agent.acpSetupLoginBody", {
                provider,
                command: loginCommand(cli.id),
              })
            : t("agent.acpSetupInstallBody", { provider })
        }
        pending
        status={t("agent.acpSetupRequired")}
        actions={
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button size="compact" variant="primary" onClick={onPrimary}>
              {cli.installed
                ? copied
                  ? t("agent.acpSetupCopied")
                  : t("agent.acpSetupCopyLogin")
                : t("agent.acpSetupOpenGuide")}
            </Button>
            <Button
              size="compact"
              variant="ghost"
              disabled={checking}
              onClick={onCheck}
            >
              <Icon
                name="refresh"
                data-loading={checking || undefined}
                className="tw:data-[loading=true]:animate-spin tw:motion-reduce:animate-none"
              />
              {t("agent.acpSetupCheckAgain")}
            </Button>
          </div>
        }
      />
      <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
        {t("agent.acpSetupPrivacy")}
      </p>
    </div>
  );
}

function ProviderHeading({ provider }: { provider: AgentProvider }) {
  return (
    <div className="tw:flex tw:items-center tw:gap-2 tw:pt-1">
      <AgentProviderMark provider={provider} />
      <strong className="tw:text-sm tw:text-foreground">
        {providerLabel(provider)}
      </strong>
    </div>
  );
}

const TranscriptItemView = memo(function TranscriptItemView({
  item,
  debugDetails,
  richText,
  streaming,
  pendingPermissionId,
  permissionSubmitting,
  onPermission,
  onOpenLink,
  onOpenKnowledgeAnalysis,
  expectedConnectionId,
  expectedConnectionEngine,
}: {
  item: AcpTranscriptItem;
  revision: number;
  debugDetails: boolean;
  richText: boolean;
  streaming: boolean;
  pendingPermissionId: string | null;
  permissionSubmitting: string | null;
  onPermission: (requestId: string, optionId: string | null) => void;
  onOpenLink: (href: string) => void;
  onOpenKnowledgeAnalysis: (environmentId: string, articleId?: string) => void;
  expectedConnectionId: string;
  expectedConnectionEngine: ConnectionEngine;
}) {
  const { t } = useI18n();
  if (item.kind === "user") {
    return (
      <article className="tw:ml-6 tw:grid tw:max-w-full tw:min-w-0 tw:gap-1 tw:overflow-hidden tw:justify-items-end">
        <div className="tw:max-w-[92%] tw:min-w-0 tw:overflow-hidden tw:break-words tw:rounded-md tw:bg-selection tw:px-3 tw:py-2 tw:text-sm tw:leading-body tw:whitespace-pre-wrap tw:text-selection-foreground">
          {item.text}
        </div>
        {item.attachments.length > 0 ? (
          <small className="tw:max-w-full tw:break-all tw:text-right tw:text-muted-foreground">
            {item.attachments.join(" · ")}
          </small>
        ) : null}
      </article>
    );
  }
  if (item.kind === "agent") {
    return (
      <article className="tw:max-w-full tw:min-w-0 tw:overflow-hidden">
        {streaming ? (
          <AgentStreamingText
            chunks={item.chunks}
            revision={item.revision}
          />
        ) : richText ? (
          <AgentRichText
            labels={{
              copied: t("agent.acpCopied"),
              copyCode: t("agent.acpCopyCode"),
              diagram: t("agent.acpDiagram"),
              diagramError: t("agent.acpDiagramError"),
              diagramLoading: t("agent.acpDiagramLoading"),
              diagramSource: t("agent.acpDiagramSource"),
              imageOmitted: t("agent.acpImageOmitted"),
              openLink: t("agent.acpOpenLink"),
              plainTextFallback: t("agent.acpPlainTextFallback"),
            }}
            onError={(error, errorInfo) =>
              reportRenderFailure("agent_rich_text", error, errorInfo)
            }
            onOpenLink={onOpenLink}
            text={item.chunks.join("")}
          />
        ) : (
          <AgentPlainText text={item.chunks.join("")} />
        )}
      </article>
    );
  }
  if (item.kind === "thought") {
    if (!debugDetails) {
      return (
        <AgentActivityLine
          label={t("agent.acpActivityReasoning")}
          tone="neutral"
        />
      );
    }
    return (
      <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:rounded-sm tw:border tw:border-border-subtle tw:bg-card tw:px-2 tw:py-1 tw:text-xs">
        <summary className="tw:cursor-pointer tw:text-muted-foreground">
          {t("agent.acpThought")}
        </summary>
        <div className="tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-words tw:pt-2 tw:leading-body tw:whitespace-pre-wrap tw:text-muted-foreground">
          {item.chunks.join("")}
        </div>
      </details>
    );
  }
  if (item.kind === "tool") {
    return (
      <ToolCallCard
        data={item.data}
        debugDetails={debugDetails}
        onOpenKnowledgeAnalysis={onOpenKnowledgeAnalysis}
        expectedConnectionId={expectedConnectionId}
        expectedConnectionEngine={expectedConnectionEngine}
      />
    );
  }
  if (item.kind === "permission") {
    const pending = item.event.requestId === pendingPermissionId;
    return (
      <AgentPermissionCard
        title={
          recordString(item.event.toolCall, "title") ??
          t("agent.acpPermission")
        }
        description={
          recordString(item.event.toolCall, "description") ??
          t("agent.acpPermission")
        }
        pending={pending}
        status={
          pending
            ? t("agent.acpPermissionWaiting")
            : t("agent.acpPermissionResolved")
        }
        actions={
          pending ? (
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              {item.event.options.map((option) => (
                <PermissionButton
                  key={option.id}
                  option={option}
                  disabled={permissionSubmitting === item.event.requestId}
                  onClick={() =>
                    onPermission(item.event.requestId, option.id)
                  }
                />
              ))}
              {item.event.options.some((option) =>
                option.kind.startsWith("reject")
              ) ? null : (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={permissionSubmitting === item.event.requestId}
                  onClick={() => onPermission(item.event.requestId, null)}
                >
                  {t("agent.acpCancel")}
                </Button>
              )}
            </div>
          ) : (
            <small className="tw:text-muted-foreground">
              {t("agent.acpPermissionResolved")}
            </small>
          )
        }
      />
    );
  }
  if (item.kind === "plan") {
    const entries = Array.isArray(item.data.entries)
      ? item.data.entries
      : Array.isArray(item.data.plan)
        ? item.data.plan
        : [];
    if (!debugDetails) {
      return (
        <AgentActivityLine
          label={t("agent.acpActivityPlanning")}
          tone="neutral"
        />
      );
    }
    return (
      <section className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden tw:rounded-md tw:border tw:border-border-subtle tw:bg-card tw:p-3">
        <strong className="tw:flex tw:items-center tw:gap-2 tw:text-sm">
          <Icon name="list" />
          {t("agent.acpPlan")}
        </strong>
        {entries.length > 0 ? (
          <ol className="tw:m-0 tw:grid tw:min-w-0 tw:gap-1 tw:pl-5 tw:text-xs tw:leading-body tw:[&>li]:break-words">
            {entries.map((entry, index) => (
              <li key={index}>{planEntryLabel(entry)}</li>
            ))}
          </ol>
        ) : (
          <pre className="tw:m-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-all tw:text-xs tw:whitespace-pre-wrap">
            {safeJson(item.data)}
          </pre>
        )}
      </section>
    );
  }
  if (item.kind === "error") {
    return (
      <div
        className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:break-words tw:rounded-md tw:border tw:border-danger-border tw:bg-danger-muted tw:px-3 tw:py-2 tw:text-sm tw:leading-body tw:text-danger"
        role="alert"
      >
        {agentSessionErrorLabel(item.message, t)}
      </div>
    );
  }
  if (item.kind === "turnEnd") {
    return (
      <div className="tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-muted-foreground">
        <span className="tw:h-px tw:flex-1 tw:bg-border-subtle" />
        {stopReasonLabel(item.stopReason, t)}
        <span className="tw:h-px tw:flex-1 tw:bg-border-subtle" />
      </div>
    );
  }
  return null;
});

function ToolCallCard({
  data,
  debugDetails,
  onOpenKnowledgeAnalysis,
  expectedConnectionId,
  expectedConnectionEngine,
}: {
  data: Record<string, unknown>;
  debugDetails: boolean;
  onOpenKnowledgeAnalysis: (environmentId: string, articleId?: string) => void;
  expectedConnectionId: string;
  expectedConnectionEngine: ConnectionEngine;
}) {
  const { t } = useI18n();
  const status = recordString(data, "status") ?? "pending";
  const title =
    recordString(data, "title") ??
    recordString(data, "kind") ??
    t("agent.acpToolRequest");
  const content = toolContentText(data.content);
  const rawOutput = data.rawOutput;
  const rawInput = data.rawInput;
  const article = findAnalysisArticle(rawOutput ?? data.content);
  const sqlProposal = isSqlProposalTool(data)
    ? findAgentSqlProposal(rawOutput ?? data.content)
    : null;
  if (!debugDetails) {
    return (
      <div className="tw:grid tw:gap-2">
        <AgentActivityLine
          label={toolActivityLabel(data, t)}
          status={toolStatusLabel(status, t)}
          tone={toolStatusTone(status)}
        />
        {article ? (
          <Button
            size="compact"
            variant="primary"
            onClick={() =>
              onOpenKnowledgeAnalysis(
                article.projectEnvironmentId,
                article.id,
              )
            }
          >
            <Icon name="chart" />
            {t("agent.acpOpenAnalysisArticle")}
          </Button>
        ) : null}
        {sqlProposal ? (
          <AcpSqlApproval
            proposal={sqlProposal}
            expectedConnectionId={expectedConnectionId}
            expectedConnectionEngine={expectedConnectionEngine}
          />
        ) : null}
      </div>
    );
  }
  return (
    <AgentToolCallCard
      title={title}
      status={toolStatusLabel(status, t)}
      tone={toolStatusTone(status)}
      details={
        rawInput !== undefined || rawOutput !== undefined ? (
          <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
            <summary className="tw:cursor-pointer tw:text-muted-foreground">
              {t("agent.acpToolDetails")}
            </summary>
            <pre className="tw:mt-2 tw:mb-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-all tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-2xs tw:leading-body tw:whitespace-pre-wrap">
              {safeJson({ input: rawInput, output: rawOutput })}
            </pre>
          </details>
        ) : null
      }
    >
      <div className="tw:grid tw:max-w-full tw:min-w-0 tw:gap-2 tw:overflow-hidden">
        {content ? (
          <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
            <summary className="tw:cursor-pointer tw:text-muted-foreground">
              {t("agent.acpToolOutput")}
            </summary>
            <pre className="tw:mt-2 tw:mb-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:break-all tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-2xs tw:leading-body tw:whitespace-pre-wrap">
              {content}
            </pre>
          </details>
        ) : null}
        <AcpStructuredResult value={rawOutput ?? data.content} />
        {article ? (
          <Button
            size="compact"
            variant="primary"
            onClick={() =>
              onOpenKnowledgeAnalysis(
                article.projectEnvironmentId,
                article.id,
              )
            }
          >
            <Icon name="chart" />
            {t("agent.acpOpenAnalysisArticle")}
          </Button>
        ) : null}
        {sqlProposal ? (
          <AcpSqlApproval
            proposal={sqlProposal}
            expectedConnectionId={expectedConnectionId}
            expectedConnectionEngine={expectedConnectionEngine}
          />
        ) : null}
      </div>
    </AgentToolCallCard>
  );
}

function PermissionButton({
  option,
  disabled,
  onClick,
}: {
  option: AcpPermissionOption;
  disabled: boolean;
  onClick: () => void;
}) {
  const reject = option.kind.startsWith("reject");
  return (
    <Button
      size="compact"
      variant={reject ? "dangerGhost" : "primary"}
      disabled={disabled}
      onClick={onClick}
    >
      {option.name}
    </Button>
  );
}
