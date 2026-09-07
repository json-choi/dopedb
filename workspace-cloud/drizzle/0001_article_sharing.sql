CREATE TABLE "workspace_control"."workspace_article_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"article_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_revision" bigint NOT NULL,
	"inviter_member_id" text NOT NULL,
	"recipient_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_article_invitation_identity" CHECK (
      "workspace_control"."workspace_article_invitation"."recipient_email" = lower(btrim("workspace_control"."workspace_article_invitation"."recipient_email"))
      AND length("workspace_control"."workspace_article_invitation"."recipient_email") BETWEEN 3 AND 254
      AND "workspace_control"."workspace_article_invitation"."connection_revision" >= 1
      AND "workspace_control"."workspace_article_invitation"."expires_at" > "workspace_control"."workspace_article_invitation"."created_at"
      AND (("workspace_control"."workspace_article_invitation"."accepted_at" IS NULL) = ("workspace_control"."workspace_article_invitation"."accepted_by_user_id" IS NULL))
    )
);
--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection_grant" DROP CONSTRAINT "workspace_connection_grant_capability";--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_article_invitation" ADD CONSTRAINT "workspace_article_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_article_invitation" ADD CONSTRAINT "workspace_article_invitation_article_fk" FOREIGN KEY ("organization_id","article_id") REFERENCES "workspace_control"."workspace_analysis_article"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_article_invitation" ADD CONSTRAINT "workspace_article_invitation_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_article_invitation" ADD CONSTRAINT "workspace_article_invitation_inviter_fk" FOREIGN KEY ("organization_id","inviter_member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_article_invitation_article_idx" ON "workspace_control"."workspace_article_invitation" USING btree ("organization_id","article_id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection_grant" ADD CONSTRAINT "workspace_connection_grant_capability" CHECK ("workspace_control"."workspace_connection_grant"."capability" IN ('view', 'read', 'use', 'manage'));