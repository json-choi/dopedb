import type { KnowledgeRevision } from "./domain";

export function knowledgeRevisionLabel(
  revision: KnowledgeRevision,
  labels: { dirty: string; snapshot: string },
): string {
  if (revision.kind === "github") {
    return `${revision.refName} · ${revision.commitSha.slice(0, 8)}`;
  }
  if (revision.kind === "local_git") {
    return `${revision.refName} · ${revision.commitSha.slice(0, 8)}${revision.dirty ? ` · ${labels.dirty}` : ""}`;
  }
  return `${labels.snapshot} ${revision.snapshotSha256.slice(0, 8)}`;
}

export function githubSourceRevisionLabel(
  repository: string,
  commitSha: string,
): string {
  const revision = commitSha.trim().slice(0, 8);
  return revision ? `${repository} · ${revision}` : repository;
}
