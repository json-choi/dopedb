// Pure repository labels and source availability labels for the Knowledge workspace.
import type { GithubKnowledgeRepository } from "./domain";

export function knowledgeRepositoryLabel(
  repository: GithubKnowledgeRepository,
  privateLabel: string,
): string {
  return `${repository.fullName}${repository.private ? ` · ${privateLabel}` : ""}`;
}

export const knowledgeSourceHealthKey = {
  ready: "knowledge.sourceHealthReady",
  stale: "knowledge.sourceHealthStale",
  failed: "knowledge.sourceHealthFailed",
} as const;
