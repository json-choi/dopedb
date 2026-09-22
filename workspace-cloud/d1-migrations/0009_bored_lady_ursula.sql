CREATE TABLE `workspace_connection_access_exclusion` (
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `connection_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
-- Add columns in place: rebuilding these FK parents would cascade existing state.
ALTER TABLE workspace_connection ADD COLUMN team_read_enabled integer NOT NULL DEFAULT 0
  CHECK (typeof(team_read_enabled) = 'integer' AND team_read_enabled IN (0, 1));
--> statement-breakpoint
ALTER TABLE workspace_connection_grant ADD COLUMN origin text NOT NULL DEFAULT 'explicit'
  CHECK (origin IN ('explicit', 'team') AND (origin <> 'team' OR capability IN ('view', 'read')));
--> statement-breakpoint
-- Preserve known historical removals before any manager opts an old connection in.
INSERT OR IGNORE INTO workspace_connection_access_exclusion (organization_id, connection_id, user_id)
SELECT audit.organization_id, audit.resource_id, member.user_id
FROM workspace_audit_event audit
JOIN member ON member.organization_id = audit.organization_id AND member.id = audit.redacted_summary ->> 'memberId'
JOIN workspace_connection connection ON connection.organization_id = audit.organization_id AND connection.id = audit.resource_id
WHERE audit.action = 'connection.grant.revoke'
  AND NOT EXISTS (SELECT 1 FROM workspace_connection_grant grant
    WHERE grant.organization_id = audit.organization_id AND grant.connection_id = audit.resource_id AND grant.member_id = member.id);
--> statement-breakpoint
-- The policy materializes ordinary grants; every existing lease and Agent gate
-- continues to require the same tenant-scoped concrete grant.
CREATE TRIGGER workspace_connection_team_read_enable AFTER UPDATE OF team_read_enabled, credential_mode ON workspace_connection
WHEN NEW.team_read_enabled = 1 AND NEW.credential_mode = 'managed' AND NEW.deleted_at IS NULL
BEGIN
  INSERT OR IGNORE INTO workspace_connection_grant (organization_id, connection_id, member_id, capability, origin)
  SELECT NEW.organization_id, NEW.id, member.id, CASE WHEN member.role = 'viewer' THEN 'view' ELSE 'read' END, 'team'
  FROM member JOIN workspace_profile profile ON profile.organization_id = member.organization_id
  WHERE member.organization_id = NEW.organization_id AND member.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    AND member.revocation_pending_at IS NULL AND member.revocation_claim_id IS NULL AND profile.lifecycle_state = 'active'
    AND NOT EXISTS (SELECT 1 FROM workspace_connection_access_exclusion denied
      WHERE denied.organization_id = NEW.organization_id AND denied.connection_id = NEW.id AND denied.user_id = member.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_member_team_read_insert AFTER INSERT ON member
WHEN NEW.revocation_pending_at IS NULL AND NEW.revocation_claim_id IS NULL
BEGIN
  INSERT OR IGNORE INTO workspace_connection_grant (organization_id, connection_id, member_id, capability, origin)
  SELECT NEW.organization_id, connection.id, NEW.id, CASE WHEN NEW.role = 'viewer' THEN 'view' ELSE 'read' END, 'team'
  FROM workspace_connection connection JOIN workspace_profile profile ON profile.organization_id = connection.organization_id
  WHERE connection.organization_id = NEW.organization_id AND connection.team_read_enabled = 1
    AND connection.credential_mode = 'managed' AND connection.deleted_at IS NULL
    AND profile.lifecycle_state = 'active' AND NEW.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM workspace_connection_access_exclusion denied
      WHERE denied.organization_id = NEW.organization_id AND denied.connection_id = connection.id AND denied.user_id = NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_member_team_read_update AFTER UPDATE OF role, revocation_pending_at, revocation_claim_id ON member
WHEN NEW.revocation_pending_at IS NULL AND NEW.revocation_claim_id IS NULL
BEGIN
  UPDATE workspace_connection_grant SET capability = CASE WHEN NEW.role = 'viewer' THEN 'view' ELSE 'read' END
  WHERE organization_id = NEW.organization_id AND member_id = NEW.id AND origin = 'team'
    AND NEW.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner');
  INSERT OR IGNORE INTO workspace_connection_grant (organization_id, connection_id, member_id, capability, origin)
  SELECT NEW.organization_id, connection.id, NEW.id, CASE WHEN NEW.role = 'viewer' THEN 'view' ELSE 'read' END, 'team'
  FROM workspace_connection connection JOIN workspace_profile profile ON profile.organization_id = connection.organization_id
  WHERE connection.organization_id = NEW.organization_id AND connection.team_read_enabled = 1
    AND connection.credential_mode = 'managed' AND connection.deleted_at IS NULL
    AND profile.lifecycle_state = 'active' AND NEW.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM workspace_connection_access_exclusion denied
      WHERE denied.organization_id = NEW.organization_id AND denied.connection_id = connection.id AND denied.user_id = NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_team_grant_audit AFTER INSERT ON workspace_connection_grant
WHEN NEW.origin = 'team'
BEGIN
  INSERT INTO workspace_audit_event (organization_id, action, resource_type, resource_id, redacted_summary, request_id)
  VALUES (NEW.organization_id, 'connection.grant.team_read', 'connection', NEW.connection_id,
    json_object('memberId', NEW.member_id, 'userId', (SELECT user_id FROM member WHERE id = NEW.member_id AND organization_id = NEW.organization_id), 'capability', NEW.capability), NEW.id);
END;
--> statement-breakpoint
-- Rejoining must not escape an explicit per-connection restriction. Workspace or
-- account purges do not retain exclusions after their identity has gone away.
CREATE TRIGGER workspace_member_preserve_explicit_access BEFORE DELETE ON member
WHEN EXISTS (SELECT 1 FROM user WHERE id = OLD.user_id)
  AND EXISTS (SELECT 1 FROM workspace_profile WHERE organization_id = OLD.organization_id AND lifecycle_state = 'active')
BEGIN
  INSERT OR IGNORE INTO workspace_connection_access_exclusion (organization_id, connection_id, user_id)
  SELECT organization_id, connection_id, OLD.user_id FROM workspace_connection_grant
  WHERE organization_id = OLD.organization_id AND member_id = OLD.id AND origin = 'explicit';
END;
