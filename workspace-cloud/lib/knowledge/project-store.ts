// Project and Environment authority is checked inside each atomic D1 batch.
import "server-only";

import { sql } from "drizzle-orm";

import { randomUUID } from "node:crypto";
import { atomicD1 } from "../d1/atomic";
import { utcNow } from "../d1/schema/values";
import {
  knowledgeMutationAuthoritySql,
  type KnowledgeMutationAuthority,
} from "./mutation-authority";

export const KNOWLEDGE_RISK_CLASSES = [
  "production",
  "staging",
  "development",
  "test",
  "custom",
] as const;

export type KnowledgeRiskClass = (typeof KNOWLEDGE_RISK_CLASSES)[number];

export type StoredKnowledgeProject = {
  id: string;
  name: string;
  revision: number;
  environments: Array<{
    id: string;
    name: string;
    riskClass: KnowledgeRiskClass;
    revision: number;
  }>;
};

type ProjectRow = {
  projectId: string;
  projectName: string;
  projectRevision: string | number;
  environmentId: string;
  environmentName: string;
  riskClass: KnowledgeRiskClass;
  environmentRevision: string | number;
};

export type DeleteKnowledgeProjectOutcome =
  | "deleted"
  | "active_analyses"
  | "stale";

function positiveRevision(value: string | number, field: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Project Knowledge returned an invalid ${field}`);
  }
  return revision;
}

function projectFromRows(rows: ProjectRow[]): StoredKnowledgeProject | null {
  const first = rows[0];
  if (!first) return null;
  if (
    rows.some(
      (row) =>
        row.projectId !== first.projectId ||
        row.projectName !== first.projectName ||
        !KNOWLEDGE_RISK_CLASSES.includes(row.riskClass),
    )
  ) {
    throw new Error("Project Knowledge crossed a Project identity");
  }
  return {
    id: first.projectId,
    name: first.projectName,
    revision: positiveRevision(first.projectRevision, "Project revision"),
    environments: rows.map((row) => ({
      id: row.environmentId,
      name: row.environmentName,
      riskClass: row.riskClass,
      revision: positiveRevision(row.environmentRevision, "Environment revision"),
    })),
  };
}

function projectRows(projectId: string, scope: ReturnType<typeof sql>) {
  return sql`SELECT project.id AS projectId, project.name AS projectName, project.revision AS projectRevision,
    environment.id AS environmentId, environment.name AS environmentName,
    environment.risk_class AS riskClass, environment.revision AS environmentRevision
    FROM knowledge_project project JOIN knowledge_project_environment environment ON environment.project_id = project.id
    CROSS JOIN (${scope}) WHERE project.id = ${projectId} ORDER BY environment.name, environment.id`;
}

export async function insertKnowledgeProject(input: {
  organizationId: string;
  name: string;
  environments: Array<{ name: string; riskClass: KnowledgeRiskClass }>;
  authority: KnowledgeMutationAuthority;
}): Promise<StoredKnowledgeProject | null> {
  const id = randomUUID();
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload WHERE ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
      AND NOT EXISTS (SELECT 1 FROM knowledge_project WHERE organization_id = ${input.organizationId}
        AND name = ${input.name} AND deleted_at IS NULL)`,
    statements: (scope) => [
      sql`INSERT INTO knowledge_project (id, organization_id, name)
        SELECT ${id}, ${input.organizationId}, ${input.name} FROM (${scope})`,
      sql`INSERT INTO knowledge_project_environment (organization_id, project_id, name, production, risk_class)
        SELECT ${input.organizationId}, ${id}, requested.value ->> 'name',
          requested.value ->> 'riskClass' = 'production', requested.value ->> 'riskClass'
        FROM json_each(${JSON.stringify(input.environments)}) requested CROSS JOIN (${scope})`,
      projectRows(id, scope),
    ],
  });
  return projectFromRows(result.rows[2] as ProjectRow[]);
}

export async function appendKnowledgeEnvironment(input: {
  organizationId: string;
  projectId: string;
  expectedProjectRevision: number;
  name: string;
  riskClass: KnowledgeRiskClass;
  authority: KnowledgeMutationAuthority;
}): Promise<StoredKnowledgeProject | null> {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM knowledge_project project
      WHERE ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
        AND project.organization_id = ${input.organizationId} AND project.id = ${input.projectId}
        AND project.revision = ${input.expectedProjectRevision} AND project.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM knowledge_project_environment
          WHERE project_id = project.id AND name = ${input.name})`,
    statements: (scope) => [
      sql`UPDATE knowledge_project SET revision = revision + 1, updated_at = ${utcNow}
        WHERE id = ${input.projectId} AND EXISTS (${scope})`,
      sql`INSERT INTO knowledge_project_environment (organization_id, project_id, name, production, risk_class)
        SELECT ${input.organizationId}, ${input.projectId}, ${input.name}, ${input.riskClass === "production"},
          ${input.riskClass} FROM (${scope})`,
      projectRows(input.projectId, scope),
    ],
  });
  return projectFromRows(result.rows[2] as ProjectRow[]);
}

/** Tombstone the Project and revoke derived grants together; retain its evidence. */
export async function deleteKnowledgeProject(input: {
  organizationId: string;
  projectId: string;
  expectedRevision: number;
  authority: KnowledgeMutationAuthority;
}): Promise<DeleteKnowledgeProjectOutcome> {
  const environments = sql`SELECT id FROM knowledge_project_environment
    WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId}`;
  const sources = sql`SELECT id FROM knowledge_source
    WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId}`;
  const result = await atomicD1({
    scope: sql`SELECT json_object(
        'blocked', EXISTS (SELECT 1 FROM workspace_analysis_article
          WHERE organization_id = ${input.organizationId} AND project_environment_id IN (${environments}) AND deleted_at IS NULL),
        'bindingCount', (SELECT count(*) FROM knowledge_environment_connection
          WHERE organization_id = ${input.organizationId} AND project_environment_id IN (${environments}) AND revoked_at IS NULL),
        'sourceCount', (SELECT count(*) FROM knowledge_source
          WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId} AND revoked_at IS NULL),
        'grantCount', (SELECT count(*) FROM knowledge_grant
          WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId} AND revoked_at IS NULL),
        'syncJobCount', (SELECT count(*) FROM knowledge_source_sync_job
          WHERE organization_id = ${input.organizationId} AND source_id IN (${sources}) AND state IN ('queued', 'claimed')),
        'sourceEventCount', (SELECT count(*) FROM knowledge_source_event
          WHERE organization_id = ${input.organizationId} AND source_id IN (${sources}) AND state IN ('pending', 'claimed'))
      ) AS payload FROM knowledge_project project
      WHERE ${knowledgeMutationAuthoritySql(input.authority, input.organizationId)}
        AND project.organization_id = ${input.organizationId} AND project.id = ${input.projectId}
        AND project.revision = ${input.expectedRevision} AND project.deleted_at IS NULL`,
    statements: (scope) => {
      const eligible = sql`SELECT payload FROM (${scope}) WHERE payload ->> 'blocked' = 0`;
      return [
        sql`UPDATE knowledge_project SET deleted_at = ${utcNow}, revision = revision + 1, updated_at = ${utcNow}
          WHERE id = ${input.projectId} AND EXISTS (${eligible})`,
        sql`UPDATE knowledge_environment_connection SET revoked_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND project_environment_id IN (${environments})
            AND revoked_at IS NULL AND EXISTS (${eligible})`,
        sql`UPDATE knowledge_source SET sync_state = 'revoked', sync_revision = sync_revision + 1,
            revoked_at = ${utcNow}, updated_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId}
            AND revoked_at IS NULL AND EXISTS (${eligible})`,
        sql`UPDATE knowledge_source_sync_job SET state = 'superseded', failure_code = 'project_deleted',
            worker_id = NULL, claimed_at = NULL, lease_expires_at = NULL, finished_at = ${utcNow}, updated_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND source_id IN (${sources})
            AND state IN ('queued', 'claimed') AND EXISTS (${eligible})`,
        sql`UPDATE knowledge_source_event SET state = 'failed', consumed_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND source_id IN (${sources})
            AND state IN ('pending', 'claimed') AND EXISTS (${eligible})`,
        sql`UPDATE knowledge_grant SET revoked_at = ${utcNow}
          WHERE organization_id = ${input.organizationId} AND project_id = ${input.projectId}
            AND revoked_at IS NULL AND EXISTS (${eligible})`,
        sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
            resource_id, redacted_summary, request_id)
          SELECT ${input.organizationId}, ${input.authority.userId}, 'knowledge.project.delete', 'knowledge_project',
            ${input.projectId}, json_remove(payload, '$.blocked'), ${randomUUID()} FROM (${eligible})`,
        sql`SELECT payload ->> 'blocked' AS blocked FROM (${scope})`,
      ];
    },
  });
  if (!result.matched) return "stale";
  return result.rows[7][0]?.blocked === 1 ? "active_analyses" : "deleted";
}
