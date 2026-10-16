import type { useI18n } from "../../lib/i18n";
import type { AcpSessionSummary } from "./domain";
import { providerLabel } from "./acpTranscriptPresentation";

/** The runtime's untitled sentinel (or an empty title) renders as localized copy. */
export function sessionTitle(
  session: Pick<AcpSessionSummary, "title">,
  t: ReturnType<typeof useI18n>["t"],
) {
  const title = session.title.trim();
  return title && title !== "New Agent session"
    ? title
    : t("agent.acpUntitledSession");
}

export function sessionMetaLabel(
  session: AcpSessionSummary,
  projects: readonly { id: string; name: string }[],
) {
  const projectId = session.knowledgeScopes[0]?.projectId;
  const projectName = projectId
    ? projects.find((project) => project.id === projectId)?.name ?? null
    : null;
  const provider = providerLabel(session.provider);
  return projectName ? `${projectName} · ${provider}` : provider;
}
