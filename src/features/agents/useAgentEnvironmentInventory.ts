// AI Chat inventory projects the workspace's exact Project resources without
// exposing the internal Environment hierarchy as a choice the user must make.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { catalogLoadIssue, catalogLoadIssueMessage } from "../catalogExplorer/catalogDomain";
import { useI18n } from "../../lib/i18n";
import {
  connectionId as asConnectionId,
  databaseDisplayLabel,
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
import { agentFailure, type AgentFailure } from "./agentErrorLabels";
import type { AgentKnowledgeEnvironment } from "./domain";
import { listAgentKnowledgeEnvironments } from "./tauriAdapter";

export type AgentEnvironmentChoice = AgentKnowledgeEnvironment & {
  projectId: string;
  bindings: EnvironmentConnection[];
  needsReconfirmation: boolean;
};

/** What changed in one stale binding, shown before the person reconfirms it. */
export type AgentResourceReconfirmation = {
  connectionId: ConnectionId;
  name: string;
  fromRevision: number;
  toRevision: number;
  /** Where the connection points now (`connectionTargetLabel`). */
  target: string;
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
  /** The connection name the Explorer shows; the binding alias is secondary. */
  databaseName: string;
  bindingAlias: string | null;
  engine: ConnectionEngine;
  connectionRevision: number;
  writable: boolean;
  /** This resource's own binding changed; other bindings never count. */
  needsReconfirmation: boolean;
  reconfirmation: AgentResourceReconfirmation | null;
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
  /** The source's authority binding changed. */
  needsReconfirmation: boolean;
  reconfirmation: AgentResourceReconfirmation | null;
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

/**
 * Where a connection points, as one short label. SQLite shows its file name
 * and Cloudflare D1 its database, because D1's host field holds an account id
 * rather than a location; BigQuery reads "project / dataset" and every other
 * engine "host / database".
 */
function connectionTargetLabel(profile: ConnectionProfile) {
  const database = databaseDisplayLabel(profile.engine, profile.database);
  if (profile.engine === "sqlite" || profile.provider === "cloudflareD1") return database;
  return [profile.host, database].filter(Boolean).join(" / ");
}

// The binding pins only a revision number, so the target it was bound to is
// not known; the notice shows the revisions and where the connection points now.
function reconfirmationFor(
  binding: EnvironmentConnection,
  profile: ConnectionProfile,
): AgentResourceReconfirmation | null {
  if (!binding.stale) return null;
  return {
    connectionId: profile.id,
    name: profile.name || binding.alias,
    fromRevision: binding.connectionRevision,
    toRevision: binding.currentConnectionRevision,
    target: connectionTargetLabel(profile),
  };
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
  onError: (error: AgentFailure | string | null) => void;
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
            const reconfirmation = reconfirmationFor(binding, profile);
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
                databaseName: profile.name || binding.alias,
                bindingAlias:
                  binding.alias && binding.alias !== profile.name
                    ? binding.alias
                    : null,
                engine: profile.engine,
                connectionRevision: binding.currentConnectionRevision,
                writable: connectionCanEnterWritePath(profile),
                needsReconfirmation: reconfirmation !== null,
                reconfirmation,
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
            const authorityProfile = connectionById.get(asConnectionId(authority.connectionId));
            const reconfirmation = authorityProfile
              ? reconfirmationFor(authority, authorityProfile)
              : null;
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
                needsReconfirmation: reconfirmation !== null,
                reconfirmation,
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
    ? catalogLoadIssueMessage(t, catalogLoadIssue(environmentConnectionsQuery.error))
    : knowledgeInventory.isError
      ? catalogLoadIssueMessage(t, catalogLoadIssue(knowledgeInventory.error))
      : null;

  // Rebinding is a write (shared in a Team workspace), so only the bindings of
  // the resources the person selected and reviewed are reconfirmed.
  const ensureAvailable = useCallback(
    async (
      environmentId: string,
      authorityConnectionId: ConnectionId,
      connectionIds: readonly ConnectionId[],
    ) => {
      const choice = choices.find((environment) => environment.id === environmentId);
      if (!choice || updatingEnvironmentId !== null) return false;
      setUpdatingEnvironmentId(environmentId);
      onError(null);
      try {
        for (const binding of choice.bindings) {
          if (
            !binding.stale ||
            binding.connectionId === null ||
            !connectionIds.includes(asConnectionId(binding.connectionId))
          ) {
            continue;
          }
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
          : agentFailure(reason, t, (error) =>
              t("agent.acpEnvironmentReconfirmFailedWithError", { error })));
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
