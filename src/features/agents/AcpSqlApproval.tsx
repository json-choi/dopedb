import { useEffect, useState } from "react";

import { Icon } from "../../components/Icon";
import { AgentToolCallCard } from "../../design-system/components/Agent";
import { Button } from "../../design-system/components/Button";
import { InlineNotice, type StatusTone } from "../../design-system/components/Status";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import {
  databaseDisplayLabel,
  type ConnectionEngine,
} from "../connections/domain";
import { approveOperation, rejectOperation } from "../operations/tauriAdapter";
import type { SqlApprovalReview } from "../queries/domain";
import { reviewAgentSqlProposal, runSql } from "../queries/tauriAdapter";
import type { AgentSqlProposalReference } from "./sqlProposal";

type DecisionPhase = "idle" | "approving" | "rejecting" | "running";

export default function AcpSqlApproval({
  proposal,
  expectedConnectionId,
  expectedConnectionEngine,
}: {
  proposal: AgentSqlProposalReference;
  expectedConnectionId: string;
  expectedConnectionEngine: ConnectionEngine;
}) {
  const { lang, t } = useI18n();
  const [review, setReview] = useState<SqlApprovalReview | null>(null);
  const [phase, setPhase] = useState<DecisionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    setReview(null);
    setAffected(null);
    setError(null);
    if (proposal.connectionId !== expectedConnectionId) {
      setError(t("agent.acpSqlApprovalScopeMismatch"));
      return () => { current = false; };
    }
    void reviewAgentSqlProposal(
      proposal.operationId,
      expectedConnectionId,
      proposal.payloadHash,
    ).then((value) => {
      if (current) {
        setReview(value);
        setAffected(value.affected);
      }
    }).catch((reason) => {
      if (current) setError(errMessage(reason));
    });
    return () => { current = false; };
  }, [
    expectedConnectionId,
    proposal.connectionId,
    proposal.operationId,
    proposal.payloadHash,
    t,
  ]);

  async function approveAndRun() {
    if (!review || phase !== "idle") return;
    setError(null);
    try {
      if (review.state === "pending_approval") {
        setPhase("approving");
        await approveOperation(review.operationId, review.payloadHash, "Approved from AI Chat");
      }
      setPhase("running");
      const outcome = await runSql(review.operationId);
      setAffected(outcome.affected);
      setReview({ ...review, state: "succeeded" });
    } catch (reason) {
      setError(errMessage(reason));
    } finally {
      setPhase("idle");
    }
  }

  async function reject() {
    if (!review || review.state !== "pending_approval" || phase !== "idle") return;
    setError(null);
    setPhase("rejecting");
    try {
      await rejectOperation(review.operationId, review.payloadHash, "Rejected from AI Chat");
      setReview({ ...review, state: "rejected" });
    } catch (reason) {
      setError(errMessage(reason));
    } finally {
      setPhase("idle");
    }
  }

  const state = review?.state ?? "planned";
  const pending = state === "pending_approval" || state === "approved";
  const tone: StatusTone = error
    ? "danger"
    : state === "succeeded"
      ? "success"
      : pending
        ? "warning"
        : "neutral";
  const status = phase === "approving"
    ? t("agent.acpSqlApprovalApproving")
    : phase === "running"
      ? t("agent.acpSqlApprovalRunning")
      : phase === "rejecting"
        ? t("agent.acpSqlApprovalRejecting")
        : !review
          ? t("agent.acpSqlApprovalVerifying")
          : state === "pending_approval"
            ? t("agent.acpSqlApprovalWaiting")
            : state === "approved"
              ? t("agent.acpSqlApprovalApproved")
              : state === "succeeded"
                ? affected === null
                  ? t("agent.acpSqlApprovalExecutedUnknown")
                  : t("agent.acpSqlApprovalExecuted", { count: affected })
                : state === "rejected"
                  ? t("agent.acpSqlApprovalRejected")
                  : state === "expired"
                    ? t("agent.acpSqlApprovalExpired")
                    : state;

  return (
    <AgentToolCallCard title={t("agent.acpSqlApprovalTitle")} status={status} tone={tone}>
      <div className="tw:grid tw:gap-3">
        {review ? (
          <>
            <p className="tw:m-0 tw:text-xs tw:leading-body tw:text-muted-foreground">
              {t("agent.acpSqlApprovalBody")}
            </p>
            <pre className="tw:m-0 tw:max-h-36 tw:overflow-auto tw:rounded-sm tw:bg-muted tw:p-2 tw:font-mono tw:text-xs tw:leading-body tw:whitespace-pre-wrap tw:text-foreground">
              {review.sql}
            </pre>
            <small className="tw:break-all tw:text-muted-foreground">
              {databaseDisplayLabel(expectedConnectionEngine, review.database)}{review.namespace ? ` · ${review.namespace}` : ""}
              {review.expiresAt ? ` · ${new Date(review.expiresAt).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US")}` : ""}
              {` · ${review.payloadHash.slice(0, 12)}…`}
            </small>
          </>
        ) : null}
        {error ? <InlineNotice tone="danger" icon="alert" role="alert">{error}</InlineNotice> : null}
        {review && (review.state === "pending_approval" || review.state === "approved") ? (
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button size="xs" variant="primary" disabled={phase !== "idle"} onClick={() => void approveAndRun()}>
              <Icon name="play" />
              {review.state === "approved" ? t("agent.acpSqlApprovalRun") : t("agent.acpSqlApprovalApproveRun")}
            </Button>
            {review.state === "pending_approval" ? (
              <Button size="xs" variant="ghost" disabled={phase !== "idle"} onClick={() => void reject()}>
                {t("agent.acpSqlApprovalReject")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </AgentToolCallCard>
  );
}
