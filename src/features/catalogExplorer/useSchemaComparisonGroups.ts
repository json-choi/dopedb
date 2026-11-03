// Resolves every openable schema comparison: explicit schema groups plus each Project's
// environment comparison. It reads the same Project inventory and binding cache entries
// as Database Explorer, so a comparison opened from the tree always resolves here.
import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import { knowledgeInventoryQuery } from "../knowledge/inventory";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { listKnowledgeEnvironmentConnections } from "../knowledge/tauriAdapter";
import type { CatalogScope } from "../../lib/queries";
import { buildConnectionSections, schemaComparableEngine } from "../../lib/schemaDiff";
import { readWithCatalogIssue, retryTransientCatalogIssue } from "./catalogDomain";
import { projectSchemaGroups } from "./projectResources";

/** Projects exist only once the scope is ready and, for a team, an account is bound. */
export function projectScopeEnabled(scope: CatalogScope): boolean {
  return (
    scope.ready &&
    (scope.workspaceKind === "personal" || scope.accountScope !== null)
  );
}

export function environmentConnectionsQuery(scopeKey: string, enabled: boolean) {
  return queryOptions({
    queryKey: knowledgeQueryKeys.environmentConnections(undefined, scopeKey),
    queryFn: () => readWithCatalogIssue(() => listKnowledgeEnvironmentConnections()),
    enabled,
    retry: retryTransientCatalogIssue,
    staleTime: 60_000,
  });
}

export function useSchemaComparisonGroups(
  scope: CatalogScope,
  connections: readonly ConnectionProfile[],
) {
  const enabled = projectScopeEnabled(scope);
  const projects = useQuery({
    ...knowledgeInventoryQuery(scope.key, enabled),
    select: (inventory) => inventory.projects,
  });
  const bindings = useQuery(environmentConnectionsQuery(scope.key, enabled));
  const groups = useMemo(
    () => [
      ...buildConnectionSections([...connections]).flatMap((section) =>
        section.kind === "group" &&
        schemaComparableEngine(section.group.connections[0]?.engine)
          ? [section.group]
          : [],
      ),
      ...projectSchemaGroups(projects.data ?? [], bindings.data ?? [], connections),
    ],
    [projects.data, bindings.data, connections],
  );
  return {
    groups,
    /** False while a Project read may still add a group, so a route must not drop it yet. */
    settled: !enabled || (!projects.isPending && !bindings.isPending),
  };
}
