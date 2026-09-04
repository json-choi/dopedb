// AI Chat inventory projects the workspace's exact Project resources without
// exposing the internal Environment hierarchy as a choice the user must make.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import {
  connectionId as asConnectionId,
  type ConnectionEngine,
  type ConnectionId,
  type ConnectionProfile,
} from "../connections/domain";
import {
  bindKnowledgeEnvironmentConnectionWithRefresh,
  isKnowledgeEnvironmentRevisionConflict,
} from "../knowledge/bindEnvironmentConnection";
import type { EnvironmentConnection } from "../knowledge/domain";
import { knowledgeInventoryQuery } from "../knowledge/inventory";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";
import { listKnowledgeEnvironmentConnections } from "../knowledge/tauriAdapter";
import { connectionCanEnterWritePath } from "../safetySettings/policy";
import type { AgentKnowledgeEnvironment } from "./domain";
import { listAgentKnowledgeEnvironments } from "./tauriAdapter";

export type AgentEnvironmentChoice = AgentKnowledgeEnvironment & {
  projectId: string;
  bindings: EnvironmentConnection[];
  needsReconfirmation: boolean;
};

export type AgentDatabaseResourceChoice = {
  key: string;
  kind: "database";
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  riskClass: AgentKnowledgeEnvironment["riskClass"];
  connectionId: ConnectionId;
  authorityConnectionId: ConnectionId;
  databaseName: string;
  engine: ConnectionEngine;
  connectionRevision: number;
  writable: boolean;
  needsReconfirmation: boolean;
};

export type AgentSourceResourceChoice = {
  key: string;
  kind: "source";
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  riskClass: AgentKnowledgeEnvironment["riskClass"];
  sourceId: string;
  authorityConnectionId: ConnectionId;
  displayName: string;
  repository: string;
  commitSha: string;
  needsReconfirmation: boolean;
};

export type AgentProjectResourceChoice = {
  id: string;
  name: string;
  databases: AgentDatabaseResourceChoice[];
  sources: AgentSourceResourceChoice[];
};

export function agentDatabaseResourceKey(
  environmentId: string,
  connectionId: string,
) {
  return `database:${environmentId}:${connectionId}`;
}

export function agentSourceResourceKey(sourceId: string) {
  return `source:${sourceId}`;
}

export function useAgentEnvironmentInventory({
  catalogScopeKey,
  connection,
  connections,
  onError,
}: {
  catalogScopeKey: string;
  connection: ConnectionProfile;
  connections: ConnectionProfile[];
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [updatingEnvironmentId, setUpdatingEnvironmentId] = useState<
    string | null
  >(null);
  const knowledgeInventory = useQuery(
    knowledgeInventoryQuery(catalogScopeKey),
  );
  const environmentConnectionsQuery = useQuery({
    queryKey: knowledgeQueryKeys.environmentConnections(
      undefined,
      catalogScopeKey,
    ),
    queryFn: () => listKnowledgeEnvironmentConnections(),
    refetchOnWindowFocus: false,
  });
  const connectionById = useMemo(
    () => new Map(connections.map((profile) => [profile.id, profile])),
    [connections],
  );
  const choices = useMemo<AgentEnvironmentChoice[]>(() => {
    const bindingsByEnvironment = new Map<string, EnvironmentConnection[]>();
    for (const binding of environmentConnectionsQuery.data ?? []) {
      if (
        binding.connectionId === null ||
        !connectionById.has(asConnectionId(binding.connectionId))
      ) {
        continue;
      }
      const bindings = bindingsByEnvironment.get(binding.projectEnvironmentId) ?? [];
      bindings.push(binding);
      bindingsByEnvironment.set(binding.projectEnvironmentId, bindings);
    }
    return (knowledgeInventory.data?.projects ?? [])
      .flatMap((project) =>
        project.environments.map((environment) => {
          const bindings = (bindingsByEnvironment.get(environment.id) ?? []).sort(
            (left, right) =>
              `${left.alias}\u0000${left.connectionName}\u0000${left.id}`.localeCompare(
                `${right.alias}\u0000${right.connectionName}\u0000${right.id}`,
              ),
          );
          return {
            id: environment.id,
            projectId: project.id,
            projectName: project.name,
            name: environment.name,
            riskClass: environment.riskClass,
            graphRevisionCount: (knowledgeInventory.data?.sources ?? []).filter(
              (source) =>
                source.projectEnvironmentId === environment.id &&
                source.graphRevisionId !== null,
            ).length,
            bindings,
            needsReconfirmation: bindings.some((binding) => binding.stale),
          };
        }),
      )
      .sort((left, right) =>
        `${left.projectName}\u0000${left.name}\u0000${left.id}`.localeCompare(
          `${right.projectName}\u0000${right.name}\u0000${right.id}`,
        ),
      );
  }, [connectionById, environmentConnectionsQuery.data, knowledgeInventory.data]);

  const projects = useMemo<AgentProjectResourceChoice[]>(() => {
    const environmentById = new Map(choices.map((choice) => [choice.id, choice]));
    return (knowledgeInventory.data?.projects ?? [])
      .map((project) => {
        const environments = project.environments
          .map((environment) => environmentById.get(environment.id))
          .filter((environment): environment is AgentEnvironmentChoice =>
            Boolean(environment),
          );
        const databases = environments.flatMap((environment) =>
          environment.bindings.flatMap((binding) => {
            if (binding.connectionId === null) return [];
            const connectionId = asConnectionId(binding.connectionId);
            const profile = connectionById.get(connectionId);
            if (!profile) return [];
            return [
              {
                key: agentDatabaseResourceKey(environment.id, connectionId),
                kind: "database" as const,
                projectId: project.id,
                projectName: project.name,
                environmentId: environment.id,
                environmentName: environment.name,
                riskClass: environment.riskClass,
                connectionId,
                authorityConnectionId: connectionId,
                databaseName: binding.alias || profile.name,
                engine: profile.engine,
                connectionRevision: binding.currentConnectionRevision,
                writable: connectionCanEnterWritePath(profile),
                needsReconfirmation: environment.needsReconfirmation,
              },
            ];
          }),
        );
        const sources = (knowledgeInventory.data?.sources ?? []).flatMap(
          (source) => {
            if (
              source.projectId !== project.id ||
              source.provider !== "github" ||
              source.visibility !== "shared_graph" ||
              source.health !== "ready"
            ) {
              return [];
            }
            const environment = environmentById.get(source.projectEnvironmentId);
            if (!environment) return [];
            const authority =
              environment.bindings.find(
                (binding) => binding.connectionId === connection.id,
              ) ?? environment.bindings[0];
            if (authority?.connectionId === null || authority === undefined) return [];
            return [
              {
                key: agentSourceResourceKey(source.sourceId),
                kind: "source" as const,
                projectId: project.id,
                projectName: project.name,
                environmentId: environment.id,
                environmentName: environment.name,
                riskClass: environment.riskClass,
                sourceId: source.sourceId,
                authorityConnectionId: asConnectionId(authority.connectionId),
                displayName: source.displayName,
                repository:
                  source.revision.kind === "github"
                    ? source.revision.repository
                    : source.displayName,
                commitSha:
                  source.revision.kind === "github"
                    ? source.revision.commitSha
                    : "",
                needsReconfirmation: environment.needsReconfirmation,
              },
            ];
          },
        );
        return {
          id: project.id,
          name: project.name,
          databases: databases.sort((left, right) =>
            `${left.databaseName}\u0000${left.connectionId}`.localeCompare(
              `${right.databaseName}\u0000${right.connectionId}`,
            ),
          ),
          sources: sources.sort((left, right) =>
            `${left.displayName}\u0000${left.sourceId}`.localeCompare(
              `${right.displayName}\u0000${right.sourceId}`,
            ),
          ),
        };
      })
      .filter(
        (project) => project.databases.length > 0 || project.sources.length > 0,
      )
      .sort((left, right) =>
        `${left.name}\u0000${left.id}`.localeCompare(
          `${right.name}\u0000${right.id}`,
        ),
      );
  }, [choices, connection.id, connectionById, knowledgeInventory.data]);

  const loadError = environmentConnectionsQuery.isError
    ? errMessage(environmentConnectionsQuery.error)
    : knowledgeInventory.isError
      ? errMessage(knowledgeInventory.error)
      : null;

  const ensureAvailable = useCallback(
    async (environmentId: string, authorityConnectionId: ConnectionId) => {
      const choice = choices.find((environment) => environment.id === environmentId);
      if (!choice || updatingEnvironmentId !== null) return false;
      setUpdatingEnvironmentId(environmentId);
      onError(null);
      try {
        for (const binding of choice.bindings) {
          if (!binding.stale || binding.connectionId === null) continue;
          await bindKnowledgeEnvironmentConnectionWithRefresh({
            projectEnvironmentId: environmentId,
            connectionId: binding.connectionId,
            role: binding.role,
            alias: binding.alias,
          });
        }
        if (choice.needsReconfirmation) {
          await queryClient.invalidateQueries({
            queryKey: knowledgeQueryKeys.environmentConnections(),
          });
        }
        const targetQueryKey = knowledgeQueryKeys.agentEnvironments(
          authorityConnectionId,
          catalogScopeKey,
        );
        await queryClient.invalidateQueries({ queryKey: targetQueryKey });
        const refreshed = await queryClient.fetchQuery({
          queryKey: targetQueryKey,
          queryFn: () => listAgentKnowledgeEnvironments(authorityConnectionId),
        });
        const ready = refreshed.some(
          (environment) => environment.id === environmentId,
        );
        if (!ready) onError(t("agent.acpEnvironmentReconfirmFailed"));
        return ready;
      } catch (reason) {
        onError(isKnowledgeEnvironmentRevisionConflict(reason)
          ? t("agent.acpEnvironmentReconfirmFailed")
          : t("agent.acpEnvironmentReconfirmFailedWithError", {
              error: errMessage(reason),
            }));
        return false;
      } finally {
        setUpdatingEnvironmentId(null);
      }
    },
    [catalogScopeKey, choices, onError, queryClient, t, updatingEnvironmentId],
  );

  return {
    available: choices,
    projects,
    ensureAvailable,
    loadError,
    pending: environmentConnectionsQuery.isPending || knowledgeInventory.isPending,
    success: environmentConnectionsQuery.isSuccess && knowledgeInventory.isSuccess,
    updatingEnvironmentId,
    refresh: async () => {
      await Promise.all([
        environmentConnectionsQuery.refetch(),
        knowledgeInventory.refetch(),
      ]);
    },
  };
}
