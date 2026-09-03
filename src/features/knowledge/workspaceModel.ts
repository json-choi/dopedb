// Pure labels and analytics bookkeeping for the Knowledge workspace.
import type { GithubKnowledgeRepository } from "./domain";
import type {
  ProductAnalyticsWorkspaceContextInput,
} from "../productAnalytics/domain";
import { captureProductEvent } from "../productAnalytics/client";

export function knowledgeRepositoryLabel(
  repository: GithubKnowledgeRepository,
  privateLabel: string,
): string {
  return `${repository.fullName}${repository.private ? ` · ${privateLabel}` : ""}`;
}

export const knowledgeSourceHealthKey = {
  ready: "knowledge.sourceHealthReady",
  syncing: "knowledge.sourceHealthSyncing",
  stale: "knowledge.sourceHealthStale",
  failed: "knowledge.sourceHealthFailed",
} as const;

export interface PendingKnowledgeSyncAnalytics {
  attemptId: string;
  context: ProductAnalyticsWorkspaceContextInput;
  previousGraphRevisionId: string | null;
  sourceKind: "github" | "local_folder";
  syncReason: "initial" | "manual";
}

export interface KnowledgeSourceActivity {
  state: "syncing" | "ready" | "failed";
  errorKind: string | null;
  previousGraphRevisionId?: string | null;
}

export function captureKnowledgeSyncOutcome(
  attempt: PendingKnowledgeSyncAnalytics | null | undefined,
  outcome: "success" | "failed",
) {
  if (!attempt) return;
  void captureProductEvent({
    name: "knowledge_source_sync_completed",
    properties: {
      outcome,
      sourceKind: attempt.sourceKind,
      syncReason: attempt.syncReason,
    },
    context: attempt.context,
    dedupeId: attempt.attemptId,
  });
}

export function finishKnowledgeSyncOutcome(
  pending: Map<string, PendingKnowledgeSyncAnalytics>,
  sourceId: string,
  outcome: "success" | "failed",
) {
  const attempt = pending.get(sourceId);
  if (!attempt) return;
  pending.delete(sourceId);
  captureKnowledgeSyncOutcome(attempt, outcome);
}
