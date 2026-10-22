import type { KnowledgeRevision } from "./domain";

export function knowledgeRevisionLabel(
  revision: KnowledgeRevision,
): string {
  return `${revision.refName} · ${revision.commitSha.slice(0, 8)}`;
}

export function githubSourceRevisionLabel(
  repository: string,
  commitSha: string,
): string {
  const revision = commitSha.trim().slice(0, 8);
  return revision ? `${repository} · ${revision}` : repository;
}
