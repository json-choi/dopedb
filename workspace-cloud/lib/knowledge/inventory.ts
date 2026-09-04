// Shared, tenant-scoped Knowledge inventory reads. Collection routes reuse these
// projections so Desktop can load projects and sources behind one authorization.
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../db";
import {
  knowledgeEnvironmentConnection,
  knowledgeProject,
  knowledgeProjectEnvironment,
  knowledgeSource,
  workspaceConnection,
} from "../schema";

const MAX_WORKSPACE_ENVIRONMENT_BINDINGS = 10_000;

export async function listKnowledgeProjects(workspaceId: string) {
  const rows = await db.select({
    projectId: knowledgeProject.id,
    projectName: knowledgeProject.name,
    projectRevision: knowledgeProject.revision,
    environmentId: knowledgeProjectEnvironment.id,
    environmentName: knowledgeProjectEnvironment.name,
    environmentRiskClass: knowledgeProjectEnvironment.riskClass,
    environmentRevision: knowledgeProjectEnvironment.revision,
  }).from(knowledgeProject).leftJoin(
    knowledgeProjectEnvironment,
    and(
      eq(knowledgeProjectEnvironment.organizationId, knowledgeProject.organizationId),
      eq(knowledgeProjectEnvironment.projectId, knowledgeProject.id),
    ),
  ).where(and(
    eq(knowledgeProject.organizationId, workspaceId),
    isNull(knowledgeProject.deletedAt),
  ));
  const projects = new Map<string, {
    id: string;
    name: string;
    revision: number;
    environments: Array<{
      id: string;
      name: string;
      riskClass: string;
      revision: number;
    }>;
  }>();
  for (const row of rows) {
    let project = projects.get(row.projectId);
    if (!project) {
      project = {
        id: row.projectId,
        name: row.projectName,
        revision: row.projectRevision,
        environments: [],
      };
      projects.set(row.projectId, project);
    }
    if (
      row.environmentId
      && row.environmentName
      && row.environmentRiskClass
      && row.environmentRevision
    ) {
      project.environments.push({
        id: row.environmentId,
        name: row.environmentName,
        riskClass: row.environmentRiskClass,
        revision: row.environmentRevision,
      });
    }
  }
  return [...projects.values()];
}

export async function listKnowledgeSources(workspaceId: string) {
  const sources = await db.select({
    id: knowledgeSource.id,
    projectId: knowledgeSource.projectId,
    projectEnvironmentId: knowledgeSource.projectEnvironmentId,
    environmentRevision: knowledgeSource.environmentRevision,
    provider: knowledgeSource.provider,
    displayName: knowledgeSource.displayName,
    visibility: knowledgeSource.visibility,
    repositoryId: knowledgeSource.repositoryId,
    repositoryFullName: knowledgeSource.repositoryFullName,
    refName: knowledgeSource.refName,
    commitSha: knowledgeSource.commitSha,
    syncState: knowledgeSource.syncState,
    syncRevision: knowledgeSource.syncRevision,
    lastFailureCode: knowledgeSource.lastFailureCode,
  }).from(knowledgeSource).where(and(
    eq(knowledgeSource.organizationId, workspaceId),
    isNull(knowledgeSource.revokedAt),
  ));
  return sources.map((source) => ({ ...source, graphRevisionId: null }));
}

export async function listKnowledgeEnvironmentConnections(workspaceId: string) {
  const bindings = await db.select({
    id: knowledgeEnvironmentConnection.id,
    projectEnvironmentId: knowledgeEnvironmentConnection.projectEnvironmentId,
    environmentRevision: knowledgeEnvironmentConnection.environmentRevision,
    connectionId: knowledgeEnvironmentConnection.connectionId,
    connectionRevision: knowledgeEnvironmentConnection.connectionRevision,
    // Knowledge grants pin the public connection content revision. The
    // revocation/lease epoch remains an internal execution-time authority.
    currentConnectionRevision: workspaceConnection.contentRevision,
    connectionContentRevision: workspaceConnection.contentRevision,
    connectionName: workspaceConnection.name,
    role: knowledgeEnvironmentConnection.role,
    alias: knowledgeEnvironmentConnection.alias,
  }).from(knowledgeEnvironmentConnection).innerJoin(
    workspaceConnection,
    and(
      eq(workspaceConnection.organizationId, knowledgeEnvironmentConnection.organizationId),
      eq(workspaceConnection.id, knowledgeEnvironmentConnection.connectionId),
      isNull(workspaceConnection.deletedAt),
    ),
  ).where(and(
    eq(knowledgeEnvironmentConnection.organizationId, workspaceId),
    isNull(knowledgeEnvironmentConnection.revokedAt),
  )).limit(MAX_WORKSPACE_ENVIRONMENT_BINDINGS + 1);
  if (bindings.length > MAX_WORKSPACE_ENVIRONMENT_BINDINGS) return null;
  return bindings.map((binding) => ({
    ...binding,
    stale: binding.connectionRevision !== binding.currentConnectionRevision,
  }));
}
