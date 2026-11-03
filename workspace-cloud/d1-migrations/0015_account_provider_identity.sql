-- Better Auth 1.7.3+ keys accounts by (provider_id, account_id) and no longer writes
-- issuer, so the NOT NULL issuer column rejected every new sign-up and link. Relax it
-- (existing values stay), move uniqueness to the provider key, and rebuild with foreign
-- keys enabled: no table references account.
--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`issuer` text,
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
INSERT INTO `__new_account`("id", "account_id", "provider_id", "issuer", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at") SELECT "id", "account_id", "provider_id", "issuer", "user_id", "access_token", "refresh_token", "id_token", "access_token_expires_at", "refresh_token_expires_at", "scope", "password", "created_at", "updated_at" FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_subject_idx` ON `account` (`provider_id`,`account_id`);
--> statement-breakpoint
-- The rebuild dropped the storage-type guards from 0002; restore them unchanged.
CREATE TRIGGER "account_types_insert" BEFORE INSERT ON "account"
WHEN (NEW."access_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."access_token_expires_at") = 'text' AND length(NEW."access_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."access_token_expires_at") IS NEW."access_token_expires_at"))
  OR (NEW."refresh_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."refresh_token_expires_at") = 'text' AND length(NEW."refresh_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_token_expires_at") IS NEW."refresh_token_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
--> statement-breakpoint
CREATE TRIGGER "account_types_update" BEFORE UPDATE ON "account"
WHEN (NEW."access_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."access_token_expires_at") = 'text' AND length(NEW."access_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."access_token_expires_at") IS NEW."access_token_expires_at"))
  OR (NEW."refresh_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."refresh_token_expires_at") = 'text' AND length(NEW."refresh_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_token_expires_at") IS NEW."refresh_token_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
