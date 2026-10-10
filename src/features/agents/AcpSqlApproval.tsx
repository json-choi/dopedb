// Reviews one Agent SQL proposal and coordinates its single exact approval or
// rejection. TanStack Query owns the trusted stored review keyed by operation
// id and payload hash, so decisions, expiry, session revocation, and execution
// outcomes refetch the real operation state instead of a local guess. Nothing
// here ever moves focus onto a decision: a new request is announced instead,
// and a person sent here from the status bar lands on the card's title.

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../components/Icon";
import { AgentToolCallCard } from "../../design-system/components/Agent";
import { Button } from "../../design-system/components/Button";
import { EnvironmentBadge } from "../../design-system/components/EnvironmentBadge";
import { TextInput } from "../../design-system/components/FormControls";
import {
  InlineNotice,
  StatusBadge,
  type StatusTone,
} from "../../design-system/components/Status";
import { errDetails, isQueryCancellationError } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { databaseDisplayLabel } from "../connections/domain";
import { approveOperation, rejectOperation } from "../operations/tauriAdapter";
import type { SqlApprovalReview } from "../queries/domain";
import { runSql } from "../queries/tauriAdapter";
import { stableAgentErrorCode } from "./agentErrorLabels";
import {
  beginAgentApprovalRun,
  consumeAgentApprovalStop,
  stopAgentApprovalRun,
  useAgentApprovalRuns,
} from "./approvalActivity";
import {
  approvalFocusRequestLive,
  finishAgentApprovalFocus,
  useAgentApprovalFocusRequest,
} from "./pendingApprovals";
import { agentQueryKeys } from "./queryKeys";
import { agentSqlProposalReviewQuery } from "./queryOptions";
import {
  isFinalOperationState,
  type AgentSqlProposalReference,
} from "./sqlProposal";

type DecisionPhase = "idle" | "approving" | "rejecting" | "running";
type Translate = ReturnType<typeof useI18n>["t"];
type ActionFailure = { message: string; detail: string | null; coded: boolean };

const MAX_REJECT_REASON_CHARS = 280;
const COMPOSER_FOCUS_TARGET = '[data-agent-focus-target="composer"]:not(:disabled)';
// Frames a status-bar request waits for AI Chat to become visible.
const MAX_REVEAL_FRAMES = 90;

export default function AcpSqlApproval({
  proposal,
  expectedConnectionId,
  expectedProposerSessionId,
  sessionEnded = false,
  announceWhenPending = false,
  returnFocusToComposer = false,
  onOpenActivity,
}: {
  proposal: AgentSqlProposalReference;
  /** The session's single write target; a proposal for another database is refused. */
  expectedConnectionId: string | null;
  /**
   * The conversation's live Broker session; decisions are offered only for its
   * own proposals (`null` when the conversation is not live). Omitted when the
   * reference comes from the Broker's own approval queue.
   */
  expectedProposerSessionId?: string | null;
  /** True once the session that proposed the change no longer holds its grant. */
  sessionEnded?: boolean;
  /** Announce a new decision request politely; focus never moves to it. */
  announceWhenPending?: boolean;
  /** After this card's decision, hand keyboard focus back to the composer. */
  returnFocusToComposer?: boolean;
  /** Opens Activity, where the executed change's outcome is recorded. */
  onOpenActivity?: () => void;
}) {
  const { lang, t } = useI18n();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const announcedRef = useRef(false);
  const focusRequest = useAgentApprovalFocusRequest();
  const revealRequest =
    focusRequest?.operationId === proposal.operationId ? focusRequest : null;
  const scopeMismatch = proposal.connectionId !== expectedConnectionId;
  const reviewOptions = agentSqlProposalReviewQuery(proposal);
  const reviewQuery = useQuery({ ...reviewOptions, enabled: !scopeMismatch });
  const review = reviewQuery.data ?? null;
  const [phase, setPhase] = useState<DecisionPhase>("idle");
  const [actionFailure, setActionFailure] = useState<ActionFailure | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // The shared run record is the truth for a stop requested here or from the
  // status bar; it clears when the stop landed and the run ended, or never did.
  const stopping = useAgentApprovalRuns().some(
    (run) => run.operationId === proposal.operationId && run.stopping,
  );
  const [stopped, setStopped] = useState(false);
  const [ranHere, setRanHere] = useState(false);
  const awaitingDecision =
    review?.state === "pending_approval" || review?.state === "approved";
  const ownSession =
    expectedProposerSessionId === undefined ||
    (expectedProposerSessionId !== null &&
      review?.proposerSessionId === expectedProposerSessionId);
  const decisionAllowed = awaitingDecision && ownSession;
  const executing = phase === "running" || review?.state === "executing";

  useEffect(() => {
    // A closed or revoked session cancels its pending proposals; read the
    // stored state at once instead of waiting for the next refresh.
    if (!sessionEnded) return;
    void queryClient.invalidateQueries({
      queryKey: agentQueryKeys.sqlProposalReview(proposal.operationId, proposal.payloadHash),
    });
  }, [proposal.operationId, proposal.payloadHash, queryClient, sessionEnded]);

  useEffect(() => {
    // A polite announcement never moves focus or scroll; the region exists from
    // the first render, so filling it once is read out.
    if (!announceWhenPending || !decisionAllowed || !review || announcedRef.current) return;
    announcedRef.current = true;
    setAnnouncement(
      t("agent.acpSqlApprovalAnnouncement", { connection: review.connectionName }),
    );
  }, [announceWhenPending, decisionAllowed, review, t]);

  useEffect(() => {
    // Brought here from the status bar: once AI Chat is visible and the
    // transcript finished its own scroll to the latest message, show this card
    // and focus its title. A decision control never receives this focus.
    if (!revealRequest || !approvalFocusRequestLive(revealRequest)) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      attempts += 1;
      const title = titleRef.current;
      if (
        title &&
        attempts > 1 &&
        title.getClientRects().length > 0 &&
        !title.closest("[inert]")
      ) {
        title.scrollIntoView({ block: "center" });
        title.focus({ preventScroll: true });
        finishAgentApprovalFocus(revealRequest.id);
        return;
      }
      if (attempts < MAX_REVEAL_FRAMES) frame = window.requestAnimationFrame(reveal);
    };
    frame = window.requestAnimationFrame(reveal);
    return () => window.cancelAnimationFrame(frame);
  }, [revealRequest]);

  function returnFocus() {
    if (!returnFocusToComposer) return;
    const current = document.activeElement;
    // Only when the person was acting in this card; never steal focus from
    // somewhere they moved to while the decision ran.
    if (current && current !== document.body && !cardRef.current?.contains(current)) return;
    document
      .querySelector<HTMLElement>(COMPOSER_FOCUS_TARGET)
      ?.focus({ preventScroll: true });
  }

  function settle(next: Partial<SqlApprovalReview>) {
    if (review) {
      queryClient.setQueryData(reviewOptions.queryKey, {
        ...review,
        ...next,
        confirmationPhrase: null,
      });
    }
    void queryClient.invalidateQueries({ queryKey: reviewOptions.queryKey });
  }

  async function approveAndRun() {
    if (!review || !decisionAllowed || phase !== "idle") return;
    setActionFailure(null);
    setStopped(false);
    let finishRun: (() => void) | null = null;
    try {
      if (review.state === "pending_approval") {
        setPhase("approving");
        // The stored plan names the exact phrase a production or critical change
        // requires; this one explicit click supplies it without typed friction.
        await approveOperation(
          review.operationId,
          review.payloadHash,
          review.confirmationPhrase ?? undefined,
        );
      }
      setPhase("running");
      setRanHere(true);
      finishRun = beginAgentApprovalRun({
        operationId: review.operationId,
        connectionId: review.connectionId,
        connectionName: review.connectionName,
        startedAt: Date.now(),
      });
      const outcome = await runSql(review.operationId);
      settle({ state: "succeeded", affected: outcome.affected });
    } catch (reason) {
      // A stop requested here or from the status bar ends the run on purpose;
      // the stored state then says whether anything committed.
      if (consumeAgentApprovalStop(review.operationId) || isQueryCancellationError(reason)) {
        setStopped(true);
      } else {
        setActionFailure(approvalFailure(reason, t));
      }
      void queryClient.invalidateQueries({ queryKey: reviewOptions.queryKey });
    } finally {
      finishRun?.();
      setPhase("idle");
      returnFocus();
    }
  }

  async function stop() {
    if (!review || stopping) return;
    try {
      // `false` means the run ended before the executor saw the stop; the
      // stored outcome then shows what really happened.
      await stopAgentApprovalRun(review.operationId);
    } catch {
      setActionFailure({ message: t("agent.acpSqlApprovalStopFailed"), detail: null, coded: true });
    }
  }

  async function reject() {
    if (!review || review.state !== "pending_approval" || !decisionAllowed || phase !== "idle") {
      return;
    }
    setActionFailure(null);
    setPhase("rejecting");
    try {
      const reason = rejectReason.trim().slice(0, MAX_REJECT_REASON_CHARS);
      await rejectOperation(review.operationId, review.payloadHash, reason || undefined);
      settle({ state: "rejected" });
    } catch (reason) {
      setActionFailure(approvalFailure(reason, t));
      void queryClient.invalidateQueries({ queryKey: reviewOptions.queryKey });
    } finally {
      setPhase("idle");
      returnFocus();
    }
  }

  const loadFailure = scopeMismatch
    ? { message: t("agent.acpSqlApprovalScopeMismatch"), detail: null, coded: true }
    : reviewQuery.isError
      ? approvalFailure(reviewQuery.error, t)
      : null;
  // A generic failure next to a stored state that already explains the outcome
  // (expired, cancelled, rejected) would only contradict it.
  const settledByState =
    review !== null &&
    (review.state === "expired" || review.state === "cancelled" || review.state === "rejected");
  const failure =
    (actionFailure && (actionFailure.coded || !settledByState) ? actionFailure : null) ??
    loadFailure;
  const error = failure?.message ?? null;
  const showOpenResult =
    onOpenActivity !== undefined &&
    review !== null &&
    (ranHere || stopped) &&
    isFinalOperationState(review.state) &&
    review.state !== "rejected" &&
    review.state !== "expired";
  const tone = proposalTone(review, phase, error !== null);
  const status = proposalStatusLabel(review, phase, sessionEnded, error !== null, t);
  const critical = review?.confirmationPhrase != null && review.riskLevel === "critical";
  const production = review?.confirmationPhrase != null && !critical;
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  const estimatedRows = review?.preview?.estimatedRows ?? null;

  return (
    <AgentToolCallCard
      title={
        <span
          ref={titleRef}
          tabIndex={-1}
          className="tw:rounded-xs tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-ring"
        >
          {t("agent.acpSqlApprovalTitle")}
        </span>
      }
      status={<span role="status">{status}</span>}
      tone={tone}
    >
      <div ref={cardRef} className="tw:grid tw:gap-3">
        <span className="tw:sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
        {review ? (
          <>
            <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
              <StatusBadge tone={riskTone(review.riskLevel)}>
                {riskLabel(review.riskLevel, t)}
              </StatusBadge>
              {review.environment ? (
                <EnvironmentBadge environment={review.environment} />
              ) : null}
              <span
                className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-xs tw:font-medium tw:text-foreground"
                title={review.connectionName}
              >
                {review.connectionName}
              </span>
            </div>
            <small className="tw:break-all tw:text-muted-foreground">
              {databaseDisplayLabel(review.engine, review.database)}
              {review.namespace ? ` · ${review.namespace}` : ""}
              {` · ${review.payloadHash.slice(0, 12)}…`}
            </small>
            <pre className="tw:m-0 tw:max-h-36 tw:overflow-auto tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre-wrap tw:text-foreground">
              {review.sql}
            </pre>
            <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
              {estimatedRows !== null
                ? t("agent.acpSqlApprovalEstimatedRows", { count: estimatedRows })
                : t("agent.acpSqlApprovalNoEstimate")}
              {awaitingDecision && review.expiresAt
                ? ` · ${t("agent.acpSqlApprovalExpiresAt", {
                    time: new Date(review.expiresAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}`
                : ""}
            </p>
            {review.preview?.plan ? (
              <details className="tw:max-w-full tw:min-w-0 tw:overflow-hidden tw:text-xs">
                <summary className="tw:cursor-pointer tw:text-muted-foreground">
                  {t("agent.acpSqlApprovalPlan")}
                </summary>
                <pre className="tw:mt-2 tw:mb-0 tw:max-h-48 tw:max-w-full tw:overflow-auto tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-2xs tw:leading-body tw:whitespace-pre-wrap">
                  {review.preview.plan}
                </pre>
              </details>
            ) : null}
            {awaitingDecision && !decisionAllowed ? (
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
                {expectedProposerSessionId === null
                  ? t("agent.acpSqlApprovalSessionNotLive")
                  : t("agent.acpSqlApprovalOtherSession")}
              </p>
            ) : decisionAllowed && critical ? (
              <InlineNotice tone="danger" icon="alert">
                {t("agent.acpSqlApprovalCriticalNotice")}
              </InlineNotice>
            ) : decisionAllowed && production ? (
              <InlineNotice tone="warning" icon="alert">
                {t("agent.acpSqlApprovalProductionNotice")}
              </InlineNotice>
            ) : decisionAllowed ? (
              <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
                {t("agent.acpSqlApprovalBody")}
              </p>
            ) : null}
          </>
        ) : null}
        {stopped ? (
          <p
            className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground"
            role="status"
          >
            {t("agent.acpSqlApprovalStopped")}
          </p>
        ) : null}
        {error ? (
          <InlineNotice
            tone="danger"
            icon="alert"
            role="alert"
            action={
              scopeMismatch ? undefined : (
                <>
                  {failure?.detail ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void navigator.clipboard?.writeText(failure.detail ?? "")}
                    >
                      {t("agent.acpCopyErrorDetail")}
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={reviewQuery.isFetching || phase !== "idle"}
                    onClick={() => {
                      setActionFailure(null);
                      void reviewQuery.refetch();
                    }}
                  >
                    {t("agent.acpSqlApprovalRefresh")}
                  </Button>
                </>
              )
            }
          >
            {error}
          </InlineNotice>
        ) : null}
        {review && executing ? (
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button
              size="xs"
              variant="ghost"
              disabled={stopping}
              disabledBehavior="focusable"
              onClick={() => void stop()}
            >
              <Icon name="stop" />
              {stopping
                ? t("agent.acpSqlApprovalStopping")
                : t("agent.acpSqlApprovalStop")}
            </Button>
          </div>
        ) : null}
        {showOpenResult ? (
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button size="xs" variant="ghost" onClick={onOpenActivity}>
              <Icon name="history" />
              {t("agent.acpSqlApprovalOpenResult")}
            </Button>
          </div>
        ) : null}
        {review && decisionAllowed && !executing ? (
          <div className="tw:grid tw:gap-2">
            {review.state === "pending_approval" ? (
              <TextInput
                id={reasonId}
                density="xs"
                value={rejectReason}
                maxLength={MAX_REJECT_REASON_CHARS}
                disabled={phase !== "idle"}
                placeholder={t("agent.acpSqlApprovalRejectReason")}
                aria-label={t("agent.acpSqlApprovalRejectReason")}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            ) : null}
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              <Button
                size="xs"
                variant="primary"
                disabled={phase !== "idle"}
                disabledBehavior="focusable"
                onClick={() => void approveAndRun()}
              >
                <Icon name="play" />
                {review.state === "approved"
                  ? t("agent.acpSqlApprovalRun")
                  : critical
                    ? t("agent.acpSqlApprovalApproveCritical")
                    : production
                      ? t("agent.acpSqlApprovalApproveProduction")
                      : t("agent.acpSqlApprovalApproveRun")}
              </Button>
              {review.state === "pending_approval" ? (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={phase !== "idle"}
                  disabledBehavior="focusable"
                  onClick={() => void reject()}
                >
                  {t("agent.acpSqlApprovalReject")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </AgentToolCallCard>
  );
}

function proposalTone(
  review: SqlApprovalReview | null,
  phase: DecisionPhase,
  failed: boolean,
): StatusTone {
  if (failed) return "danger";
  if (phase !== "idle") return "warning";
  switch (review?.state) {
    case "succeeded":
      return "success";
    case "pending_approval":
    case "approved":
    case "executing":
      return "warning";
    case "failed":
    case "outcome_unknown":
      return "danger";
    default:
      return "neutral";
  }
}

function proposalStatusLabel(
  review: SqlApprovalReview | null,
  phase: DecisionPhase,
  sessionEnded: boolean,
  failed: boolean,
  t: Translate,
) {
  if (phase === "approving") return t("agent.acpSqlApprovalApproving");
  if (phase === "running") return t("agent.acpSqlApprovalRunning");
  if (phase === "rejecting") return t("agent.acpSqlApprovalRejecting");
  if (!review) {
    return failed
      ? t("agent.acpSqlApprovalUnavailableStatus")
      : t("agent.acpSqlApprovalVerifying");
  }
  switch (review.state) {
    case "pending_approval":
      return t("agent.acpSqlApprovalWaiting");
    case "approved":
      return t("agent.acpSqlApprovalApproved");
    case "executing":
      return t("agent.acpSqlApprovalRunning");
    case "succeeded":
      return review.affected === null
        ? t("agent.acpSqlApprovalExecutedUnknown")
        : t("agent.acpSqlApprovalExecuted", { count: review.affected });
    case "failed":
      return t("agent.acpSqlApprovalFailed");
    case "outcome_unknown":
      return t("agent.acpSqlApprovalOutcomeUnknown");
    case "rejected":
      return t("agent.acpSqlApprovalRejected");
    case "expired":
      return t("agent.acpSqlApprovalExpired");
    case "cancelled":
      return sessionEnded
        ? t("agent.acpSqlApprovalRevoked")
        : t("agent.acpSqlApprovalCancelled");
    default:
      return isFinalOperationState(review.state)
        ? t("agent.acpSqlApprovalCancelled")
        : t("agent.acpSqlApprovalVerifying");
  }
}

function riskTone(risk: SqlApprovalReview["riskLevel"]): StatusTone {
  if (risk === "critical" || risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

function riskLabel(risk: SqlApprovalReview["riskLevel"], t: Translate) {
  switch (risk) {
    case "critical":
      return t("agent.acpSqlApprovalRiskCritical");
    case "high":
      return t("agent.acpSqlApprovalRiskHigh");
    case "medium":
      return t("agent.acpSqlApprovalRiskMedium");
    default:
      return t("agent.acpSqlApprovalRiskLow");
  }
}

/**
 * Maps decision and execution failures to product copy by stable code or error
 * kind; database messages stay quoted. Uncoded failures get generic copy and
 * keep the raw error only as a copyable detail.
 */
function approvalFailure(reason: unknown, t: Translate): ActionFailure {
  const details = errDetails(reason);
  const coded = (message: string): ActionFailure => ({ message, detail: null, coded: true });
  switch (stableAgentErrorCode(details.message)?.code) {
    case "agent_session_revoked":
      return coded(t("agent.acpSqlApprovalRevokedError"));
    case "agent_proposal_mismatch":
    case "agent_proposal_not_reviewable":
      return coded(t("agent.acpSqlApprovalUnavailable"));
  }
  if (details.kind === "outcomeUnknown") return coded(t("agent.acpSqlApprovalOutcomeUnknownError"));
  if (details.kind === "db") {
    return coded(t("agent.acpSqlApprovalDatabaseError", { error: details.message }));
  }
  const blocked =
    details.kind === "blocked" ||
    details.kind === "sqlPolicyBlocked" ||
    details.kind === "sessionStatementBlocked" ||
    details.kind === "safety";
  return {
    message: blocked
      ? t("agent.acpSqlApprovalBlockedError")
      : t("agent.acpSqlApprovalActionFailed"),
    detail: details.raw,
    coded: false,
  };
}
