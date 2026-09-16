CREATE TABLE `desktop_authorization_code` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2)))
  || '-4' || substr(lower(hex(randomblob(2))), 2)
  || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2)
  || '-' || lower(hex(randomblob(6)))) NOT NULL,
	`code_hash` text NOT NULL,
	`approval_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "desktop_authorization_code_hash" CHECK((length("desktop_authorization_code"."code_hash") BETWEEN 64 AND 64
    AND "desktop_authorization_code"."code_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "desktop_authorization_approval_hash" CHECK((length("desktop_authorization_code"."approval_hash") BETWEEN 64 AND 64
    AND "desktop_authorization_code"."approval_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "desktop_authorization_client" CHECK("desktop_authorization_code"."client_id" = 'dopedb-desktop'),
	CONSTRAINT "desktop_authorization_challenge" CHECK(length("desktop_authorization_code"."code_challenge") = 43 AND "desktop_authorization_code"."code_challenge" NOT GLOB '*[^A-Za-z0-9_-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_authorization_code_code_hash_unique` ON `desktop_authorization_code` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_authorization_code_approval_hash_unique` ON `desktop_authorization_code` (`approval_hash`);--> statement-breakpoint
CREATE INDEX `desktop_authorization_expiry_idx` ON `desktop_authorization_code` (`expires_at`);