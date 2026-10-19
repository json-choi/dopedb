CREATE TABLE `workspace_direct_endpoint` (
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`engine` text NOT NULL,
	`scope` text NOT NULL,
	`scope_revision` integer DEFAULT 1 NOT NULL,
	`write_ceiling` integer DEFAULT false NOT NULL,
	`server_fingerprint` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `connection_id`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_direct_endpoint_engine" CHECK("workspace_direct_endpoint"."engine" IN ('postgres', 'mysql')),
	CONSTRAINT "workspace_direct_endpoint_scope" CHECK(json_valid("workspace_direct_endpoint"."scope") AND json_type("workspace_direct_endpoint"."scope") = 'array'
        AND json_array_length("workspace_direct_endpoint"."scope") BETWEEN 1 AND 64),
	CONSTRAINT "workspace_direct_endpoint_scope_revision" CHECK(typeof("workspace_direct_endpoint"."scope_revision") = 'integer' AND "workspace_direct_endpoint"."scope_revision" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "workspace_direct_endpoint_write_ceiling" CHECK(typeof("workspace_direct_endpoint"."write_ceiling") = 'integer' AND "workspace_direct_endpoint"."write_ceiling" IN (0, 1)),
	CONSTRAINT "workspace_direct_endpoint_fingerprint" CHECK("workspace_direct_endpoint"."server_fingerprint" IS NULL OR length("workspace_direct_endpoint"."server_fingerprint") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE `workspace_direct_principal` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`member_id` text NOT NULL,
	`user_id` text NOT NULL,
	`principal_name` text NOT NULL,
	`marker` text NOT NULL,
	`verifier_kind` text NOT NULL,
	`verifier` text NOT NULL,
	`verifier_version` integer DEFAULT 1 NOT NULL,
	`applied_verifier_version` integer DEFAULT 0 NOT NULL,
	`applied_level` text DEFAULT 'none' NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL,
	`failure_code` text,
	`server_role_oid` text,
	`applied_by_device_id` text,
	`claim_expires_at` text,
	`scope_revision_applied` integer,
	`last_synced_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_direct_principal_name" CHECK(length("workspace_direct_principal"."principal_name") = 27 AND substr("workspace_direct_principal"."principal_name", 1, 7) = 'dopedb_'
        AND substr("workspace_direct_principal"."principal_name", 8) NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "workspace_direct_principal_marker" CHECK(length("workspace_direct_principal"."marker") = 43 AND "workspace_direct_principal"."marker" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "workspace_direct_principal_verifier" CHECK(("workspace_direct_principal"."verifier_kind" = 'scram-sha-256' AND length("workspace_direct_principal"."verifier") = 133
          AND "workspace_direct_principal"."verifier" GLOB 'SCRAM-SHA-256$4096:*')
        OR ("workspace_direct_principal"."verifier_kind" = 'caching_sha2' AND length("workspace_direct_principal"."verifier") = 70
          AND "workspace_direct_principal"."verifier" GLOB '$A$005$*')),
	CONSTRAINT "workspace_direct_principal_versions" CHECK("workspace_direct_principal"."verifier_version" BETWEEN 1 AND 9007199254740991
        AND "workspace_direct_principal"."applied_verifier_version" BETWEEN 0 AND "workspace_direct_principal"."verifier_version"),
	CONSTRAINT "workspace_direct_principal_applied_level" CHECK("workspace_direct_principal"."applied_level" IN ('none', 'read', 'write')),
	CONSTRAINT "workspace_direct_principal_state" CHECK("workspace_direct_principal"."state" IN ('requested', 'applying', 'ready', 'failed', 'drop_pending', 'dropped')),
	CONSTRAINT "workspace_direct_principal_failure_code" CHECK(("workspace_direct_principal"."state" = 'failed') = ("workspace_direct_principal"."failure_code" IS NOT NULL)
        AND ("workspace_direct_principal"."failure_code" IS NULL OR "workspace_direct_principal"."failure_code" IN (
          'marker_mismatch', 'oid_mismatch', 'owns_objects', 'unexpected_membership',
          'grantor_insufficient', 'version_unsupported', 'endpoint_changed',
          'permission_denied', 'network', 'name_conflict', 'credential_missing'))),
	CONSTRAINT "workspace_direct_principal_lengths" CHECK(length("workspace_direct_principal"."member_id") BETWEEN 1 AND 128 AND length("workspace_direct_principal"."user_id") BETWEEN 1 AND 128
        AND ("workspace_direct_principal"."server_role_oid" IS NULL OR length("workspace_direct_principal"."server_role_oid") BETWEEN 1 AND 64)
        AND ("workspace_direct_principal"."applied_by_device_id" IS NULL OR length("workspace_direct_principal"."applied_by_device_id") BETWEEN 1 AND 128))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_direct_principal_name_idx` ON `workspace_direct_principal` (`organization_id`,`connection_id`,`principal_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_direct_principal_live_member_idx` ON `workspace_direct_principal` (`organization_id`,`connection_id`,`member_id`) WHERE "state" <> 'dropped';--> statement-breakpoint
CREATE INDEX `workspace_direct_principal_work_idx` ON `workspace_direct_principal` (`organization_id`,`connection_id`,`state`);--> statement-breakpoint
CREATE TABLE `workspace_direct_revocation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_level` text NOT NULL,
	`requested_by_user_id` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_direct_revocation_kind" CHECK("workspace_direct_revocation"."kind" IN ('member_removed', 'grant_lowered', 'role_lowered', 'team_read_off',
        'db_deleted', 'self_leave', 'account_deleted')),
	CONSTRAINT "workspace_direct_revocation_target" CHECK("workspace_direct_revocation"."target_level" IN ('none', 'read')),
	CONSTRAINT "workspace_direct_revocation_state" CHECK("workspace_direct_revocation"."state" IN ('pending', 'applied', 'cancelled')),
	CONSTRAINT "workspace_direct_revocation_lengths" CHECK(length("workspace_direct_revocation"."member_id") BETWEEN 1 AND 128
        AND ("workspace_direct_revocation"."requested_by_user_id" IS NULL OR length("workspace_direct_revocation"."requested_by_user_id") BETWEEN 1 AND 128))
);
--> statement-breakpoint
CREATE INDEX `workspace_direct_revocation_pending_idx` ON `workspace_direct_revocation` (`organization_id`,`connection_id`,`state`);--> statement-breakpoint

-- Add the column in place: rebuilding this FK parent would cascade existing state.
ALTER TABLE workspace_connection ADD COLUMN provisioning_mode text NOT NULL DEFAULT 'none'
  CHECK (provisioning_mode IN ('none', 'provisioned')
    AND (provisioning_mode = 'none' OR credential_mode = 'member_local'));
--> statement-breakpoint
CREATE TRIGGER workspace_connection_provisioning_immutable BEFORE UPDATE OF provisioning_mode ON workspace_connection
WHEN NEW.provisioning_mode <> OLD.provisioning_mode
BEGIN
  SELECT RAISE(ABORT, 'Provisioning mode is immutable');
END;
--> statement-breakpoint
-- Team-read policy also materializes read grants for provisioned (direct) databases.
DROP TRIGGER workspace_connection_team_read_enable;
--> statement-breakpoint
DROP TRIGGER workspace_member_team_read_insert;
--> statement-breakpoint
DROP TRIGGER workspace_member_team_read_update;
--> statement-breakpoint
CREATE TRIGGER workspace_connection_team_read_enable AFTER UPDATE OF team_read_enabled, credential_mode ON workspace_connection
WHEN NEW.team_read_enabled = 1 AND (NEW.credential_mode = 'managed' OR NEW.provisioning_mode = 'provisioned') AND NEW.deleted_at IS NULL
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
    AND (connection.credential_mode = 'managed' OR connection.provisioning_mode = 'provisioned') AND connection.deleted_at IS NULL
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
    AND (connection.credential_mode = 'managed' OR connection.provisioning_mode = 'provisioned') AND connection.deleted_at IS NULL
    AND profile.lifecycle_state = 'active' AND NEW.role IN ('viewer', 'analyst', 'editor', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM workspace_connection_access_exclusion denied
      WHERE denied.organization_id = NEW.organization_id AND denied.connection_id = connection.id AND denied.user_id = NEW.user_id);
END;
--> statement-breakpoint
-- Endpoint: only a live provisioned member-local connection of the same engine; scope is a
-- bounded duplicate-free list of printable names; the server fingerprint binds once.
CREATE TRIGGER workspace_direct_endpoint_insert BEFORE INSERT ON workspace_direct_endpoint
BEGIN
  SELECT RAISE(ABORT, 'Direct endpoint requires a provisioned member-local connection')
  WHERE NOT EXISTS (SELECT 1 FROM workspace_connection connection
    WHERE connection.organization_id = NEW.organization_id AND connection.id = NEW.connection_id
      AND connection.provisioning_mode = 'provisioned' AND connection.credential_mode = 'member_local'
      AND connection.engine = NEW.engine AND connection.deleted_at IS NULL);
  SELECT RAISE(ABORT, 'Invalid direct endpoint scope')
  WHERE EXISTS (SELECT 1 FROM json_each(NEW.scope) item WHERE item.type <> 'text'
      OR length(item.value) NOT BETWEEN 1 AND 128
      OR item.value GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*'))
    OR (SELECT count(DISTINCT value) FROM json_each(NEW.scope)) <> json_array_length(NEW.scope);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_direct_endpoint_update BEFORE UPDATE ON workspace_direct_endpoint
BEGIN
  SELECT RAISE(ABORT, 'Direct endpoint identity is immutable')
  WHERE NEW.organization_id <> OLD.organization_id OR NEW.connection_id <> OLD.connection_id OR NEW.engine <> OLD.engine;
  SELECT RAISE(ABORT, 'Direct endpoint fingerprint is bound once')
  WHERE OLD.server_fingerprint IS NOT NULL AND NEW.server_fingerprint IS NOT OLD.server_fingerprint;
  SELECT RAISE(ABORT, 'Direct endpoint scope revision must advance with the scope')
  WHERE NEW.scope_revision < OLD.scope_revision
    OR (NEW.scope IS NOT OLD.scope AND NEW.scope_revision <= OLD.scope_revision);
  SELECT RAISE(ABORT, 'Invalid direct endpoint scope')
  WHERE NEW.scope IS NOT OLD.scope AND (
    EXISTS (SELECT 1 FROM json_each(NEW.scope) item WHERE item.type <> 'text'
      OR length(item.value) NOT BETWEEN 1 AND 128
      OR item.value GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*'))
    OR (SELECT count(DISTINCT value) FROM json_each(NEW.scope)) <> json_array_length(NEW.scope));
END;
--> statement-breakpoint
-- Principal receipt: server-generated identity is immutable, only allowed state
-- transitions apply, and a receipt exists only for a provisioned connection with an endpoint.
CREATE TRIGGER workspace_direct_principal_insert BEFORE INSERT ON workspace_direct_principal
BEGIN
  SELECT RAISE(ABORT, 'Direct principal requires a live provisioned connection with an endpoint')
  WHERE NOT EXISTS (SELECT 1 FROM workspace_connection connection
    JOIN workspace_direct_endpoint endpoint ON endpoint.organization_id = connection.organization_id
      AND endpoint.connection_id = connection.id
    WHERE connection.organization_id = NEW.organization_id AND connection.id = NEW.connection_id
      AND connection.provisioning_mode = 'provisioned' AND connection.credential_mode = 'member_local'
      AND connection.deleted_at IS NULL);
  SELECT RAISE(ABORT, 'A new direct principal starts requested')
  WHERE NEW.state <> 'requested' OR NEW.applied_level <> 'none' OR NEW.applied_verifier_version <> 0
    OR NEW.verifier_version <> 1 OR NEW.server_role_oid IS NOT NULL;
  SELECT RAISE(ABORT, 'Verifier kind does not match the endpoint engine')
  WHERE NOT EXISTS (SELECT 1 FROM workspace_direct_endpoint endpoint
    WHERE endpoint.organization_id = NEW.organization_id AND endpoint.connection_id = NEW.connection_id
      AND ((endpoint.engine = 'postgres' AND NEW.verifier_kind = 'scram-sha-256')
        OR (endpoint.engine = 'mysql' AND NEW.verifier_kind = 'caching_sha2')));
END;
--> statement-breakpoint
CREATE TRIGGER workspace_direct_principal_update BEFORE UPDATE ON workspace_direct_principal
BEGIN
  SELECT RAISE(ABORT, 'Direct principal identity is immutable')
  WHERE NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.connection_id <> OLD.connection_id
    OR NEW.member_id <> OLD.member_id OR NEW.user_id <> OLD.user_id OR NEW.principal_name <> OLD.principal_name
    OR NEW.marker <> OLD.marker OR NEW.verifier_kind <> OLD.verifier_kind;
  SELECT RAISE(ABORT, 'Direct principal versions only advance')
  WHERE NEW.verifier_version < OLD.verifier_version OR NEW.applied_verifier_version < OLD.applied_verifier_version
    OR (NEW.verifier <> OLD.verifier AND NEW.verifier_version <= OLD.verifier_version);
  SELECT RAISE(ABORT, 'Direct principal server role is bound once')
  WHERE OLD.server_role_oid IS NOT NULL AND NEW.server_role_oid IS NOT OLD.server_role_oid;
  SELECT RAISE(ABORT, 'Direct principal state transition is not allowed')
  WHERE NEW.state <> OLD.state AND NOT (
    (OLD.state = 'requested' AND NEW.state IN ('applying', 'drop_pending', 'dropped'))
    OR (OLD.state = 'applying' AND NEW.state IN ('ready', 'failed', 'requested', 'drop_pending'))
    OR (OLD.state = 'ready' AND NEW.state IN ('applying', 'requested', 'drop_pending'))
    OR (OLD.state = 'failed' AND NEW.state IN ('requested', 'applying', 'drop_pending', 'dropped'))
    OR (OLD.state = 'drop_pending' AND NEW.state IN ('dropped', 'failed')));
  SELECT RAISE(ABORT, 'A dropped direct principal is terminal')
  WHERE OLD.state = 'dropped';
END;
--> statement-breakpoint
-- Ownership evidence cannot be erased while its connection lives and the role may still exist.
CREATE TRIGGER workspace_direct_principal_delete BEFORE DELETE ON workspace_direct_principal
WHEN OLD.state <> 'dropped' AND EXISTS (SELECT 1 FROM workspace_connection
  WHERE organization_id = OLD.organization_id AND id = OLD.connection_id)
BEGIN
  SELECT RAISE(ABORT, 'A live direct principal receipt cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER workspace_direct_revocation_insert BEFORE INSERT ON workspace_direct_revocation
BEGIN
  SELECT RAISE(ABORT, 'Direct revocation requires a provisioned connection')
  WHERE NOT EXISTS (SELECT 1 FROM workspace_connection
    WHERE organization_id = NEW.organization_id AND id = NEW.connection_id AND provisioning_mode = 'provisioned');
  SELECT RAISE(ABORT, 'A new direct revocation starts pending')
  WHERE NEW.state <> 'pending';
END;
--> statement-breakpoint
CREATE TRIGGER workspace_direct_revocation_update BEFORE UPDATE ON workspace_direct_revocation
BEGIN
  SELECT RAISE(ABORT, 'Direct revocation facts are immutable')
  WHERE NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.connection_id <> OLD.connection_id
    OR NEW.member_id <> OLD.member_id OR NEW.kind <> OLD.kind OR NEW.target_level <> OLD.target_level
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id;
  SELECT RAISE(ABORT, 'Direct revocation state transition is not allowed')
  WHERE NEW.state <> OLD.state AND NOT (OLD.state = 'pending' AND NEW.state IN ('applied', 'cancelled'));
  SELECT RAISE(ABORT, 'A settled direct revocation is terminal')
  WHERE OLD.state <> 'pending';
END;
--> statement-breakpoint
CREATE TRIGGER workspace_direct_revocation_delete BEFORE DELETE ON workspace_direct_revocation
WHEN OLD.state = 'pending' AND EXISTS (SELECT 1 FROM workspace_connection
  WHERE organization_id = OLD.organization_id AND id = OLD.connection_id)
BEGIN
  SELECT RAISE(ABORT, 'A pending direct revocation cannot be deleted');
END;
