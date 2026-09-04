CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE SCHEMA "workspace_control";
--> statement-breakpoint
CREATE TABLE "workspace_control"."account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."device_code" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"polling_interval" integer,
	"client_id" text,
	"scope" text,
	CONSTRAINT "device_code_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "device_code_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."invitation" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_code_index_activation_entity" (
	"organization_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"batch_index" integer NOT NULL,
	"primary_definition" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"canonical_payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_code_index_activation_entity_job_id_entity_kind_entity_id_pk" PRIMARY KEY("job_id","entity_kind","entity_id"),
	CONSTRAINT "knowledge_code_index_activation_entity_kind" CHECK ("workspace_control"."knowledge_code_index_activation_entity"."entity_kind" IN ('node', 'edge', 'evidence')),
	CONSTRAINT "knowledge_code_index_activation_entity_identity" CHECK ("workspace_control"."knowledge_code_index_activation_entity"."entity_id" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."knowledge_code_index_activation_entity"."batch_index" >= 0
        AND jsonb_typeof("workspace_control"."knowledge_code_index_activation_entity"."payload") = 'object'
        AND "workspace_control"."knowledge_code_index_activation_entity"."payload" ->> 'id' = "workspace_control"."knowledge_code_index_activation_entity"."entity_id"
        AND octet_length("workspace_control"."knowledge_code_index_activation_entity"."canonical_payload") BETWEEN 2 AND 2097152
        AND "workspace_control"."knowledge_code_index_activation_entity"."canonical_payload"::jsonb = "workspace_control"."knowledge_code_index_activation_entity"."payload"
        AND left("workspace_control"."knowledge_code_index_activation_entity"."canonical_payload", 1) = '{'
        AND right("workspace_control"."knowledge_code_index_activation_entity"."canonical_payload", 1) = '}'),
	CONSTRAINT "knowledge_code_index_activation_entity_primary" CHECK (NOT "workspace_control"."knowledge_code_index_activation_entity"."primary_definition" OR "workspace_control"."knowledge_code_index_activation_entity"."entity_kind" = 'node')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_code_index_activation_fragment" (
	"organization_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"batch_index" integer NOT NULL,
	"start_path" text NOT NULL,
	"end_path" text NOT NULL,
	"file_count" integer NOT NULL,
	"parsed_files" integer NOT NULL,
	"skipped_files" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_code_index_activation_fragment_job_id_batch_index_pk" PRIMARY KEY("job_id","batch_index"),
	CONSTRAINT "knowledge_code_index_activation_fragment_batch" CHECK ("workspace_control"."knowledge_code_index_activation_fragment"."batch_index" >= 0
        AND "workspace_control"."knowledge_code_index_activation_fragment"."file_count" BETWEEN 1 AND 64
        AND "workspace_control"."knowledge_code_index_activation_fragment"."parsed_files" >= 0
        AND "workspace_control"."knowledge_code_index_activation_fragment"."skipped_files" >= 0
        AND "workspace_control"."knowledge_code_index_activation_fragment"."parsed_files" + "workspace_control"."knowledge_code_index_activation_fragment"."skipped_files" = "workspace_control"."knowledge_code_index_activation_fragment"."file_count"),
	CONSTRAINT "knowledge_code_index_activation_fragment_paths" CHECK (char_length("workspace_control"."knowledge_code_index_activation_fragment"."start_path") BETWEEN 1 AND 4096
        AND char_length("workspace_control"."knowledge_code_index_activation_fragment"."end_path") BETWEEN 1 AND 4096)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_code_index_file" (
	"organization_id" text NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"bytes" integer NOT NULL,
	"language" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"analysis" jsonb,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_code_index_file_job_id_path_pk" PRIMARY KEY("job_id","path"),
	CONSTRAINT "knowledge_code_index_file_commit" CHECK ("workspace_control"."knowledge_code_index_file"."commit_sha" ~ '^[0-9a-f]{40}$' AND "workspace_control"."knowledge_code_index_file"."blob_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "knowledge_code_index_file_path" CHECK (char_length("workspace_control"."knowledge_code_index_file"."path") BETWEEN 1 AND 4096
        AND "workspace_control"."knowledge_code_index_file"."path" !~ '(^/|\\|(^|/)\.\.?(/|$)|//)'),
	CONSTRAINT "knowledge_code_index_file_bytes" CHECK ("workspace_control"."knowledge_code_index_file"."bytes" BETWEEN 0 AND 1048576),
	CONSTRAINT "knowledge_code_index_file_state" CHECK ("workspace_control"."knowledge_code_index_file"."state" IN ('pending', 'ready', 'skipped')),
	CONSTRAINT "knowledge_code_index_file_analysis" CHECK (("workspace_control"."knowledge_code_index_file"."state" = 'ready' AND jsonb_typeof("workspace_control"."knowledge_code_index_file"."analysis") = 'object')
        OR ("workspace_control"."knowledge_code_index_file"."state" <> 'ready' AND "workspace_control"."knowledge_code_index_file"."analysis" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_environment_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_revision" bigint NOT NULL,
	"role" text NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "knowledge_environment_connection_revisions_positive" CHECK ("workspace_control"."knowledge_environment_connection"."environment_revision" >= 1 AND "workspace_control"."knowledge_environment_connection"."connection_revision" >= 1),
	CONSTRAINT "knowledge_environment_connection_labels" CHECK (char_length("workspace_control"."knowledge_environment_connection"."role") BETWEEN 1 AND 64
        AND char_length("workspace_control"."knowledge_environment_connection"."alias") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_environment_head" (
	"organization_id" text NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"graph_revision_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_environment_head_project_environment_id_source_id_pk" PRIMARY KEY("project_environment_id","source_id"),
	CONSTRAINT "knowledge_environment_head_graph_revision_id_unique" UNIQUE("graph_revision_id"),
	CONSTRAINT "knowledge_environment_head_revision_positive" CHECK ("workspace_control"."knowledge_environment_head"."environment_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_github_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_github_installation_id_positive" CHECK ("workspace_control"."knowledge_github_installation"."installation_id" >= 1),
	CONSTRAINT "knowledge_github_installation_status" CHECK ("workspace_control"."knowledge_github_installation"."status" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "knowledge_github_installation_account_length" CHECK (char_length("workspace_control"."knowledge_github_installation"."account_id") BETWEEN 1 AND 128
        AND char_length("workspace_control"."knowledge_github_installation"."account_login") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_github_setup_state" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"graph_revision_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_grant_environment_revision_positive" CHECK ("workspace_control"."knowledge_grant"."environment_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_grant_graph_revision" (
	"organization_id" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"graph_revision_id" uuid NOT NULL,
	CONSTRAINT "knowledge_grant_graph_revision_grant_id_graph_revision_id_pk" PRIMARY KEY("grant_id","graph_revision_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_graph_revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"parent_graph_revision_id" uuid,
	"source_revision_sha256" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"artifact" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"staged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_graph_revision_environment_positive" CHECK ("workspace_control"."knowledge_graph_revision"."environment_revision" >= 1),
	CONSTRAINT "knowledge_graph_revision_hashes" CHECK ("workspace_control"."knowledge_graph_revision"."source_revision_sha256" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."knowledge_graph_revision"."artifact_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_graph_revision_artifact_object" CHECK (jsonb_typeof("workspace_control"."knowledge_graph_revision"."artifact") = 'object')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_mapping_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"graph_revision_id" uuid NOT NULL,
	"schema_fingerprint" text NOT NULL,
	"from_node_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_identity" text NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"proposed_by_member_id" text,
	"decided_by_member_id" text,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "knowledge_mapping_hashes" CHECK ("workspace_control"."knowledge_mapping_proposal"."schema_fingerprint" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."knowledge_mapping_proposal"."from_node_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_mapping_state" CHECK ("workspace_control"."knowledge_mapping_proposal"."state" IN ('proposed', 'approved', 'rejected', 'stale')),
	CONSTRAINT "knowledge_mapping_target_length" CHECK (char_length("workspace_control"."knowledge_mapping_proposal"."target_kind") BETWEEN 1 AND 128
        AND char_length("workspace_control"."knowledge_mapping_proposal"."target_identity") BETWEEN 1 AND 2048)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "knowledge_project_name_length" CHECK (char_length("workspace_control"."knowledge_project"."name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_project_revision_positive" CHECK ("workspace_control"."knowledge_project"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_project_environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"production" boolean DEFAULT false NOT NULL,
	"risk_class" text DEFAULT 'custom' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_environment_name_length" CHECK (char_length("workspace_control"."knowledge_project_environment"."name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_environment_risk_class" CHECK ("workspace_control"."knowledge_project_environment"."risk_class" IN ('production', 'staging', 'development', 'test', 'custom')),
	CONSTRAINT "knowledge_environment_revision_positive" CHECK ("workspace_control"."knowledge_project_environment"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"visibility" text NOT NULL,
	"github_installation_id" uuid,
	"repository_id" text,
	"repository_full_name" text,
	"ref_name" text,
	"commit_sha" text,
	"sync_state" text DEFAULT 'pending' NOT NULL,
	"sync_revision" bigint DEFAULT 1 NOT NULL,
	"last_failure_code" text,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "knowledge_source_provider" CHECK ("workspace_control"."knowledge_source"."provider" = 'github'),
	CONSTRAINT "knowledge_source_visibility" CHECK ("workspace_control"."knowledge_source"."visibility" = 'shared_graph'),
	CONSTRAINT "knowledge_source_name_length" CHECK (char_length("workspace_control"."knowledge_source"."display_name") BETWEEN 1 AND 512),
	CONSTRAINT "knowledge_source_environment_revision_positive" CHECK ("workspace_control"."knowledge_source"."environment_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_revision_positive" CHECK ("workspace_control"."knowledge_source"."sync_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_state" CHECK ("workspace_control"."knowledge_source"."sync_state" IN ('pending', 'syncing', 'ready', 'stale', 'failed', 'revoked')),
	CONSTRAINT "knowledge_source_provider_shape" CHECK ((
        "workspace_control"."knowledge_source"."provider" = 'github'
        AND "workspace_control"."knowledge_source"."github_installation_id" IS NOT NULL
        AND "workspace_control"."knowledge_source"."repository_id" IS NOT NULL
        AND "workspace_control"."knowledge_source"."repository_full_name" IS NOT NULL
        AND "workspace_control"."knowledge_source"."ref_name" IS NOT NULL
        AND "workspace_control"."knowledge_source"."commit_sha" ~ '^[0-9a-f]{40}$'
      ))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_source_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"delivery_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"before_commit_sha" text,
	"after_commit_sha" text,
	"changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "knowledge_source_event_kind" CHECK ("workspace_control"."knowledge_source_event"."event_kind" IN ('push', 'installation', 'repository')),
	CONSTRAINT "knowledge_source_event_state" CHECK ("workspace_control"."knowledge_source_event"."state" IN ('pending', 'claimed', 'consumed', 'failed')),
	CONSTRAINT "knowledge_source_event_commits" CHECK (("workspace_control"."knowledge_source_event"."before_commit_sha" IS NULL OR "workspace_control"."knowledge_source_event"."before_commit_sha" ~ '^[0-9a-f]{40}$')
        AND ("workspace_control"."knowledge_source_event"."after_commit_sha" IS NULL OR "workspace_control"."knowledge_source_event"."after_commit_sha" ~ '^[0-9a-f]{40}$')),
	CONSTRAINT "knowledge_source_event_files_array" CHECK (jsonb_typeof("workspace_control"."knowledge_source_event"."changed_files") = 'array')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."knowledge_source_sync_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"desired_commit_sha" text NOT NULL,
	"source_sync_revision" bigint NOT NULL,
	"trigger_event_id" uuid,
	"phase" text DEFAULT 'manifest' NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"manifest" jsonb,
	"source_revision_sha256" text,
	"activation_graph_revision_id" uuid,
	"activation_parent_graph_revision_id" uuid,
	"activation_generated_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "knowledge_source_sync_job_state" CHECK ("workspace_control"."knowledge_source_sync_job"."state" IN ('queued', 'claimed', 'succeeded', 'failed', 'superseded')),
	CONSTRAINT "knowledge_source_sync_job_phase" CHECK ("workspace_control"."knowledge_source_sync_job"."phase" IN ('manifest', 'indexing', 'activating')),
	CONSTRAINT "knowledge_source_sync_job_commit" CHECK ("workspace_control"."knowledge_source_sync_job"."desired_commit_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "knowledge_source_sync_job_revision_positive" CHECK ("workspace_control"."knowledge_source_sync_job"."source_sync_revision" >= 1),
	CONSTRAINT "knowledge_source_sync_job_attempt" CHECK ("workspace_control"."knowledge_source_sync_job"."attempt" >= 0 AND "workspace_control"."knowledge_source_sync_job"."attempt" <= 20),
	CONSTRAINT "knowledge_source_sync_job_progress" CHECK ("workspace_control"."knowledge_source_sync_job"."total_files" >= 0
        AND "workspace_control"."knowledge_source_sync_job"."processed_files" >= 0
        AND "workspace_control"."knowledge_source_sync_job"."processed_files" <= "workspace_control"."knowledge_source_sync_job"."total_files"),
	CONSTRAINT "knowledge_source_sync_job_manifest" CHECK ("workspace_control"."knowledge_source_sync_job"."manifest" IS NULL OR jsonb_typeof("workspace_control"."knowledge_source_sync_job"."manifest") = 'array'),
	CONSTRAINT "knowledge_source_sync_job_source_revision" CHECK ("workspace_control"."knowledge_source_sync_job"."source_revision_sha256" IS NULL
        OR "workspace_control"."knowledge_source_sync_job"."source_revision_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_source_sync_job_activation_identity" CHECK (("workspace_control"."knowledge_source_sync_job"."activation_graph_revision_id" IS NOT NULL
          AND "workspace_control"."knowledge_source_sync_job"."activation_generated_at" IS NOT NULL)
        OR ("workspace_control"."knowledge_source_sync_job"."activation_graph_revision_id" IS NULL
          AND "workspace_control"."knowledge_source_sync_job"."activation_parent_graph_revision_id" IS NULL
          AND "workspace_control"."knowledge_source_sync_job"."activation_generated_at" IS NULL)),
	CONSTRAINT "knowledge_source_sync_job_claim_shape" CHECK ((
        "workspace_control"."knowledge_source_sync_job"."state" = 'claimed'
        AND "workspace_control"."knowledge_source_sync_job"."claimed_at" IS NOT NULL
        AND "workspace_control"."knowledge_source_sync_job"."lease_expires_at" IS NOT NULL
        AND "workspace_control"."knowledge_source_sync_job"."worker_id" IS NOT NULL
      ) OR "workspace_control"."knowledge_source_sync_job"."state" <> 'claimed')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."member" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"revocation_pending_at" timestamp with time zone,
	"revocation_claimed_at" timestamp with time zone,
	"revocation_claim_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_revocation_claim_consistent" CHECK (("workspace_control"."member"."revocation_claimed_at" IS NULL AND "workspace_control"."member"."revocation_claim_id" IS NULL)
        OR ("workspace_control"."member"."revocation_claimed_at" IS NOT NULL
          AND "workspace_control"."member"."revocation_claim_id" IS NOT NULL
          AND "workspace_control"."member"."revocation_pending_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."organization" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."provider_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"state_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."provider_setup_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"account_label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_setup_session_provider" CHECK ("workspace_control"."provider_setup_session"."provider" = 'gcpCloudSql')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."rate_limit" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_article" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_environment_id" uuid NOT NULL,
	"environment_revision" bigint NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_revision" bigint NOT NULL,
	"definition" jsonb NOT NULL,
	"owner_member_id" text NOT NULL,
	"updated_by_member_id" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"latest_successful_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspace_analysis_article_revisions" CHECK ("workspace_control"."workspace_analysis_article"."environment_revision" >= 1
        AND "workspace_control"."workspace_analysis_article"."connection_revision" >= 1
        AND "workspace_control"."workspace_analysis_article"."revision" >= 1
        AND "workspace_control"."workspace_analysis_article"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_analysis_article_definition" CHECK (jsonb_typeof("workspace_control"."workspace_analysis_article"."definition") = 'object')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_article_query_receipt" (
	"organization_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"query_node_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_revision" bigint NOT NULL,
	"query_run_id" uuid NOT NULL,
	"query_hash" text NOT NULL,
	"schema_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"row_count" bigint NOT NULL,
	"byte_count" bigint NOT NULL,
	"duration_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_analysis_article_query_receipt_run_id_query_node_id_pk" PRIMARY KEY("run_id","query_node_id"),
	CONSTRAINT "workspace_analysis_query_receipt_node" CHECK ("workspace_control"."workspace_analysis_article_query_receipt"."query_node_id" ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'),
	CONSTRAINT "workspace_analysis_query_receipt_hashes" CHECK ("workspace_control"."workspace_analysis_article_query_receipt"."query_hash" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."workspace_analysis_article_query_receipt"."schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workspace_analysis_query_receipt_state" CHECK ("workspace_control"."workspace_analysis_article_query_receipt"."state" IN ('succeeded', 'failed', 'cancelled', 'stale')),
	CONSTRAINT "workspace_analysis_query_receipt_numbers" CHECK ("workspace_control"."workspace_analysis_article_query_receipt"."connection_revision" >= 1 AND "workspace_control"."workspace_analysis_article_query_receipt"."row_count" >= 0
        AND "workspace_control"."workspace_analysis_article_query_receipt"."byte_count" >= 0 AND "workspace_control"."workspace_analysis_article_query_receipt"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_article_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"article_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"base_revision" bigint,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_by_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_analysis_article_revision_numbers" CHECK ("workspace_control"."workspace_analysis_article_revision"."revision" >= 1
        AND "workspace_control"."workspace_analysis_article_revision"."revision" <= 9007199254740991
        AND ("workspace_control"."workspace_analysis_article_revision"."base_revision" IS NULL OR "workspace_control"."workspace_analysis_article_revision"."base_revision" >= 0)),
	CONSTRAINT "workspace_analysis_article_revision_operation" CHECK ("workspace_control"."workspace_analysis_article_revision"."operation" IN ('create', 'propose', 'update', 'delete')),
	CONSTRAINT "workspace_analysis_article_revision_payload" CHECK (jsonb_typeof("workspace_control"."workspace_analysis_article_revision"."payload") = 'object'
        AND "workspace_control"."workspace_analysis_article_revision"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_article_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"article_id" uuid NOT NULL,
	"article_revision" bigint NOT NULL,
	"runner_id" uuid NOT NULL,
	"runner_capability_generation" bigint NOT NULL,
	"requested_by_member_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"definition_hash" text NOT NULL,
	"schema_fingerprints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" bigint DEFAULT 0 NOT NULL,
	"byte_count" bigint DEFAULT 0 NOT NULL,
	"result_hash" text,
	"error_kind" text,
	"error_message" text,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by_member_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_analysis_article_run_state" CHECK ("workspace_control"."workspace_analysis_article_run"."state" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale')),
	CONSTRAINT "workspace_analysis_article_run_hashes" CHECK ("workspace_control"."workspace_analysis_article_run"."definition_hash" ~ '^[0-9a-f]{64}$'
        AND ("workspace_control"."workspace_analysis_article_run"."result_hash" IS NULL OR "workspace_control"."workspace_analysis_article_run"."result_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "workspace_analysis_article_run_numbers" CHECK ("workspace_control"."workspace_analysis_article_run"."article_revision" >= 1 AND "workspace_control"."workspace_analysis_article_run"."row_count" >= 0 AND "workspace_control"."workspace_analysis_article_run"."byte_count" >= 0),
	CONSTRAINT "workspace_analysis_article_run_json" CHECK (jsonb_typeof("workspace_control"."workspace_analysis_article_run"."schema_fingerprints") = 'object'),
	CONSTRAINT "workspace_analysis_article_run_terminal" CHECK (("workspace_control"."workspace_analysis_article_run"."state" IN ('queued', 'running') AND "workspace_control"."workspace_analysis_article_run"."finished_at" IS NULL)
        OR ("workspace_control"."workspace_analysis_article_run"."state" IN ('succeeded', 'failed', 'cancelled', 'stale')
          AND "workspace_control"."workspace_analysis_article_run"."finished_at" IS NOT NULL)),
	CONSTRAINT "workspace_analysis_article_run_error" CHECK (("workspace_control"."workspace_analysis_article_run"."error_kind" IS NULL AND "workspace_control"."workspace_analysis_article_run"."error_message" IS NULL)
        OR ("workspace_control"."workspace_analysis_article_run"."error_kind" IS NOT NULL AND "workspace_control"."workspace_analysis_article_run"."error_message" IS NOT NULL
          AND char_length("workspace_control"."workspace_analysis_article_run"."error_kind") BETWEEN 1 AND 128
          AND char_length("workspace_control"."workspace_analysis_article_run"."error_message") BETWEEN 1 AND 2000)),
	CONSTRAINT "workspace_analysis_article_run_cancel" CHECK (("workspace_control"."workspace_analysis_article_run"."cancel_requested_at" IS NULL AND "workspace_control"."workspace_analysis_article_run"."cancel_requested_by_member_id" IS NULL)
        OR "workspace_control"."workspace_analysis_article_run"."cancel_requested_at" IS NOT NULL),
	CONSTRAINT "workspace_analysis_article_run_runner_capability" CHECK ("workspace_control"."workspace_analysis_article_run"."runner_capability_generation" >= 1
        AND "workspace_control"."workspace_analysis_article_run"."runner_capability_generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"article_id" uuid NOT NULL,
	"article_revision" bigint NOT NULL,
	"source_run_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"replaces_publication_id" uuid,
	"visibility" text DEFAULT 'unlisted' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"approved_by_member_id" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_analysis_publication_slug" CHECK ("workspace_control"."workspace_analysis_publication"."slug" ~ '^[a-z0-9][a-z0-9-]{7,127}$'),
	CONSTRAINT "workspace_analysis_publication_visibility" CHECK ("workspace_control"."workspace_analysis_publication"."visibility" IN ('unlisted', 'public')),
	CONSTRAINT "workspace_analysis_publication_snapshot" CHECK (jsonb_typeof("workspace_control"."workspace_analysis_publication"."snapshot") = 'object'
        AND "workspace_control"."workspace_analysis_publication"."snapshot_hash" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."workspace_analysis_publication"."version" >= 1),
	CONSTRAINT "workspace_analysis_publication_text" CHECK (char_length(btrim("workspace_control"."workspace_analysis_publication"."title")) BETWEEN 1 AND 160
        AND char_length("workspace_control"."workspace_analysis_publication"."description") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_analysis_runner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text,
	"device_id" text NOT NULL,
	"display_name" text NOT NULL,
	"runner_capability_hash" text NOT NULL,
	"runner_capability_generation" bigint NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_analysis_runner_text" CHECK (char_length("workspace_control"."workspace_analysis_runner"."device_id") BETWEEN 1 AND 256
        AND char_length("workspace_control"."workspace_analysis_runner"."display_name") BETWEEN 1 AND 256),
	CONSTRAINT "workspace_analysis_runner_member" CHECK ("workspace_control"."workspace_analysis_runner"."member_id" IS NOT NULL OR "workspace_control"."workspace_analysis_runner"."revoked_at" IS NOT NULL),
	CONSTRAINT "workspace_analysis_runner_capability" CHECK ("workspace_control"."workspace_analysis_runner"."runner_capability_hash" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."workspace_analysis_runner"."runner_capability_generation" >= 1
        AND "workspace_control"."workspace_analysis_runner"."runner_capability_generation" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"redacted_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"provider" text DEFAULT 'auto' NOT NULL,
	"driver_id" text,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"database_name" text NOT NULL,
	"sslmode" text NOT NULL,
	"readonly_default" boolean DEFAULT true NOT NULL,
	"allow_writes" boolean DEFAULT false NOT NULL,
	"credential_mode" text DEFAULT 'member_local' NOT NULL,
	"provider_integration_id" uuid,
	"provider_resource" jsonb,
	"provider_resource_id" uuid,
	"environment" text,
	"schema_group" text,
	"content_revision" bigint DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"revocation_pending_at" timestamp with time zone,
	"revocation_claimed_at" timestamp with time zone,
	"revocation_claim_id" uuid,
	CONSTRAINT "workspace_connection_revocation_claim_consistent" CHECK (("workspace_control"."workspace_connection"."revocation_claimed_at" IS NULL AND "workspace_control"."workspace_connection"."revocation_claim_id" IS NULL)
        OR ("workspace_control"."workspace_connection"."revocation_claimed_at" IS NOT NULL
          AND "workspace_control"."workspace_connection"."revocation_claim_id" IS NOT NULL
          AND "workspace_control"."workspace_connection"."revocation_pending_at" IS NOT NULL)),
	CONSTRAINT "workspace_connection_content_revision" CHECK ("workspace_control"."workspace_connection"."content_revision" >= 1 AND "workspace_control"."workspace_connection"."content_revision" <= 9007199254740991),
	CONSTRAINT "workspace_connection_revision" CHECK ("workspace_control"."workspace_connection"."revision" >= 1 AND "workspace_control"."workspace_connection"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_connection_member_local_read_only" CHECK (("workspace_control"."workspace_connection"."credential_mode" = 'member_local' AND "workspace_control"."workspace_connection"."readonly_default" = TRUE AND "workspace_control"."workspace_connection"."allow_writes" = FALSE)
        OR "workspace_control"."workspace_connection"."credential_mode" = 'managed')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_connection_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"capability" text DEFAULT 'view' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_connection_grant_capability" CHECK ("workspace_control"."workspace_connection_grant"."capability" IN ('view', 'use', 'manage'))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_credential_lease" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"access_mode" text NOT NULL,
	"external_credential_id" text NOT NULL,
	"external_credential_kind" text NOT NULL,
	"provider_audit_id" text,
	"active_slot" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"cleanup_next_attempt_at" timestamp with time zone,
	"cleanup_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_lease_active_slot_range" CHECK ("workspace_control"."workspace_credential_lease"."active_slot" IS NULL OR "workspace_control"."workspace_credential_lease"."active_slot" BETWEEN 1 AND 5),
	CONSTRAINT "credential_lease_live_slot_required" CHECK ("workspace_control"."workspace_credential_lease"."revoked_at" IS NOT NULL OR "workspace_control"."workspace_credential_lease"."active_slot" IS NOT NULL),
	CONSTRAINT "credential_lease_provider_audit_id_length" CHECK ("workspace_control"."workspace_credential_lease"."provider_audit_id" IS NULL OR char_length("workspace_control"."workspace_credential_lease"."provider_audit_id") BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_data_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"key_reference" text NOT NULL,
	"kms_key_version" text NOT NULL,
	"wrapped_key" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	CONSTRAINT "workspace_data_key_version" CHECK ("workspace_control"."workspace_data_key"."version" >= 1 AND "workspace_control"."workspace_data_key"."version" <= 2147483647),
	CONSTRAINT "workspace_data_key_reference_length" CHECK (char_length("workspace_control"."workspace_data_key"."key_reference") BETWEEN 20 AND 512),
	CONSTRAINT "workspace_data_key_kms_version" CHECK ("workspace_control"."workspace_data_key"."kms_key_version" ~ '^projects/[A-Za-z0-9._:-]+/locations/[A-Za-z0-9_-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$'),
	CONSTRAINT "workspace_data_key_wrapped_key" CHECK (("workspace_control"."workspace_data_key"."wrapped_key" IS NOT NULL
          AND char_length("workspace_control"."workspace_data_key"."wrapped_key") BETWEEN 1 AND 8192
          AND "workspace_control"."workspace_data_key"."wrapped_key" ~ '^[A-Za-z0-9+/]+={0,2}$'
          AND "workspace_control"."workspace_data_key"."destroyed_at" IS NULL)
        OR ("workspace_control"."workspace_data_key"."wrapped_key" IS NULL
          AND "workspace_control"."workspace_data_key"."destroyed_at" IS NOT NULL
          AND "workspace_control"."workspace_data_key"."retired_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_data_key_rotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"from_data_key_id" uuid,
	"to_data_key_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"processed_backups" integer DEFAULT 0 NOT NULL,
	"claim_id" uuid,
	"claim_expires_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workspace_data_key_rotation_status" CHECK ("workspace_control"."workspace_data_key_rotation"."status" IN ('running', 'completed')),
	CONSTRAINT "workspace_data_key_rotation_processed" CHECK ("workspace_control"."workspace_data_key_rotation"."processed_backups" >= 0),
	CONSTRAINT "workspace_data_key_rotation_claim" CHECK (("workspace_control"."workspace_data_key_rotation"."claim_id" IS NULL AND "workspace_control"."workspace_data_key_rotation"."claim_expires_at" IS NULL)
        OR ("workspace_control"."workspace_data_key_rotation"."status" = 'running'
          AND "workspace_control"."workspace_data_key_rotation"."claim_id" IS NOT NULL
          AND "workspace_control"."workspace_data_key_rotation"."claim_expires_at" IS NOT NULL)),
	CONSTRAINT "workspace_data_key_rotation_completion" CHECK (("workspace_control"."workspace_data_key_rotation"."status" = 'running' AND "workspace_control"."workspace_data_key_rotation"."completed_at" IS NULL)
        OR ("workspace_control"."workspace_data_key_rotation"."status" = 'completed' AND "workspace_control"."workspace_data_key_rotation"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_deletion_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by_user_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "workspace_deletion_receipt_status" CHECK ("workspace_control"."workspace_deletion_receipt"."status" IN ('pending', 'cancelled', 'purged')),
	CONSTRAINT "workspace_deletion_receipt_deadline" CHECK ("workspace_control"."workspace_deletion_receipt"."purge_after" >= "workspace_control"."workspace_deletion_receipt"."requested_at" + interval '24 hours'),
	CONSTRAINT "workspace_deletion_receipt_terminal" CHECK (("workspace_control"."workspace_deletion_receipt"."status" = 'pending'
          AND "workspace_control"."workspace_deletion_receipt"."cancelled_at" IS NULL AND "workspace_control"."workspace_deletion_receipt"."purged_at" IS NULL)
        OR ("workspace_control"."workspace_deletion_receipt"."status" = 'cancelled'
          AND "workspace_control"."workspace_deletion_receipt"."cancelled_at" IS NOT NULL AND "workspace_control"."workspace_deletion_receipt"."purged_at" IS NULL)
        OR ("workspace_control"."workspace_deletion_receipt"."status" = 'purged'
          AND "workspace_control"."workspace_deletion_receipt"."cancelled_at" IS NULL AND "workspace_control"."workspace_deletion_receipt"."purged_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_metadata_backup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"key_reference" text NOT NULL,
	"key_version" text NOT NULL,
	"data_key_id" uuid,
	"ciphertext" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reencrypted_at" timestamp with time zone,
	"reencrypted_by_rotation_id" uuid,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	CONSTRAINT "workspace_metadata_backup_snapshot_hash" CHECK ("workspace_control"."workspace_metadata_backup"."snapshot_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workspace_metadata_backup_source_revision" CHECK ("workspace_control"."workspace_metadata_backup"."source_revision" >= 1 AND "workspace_control"."workspace_metadata_backup"."source_revision" <= 9007199254740991),
	CONSTRAINT "workspace_metadata_backup_key_binding" CHECK (("workspace_control"."workspace_metadata_backup"."data_key_id" IS NULL
          AND "workspace_control"."workspace_metadata_backup"."key_reference" = 'dopedb-workspace-backup-hkdf-sha256'
          AND "workspace_control"."workspace_metadata_backup"."key_version" = 'v1')
        OR ("workspace_control"."workspace_metadata_backup"."data_key_id" IS NOT NULL
          AND "workspace_control"."workspace_metadata_backup"."key_reference" = 'dopedb-workspace-data-key'
          AND "workspace_control"."workspace_metadata_backup"."key_version" ~ '^v[1-9][0-9]*$')),
	CONSTRAINT "workspace_metadata_backup_retention" CHECK (("workspace_control"."workspace_metadata_backup"."deleted_at" IS NULL AND "workspace_control"."workspace_metadata_backup"."purge_after" IS NULL)
        OR ("workspace_control"."workspace_metadata_backup"."deleted_at" IS NOT NULL
          AND "workspace_control"."workspace_metadata_backup"."purge_after" IS NOT NULL
          AND "workspace_control"."workspace_metadata_backup"."purge_after" >= "workspace_control"."workspace_metadata_backup"."deleted_at"))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_profile" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"encryption_key_ref" text NOT NULL,
	"residency_region" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"deletion_receipt_id" uuid,
	"deletion_requested_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_profile_revision" CHECK ("workspace_control"."workspace_profile"."revision" >= 1 AND "workspace_control"."workspace_profile"."revision" <= 9007199254740991),
	CONSTRAINT "workspace_profile_lifecycle" CHECK (("workspace_control"."workspace_profile"."lifecycle_state" = 'active'
        AND "workspace_control"."workspace_profile"."deletion_receipt_id" IS NULL
        AND "workspace_control"."workspace_profile"."deletion_requested_at" IS NULL
        AND "workspace_control"."workspace_profile"."purge_after" IS NULL)
      OR ("workspace_control"."workspace_profile"."lifecycle_state" = 'deletion_pending'
        AND "workspace_control"."workspace_profile"."deletion_receipt_id" IS NOT NULL
        AND "workspace_control"."workspace_profile"."deletion_requested_at" IS NOT NULL
        AND "workspace_control"."workspace_profile"."purge_after" IS NOT NULL
        AND "workspace_control"."workspace_profile"."purge_after" >= "workspace_control"."workspace_profile"."deletion_requested_at" + interval '24 hours'))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_discovery_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"integration_generation" bigint NOT NULL,
	"member_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_import_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"production_approved" boolean DEFAULT false NOT NULL,
	"resource_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_import_request_hash" CHECK ("workspace_control"."workspace_provider_import_request"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"credential_expires_at" timestamp with time zone,
	"granted_scope" text,
	"local_verification_target" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_pending_at" timestamp with time zone,
	"revocation_claimed_at" timestamp with time zone,
	"revocation_claim_id" uuid,
	"refresh_claimed_at" timestamp with time zone,
	"refresh_claim_id" uuid,
	"refresh_generation" bigint,
	"refresh_phase" text DEFAULT 'idle' NOT NULL,
	"refresh_remote_started_at" timestamp with time zone,
	"disconnect_phase" text DEFAULT 'idle' NOT NULL,
	"disconnect_generation" bigint,
	CONSTRAINT "provider_integration_revocation_claim_consistent" CHECK (("workspace_control"."workspace_provider_integration"."revocation_claimed_at" IS NULL AND "workspace_control"."workspace_provider_integration"."revocation_claim_id" IS NULL)
        OR ("workspace_control"."workspace_provider_integration"."revocation_claimed_at" IS NOT NULL
          AND "workspace_control"."workspace_provider_integration"."revocation_claim_id" IS NOT NULL
          AND "workspace_control"."workspace_provider_integration"."revocation_pending_at" IS NOT NULL)),
	CONSTRAINT "provider_integration_generation_positive" CHECK ("workspace_control"."workspace_provider_integration"."generation" >= 1),
	CONSTRAINT "provider_integration_local_verification_target_shape" CHECK ((
        "workspace_control"."workspace_provider_integration"."provider" = 'gcpCloudSql' AND (
          (
            "workspace_control"."workspace_provider_integration"."status" = 'active' AND "workspace_control"."workspace_provider_integration"."revoked_at" IS NULL
            AND "workspace_control"."workspace_provider_integration"."local_verification_target" IS NOT NULL
            AND jsonb_typeof("workspace_control"."workspace_provider_integration"."local_verification_target") = 'object'
            AND "workspace_control"."workspace_provider_integration"."local_verification_target" ?& ARRAY['kind', 'projectId', 'instanceId']
            AND ("workspace_control"."workspace_provider_integration"."local_verification_target" - 'kind' - 'projectId' - 'instanceId') = '{}'::jsonb
            AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'kind' = 'gcpCloudSql'
            AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'projectId' ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
            AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'instanceId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$'
          )
          OR (
            ("workspace_control"."workspace_provider_integration"."status" <> 'active' OR "workspace_control"."workspace_provider_integration"."revoked_at" IS NOT NULL)
            AND (
              "workspace_control"."workspace_provider_integration"."local_verification_target" IS NULL OR (
                jsonb_typeof("workspace_control"."workspace_provider_integration"."local_verification_target") = 'object'
                AND "workspace_control"."workspace_provider_integration"."local_verification_target" ?& ARRAY['kind', 'projectId', 'instanceId']
                AND ("workspace_control"."workspace_provider_integration"."local_verification_target" - 'kind' - 'projectId' - 'instanceId') = '{}'::jsonb
                AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'kind' = 'gcpCloudSql'
                AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'projectId' ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
                AND "workspace_control"."workspace_provider_integration"."local_verification_target"->>'instanceId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,97}$'
              )
            )
          )
        )
      ) OR ("workspace_control"."workspace_provider_integration"."provider" <> 'gcpCloudSql' AND "workspace_control"."workspace_provider_integration"."local_verification_target" IS NULL)),
	CONSTRAINT "provider_integration_refresh_claim_consistent" CHECK (("workspace_control"."workspace_provider_integration"."refresh_phase" = 'idle'
            AND "workspace_control"."workspace_provider_integration"."refresh_claimed_at" IS NULL AND "workspace_control"."workspace_provider_integration"."refresh_claim_id" IS NULL
            AND "workspace_control"."workspace_provider_integration"."refresh_generation" IS NULL AND "workspace_control"."workspace_provider_integration"."refresh_remote_started_at" IS NULL)
        OR ("workspace_control"."workspace_provider_integration"."refresh_phase" = 'claimed'
            AND "workspace_control"."workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_control"."workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_remote_started_at" IS NULL)
        OR ("workspace_control"."workspace_provider_integration"."refresh_phase" = 'remote_started'
            AND "workspace_control"."workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_control"."workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_remote_started_at" IS NOT NULL)
        OR ("workspace_control"."workspace_provider_integration"."refresh_phase" = 'reconnect_required'
            AND "workspace_control"."workspace_provider_integration"."refresh_claimed_at" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_claim_id" IS NOT NULL
            AND "workspace_control"."workspace_provider_integration"."refresh_generation" IS NOT NULL AND "workspace_control"."workspace_provider_integration"."refresh_remote_started_at" IS NOT NULL)),
	CONSTRAINT "provider_integration_disconnect_phase" CHECK ("workspace_control"."workspace_provider_integration"."disconnect_phase" IN ('idle', 'claimed', 'lease_cleanup_pending', 'leases_revoked',
          'provider_revoke_started', 'provider_revoke_ambiguous',
          'provider_revoked', 'finalized')),
	CONSTRAINT "provider_integration_disconnect_generation_consistent" CHECK (("workspace_control"."workspace_provider_integration"."disconnect_phase" = 'idle' AND "workspace_control"."workspace_provider_integration"."disconnect_generation" IS NULL)
        OR ("workspace_control"."workspace_provider_integration"."disconnect_phase" <> 'idle' AND "workspace_control"."workspace_provider_integration"."disconnect_generation" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"integration_generation" bigint NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'awaiting_approval' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"plan_hash" text NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"plan_expires_at" timestamp with time zone NOT NULL,
	"risk" text NOT NULL,
	"approval_policy" text NOT NULL,
	"requested_by_member_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_by_session_id" text NOT NULL,
	"requested_by_role" text NOT NULL,
	"resource_scope" text NOT NULL,
	"source_resource_id" text NOT NULL,
	"target_name" text NOT NULL,
	"ownership_marker" text NOT NULL,
	"redacted_plan" jsonb NOT NULL,
	"provider_operation_id" text,
	"provider_resource_id" text,
	"redacted_result" jsonb,
	"failure_code" text,
	"claim_id" uuid,
	"claimed_at" timestamp with time zone,
	"remote_started_at" timestamp with time zone,
	"reconcile_after" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_operation_provider" CHECK ("workspace_control"."workspace_provider_operation"."provider" = 'neon'),
	CONSTRAINT "provider_operation_kind" CHECK ("workspace_control"."workspace_provider_operation"."kind" IN (
        'neon.branch.create', 'neon.branch.delete', 'neon.branch.switch'
      )),
	CONSTRAINT "provider_operation_state" CHECK ("workspace_control"."workspace_provider_operation"."state" IN (
        'awaiting_approval', 'approved', 'claimed', 'remote_started',
        'reconciling', 'succeeded', 'failed', 'needs_repair', 'cancelled'
      )),
	CONSTRAINT "provider_operation_generation" CHECK ("workspace_control"."workspace_provider_operation"."integration_generation" >= 1),
	CONSTRAINT "provider_operation_hashes" CHECK ("workspace_control"."workspace_provider_operation"."request_hash" ~ '^[0-9a-f]{64}$'
        AND "workspace_control"."workspace_provider_operation"."plan_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_operation_plan_version" CHECK ("workspace_control"."workspace_provider_operation"."plan_version" = 1),
	CONSTRAINT "provider_operation_risk" CHECK ("workspace_control"."workspace_provider_operation"."risk" IN ('standard', 'production_data')),
	CONSTRAINT "provider_operation_approval_policy" CHECK ("workspace_control"."workspace_provider_operation"."approval_policy" IN ('single_admin', 'separate_admin')
        AND ("workspace_control"."workspace_provider_operation"."risk" <> 'production_data'
          OR "workspace_control"."workspace_provider_operation"."approval_policy" = 'separate_admin')),
	CONSTRAINT "provider_operation_requester_role" CHECK ("workspace_control"."workspace_provider_operation"."requested_by_role" IN ('admin', 'owner')),
	CONSTRAINT "provider_operation_scope_length" CHECK (char_length("workspace_control"."workspace_provider_operation"."resource_scope") BETWEEN 1 AND 512
        AND char_length("workspace_control"."workspace_provider_operation"."source_resource_id") BETWEEN 1 AND 512
        AND char_length("workspace_control"."workspace_provider_operation"."target_name") BETWEEN 1 AND 256
        AND char_length("workspace_control"."workspace_provider_operation"."ownership_marker") BETWEEN 1 AND 256
        AND char_length("workspace_control"."workspace_provider_operation"."requested_by_member_id") BETWEEN 1 AND 512
        AND char_length("workspace_control"."workspace_provider_operation"."requested_by_user_id") BETWEEN 1 AND 512
        AND char_length("workspace_control"."workspace_provider_operation"."requested_by_session_id") BETWEEN 1 AND 512),
	CONSTRAINT "provider_operation_neon_identifiers" CHECK ("workspace_control"."workspace_provider_operation"."resource_scope" ~ '^[a-z0-9][a-z0-9-]{0,59}$'
        AND "workspace_control"."workspace_provider_operation"."source_resource_id" ~ '^[a-z0-9][a-z0-9-]{0,59}$'
        AND "workspace_control"."workspace_provider_operation"."ownership_marker" ~ '^v1\.[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "provider_operation_provider_identifiers" CHECK ("workspace_control"."workspace_provider_operation"."provider_operation_id" IS NULL
        OR "workspace_control"."workspace_provider_operation"."provider_operation_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "provider_operation_provider_resource" CHECK ("workspace_control"."workspace_provider_operation"."provider_resource_id" IS NULL
        OR "workspace_control"."workspace_provider_operation"."provider_resource_id" ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
	CONSTRAINT "provider_operation_failure_code" CHECK ("workspace_control"."workspace_provider_operation"."failure_code" IS NULL
        OR "workspace_control"."workspace_provider_operation"."failure_code" ~ '^[A-Z][A-Z0-9_]{0,95}$'),
	CONSTRAINT "provider_operation_json_shapes" CHECK (jsonb_typeof("workspace_control"."workspace_provider_operation"."redacted_plan") = 'object'
        AND ("workspace_control"."workspace_provider_operation"."redacted_result" IS NULL
          OR jsonb_typeof("workspace_control"."workspace_provider_operation"."redacted_result") = 'object')),
	CONSTRAINT "provider_operation_plan_expiry" CHECK ("workspace_control"."workspace_provider_operation"."plan_expires_at" > "workspace_control"."workspace_provider_operation"."created_at"
        AND "workspace_control"."workspace_provider_operation"."plan_expires_at" <= "workspace_control"."workspace_provider_operation"."created_at" + interval '15 minutes'),
	CONSTRAINT "provider_operation_claim_consistency" CHECK ((
          "workspace_control"."workspace_provider_operation"."state" IN ('awaiting_approval', 'approved')
          AND "workspace_control"."workspace_provider_operation"."claim_id" IS NULL AND "workspace_control"."workspace_provider_operation"."claimed_at" IS NULL
          AND "workspace_control"."workspace_provider_operation"."remote_started_at" IS NULL AND "workspace_control"."workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_control"."workspace_provider_operation"."state" = 'claimed'
          AND "workspace_control"."workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_control"."workspace_provider_operation"."claimed_at" IS NOT NULL
          AND "workspace_control"."workspace_provider_operation"."remote_started_at" IS NULL AND "workspace_control"."workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_control"."workspace_provider_operation"."state" IN ('remote_started', 'reconciling')
          AND "workspace_control"."workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_control"."workspace_provider_operation"."claimed_at" IS NOT NULL
          AND "workspace_control"."workspace_provider_operation"."remote_started_at" IS NOT NULL AND "workspace_control"."workspace_provider_operation"."completed_at" IS NULL
        ) OR (
          "workspace_control"."workspace_provider_operation"."state" IN ('succeeded', 'failed', 'needs_repair', 'cancelled')
          AND "workspace_control"."workspace_provider_operation"."completed_at" IS NOT NULL
        )),
	CONSTRAINT "provider_operation_claim_pair" CHECK (("workspace_control"."workspace_provider_operation"."claim_id" IS NULL AND "workspace_control"."workspace_provider_operation"."claimed_at" IS NULL)
        OR ("workspace_control"."workspace_provider_operation"."claim_id" IS NOT NULL AND "workspace_control"."workspace_provider_operation"."claimed_at" IS NOT NULL)),
	CONSTRAINT "provider_operation_failure_state" CHECK ("workspace_control"."workspace_provider_operation"."failure_code" IS NULL
        OR "workspace_control"."workspace_provider_operation"."state" IN ('failed', 'needs_repair')),
	CONSTRAINT "provider_operation_success_resource" CHECK ("workspace_control"."workspace_provider_operation"."state" <> 'succeeded' OR "workspace_control"."workspace_provider_operation"."provider_resource_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_operation_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"plan_hash" text NOT NULL,
	"decision" text NOT NULL,
	"actor_member_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_session_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_operation_approval_hash" CHECK ("workspace_control"."workspace_provider_operation_approval"."plan_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_operation_approval_decision" CHECK ("workspace_control"."workspace_provider_operation_approval"."decision" IN ('approved', 'rejected')),
	CONSTRAINT "provider_operation_approval_role" CHECK ("workspace_control"."workspace_provider_operation_approval"."actor_role" IN ('admin', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_principal_claim" (
	"principal_fingerprint" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" uuid NOT NULL,
	"target_fingerprint" text NOT NULL,
	"access_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_principal_claim_principal_hash" CHECK ("workspace_control"."workspace_provider_principal_claim"."principal_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_principal_claim_target_hash" CHECK ("workspace_control"."workspace_provider_principal_claim"."target_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "provider_principal_claim_access_kind" CHECK ("workspace_control"."workspace_provider_principal_claim"."access_kind" IN ('read', 'write', 'schema'))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_provider_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"resource_fingerprint" text NOT NULL,
	"resource" jsonb NOT NULL,
	"redacted_metadata" jsonb NOT NULL,
	"capability_manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_resource_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"expected_revision" bigint NOT NULL,
	"server_version_id" uuid NOT NULL,
	"candidate_version_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_resource_conflict_type" CHECK ("workspace_control"."workspace_resource_conflict"."resource_type" = 'connection'),
	CONSTRAINT "workspace_resource_conflict_expected_revision" CHECK ("workspace_control"."workspace_resource_conflict"."expected_revision" >= 0 AND "workspace_control"."workspace_resource_conflict"."expected_revision" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_resource_conflict_resolution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"conflict_id" uuid NOT NULL,
	"resolution" text NOT NULL,
	"resulting_version_id" uuid NOT NULL,
	"resolved_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_resource_conflict_resolution_value" CHECK ("workspace_control"."workspace_resource_conflict_resolution"."resolution" IN ('server', 'candidate', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_resource_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"base_revision" bigint,
	"parent_version_id" uuid,
	"branch" text DEFAULT 'main' NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_resource_version_type" CHECK ("workspace_control"."workspace_resource_version"."resource_type" = 'connection'),
	CONSTRAINT "workspace_resource_version_branch" CHECK ("workspace_control"."workspace_resource_version"."branch" IN ('main', 'conflict')),
	CONSTRAINT "workspace_resource_version_revision" CHECK (("workspace_control"."workspace_resource_version"."branch" = 'main' AND "workspace_control"."workspace_resource_version"."revision" >= 1 AND "workspace_control"."workspace_resource_version"."revision" <= 9007199254740991)
        OR ("workspace_control"."workspace_resource_version"."branch" = 'conflict' AND "workspace_control"."workspace_resource_version"."revision" >= 0 AND "workspace_control"."workspace_resource_version"."revision" <= 9007199254740991)),
	CONSTRAINT "workspace_resource_version_base_revision" CHECK ("workspace_control"."workspace_resource_version"."base_revision" IS NULL OR ("workspace_control"."workspace_resource_version"."base_revision" >= 0 AND "workspace_control"."workspace_resource_version"."base_revision" <= 9007199254740991)),
	CONSTRAINT "workspace_resource_version_operation" CHECK ("workspace_control"."workspace_resource_version"."operation" IN ('create', 'update', 'delete', 'restore')),
	CONSTRAINT "workspace_resource_version_payload_hash" CHECK ("workspace_control"."workspace_resource_version"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_sync_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"audit_event_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"operation" text NOT NULL,
	"tombstone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sync_event_sequence" CHECK ("workspace_control"."workspace_sync_event"."sequence" >= 1 AND "workspace_control"."workspace_sync_event"."sequence" <= 9007199254740991),
	CONSTRAINT "workspace_sync_event_resource_type_length" CHECK (char_length("workspace_control"."workspace_sync_event"."resource_type") BETWEEN 1 AND 64),
	CONSTRAINT "workspace_sync_event_operation_length" CHECK (char_length("workspace_control"."workspace_sync_event"."operation") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "workspace_control"."workspace_sync_head" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sync_head_sequence" CHECK ("workspace_control"."workspace_sync_head"."last_sequence" >= 0 AND "workspace_control"."workspace_sync_head"."last_sequence" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_github_installation" ADD CONSTRAINT "knowledge_github_installation_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project" ADD CONSTRAINT "knowledge_project_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project_environment" ADD CONSTRAINT "knowledge_environment_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_org_id_source_idx" UNIQUE("organization_id","id","source_id");--> statement-breakpoint
ALTER TABLE "workspace_control"."member" ADD CONSTRAINT "member_organization_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article" ADD CONSTRAINT "workspace_analysis_article_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_revision" ADD CONSTRAINT "workspace_analysis_article_revision_unique_idx" UNIQUE("organization_id","article_id","revision");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_runner" ADD CONSTRAINT "workspace_analysis_runner_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_audit_event" ADD CONSTRAINT "workspace_audit_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key" ADD CONSTRAINT "workspace_data_key_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key_rotation" ADD CONSTRAINT "workspace_data_key_rotation_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_integration" ADD CONSTRAINT "provider_integration_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_integration" ADD CONSTRAINT "provider_integration_org_id_provider_idx" UNIQUE("organization_id","id","provider");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_operation" ADD CONSTRAINT "provider_operation_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_resource" ADD CONSTRAINT "provider_resource_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_version" ADD CONSTRAINT "workspace_resource_version_org_id_idx" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "workspace_control"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."device_code" ADD CONSTRAINT "device_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_job_id_knowledge_source_sync_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_org_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_entity" ADD CONSTRAINT "knowledge_code_index_activation_entity_exact_job_fk" FOREIGN KEY ("organization_id","job_id","source_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_job_id_knowledge_source_sync_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_org_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_activation_fragment" ADD CONSTRAINT "knowledge_code_index_activation_fragment_exact_job_fk" FOREIGN KEY ("organization_id","job_id","source_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_job_id_knowledge_source_sync_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_org_job_fk" FOREIGN KEY ("organization_id","job_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_code_index_file" ADD CONSTRAINT "knowledge_code_index_file_exact_job_fk" FOREIGN KEY ("organization_id","job_id","source_id") REFERENCES "workspace_control"."knowledge_source_sync_job"("organization_id","id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_connection" ADD CONSTRAINT "knowledge_environment_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_connection" ADD CONSTRAINT "knowledge_environment_connection_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_connection" ADD CONSTRAINT "knowledge_environment_connection_connection_id_workspace_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "workspace_control"."workspace_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_connection" ADD CONSTRAINT "knowledge_environment_connection_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_connection" ADD CONSTRAINT "knowledge_environment_connection_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_graph_revision_id_knowledge_graph_revision_id_fk" FOREIGN KEY ("graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_environment_head" ADD CONSTRAINT "knowledge_environment_head_org_graph_fk" FOREIGN KEY ("organization_id","graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_github_installation" ADD CONSTRAINT "knowledge_github_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_github_installation" ADD CONSTRAINT "knowledge_github_installation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_github_setup_state" ADD CONSTRAINT "knowledge_github_setup_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_github_setup_state" ADD CONSTRAINT "knowledge_github_setup_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "workspace_control"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_project_id_knowledge_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "workspace_control"."knowledge_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_graph_revision_id_knowledge_graph_revision_id_fk" FOREIGN KEY ("graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_org_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "workspace_control"."knowledge_project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant" ADD CONSTRAINT "knowledge_grant_org_graph_fk" FOREIGN KEY ("organization_id","graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant_graph_revision" ADD CONSTRAINT "knowledge_grant_graph_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant_graph_revision" ADD CONSTRAINT "knowledge_grant_graph_revision_grant_id_knowledge_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "workspace_control"."knowledge_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant_graph_revision" ADD CONSTRAINT "knowledge_grant_graph_revision_graph_revision_id_knowledge_graph_revision_id_fk" FOREIGN KEY ("graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant_graph_revision" ADD CONSTRAINT "knowledge_grant_graph_revision_org_grant_fk" FOREIGN KEY ("organization_id","grant_id") REFERENCES "workspace_control"."knowledge_grant"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_grant_graph_revision" ADD CONSTRAINT "knowledge_grant_graph_revision_org_graph_fk" FOREIGN KEY ("organization_id","graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_graph_revision" ADD CONSTRAINT "knowledge_graph_revision_org_parent_fk" FOREIGN KEY ("organization_id","parent_graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_mapping_proposal" ADD CONSTRAINT "knowledge_mapping_proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_mapping_proposal" ADD CONSTRAINT "knowledge_mapping_proposal_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_mapping_proposal" ADD CONSTRAINT "knowledge_mapping_proposal_graph_revision_id_knowledge_graph_revision_id_fk" FOREIGN KEY ("graph_revision_id") REFERENCES "workspace_control"."knowledge_graph_revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_mapping_proposal" ADD CONSTRAINT "knowledge_mapping_proposal_proposed_by_member_id_member_id_fk" FOREIGN KEY ("proposed_by_member_id") REFERENCES "workspace_control"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_mapping_proposal" ADD CONSTRAINT "knowledge_mapping_proposal_decided_by_member_id_member_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "workspace_control"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project" ADD CONSTRAINT "knowledge_project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project_environment" ADD CONSTRAINT "knowledge_project_environment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project_environment" ADD CONSTRAINT "knowledge_project_environment_project_id_knowledge_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "workspace_control"."knowledge_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_project_environment" ADD CONSTRAINT "knowledge_environment_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "workspace_control"."knowledge_project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_project_id_knowledge_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "workspace_control"."knowledge_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_project_environment_id_knowledge_project_environment_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_github_installation_id_knowledge_github_installation_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "workspace_control"."knowledge_github_installation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "workspace_control"."knowledge_project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source" ADD CONSTRAINT "knowledge_source_org_github_installation_fk" FOREIGN KEY ("organization_id","github_installation_id") REFERENCES "workspace_control"."knowledge_github_installation"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_event" ADD CONSTRAINT "knowledge_source_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_event" ADD CONSTRAINT "knowledge_source_event_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_event" ADD CONSTRAINT "knowledge_source_event_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "workspace_control"."knowledge_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_trigger_event_id_knowledge_source_event_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "workspace_control"."knowledge_source_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."knowledge_source_sync_job" ADD CONSTRAINT "knowledge_source_sync_job_org_source_fk" FOREIGN KEY ("organization_id","source_id") REFERENCES "workspace_control"."knowledge_source"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."provider_oauth_state" ADD CONSTRAINT "provider_oauth_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."provider_oauth_state" ADD CONSTRAINT "provider_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."provider_setup_session" ADD CONSTRAINT "provider_setup_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."provider_setup_session" ADD CONSTRAINT "provider_setup_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article" ADD CONSTRAINT "workspace_analysis_article_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article" ADD CONSTRAINT "workspace_analysis_article_org_environment_fk" FOREIGN KEY ("organization_id","project_environment_id") REFERENCES "workspace_control"."knowledge_project_environment"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article" ADD CONSTRAINT "workspace_analysis_article_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_query_receipt" ADD CONSTRAINT "workspace_analysis_article_query_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_query_receipt" ADD CONSTRAINT "workspace_analysis_query_receipt_org_run_fk" FOREIGN KEY ("organization_id","run_id") REFERENCES "workspace_control"."workspace_analysis_article_run"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_query_receipt" ADD CONSTRAINT "workspace_analysis_query_receipt_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_revision" ADD CONSTRAINT "workspace_analysis_article_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_revision" ADD CONSTRAINT "workspace_analysis_article_revision_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_revision" ADD CONSTRAINT "workspace_analysis_article_revision_org_article_fk" FOREIGN KEY ("organization_id","article_id") REFERENCES "workspace_control"."workspace_analysis_article"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_org_revision_fk" FOREIGN KEY ("organization_id","article_id","article_revision") REFERENCES "workspace_control"."workspace_analysis_article_revision"("organization_id","article_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_org_runner_fk" FOREIGN KEY ("organization_id","runner_id") REFERENCES "workspace_control"."workspace_analysis_runner"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_org_requester_fk" FOREIGN KEY ("organization_id","requested_by_member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE SET NULL ("requested_by_member_id") ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_article_run" ADD CONSTRAINT "workspace_analysis_article_run_org_cancel_requester_fk" FOREIGN KEY ("organization_id","cancel_requested_by_member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE SET NULL ("cancel_requested_by_member_id") ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_org_revision_fk" FOREIGN KEY ("organization_id","article_id","article_revision") REFERENCES "workspace_control"."workspace_analysis_article_revision"("organization_id","article_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_org_replaces_fk" FOREIGN KEY ("organization_id","replaces_publication_id") REFERENCES "workspace_control"."workspace_analysis_publication"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_org_run_fk" FOREIGN KEY ("organization_id","source_run_id") REFERENCES "workspace_control"."workspace_analysis_article_run"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_publication" ADD CONSTRAINT "workspace_analysis_publication_org_approver_fk" FOREIGN KEY ("organization_id","approved_by_member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE SET NULL ("approved_by_member_id") ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_runner" ADD CONSTRAINT "workspace_analysis_runner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_analysis_runner" ADD CONSTRAINT "workspace_analysis_runner_org_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE SET NULL ("member_id") ON UPDATE NO ACTION;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_audit_event" ADD CONSTRAINT "workspace_audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_audit_event" ADD CONSTRAINT "workspace_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_provider_integration_id_workspace_provider_integration_id_fk" FOREIGN KEY ("provider_integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_org_provider_integration_fk" FOREIGN KEY ("organization_id","provider_integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection" ADD CONSTRAINT "workspace_connection_org_provider_resource_fk" FOREIGN KEY ("organization_id","provider_resource_id") REFERENCES "workspace_control"."workspace_provider_resource"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection_grant" ADD CONSTRAINT "workspace_connection_grant_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_connection_grant" ADD CONSTRAINT "workspace_connection_grant_org_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "workspace_credential_lease_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "workspace_credential_lease_connection_id_workspace_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "workspace_control"."workspace_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "workspace_credential_lease_integration_id_workspace_provider_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "workspace_credential_lease_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "credential_lease_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_credential_lease" ADD CONSTRAINT "credential_lease_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key" ADD CONSTRAINT "workspace_data_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key" ADD CONSTRAINT "workspace_data_key_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key_rotation" ADD CONSTRAINT "workspace_data_key_rotation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key_rotation" ADD CONSTRAINT "workspace_data_key_rotation_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key_rotation" ADD CONSTRAINT "workspace_data_key_rotation_org_from_key_fk" FOREIGN KEY ("organization_id","from_data_key_id") REFERENCES "workspace_control"."workspace_data_key"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_data_key_rotation" ADD CONSTRAINT "workspace_data_key_rotation_org_to_key_fk" FOREIGN KEY ("organization_id","to_data_key_id") REFERENCES "workspace_control"."workspace_data_key"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_deletion_receipt" ADD CONSTRAINT "workspace_deletion_receipt_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_metadata_backup" ADD CONSTRAINT "workspace_metadata_backup_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_metadata_backup" ADD CONSTRAINT "workspace_metadata_backup_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_metadata_backup" ADD CONSTRAINT "workspace_metadata_backup_org_data_key_fk" FOREIGN KEY ("organization_id","data_key_id") REFERENCES "workspace_control"."workspace_data_key"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_metadata_backup" ADD CONSTRAINT "workspace_metadata_backup_org_rotation_fk" FOREIGN KEY ("organization_id","reencrypted_by_rotation_id") REFERENCES "workspace_control"."workspace_data_key_rotation"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_profile" ADD CONSTRAINT "workspace_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_profile" ADD CONSTRAINT "workspace_profile_deletion_receipt_id_workspace_deletion_receipt_id_fk" FOREIGN KEY ("deletion_receipt_id") REFERENCES "workspace_control"."workspace_deletion_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "workspace_provider_discovery_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "workspace_provider_discovery_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "workspace_control"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "workspace_provider_discovery_receipt_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "workspace_control"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "provider_discovery_receipt_org_resource_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "workspace_control"."workspace_provider_resource"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "provider_discovery_receipt_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_discovery_receipt" ADD CONSTRAINT "provider_discovery_receipt_org_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "workspace_control"."member"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_import_request" ADD CONSTRAINT "workspace_provider_import_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_import_request" ADD CONSTRAINT "provider_import_org_resource_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "workspace_control"."workspace_provider_resource"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_import_request" ADD CONSTRAINT "provider_import_org_connection_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_integration" ADD CONSTRAINT "workspace_provider_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_integration" ADD CONSTRAINT "workspace_provider_integration_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_operation" ADD CONSTRAINT "workspace_provider_operation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_operation" ADD CONSTRAINT "provider_operation_org_integration_fk" FOREIGN KEY ("organization_id","integration_id","provider") REFERENCES "workspace_control"."workspace_provider_integration"("organization_id","id","provider") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_operation_approval" ADD CONSTRAINT "workspace_provider_operation_approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_operation_approval" ADD CONSTRAINT "provider_operation_approval_org_operation_fk" FOREIGN KEY ("organization_id","operation_id") REFERENCES "workspace_control"."workspace_provider_operation"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_principal_claim" ADD CONSTRAINT "workspace_provider_principal_claim_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_principal_claim" ADD CONSTRAINT "provider_principal_claim_org_integration_fk" FOREIGN KEY ("organization_id","integration_id") REFERENCES "workspace_control"."workspace_provider_integration"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_provider_resource" ADD CONSTRAINT "workspace_provider_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_org_connection_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_org_server_version_fk" FOREIGN KEY ("organization_id","server_version_id") REFERENCES "workspace_control"."workspace_resource_version"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict" ADD CONSTRAINT "workspace_resource_conflict_org_candidate_version_fk" FOREIGN KEY ("organization_id","candidate_version_id") REFERENCES "workspace_control"."workspace_resource_version"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict_resolution" ADD CONSTRAINT "workspace_resource_conflict_resolution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict_resolution" ADD CONSTRAINT "workspace_resource_conflict_resolution_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict_resolution" ADD CONSTRAINT "workspace_resource_conflict_resolution_org_conflict_fk" FOREIGN KEY ("organization_id","conflict_id") REFERENCES "workspace_control"."workspace_resource_conflict"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_conflict_resolution" ADD CONSTRAINT "workspace_resource_conflict_resolution_org_version_fk" FOREIGN KEY ("organization_id","resulting_version_id") REFERENCES "workspace_control"."workspace_resource_version"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_version" ADD CONSTRAINT "workspace_resource_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_version" ADD CONSTRAINT "workspace_resource_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "workspace_control"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_version" ADD CONSTRAINT "workspace_resource_version_org_connection_fk" FOREIGN KEY ("organization_id","resource_id") REFERENCES "workspace_control"."workspace_connection"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_resource_version" ADD CONSTRAINT "workspace_resource_version_org_parent_fk" FOREIGN KEY ("organization_id","parent_version_id") REFERENCES "workspace_control"."workspace_resource_version"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_sync_event" ADD CONSTRAINT "workspace_sync_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_sync_event" ADD CONSTRAINT "workspace_sync_event_org_audit_fk" FOREIGN KEY ("organization_id","audit_event_id") REFERENCES "workspace_control"."workspace_audit_event"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_control"."workspace_sync_head" ADD CONSTRAINT "workspace_sync_head_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "workspace_control"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "workspace_control"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_subject_idx" ON "workspace_control"."account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "device_code_user_idx" ON "workspace_control"."device_code" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_idx" ON "workspace_control"."invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "workspace_control"."invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "knowledge_code_index_activation_entity_job_idx" ON "workspace_control"."knowledge_code_index_activation_entity" USING btree ("organization_id","job_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "knowledge_code_index_activation_fragment_job_idx" ON "workspace_control"."knowledge_code_index_activation_fragment" USING btree ("organization_id","job_id","batch_index");--> statement-breakpoint
CREATE INDEX "knowledge_code_index_file_pending_idx" ON "workspace_control"."knowledge_code_index_file" USING btree ("job_id","state","path");--> statement-breakpoint
CREATE INDEX "knowledge_code_index_file_reuse_idx" ON "workspace_control"."knowledge_code_index_file" USING btree ("organization_id","source_id","blob_sha","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_environment_connection_active_idx" ON "workspace_control"."knowledge_environment_connection" USING btree ("organization_id","connection_id") WHERE "workspace_control"."knowledge_environment_connection"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "knowledge_environment_connection_scope_idx" ON "workspace_control"."knowledge_environment_connection" USING btree ("organization_id","project_environment_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_github_installation_org_external_idx" ON "workspace_control"."knowledge_github_installation" USING btree ("organization_id","installation_id");--> statement-breakpoint
CREATE INDEX "knowledge_github_setup_state_expiry_idx" ON "workspace_control"."knowledge_github_setup_state" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "knowledge_grant_member_active_idx" ON "workspace_control"."knowledge_grant" USING btree ("organization_id","member_id","expires_at");--> statement-breakpoint
CREATE INDEX "knowledge_graph_revision_environment_idx" ON "workspace_control"."knowledge_graph_revision" USING btree ("organization_id","project_environment_id","staged_at");--> statement-breakpoint
CREATE INDEX "knowledge_mapping_review_idx" ON "workspace_control"."knowledge_mapping_proposal" USING btree ("organization_id","project_environment_id","state","proposed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_project_org_name_idx" ON "workspace_control"."knowledge_project" USING btree ("organization_id","name") WHERE "workspace_control"."knowledge_project"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_environment_project_name_idx" ON "workspace_control"."knowledge_project_environment" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "knowledge_source_environment_idx" ON "workspace_control"."knowledge_source" USING btree ("organization_id","project_environment_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_event_delivery_idx" ON "workspace_control"."knowledge_source_event" USING btree ("delivery_id","source_id");--> statement-breakpoint
CREATE INDEX "knowledge_source_event_pending_idx" ON "workspace_control"."knowledge_source_event" USING btree ("organization_id","source_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_sync_job_revision_idx" ON "workspace_control"."knowledge_source_sync_job" USING btree ("source_id","desired_commit_sha");--> statement-breakpoint
CREATE INDEX "knowledge_source_sync_job_claim_idx" ON "workspace_control"."knowledge_source_sync_job" USING btree ("state","available_at","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_source_sync_job_source_idx" ON "workspace_control"."knowledge_source_sync_job" USING btree ("organization_id","source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_idx" ON "workspace_control"."member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "workspace_control"."member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_oauth_state_hash_idx" ON "workspace_control"."provider_oauth_state" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "provider_oauth_state_expiry_idx" ON "workspace_control"."provider_oauth_state" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_setup_session_scope_idx" ON "workspace_control"."provider_setup_session" USING btree ("organization_id","user_id","provider");--> statement-breakpoint
CREATE INDEX "provider_setup_session_expiry_idx" ON "workspace_control"."provider_setup_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_last_request_idx" ON "workspace_control"."rate_limit" USING btree ("last_request");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "workspace_control"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "workspace_control"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_analysis_article_environment_idx" ON "workspace_control"."workspace_analysis_article" USING btree ("organization_id","project_environment_id","updated_at");--> statement-breakpoint
CREATE INDEX "workspace_analysis_article_connection_idx" ON "workspace_control"."workspace_analysis_article" USING btree ("organization_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_analysis_query_receipt_run_query_idx" ON "workspace_control"."workspace_analysis_article_query_receipt" USING btree ("organization_id","run_id","query_run_id");--> statement-breakpoint
CREATE INDEX "workspace_analysis_article_revision_history_idx" ON "workspace_control"."workspace_analysis_article_revision" USING btree ("organization_id","article_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_analysis_article_run_article_idx" ON "workspace_control"."workspace_analysis_article_run" USING btree ("organization_id","article_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_analysis_publication_slug_version_idx" ON "workspace_control"."workspace_analysis_publication" USING btree ("slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_analysis_publication_active_slug_idx" ON "workspace_control"."workspace_analysis_publication" USING btree ("slug") WHERE "workspace_control"."workspace_analysis_publication"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_analysis_publication_article_idx" ON "workspace_control"."workspace_analysis_publication" USING btree ("organization_id","article_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_analysis_runner_org_device_idx" ON "workspace_control"."workspace_analysis_runner" USING btree ("organization_id","device_id") WHERE "workspace_control"."workspace_analysis_runner"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_analysis_runner_member_idx" ON "workspace_control"."workspace_analysis_runner" USING btree ("organization_id","member_id","revoked_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_org_created_idx" ON "workspace_control"."workspace_audit_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_connection_org_updated_idx" ON "workspace_control"."workspace_connection" USING btree ("organization_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_connection_org_provider_resource_idx" ON "workspace_control"."workspace_connection" USING btree ("organization_id","provider_resource_id") WHERE "provider_resource_id" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_connection_grant_org_connection_member_idx" ON "workspace_control"."workspace_connection_grant" USING btree ("organization_id","connection_id","member_id");--> statement-breakpoint
CREATE INDEX "workspace_connection_grant_org_member_idx" ON "workspace_control"."workspace_connection_grant" USING btree ("organization_id","member_id");--> statement-breakpoint
CREATE INDEX "credential_lease_member_active_idx" ON "workspace_control"."workspace_credential_lease" USING btree ("organization_id","user_id","expires_at");--> statement-breakpoint
CREATE INDEX "credential_lease_connection_active_idx" ON "workspace_control"."workspace_credential_lease" USING btree ("connection_id","expires_at");--> statement-breakpoint
CREATE INDEX "credential_lease_expiry_idx" ON "workspace_control"."workspace_credential_lease" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_lease_active_slot_idx" ON "workspace_control"."workspace_credential_lease" USING btree ("organization_id","connection_id","user_id","active_slot") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "credential_lease_cleanup_ready_idx" ON "workspace_control"."workspace_credential_lease" USING btree ("cleanup_attempts","cleanup_next_attempt_at","expires_at") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_data_key_org_version_idx" ON "workspace_control"."workspace_data_key" USING btree ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_data_key_org_active_idx" ON "workspace_control"."workspace_data_key" USING btree ("organization_id") WHERE "retired_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_data_key_rotation_org_idempotency_idx" ON "workspace_control"."workspace_data_key_rotation" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_data_key_rotation_org_running_idx" ON "workspace_control"."workspace_data_key_rotation" USING btree ("organization_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_deletion_receipt_org_pending_idx" ON "workspace_control"."workspace_deletion_receipt" USING btree ("organization_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "workspace_deletion_receipt_purge_idx" ON "workspace_control"."workspace_deletion_receipt" USING btree ("status","purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_metadata_backup_org_id_idx" ON "workspace_control"."workspace_metadata_backup" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "workspace_metadata_backup_org_created_idx" ON "workspace_control"."workspace_metadata_backup" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_metadata_backup_org_data_key_idx" ON "workspace_control"."workspace_metadata_backup" USING btree ("organization_id","data_key_id");--> statement-breakpoint
CREATE INDEX "workspace_profile_lifecycle_purge_idx" ON "workspace_control"."workspace_profile" USING btree ("lifecycle_state","purge_after");--> statement-breakpoint
CREATE INDEX "provider_discovery_receipt_org_expiry_idx" ON "workspace_control"."workspace_provider_discovery_receipt" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_import_org_key_idx" ON "workspace_control"."workspace_provider_import_request" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_integration_org_provider_account_idx" ON "workspace_control"."workspace_provider_integration" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "provider_integration_org_status_idx" ON "workspace_control"."workspace_provider_integration" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operation_org_idempotency_idx" ON "workspace_control"."workspace_provider_operation" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "provider_operation_org_state_updated_idx" ON "workspace_control"."workspace_provider_operation" USING btree ("organization_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "provider_operation_integration_state_idx" ON "workspace_control"."workspace_provider_operation" USING btree ("integration_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_operation_approval_org_operation_idx" ON "workspace_control"."workspace_provider_operation_approval" USING btree ("organization_id","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_principal_claim_integration_access_idx" ON "workspace_control"."workspace_provider_principal_claim" USING btree ("integration_id","access_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_principal_claim_org_target_idx" ON "workspace_control"."workspace_provider_principal_claim" USING btree ("organization_id","target_fingerprint") WHERE "access_kind" = 'read';--> statement-breakpoint
CREATE INDEX "provider_principal_claim_target_idx" ON "workspace_control"."workspace_provider_principal_claim" USING btree ("target_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resource_org_provider_fingerprint_idx" ON "workspace_control"."workspace_provider_resource" USING btree ("organization_id","provider","resource_fingerprint");--> statement-breakpoint
CREATE INDEX "workspace_resource_conflict_org_resource_idx" ON "workspace_control"."workspace_resource_conflict" USING btree ("organization_id","resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_conflict_resolution_org_id_idx" ON "workspace_control"."workspace_resource_conflict_resolution" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_conflict_resolution_org_conflict_idx" ON "workspace_control"."workspace_resource_conflict_resolution" USING btree ("organization_id","conflict_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_resource_version_main_revision_idx" ON "workspace_control"."workspace_resource_version" USING btree ("organization_id","resource_type","resource_id","revision") WHERE "branch" = 'main';--> statement-breakpoint
CREATE INDEX "workspace_resource_version_org_resource_created_idx" ON "workspace_control"."workspace_resource_version" USING btree ("organization_id","resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_sync_event_org_sequence_idx" ON "workspace_control"."workspace_sync_event" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_sync_event_audit_idx" ON "workspace_control"."workspace_sync_event" USING btree ("audit_event_id");--> statement-breakpoint
CREATE FUNCTION "workspace_control"."reject_workspace_version_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
BEGIN
  RAISE EXCEPTION 'workspace versions and conflicts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_resource_version_append_only"
BEFORE UPDATE OR DELETE ON "workspace_control"."workspace_resource_version"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_workspace_version_mutation"();
--> statement-breakpoint
CREATE TRIGGER "workspace_resource_conflict_append_only"
BEFORE UPDATE OR DELETE ON "workspace_control"."workspace_resource_conflict"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_workspace_version_mutation"();
--> statement-breakpoint
CREATE TRIGGER "workspace_resource_conflict_resolution_append_only"
BEFORE UPDATE OR DELETE ON "workspace_control"."workspace_resource_conflict_resolution"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_workspace_version_mutation"();
--> statement-breakpoint
CREATE FUNCTION "workspace_control"."validate_workspace_backup_reencryption"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
    OR NEW."snapshot_hash" IS DISTINCT FROM OLD."snapshot_hash"
    OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
    OR NEW."reencrypted_at" IS NULL
    OR NEW."reencrypted_by_rotation_id" IS NULL
    OR NEW."data_key_id" IS NULL
    OR NEW."key_reference" <> 'dopedb-workspace-data-key'
    OR NOT EXISTS (
      SELECT 1
      FROM "workspace_control"."workspace_data_key_rotation" rotation
      JOIN "workspace_control"."workspace_data_key" target
        ON target."organization_id" = rotation."organization_id"
       AND target."id" = rotation."to_data_key_id"
      WHERE rotation."id" = NEW."reencrypted_by_rotation_id"
        AND rotation."organization_id" = NEW."organization_id"
        AND rotation."status" = 'running'
        AND rotation."claim_id" IS NOT NULL
        AND rotation."claim_expires_at" > now()
        AND rotation."to_data_key_id" = NEW."data_key_id"
        AND NEW."key_version" = 'v' || target."version"::text
    )
  THEN
    RAISE EXCEPTION 'workspace backup payloads are immutable outside an active key rotation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_metadata_backup_payload_immutable"
BEFORE UPDATE OF "ciphertext", "snapshot_hash", "key_reference", "key_version", "source_revision", "data_key_id"
ON "workspace_control"."workspace_metadata_backup"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."validate_workspace_backup_reencryption"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "workspace_control"."purge_due_workspace"(
  target_organization_id text,
  target_receipt_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, workspace_control
AS $$
DECLARE
  eligible boolean;
BEGIN
  SELECT TRUE INTO eligible
  FROM workspace_control.workspace_profile profile
  JOIN workspace_control.workspace_deletion_receipt receipt
    ON receipt.id = profile.deletion_receipt_id
   AND receipt.organization_id = profile.organization_id
  WHERE profile.organization_id = target_organization_id
    AND profile.lifecycle_state = 'deletion_pending'
    AND profile.deletion_receipt_id = target_receipt_id
    AND profile.purge_after <= now()
    AND receipt.status = 'pending'
    AND receipt.purge_after <= now()
  FOR UPDATE OF profile, receipt;

  IF eligible IS DISTINCT FROM TRUE THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM workspace_control.workspace_credential_lease lease
    WHERE lease.organization_id = target_organization_id
      AND lease.revoked_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM workspace_control.workspace_provider_integration integration
    WHERE integration.organization_id = target_organization_id
      AND integration.revoked_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM workspace_control.workspace_provider_operation operation
    WHERE operation.organization_id = target_organization_id
      AND operation.state NOT IN ('succeeded', 'failed', 'cancelled')
  ) OR EXISTS (
    SELECT 1 FROM workspace_control.workspace_data_key_rotation rotation
    WHERE rotation.organization_id = target_organization_id
      AND rotation.status = 'running'
  ) OR EXISTS (
    SELECT 1 FROM workspace_control.member member
    WHERE member.organization_id = target_organization_id
      AND member.revocation_claim_id IS NOT NULL
  ) THEN
    RETURN FALSE;
  END IF;

  DELETE FROM workspace_control.workspace_metadata_backup
  WHERE organization_id = target_organization_id;

  DELETE FROM workspace_control.workspace_data_key_rotation
  WHERE organization_id = target_organization_id;

  DELETE FROM workspace_control.workspace_data_key
  WHERE organization_id = target_organization_id;

  UPDATE workspace_control.workspace_deletion_receipt
  SET status = 'purged', purged_at = now()
  WHERE id = target_receipt_id
    AND organization_id = target_organization_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace deletion receipt changed during purge';
  END IF;

  DELETE FROM workspace_control.organization
  WHERE id = target_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace disappeared during purge';
  END IF;

  RETURN TRUE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "workspace_control"."purge_due_workspace"(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "workspace_control"."purge_due_workspace"(text, uuid) TO CURRENT_USER;
--> statement-breakpoint
CREATE FUNCTION "workspace_control"."append_workspace_sync_event"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
DECLARE
  allocated_sequence bigint;
BEGIN
  IF NEW."action" LIKE 'credential.lease.%'
    OR (
      NEW."action" LIKE 'workspace.backup.%'
      AND NEW."action" <> 'workspace.backup.restore'
    )
    OR NEW."action" LIKE 'workspace.data_key.%' THEN
    RETURN NEW;
  END IF;

  INSERT INTO "workspace_control"."workspace_sync_head"
    ("organization_id", "last_sequence", "updated_at")
  VALUES (NEW."organization_id", 0, NEW."created_at")
  ON CONFLICT ("organization_id") DO NOTHING;

  UPDATE "workspace_control"."workspace_sync_head"
  SET "last_sequence" = "last_sequence" + 1,
    "updated_at" = NEW."created_at"
  WHERE "organization_id" = NEW."organization_id"
    AND "last_sequence" < 9007199254740991
  RETURNING "last_sequence" INTO allocated_sequence;

  IF allocated_sequence IS NULL THEN
    RAISE EXCEPTION 'workspace sync sequence exhausted';
  END IF;

  INSERT INTO "workspace_control"."workspace_sync_event"
    ("organization_id", "sequence", "audit_event_id", "resource_type",
     "operation", "tombstone", "created_at")
  VALUES (
    NEW."organization_id",
    allocated_sequence,
    NEW."id",
    NEW."resource_type",
    NEW."action",
    NEW."action" LIKE '%.delete%'
      OR NEW."action" LIKE '%.revoke%'
      OR NEW."action" LIKE '%.remove%',
    NEW."created_at"
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_audit_append_sync_event"
AFTER INSERT ON "workspace_control"."workspace_audit_event"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."append_workspace_sync_event"();
--> statement-breakpoint
CREATE FUNCTION "workspace_control"."reject_knowledge_graph_revision_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
BEGIN
  RAISE EXCEPTION 'knowledge graph revisions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "knowledge_graph_revision_reject_update"
BEFORE UPDATE ON "workspace_control"."knowledge_graph_revision"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_knowledge_graph_revision_update"();
--> statement-breakpoint
CREATE FUNCTION "workspace_control"."reject_analysis_evidence_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
BEGIN
  RAISE EXCEPTION 'Analysis Article evidence is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_analysis_article_revision_immutable_update"
BEFORE UPDATE ON "workspace_control"."workspace_analysis_article_revision"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_analysis_evidence_update"();
--> statement-breakpoint
CREATE TRIGGER "workspace_analysis_query_receipt_immutable_update"
BEFORE UPDATE ON "workspace_control"."workspace_analysis_article_query_receipt"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."reject_analysis_evidence_update"();
--> statement-breakpoint
CREATE FUNCTION "workspace_control"."enforce_analysis_publication_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, workspace_control
AS $$
BEGIN
  IF OLD."approved_by_member_id" IS NOT NULL
    AND NEW."approved_by_member_id" IS NULL
    AND (to_jsonb(NEW) - 'approved_by_member_id')
      IS NOT DISTINCT FROM (to_jsonb(OLD) - 'approved_by_member_id') THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
    OR OLD."revoked_at" IS NOT NULL
    OR NEW."revoked_at" IS NULL
    OR NEW."revoked_at" < OLD."published_at" THEN
    RAISE EXCEPTION 'Analysis Article publication snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "workspace_analysis_publication_revoke_only_update"
BEFORE UPDATE ON "workspace_control"."workspace_analysis_publication"
FOR EACH ROW EXECUTE FUNCTION "workspace_control"."enforce_analysis_publication_revocation"();
