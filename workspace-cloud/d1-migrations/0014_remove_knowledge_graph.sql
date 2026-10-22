-- Retire graph indexing without disabling foreign keys or removing GitHub source/webhook history.
--> statement-breakpoint
DROP TABLE `knowledge_code_index_activation_entity`;
--> statement-breakpoint
DROP TABLE `knowledge_code_index_activation_fragment`;
--> statement-breakpoint
DROP TABLE `knowledge_code_index_file`;
--> statement-breakpoint
DROP TABLE `knowledge_source_sync_job`;
--> statement-breakpoint
DROP TABLE `knowledge_mapping_proposal`;
--> statement-breakpoint
DROP TABLE `knowledge_grant_graph_revision`;
--> statement-breakpoint
DROP TABLE `knowledge_grant`;
--> statement-breakpoint
DROP TABLE `knowledge_environment_head`;
--> statement-breakpoint
DROP TRIGGER knowledge_graph_revision_reject_update;
--> statement-breakpoint
-- Break only the retired immutable graph parent chain before dropping its table.
UPDATE knowledge_graph_revision SET parent_graph_revision_id = NULL;
--> statement-breakpoint
DROP TABLE knowledge_graph_revision;
--> statement-breakpoint
-- Queued graph states become direct-file availability; unfinished graph events become terminal failures.
-- Save webhook receipt identities before rebuilding their parent source table.
CREATE TABLE __retained_knowledge_source_event AS SELECT * FROM knowledge_source_event;
--> statement-breakpoint
DROP TABLE knowledge_source_event;
--> statement-breakpoint
CREATE TABLE `__new_knowledge_source` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`github_installation_id` text,
	`repository_id` text,
	`repository_full_name` text,
	`ref_name` text,
	`commit_sha` text,
	`sync_state` text DEFAULT 'ready' NOT NULL,
	`sync_revision` integer DEFAULT 1 NOT NULL,
	`last_failure_code` text,
	`last_reconciled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `knowledge_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `knowledge_github_installation`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`project_id`) REFERENCES `knowledge_project`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`github_installation_id`) REFERENCES `knowledge_github_installation`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_source_provider" CHECK("__new_knowledge_source"."provider" = 'github'),
	CONSTRAINT "knowledge_source_name_length" CHECK(length("__new_knowledge_source"."display_name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_source_environment_revision_positive" CHECK("__new_knowledge_source"."environment_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_revision_positive" CHECK("__new_knowledge_source"."sync_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_state" CHECK("__new_knowledge_source"."sync_state" IN ('ready', 'stale', 'failed', 'revoked')),
	CONSTRAINT "knowledge_source_provider_shape" CHECK((
        "__new_knowledge_source"."provider" = 'github'
        AND "__new_knowledge_source"."github_installation_id" IS NOT NULL
        AND "__new_knowledge_source"."repository_id" IS NOT NULL
        AND "__new_knowledge_source"."repository_full_name" IS NOT NULL
        AND "__new_knowledge_source"."ref_name" IS NOT NULL
        AND (length("__new_knowledge_source"."commit_sha") BETWEEN 40 AND 40
    AND "__new_knowledge_source"."commit_sha" NOT GLOB '*[^0-9a-f]*')
      ))
);
--> statement-breakpoint
INSERT INTO `__new_knowledge_source`("id", "organization_id", "project_id", "project_environment_id", "environment_revision", "provider", "display_name", "github_installation_id", "repository_id", "repository_full_name", "ref_name", "commit_sha", "sync_state", "sync_revision", "last_failure_code", "last_reconciled_at", "created_at", "updated_at", "revoked_at") SELECT "id", "organization_id", "project_id", "project_environment_id", "environment_revision", "provider", "display_name", "github_installation_id", "repository_id", "repository_full_name", "ref_name", "commit_sha", CASE WHEN "sync_state" IN ('pending', 'syncing')
  THEN CASE WHEN "revoked_at" IS NULL THEN 'ready' ELSE 'revoked' END ELSE "sync_state" END, "sync_revision", CASE WHEN "sync_state" IN ('pending', 'syncing') THEN NULL ELSE "last_failure_code" END, "last_reconciled_at", "created_at", "updated_at", "revoked_at" FROM `knowledge_source`;
--> statement-breakpoint
DROP TABLE knowledge_source;
--> statement-breakpoint
ALTER TABLE __new_knowledge_source RENAME TO knowledge_source;
--> statement-breakpoint
CREATE INDEX `knowledge_source_environment_idx` ON `knowledge_source` (`organization_id`,`project_environment_id`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_org_id_idx` ON `knowledge_source` (`organization_id`,`id`);
--> statement-breakpoint
CREATE TABLE `knowledge_source_event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`delivery_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`before_commit_sha` text,
	`after_commit_sha` text,
	`state` text DEFAULT 'consumed' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_source_event_kind" CHECK("knowledge_source_event"."event_kind" IN ('push', 'installation', 'repository')),
	CONSTRAINT "knowledge_source_event_state" CHECK("knowledge_source_event"."state" IN ('consumed', 'failed')),
	CONSTRAINT "knowledge_source_event_commits" CHECK(("knowledge_source_event"."before_commit_sha" IS NULL OR (length("knowledge_source_event"."before_commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source_event"."before_commit_sha" NOT GLOB '*[^0-9a-f]*'))
        AND ("knowledge_source_event"."after_commit_sha" IS NULL OR (length("knowledge_source_event"."after_commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source_event"."after_commit_sha" NOT GLOB '*[^0-9a-f]*')))
);
--> statement-breakpoint
INSERT INTO `knowledge_source_event`("id", "organization_id", "source_id", "delivery_id", "event_kind", "before_commit_sha", "after_commit_sha", "state", "created_at", "consumed_at") SELECT "id", "organization_id", "source_id", "delivery_id", "event_kind", "before_commit_sha", "after_commit_sha", CASE WHEN "state" IN ('pending', 'claimed') THEN 'failed' ELSE "state" END, "created_at", CASE WHEN "state" IN ('pending', 'claimed') THEN COALESCE("consumed_at", strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE "consumed_at" END FROM `__retained_knowledge_source_event`;
--> statement-breakpoint
DROP TABLE __retained_knowledge_source_event;
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_event_delivery_idx` ON `knowledge_source_event` (`delivery_id`,`source_id`);
--> statement-breakpoint
CREATE INDEX `knowledge_source_event_source_idx` ON `knowledge_source_event` (`organization_id`,`source_id`,`created_at`);
--> statement-breakpoint
-- Rebuilt tables retain the same database-owned UUID, integer and timestamp guards.
--> statement-breakpoint
CREATE TRIGGER "knowledge_source_event_types_insert" BEFORE INSERT ON "knowledge_source_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
--> statement-breakpoint
CREATE TRIGGER "knowledge_source_event_types_update" BEFORE UPDATE ON "knowledge_source_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
--> statement-breakpoint
CREATE TRIGGER "knowledge_source_types_insert" BEFORE INSERT ON "knowledge_source"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."github_installation_id" IS NOT NULL AND NOT (length(NEW."github_installation_id") = 36 AND substr(NEW."github_installation_id", 9, 1) = '-' AND substr(NEW."github_installation_id", 14, 1) = '-' AND substr(NEW."github_installation_id", 19, 1) = '-' AND substr(NEW."github_installation_id", 24, 1) = '-' AND length(replace(NEW."github_installation_id", '-', '')) = 32 AND replace(NEW."github_installation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."sync_revision" IS NOT NULL AND NOT (typeof(NEW."sync_revision") = 'integer' AND NEW."sync_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."last_reconciled_at" IS NOT NULL AND NOT (typeof(NEW."last_reconciled_at") = 'text' AND length(NEW."last_reconciled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_reconciled_at") IS NEW."last_reconciled_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
--> statement-breakpoint
CREATE TRIGGER "knowledge_source_types_update" BEFORE UPDATE ON "knowledge_source"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."github_installation_id" IS NOT NULL AND NOT (length(NEW."github_installation_id") = 36 AND substr(NEW."github_installation_id", 9, 1) = '-' AND substr(NEW."github_installation_id", 14, 1) = '-' AND substr(NEW."github_installation_id", 19, 1) = '-' AND substr(NEW."github_installation_id", 24, 1) = '-' AND length(replace(NEW."github_installation_id", '-', '')) = 32 AND replace(NEW."github_installation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."sync_revision" IS NOT NULL AND NOT (typeof(NEW."sync_revision") = 'integer' AND NEW."sync_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."last_reconciled_at" IS NOT NULL AND NOT (typeof(NEW."last_reconciled_at") = 'text' AND length(NEW."last_reconciled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_reconciled_at") IS NEW."last_reconciled_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
