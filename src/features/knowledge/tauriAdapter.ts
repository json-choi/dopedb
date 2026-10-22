// Owns native Project, Environment, database-binding, and source inventory commands.

import { invoke } from "../../ipc/core";
import { readWithCatalogIssue } from "../catalogExplorer/catalogDomain";
import type {
  CreateKnowledgeProjectInput,
  CreateKnowledgeEnvironmentInput,
  GithubKnowledgeRepository,
  GithubKnowledgeSourceInput,
  KnowledgeProject,
  KnowledgeInventory,
  KnowledgeSource,
  EnvironmentConnection,
  BindEnvironmentConnectionInput,
} from "./domain";

export function listKnowledgeProjects(): Promise<KnowledgeProject[]> {
  return invoke("list_knowledge_projects_command");
}

export function listKnowledgeInventory(): Promise<KnowledgeInventory> {
  return readWithCatalogIssue(() => invoke("list_knowledge_inventory_command"));
}

export function listKnowledgeEnvironmentConnections(
  projectEnvironmentId?: string,
): Promise<EnvironmentConnection[]> {
  return readWithCatalogIssue(() => invoke(
    "list_knowledge_environment_connections",
    projectEnvironmentId ? { projectEnvironmentId } : {},
  ));
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

export function createKnowledgeProject(
  input: CreateKnowledgeProjectInput,
): Promise<KnowledgeProject> {
  return invoke("create_knowledge_project_command", { input });
}

export function deleteKnowledgeProject(
  projectId: string,
  expectedRevision: number,
): Promise<void> {
  return invoke("delete_knowledge_project_command", {
    projectId,
    expectedRevision,
  });
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

export function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  return invoke("list_knowledge_sources");
}

export function revokeKnowledgeSource(sourceId: string): Promise<void> {
  return invoke("revoke_knowledge_source", { sourceId });
}
