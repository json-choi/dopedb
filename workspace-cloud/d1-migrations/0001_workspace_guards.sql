-- Database-owned evidence and sequencing invariants. Applied after the schema.
CREATE TRIGGER workspace_resource_version_no_update BEFORE UPDATE ON workspace_resource_version
BEGIN SELECT RAISE(ABORT, 'workspace versions are append-only'); END;
CREATE TRIGGER workspace_resource_version_no_delete BEFORE DELETE ON workspace_resource_version
BEGIN SELECT RAISE(ABORT, 'workspace versions are append-only'); END;
CREATE TRIGGER workspace_resource_conflict_no_update BEFORE UPDATE ON workspace_resource_conflict
BEGIN SELECT RAISE(ABORT, 'workspace conflicts are append-only'); END;
CREATE TRIGGER workspace_resource_conflict_no_delete BEFORE DELETE ON workspace_resource_conflict
BEGIN SELECT RAISE(ABORT, 'workspace conflicts are append-only'); END;
CREATE TRIGGER workspace_resource_conflict_resolution_no_update BEFORE UPDATE ON workspace_resource_conflict_resolution
BEGIN SELECT RAISE(ABORT, 'workspace conflict resolutions are append-only'); END;
CREATE TRIGGER workspace_resource_conflict_resolution_no_delete BEFORE DELETE ON workspace_resource_conflict_resolution
BEGIN SELECT RAISE(ABORT, 'workspace conflict resolutions are append-only'); END;

CREATE TRIGGER knowledge_graph_revision_reject_update BEFORE UPDATE ON knowledge_graph_revision
BEGIN SELECT RAISE(ABORT, 'knowledge graph revisions are immutable'); END;
CREATE TRIGGER workspace_analysis_article_revision_immutable_update BEFORE UPDATE ON workspace_analysis_article_revision
BEGIN SELECT RAISE(ABORT, 'Analysis Article evidence is immutable'); END;
CREATE TRIGGER workspace_analysis_query_receipt_immutable_update BEFORE UPDATE ON workspace_analysis_article_query_receipt
BEGIN SELECT RAISE(ABORT, 'Analysis Article evidence is immutable'); END;

CREATE TRIGGER workspace_metadata_backup_payload_immutable
BEFORE UPDATE OF ciphertext, snapshot_hash, key_reference, key_version, source_revision, data_key_id
ON workspace_metadata_backup
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.source_revision IS NOT OLD.source_revision OR NEW.snapshot_hash IS NOT OLD.snapshot_hash
  OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.reencrypted_at IS NULL
  OR NEW.reencrypted_by_rotation_id IS NULL OR NEW.data_key_id IS NULL
  OR NEW.key_reference <> 'dopedb-workspace-data-key'
  OR NOT EXISTS (
    SELECT 1 FROM workspace_data_key_rotation rotation
    JOIN workspace_data_key target ON target.organization_id = rotation.organization_id
      AND target.id = rotation.to_data_key_id
    WHERE rotation.id = NEW.reencrypted_by_rotation_id
      AND rotation.organization_id = NEW.organization_id AND rotation.status = 'running'
      AND rotation.claim_id IS NOT NULL
      AND rotation.claim_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND rotation.to_data_key_id = NEW.data_key_id
      AND NEW.key_version = 'v' || CAST(target.version AS TEXT)
  )
BEGIN SELECT RAISE(ABORT, 'workspace backup payloads are immutable outside an active key rotation'); END;

CREATE TRIGGER workspace_audit_append_sync_event AFTER INSERT ON workspace_audit_event
WHEN NEW.action NOT LIKE 'credential.lease.%'
  AND (NEW.action NOT LIKE 'workspace.backup.%' OR NEW.action = 'workspace.backup.restore')
  AND NEW.action NOT LIKE 'workspace.data_key.%'
BEGIN
  INSERT INTO workspace_sync_head (organization_id, last_sequence, updated_at)
  VALUES (NEW.organization_id, 0, NEW.created_at) ON CONFLICT (organization_id) DO NOTHING;
  SELECT RAISE(ABORT, 'workspace sync sequence exhausted') FROM workspace_sync_head
    WHERE organization_id = NEW.organization_id AND last_sequence >= 9007199254740991;
  UPDATE workspace_sync_head SET last_sequence = last_sequence + 1, updated_at = NEW.created_at
    WHERE organization_id = NEW.organization_id;
  INSERT INTO workspace_sync_event
    (organization_id, sequence, audit_event_id, resource_type, operation, tombstone, created_at)
  SELECT NEW.organization_id, last_sequence, NEW.id, NEW.resource_type, NEW.action,
    NEW.action LIKE '%.delete%' OR NEW.action LIKE '%.revoke%' OR NEW.action LIKE '%.remove%', NEW.created_at
  FROM workspace_sync_head WHERE organization_id = NEW.organization_id;
END;

CREATE TRIGGER workspace_analysis_publication_revoke_only_update
BEFORE UPDATE ON workspace_analysis_publication
WHEN NOT (
  NEW.id IS OLD.id AND NEW.organization_id IS OLD.organization_id
  AND NEW.article_id IS OLD.article_id AND NEW.article_revision IS OLD.article_revision
  AND NEW.source_run_id IS OLD.source_run_id AND NEW.slug IS OLD.slug
  AND NEW.version IS OLD.version AND NEW.replaces_publication_id IS OLD.replaces_publication_id
  AND NEW.visibility IS OLD.visibility AND NEW.title IS OLD.title
  AND NEW.description IS OLD.description AND NEW.snapshot IS OLD.snapshot
  AND NEW.snapshot_hash IS OLD.snapshot_hash AND NEW.published_at IS OLD.published_at
  AND (
    (OLD.approved_by_member_id IS NOT NULL AND NEW.approved_by_member_id IS NULL
      AND NEW.revoked_at IS OLD.revoked_at)
    OR (NEW.approved_by_member_id IS OLD.approved_by_member_id
      AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
      AND NEW.revoked_at >= OLD.published_at)
  )
)
BEGIN SELECT RAISE(ABORT, 'Analysis Article publication snapshots are immutable'); END;
