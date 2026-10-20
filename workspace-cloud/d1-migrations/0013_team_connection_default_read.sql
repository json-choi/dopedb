-- Team-read policy materializes read grants for every credential method, so a new team
-- connection can open to the whole team by default. The triggers are redefined without
-- the managed/provisioned restriction; no table is rebuilt, so grants, principals,
-- revocations, and versions keep their rows. The member-local read-only CHECK stays
-- because it still states a true invariant: a template never carries delegated write
-- authority. A member's write ability comes from the connection grant (use or manage),
-- the workspace role, and the device Safety approval, never from the template columns.
DROP TRIGGER workspace_connection_team_read_enable;
--> statement-breakpoint
DROP TRIGGER workspace_member_team_read_insert;
--> statement-breakpoint
DROP TRIGGER workspace_member_team_read_update;
--> statement-breakpoint
CREATE TRIGGER workspace_connection_team_read_enable AFTER UPDATE OF team_read_enabled, credential_mode ON workspace_connection
WHEN NEW.team_read_enabled = 1 AND NEW.deleted_at IS NULL
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
    AND connection.deleted_at IS NULL
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
    AND connection.deleted_at IS NULL
    AND profile.lifecycle_state = 'active' AND NEW.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM workspace_connection_access_exclusion denied
      WHERE denied.organization_id = NEW.organization_id AND denied.connection_id = connection.id AND denied.user_id = NEW.user_id);
END;
