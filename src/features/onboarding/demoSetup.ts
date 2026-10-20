// Guided-demo setup composes the existing connection and Project Environment
// commands. It never fabricates team membership, credentials, or Agent authority,
// and it binds the demo connection only once: an existing binding, even a stale
// one, is left for the person to reconfirm explicitly.
import type { QueryClient } from "@tanstack/react-query";

import type { CatalogScope } from "../../lib/queries";
import type { AgentKnowledgeEnvironment } from "../agents/domain";
import { listAgentKnowledgeEnvironments } from "../agents/tauriAdapter";
import type { ConnectionId, ConnectionProfile } from "../connections/domain";
import type {
  CreateKnowledgeEnvironmentInput,
  CreateKnowledgeProjectInput,
  EnvironmentConnection,
  KnowledgeProject,
} from "../knowledge/domain";
import { bindKnowledgeEnvironmentConnectionWithRefresh } from "../knowledge/bindEnvironmentConnection";
import {
  createKnowledgeEnvironment,
  createKnowledgeProject,
  listKnowledgeEnvironmentConnections,
  listKnowledgeProjects,
} from "../knowledge/tauriAdapter";
import { knowledgeQueryKeys } from "../knowledge/queryKeys";

export const GUIDED_DEMO_PROJECT_NAME = "DopeDB Demo";
export const GUIDED_DEMO_ENVIRONMENT_KIND = "development" as const;

type GuidedDemoGateway = {
  listAgentEnvironments: (
    connectionId: ConnectionId,
  ) => Promise<AgentKnowledgeEnvironment[]>;
  listEnvironmentConnections: (
    projectEnvironmentId: string,
  ) => Promise<EnvironmentConnection[]>;
  listProjects: () => Promise<KnowledgeProject[]>;
  createProject: (
    input: CreateKnowledgeProjectInput,
  ) => Promise<KnowledgeProject>;
  createEnvironment: (
    input: CreateKnowledgeEnvironmentInput,
  ) => Promise<KnowledgeProject>;
  bindConnection: (input: {
    projectEnvironmentId: string;
    connectionId: string;
    role: string;
    alias: string;
  }) => Promise<EnvironmentConnection>;
};

export type GuidedDemoEnvironmentSetup = {
  environmentId: string;
  createdEnvironmentId: string | null;
  binding: EnvironmentConnection | null;
};

/** The demo Project exists but its Environment could not be created or found. */
export class GuidedDemoEnvironmentMissingError extends Error {
  constructor() {
    super("The guided demo Environment was not created.");
    this.name = "GuidedDemoEnvironmentMissingError";
  }
}

const defaultGateway: GuidedDemoGateway = {
  listAgentEnvironments: listAgentKnowledgeEnvironments,
  listEnvironmentConnections: listKnowledgeEnvironmentConnections,
  listProjects: listKnowledgeProjects,
  createProject: createKnowledgeProject,
  createEnvironment: createKnowledgeEnvironment,
  bindConnection: bindKnowledgeEnvironmentConnectionWithRefresh,
};

export function selectGuidedDemoEnvironment(
  environments: readonly AgentKnowledgeEnvironment[],
): AgentKnowledgeEnvironment | null {
  return environments.find(
    (environment) =>
      environment.projectName === GUIDED_DEMO_PROJECT_NAME &&
      environment.kind === GUIDED_DEMO_ENVIRONMENT_KIND,
  ) ?? environments[0] ?? null;
}

export async function ensureGuidedDemoEnvironment(
  connection: ConnectionProfile,
  gateway: GuidedDemoGateway = defaultGateway,
): Promise<GuidedDemoEnvironmentSetup> {
  const alreadyBound = selectGuidedDemoEnvironment(
    await gateway.listAgentEnvironments(connection.id),
  );
  if (alreadyBound) {
    return {
      environmentId: alreadyBound.id,
      createdEnvironmentId: null,
      binding: null,
    };
  }

  const projects = await gateway.listProjects();
  let project = projects.find(
    (candidate) => candidate.name === GUIDED_DEMO_PROJECT_NAME,
  ) ?? null;
  let createdEnvironmentId: string | null = null;

  if (!project) {
    project = await gateway.createProject({
      name: GUIDED_DEMO_PROJECT_NAME,
      environments: [{ kind: GUIDED_DEMO_ENVIRONMENT_KIND }],
    });
    createdEnvironmentId = project.environments[0]?.id ?? null;
  }

  let environment = project.environments.find(
    (candidate) => candidate.kind === GUIDED_DEMO_ENVIRONMENT_KIND,
  ) ?? null;
  if (!environment) {
    project = await gateway.createEnvironment({
      projectId: project.id,
      kind: GUIDED_DEMO_ENVIRONMENT_KIND,
    });
    environment = project.environments.find(
      (candidate) => candidate.kind === GUIDED_DEMO_ENVIRONMENT_KIND,
    ) ?? null;
    createdEnvironmentId = environment?.id ?? null;
  }
  if (!environment) {
    throw new GuidedDemoEnvironmentMissingError();
  }
  if (!createdEnvironmentId) {
    // A binding the Agent projection hides (e.g. stale after a write-policy
    // change) is reconfirmed by the person, never silently rebound here.
    const existing = await gateway.listEnvironmentConnections(environment.id);
    if (existing.some((binding) => binding.connectionId === connection.id)) {
      return { environmentId: environment.id, createdEnvironmentId, binding: null };
    }
  }

  const binding = await gateway.bindConnection({
    projectEnvironmentId: environment.id,
    connectionId: connection.id,
    role: "primary",
    alias: "commerce",
  });
  return {
    environmentId: environment.id,
    createdEnvironmentId,
    binding,
  };
}

/** Refreshes every cached view the demo setup can change before its screen reads them. */
export async function refreshGuidedDemoQueries(
  queryClient: QueryClient,
  scope: CatalogScope,
  connectionId: ConnectionId,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.inventory(scope.key),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.environmentConnections(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: knowledgeQueryKeys.agentEnvironments(connectionId, scope.key),
      refetchType: "active",
    }),
  ]);
}
