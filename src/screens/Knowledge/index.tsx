import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errMessage } from "../../ipc/types";
import { useI18n } from "../../lib/i18n";
import { queryResultPhase } from "../../lib/queryResultPhase";
import {
  sharedWorkspaceScopeAvailable,
  useCatalogScope,
} from "../../lib/queries";
import { captureProductEvent } from "../../features/productAnalytics/client";
import type {
  ProductAnalyticsEngine,
  ProductAnalyticsWorkspaceContextInput,
} from "../../features/productAnalytics/domain";
import {
  productAnalyticsAccessMode,
  productAnalyticsConnectionEngine,
  productAnalyticsWorkspaceContext,
} from "../../features/productAnalytics/outcomes";
import { workspaceAuthStateQuery } from "../../features/workspaces/queries";
import { requestWorkspaceLogin } from "../../features/workspaces/loginRequest";
import { requestWorkspaceSelection } from "../../features/workspaces/selectionRequest";
import { connectionsQuery } from "../../features/connections/queries";
import type {
  KnowledgeEnvironmentFocus,
  KnowledgeEnvironmentView,
} from "../../features/knowledge/domain";
import { knowledgeQueryKeys } from "../../features/knowledge/queryKeys";
import { bindKnowledgeEnvironmentConnectionWithRefresh } from "../../features/knowledge/bindEnvironmentConnection";
import {
  connectKnowledgeGithubSource,
  connectKnowledgeLocalFolder,
  listKnowledgeGithubRepositories,
  listKnowledgeEnvironmentConnections,
  revokeKnowledgeSource,
  revokeKnowledgeEnvironmentConnection,
} from "../../features/knowledge/tauriAdapter";
import { knowledgeInventoryQuery } from "../../features/knowledge/inventory";
import {
  KnowledgeConnectSourceSection,
  KnowledgeSourceInventory,
} from "../../features/knowledge/components/KnowledgeSourceSections";
import { KnowledgeDatabaseSection } from "../../features/knowledge/components/KnowledgeDatabaseSection";
import { KnowledgeWorkspaceHeader } from "../../features/knowledge/components/KnowledgeWorkspaceHeader";
import { useKnowledgeGithubInstall } from "../../features/knowledge/useKnowledgeGithubInstall";
import { useKnowledgeSourceActivity } from "../../features/knowledge/useKnowledgeSourceActivity";
import {
  captureKnowledgeSyncOutcome,
  type PendingKnowledgeSyncAnalytics,
} from "../../features/knowledge/workspaceModel";
import AnalysisArticles from "./AnalysisArticles";

export default function Knowledge({
  environmentFocus,
  onOpenAgent,
  onNewConnection,
}: {
  environmentFocus?: KnowledgeEnvironmentFocus | null;
  onOpenAgent?: (
    connectionId: string,
    environmentId?: string,
    prompt?: string,
    articleId?: string,
  ) => void;
  onNewConnection?: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const catalogScope = useCatalogScope();
  const workspaceAuth = useQuery(workspaceAuthStateQuery());
  const signedInPersonalAccount =
    catalogScope.workspaceKind === "personal" &&
    workspaceAuth.data?.authenticated === true
      ? workspaceAuth.data.user
      : null;
  const personalWorkspace = catalogScope.workspaceKind === "personal";
  const personalAuthResolved =
    !personalWorkspace || workspaceAuth.data !== undefined || workspaceAuth.isError;
  const inventoryKey = knowledgeQueryKeys.inventory(catalogScope.key);
  const sourceKey = inventoryKey;
  const repositoryKey = knowledgeQueryKeys.githubRepositories(catalogScope.key);
  const sharedWorkspace = sharedWorkspaceScopeAvailable(catalogScope);
  const githubProviderVisible = sharedWorkspace || personalWorkspace;
  const githubAvailable = sharedWorkspace || signedInPersonalAccount !== null;
  const inventoryQuery = knowledgeInventoryQuery(
    catalogScope.key,
    personalAuthResolved,
  );
  const projects = useQuery({
    ...inventoryQuery,
    select: (inventory) => inventory.projects,
  });
  const sources = useQuery({
    ...inventoryQuery,
    select: (inventory) => inventory.sources,
  });
  const projectsPhase = queryResultPhase(projects.data, projects.error);
  const sourcesPhase = queryResultPhase(sources.data, sources.error);
  const repositories = useQuery({
    queryKey: repositoryKey,
    queryFn: listKnowledgeGithubRepositories,
    enabled: githubAvailable,
    retry: false,
  });
  const refetchRepositories = repositories.refetch;
  const connections = useQuery(connectionsQuery(catalogScope.key));
  const repositoryPhase = queryResultPhase(
    repositories.data,
    repositories.error,
  );
  const connectionsPhase = queryResultPhase(
    connections.data,
    connections.error,
  );
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [refName, setRefName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState("");
  const [connectionRole, setConnectionRole] = useState("primary");
  const [connectionAlias, setConnectionAlias] = useState("");
  const [view, setView] = useState<KnowledgeEnvironmentView>("sources");
  const pendingGithubConnectAnalytics =
    useRef<PendingKnowledgeSyncAnalytics | null>(null);
  const pendingLocalConnectAnalytics =
    useRef<PendingKnowledgeSyncAnalytics | null>(null);
  const pendingBindingAnalytics = useRef<{
    context: ProductAnalyticsWorkspaceContextInput;
    engine: ProductAnalyticsEngine;
    accessMode: "local" | "managed";
  } | null>(null);
  const {
    state: githubInstallState,
    begin: beginGithubInstall,
    reset: resetGithubInstall,
  } = useKnowledgeGithubInstall({
    repositories: repositories.data,
    refetchRepositories,
    onError: setActionError,
  });
  const {
    pendingSyncAnalytics: pendingSourceSyncAnalytics,
    activity: sourceActivity,
  } = useKnowledgeSourceActivity(
    sources.data,
    queryClient,
  );
  const environmentConnections = useQuery({
    queryKey: knowledgeQueryKeys.environmentConnections(
      undefined,
      catalogScope.key,
    ),
    queryFn: () => listKnowledgeEnvironmentConnections(),
    enabled: Boolean(environmentId),
  });
  const environmentConnectionsPhase = queryResultPhase(
    environmentConnections.data,
    environmentConnections.error,
  );
  const selectedProject = useMemo(
    () => projects.data?.find((project) => project.id === projectId) ?? null,
    [projectId, projects.data],
  );
  const selectedEnvironment = selectedProject?.environments.find(
    (environment) => environment.id === environmentId,
  ) ?? null;
  const selectedEnvironmentConnections = useMemo(
    () =>
      (environmentConnections.data ?? []).filter(
        (binding) => binding.projectEnvironmentId === environmentId,
      ),
    [environmentConnections.data, environmentId],
  );
  const boundConnectionIds = useMemo(
    () => new Set(
      (environmentConnections.data ?? []).flatMap((binding) =>
        binding.connectionId ? [binding.connectionId] : []
      ),
    ),
    [environmentConnections.data],
  );
  const assignableConnections = useMemo(
    () => (connections.data ?? []).filter(
      (connection) => !boundConnectionIds.has(connection.id),
    ),
    [boundConnectionIds, connections.data],
  );
  const selectedEnvironmentSources = useMemo(
    () =>
      (sources.data ?? []).filter(
        (source) => source.projectEnvironmentId === environmentId,
      ),
    [environmentId, sources.data],
  );
  const selectedRepository = repositories.data?.find(
    (repository) => repository.id === repositoryId,
  ) ?? null;

  useEffect(() => {
    setProjectId("");
    setEnvironmentId("");
    setView("sources");
    setActionError(null);
    resetGithubInstall();
  }, [catalogScope.key, githubProviderVisible, resetGithubInstall]);

  useEffect(() => {
    if (!projects.data?.length || projectId) return;
    setProjectId(projects.data[0].id);
    setEnvironmentId(projects.data[0].environments[0]?.id ?? "");
  }, [projectId, projects.data]);

  useEffect(() => {
    if (!selectedProject) return;
    if (!selectedProject.environments.some((environment) => environment.id === environmentId)) {
      setEnvironmentId(selectedProject.environments[0]?.id ?? "");
    }
  }, [environmentId, selectedProject]);

  useEffect(() => {
    if (!environmentFocus || !projects.data) return;
    setView(environmentFocus.view);
    if (environmentFocus.environmentId === null) return;
    const project = projects.data.find((candidate) =>
      candidate.environments.some(
        (environment) => environment.id === environmentFocus.environmentId,
      ),
    );
    if (!project) return;
    setProjectId(project.id);
    setEnvironmentId(environmentFocus.environmentId);
  }, [environmentFocus, projects.data]);

  useEffect(() => {
    if (!repositories.data?.length || repositoryId) return;
    const repository = repositories.data.find((candidate) => !candidate.archived);
    if (!repository) return;
    setRepositoryId(repository.id);
    setRefName(repository.defaultBranch);
    setDisplayName(repository.fullName);
  }, [repositories.data, repositoryId]);

  useEffect(() => {
    const selected = assignableConnections.find(
      (connection) => connection.id === connectionId,
    );
    if (selected) return;
    const next = assignableConnections[0];
    setConnectionId(next?.id ?? "");
    setConnectionAlias(next?.name ?? "");
  }, [assignableConnections, connectionId]);


  const refreshInventory = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sourceKey }),
      queryClient.invalidateQueries({ queryKey: repositoryKey }),
      queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      }),
    ]);
  };

  const connectGithub = useMutation({
    mutationFn: connectKnowledgeGithubSource,
    onMutate: () => {
      const context = productAnalyticsWorkspaceContext(catalogScope);
      pendingGithubConnectAnalytics.current = context
        ? {
            attemptId: crypto.randomUUID(),
            context,
            previousGraphRevisionId: null,
            sourceKind: "github",
            syncReason: "initial",
          }
        : null;
    },
    onSuccess: async (source) => {
      const analyticsAttempt = pendingGithubConnectAnalytics.current;
      pendingGithubConnectAnalytics.current = null;
      if (analyticsAttempt) {
        if (source.health === "ready") {
          captureKnowledgeSyncOutcome(analyticsAttempt, "success");
        } else {
          pendingSourceSyncAnalytics.current.set(
            source.sourceId,
            {
              ...analyticsAttempt,
              previousGraphRevisionId: source.graphRevisionId,
            },
          );
        }
      }
      setActionError(null);
      await refreshInventory();
    },
    onError: async (error) => {
      captureKnowledgeSyncOutcome(
        pendingGithubConnectAnalytics.current,
        "failed",
      );
      pendingGithubConnectAnalytics.current = null;
      setActionError(errMessage(error));
      await queryClient.invalidateQueries({ queryKey: sourceKey });
    },
  });
  const connectLocal = useMutation({
    mutationFn: connectKnowledgeLocalFolder,
    onMutate: () => {
      const context = productAnalyticsWorkspaceContext(catalogScope);
      pendingLocalConnectAnalytics.current = context
        ? {
            attemptId: crypto.randomUUID(),
            context,
            previousGraphRevisionId: null,
            sourceKind: "local_folder",
            syncReason: "initial",
          }
        : null;
    },
    onSuccess: async (source) => {
      const analyticsAttempt = pendingLocalConnectAnalytics.current;
      pendingLocalConnectAnalytics.current = null;
      if (!source) return;
      if (analyticsAttempt) {
        if (source.health === "ready") {
          captureKnowledgeSyncOutcome(analyticsAttempt, "success");
        } else {
          pendingSourceSyncAnalytics.current.set(
            source.sourceId,
            {
              ...analyticsAttempt,
              previousGraphRevisionId: source.graphRevisionId,
            },
          );
        }
      }
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: sourceKey });
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    },
    onError: async (error) => {
      captureKnowledgeSyncOutcome(
        pendingLocalConnectAnalytics.current,
        "failed",
      );
      pendingLocalConnectAnalytics.current = null;
      setActionError(errMessage(error));
      await queryClient.invalidateQueries({ queryKey: sourceKey });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeKnowledgeSource,
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: sourceKey });
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    },
    onError: (error) => setActionError(errMessage(error)),
  });
  const bindConnection = useMutation({
    mutationFn: bindKnowledgeEnvironmentConnectionWithRefresh,
    onMutate: (input) => {
      const context = productAnalyticsWorkspaceContext(catalogScope);
      const connection = connections.data?.find(
        (candidate) => candidate.id === input.connectionId,
      );
      const engine = connection
        ? productAnalyticsConnectionEngine(connection.engine)
        : null;
      const accessMode = connection
        ? productAnalyticsAccessMode(connection.credentialMode)
        : null;
      pendingBindingAnalytics.current = context && engine && accessMode
        ? { context, engine, accessMode }
        : null;
    },
    onSuccess: async (binding) => {
      const analyticsAttempt = pendingBindingAnalytics.current;
      pendingBindingAnalytics.current = null;
      if (analyticsAttempt) {
        void captureProductEvent({
          name: "environment_connection_bound",
          properties: {
            accessMode: analyticsAttempt.accessMode,
            engine: analyticsAttempt.engine,
          },
          context: analyticsAttempt.context,
          dedupeId: binding.id,
        });
      }
      setActionError(null);
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.environmentConnections(),
      });
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    },
    onError: (error) => {
      pendingBindingAnalytics.current = null;
      setActionError(errMessage(error));
    },
  });
  const unbindConnection = useMutation({
    mutationFn: ({ environmentId: id, bindingId }: { environmentId: string; bindingId: string }) =>
      revokeKnowledgeEnvironmentConnection(id, bindingId),
    onSuccess: () => {
      setActionError(null);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.environmentConnections(),
      });
      await queryClient.invalidateQueries({
        queryKey: knowledgeQueryKeys.agentEnvironments(),
      });
    },
    onError: (error) => setActionError(errMessage(error)),
  });
  const pending = connectGithub.isPending || connectLocal.isPending;
  const sourceLoadFailure = projects.error
    ? {
        hasData: projectsPhase === "staleError",
        message: t("knowledge.projectsLoadFailed", {
          error: errMessage(projects.error),
        }),
        retry: () => projects.refetch(),
      }
    : sources.error
      ? {
          hasData: sourcesPhase === "staleError",
          message: t("knowledge.sourcesLoadFailed", {
            error: errMessage(sources.error),
          }),
          retry: () => sources.refetch(),
        }
      : view === "databases" && connections.error
        ? {
            hasData: connectionsPhase === "staleError",
            message: t(
              connectionsPhase === "staleError"
                ? "knowledge.connectionsRefreshFailed"
                : "knowledge.connectionsLoadFailed",
              { error: errMessage(connections.error) },
            ),
            retry: () => connections.refetch(),
          }
      : null;
  if (view === "analyses" && selectedProject && selectedEnvironment) {
    return (
      <AnalysisArticles
        projectName={selectedProject.name}
        environment={selectedEnvironment}
        bindings={selectedEnvironmentConnections}
        sharedWorkspace={sharedWorkspace}
        scopeKey={catalogScope.key}
        focusId={environmentFocus?.resourceId}
        onOpenAgent={onOpenAgent}
        onNewConnection={onNewConnection}
        onRequestTeamWorkspace={
          signedInPersonalAccount
            ? requestWorkspaceSelection
            : requestWorkspaceLogin
        }
        teamWorkspaceAction={
          signedInPersonalAccount ? "select" : "signIn"
        }
      />
    );
  }
  return (
    <div className="tw:mx-auto tw:grid tw:w-full tw:max-w-[1100px] tw:gap-5 tw:p-5 tw:@max-[720px]:p-3">
      <KnowledgeWorkspaceHeader
        view={view}
        project={selectedProject}
        environment={selectedEnvironment}
        loadFailure={sourceLoadFailure}
        actionError={actionError}
        projectsEmpty={
          projects.isSuccess && (projects.data?.length ?? 0) === 0
        }
      />

      {(projects.data?.length ?? 0) > 0 && view === "sources" ? (
        <KnowledgeConnectSourceSection
          projectName={selectedProject?.name ?? ""}
          environmentName={selectedEnvironment?.name ?? ""}
          githubProviderVisible={githubProviderVisible}
          personalAuthResolved={personalAuthResolved}
          githubAvailable={githubAvailable}
          repositoryPhase={repositoryPhase}
          repositories={repositories.data}
          repositoryError={repositories.error}
          githubInstallState={githubInstallState}
          repositoryId={repositoryId}
          refName={refName}
          displayName={displayName}
          selectedRepository={selectedRepository}
          environmentSelected={Boolean(environmentId)}
          pending={pending}
          githubPending={connectGithub.isPending}
          localPending={connectLocal.isPending}
          onRepositoryChange={(repository) => {
            setRepositoryId(repository.id);
            setRefName(repository.defaultBranch);
            setDisplayName(repository.fullName);
          }}
          onRefNameChange={setRefName}
          onDisplayNameChange={setDisplayName}
          onRetryRepositories={() => void refetchRepositories()}
          onBeginGithubInstall={() => void beginGithubInstall()}
          onLogin={requestWorkspaceLogin}
          onConnectGithub={() => {
            if (!selectedRepository) return;
            connectGithub.mutate({
              projectId,
              projectEnvironmentId: environmentId,
              installationId: selectedRepository.installationId,
              repositoryId: selectedRepository.id,
              repository: selectedRepository.fullName,
              refName: refName.trim(),
              displayName: displayName.trim(),
            });
          }}
          onConnectLocal={() =>
            connectLocal.mutate({
              projectId,
              projectEnvironmentId: environmentId,
              displayName: displayName.trim(),
            })
          }
        />
      ) : null}

      {(projects.data?.length ?? 0) > 0 && view === "databases" ? (
        <KnowledgeDatabaseSection
          environmentSelected={Boolean(environmentId)}
          connectionsPhase={connectionsPhase}
          connectionsLoaded={connections.data !== undefined}
          assignableConnections={assignableConnections}
          connectionId={connectionId}
          connectionRole={connectionRole}
          connectionAlias={connectionAlias}
          bindPending={bindConnection.isPending}
          bindingsPhase={environmentConnectionsPhase}
          bindingsLoaded={environmentConnections.data !== undefined}
          bindingsError={environmentConnections.error}
          bindings={selectedEnvironmentConnections}
          unbindPending={unbindConnection.isPending}
          onNewConnection={onNewConnection}
          onConnectionChange={(connection) => {
            setConnectionId(connection.id);
            setConnectionAlias(connection.name);
          }}
          onRoleChange={setConnectionRole}
          onAliasChange={setConnectionAlias}
          onBind={() =>
            bindConnection.mutate({
              projectEnvironmentId: environmentId,
              connectionId,
              role: connectionRole.trim(),
              alias: connectionAlias.trim(),
            })
          }
          onRetryBindings={() => void environmentConnections.refetch()}
          onReconfirm={(binding) => {
            if (!binding.connectionId) return;
            bindConnection.mutate({
              projectEnvironmentId: environmentId,
              connectionId: binding.connectionId,
              role: binding.role,
              alias: binding.alias,
            });
          }}
          onUnbind={(bindingId) =>
            unbindConnection.mutate({ environmentId, bindingId })
          }
        />
      ) : null}

      {(projects.data?.length ?? 0) > 0 && view === "sources" ? (
        <KnowledgeSourceInventory
          phase={sourcesPhase}
          sources={selectedEnvironmentSources}
          activityBySourceId={sourceActivity}
          revokePending={revoke.isPending}
          onRefresh={() => void sources.refetch()}
          onRevoke={(sourceId) => revoke.mutate(sourceId)}
        />
      ) : null}
    </div>
  );
}
