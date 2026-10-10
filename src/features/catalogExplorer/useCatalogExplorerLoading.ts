// Owns explicit Explorer loading and authentication recovery. Provider login runs
// through the existing connection adapter; this hook only coordinates catalog cache
// refresh after the member-local credential becomes usable again. A shared connection
// whose workspace session expired is recovered by signing in to the workspace.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  authenticateBigQueryGoogleAccount,
  authenticateBigQueryServiceAccount,
  pickConnectionFile,
} from "../connections/tauriAdapter";
import { bigQueryAuthMode } from "../connections/bigQueryOnboardingModel";
import {
  canRecoverBigQueryAuthentication,
  type ConnectionProfile,
} from "../connections/domain";
import { useManagedConnectionRecoveryLauncher } from "../connections/useManagedConnectionRecovery";
import { requestWorkspaceAdmin } from "../workspaceAdmin/navigationRequest";
import { qk, type CatalogScope } from "../../lib/queries";
import { catalogLoadIssue, readWithCatalogIssue } from "./catalogDomain";
import type { useCatalogExplorerState } from "./state";

type CatalogExplorerCommands = ReturnType<
  typeof useCatalogExplorerState
>["commands"];

export function useCatalogExplorerLoading(
  catalogScope: CatalogScope,
  commands: CatalogExplorerCommands,
) {
  const queryClient = useQueryClient();
  const managedConnectionRecovery = useManagedConnectionRecoveryLauncher(
    catalogScope,
  );
  const authenticationRecovery = useMutation({
    mutationFn: async ({ connection }: {
      connection: ConnectionProfile;
      scopeKey: string;
    }) => readWithCatalogIssue(async () => {
      if (bigQueryAuthMode(connection) === "googleAccount") {
        await authenticateBigQueryGoogleAccount(connection);
        return true;
      }
      const credentialFile = await pickConnectionFile();
      if (!credentialFile) return false;
      await authenticateBigQueryServiceAccount(connection, credentialFile);
      return true;
    }),
    onSuccess: async (recovered, { connection, scopeKey }) => {
      if (!recovered) return;
      await queryClient.invalidateQueries({
        queryKey: ["bigQueryOnboarding", connection.id],
      });
      if (scopeKey !== catalogScope.key) return;
      commands.clearRefreshError(connection.id);
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: qk.connectionDatabases(connection.id, scopeKey),
          exact: true,
          type: "all",
        }),
        queryClient.refetchQueries({
          queryKey: ["databaseCatalogOverview", connection.id],
          type: "all",
        }),
        queryClient.refetchQueries({
          queryKey: ["databaseCatalogSnapshot", connection.id],
          type: "all",
        }),
      ]);
    },
  });

  function ensureLoaded(connectionId: string) {
    commands.want(connectionId);
    commands.clearRefreshError(connectionId);
    if (
      queryClient.getQueryState(
        qk.connectionDatabases(connectionId, catalogScope.key),
      )?.status === "error"
    ) {
      void queryClient.refetchQueries({
        queryKey: qk.connectionDatabases(connectionId, catalogScope.key),
      });
    }
  }

  function retryOverview(connectionId: string, database: string) {
    commands.clearRefreshError(connectionId);
    void queryClient.refetchQueries({
      queryKey: qk.databaseCatalogOverview(
        connectionId,
        database,
        catalogScope.key,
      ),
      exact: true,
    });
    // A failed refresh may have failed the full snapshot too; retry it in the same
    // action instead of revealing a second error after the overview recovers.
    const snapshotKey = qk.databaseCatalogSnapshot(
      connectionId,
      database,
      catalogScope.key,
    );
    if (queryClient.getQueryState(snapshotKey)?.status === "error") {
      void queryClient.refetchQueries({ queryKey: snapshotKey, exact: true });
    }
    // A failed database-list re-read is reported on the default database; retry it too.
    const databasesKey = qk.connectionDatabases(connectionId, catalogScope.key);
    if (queryClient.getQueryState(databasesKey)?.status === "error") {
      void queryClient.refetchQueries({ queryKey: databasesKey, exact: true });
    }
  }

  const recoveryConnectionId = authenticationRecovery.variables?.connection.id
    ?? null;

  function connectionRecoveryProps(
    connection: ConnectionProfile,
    onManagedReturn: () => void,
  ) {
    return {
      onRecoverAuthentication: canRecoverBigQueryAuthentication(connection)
        ? () => {
            if (!authenticationRecovery.isPending) {
              authenticationRecovery.mutate({
                connection,
                scopeKey: catalogScope.key,
              });
            }
          }
        : undefined,
      authenticationRecoveryPending: authenticationRecovery.isPending
        && recoveryConnectionId === connection.id,
      authenticationRecoveryError: authenticationRecovery.isError
        && recoveryConnectionId === connection.id
        && authenticationRecovery.error
        ? catalogLoadIssue(authenticationRecovery.error)
        : undefined,
      onRecoverManagedConnection:
        managedConnectionRecovery.canOpenSettings(connection)
          ? () => managedConnectionRecovery.openSettings(
              connection,
              onManagedReturn,
            )
          : undefined,
      // A shared connection is leased and authorized with this device's workspace
      // session, so its `authenticationRequired` means that session expired. A
      // provider sign-in (BigQuery) is renewed by its own recovery above instead.
      onSignInWorkspace:
        connection.workspaceAccess !== "local" && connection.engine !== "bigquery"
          ? () => requestWorkspaceAdmin("account")
          : undefined,
    };
  }

  return {
    ensureLoaded,
    retryOverview,
    connectionRecoveryProps,
  };
}
