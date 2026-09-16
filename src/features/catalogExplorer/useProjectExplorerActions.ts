// Follow-up navigation after a project or environment mutation: which nodes to
// expand and which environment view to open. It drives only the expansion setters
// it is handed, so the explorer keeps sole ownership of that state.
import type { Dispatch, SetStateAction } from "react";

import type {
  KnowledgeEnvironmentView,
  KnowledgeProject,
} from "../knowledge/domain";
import { projectResourceKey } from "./projectResources";

type Props = {
  projects: KnowledgeProject[];
  activeEnvironmentId: string | null;
  setEnvironmentSetupProjectId: Dispatch<SetStateAction<string | null>>;
  setExpandedProjectIds: Dispatch<SetStateAction<Set<string>>>;
  setExpandedResourceKeys: Dispatch<SetStateAction<Set<string>>>;
  onOpenProjectEnvironment: (
    environmentId: string | null,
    view: KnowledgeEnvironmentView,
    resourceId?: string | null,
  ) => void;
};

export function useProjectExplorerActions({
  projects,
  activeEnvironmentId,
  setEnvironmentSetupProjectId,
  setExpandedProjectIds,
  setExpandedResourceKeys,
  onOpenProjectEnvironment,
}: Props) {
  function openCreatedProject(project: KnowledgeProject) {
    const environment = project.environments[0] ?? null;
    setExpandedProjectIds((current) => new Set([...current, project.id]));
    if (!environment) return;
    setExpandedResourceKeys(
      (current) =>
        new Set([
          ...current,
          projectResourceKey(project.id, "databases"),
        ]),
    );
    onOpenProjectEnvironment(environment.id, "databases");
  }

  function openCreatedEnvironment(project: KnowledgeProject) {
    const previousEnvironmentIds = new Set(
      projects
        .find((candidate) => candidate.id === project.id)
        ?.environments.map((environment) => environment.id) ?? [],
    );
    const environment =
      project.environments.find(
        (candidate) => !previousEnvironmentIds.has(candidate.id),
      ) ?? project.environments[project.environments.length - 1] ?? null;
    setExpandedProjectIds((current) => new Set([...current, project.id]));
    if (!environment) return;
    setExpandedResourceKeys(
      (current) =>
        new Set([
          ...current,
          projectResourceKey(project.id, "databases"),
        ]),
    );
    onOpenProjectEnvironment(environment.id, "databases");
  }

  function openEnvironmentSetup() {
    const activeProject = projects.find((project) =>
      project.environments.some(
        (environment) => environment.id === activeEnvironmentId,
      ),
    );
    const projectId = activeProject?.id ?? projects[0]?.id ?? null;
    if (projectId) setEnvironmentSetupProjectId(projectId);
  }

  return {
    openCreatedProject,
    openCreatedEnvironment,
    openEnvironmentSetup,
  };
}
