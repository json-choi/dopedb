// Knowledge and its Agent environment projection share one feature-owned cache
// identity. Every private key includes the authenticated workspace generation;
// prefixes are exported for intentional cross-surface invalidation only.
export const KNOWLEDGE_WORKSPACE_QUERY_ROOTS = ["knowledge"] as const;
export const AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS = [
  "agentKnowledgeEnvironments",
] as const;
export const knowledgeQueryScope = {
  workspaceRoots: KNOWLEDGE_WORKSPACE_QUERY_ROOTS,
  connectionRoots: AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS,
} as const;

export const knowledgeQueryKeys = {
  all: () => [KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0]] as const,
  inventory: (scopeKey?: string) =>
    scopeKey === undefined
      ? ([KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "inventory"] as const)
      : ([KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "inventory", scopeKey] as const),
  projects: (scopeKey: string) =>
    [KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "projects", scopeKey] as const,
  sources: (scopeKey?: string) =>
    scopeKey === undefined
      ? ([KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "sources"] as const)
      : ([KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "sources", scopeKey] as const),
  githubRepositories: (scopeKey: string) =>
    [
      KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0],
      "github-repositories",
      scopeKey,
    ] as const,
  environmentConnections: (environmentId?: string, scopeKey?: string) =>
    environmentId === undefined
      ? scopeKey === undefined
        ? ([KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0], "environment-connections"] as const)
        : ([
            KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0],
            "environment-connections",
            "all",
            scopeKey,
          ] as const)
      : scopeKey === undefined
        ? ([
            KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0],
            "environment-connections",
            environmentId,
          ] as const)
        : ([
            KNOWLEDGE_WORKSPACE_QUERY_ROOTS[0],
            "environment-connections",
            environmentId,
            scopeKey,
          ] as const),
  agentEnvironments: (connectionId?: string, scopeKey?: string) =>
    connectionId === undefined
      ? ([AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS[0]] as const)
      : scopeKey === undefined
        ? ([AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS[0], connectionId] as const)
        : ([
            AGENT_KNOWLEDGE_CONNECTION_QUERY_ROOTS[0],
            connectionId,
            scopeKey,
          ] as const),
};
