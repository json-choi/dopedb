// Owns the picker-only Project binding projection outside the AppShell composition root.
import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { projectNameByConnectionId } from "../catalogExplorer/projectResources";
import { knowledgeInventoryQuery } from "../knowledge/inventory";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { listKnowledgeEnvironmentConnections } from "../knowledge/tauriAdapter";
import type { CatalogScope } from "../../lib/queries";

export function useConnectionProjectNames(
  catalogScope: CatalogScope,
  pickerVisible: boolean,
) {
  const enabled =
    pickerVisible &&
    catalogScope.ready &&
    (catalogScope.workspaceKind === "personal" || catalogScope.accountScope !== null);
  const inventory = useQuery(knowledgeInventoryQuery(catalogScope.key, enabled));
  const bindings = useQuery({
    queryKey: knowledgeQueryKeys.environmentConnections(
      undefined,
      catalogScope.key,
    ),
    queryFn: () => listKnowledgeEnvironmentConnections(),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  return useMemo(
    () =>
      projectNameByConnectionId(
        inventory.data?.projects ?? [],
        bindings.data ?? [],
      ),
    [bindings.data, inventory.data],
  );
}
