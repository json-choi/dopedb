// Provider account and resource-level choices of the add-database flow. Each level's
// list is a query that is enabled only after the level above it is chosen, and picks
// are kept by value so a reloaded list keeps a still-valid choice. The caller owns
// everything downstream of a choice: receipts, Neon plans and the import name.
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { ProviderResourceKind, WorkspaceAdminScope } from "../../domain";
import {
  selectableProviderResources,
  type Integration,
  type Provider,
  type Resource,
} from "../domain";
import {
  browsableLevels,
  discoverySelection,
  LEAF_INDEX,
  LEVEL_INDEXES,
  PROOF_REUSE_MS,
} from "./model";
import { providerResourcesQuery } from "./queries";

export function useResourceDiscovery({
  scope,
  providers,
  integrations,
  browsing,
}: {
  scope: WorkspaceAdminScope;
  providers: readonly Provider[];
  integrations: readonly Integration[];
  /** False while the account step is shown; no provider resource is read before. */
  browsing: boolean;
}) {
  const [integrationId, setIntegrationId] = useState(
    () => integrations.find((item) => item.status === "active")?.id ?? "",
  );
  const [selection, setSelection] = useState<Record<string, string>>({});
  const integration = integrations.find((item) => item.id === integrationId) ?? null;
  const provider = integration
    ? providers.find((item) => item.id === integration.provider) ?? null
    : null;
  const levels = useMemo(() => browsableLevels(provider), [provider]);
  const isNeon = provider?.id === "neon";
  const integrationReady = integration?.status === "active";

  const queries = useQueries({
    queries: LEVEL_INDEXES.map((index) =>
      providerResourcesQuery(
        scope,
        integrationId,
        levels?.[index] ?? null,
        levels ? discoverySelection(levels, selection, index) : null,
        browsing && integrationReady,
      )),
  });
  const options = LEVEL_INDEXES.map((index) =>
    provider && levels
      ? selectableProviderResources(
          queries[index].data ?? [],
          index === LEAF_INDEX,
          provider.supportedEngines,
          isNeon,
        )
      : []);

  function chosen(index: number): Resource | null {
    const level = levels?.[index];
    if (!level) return null;
    return options[index].find((item) => item.value === selection[level.key]) ?? null;
  }

  function valueOf(kind: ProviderResourceKind): string {
    const level = levels?.find((item) => item.kind === kind);
    return level ? selection[level.key] ?? "" : "";
  }

  const leaf = chosen(LEAF_INDEX);
  const branchIndex = isNeon && levels
    ? levels.findIndex((level) => level.kind === "branches")
    : -1;
  const branch = branchIndex >= 0 ? chosen(branchIndex) : null;
  const complete = Boolean(levels?.every((level) => selection[level.key]))
    && leaf !== null
    && leaf.ready === true
    && typeof leaf.selectionProof === "string"
    && (isNeon || leaf.production === true || leaf.production === false);
  const targetPath = levels
    ? levels
        .map((level, index) => chosen(index)?.name ?? selection[level.key] ?? "")
        .filter(Boolean)
        .join(" / ")
    : "";

  function chooseIntegration(id: string) {
    setIntegrationId(id);
    setSelection({});
  }

  /** Picks one level and clears every level below it. */
  function choose(index: number, value: string) {
    if (!levels?.[index]) return;
    setSelection((current) => {
      const next: Record<string, string> = {};
      for (const level of levels.slice(0, index)) {
        const parent = current[level.key];
        if (parent) next[level.key] = parent;
      }
      if (value) next[levels[index].key] = value;
      return next;
    });
  }

  /** The chosen leaf with a proof young enough to send; reloads the list when needed. */
  async function freshLeaf(): Promise<Resource | null> {
    const level = levels?.[LEAF_INDEX];
    const query = queries[LEAF_INDEX];
    if (!provider || !level) return null;
    let rows = query.data;
    if (!rows || Date.now() - query.dataUpdatedAt > PROOF_REUSE_MS) {
      rows = (await query.refetch()).data;
    }
    return selectableProviderResources(
      rows ?? [],
      true,
      provider.supportedEngines,
      isNeon,
    ).find((item) => item.value === selection[level.key]) ?? null;
  }

  function reloadLeaf() {
    void queries[LEAF_INDEX].refetch();
  }

  return {
    integrationId,
    integration,
    provider,
    levels,
    isNeon,
    integrationReady,
    selection,
    queries,
    options,
    leaf,
    branch,
    complete,
    targetPath,
    valueOf,
    chooseIntegration,
    choose,
    freshLeaf,
    reloadLeaf,
  };
}

export type ResourceDiscovery = ReturnType<typeof useResourceDiscovery>;
