export type KnowledgeEnvironment = {
  id: string;
  name: string;
  riskClass: "production" | "staging" | "development" | "test" | "custom";
  revision: number;
};

export type KnowledgeEnvironmentView =
  | "sources"
  | "databases"
  | "mappings"
  | "analyses"
  | "explore";

export type KnowledgeEnvironmentFocus = {
  environmentId: string | null;
  view: KnowledgeEnvironmentView;
  resourceId?: string | null;
  requestId: number;
};

export type KnowledgeProject = {
  id: string;
  name: string;
  revision: number;
  environments: KnowledgeEnvironment[];
};

export type GithubKnowledgeRepository = {
  installationId: string;
  accountLogin: string;
  id: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
};

export type KnowledgeRevision =
  | {
      kind: "github";
      repositoryId: string;
      repository: string;
      refName: string;
      commitSha: string;
    }
  | {
      kind: "local_git";
      rootFingerprint: string;
      gitRootFingerprint: string;
      refName: string;
      commitSha: string;
      dirty: boolean;
      worktree: boolean;
    }
  | {
      kind: "local_snapshot";
      rootFingerprint: string;
      snapshotSha256: string;
    };

export type KnowledgeSource = {
  sourceId: string;
  projectId: string;
  projectName: string;
  projectEnvironmentId: string;
  environmentName: string;
  environmentRevision: number;
  riskClass: KnowledgeEnvironment["riskClass"];
  provider: "github" | "local_folder";
  displayName: string;
  visibility: "local_only" | "shared_graph";
  revision: KnowledgeRevision;
  health: "ready" | "syncing" | "stale" | "failed";
  graphRevisionId: string | null;
  localCapabilityAvailable: boolean;
};

export type KnowledgeSourceSyncProgress = {
  sourceId: string;
  projectEnvironmentId: string;
  displayName: string;
  projectName: string;
  environmentName: string;
  phase: "manifest" | "indexing" | "activating";
  state: "queued" | "claimed";
  totalFiles: number;
  completedFiles: number;
  attempt: number;
  startedAt: string;
  updatedAt: string;
  retryAt: string | null;
};

export type CreateKnowledgeProjectInput = {
  name: string;
  environments: Array<{ name: string; riskClass: KnowledgeEnvironment["riskClass"] }>;
};

export type CreateKnowledgeEnvironmentInput = {
  projectId: string;
  name: string;
  riskClass: KnowledgeEnvironment["riskClass"];
};

export type GithubKnowledgeSourceInput = {
  projectId: string;
  projectEnvironmentId: string;
  installationId: string;
  repositoryId: string;
  repository: string;
  refName: string;
  displayName: string;
};

export type LocalKnowledgeSourceInput = {
  projectId: string;
  projectEnvironmentId: string;
  displayName: string;
};

export type KnowledgeSyncResult = {
  sourceId: string;
  state: "ready" | "syncing";
  graphRevisionId: string | null;
  parsedFiles: number;
  skippedFiles: number;
  changedFiles: string[];
  nodeCount: number;
  edgeCount: number;
};

export type KnowledgeSyncCancellation = {
  sourceId: string;
  cancelled: boolean;
  /** False when this device could not ask the authority that owns the work at
   *  all, so `cancelled: false` must not be read as "nothing was running". */
  verified: boolean;
};

export type KnowledgeSourceChanged = {
  sourceId: string;
  state: "syncing" | "ready" | "cancelled" | "failed";
  errorKind: string | null;
};

export type KnowledgeNode = {
  id: string;
  kind: "file" | "module" | "type" | "function" | "route" | "table" | "column" | "migration" | "event";
  name: string;
  qualifiedName: string;
  attributes?: Record<string, string>;
};

export type KnowledgeSearchResult = {
  graphRevisionIds: string[];
  matches: Array<{
    graphRevisionId: string;
    node: KnowledgeNode;
  }>;
};

export type EnvironmentConnection = {
  id: string;
  projectEnvironmentId: string;
  environmentRevision: number;
  connectionId: string | null;
  remoteConnectionId: string | null;
  connectionRevision: number;
  currentConnectionRevision: number;
  connectionName: string;
  role: string;
  alias: string;
  stale: boolean;
};

export type BindEnvironmentConnectionInput = {
  projectEnvironmentId: string;
  connectionId: string;
  role: string;
  alias: string;
};

export type KnowledgeMapping = {
  id: string;
  projectEnvironmentId: string;
  graphRevisionId: string;
  connectionId: string;
  connectionRevision: number;
  database: string;
  schemaFingerprint: string;
  fromNodeId: string;
  fromNodeName: string;
  targetKind: "table" | "column";
  targetIdentity: string;
  state: "proposed" | "approved" | "rejected" | "stale";
  proposedAt: string;
};
