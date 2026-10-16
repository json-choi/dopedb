// Resolves the manual SQL workbench's exact database and namespace authority. The
// schema choice is persisted only once the server's namespace list has settled, so a
// new console is not pinned to whichever schema the table catalog listed first.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { ConnectionProfile } from "../connections/domain";
import { useCatalogScope } from "../../lib/queries";
import {
  connectionDatabasesQuery,
  databaseCatalogOverviewQuery,
  databaseCatalogQuery,
} from "../../lib/catalogQueries";
import {
  effectiveSqlNamespace,
  sqlNamespaceOptions,
} from "./namespace";
import { useManualTransaction } from "./useManualTransaction";

interface SqlWorkbenchTargetInput {
  connection: ConnectionProfile;
  selectedDatabase: string;
  setSelectedDatabase: (selectedDatabase: string) => void;
  selectedSchema: string | null;
  setSelectedSchema: (selectedSchema: string | null) => void;
}

export function useSqlWorkbenchTarget({
  connection,
  selectedDatabase,
  setSelectedDatabase,
  selectedSchema,
  setSelectedSchema,
}: SqlWorkbenchTargetInput) {
  const catalogScope = useCatalogScope();
  const databasesQuery = useQuery(
    connectionDatabasesQuery(connection.id, catalogScope),
  );
  const databaseOptions = useMemo(() => {
    if (!databasesQuery.data) {
      return [selectedDatabase || connection.database].filter(Boolean);
    }
    const names = databasesQuery.data.map((database) => database.name);
    return names.includes(connection.database)
      ? names
      : [connection.database, ...names].filter(Boolean);
  }, [connection.database, databasesQuery.data, selectedDatabase]);
  const effectiveDatabase = databaseOptions.includes(selectedDatabase)
    ? selectedDatabase
    : (databaseOptions[0] ?? connection.database);
  const targetConnection = useMemo(
    () => ({ ...connection, database: effectiveDatabase }),
    [connection, effectiveDatabase],
  );
  const catalogQuery = useQuery(
    databaseCatalogQuery(connection.id, effectiveDatabase, catalogScope),
  );
  const catalog = catalogQuery.data;
  const overviewQuery = useQuery({
    ...databaseCatalogOverviewQuery(connection.id, effectiveDatabase, catalogScope),
    enabled:
      connection.engine === "postgres" && (catalogScope?.ready ?? true),
  });
  const serverNamespaces = overviewQuery.data?.namespaces;
  const namespaceOptions = useMemo(
    () => sqlNamespaceOptions(targetConnection, catalog, serverNamespaces),
    [catalog, serverNamespaces, targetConnection],
  );
  const namespacesSettled =
    connection.engine !== "postgres" ||
    overviewQuery.isSuccess ||
    overviewQuery.isError;
  const effectiveNamespace = useMemo(
    () =>
      effectiveSqlNamespace(targetConnection, selectedSchema, namespaceOptions),
    [namespaceOptions, selectedSchema, targetConnection],
  );
  const manualTransaction = useManualTransaction(
    connection.id,
    effectiveDatabase,
  );

  useEffect(() => {
    if (!databasesQuery.data) return;
    if (!effectiveDatabase || selectedDatabase === effectiveDatabase) return;
    setSelectedDatabase(effectiveDatabase);
  }, [
    databasesQuery.data,
    effectiveDatabase,
    selectedDatabase,
    setSelectedDatabase,
  ]);

  useEffect(() => {
    if (!catalogQuery.data || !namespacesSettled) return;
    if (!effectiveNamespace || selectedSchema === effectiveNamespace) return;
    setSelectedSchema(effectiveNamespace);
  }, [
    catalogQuery.data,
    effectiveNamespace,
    namespacesSettled,
    selectedSchema,
    setSelectedSchema,
  ]);

  return {
    catalogScope,
    catalog,
    databaseOptions,
    effectiveDatabase,
    effectiveNamespace,
    namespaceOptions,
    manualTransaction,
  };
}
