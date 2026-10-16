// Agent analytics observes only closed lifecycle outcomes. Prompt text, ACP
// error messages, event payloads, connection details, and session identifiers
// never enter the product-analytics event contract.
import type { CatalogScope } from "../../lib/queries";
import { captureProductEvent } from "../productAnalytics/client";
import {
  productAnalyticsDurationBucket,
  productAnalyticsWorkspaceContext,
} from "../productAnalytics/outcomes";
import type { AcpSessionId, AgentProvider } from "./domain";
import { observeLiveAcpSessionChanges } from "./sessionStore";

function newAnalyticsAttemptId() {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

function monotonicNow() {
  try {
    const value = globalThis.performance?.now();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function beginAgentInitializationOutcome(
  scope: CatalogScope,
  provider: AgentProvider,
) {
  const context = productAnalyticsWorkspaceContext(scope);
  const attemptId = newAnalyticsAttemptId();
  let completed = false;
  return (outcome: "success" | "failed") => {
    if (completed) return;
    completed = true;
    if (!context || !attemptId) return;
    void captureProductEvent({
      name: "agent_session_initialization_completed",
      properties: { outcome, provider },
      context,
      dedupeId: attemptId,
    });
  };
}

export function observeAgentTurnOutcome(
  scope: CatalogScope,
  sessionId: AcpSessionId,
  provider: AgentProvider,
) {
  const context = productAnalyticsWorkspaceContext(scope);
  const attemptId = newAnalyticsAttemptId();
  const startedAt = monotonicNow();
  if (!context || !attemptId || startedAt === null) return () => undefined;
  let turnStarted = false;
  let turnErrorObserved = false;
  let stopped = false;
  let stopNativeObservation: (() => void) | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopNativeObservation?.();
  };
  const finish = (outcome: "success" | "failed" | "cancelled") => {
    if (stopped) return;
    stop();
    const finishedAt = monotonicNow();
    void captureProductEvent({
      name: "agent_turn_completed",
      properties: {
        outcome,
        provider,
        durationBucket: productAnalyticsDurationBucket(
          finishedAt === null ? null : finishedAt - startedAt,
        ),
      },
      context,
      dedupeId: attemptId,
    });
  };
  stopNativeObservation = observeLiveAcpSessionChanges((change) => {
    if (stopped || !change.event || change.event.sessionId !== sessionId) return;
    const event = change.event;
    if (!turnStarted) {
      if (event.type === "userMessage") turnStarted = true;
      else if (
        event.type === "status" &&
        (event.lifecycle === "failed" || event.lifecycle === "closed")
      ) {
        stop();
      }
      return;
    }
    if (event.type === "error") {
      turnErrorObserved = true;
      return;
    }
    if (event.type === "turnEnd") {
      finish(event.stopReason === "cancelled" ? "cancelled" : "success");
      return;
    }
    if (event.type !== "status") return;
    if (event.lifecycle === "failed") finish("failed");
    else if (event.lifecycle === "closed") {
      finish(turnErrorObserved ? "failed" : "cancelled");
    } else if (event.lifecycle === "ready" && turnErrorObserved) finish("failed");
  });
  if (stopped) stopNativeObservation();
  return stop;
}
