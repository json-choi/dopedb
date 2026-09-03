// Owns Knowledge Project inventory, resource expansion, and analysis query lifecycles
// consumed by Database Explorer. Connection catalog state remains in the explorer.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { analysisQueryKeys } from "../../features/analysisArticles/queryKeys";
import { listAnalysisArticles } from "../../features/analysisArticles/tauriAdapter";
import { projectResourceKey } from "../../features/catalogExplorer/projectResources";
import type {
  EnvironmentConnection,
  KnowledgeEnvironmentView,
} from "../../features/knowledge/domain";
import { knowledgeInventoryQuery } from "../../features/knowledge/inventory";
import { knowledgeQueryKeys } from "../../features/knowledge/queryKeys";
import {
  listKnowledgeEnvironmentConnections,
  onKnowledgeSourceChanged,
} from "../../features/knowledge/tauriAdapter";
import {
  sharedWorkspaceScopeAvailable,
  type CatalogScope,
} from "../../lib/queries";
import { useWorkspaceResourceQueryRecovery } from "../../lib/queryClient";
import { queryResultPhase } from "../../lib/queryResultPhase";

export function useDatabaseExplorerKnowledge({
  catalogScope,
  activeEnvironmentId,
  activeEnvironmentView,
}: {
  catalogScope: CatalogScope;
  activeEnvironmentId: string | null;
  activeEnvironmentView: KnowledgeEnvironmentView | null;
}) {
  const queryClient = useQueryClient();
  useWorkspaceResourceQueryRecovery(catalogScope.key, catalogScope.ready);
  const enabled =
    catalogScope.ready &&
    (catalogScope.workspaceKind === "personal" ||
      catalogScope.accountScope !== null);
  const sharedWorkspace = enabled && sharedWorkspaceScopeAvailable(catalogScope);
  const inventoryQuery = knowledgeInventoryQuery(catalogScope.key, enabled);
  const projects = useQuery({
    ...inventoryQuery,
    select: (inventory) => inventory.projects,
  });
  const sources = useQuery({
    ...inventoryQuery,
    select: (inventory) => inventory.sources,
  });
  const sourcesPhase = queryResultPhase(sources.data, sources.error);
  const projectEnvironmentIds = useMemo(
    () =>
      (projects.data ?? []).flatMap((project) =>
        project.environments.map((environment) => environment.id),
      ),
    [projects.data],
  );
  const projectIdByEnvironmentId = useMemo(
    () =>
      new Map(
        (projects.data ?? []).flatMap((project) =>
          project.environments.map(
            (environment) => [environment.id, project.id] as const,
          ),
        ),
      ),
    [projects.data],
  );
  const activeProjectId = activeEnvironmentId
    ? projectIdByEnvironmentId.get(activeEnvironmentId) ?? null
    : null;
  const environmentConnections = useQuery({
    queryKey: knowledgeQueryKeys.environmentConnections(
      undefined,
      catalogScope.key,
    ),
    queryFn: () => listKnowledgeEnvironmentConnections(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const environmentConnectionsPhase = queryResultPhase(
    environmentConnections.data,
    environmentConnections.error,
  );
  const [analysisFilter, setAnalysisFilter] = useState("");
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [expandedResourceKeys, setExpandedResourceKeys] = useState<Set<string>>(
    new Set(),
  );
  const analysisQueries = useQueries({
    queries: projectEnvironmentIds.map((environmentId) => {
      const projectId = projectIdByEnvironmentId.get(environmentId);
      return {
        queryKey: analysisQueryKeys.articles(catalogScope.key, environmentId),
        queryFn: () => listAnalysisArticles(environmentId),
        enabled:
          sharedWorkspace &&
          projectId !== undefined &&
          (expandedResourceKeys.has(projectResourceKey(projectId, "analyses")) ||
            (activeEnvironmentId === environmentId &&
              activeEnvironmentView === "analyses")),
        retry: false,
      };
    }),
  });
  const knownScopeRef = useRef<{
    key: string;
    projectIds: Set<string>;
  } | null>(null);

  useEffect(() => {
    if (!projects.data) return;
    const projectIds = new Set(projects.data.map((project) => project.id));
    const previous =
      knownScopeRef.current?.key === catalogScope.key
        ? knownScopeRef.current
        : null;
    const newProjectIds = [...projectIds].filter(
      (id) => !previous?.projectIds.has(id),
    );
    if (previous === null) {
      setExpandedProjectIds(projectIds);
      setExpandedResourceKeys(
        new Set([
          "unassigned",
          ...[...projectIds].map((projectId) =>
            projectResourceKey(projectId, "databases"),
          ),
        ]),
      );
    } else {
      setExpandedProjectIds((current) =>
        new Set([...current, ...newProjectIds]),
      );
      setExpandedResourceKeys(
        (current) =>
          new Set([
            ...current,
            ...newProjectIds.map((projectId) =>
              projectResourceKey(projectId, "databases"),
            ),
          ]),
      );
    }
    knownScopeRef.current = { key: catalogScope.key, projectIds };
  }, [catalogScope.key, projects.data]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onKnowledgeSourceChanged(() => {
      if (disposed) return;
      void queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.inventory(),
      });
      void queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled, queryClient]);

  useEffect(() => {
    setAnalysisFilter("");
  }, [activeProjectId, catalogScope.key]);

  useEffect(() => {
    if (
      !activeProjectId ||
      activeEnvironmentView !== "analyses" ||
      !activeEnvironmentId
    ) return;
    const analysisKey = projectResourceKey(activeProjectId, "analyses");
    setExpandedProjectIds((current) =>
      current.has(activeProjectId)
        ? current
        : new Set([...current, activeProjectId]),
    );
    setExpandedResourceKeys((current) =>
      current.has(analysisKey)
        ? current
        : new Set([...current, analysisKey]),
    );
  }, [activeEnvironmentId, activeEnvironmentView, activeProjectId]);

  const environmentConnectionsById = useMemo(() => {
    const byEnvironment = new Map<string, EnvironmentConnection[]>();
    for (const binding of environmentConnections.data ?? []) {
      const current = byEnvironment.get(binding.projectEnvironmentId) ?? [];
      current.push(binding);
      byEnvironment.set(binding.projectEnvironmentId, current);
    }
    return byEnvironment;
  }, [environmentConnections.data]);

  return {
    enabled,
    sharedWorkspace,
    projects,
    sources,
    sourcesPhase,
    projectEnvironmentIds,
    activeProjectId,
    environmentConnections,
    environmentConnectionsPhase,
    environmentConnectionsById,
    retryBindings: environmentConnections.refetch,
    retrySources: sources.refetch,
    analysisFilter,
    setAnalysisFilter,
    expandedProjectIds,
    setExpandedProjectIds,
    expandedResourceKeys,
    setExpandedResourceKeys,
    analysisQueries,
  };
}
