import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "../../components/Toast";
import { analysisQueryKeys } from "../analysisArticles/queryKeys";
import type { ConnectionProfile } from "../connections/domain";
import { connectionQueryKeys } from "../connections/queries";
import {
  deleteConnection,
  upsertConnection,
} from "../connections/tauriAdapter";
import type {
  EnvironmentConnection,
  KnowledgeEnvironmentView,
  KnowledgeProject,
} from "../knowledge/domain";
import { bindKnowledgeEnvironmentConnectionWithRefresh } from "../knowledge/bindEnvironmentConnection";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import {
  deleteKnowledgeProject,
  revokeKnowledgeEnvironmentConnection,
} from "../knowledge/tauriAdapter";
import { captureProductEvent } from "../productAnalytics/client";
import {
  productAnalyticsAccessMode,
  productAnalyticsConnectionEngine,
  productAnalyticsWorkspaceContext,
} from "../productAnalytics/outcomes";
import { deleteWorkspaceConnection } from "../workspaces/tauriAdapter";
import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { qk, type CatalogScope } from "../../lib/queries";
import {
  projectResourceKey,
  promotedProjectConnectionSourceId,
} from "./projectResources";
import { SCHEMA_SCOPE_PARAMETER } from "./scopeFilter";
import type { useCatalogExplorerState } from "./state";

type CatalogExplorerCommands = ReturnType<
  typeof useCatalogExplorerState
>["commands"];

type Props = {
  catalogScope: CatalogScope;
  projects: KnowledgeProject[];
  activeProjectEnvironmentId: string | null;
  environmentSetupProjectId: string | null;
  setEnvironmentSetupProjectId: Dispatch<SetStateAction<string | null>>;
  setExpandedProjectIds: Dispatch<SetStateAction<Set<string>>>;
  setExpandedResourceKeys: Dispatch<SetStateAction<Set<string>>>;
  commands: CatalogExplorerCommands;
  forgetConnection: (connectionId: string) => void;
  onDeleted: (connectionId: string) => void;
  onConnectionUpdated: (connection: ConnectionProfile) => void;
  onOpenProjectEnvironment: (
    environmentId: string | null,
    view: KnowledgeEnvironmentView,
    resourceId?: string | null,
  ) => void;
};

export function useDatabaseExplorerMutations({
  catalogScope,
  projects,
  activeProjectEnvironmentId,
  environmentSetupProjectId,
  setEnvironmentSetupProjectId,
  setExpandedProjectIds,
  setExpandedResourceKeys,
  commands,
  forgetConnection,
  onDeleted,
  onConnectionUpdated,
  onOpenProjectEnvironment,
}: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currentScopeKeyRef = useRef(catalogScope.key);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const [savingScopeId, setSavingScopeId] = useState<string | null>(null);
  const [unbindingBindingId, setUnbindingBindingId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    currentScopeKeyRef.current = catalogScope.key;
  }, [catalogScope.key]);

  function evictConnectionQueries(connectionId: string) {
    queryClient.removeQueries({
      queryKey: qk.catalog(connectionId, catalogScope.key),
    });
    queryClient.removeQueries({
      queryKey: qk.catalogOverview(connectionId, catalogScope.key),
    });
    queryClient.removeQueries({
      queryKey: qk.catalogSnapshot(connectionId, catalogScope.key),
    });
    queryClient.removeQueries({
      queryKey: qk.connectionDatabases(connectionId, catalogScope.key),
    });
    queryClient.removeQueries({
      queryKey: ["databaseCatalogOverview", connectionId],
    });
    queryClient.removeQueries({
      queryKey: ["databaseCatalog", connectionId],
    });
  }

  function forgetDeletedConnection(connectionId: string) {
    commands.forget(connectionId);
    forgetConnection(connectionId);
    evictConnectionQueries(connectionId);
    onDeleted(connectionId);
  }

  async function bindDroppedConnection(
    connection: ConnectionProfile,
    environmentId: string,
  ) {
    const environment = projects
      .flatMap((project) => project.environments)
      .find((candidate) => candidate.id === environmentId);
    if (!environment) return;
    try {
      const binding = await bindKnowledgeEnvironmentConnectionWithRefresh({
        projectEnvironmentId: environmentId,
        connectionId: connection.id,
        role: "primary",
        alias:
          connection.name.trim() || connection.database.trim() || "database",
      });
      const promotedSourceId = promotedProjectConnectionSourceId(
        connection,
        binding,
      );
      let localCleanupFailed = false;
      if (promotedSourceId !== null) {
        try {
          await deleteConnection(promotedSourceId);
          forgetDeletedConnection(promotedSourceId);
        } catch {
          // The shared Project binding is already authoritative. Preserve both
          // records and make the recoverable local duplicate visible to the user.
          localCleanupFailed = true;
        }
      }
      await Promise.all([
        promotedSourceId !== null
          ? queryClient.invalidateQueries({
              queryKey: connectionQueryKeys.all(catalogScope.key),
              refetchType: "active",
            })
          : Promise.resolve(),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.environmentConnections(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
          refetchType: "active",
        }),
      ]);
      const context = productAnalyticsWorkspaceContext(catalogScope);
      if (context) {
        void captureProductEvent({
          name: "environment_connection_bound",
          properties: {
            accessMode: productAnalyticsAccessMode(
              promotedSourceId === null
                ? connection.credentialMode
                : "memberLocal",
            ),
            engine: productAnalyticsConnectionEngine(connection.engine),
          },
          context,
          dedupeId: binding.id,
        });
      }
      toast(
        t("connections.environmentConnectionMoved", {
          connection:
            connection.name || connection.database || t("app.unnamed"),
          environment: environment.name,
        }),
      );
      if (localCleanupFailed) {
        toast(
          t("connections.projectConnectionCleanupFailed", {
            connection:
              connection.name || connection.database || t("app.unnamed"),
          }),
          "error",
        );
      }
    } catch (error) {
      toast(errMessage(error), "error");
    }
  }

  async function refreshSchema(connectionId: string) {
    const scopeKey = catalogScope.key;
    commands.patch({ refreshingId: connectionId });
    commands.clearRefreshError(connectionId);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: qk.connectionDatabases(connectionId, scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: ["databaseCatalogOverview", connectionId],
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: ["databaseCatalog", connectionId],
          refetchType: "active",
        }),
      ]);
      if (currentScopeKeyRef.current !== scopeKey) return;
      commands.want(connectionId);
    } catch (error) {
      if (currentScopeKeyRef.current !== scopeKey) return;
      commands.setRefreshError(connectionId, errMessage(error));
    } finally {
      if (currentScopeKeyRef.current === scopeKey) {
        commands.patch({ refreshingId: null });
      }
    }
  }

  async function refreshExplorer(selectedConnectionId: string | null) {
    const scopeKey = catalogScope.key;
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: connectionQueryKeys.all(scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.inventory(scopeKey),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.environmentConnections(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: analysisQueryKeys.articles(scopeKey),
          refetchType: "active",
        }),
        selectedConnectionId
          ? refreshSchema(selectedConnectionId)
          : Promise.resolve(),
      ]);
    } catch (error) {
      if (currentScopeKeyRef.current === scopeKey) {
        toast(errMessage(error), "error");
      }
    }
  }

  async function removeConnection(connection: ConnectionProfile) {
    commands.patch({ deletingId: connection.id });
    try {
      if (connection.workspaceAccess === "manage") {
        await deleteWorkspaceConnection(connection.id);
      } else {
        await deleteConnection(connection.id);
      }
      forgetDeletedConnection(connection.id);
      toast(t("connections.connectionDeleted"));
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      commands.patch({ deletingId: null });
    }
  }

  async function removeEnvironmentConnection(binding: EnvironmentConnection) {
    if (unbindingBindingId !== null) return;
    commands.patch({ openMenuId: null });
    setUnbindingBindingId(binding.id);
    try {
      await revokeKnowledgeEnvironmentConnection(
        binding.projectEnvironmentId,
        binding.id,
      );
      toast(
        t("connections.environmentConnectionRemoved", {
          connection: binding.alias || binding.connectionName,
        }),
      );
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.environmentConnections(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
          refetchType: "active",
        }),
      ]);
      setUnbindingBindingId(null);
    }
  }

  async function removeProject(project: KnowledgeProject) {
    if (deletingProjectId !== null) return;
    setDeletingProjectId(project.id);
    try {
      await deleteKnowledgeProject(project.id, project.revision);
      const environmentIds = new Set(
        project.environments.map((environment) => environment.id),
      );
      if (
        activeProjectEnvironmentId !== null &&
        environmentIds.has(activeProjectEnvironmentId)
      ) {
        onOpenProjectEnvironment(null, "databases");
      }
      if (environmentSetupProjectId === project.id) {
        setEnvironmentSetupProjectId(null);
      }
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      setExpandedResourceKeys((current) => {
        const next = new Set(current);
        next.delete(projectResourceKey(project.id, "databases"));
        next.delete(projectResourceKey(project.id, "sources"));
        next.delete(projectResourceKey(project.id, "analyses"));
        return next;
      });
      for (const environmentId of environmentIds) {
        queryClient.removeQueries({
          queryKey: analysisQueryKeys.articles(
            catalogScope.key,
            environmentId,
          ),
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.inventory(catalogScope.key),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.environmentConnections(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: knowledgeQueryKeys.agentEnvironments(),
          refetchType: "active",
        }),
      ]);
      toast(t("connections.projectDeleted", { project: project.name }));
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function setSchemaScope(
    connection: ConnectionProfile,
    schemas: string[],
  ) {
    if (savingScopeId !== null || connection.workspaceAccess === "view") {
      return;
    }
    setSavingScopeId(connection.id);
    try {
      const extraParams = { ...connection.extraParams };
      if (schemas.length > 0) {
        extraParams[SCHEMA_SCOPE_PARAMETER] = JSON.stringify(schemas);
      } else {
        delete extraParams[SCHEMA_SCOPE_PARAMETER];
      }
      const updated = await upsertConnection({ ...connection, extraParams });
      onConnectionUpdated(updated);
    } catch (error) {
      toast(errMessage(error), "error");
    } finally {
      setSavingScopeId(null);
    }
  }

  return {
    deletingProjectId,
    savingScopeId,
    unbindingBindingId,
    bindDroppedConnection,
    refreshSchema,
    refreshExplorer,
    removeConnection,
    removeEnvironmentConnection,
    removeProject,
    setSchemaScope,
  };
}
