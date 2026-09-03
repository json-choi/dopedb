// Analysis Article analytics accepts only closed state and run receipts. It
// deliberately has no path for article text, SQL, parameters, result rows, or
// error bodies to enter the analytics contract.
import type { CatalogScope } from "../../lib/queries";
import { captureProductEvent } from "../productAnalytics/client";
import {
  productAnalyticsDurationBucket,
  productAnalyticsWorkspaceContext,
} from "../productAnalytics/outcomes";
import type { AnalysisRun } from "./domain";

export function beginManualAnalysisRunOutcome(scope: CatalogScope) {
  const context = productAnalyticsWorkspaceContext(scope);
  let completed = false;
  return (run: AnalysisRun | undefined) => {
    const outcome = terminalAnalysisRunOutcome(run?.state);
    if (completed || !context || !run || !outcome) return;
    completed = true;
    void captureProductEvent({
      name: "analysis_article_run_completed",
      properties: {
        outcome,
        trigger: "manual",
        durationBucket: productAnalyticsDurationBucket(
          analysisRunDurationMs(run),
        ),
      },
      context,
      dedupeId: run.id,
    });
  };
}

function terminalAnalysisRunOutcome(state: AnalysisRun["state"] | undefined) {
  if (state === "succeeded") return "success" as const;
  if (state === "failed" || state === "cancelled" || state === "stale") {
    return state;
  }
  return null;
}

function analysisRunDurationMs(run: AnalysisRun) {
  if (!run.startedAt || !run.finishedAt) return null;
  const startedAt = Date.parse(run.startedAt);
  const finishedAt = Date.parse(run.finishedAt);
  return Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    finishedAt >= startedAt
    ? finishedAt - startedAt
    : null;
}
