// Owns schema discovery and the persisted introspection scope projected by the
// Connection editor's Schemas tab.
import { useQuery } from "@tanstack/react-query";

import {
  catalogOverviewQuery,
  useCatalogScope,
} from "../../lib/queries";
import {
  nextSchemaScopeSelection,
  relationNamespace,
  SCHEMA_SCOPE_PARAMETER,
  selectedSchemaScope,
} from "../catalogExplorer/scopeFilter";
import type { ConnectionProfileState } from "./useConnectionProfileState";

export function useConnectionSchemaController(
  profileState: ConnectionProfileState,
) {
  const catalogScope = useCatalogScope();
  const { form, identity, tabs } = profileState;
  const { isSharedTemplate, isMongo, isBigQuery } = form.flags;
  const discovery = useQuery({
    ...catalogOverviewQuery(form.value.id, catalogScope),
    enabled:
      identity.persisted &&
      tabs.active === "schemas" &&
      !isSharedTemplate &&
      !isMongo &&
      !isBigQuery &&
      catalogScope.ready,
  });
  const discoveredSchemas = Array.from(
    new Set([
      ...(discovery.data?.namespaces ?? []),
      ...(discovery.data?.relations
        .map((relation) =>
          relationNamespace(form.value, relation.schema),
        )
        .filter(Boolean) ?? []),
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const relationCounts = new Map<string, number>();
  for (const relation of discovery.data?.relations ?? []) {
    const namespace = relationNamespace(form.value, relation.schema);
    relationCounts.set(namespace, (relationCounts.get(namespace) ?? 0) + 1);
  }
  const selected = selectedSchemaScope(form.value);

  function setScope(schemas: string[]) {
    form.setExtraParameter(
      SCHEMA_SCOPE_PARAMETER,
      schemas.length > 0 ? JSON.stringify(schemas) : "",
    );
  }

  function toggleScope(schema: string, checked: boolean) {
    setScope(
      nextSchemaScopeSelection(
        discoveredSchemas,
        selected,
        schema,
        checked,
      ),
    );
  }

  return {
    status: {
      dataReady: discovery.data !== undefined,
      pending: discovery.isPending,
      fetching: discovery.isFetching,
      error: discovery.error,
    },
    refresh: discovery.refetch,
    discovered: discoveredSchemas,
    relationCounts,
    selected,
    setScope,
    toggleScope,
  };
}
