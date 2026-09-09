CREATE TABLE `account` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` text,
	`refresh_token_expires_at` text,
	`scope` text,
	`password` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_subject_idx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE TABLE `device_code` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` text,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_device_code_unique` ON `device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_code_user_code_unique` ON `device_code` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_code_user_idx` ON `device_code` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organization_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`revocation_pending_at` text,
	`revocation_claimed_at` text,
	`revocation_claim_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_revocation_claim_consistent" CHECK(("member"."revocation_claimed_at" IS NULL AND "member"."revocation_claim_id" IS NULL)
        OR ("member"."revocation_claimed_at" IS NOT NULL
          AND "member"."revocation_claim_id" IS NOT NULL
          AND "member"."revocation_pending_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_user_idx` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `member_user_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_id_idx` ON `member` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE INDEX `rate_limit_last_request_idx` ON `rate_limit` (`last_request`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`expires_at` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`active_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `workspace_audit_event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`redacted_summary` text DEFAULT '{}' NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workspace_audit_org_created_idx` ON `workspace_audit_event` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_audit_org_id_idx` ON `workspace_audit_event` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_deletion_receipt` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requested_by_user_id` text,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`purge_after` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cancelled_at` text,
	`purged_at` text,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_deletion_receipt_status" CHECK("workspace_deletion_receipt"."status" IN ('pending', 'cancelled', 'purged')),
	CONSTRAINT "workspace_deletion_receipt_deadline" CHECK("workspace_deletion_receipt"."purge_after" >= strftime('%Y-%m-%dT%H:%M:%fZ', "workspace_deletion_receipt"."requested_at", '+24 hours')),
	CONSTRAINT "workspace_deletion_receipt_terminal" CHECK(("workspace_deletion_receipt"."status" = 'pending'
          AND "workspace_deletion_receipt"."cancelled_at" IS NULL AND "workspace_deletion_receipt"."purged_at" IS NULL)
        OR ("workspace_deletion_receipt"."status" = 'cancelled'
          AND "workspace_deletion_receipt"."cancelled_at" IS NOT NULL AND "workspace_deletion_receipt"."purged_at" IS NULL)
        OR ("workspace_deletion_receipt"."status" = 'purged'
          AND "workspace_deletion_receipt"."cancelled_at" IS NULL AND "workspace_deletion_receipt"."purged_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_deletion_receipt_org_pending_idx` ON `workspace_deletion_receipt` (`organization_id`) WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX `workspace_deletion_receipt_purge_idx` ON `workspace_deletion_receipt` (`status`,`purge_after`);--> statement-breakpoint
CREATE TABLE `workspace_profile` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`lifecycle_state` text DEFAULT 'active' NOT NULL,
	`encryption_key_ref` text NOT NULL,
	`residency_region` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`deletion_receipt_id` text,
	`deletion_requested_at` text,
	`purge_after` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deletion_receipt_id`) REFERENCES `workspace_deletion_receipt`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_profile_revision" CHECK("workspace_profile"."revision" >= 1 AND "workspace_profile"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_profile_lifecycle" CHECK(("workspace_profile"."lifecycle_state" = 'active'
        AND "workspace_profile"."deletion_receipt_id" IS NULL
        AND "workspace_profile"."deletion_requested_at" IS NULL
        AND "workspace_profile"."purge_after" IS NULL)
      OR ("workspace_profile"."lifecycle_state" = 'deletion_pending'
        AND "workspace_profile"."deletion_receipt_id" IS NOT NULL
        AND "workspace_profile"."deletion_requested_at" IS NOT NULL
        AND "workspace_profile"."purge_after" IS NOT NULL
        AND "workspace_profile"."purge_after" >= strftime('%Y-%m-%dT%H:%M:%fZ', "workspace_profile"."deletion_requested_at", '+24 hours')))
);
--> statement-breakpoint
CREATE INDEX `workspace_profile_lifecycle_purge_idx` ON `workspace_profile` (`lifecycle_state`,`purge_after`);--> statement-breakpoint
CREATE TABLE `workspace_sync_event` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`audit_event_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`operation` text NOT NULL,
	`tombstone` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`audit_event_id`) REFERENCES `workspace_audit_event`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_sync_event_sequence" CHECK("workspace_sync_event"."sequence" >= 1 AND "workspace_sync_event"."sequence" <= 9007199254740991),
	CONSTRAINT "workspace_sync_event_resource_type_length" CHECK(length("workspace_sync_event"."resource_type") BETWEEN 1 AND 64),
	CONSTRAINT "workspace_sync_event_operation_length" CHECK(length("workspace_sync_event"."operation") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sync_event_org_sequence_idx` ON `workspace_sync_event` (`organization_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_sync_event_audit_idx` ON `workspace_sync_event` (`audit_event_id`);--> statement-breakpoint
CREATE TABLE `workspace_sync_head` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_sync_head_sequence" CHECK("workspace_sync_head"."last_sequence" >= 0 AND "workspace_sync_head"."last_sequence" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `workspace_provider_integration` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`external_account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_credential` text NOT NULL,
	`credential_expires_at` text,
	`granted_scope` text,
	`local_verification_target` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	`revocation_pending_at` text,
	`revocation_claimed_at` text,
	`revocation_claim_id` text,
	`refresh_claimed_at` text,
	`refresh_claim_id` text,
	`refresh_generation` integer,
	`refresh_phase` text DEFAULT 'idle' NOT NULL,
	`refresh_remote_started_at` text,
	`disconnect_phase` text DEFAULT 'idle' NOT NULL,
	`disconnect_generation` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "provider_integration_revocation_claim_consistent" CHECK(("workspace_provider_integration"."revocation_claimed_at" IS NULL AND "workspace_provider_integration"."revocation_claim_id" IS NULL)
        OR ("workspace_provider_integration"."revocation_claimed_at" IS NOT NULL
          AND "workspace_provider_integration"."revocation_claim_id" IS NOT NULL
          AND "workspace_provider_integration"."revocation_pending_at" IS NOT NULL)),
	CONSTRAINT "provider_integration_generation_positive" CHECK("workspace_provider_integration"."generation" >= 1),
	CONSTRAINT "provider_integration_local_verification_target_shape" CHECK((
        "workspace_provider_integration"."provider" = 'gcpCloudSql' AND (
          (
            "workspace_provider_integration"."status" = 'active' AND "workspace_provider_integration"."revoked_at" IS NULL
            AND "workspace_provider_integration"."local_verification_target" IS NOT NULL
            AND json_type("workspace_provider_integration"."local_verification_target") = 'object'
            AND json_type("workspace_provider_integration"."local_verification_target", '$.kind') IS NOT NULL
            AND json_type("workspace_provider_integration"."local_verification_target", '$.projectId') IS NOT NULL
            AND json_type("workspace_provider_integration"."local_verification_target", '$.instanceId') IS NOT NULL
            AND json_remove("workspace_provider_integration"."local_verification_target", '$.kind', '$.projectId', '$.instanceId') = '{}'
            AND "workspace_provider_integration"."local_verification_target"->>'kind' = 'gcpCloudSql'
            AND ((length("workspace_provider_integration"."local_verification_target"->>'projectId') BETWEEN 6 AND 30
    AND "workspace_provider_integration"."local_verification_target"->>'projectId' NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_provider_integration"."local_verification_target"->>'projectId', 1, 1) GLOB '[a-z]'
        AND substr("workspace_provider_integration"."local_verification_target"->>'projectId', -1) GLOB '[a-z0-9]')
            AND ((length("workspace_provider_integration"."local_verification_target"->>'instanceId') BETWEEN 1 AND 98
    AND "workspace_provider_integration"."local_verification_target"->>'instanceId' NOT GLOB '*[^A-Za-z0-9_-]*') AND substr("workspace_provider_integration"."local_verification_target"->>'instanceId', 1, 1) GLOB '[A-Za-z0-9]')
          )
          OR (
            ("workspace_provider_integration"."status" <> 'active' OR "workspace_provider_integration"."revoked_at" IS NOT NULL)
            AND (
              "workspace_provider_integration"."local_verification_target" IS NULL OR (
                json_type("workspace_provider_integration"."local_verification_target") = 'object'
                AND json_type("workspace_provider_integration"."local_verification_target", '$.kind') IS NOT NULL
            AND json_type("workspace_provider_integration"."local_verification_target", '$.projectId') IS NOT NULL
            AND json_type("workspace_provider_integration"."local_verification_target", '$.instanceId') IS NOT NULL
                AND json_remove("workspace_provider_integration"."local_verification_target", '$.kind', '$.projectId', '$.instanceId') = '{}'
                AND "workspace_provider_integration"."local_verification_target"->>'kind' = 'gcpCloudSql'
                AND ((length("workspace_provider_integration"."local_verification_target"->>'projectId') BETWEEN 6 AND 30
    AND "workspace_provider_integration"."local_verification_target"->>'projectId' NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_provider_integration"."local_verification_target"->>'projectId', 1, 1) GLOB '[a-z]'
        AND substr("workspace_provider_integration"."local_verification_target"->>'projectId', -1) GLOB '[a-z0-9]')
                AND ((length("workspace_provider_integration"."local_verification_target"->>'instanceId') BETWEEN 1 AND 98
    AND "workspace_provider_integration"."local_verification_target"->>'instanceId' NOT GLOB '*[^A-Za-z0-9_-]*') AND substr("workspace_provider_integration"."local_verification_target"->>'instanceId', 1, 1) GLOB '[A-Za-z0-9]')
              )
            )
          )
        )
      ) OR ("workspace_provider_integration"."provider" <> 'gcpCloudSql' AND "workspace_provider_integration"."local_verification_target" IS NULL)),
	CONSTRAINT "provider_integration_refresh_claim_consistent" CHECK(("workspace_provider_integration"."refresh_phase" = 'idle'
            AND "workspace_provider_integration"."refresh_claimed_at" IS NULL AND "workspace_provider_integration"."refresh_claim_id" IS NULL
            AND "workspace_provider_integration"."refresh_generation" IS NULL AND "workspace_provider_integration"."refresh_remote_started_at" IS NULL)
        OR ("workspace_provider_integration"."refresh_phase" = 'claimed'
            AND "workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_provider_integration"."refresh_remote_started_at" IS NULL)
        OR ("workspace_provider_integration"."refresh_phase" = 'remote_started'
            AND "workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_provider_integration"."refresh_remote_started_at" IS NOT NULL)
        OR ("workspace_provider_integration"."refresh_phase" = 'reconnect_required'
            AND "workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_provider_integration"."refresh_remote_started_at" IS NOT NULL)),
	CONSTRAINT "provider_integration_disconnect_phase" CHECK("workspace_provider_integration"."disconnect_phase" IN ('idle', 'claimed', 'lease_cleanup_pending', 'leases_revoked',
          'provider_revoke_started', 'provider_revoke_ambiguous',
          'provider_revoked', 'finalized')),
	CONSTRAINT "provider_integration_disconnect_generation_consistent" CHECK(("workspace_provider_integration"."disconnect_phase" = 'idle' AND "workspace_provider_integration"."disconnect_generation" IS NULL)
        OR ("workspace_provider_integration"."disconnect_phase" <> 'idle' AND "workspace_provider_integration"."disconnect_generation" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_integration_org_provider_account_idx` ON `workspace_provider_integration` (`organization_id`,`provider`,`external_account_id`);--> statement-breakpoint
CREATE INDEX `provider_integration_org_status_idx` ON `workspace_provider_integration` (`organization_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_integration_org_id_idx` ON `workspace_provider_integration` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_integration_org_id_provider_idx` ON `workspace_provider_integration` (`organization_id`,`id`,`provider`);--> statement-breakpoint
CREATE TABLE `workspace_provider_operation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`integration_generation` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'awaiting_approval' NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`plan_hash` text NOT NULL,
	`plan_version` integer DEFAULT 1 NOT NULL,
	`plan_expires_at` text NOT NULL,
	`risk` text NOT NULL,
	`approval_policy` text NOT NULL,
	`requested_by_member_id` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`requested_by_session_id` text NOT NULL,
	`requested_by_role` text NOT NULL,
	`resource_scope` text NOT NULL,
	`source_resource_id` text NOT NULL,
	`target_name` text NOT NULL,
	`ownership_marker` text NOT NULL,
	`redacted_plan` text NOT NULL,
	`provider_operation_id` text,
	`provider_resource_id` text,
	`redacted_result` text,
	`failure_code` text,
	`claim_id` text,
	`claimed_at` text,
	`remote_started_at` text,
	`reconcile_after` text,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`integration_id`,`provider`) REFERENCES `workspace_provider_integration`(`organization_id`,`id`,`provider`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_operation_provider" CHECK("workspace_provider_operation"."provider" = 'neon'),
	CONSTRAINT "provider_operation_kind" CHECK("workspace_provider_operation"."kind" IN (
        'neon.branch.create', 'neon.branch.delete', 'neon.branch.switch'
      )),
	CONSTRAINT "provider_operation_state" CHECK("workspace_provider_operation"."state" IN (
        'awaiting_approval', 'approved', 'claimed', 'remote_started',
        'reconciling', 'succeeded', 'failed', 'needs_repair', 'cancelled'
      )),
	CONSTRAINT "provider_operation_generation" CHECK("workspace_provider_operation"."integration_generation" >= 1),
	CONSTRAINT "provider_operation_hashes" CHECK((length("workspace_provider_operation"."request_hash") BETWEEN 64 AND 64
    AND "workspace_provider_operation"."request_hash" NOT GLOB '*[^0-9a-f]*')
        AND (length("workspace_provider_operation"."plan_hash") BETWEEN 64 AND 64
    AND "workspace_provider_operation"."plan_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "provider_operation_plan_version" CHECK("workspace_provider_operation"."plan_version" = 1),
	CONSTRAINT "provider_operation_risk" CHECK("workspace_provider_operation"."risk" IN ('standard', 'production_data')),
	CONSTRAINT "provider_operation_approval_policy" CHECK("workspace_provider_operation"."approval_policy" IN ('single_admin', 'separate_admin')
        AND ("workspace_provider_operation"."risk" <> 'production_data'
          OR "workspace_provider_operation"."approval_policy" = 'separate_admin')),
	CONSTRAINT "provider_operation_requester_role" CHECK("workspace_provider_operation"."requested_by_role" IN ('admin', 'owner')),
	CONSTRAINT "provider_operation_scope_length" CHECK(length("workspace_provider_operation"."resource_scope") BETWEEN 1 AND 512
        AND length("workspace_provider_operation"."source_resource_id") BETWEEN 1 AND 512
        AND length("workspace_provider_operation"."target_name") BETWEEN 1 AND 256
        AND length("workspace_provider_operation"."ownership_marker") BETWEEN 1 AND 256
        AND length("workspace_provider_operation"."requested_by_member_id") BETWEEN 1 AND 512
        AND length("workspace_provider_operation"."requested_by_user_id") BETWEEN 1 AND 512
        AND length("workspace_provider_operation"."requested_by_session_id") BETWEEN 1 AND 512),
	CONSTRAINT "provider_operation_neon_identifiers" CHECK(((length("workspace_provider_operation"."resource_scope") BETWEEN 1 AND 60
    AND "workspace_provider_operation"."resource_scope" NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_provider_operation"."resource_scope", 1, 1) GLOB '[a-z0-9]')
        AND ((length("workspace_provider_operation"."source_resource_id") BETWEEN 1 AND 60
    AND "workspace_provider_operation"."source_resource_id" NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_provider_operation"."source_resource_id", 1, 1) GLOB '[a-z0-9]')
        AND (substr("workspace_provider_operation"."ownership_marker", 1, 3) = 'v1.' AND (length(substr("workspace_provider_operation"."ownership_marker", 4)) BETWEEN 43 AND 43
    AND substr("workspace_provider_operation"."ownership_marker", 4) NOT GLOB '*[^A-Za-z0-9_-]*'))),
	CONSTRAINT "provider_operation_provider_identifiers" CHECK("workspace_provider_operation"."provider_operation_id" IS NULL
        OR (length("workspace_provider_operation"."provider_operation_id") = 36 AND substr("workspace_provider_operation"."provider_operation_id", 9, 1) = '-'
        AND substr("workspace_provider_operation"."provider_operation_id", 14, 1) = '-' AND substr("workspace_provider_operation"."provider_operation_id", 19, 1) = '-'
        AND substr("workspace_provider_operation"."provider_operation_id", 24, 1) = '-' AND substr("workspace_provider_operation"."provider_operation_id", 15, 1) GLOB '[1-8]'
        AND substr("workspace_provider_operation"."provider_operation_id", 20, 1) GLOB '[89ab]'
        AND (length(replace("workspace_provider_operation"."provider_operation_id", '-', '')) BETWEEN 32 AND 32
    AND replace("workspace_provider_operation"."provider_operation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "provider_operation_provider_resource" CHECK("workspace_provider_operation"."provider_resource_id" IS NULL
        OR ((length("workspace_provider_operation"."provider_resource_id") BETWEEN 1 AND 60
    AND "workspace_provider_operation"."provider_resource_id" NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_provider_operation"."provider_resource_id", 1, 1) GLOB '[a-z0-9]')),
	CONSTRAINT "provider_operation_failure_code" CHECK("workspace_provider_operation"."failure_code" IS NULL
        OR ((length("workspace_provider_operation"."failure_code") BETWEEN 1 AND 96
    AND "workspace_provider_operation"."failure_code" NOT GLOB '*[^A-Z0-9_]*') AND substr("workspace_provider_operation"."failure_code", 1, 1) GLOB '[A-Z]')),
	CONSTRAINT "provider_operation_json_shapes" CHECK(json_type("workspace_provider_operation"."redacted_plan") = 'object'
        AND ("workspace_provider_operation"."redacted_result" IS NULL
          OR json_type("workspace_provider_operation"."redacted_result") = 'object')),
	CONSTRAINT "provider_operation_plan_expiry" CHECK("workspace_provider_operation"."plan_expires_at" > "workspace_provider_operation"."created_at"
        AND "workspace_provider_operation"."plan_expires_at" <= strftime('%Y-%m-%dT%H:%M:%fZ', "workspace_provider_operation"."created_at", '+15 minutes')),
	CONSTRAINT "provider_operation_claim_consistency" CHECK((
          "workspace_provider_operation"."state" IN ('awaiting_approval', 'approved')
          AND "workspace_provider_operation"."claim_id" IS NULL AND "workspace_provider_operation"."claimed_at" IS NULL
          AND "workspace_provider_operation"."remote_started_at" IS NULL AND "workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_provider_operation"."state" = 'claimed'
          AND "workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_provider_operation"."claimed_at" IS NOT NULL
          AND "workspace_provider_operation"."remote_started_at" IS NULL AND "workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_provider_operation"."state" IN ('remote_started', 'reconciling')
          AND "workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_provider_operation"."claimed_at" IS NOT NULL
          AND "workspace_provider_operation"."remote_started_at" IS NOT NULL AND "workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_provider_operation"."state" IN ('succeeded', 'failed', 'needs_repair', 'cancelled')
          AND "workspace_provider_operation"."completed_at" IS NOT NULL
        )),
	CONSTRAINT "provider_operation_claim_pair" CHECK(("workspace_provider_operation"."claim_id" IS NULL AND "workspace_provider_operation"."claimed_at" IS NULL)
        OR ("workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_provider_operation"."claimed_at" IS NOT NULL)),
	CONSTRAINT "provider_operation_failure_state" CHECK("workspace_provider_operation"."failure_code" IS NULL
        OR "workspace_provider_operation"."state" IN ('failed', 'needs_repair')),
	CONSTRAINT "provider_operation_success_resource" CHECK("workspace_provider_operation"."state" <> 'succeeded' OR "workspace_provider_operation"."provider_resource_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_operation_org_idempotency_idx` ON `workspace_provider_operation` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `provider_operation_org_state_updated_idx` ON `workspace_provider_operation` (`organization_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `provider_operation_integration_state_idx` ON `workspace_provider_operation` (`integration_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_operation_org_id_idx` ON `workspace_provider_operation` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_provider_operation_approval` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`plan_hash` text NOT NULL,
	`decision` text NOT NULL,
	`actor_member_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_session_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`operation_id`) REFERENCES `workspace_provider_operation`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_operation_approval_hash" CHECK((length("workspace_provider_operation_approval"."plan_hash") BETWEEN 64 AND 64
    AND "workspace_provider_operation_approval"."plan_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "provider_operation_approval_decision" CHECK("workspace_provider_operation_approval"."decision" IN ('approved', 'rejected')),
	CONSTRAINT "provider_operation_approval_role" CHECK("workspace_provider_operation_approval"."actor_role" IN ('admin', 'owner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_operation_approval_org_operation_idx` ON `workspace_provider_operation_approval` (`organization_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `provider_oauth_state` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`state_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_oauth_state_hash_idx` ON `provider_oauth_state` (`state_hash`);--> statement-breakpoint
CREATE INDEX `provider_oauth_state_expiry_idx` ON `provider_oauth_state` (`expires_at`);--> statement-breakpoint
CREATE TABLE `provider_setup_session` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credential` text NOT NULL,
	`account_label` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_setup_session_provider" CHECK("provider_setup_session"."provider" = 'gcpCloudSql')
);
--> statement-breakpoint
CREATE INDEX `provider_setup_session_scope_idx` ON `provider_setup_session` (`organization_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_setup_session_expiry_idx` ON `provider_setup_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `workspace_provider_discovery_receipt` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`integration_generation` integer NOT NULL,
	`member_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`resource_id`) REFERENCES `workspace_provider_resource`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`integration_id`) REFERENCES `workspace_provider_integration`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_discovery_receipt_org_expiry_idx` ON `workspace_provider_discovery_receipt` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `workspace_provider_principal_claim` (
	`principal_fingerprint` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`target_fingerprint` text NOT NULL,
	`access_kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`integration_id`) REFERENCES `workspace_provider_integration`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "provider_principal_claim_principal_hash" CHECK((length("workspace_provider_principal_claim"."principal_fingerprint") BETWEEN 64 AND 64
    AND "workspace_provider_principal_claim"."principal_fingerprint" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "provider_principal_claim_target_hash" CHECK((length("workspace_provider_principal_claim"."target_fingerprint") BETWEEN 64 AND 64
    AND "workspace_provider_principal_claim"."target_fingerprint" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "provider_principal_claim_access_kind" CHECK("workspace_provider_principal_claim"."access_kind" IN ('read', 'write', 'schema'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_principal_claim_integration_access_idx` ON `workspace_provider_principal_claim` (`integration_id`,`access_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_principal_claim_org_target_idx` ON `workspace_provider_principal_claim` (`organization_id`,`target_fingerprint`) WHERE "access_kind" = 'read';--> statement-breakpoint
CREATE INDEX `provider_principal_claim_target_idx` ON `workspace_provider_principal_claim` (`target_fingerprint`);--> statement-breakpoint
CREATE TABLE `workspace_provider_resource` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`provider` text NOT NULL,
	`resource_fingerprint` text NOT NULL,
	`resource` text NOT NULL,
	`redacted_metadata` text NOT NULL,
	`capability_manifest` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_resource_org_provider_fingerprint_idx` ON `workspace_provider_resource` (`organization_id`,`provider`,`resource_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_resource_org_id_idx` ON `workspace_provider_resource` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_connection` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`engine` text NOT NULL,
	`provider` text DEFAULT 'auto' NOT NULL,
	`driver_id` text,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`database_name` text NOT NULL,
	`sslmode` text NOT NULL,
	`readonly_default` integer DEFAULT true NOT NULL,
	`allow_writes` integer DEFAULT false NOT NULL,
	`credential_mode` text DEFAULT 'member_local' NOT NULL,
	`provider_integration_id` text,
	`provider_resource` text,
	`provider_resource_id` text,
	`environment` text,
	`schema_group` text,
	`content_revision` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`revocation_pending_at` text,
	`revocation_claimed_at` text,
	`revocation_claim_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_integration_id`) REFERENCES `workspace_provider_integration`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`provider_integration_id`) REFERENCES `workspace_provider_integration`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`provider_resource_id`) REFERENCES `workspace_provider_resource`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_connection_revocation_claim_consistent" CHECK(("workspace_connection"."revocation_claimed_at" IS NULL AND "workspace_connection"."revocation_claim_id" IS NULL)
        OR ("workspace_connection"."revocation_claimed_at" IS NOT NULL
          AND "workspace_connection"."revocation_claim_id" IS NOT NULL
          AND "workspace_connection"."revocation_pending_at" IS NOT NULL)),
	CONSTRAINT "workspace_connection_content_revision" CHECK("workspace_connection"."content_revision" >= 1 AND "workspace_connection"."content_revision" <= 9007199254740991),
	CONSTRAINT "workspace_connection_revision" CHECK("workspace_connection"."revision" >= 1 AND "workspace_connection"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_connection_member_local_read_only" CHECK(("workspace_connection"."credential_mode" = 'member_local' AND "workspace_connection"."readonly_default" = TRUE AND "workspace_connection"."allow_writes" = FALSE)
        OR "workspace_connection"."credential_mode" = 'managed')
);
--> statement-breakpoint
CREATE INDEX `workspace_connection_org_updated_idx` ON `workspace_connection` (`organization_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_connection_org_provider_resource_idx` ON `workspace_connection` (`organization_id`,`provider_resource_id`) WHERE "provider_resource_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_connection_org_id_idx` ON `workspace_connection` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_connection_grant` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`member_id` text NOT NULL,
	`capability` text DEFAULT 'view' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_connection_grant_capability" CHECK("workspace_connection_grant"."capability" IN ('view', 'read', 'use', 'manage'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_connection_grant_org_connection_member_idx` ON `workspace_connection_grant` (`organization_id`,`connection_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `workspace_connection_grant_org_member_idx` ON `workspace_connection_grant` (`organization_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `workspace_provider_import_request` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`production_approved` integer DEFAULT false NOT NULL,
	`resource_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`resource_id`) REFERENCES `workspace_provider_resource`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "provider_import_request_hash" CHECK((length("workspace_provider_import_request"."request_hash") BETWEEN 64 AND 64
    AND "workspace_provider_import_request"."request_hash" NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_import_org_key_idx` ON `workspace_provider_import_request` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `workspace_resource_conflict` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`server_version_id` text NOT NULL,
	`candidate_version_id` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`resource_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`server_version_id`) REFERENCES `workspace_resource_version`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`candidate_version_id`) REFERENCES `workspace_resource_version`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_resource_conflict_type" CHECK("workspace_resource_conflict"."resource_type" = 'connection'),
	CONSTRAINT "workspace_resource_conflict_expected_revision" CHECK("workspace_resource_conflict"."expected_revision" >= 0 AND "workspace_resource_conflict"."expected_revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `workspace_resource_conflict_org_resource_idx` ON `workspace_resource_conflict` (`organization_id`,`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_conflict_org_id_idx` ON `workspace_resource_conflict` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_resource_conflict_resolution` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`conflict_id` text NOT NULL,
	`resolution` text NOT NULL,
	`resulting_version_id` text NOT NULL,
	`resolved_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`conflict_id`) REFERENCES `workspace_resource_conflict`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`resulting_version_id`) REFERENCES `workspace_resource_version`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_resource_conflict_resolution_value" CHECK("workspace_resource_conflict_resolution"."resolution" IN ('server', 'candidate', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_conflict_resolution_org_id_idx` ON `workspace_resource_conflict_resolution` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_conflict_resolution_org_conflict_idx` ON `workspace_resource_conflict_resolution` (`organization_id`,`conflict_id`);--> statement-breakpoint
CREATE TABLE `workspace_resource_version` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`revision` integer NOT NULL,
	`base_revision` integer,
	`parent_version_id` text,
	`branch` text DEFAULT 'main' NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`resource_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`parent_version_id`) REFERENCES `workspace_resource_version`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_resource_version_type" CHECK("workspace_resource_version"."resource_type" = 'connection'),
	CONSTRAINT "workspace_resource_version_branch" CHECK("workspace_resource_version"."branch" IN ('main', 'conflict')),
	CONSTRAINT "workspace_resource_version_revision" CHECK(("workspace_resource_version"."branch" = 'main' AND "workspace_resource_version"."revision" >= 1 AND "workspace_resource_version"."revision" <= 9007199254740991)
        OR ("workspace_resource_version"."branch" = 'conflict' AND "workspace_resource_version"."revision" >= 0 AND "workspace_resource_version"."revision" <= 9007199254740991)),
	CONSTRAINT "workspace_resource_version_base_revision" CHECK("workspace_resource_version"."base_revision" IS NULL OR ("workspace_resource_version"."base_revision" >= 0 AND "workspace_resource_version"."base_revision" <= 9007199254740991)),
	CONSTRAINT "workspace_resource_version_operation" CHECK("workspace_resource_version"."operation" IN ('create', 'update', 'delete', 'restore')),
	CONSTRAINT "workspace_resource_version_payload_hash" CHECK((length("workspace_resource_version"."payload_hash") BETWEEN 64 AND 64
    AND "workspace_resource_version"."payload_hash" NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_version_main_revision_idx` ON `workspace_resource_version` (`organization_id`,`resource_type`,`resource_id`,`revision`) WHERE "branch" = 'main';--> statement-breakpoint
CREATE INDEX `workspace_resource_version_org_resource_created_idx` ON `workspace_resource_version` (`organization_id`,`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_version_org_id_idx` ON `workspace_resource_version` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_data_key` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`version` integer NOT NULL,
	`key_reference` text NOT NULL,
	`kms_key_version` text NOT NULL,
	`wrapped_key` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`retired_at` text,
	`destroyed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_data_key_version" CHECK("workspace_data_key"."version" >= 1 AND "workspace_data_key"."version" <= 2147483647),
	CONSTRAINT "workspace_data_key_reference_length" CHECK(length("workspace_data_key"."key_reference") BETWEEN 20 AND 512),
	CONSTRAINT "workspace_data_key_kms_version" CHECK((CASE WHEN "workspace_data_key"."kms_key_version" NOT GLOB '*[^A-Za-z0-9._:/-]*' THEN json_array_length(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']')) = 10
        AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[0]') = 'projects' AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[2]') = 'locations'
        AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[4]') = 'keyRings' AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[6]') = 'cryptoKeys'
        AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[8]') = 'cryptoKeyVersions'
        AND length(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[1]')) >= 1 AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[1]') NOT GLOB '*[^A-Za-z0-9._:-]*'
        AND length(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[3]')) >= 1 AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[3]') NOT GLOB '*[^A-Za-z0-9_-]*'
        AND length(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[5]')) >= 1 AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[5]') NOT GLOB '*[^A-Za-z0-9_-]*'
        AND length(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[7]')) >= 1 AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[7]') NOT GLOB '*[^A-Za-z0-9_-]*'
        AND length(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[9]')) >= 1 AND substr(json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[9]'), 1, 1) GLOB '[1-9]'
        AND json_extract(('[' || '"' || replace("workspace_data_key"."kms_key_version", '/', '","') || '"' || ']'), '$[9]') NOT GLOB '*[^0-9]*' ELSE 0 END)),
	CONSTRAINT "workspace_data_key_wrapped_key" CHECK(("workspace_data_key"."wrapped_key" IS NOT NULL
          AND length("workspace_data_key"."wrapped_key") BETWEEN 1 AND 8192
          AND (length(rtrim("workspace_data_key"."wrapped_key", '=')) >= 1
        AND length("workspace_data_key"."wrapped_key") - length(rtrim("workspace_data_key"."wrapped_key", '=')) <= 2
        AND rtrim("workspace_data_key"."wrapped_key", '=') NOT GLOB '*[^A-Za-z0-9+/]*')
          AND "workspace_data_key"."destroyed_at" IS NULL)
        OR ("workspace_data_key"."wrapped_key" IS NULL
          AND "workspace_data_key"."destroyed_at" IS NOT NULL
          AND "workspace_data_key"."retired_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_org_version_idx` ON `workspace_data_key` (`organization_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_org_active_idx` ON `workspace_data_key` (`organization_id`) WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_org_id_idx` ON `workspace_data_key` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_data_key_rotation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`from_data_key_id` text,
	`to_data_key_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`processed_backups` integer DEFAULT 0 NOT NULL,
	`claim_id` text,
	`claim_expires_at` text,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`from_data_key_id`) REFERENCES `workspace_data_key`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`to_data_key_id`) REFERENCES `workspace_data_key`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_data_key_rotation_status" CHECK("workspace_data_key_rotation"."status" IN ('running', 'completed')),
	CONSTRAINT "workspace_data_key_rotation_processed" CHECK("workspace_data_key_rotation"."processed_backups" >= 0),
	CONSTRAINT "workspace_data_key_rotation_claim" CHECK(("workspace_data_key_rotation"."claim_id" IS NULL AND "workspace_data_key_rotation"."claim_expires_at" IS NULL)
        OR ("workspace_data_key_rotation"."status" = 'running'
          AND "workspace_data_key_rotation"."claim_id" IS NOT NULL
          AND "workspace_data_key_rotation"."claim_expires_at" IS NOT NULL)),
	CONSTRAINT "workspace_data_key_rotation_completion" CHECK(("workspace_data_key_rotation"."status" = 'running' AND "workspace_data_key_rotation"."completed_at" IS NULL)
        OR ("workspace_data_key_rotation"."status" = 'completed' AND "workspace_data_key_rotation"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_rotation_org_idempotency_idx` ON `workspace_data_key_rotation` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_rotation_org_running_idx` ON `workspace_data_key_rotation` (`organization_id`) WHERE "status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_data_key_rotation_org_id_idx` ON `workspace_data_key_rotation` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_metadata_backup` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`key_reference` text NOT NULL,
	`key_version` text NOT NULL,
	`data_key_id` text,
	`ciphertext` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`reencrypted_at` text,
	`reencrypted_by_rotation_id` text,
	`deleted_at` text,
	`purge_after` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`data_key_id`) REFERENCES `workspace_data_key`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`reencrypted_by_rotation_id`) REFERENCES `workspace_data_key_rotation`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_metadata_backup_snapshot_hash" CHECK((length("workspace_metadata_backup"."snapshot_hash") BETWEEN 64 AND 64
    AND "workspace_metadata_backup"."snapshot_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "workspace_metadata_backup_source_revision" CHECK("workspace_metadata_backup"."source_revision" >= 1 AND "workspace_metadata_backup"."source_revision" <= 9007199254740991),
	CONSTRAINT "workspace_metadata_backup_key_binding" CHECK(("workspace_metadata_backup"."data_key_id" IS NULL
          AND "workspace_metadata_backup"."key_reference" = 'dopedb-workspace-backup-hkdf-sha256'
          AND "workspace_metadata_backup"."key_version" = 'v1')
        OR ("workspace_metadata_backup"."data_key_id" IS NOT NULL
          AND "workspace_metadata_backup"."key_reference" = 'dopedb-workspace-data-key'
          AND (length("workspace_metadata_backup"."key_version") >= 2 AND substr("workspace_metadata_backup"."key_version", 1, 1) = 'v'
        AND substr("workspace_metadata_backup"."key_version", 2, 1) GLOB '[1-9]' AND substr("workspace_metadata_backup"."key_version", 2) NOT GLOB '*[^0-9]*'))),
	CONSTRAINT "workspace_metadata_backup_retention" CHECK(("workspace_metadata_backup"."deleted_at" IS NULL AND "workspace_metadata_backup"."purge_after" IS NULL)
        OR ("workspace_metadata_backup"."deleted_at" IS NOT NULL
          AND "workspace_metadata_backup"."purge_after" IS NOT NULL
          AND "workspace_metadata_backup"."purge_after" >= "workspace_metadata_backup"."deleted_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_metadata_backup_org_id_idx` ON `workspace_metadata_backup` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_metadata_backup_org_created_idx` ON `workspace_metadata_backup` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_metadata_backup_org_data_key_idx` ON `workspace_metadata_backup` (`organization_id`,`data_key_id`);--> statement-breakpoint
CREATE TABLE `workspace_credential_lease` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_mode` text NOT NULL,
	`external_credential_id` text NOT NULL,
	`external_credential_kind` text NOT NULL,
	`provider_audit_id` text,
	`active_slot` integer,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`cleanup_attempts` integer DEFAULT 0 NOT NULL,
	`cleanup_next_attempt_at` text,
	`cleanup_claimed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `workspace_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `workspace_provider_integration`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`integration_id`) REFERENCES `workspace_provider_integration`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credential_lease_active_slot_range" CHECK("workspace_credential_lease"."active_slot" IS NULL OR "workspace_credential_lease"."active_slot" BETWEEN 1 AND 5),
	CONSTRAINT "credential_lease_live_slot_required" CHECK("workspace_credential_lease"."revoked_at" IS NOT NULL OR "workspace_credential_lease"."active_slot" IS NOT NULL),
	CONSTRAINT "credential_lease_provider_audit_id_length" CHECK("workspace_credential_lease"."provider_audit_id" IS NULL OR length("workspace_credential_lease"."provider_audit_id") BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE INDEX `credential_lease_member_active_idx` ON `workspace_credential_lease` (`organization_id`,`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `credential_lease_connection_active_idx` ON `workspace_credential_lease` (`connection_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `credential_lease_expiry_idx` ON `workspace_credential_lease` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `credential_lease_active_slot_idx` ON `workspace_credential_lease` (`organization_id`,`connection_id`,`user_id`,`active_slot`) WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `credential_lease_cleanup_ready_idx` ON `workspace_credential_lease` (`cleanup_attempts`,`cleanup_next_attempt_at`,`expires_at`) WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `knowledge_environment_connection` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`connection_id` text NOT NULL,
	`connection_revision` integer NOT NULL,
	`role` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `workspace_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_environment_connection_revisions_positive" CHECK("knowledge_environment_connection"."environment_revision" >= 1 AND "knowledge_environment_connection"."connection_revision" >= 1),
	CONSTRAINT "knowledge_environment_connection_labels" CHECK(length("knowledge_environment_connection"."role") BETWEEN 1 AND 64
        AND length("knowledge_environment_connection"."alias") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_environment_connection_active_idx` ON `knowledge_environment_connection` (`organization_id`,`connection_id`) WHERE "knowledge_environment_connection"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `knowledge_environment_connection_scope_idx` ON `knowledge_environment_connection` (`organization_id`,`project_environment_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `knowledge_project` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_project_name_length" CHECK(length("knowledge_project"."name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_project_revision_positive" CHECK("knowledge_project"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_project_org_name_idx` ON `knowledge_project` (`organization_id`,`name`) WHERE "knowledge_project"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_project_org_id_idx` ON `knowledge_project` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_project_environment` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`production` integer DEFAULT false NOT NULL,
	`risk_class` text DEFAULT 'custom' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `knowledge_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_id`) REFERENCES `knowledge_project`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_environment_name_length" CHECK(length("knowledge_project_environment"."name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_environment_risk_class" CHECK("knowledge_project_environment"."risk_class" IN ('production', 'staging', 'development', 'test', 'custom')),
	CONSTRAINT "knowledge_environment_revision_positive" CHECK("knowledge_project_environment"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_environment_project_name_idx` ON `knowledge_project_environment` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_environment_org_id_idx` ON `knowledge_project_environment` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_github_installation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`installation_id` integer NOT NULL,
	`account_id` text NOT NULL,
	`account_login` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_github_installation_id_positive" CHECK("knowledge_github_installation"."installation_id" >= 1),
	CONSTRAINT "knowledge_github_installation_status" CHECK("knowledge_github_installation"."status" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "knowledge_github_installation_account_length" CHECK(length("knowledge_github_installation"."account_id") BETWEEN 1 AND 128
        AND length("knowledge_github_installation"."account_login") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_github_installation_org_external_idx` ON `knowledge_github_installation` (`organization_id`,`installation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_github_installation_org_id_idx` ON `knowledge_github_installation` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_github_setup_state` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_github_setup_state_expiry_idx` ON `knowledge_github_setup_state` (`expires_at`);--> statement-breakpoint
CREATE TABLE `knowledge_source` (
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
	`visibility` text NOT NULL,
	`github_installation_id` text,
	`repository_id` text,
	`repository_full_name` text,
	`ref_name` text,
	`commit_sha` text,
	`sync_state` text DEFAULT 'pending' NOT NULL,
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
	CONSTRAINT "knowledge_source_provider" CHECK("knowledge_source"."provider" = 'github'),
	CONSTRAINT "knowledge_source_visibility" CHECK("knowledge_source"."visibility" = 'shared_graph'),
	CONSTRAINT "knowledge_source_name_length" CHECK(length("knowledge_source"."display_name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_source_environment_revision_positive" CHECK("knowledge_source"."environment_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_revision_positive" CHECK("knowledge_source"."sync_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_state" CHECK("knowledge_source"."sync_state" IN ('pending', 'syncing', 'ready', 'stale', 'failed', 'revoked')),
	CONSTRAINT "knowledge_source_provider_shape" CHECK((
        "knowledge_source"."provider" = 'github'
        AND "knowledge_source"."github_installation_id" IS NOT NULL
        AND "knowledge_source"."repository_id" IS NOT NULL
        AND "knowledge_source"."repository_full_name" IS NOT NULL
        AND "knowledge_source"."ref_name" IS NOT NULL
        AND (length("knowledge_source"."commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source"."commit_sha" NOT GLOB '*[^0-9a-f]*')
      ))
);
--> statement-breakpoint
CREATE INDEX `knowledge_source_environment_idx` ON `knowledge_source` (`organization_id`,`project_environment_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_org_id_idx` ON `knowledge_source` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_environment_head` (
	`organization_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`source_id` text NOT NULL,
	`graph_revision_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`activated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`project_environment_id`, `source_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_environment_head_revision_positive" CHECK("knowledge_environment_head"."environment_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_environment_head_graph_revision_id_unique` ON `knowledge_environment_head` (`graph_revision_id`);--> statement-breakpoint
CREATE TABLE `knowledge_grant` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`member_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`graph_revision_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `knowledge_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_id`) REFERENCES `knowledge_project`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_grant_environment_revision_positive" CHECK("knowledge_grant"."environment_revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `knowledge_grant_member_active_idx` ON `knowledge_grant` (`organization_id`,`member_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_grant_org_id_idx` ON `knowledge_grant` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_grant_graph_revision` (
	`organization_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`graph_revision_id` text NOT NULL,
	PRIMARY KEY(`grant_id`, `graph_revision_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `knowledge_grant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`grant_id`) REFERENCES `knowledge_grant`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_graph_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`parent_graph_revision_id` text,
	`source_revision_sha256` text NOT NULL,
	`artifact_sha256` text NOT NULL,
	`artifact` text NOT NULL,
	`generated_at` text NOT NULL,
	`staged_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`parent_graph_revision_id`) REFERENCES `knowledge_graph_revision`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "knowledge_graph_revision_environment_positive" CHECK("knowledge_graph_revision"."environment_revision" >= 1),
	CONSTRAINT "knowledge_graph_revision_hashes" CHECK((length("knowledge_graph_revision"."source_revision_sha256") BETWEEN 64 AND 64
    AND "knowledge_graph_revision"."source_revision_sha256" NOT GLOB '*[^0-9a-f]*')
        AND (length("knowledge_graph_revision"."artifact_sha256") BETWEEN 64 AND 64
    AND "knowledge_graph_revision"."artifact_sha256" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "knowledge_graph_revision_artifact_object" CHECK(json_type("knowledge_graph_revision"."artifact") = 'object')
);
--> statement-breakpoint
CREATE INDEX `knowledge_graph_revision_environment_idx` ON `knowledge_graph_revision` (`organization_id`,`project_environment_id`,`staged_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_graph_revision_org_id_idx` ON `knowledge_graph_revision` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_mapping_proposal` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`graph_revision_id` text NOT NULL,
	`schema_fingerprint` text NOT NULL,
	`from_node_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_identity` text NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`proposed_by_member_id` text,
	`decided_by_member_id` text,
	`proposed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_environment_id`) REFERENCES `knowledge_project_environment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graph_revision_id`) REFERENCES `knowledge_graph_revision`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_mapping_hashes" CHECK((length("knowledge_mapping_proposal"."schema_fingerprint") BETWEEN 64 AND 64
    AND "knowledge_mapping_proposal"."schema_fingerprint" NOT GLOB '*[^0-9a-f]*')
        AND (length("knowledge_mapping_proposal"."from_node_id") BETWEEN 64 AND 64
    AND "knowledge_mapping_proposal"."from_node_id" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "knowledge_mapping_state" CHECK("knowledge_mapping_proposal"."state" IN ('proposed', 'approved', 'rejected', 'stale')),
	CONSTRAINT "knowledge_mapping_target_length" CHECK(length("knowledge_mapping_proposal"."target_kind") BETWEEN 1 AND 128
        AND length("knowledge_mapping_proposal"."target_identity") BETWEEN 1 AND 2048)
);
--> statement-breakpoint
CREATE INDEX `knowledge_mapping_review_idx` ON `knowledge_mapping_proposal` (`organization_id`,`project_environment_id`,`state`,`proposed_at`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_article` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`project_environment_id` text NOT NULL,
	`environment_revision` integer NOT NULL,
	`connection_id` text NOT NULL,
	`connection_revision` integer NOT NULL,
	`definition` text NOT NULL,
	`owner_member_id` text NOT NULL,
	`updated_by_member_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`latest_successful_run_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`project_environment_id`) REFERENCES `knowledge_project_environment`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_analysis_article_revisions" CHECK("workspace_analysis_article"."environment_revision" >= 1
        AND "workspace_analysis_article"."connection_revision" >= 1
        AND "workspace_analysis_article"."revision" >= 1
        AND "workspace_analysis_article"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_analysis_article_definition" CHECK(json_type("workspace_analysis_article"."definition") = 'object')
);
--> statement-breakpoint
CREATE INDEX `workspace_analysis_article_environment_idx` ON `workspace_analysis_article` (`organization_id`,`project_environment_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workspace_analysis_article_connection_idx` ON `workspace_analysis_article` (`organization_id`,`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_article_org_id_idx` ON `workspace_analysis_article` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_article_revision` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`article_id` text NOT NULL,
	`revision` integer NOT NULL,
	`base_revision` integer,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_by_user_id` text,
	`created_by_member_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`article_id`) REFERENCES `workspace_analysis_article`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_analysis_article_revision_numbers" CHECK("workspace_analysis_article_revision"."revision" >= 1
        AND "workspace_analysis_article_revision"."revision" <= 9007199254740991
        AND ("workspace_analysis_article_revision"."base_revision" IS NULL OR "workspace_analysis_article_revision"."base_revision" >= 0)),
	CONSTRAINT "workspace_analysis_article_revision_operation" CHECK("workspace_analysis_article_revision"."operation" IN ('create', 'propose', 'update', 'delete')),
	CONSTRAINT "workspace_analysis_article_revision_payload" CHECK(json_type("workspace_analysis_article_revision"."payload") = 'object'
        AND (length("workspace_analysis_article_revision"."payload_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_article_revision"."payload_hash" NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE INDEX `workspace_analysis_article_revision_history_idx` ON `workspace_analysis_article_revision` (`organization_id`,`article_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_article_revision_unique_idx` ON `workspace_analysis_article_revision` (`organization_id`,`article_id`,`revision`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_runner` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`member_id` text,
	`device_id` text NOT NULL,
	`display_name` text NOT NULL,
	`runner_capability_hash` text NOT NULL,
	`runner_capability_generation` integer NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_analysis_runner_text" CHECK(length("workspace_analysis_runner"."device_id") BETWEEN 1 AND 256
        AND length("workspace_analysis_runner"."display_name") BETWEEN 1 AND 256),
	CONSTRAINT "workspace_analysis_runner_member" CHECK("workspace_analysis_runner"."member_id" IS NOT NULL OR "workspace_analysis_runner"."revoked_at" IS NOT NULL),
	CONSTRAINT "workspace_analysis_runner_capability" CHECK((length("workspace_analysis_runner"."runner_capability_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_runner"."runner_capability_hash" NOT GLOB '*[^0-9a-f]*')
        AND "workspace_analysis_runner"."runner_capability_generation" >= 1
        AND "workspace_analysis_runner"."runner_capability_generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_runner_org_device_idx` ON `workspace_analysis_runner` (`organization_id`,`device_id`) WHERE "workspace_analysis_runner"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_analysis_runner_member_idx` ON `workspace_analysis_runner` (`organization_id`,`member_id`,`revoked_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_runner_org_id_idx` ON `workspace_analysis_runner` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_article_invitation` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`article_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`connection_revision` integer NOT NULL,
	`inviter_member_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`accepted_by_user_id` text,
	`revoked_at` text,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`article_id`) REFERENCES `workspace_analysis_article`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`inviter_member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_article_invitation_identity" CHECK(
      "workspace_article_invitation"."recipient_email" = lower(trim("workspace_article_invitation"."recipient_email"))
      AND length("workspace_article_invitation"."recipient_email") BETWEEN 3 AND 254
      AND "workspace_article_invitation"."connection_revision" >= 1
      AND "workspace_article_invitation"."expires_at" > "workspace_article_invitation"."created_at"
      AND (("workspace_article_invitation"."accepted_at" IS NULL) = ("workspace_article_invitation"."accepted_by_user_id" IS NULL))
    )
);
--> statement-breakpoint
CREATE INDEX `workspace_article_invitation_article_idx` ON `workspace_article_invitation` (`organization_id`,`article_id`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_article_query_receipt` (
	`organization_id` text NOT NULL,
	`run_id` text NOT NULL,
	`query_node_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`connection_revision` integer NOT NULL,
	`query_run_id` text NOT NULL,
	`query_hash` text NOT NULL,
	`schema_fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`row_count` integer NOT NULL,
	`byte_count` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`run_id`, `query_node_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`run_id`) REFERENCES `workspace_analysis_article_run`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`connection_id`) REFERENCES `workspace_connection`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "workspace_analysis_query_receipt_node" CHECK(((length("workspace_analysis_article_query_receipt"."query_node_id") BETWEEN 1 AND 64
    AND "workspace_analysis_article_query_receipt"."query_node_id" NOT GLOB '*[^A-Za-z0-9_-]*') AND substr("workspace_analysis_article_query_receipt"."query_node_id", 1, 1) GLOB '[A-Za-z]')),
	CONSTRAINT "workspace_analysis_query_receipt_hashes" CHECK((length("workspace_analysis_article_query_receipt"."query_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_article_query_receipt"."query_hash" NOT GLOB '*[^0-9a-f]*')
        AND (length("workspace_analysis_article_query_receipt"."schema_fingerprint") BETWEEN 64 AND 64
    AND "workspace_analysis_article_query_receipt"."schema_fingerprint" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "workspace_analysis_query_receipt_state" CHECK("workspace_analysis_article_query_receipt"."state" IN ('succeeded', 'failed', 'cancelled', 'stale')),
	CONSTRAINT "workspace_analysis_query_receipt_numbers" CHECK("workspace_analysis_article_query_receipt"."connection_revision" >= 1 AND "workspace_analysis_article_query_receipt"."row_count" >= 0
        AND "workspace_analysis_article_query_receipt"."byte_count" >= 0 AND "workspace_analysis_article_query_receipt"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_query_receipt_run_query_idx` ON `workspace_analysis_article_query_receipt` (`organization_id`,`run_id`,`query_run_id`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_article_run` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`article_id` text NOT NULL,
	`article_revision` integer NOT NULL,
	`runner_id` text NOT NULL,
	`runner_capability_generation` integer NOT NULL,
	`requested_by_member_id` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`definition_hash` text NOT NULL,
	`schema_fingerprints` text DEFAULT '{}' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`byte_count` integer DEFAULT 0 NOT NULL,
	`result_hash` text,
	`error_kind` text,
	`error_message` text,
	`cancel_requested_at` text,
	`cancel_requested_by_member_id` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`article_id`,`article_revision`) REFERENCES `workspace_analysis_article_revision`(`organization_id`,`article_id`,`revision`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`runner_id`) REFERENCES `workspace_analysis_runner`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`requested_by_member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`cancel_requested_by_member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_analysis_article_run_state" CHECK("workspace_analysis_article_run"."state" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale')),
	CONSTRAINT "workspace_analysis_article_run_hashes" CHECK((length("workspace_analysis_article_run"."definition_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_article_run"."definition_hash" NOT GLOB '*[^0-9a-f]*')
        AND ("workspace_analysis_article_run"."result_hash" IS NULL OR (length("workspace_analysis_article_run"."result_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_article_run"."result_hash" NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "workspace_analysis_article_run_numbers" CHECK("workspace_analysis_article_run"."article_revision" >= 1 AND "workspace_analysis_article_run"."row_count" >= 0 AND "workspace_analysis_article_run"."byte_count" >= 0),
	CONSTRAINT "workspace_analysis_article_run_json" CHECK(json_type("workspace_analysis_article_run"."schema_fingerprints") = 'object'),
	CONSTRAINT "workspace_analysis_article_run_terminal" CHECK(("workspace_analysis_article_run"."state" IN ('queued', 'running') AND "workspace_analysis_article_run"."finished_at" IS NULL)
        OR ("workspace_analysis_article_run"."state" IN ('succeeded', 'failed', 'cancelled', 'stale')
          AND "workspace_analysis_article_run"."finished_at" IS NOT NULL)),
	CONSTRAINT "workspace_analysis_article_run_error" CHECK(("workspace_analysis_article_run"."error_kind" IS NULL AND "workspace_analysis_article_run"."error_message" IS NULL)
        OR ("workspace_analysis_article_run"."error_kind" IS NOT NULL AND "workspace_analysis_article_run"."error_message" IS NOT NULL
          AND length("workspace_analysis_article_run"."error_kind") BETWEEN 1 AND 128
          AND length("workspace_analysis_article_run"."error_message") BETWEEN 1 AND 2000)),
	CONSTRAINT "workspace_analysis_article_run_cancel" CHECK(("workspace_analysis_article_run"."cancel_requested_at" IS NULL AND "workspace_analysis_article_run"."cancel_requested_by_member_id" IS NULL)
        OR "workspace_analysis_article_run"."cancel_requested_at" IS NOT NULL),
	CONSTRAINT "workspace_analysis_article_run_runner_capability" CHECK("workspace_analysis_article_run"."runner_capability_generation" >= 1
        AND "workspace_analysis_article_run"."runner_capability_generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `workspace_analysis_article_run_article_idx` ON `workspace_analysis_article_run` (`organization_id`,`article_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_article_run_org_id_idx` ON `workspace_analysis_article_run` (`organization_id`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_analysis_publication` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`article_id` text NOT NULL,
	`article_revision` integer NOT NULL,
	`source_run_id` text NOT NULL,
	`slug` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`replaces_publication_id` text,
	`visibility` text DEFAULT 'unlisted' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`snapshot` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`approved_by_member_id` text,
	`published_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`article_id`,`article_revision`) REFERENCES `workspace_analysis_article_revision`(`organization_id`,`article_id`,`revision`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`replaces_publication_id`) REFERENCES `workspace_analysis_publication`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`source_run_id`) REFERENCES `workspace_analysis_article_run`(`organization_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`organization_id`,`approved_by_member_id`) REFERENCES `member`(`organization_id`,`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "workspace_analysis_publication_slug" CHECK(((length("workspace_analysis_publication"."slug") BETWEEN 8 AND 128
    AND "workspace_analysis_publication"."slug" NOT GLOB '*[^a-z0-9-]*') AND substr("workspace_analysis_publication"."slug", 1, 1) GLOB '[a-z0-9]')),
	CONSTRAINT "workspace_analysis_publication_visibility" CHECK("workspace_analysis_publication"."visibility" IN ('unlisted', 'public')),
	CONSTRAINT "workspace_analysis_publication_snapshot" CHECK(json_type("workspace_analysis_publication"."snapshot") = 'object'
        AND (length("workspace_analysis_publication"."snapshot_hash") BETWEEN 64 AND 64
    AND "workspace_analysis_publication"."snapshot_hash" NOT GLOB '*[^0-9a-f]*')
        AND "workspace_analysis_publication"."version" >= 1),
	CONSTRAINT "workspace_analysis_publication_text" CHECK(length(trim("workspace_analysis_publication"."title")) BETWEEN 1 AND 160
        AND length("workspace_analysis_publication"."description") <= 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_publication_slug_version_idx` ON `workspace_analysis_publication` (`slug`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_publication_active_slug_idx` ON `workspace_analysis_publication` (`slug`) WHERE "workspace_analysis_publication"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_analysis_publication_article_idx` ON `workspace_analysis_publication` (`organization_id`,`article_id`,`published_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_analysis_publication_org_id_idx` ON `workspace_analysis_publication` (`organization_id`,`id`);--> statement-breakpoint
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
	`changed_files` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_source_event_kind" CHECK("knowledge_source_event"."event_kind" IN ('push', 'installation', 'repository')),
	CONSTRAINT "knowledge_source_event_state" CHECK("knowledge_source_event"."state" IN ('pending', 'claimed', 'consumed', 'failed')),
	CONSTRAINT "knowledge_source_event_commits" CHECK(("knowledge_source_event"."before_commit_sha" IS NULL OR (length("knowledge_source_event"."before_commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source_event"."before_commit_sha" NOT GLOB '*[^0-9a-f]*'))
        AND ("knowledge_source_event"."after_commit_sha" IS NULL OR (length("knowledge_source_event"."after_commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source_event"."after_commit_sha" NOT GLOB '*[^0-9a-f]*'))),
	CONSTRAINT "knowledge_source_event_files_array" CHECK(json_type("knowledge_source_event"."changed_files") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_event_delivery_idx` ON `knowledge_source_event` (`delivery_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `knowledge_source_event_pending_idx` ON `knowledge_source_event` (`organization_id`,`source_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `knowledge_source_sync_job` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`desired_commit_sha` text NOT NULL,
	`source_sync_revision` integer NOT NULL,
	`trigger_event_id` text,
	`phase` text DEFAULT 'manifest' NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`processed_files` integer DEFAULT 0 NOT NULL,
	`manifest` text,
	`source_revision_sha256` text,
	`activation_graph_revision_id` text,
	`activation_parent_graph_revision_id` text,
	`activation_generated_at` text,
	`available_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`claimed_at` text,
	`lease_expires_at` text,
	`worker_id` text,
	`failure_code` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_event_id`) REFERENCES `knowledge_source_event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_source_sync_job_state" CHECK("knowledge_source_sync_job"."state" IN ('queued', 'claimed', 'succeeded', 'failed', 'superseded')),
	CONSTRAINT "knowledge_source_sync_job_phase" CHECK("knowledge_source_sync_job"."phase" IN ('manifest', 'indexing', 'activating')),
	CONSTRAINT "knowledge_source_sync_job_commit" CHECK((length("knowledge_source_sync_job"."desired_commit_sha") BETWEEN 40 AND 40
    AND "knowledge_source_sync_job"."desired_commit_sha" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "knowledge_source_sync_job_revision_positive" CHECK("knowledge_source_sync_job"."source_sync_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_job_attempt" CHECK("knowledge_source_sync_job"."attempt" >= 0 AND "knowledge_source_sync_job"."attempt" <= 20),
	CONSTRAINT "knowledge_source_sync_job_progress" CHECK("knowledge_source_sync_job"."total_files" >= 0
        AND "knowledge_source_sync_job"."processed_files" >= 0
        AND "knowledge_source_sync_job"."processed_files" <= "knowledge_source_sync_job"."total_files"),
	CONSTRAINT "knowledge_source_sync_job_manifest" CHECK("knowledge_source_sync_job"."manifest" IS NULL OR json_type("knowledge_source_sync_job"."manifest") = 'array'),
	CONSTRAINT "knowledge_source_sync_job_source_revision" CHECK("knowledge_source_sync_job"."source_revision_sha256" IS NULL
        OR (length("knowledge_source_sync_job"."source_revision_sha256") BETWEEN 64 AND 64
    AND "knowledge_source_sync_job"."source_revision_sha256" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "knowledge_source_sync_job_activation_identity" CHECK(("knowledge_source_sync_job"."activation_graph_revision_id" IS NOT NULL
          AND "knowledge_source_sync_job"."activation_generated_at" IS NOT NULL)
        OR ("knowledge_source_sync_job"."activation_graph_revision_id" IS NULL
          AND "knowledge_source_sync_job"."activation_parent_graph_revision_id" IS NULL
          AND "knowledge_source_sync_job"."activation_generated_at" IS NULL)),
	CONSTRAINT "knowledge_source_sync_job_claim_shape" CHECK((
        "knowledge_source_sync_job"."state" = 'claimed'
        AND "knowledge_source_sync_job"."claimed_at" IS NOT NULL
        AND "knowledge_source_sync_job"."lease_expires_at" IS NOT NULL
        AND "knowledge_source_sync_job"."worker_id" IS NOT NULL
      ) OR "knowledge_source_sync_job"."state" <> 'claimed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_sync_job_revision_idx` ON `knowledge_source_sync_job` (`source_id`,`desired_commit_sha`);--> statement-breakpoint
CREATE INDEX `knowledge_source_sync_job_claim_idx` ON `knowledge_source_sync_job` (`state`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_source_sync_job_source_idx` ON `knowledge_source_sync_job` (`organization_id`,`source_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_sync_job_org_id_idx` ON `knowledge_source_sync_job` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_source_sync_job_org_id_source_idx` ON `knowledge_source_sync_job` (`organization_id`,`id`,`source_id`);--> statement-breakpoint
CREATE TABLE `knowledge_code_index_activation_entity` (
	`organization_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`primary_definition` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL,
	`canonical_payload` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`job_id`, `entity_kind`, `entity_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `knowledge_source_sync_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`,`source_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`,`source_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_code_index_activation_entity_kind" CHECK("knowledge_code_index_activation_entity"."entity_kind" IN ('node', 'edge', 'evidence')),
	CONSTRAINT "knowledge_code_index_activation_entity_identity" CHECK((length("knowledge_code_index_activation_entity"."entity_id") BETWEEN 64 AND 64
    AND "knowledge_code_index_activation_entity"."entity_id" NOT GLOB '*[^0-9a-f]*')
        AND "knowledge_code_index_activation_entity"."batch_index" >= 0
        AND json_type("knowledge_code_index_activation_entity"."payload") = 'object'
        AND "knowledge_code_index_activation_entity"."payload" ->> 'id' = "knowledge_code_index_activation_entity"."entity_id"
        AND length(CAST("knowledge_code_index_activation_entity"."canonical_payload" AS BLOB)) BETWEEN 2 AND 2097152
        AND json("knowledge_code_index_activation_entity"."canonical_payload") = json("knowledge_code_index_activation_entity"."payload")
        AND substr("knowledge_code_index_activation_entity"."canonical_payload", 1, 1) = '{'
        AND substr("knowledge_code_index_activation_entity"."canonical_payload", -1) = '}'),
	CONSTRAINT "knowledge_code_index_activation_entity_primary" CHECK(NOT "knowledge_code_index_activation_entity"."primary_definition" OR "knowledge_code_index_activation_entity"."entity_kind" = 'node')
);
--> statement-breakpoint
CREATE INDEX `knowledge_code_index_activation_entity_job_idx` ON `knowledge_code_index_activation_entity` (`organization_id`,`job_id`,`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE TABLE `knowledge_code_index_activation_fragment` (
	`organization_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`start_path` text NOT NULL,
	`end_path` text NOT NULL,
	`file_count` integer NOT NULL,
	`parsed_files` integer NOT NULL,
	`skipped_files` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`job_id`, `batch_index`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `knowledge_source_sync_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`,`source_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`,`source_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_code_index_activation_fragment_batch" CHECK("knowledge_code_index_activation_fragment"."batch_index" >= 0
        AND "knowledge_code_index_activation_fragment"."file_count" BETWEEN 1 AND 64
        AND "knowledge_code_index_activation_fragment"."parsed_files" >= 0
        AND "knowledge_code_index_activation_fragment"."skipped_files" >= 0
        AND "knowledge_code_index_activation_fragment"."parsed_files" + "knowledge_code_index_activation_fragment"."skipped_files" = "knowledge_code_index_activation_fragment"."file_count"),
	CONSTRAINT "knowledge_code_index_activation_fragment_paths" CHECK(length("knowledge_code_index_activation_fragment"."start_path") BETWEEN 1 AND 4096
        AND length("knowledge_code_index_activation_fragment"."end_path") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE INDEX `knowledge_code_index_activation_fragment_job_idx` ON `knowledge_code_index_activation_fragment` (`organization_id`,`job_id`,`batch_index`);--> statement-breakpoint
CREATE TABLE `knowledge_code_index_file` (
	`organization_id` text NOT NULL,
	`job_id` text NOT NULL,
	`source_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`path` text NOT NULL,
	`blob_sha` text NOT NULL,
	`bytes` integer NOT NULL,
	`language` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`analysis` text,
	`failure_code` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`job_id`, `path`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `knowledge_source_sync_job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `knowledge_source`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`source_id`) REFERENCES `knowledge_source`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`job_id`,`source_id`) REFERENCES `knowledge_source_sync_job`(`organization_id`,`id`,`source_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_code_index_file_commit" CHECK((length("knowledge_code_index_file"."commit_sha") BETWEEN 40 AND 40
    AND "knowledge_code_index_file"."commit_sha" NOT GLOB '*[^0-9a-f]*') AND (length("knowledge_code_index_file"."blob_sha") BETWEEN 40 AND 40
    AND "knowledge_code_index_file"."blob_sha" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "knowledge_code_index_file_path" CHECK(length("knowledge_code_index_file"."path") BETWEEN 1 AND 4096
        AND (substr("knowledge_code_index_file"."path", 1, 1) <> '/' AND instr("knowledge_code_index_file"."path", char(92)) = 0
    AND instr("knowledge_code_index_file"."path", '//') = 0 AND "knowledge_code_index_file"."path" NOT IN ('.', '..')
    AND "knowledge_code_index_file"."path" NOT LIKE './%' AND "knowledge_code_index_file"."path" NOT LIKE '../%'
    AND "knowledge_code_index_file"."path" NOT LIKE '%/./%' AND "knowledge_code_index_file"."path" NOT LIKE '%/../%'
    AND "knowledge_code_index_file"."path" NOT LIKE '%/.' AND "knowledge_code_index_file"."path" NOT LIKE '%/..')),
	CONSTRAINT "knowledge_code_index_file_bytes" CHECK("knowledge_code_index_file"."bytes" BETWEEN 0 AND 1048576),
	CONSTRAINT "knowledge_code_index_file_state" CHECK("knowledge_code_index_file"."state" IN ('pending', 'ready', 'skipped')),
	CONSTRAINT "knowledge_code_index_file_analysis" CHECK(("knowledge_code_index_file"."state" = 'ready' AND json_type("knowledge_code_index_file"."analysis") = 'object')
        OR ("knowledge_code_index_file"."state" <> 'ready' AND "knowledge_code_index_file"."analysis" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `knowledge_code_index_file_pending_idx` ON `knowledge_code_index_file` (`job_id`,`state`,`path`);--> statement-breakpoint
CREATE INDEX `knowledge_code_index_file_reuse_idx` ON `knowledge_code_index_file` (`organization_id`,`source_id`,`blob_sha`,`updated_at`);