// Approval-gated fixed public Analysis Article snapshots.
import "server-only";
import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";
import { workspaceMemberAuthority } from "./d1/member-authority";
import type { AnalysisRunAuthority } from "./workspace-analysis-run-store";
import type { AnalysisPublicationRequest, AnalysisPublicSnapshot } from "./workspace-analysis-publications";
import { canonicalHash } from "./workspace-versioning";

const editorRoles = ["editor", "admin", "owner"] as const;

export async function commitAnalysisPublication(input: {
  organizationId: string; articleId: string; articleRevision: number;
  request: AnalysisPublicationRequest; snapshot: AnalysisPublicSnapshot; authority: AnalysisRunAuthority;
}) {
  const result = await atomicD1({
    scope: sql`SELECT json_object('previousId', previous.id, 'version', COALESCE(previous.version + 1, 1)) AS payload
      FROM workspace_analysis_article article JOIN workspace_analysis_article_run run
        ON run.organization_id = article.organization_id AND run.article_id = article.id
        AND run.id = ${input.request.runId} AND run.article_revision = ${input.articleRevision} AND run.state = 'succeeded'
      JOIN (${workspaceMemberAuthority(input.organizationId, input.authority, editorRoles)}) actor
        ON article.owner_member_id = actor.id OR actor.role IN ('admin', 'owner')
      LEFT JOIN workspace_analysis_publication previous ON previous.organization_id = article.organization_id
        AND previous.article_id = article.id AND previous.id = ${input.request.replacePublicationId}
        AND previous.slug = ${input.request.slug} AND previous.revoked_at IS NULL
      WHERE article.organization_id = ${input.organizationId} AND article.id = ${input.articleId}
        AND article.revision = ${input.articleRevision} AND article.deleted_at IS NULL
        AND (previous.id IS NOT NULL OR (${input.request.replacePublicationId} IS NULL AND NOT EXISTS (
          SELECT 1 FROM workspace_analysis_publication WHERE slug = ${input.request.slug} AND revoked_at IS NULL)))`,
    statements: (scope) => [
      sql`UPDATE workspace_analysis_publication SET revoked_at = ${utcNow}
        WHERE id = (SELECT payload ->> 'previousId' FROM (${scope}))`,
      sql`INSERT INTO workspace_analysis_publication (id, organization_id, article_id, article_revision, source_run_id,
          slug, version, replaces_publication_id, visibility, title, description, snapshot, snapshot_hash, approved_by_member_id)
        SELECT ${input.request.id}, ${input.organizationId}, ${input.articleId}, ${input.articleRevision}, ${input.request.runId},
          ${input.request.slug}, payload ->> 'version', payload ->> 'previousId', ${input.request.visibility},
          ${input.snapshot.title}, '', ${JSON.stringify(input.snapshot)}, ${canonicalHash(input.snapshot)},
          ${input.authority.membershipId} FROM (${scope})
        RETURNING id, article_revision AS articleRevision, source_run_id AS sourceRunId, slug, version,
          replaces_publication_id AS replacesPublicationId, visibility, title, description,
          snapshot_hash AS snapshotHash, published_at AS publishedAt, revoked_at AS revokedAt`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_publication.create', 'analysis_publication',
          ${input.request.id}, json_object('articleId', ${input.articleId}, 'articleRevision', ${input.articleRevision},
            'visibility', ${input.request.visibility}, 'version', payload ->> 'version'), ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  return result.rows[1][0] ?? null;
}

export async function revokeAnalysisPublication(input: {
  organizationId: string; articleId: string; publicationId: string; authority: AnalysisRunAuthority;
}) {
  const result = await atomicD1({
    scope: sql`SELECT '{}' AS payload FROM workspace_analysis_article article
      JOIN workspace_analysis_publication publication ON publication.organization_id = article.organization_id
        AND publication.article_id = article.id AND publication.id = ${input.publicationId}
      JOIN (${workspaceMemberAuthority(input.organizationId, input.authority, editorRoles)}) actor
        ON article.owner_member_id = actor.id OR actor.role IN ('admin', 'owner')
      WHERE article.organization_id = ${input.organizationId} AND article.id = ${input.articleId}`,
    statements: (scope) => [
      sql`UPDATE workspace_analysis_publication SET revoked_at = COALESCE(revoked_at, ${utcNow})
        WHERE id = ${input.publicationId} AND EXISTS (${scope}) RETURNING id, slug, revoked_at AS revokedAt`,
      sql`INSERT INTO workspace_audit_event (organization_id, actor_user_id, action, resource_type,
          resource_id, redacted_summary, request_id)
        SELECT ${input.organizationId}, ${input.authority.userId}, 'analysis_publication.revoke', 'analysis_publication',
          ${input.publicationId}, '{}', ${crypto.randomUUID()} FROM (${scope})`,
    ],
  });
  return result.rows[0][0] ?? null;
}
