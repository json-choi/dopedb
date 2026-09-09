import "server-only";

import { sql } from "drizzle-orm";
import { atomicD1 } from "./d1/atomic";
import { utcNow } from "./d1/schema/values";

export function workspaceDeletionUnblocked(organizationId: string) {
  return sql`NOT EXISTS (SELECT 1 FROM workspace_provider_integration WHERE organization_id = ${organizationId}
      AND (revoked_at IS NULL OR status <> 'revoked'))
    AND NOT EXISTS (SELECT 1 FROM workspace_credential_lease WHERE organization_id = ${organizationId} AND revoked_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM workspace_provider_operation WHERE organization_id = ${organizationId} AND state NOT IN ('succeeded', 'failed', 'cancelled'))
    AND NOT EXISTS (SELECT 1 FROM workspace_data_key_rotation WHERE organization_id = ${organizationId} AND status = 'running')
    AND NOT EXISTS (SELECT 1 FROM member WHERE organization_id = ${organizationId} AND revocation_claim_id IS NOT NULL)`;
}

// Remove evidence before its restricted parents. Self-referential revision chains
// use deferred FK checking for this one atomic transaction, retaining all guards.
const evidenceTables = [
  "workspace_analysis_publication", "workspace_analysis_article_query_receipt", "workspace_analysis_article_run",
  "workspace_analysis_article_revision", "workspace_analysis_article", "workspace_analysis_runner",
  "workspace_metadata_backup", "workspace_data_key_rotation", "workspace_data_key",
  "workspace_resource_conflict_resolution", "workspace_resource_conflict", "workspace_resource_version",
  "workspace_provider_import_request", "knowledge_environment_head", "knowledge_grant", "knowledge_mapping_proposal",
  "knowledge_graph_revision", "knowledge_source", "workspace_connection",
] as const;

export async function purgeDueWorkspace(organizationId: string, receiptId: string) {
  const result = await atomicD1({
    scope: sql`SELECT json_object('purgeOrganization', profile.organization_id, 'purgeReceipt', receipt.id) AS payload
      FROM workspace_profile profile JOIN workspace_deletion_receipt receipt
        ON receipt.id = profile.deletion_receipt_id AND receipt.organization_id = profile.organization_id
      WHERE profile.organization_id = ${organizationId} AND profile.deletion_receipt_id = ${receiptId}
        AND profile.lifecycle_state = 'deletion_pending' AND profile.purge_after <= ${utcNow}
        AND receipt.status = 'pending' AND receipt.purge_after <= ${utcNow}
        AND ${workspaceDeletionUnblocked(organizationId)}`,
    statements: (scope) => [
      sql`PRAGMA defer_foreign_keys = ON`,
      sql`UPDATE workspace_deletion_receipt SET status = 'purged', purged_at = ${utcNow}
        WHERE id = ${receiptId} AND organization_id = ${organizationId} AND EXISTS (${scope})`,
      ...evidenceTables.map((table) => sql`DELETE FROM ${sql.identifier(table)} WHERE organization_id = ${organizationId} AND EXISTS (${scope})`),
      sql`DELETE FROM organization WHERE id = ${organizationId} AND EXISTS (${scope}) RETURNING id`,
    ],
  });
  return result.rows.at(-1)?.[0]?.id === organizationId;
}
