import { invoke } from "../../ipc/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CreateKnowledgeProjectInput,
  CreateKnowledgeEnvironmentInput,
  GithubKnowledgeRepository,
  GithubKnowledgeSourceInput,
  KnowledgeProject,
  KnowledgeSource,
  KnowledgeSourceSyncProgress,
  KnowledgeSyncCancellation,
  KnowledgeSyncResult,
  KnowledgeSourceChanged,
  KnowledgeSearchResult,
  LocalKnowledgeSourceInput,
  EnvironmentConnection,
  BindEnvironmentConnectionInput,
  KnowledgeMapping,
} from "./domain";

export function listKnowledgeProjects(): Promise<KnowledgeProject[]> {
  return invoke("list_knowledge_projects_command");
}

export function listKnowledgeEnvironmentConnections(
  projectEnvironmentId: string,
): Promise<EnvironmentConnection[]> {
  return invoke("list_knowledge_environment_connections", { projectEnvironmentId });
}

export function bindKnowledgeEnvironmentConnection(
  input: BindEnvironmentConnectionInput,
): Promise<EnvironmentConnection> {
  return invoke("bind_knowledge_environment_connection", { input });
}

export function revokeKnowledgeEnvironmentConnection(
  projectEnvironmentId: string,
  bindingId: string,
): Promise<void> {
  return invoke("revoke_knowledge_environment_connection", { projectEnvironmentId, bindingId });
}

export function listKnowledgeMappings(
  projectEnvironmentId: string,
): Promise<KnowledgeMapping[]> {
  return invoke("list_knowledge_mappings", { projectEnvironmentId });
}

export function decideKnowledgeMapping(
  projectEnvironmentId: string,
  proposalId: string,
  expectedGraphRevisionId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  return invoke("decide_knowledge_mapping", {
    projectEnvironmentId,
    proposalId,
    expectedGraphRevisionId,
    decision,
  });
}

export function createKnowledgeProject(
  input: CreateKnowledgeProjectInput,
): Promise<KnowledgeProject> {
  return invoke("create_knowledge_project_command", { input });
}

export function createKnowledgeEnvironment(
  input: CreateKnowledgeEnvironmentInput,
): Promise<KnowledgeProject> {
  return invoke("create_knowledge_environment_command", { input });
}

export function beginKnowledgeGithubInstall(): Promise<string> {
  return invoke("begin_knowledge_github_install_command");
}

export function listKnowledgeGithubRepositories(): Promise<GithubKnowledgeRepository[]> {
  return invoke("list_knowledge_github_repositories_command");
}

export function connectKnowledgeGithubSource(
  input: GithubKnowledgeSourceInput,
): Promise<KnowledgeSource> {
  return invoke("connect_knowledge_github_source", { input });
}

export function connectKnowledgeLocalFolder(
  input: LocalKnowledgeSourceInput,
): Promise<KnowledgeSource | null> {
  return invoke("connect_knowledge_local_folder", { input });
}

export function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  return invoke("list_knowledge_sources");
}

export function listKnowledgeSourceSyncProgress(): Promise<
  KnowledgeSourceSyncProgress[]
> {
  return invoke("list_knowledge_source_sync_progress");
}

export function revokeKnowledgeSource(sourceId: string): Promise<void> {
  return invoke("revoke_knowledge_source", { sourceId });
}

export function syncKnowledgeSource(sourceId: string): Promise<KnowledgeSyncResult> {
  return invoke("sync_knowledge_source", { sourceId });
}

export function cancelKnowledgeSourceSync(
  sourceId: string,
): Promise<KnowledgeSyncCancellation> {
  return invoke("cancel_knowledge_source_sync", { sourceId });
}

export function onKnowledgeSourceChanged(
  listener: (event: KnowledgeSourceChanged) => void,
): Promise<UnlistenFn> {
  return listen<KnowledgeSourceChanged>("knowledge-source:changed", (event) =>
    listener(event.payload),
  );
}

export function searchKnowledgeGraph(
  projectEnvironmentId: string,
  query: string,
  limit = 20,
): Promise<KnowledgeSearchResult> {
  return invoke("search_knowledge_graph", { projectEnvironmentId, query, limit });
}
