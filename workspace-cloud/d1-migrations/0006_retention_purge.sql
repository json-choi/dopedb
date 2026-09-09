-- Evidence deletion is possible only inside the exact due-workspace purge batch.
DROP TRIGGER workspace_resource_version_no_delete;
--> statement-breakpoint
CREATE TRIGGER workspace_resource_version_no_delete BEFORE DELETE ON workspace_resource_version
WHEN NOT EXISTS (SELECT 1 FROM workspace_atomic_scope scope
  JOIN workspace_deletion_receipt receipt ON receipt.id = json_extract(scope.payload, '$.purgeReceipt')
    AND receipt.organization_id = json_extract(scope.payload, '$.purgeOrganization')
  WHERE receipt.organization_id = OLD.organization_id AND receipt.status = 'purged'
    AND receipt.purge_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
BEGIN SELECT RAISE(ABORT, 'Workspace evidence requires an exact retention purge'); END;
--> statement-breakpoint
DROP TRIGGER workspace_resource_conflict_no_delete;
--> statement-breakpoint
CREATE TRIGGER workspace_resource_conflict_no_delete BEFORE DELETE ON workspace_resource_conflict
WHEN NOT EXISTS (SELECT 1 FROM workspace_atomic_scope scope
  JOIN workspace_deletion_receipt receipt ON receipt.id = json_extract(scope.payload, '$.purgeReceipt')
    AND receipt.organization_id = json_extract(scope.payload, '$.purgeOrganization')
  WHERE receipt.organization_id = OLD.organization_id AND receipt.status = 'purged'
    AND receipt.purge_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
BEGIN SELECT RAISE(ABORT, 'Workspace evidence requires an exact retention purge'); END;
--> statement-breakpoint
DROP TRIGGER workspace_resource_conflict_resolution_no_delete;
--> statement-breakpoint
CREATE TRIGGER workspace_resource_conflict_resolution_no_delete BEFORE DELETE ON workspace_resource_conflict_resolution
WHEN NOT EXISTS (SELECT 1 FROM workspace_atomic_scope scope
  JOIN workspace_deletion_receipt receipt ON receipt.id = json_extract(scope.payload, '$.purgeReceipt')
    AND receipt.organization_id = json_extract(scope.payload, '$.purgeOrganization')
  WHERE receipt.organization_id = OLD.organization_id AND receipt.status = 'purged'
    AND receipt.purge_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
BEGIN SELECT RAISE(ABORT, 'Workspace evidence requires an exact retention purge'); END;
--> statement-breakpoint
CREATE TRIGGER organization_retention_delete_guard BEFORE DELETE ON organization
WHEN NOT EXISTS (SELECT 1 FROM workspace_atomic_scope scope
  JOIN workspace_deletion_receipt receipt ON receipt.id = json_extract(scope.payload, '$.purgeReceipt')
    AND receipt.organization_id = json_extract(scope.payload, '$.purgeOrganization')
  WHERE receipt.organization_id = OLD.id AND receipt.status = 'purged'
    AND receipt.purge_after <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
BEGIN SELECT RAISE(ABORT, 'Workspace deletion requires its exact retention receipt'); END;
