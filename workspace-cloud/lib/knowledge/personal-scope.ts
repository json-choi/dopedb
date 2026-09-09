// Account-backed Personal Workspace Knowledge authority. This server-only
// projection never receives local folder paths, database records, or credentials.
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { atomicD1 } from "../d1/atomic";
import { utcNow } from "../d1/schema/values";

const PERSONAL_KNOWLEDGE_NAMESPACE = "dopedb.personal-knowledge.v1";
const PERSONAL_KNOWLEDGE_METADATA = JSON.stringify({
  dopedbKind: "personalKnowledge",
  version: 1,
});

export type PersonalKnowledgeProject = {
  id: string;
  name: string;
  revision: number;
  environments: Array<{
    id: string;
    name: string;
    riskClass: "production" | "staging" | "development" | "test" | "custom";
    revision: number;
  }>;
};

function deterministicUuid(kind: "workspace" | "member", userId: string) {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`${PERSONAL_KNOWLEDGE_NAMESPACE}:${kind}:${userId}`, "utf8")
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

export function personalKnowledgeOrganizationId(userId: string) {
  return deterministicUuid("workspace", userId);
}

export function isPersonalKnowledgeOrganization(userId: string, organizationId: string) {
  return organizationId === personalKnowledgeOrganizationId(userId);
}

export function isPersonalKnowledgeMetadata(metadata: string | null | undefined) {
  if (!metadata) return false;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed.dopedbKind === "personalKnowledge" && parsed.version === 1;
  } catch {
    return false;
  }
}

/** Provision the private projection and revalidate its session in one D1 batch. */
export async function ensurePersonalKnowledgeScope(input: {
  userId: string;
  sessionId: string;
  projects: PersonalKnowledgeProject[];
}) {
  const projectIds = input.projects.map((project) => project.id);
  const environmentIds = input.projects.flatMap((project) => project.environments.map((environment) => environment.id));
  if (new Set(projectIds).size !== projectIds.length || new Set(environmentIds).size !== environmentIds.length) {
    throw new Error("Duplicate Personal Knowledge identity");
  }
  const workspaceId = personalKnowledgeOrganizationId(input.userId);
  const memberId = deterministicUuid("member", input.userId);
  const slugHash = createHash("sha256").update(input.userId, "utf8").digest("hex").slice(0, 24);
  const projects = JSON.stringify(input.projects);
  const requestedProjects = sql`SELECT value ->> 'id' AS id, value ->> 'name' AS name,
    value ->> 'revision' AS revision, value -> 'environments' AS environments
    FROM json_each(${projects})`;
  const requestedEnvironments = sql`SELECT project.id AS project_id, environment.value ->> 'id' AS id,
    environment.value ->> 'name' AS name, environment.value ->> 'riskClass' AS risk_class,
    environment.value ->> 'revision' AS revision
    FROM (${requestedProjects}) project, json_each(project.environments) environment`;
  const outcome = await atomicD1({
    scope: sql`SELECT json_object('created', NOT EXISTS (SELECT 1 FROM organization WHERE id = ${workspaceId})) AS payload
      FROM session WHERE id = ${input.sessionId} AND user_id = ${input.userId} AND expires_at > ${utcNow}
      AND NOT EXISTS (SELECT 1 FROM workspace_profile WHERE organization_id = ${workspaceId} AND lifecycle_state <> 'active')
      AND NOT EXISTS (SELECT 1 FROM member WHERE organization_id = ${workspaceId} AND user_id = ${input.userId}
        AND (revocation_pending_at IS NOT NULL OR revocation_claim_id IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM (${requestedProjects}) requested JOIN knowledge_project existing
        ON existing.id = requested.id WHERE existing.organization_id <> ${workspaceId})
      AND NOT EXISTS (SELECT 1 FROM (${requestedEnvironments}) requested JOIN knowledge_project_environment existing
        ON existing.id = requested.id WHERE existing.organization_id <> ${workspaceId} OR existing.project_id <> requested.project_id)`,
    statements: (scope) => [
      sql`INSERT INTO organization (id, name, slug, metadata)
        SELECT ${workspaceId}, 'Personal Knowledge', ${`personal-knowledge-${slugHash}`}, ${PERSONAL_KNOWLEDGE_METADATA}
        FROM (${scope}) WHERE TRUE ON CONFLICT (id) DO NOTHING`,
      sql`INSERT INTO workspace_profile (organization_id, encryption_key_ref, residency_region)
        SELECT ${workspaceId}, ${`pending://${workspaceId}`}, ${process.env.WORKSPACE_DATA_REGION ?? null}
        FROM (${scope}) WHERE TRUE ON CONFLICT (organization_id) DO NOTHING`,
      sql`INSERT INTO member (id, organization_id, user_id, role)
        SELECT ${memberId}, ${workspaceId}, ${input.userId}, 'owner' FROM (${scope}) WHERE TRUE
        ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'
        WHERE member.revocation_pending_at IS NULL AND member.revocation_claim_id IS NULL`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${workspaceId}, ${input.userId}, 'workspace.create', 'workspace', ${workspaceId},
          '{"kind":"personal_knowledge"}', ${randomUUID()} FROM (${scope}) WHERE payload ->> 'created' = 1`,
      sql`INSERT INTO knowledge_project (id, organization_id, name, revision, updated_at)
        SELECT requested.id, ${workspaceId}, requested.name, requested.revision, ${utcNow}
        FROM (${requestedProjects}) requested CROSS JOIN (${scope}) WHERE TRUE
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, revision = excluded.revision,
          updated_at = excluded.updated_at, deleted_at = NULL
        WHERE knowledge_project.organization_id = excluded.organization_id RETURNING id`,
      sql`INSERT INTO knowledge_project_environment
          (id, organization_id, project_id, name, production, risk_class, revision, updated_at)
        SELECT requested.id, ${workspaceId}, requested.project_id, requested.name,
          requested.risk_class = 'production', requested.risk_class, requested.revision, ${utcNow}
        FROM (${requestedEnvironments}) requested CROSS JOIN (${scope}) WHERE TRUE
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, production = excluded.production,
          risk_class = excluded.risk_class, revision = excluded.revision, updated_at = excluded.updated_at
        WHERE knowledge_project_environment.organization_id = excluded.organization_id
          AND knowledge_project_environment.project_id = excluded.project_id RETURNING id`,
      sql`SELECT member.id AS memberId FROM member CROSS JOIN (${scope})
        WHERE member.organization_id = ${workspaceId} AND member.user_id = ${input.userId}`,
    ],
  });
  const expectedEnvironments = input.projects.reduce((count, project) => count + project.environments.length, 0);
  const actualMemberId = outcome.rows[6]?.[0]?.memberId;
  if (!outcome.matched || outcome.rows[4]?.length !== input.projects.length
    || outcome.rows[5]?.length !== expectedEnvironments || typeof actualMemberId !== "string") {
    throw new Error("Personal Knowledge scope projection was incomplete");
  }
  return { workspaceId, memberId: actualMemberId };
}
