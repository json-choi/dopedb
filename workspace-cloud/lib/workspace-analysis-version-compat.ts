// Bounded read adapter for revision payloads written by the retired
// draft/review/live lifecycle. Current payloads never serialize that state.
import type {
  AnalysisArticleVersionPayload,
  SharedAnalysisArticleCreate,
} from "./workspace-analysis-article-contracts";
import { exactRecord } from "./workspace-analysis-validation";

const retiredAnalysisArticleStates = [
  "draft",
  "review",
  "live",
  "archived",
] as const;

type RetiredAnalysisArticleState =
  (typeof retiredAnalysisArticleStates)[number];

function isRetiredAnalysisArticleState(
  value: unknown,
): value is RetiredAnalysisArticleState {
  return typeof value === "string"
    && retiredAnalysisArticleStates.includes(value as RetiredAnalysisArticleState);
}

export function parseRetiredAnalysisArticleVersionPayload(
  value: unknown,
  parseArticle: (candidate: unknown) => SharedAnalysisArticleCreate,
): AnalysisArticleVersionPayload | null {
  const row = exactRecord(value, [
    "id", "projectEnvironmentId", "environmentRevision", "sourceKnowledgeGrantId",
    "graphRevisionIds", "connections", "definition", "state", "ownerMemberId", "deleted",
  ]);
  if (!row || !isRetiredAnalysisArticleState(row.state)
    || typeof row.ownerMemberId !== "string" || row.ownerMemberId.length === 0
    || typeof row.deleted !== "boolean") return null;
  const article = parseArticle({
    id: row.id,
    projectEnvironmentId: row.projectEnvironmentId,
    environmentRevision: row.environmentRevision,
    sourceKnowledgeGrantId: row.sourceKnowledgeGrantId,
    graphRevisionIds: row.graphRevisionIds,
    connections: row.connections,
    definition: row.definition,
  });
  return {
    ...article,
    ownerMemberId: row.ownerMemberId,
    deleted: row.deleted,
  };
}

// Remove after every supported Desktop build consumes the state-free v3 DTO.
export function withRetiredArticleRecordFields<
  T extends Readonly<{ revision: number }>,
>(article: T) {
  return {
    ...article,
    state: "live" as const,
    liveRevision: article.revision,
    liveRunId: null,
  };
}

// Revision history used the same lifecycle state. Keep it only at the HTTP
// response boundary while installed older Desktop builds remain supported.
export function withRetiredVersionPayloadState(
  payload: AnalysisArticleVersionPayload,
) {
  return {
    ...payload,
    state: payload.deleted ? "archived" as const : "live" as const,
  };
}
