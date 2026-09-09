-- Preserve PostgreSQL type rejection at the D1 storage boundary.
-- D1 transports integers through JavaScript numbers; reject inexact values.

CREATE TRIGGER "account_types_insert" BEFORE INSERT ON "account"
WHEN (NEW."access_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."access_token_expires_at") = 'text' AND length(NEW."access_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."access_token_expires_at") IS NEW."access_token_expires_at"))
  OR (NEW."refresh_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."refresh_token_expires_at") = 'text' AND length(NEW."refresh_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_token_expires_at") IS NEW."refresh_token_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "account_types_update" BEFORE UPDATE ON "account"
WHEN (NEW."access_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."access_token_expires_at") = 'text' AND length(NEW."access_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."access_token_expires_at") IS NEW."access_token_expires_at"))
  OR (NEW."refresh_token_expires_at" IS NOT NULL AND NOT (typeof(NEW."refresh_token_expires_at") = 'text' AND length(NEW."refresh_token_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_token_expires_at") IS NEW."refresh_token_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "device_code_types_insert" BEFORE INSERT ON "device_code"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."last_polled_at" IS NOT NULL AND NOT (typeof(NEW."last_polled_at") = 'text' AND length(NEW."last_polled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_polled_at") IS NEW."last_polled_at"))
  OR (NEW."polling_interval" IS NOT NULL AND NOT (typeof(NEW."polling_interval") = 'integer' AND NEW."polling_interval" BETWEEN -2147483648 AND 2147483647))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "device_code_types_update" BEFORE UPDATE ON "device_code"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."last_polled_at" IS NOT NULL AND NOT (typeof(NEW."last_polled_at") = 'text' AND length(NEW."last_polled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_polled_at") IS NEW."last_polled_at"))
  OR (NEW."polling_interval" IS NOT NULL AND NOT (typeof(NEW."polling_interval") = 'integer' AND NEW."polling_interval" BETWEEN -2147483648 AND 2147483647))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "invitation_types_insert" BEFORE INSERT ON "invitation"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "invitation_types_update" BEFORE UPDATE ON "invitation"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_activation_entity_types_insert" BEFORE INSERT ON "knowledge_code_index_activation_entity"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."batch_index" IS NOT NULL AND NOT (typeof(NEW."batch_index") = 'integer' AND NEW."batch_index" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."primary_definition" IS NOT NULL AND NOT (typeof(NEW."primary_definition") = 'integer' AND NEW."primary_definition" IN (0, 1)))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_activation_entity_types_update" BEFORE UPDATE ON "knowledge_code_index_activation_entity"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."batch_index" IS NOT NULL AND NOT (typeof(NEW."batch_index") = 'integer' AND NEW."batch_index" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."primary_definition" IS NOT NULL AND NOT (typeof(NEW."primary_definition") = 'integer' AND NEW."primary_definition" IN (0, 1)))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_activation_fragment_types_insert" BEFORE INSERT ON "knowledge_code_index_activation_fragment"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."batch_index" IS NOT NULL AND NOT (typeof(NEW."batch_index") = 'integer' AND NEW."batch_index" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."file_count" IS NOT NULL AND NOT (typeof(NEW."file_count") = 'integer' AND NEW."file_count" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."parsed_files" IS NOT NULL AND NOT (typeof(NEW."parsed_files") = 'integer' AND NEW."parsed_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."skipped_files" IS NOT NULL AND NOT (typeof(NEW."skipped_files") = 'integer' AND NEW."skipped_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_activation_fragment_types_update" BEFORE UPDATE ON "knowledge_code_index_activation_fragment"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."batch_index" IS NOT NULL AND NOT (typeof(NEW."batch_index") = 'integer' AND NEW."batch_index" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."file_count" IS NOT NULL AND NOT (typeof(NEW."file_count") = 'integer' AND NEW."file_count" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."parsed_files" IS NOT NULL AND NOT (typeof(NEW."parsed_files") = 'integer' AND NEW."parsed_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."skipped_files" IS NOT NULL AND NOT (typeof(NEW."skipped_files") = 'integer' AND NEW."skipped_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_file_types_insert" BEFORE INSERT ON "knowledge_code_index_file"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."bytes" IS NOT NULL AND NOT (typeof(NEW."bytes") = 'integer' AND NEW."bytes" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."analysis" IS NOT NULL AND NOT (typeof(NEW."analysis") = 'text' AND json_valid(NEW."analysis")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_code_index_file_types_update" BEFORE UPDATE ON "knowledge_code_index_file"
WHEN (NEW."job_id" IS NOT NULL AND NOT (length(NEW."job_id") = 36 AND substr(NEW."job_id", 9, 1) = '-' AND substr(NEW."job_id", 14, 1) = '-' AND substr(NEW."job_id", 19, 1) = '-' AND substr(NEW."job_id", 24, 1) = '-' AND length(replace(NEW."job_id", '-', '')) = 32 AND replace(NEW."job_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."bytes" IS NOT NULL AND NOT (typeof(NEW."bytes") = 'integer' AND NEW."bytes" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."analysis" IS NOT NULL AND NOT (typeof(NEW."analysis") = 'text' AND json_valid(NEW."analysis")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_environment_connection_types_insert" BEFORE INSERT ON "knowledge_environment_connection"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_environment_connection_types_update" BEFORE UPDATE ON "knowledge_environment_connection"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_environment_head_types_insert" BEFORE INSERT ON "knowledge_environment_head"
WHEN (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."activated_at" IS NOT NULL AND NOT (typeof(NEW."activated_at") = 'text' AND length(NEW."activated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."activated_at") IS NEW."activated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_environment_head_types_update" BEFORE UPDATE ON "knowledge_environment_head"
WHEN (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."activated_at" IS NOT NULL AND NOT (typeof(NEW."activated_at") = 'text' AND length(NEW."activated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."activated_at") IS NEW."activated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_github_installation_types_insert" BEFORE INSERT ON "knowledge_github_installation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."installation_id" IS NOT NULL AND NOT (typeof(NEW."installation_id") = 'integer' AND NEW."installation_id" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_github_installation_types_update" BEFORE UPDATE ON "knowledge_github_installation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."installation_id" IS NOT NULL AND NOT (typeof(NEW."installation_id") = 'integer' AND NEW."installation_id" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_github_setup_state_types_insert" BEFORE INSERT ON "knowledge_github_setup_state"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_github_setup_state_types_update" BEFORE UPDATE ON "knowledge_github_setup_state"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_grant_types_insert" BEFORE INSERT ON "knowledge_grant"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_grant_types_update" BEFORE UPDATE ON "knowledge_grant"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_grant_graph_revision_types_insert" BEFORE INSERT ON "knowledge_grant_graph_revision"
WHEN (NEW."grant_id" IS NOT NULL AND NOT (length(NEW."grant_id") = 36 AND substr(NEW."grant_id", 9, 1) = '-' AND substr(NEW."grant_id", 14, 1) = '-' AND substr(NEW."grant_id", 19, 1) = '-' AND substr(NEW."grant_id", 24, 1) = '-' AND length(replace(NEW."grant_id", '-', '')) = 32 AND replace(NEW."grant_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_grant_graph_revision_types_update" BEFORE UPDATE ON "knowledge_grant_graph_revision"
WHEN (NEW."grant_id" IS NOT NULL AND NOT (length(NEW."grant_id") = 36 AND substr(NEW."grant_id", 9, 1) = '-' AND substr(NEW."grant_id", 14, 1) = '-' AND substr(NEW."grant_id", 19, 1) = '-' AND substr(NEW."grant_id", 24, 1) = '-' AND length(replace(NEW."grant_id", '-', '')) = 32 AND replace(NEW."grant_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_graph_revision_types_insert" BEFORE INSERT ON "knowledge_graph_revision"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."parent_graph_revision_id" IS NOT NULL AND NOT (length(NEW."parent_graph_revision_id") = 36 AND substr(NEW."parent_graph_revision_id", 9, 1) = '-' AND substr(NEW."parent_graph_revision_id", 14, 1) = '-' AND substr(NEW."parent_graph_revision_id", 19, 1) = '-' AND substr(NEW."parent_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."parent_graph_revision_id", '-', '')) = 32 AND replace(NEW."parent_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."artifact" IS NOT NULL AND NOT (typeof(NEW."artifact") = 'text' AND json_valid(NEW."artifact")))
  OR (NEW."generated_at" IS NOT NULL AND NOT (typeof(NEW."generated_at") = 'text' AND length(NEW."generated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."generated_at") IS NEW."generated_at"))
  OR (NEW."staged_at" IS NOT NULL AND NOT (typeof(NEW."staged_at") = 'text' AND length(NEW."staged_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."staged_at") IS NEW."staged_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_graph_revision_types_update" BEFORE UPDATE ON "knowledge_graph_revision"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."parent_graph_revision_id" IS NOT NULL AND NOT (length(NEW."parent_graph_revision_id") = 36 AND substr(NEW."parent_graph_revision_id", 9, 1) = '-' AND substr(NEW."parent_graph_revision_id", 14, 1) = '-' AND substr(NEW."parent_graph_revision_id", 19, 1) = '-' AND substr(NEW."parent_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."parent_graph_revision_id", '-', '')) = 32 AND replace(NEW."parent_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."artifact" IS NOT NULL AND NOT (typeof(NEW."artifact") = 'text' AND json_valid(NEW."artifact")))
  OR (NEW."generated_at" IS NOT NULL AND NOT (typeof(NEW."generated_at") = 'text' AND length(NEW."generated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."generated_at") IS NEW."generated_at"))
  OR (NEW."staged_at" IS NOT NULL AND NOT (typeof(NEW."staged_at") = 'text' AND length(NEW."staged_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."staged_at") IS NEW."staged_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_mapping_proposal_types_insert" BEFORE INSERT ON "knowledge_mapping_proposal"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."proposed_at" IS NOT NULL AND NOT (typeof(NEW."proposed_at") = 'text' AND length(NEW."proposed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."proposed_at") IS NEW."proposed_at"))
  OR (NEW."decided_at" IS NOT NULL AND NOT (typeof(NEW."decided_at") = 'text' AND length(NEW."decided_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."decided_at") IS NEW."decided_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_mapping_proposal_types_update" BEFORE UPDATE ON "knowledge_mapping_proposal"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."graph_revision_id" IS NOT NULL AND NOT (length(NEW."graph_revision_id") = 36 AND substr(NEW."graph_revision_id", 9, 1) = '-' AND substr(NEW."graph_revision_id", 14, 1) = '-' AND substr(NEW."graph_revision_id", 19, 1) = '-' AND substr(NEW."graph_revision_id", 24, 1) = '-' AND length(replace(NEW."graph_revision_id", '-', '')) = 32 AND replace(NEW."graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."proposed_at" IS NOT NULL AND NOT (typeof(NEW."proposed_at") = 'text' AND length(NEW."proposed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."proposed_at") IS NEW."proposed_at"))
  OR (NEW."decided_at" IS NOT NULL AND NOT (typeof(NEW."decided_at") = 'text' AND length(NEW."decided_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."decided_at") IS NEW."decided_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_project_types_insert" BEFORE INSERT ON "knowledge_project"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_project_types_update" BEFORE UPDATE ON "knowledge_project"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_project_environment_types_insert" BEFORE INSERT ON "knowledge_project_environment"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."production" IS NOT NULL AND NOT (typeof(NEW."production") = 'integer' AND NEW."production" IN (0, 1)))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_project_environment_types_update" BEFORE UPDATE ON "knowledge_project_environment"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_id" IS NOT NULL AND NOT (length(NEW."project_id") = 36 AND substr(NEW."project_id", 9, 1) = '-' AND substr(NEW."project_id", 14, 1) = '-' AND substr(NEW."project_id", 19, 1) = '-' AND substr(NEW."project_id", 24, 1) = '-' AND length(replace(NEW."project_id", '-', '')) = 32 AND replace(NEW."project_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."production" IS NOT NULL AND NOT (typeof(NEW."production") = 'integer' AND NEW."production" IN (0, 1)))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

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

CREATE TRIGGER "knowledge_source_event_types_insert" BEFORE INSERT ON "knowledge_source_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."changed_files" IS NOT NULL AND NOT (typeof(NEW."changed_files") = 'text' AND json_valid(NEW."changed_files")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_source_event_types_update" BEFORE UPDATE ON "knowledge_source_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."changed_files" IS NOT NULL AND NOT (typeof(NEW."changed_files") = 'text' AND json_valid(NEW."changed_files")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_source_sync_job_types_insert" BEFORE INSERT ON "knowledge_source_sync_job"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_sync_revision" IS NOT NULL AND NOT (typeof(NEW."source_sync_revision") = 'integer' AND NEW."source_sync_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."trigger_event_id" IS NOT NULL AND NOT (length(NEW."trigger_event_id") = 36 AND substr(NEW."trigger_event_id", 9, 1) = '-' AND substr(NEW."trigger_event_id", 14, 1) = '-' AND substr(NEW."trigger_event_id", 19, 1) = '-' AND substr(NEW."trigger_event_id", 24, 1) = '-' AND length(replace(NEW."trigger_event_id", '-', '')) = 32 AND replace(NEW."trigger_event_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."attempt" IS NOT NULL AND NOT (typeof(NEW."attempt") = 'integer' AND NEW."attempt" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."total_files" IS NOT NULL AND NOT (typeof(NEW."total_files") = 'integer' AND NEW."total_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."processed_files" IS NOT NULL AND NOT (typeof(NEW."processed_files") = 'integer' AND NEW."processed_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."manifest" IS NOT NULL AND NOT (typeof(NEW."manifest") = 'text' AND json_valid(NEW."manifest")))
  OR (NEW."activation_graph_revision_id" IS NOT NULL AND NOT (length(NEW."activation_graph_revision_id") = 36 AND substr(NEW."activation_graph_revision_id", 9, 1) = '-' AND substr(NEW."activation_graph_revision_id", 14, 1) = '-' AND substr(NEW."activation_graph_revision_id", 19, 1) = '-' AND substr(NEW."activation_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."activation_graph_revision_id", '-', '')) = 32 AND replace(NEW."activation_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."activation_parent_graph_revision_id" IS NOT NULL AND NOT (length(NEW."activation_parent_graph_revision_id") = 36 AND substr(NEW."activation_parent_graph_revision_id", 9, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 14, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 19, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."activation_parent_graph_revision_id", '-', '')) = 32 AND replace(NEW."activation_parent_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."activation_generated_at" IS NOT NULL AND NOT (typeof(NEW."activation_generated_at") = 'text' AND length(NEW."activation_generated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."activation_generated_at") IS NEW."activation_generated_at"))
  OR (NEW."available_at" IS NOT NULL AND NOT (typeof(NEW."available_at") = 'text' AND length(NEW."available_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."available_at") IS NEW."available_at"))
  OR (NEW."claimed_at" IS NOT NULL AND NOT (typeof(NEW."claimed_at") = 'text' AND length(NEW."claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claimed_at") IS NEW."claimed_at"))
  OR (NEW."lease_expires_at" IS NOT NULL AND NOT (typeof(NEW."lease_expires_at") = 'text' AND length(NEW."lease_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."lease_expires_at") IS NEW."lease_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."finished_at" IS NOT NULL AND NOT (typeof(NEW."finished_at") = 'text' AND length(NEW."finished_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."finished_at") IS NEW."finished_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "knowledge_source_sync_job_types_update" BEFORE UPDATE ON "knowledge_source_sync_job"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_id" IS NOT NULL AND NOT (length(NEW."source_id") = 36 AND substr(NEW."source_id", 9, 1) = '-' AND substr(NEW."source_id", 14, 1) = '-' AND substr(NEW."source_id", 19, 1) = '-' AND substr(NEW."source_id", 24, 1) = '-' AND length(replace(NEW."source_id", '-', '')) = 32 AND replace(NEW."source_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_sync_revision" IS NOT NULL AND NOT (typeof(NEW."source_sync_revision") = 'integer' AND NEW."source_sync_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."trigger_event_id" IS NOT NULL AND NOT (length(NEW."trigger_event_id") = 36 AND substr(NEW."trigger_event_id", 9, 1) = '-' AND substr(NEW."trigger_event_id", 14, 1) = '-' AND substr(NEW."trigger_event_id", 19, 1) = '-' AND substr(NEW."trigger_event_id", 24, 1) = '-' AND length(replace(NEW."trigger_event_id", '-', '')) = 32 AND replace(NEW."trigger_event_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."attempt" IS NOT NULL AND NOT (typeof(NEW."attempt") = 'integer' AND NEW."attempt" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."total_files" IS NOT NULL AND NOT (typeof(NEW."total_files") = 'integer' AND NEW."total_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."processed_files" IS NOT NULL AND NOT (typeof(NEW."processed_files") = 'integer' AND NEW."processed_files" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."manifest" IS NOT NULL AND NOT (typeof(NEW."manifest") = 'text' AND json_valid(NEW."manifest")))
  OR (NEW."activation_graph_revision_id" IS NOT NULL AND NOT (length(NEW."activation_graph_revision_id") = 36 AND substr(NEW."activation_graph_revision_id", 9, 1) = '-' AND substr(NEW."activation_graph_revision_id", 14, 1) = '-' AND substr(NEW."activation_graph_revision_id", 19, 1) = '-' AND substr(NEW."activation_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."activation_graph_revision_id", '-', '')) = 32 AND replace(NEW."activation_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."activation_parent_graph_revision_id" IS NOT NULL AND NOT (length(NEW."activation_parent_graph_revision_id") = 36 AND substr(NEW."activation_parent_graph_revision_id", 9, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 14, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 19, 1) = '-' AND substr(NEW."activation_parent_graph_revision_id", 24, 1) = '-' AND length(replace(NEW."activation_parent_graph_revision_id", '-', '')) = 32 AND replace(NEW."activation_parent_graph_revision_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."activation_generated_at" IS NOT NULL AND NOT (typeof(NEW."activation_generated_at") = 'text' AND length(NEW."activation_generated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."activation_generated_at") IS NEW."activation_generated_at"))
  OR (NEW."available_at" IS NOT NULL AND NOT (typeof(NEW."available_at") = 'text' AND length(NEW."available_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."available_at") IS NEW."available_at"))
  OR (NEW."claimed_at" IS NOT NULL AND NOT (typeof(NEW."claimed_at") = 'text' AND length(NEW."claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claimed_at") IS NEW."claimed_at"))
  OR (NEW."lease_expires_at" IS NOT NULL AND NOT (typeof(NEW."lease_expires_at") = 'text' AND length(NEW."lease_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."lease_expires_at") IS NEW."lease_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."finished_at" IS NOT NULL AND NOT (typeof(NEW."finished_at") = 'text' AND length(NEW."finished_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."finished_at") IS NEW."finished_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "member_types_insert" BEFORE INSERT ON "member"
WHEN (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "member_types_update" BEFORE UPDATE ON "member"
WHEN (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "organization_types_insert" BEFORE INSERT ON "organization"
WHEN (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "organization_types_update" BEFORE UPDATE ON "organization"
WHEN (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "provider_oauth_state_types_insert" BEFORE INSERT ON "provider_oauth_state"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "provider_oauth_state_types_update" BEFORE UPDATE ON "provider_oauth_state"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "provider_setup_session_types_insert" BEFORE INSERT ON "provider_setup_session"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "provider_setup_session_types_update" BEFORE UPDATE ON "provider_setup_session"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "rate_limit_types_insert" BEFORE INSERT ON "rate_limit"
WHEN (NEW."count" IS NOT NULL AND NOT (typeof(NEW."count") = 'integer' AND NEW."count" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."last_request" IS NOT NULL AND NOT (typeof(NEW."last_request") = 'integer' AND NEW."last_request" BETWEEN -9007199254740991 AND 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "rate_limit_types_update" BEFORE UPDATE ON "rate_limit"
WHEN (NEW."count" IS NOT NULL AND NOT (typeof(NEW."count") = 'integer' AND NEW."count" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."last_request" IS NOT NULL AND NOT (typeof(NEW."last_request") = 'integer' AND NEW."last_request" BETWEEN -9007199254740991 AND 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "session_types_insert" BEFORE INSERT ON "session"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "session_types_update" BEFORE UPDATE ON "session"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "user_types_insert" BEFORE INSERT ON "user"
WHEN (NEW."email_verified" IS NOT NULL AND NOT (typeof(NEW."email_verified") = 'integer' AND NEW."email_verified" IN (0, 1)))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "user_types_update" BEFORE UPDATE ON "user"
WHEN (NEW."email_verified" IS NOT NULL AND NOT (typeof(NEW."email_verified") = 'integer' AND NEW."email_verified" IN (0, 1)))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "verification_types_insert" BEFORE INSERT ON "verification"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "verification_types_update" BEFORE UPDATE ON "verification"
WHEN (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_types_insert" BEFORE INSERT ON "workspace_analysis_article"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."definition" IS NOT NULL AND NOT (typeof(NEW."definition") = 'text' AND json_valid(NEW."definition")))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."latest_successful_run_id" IS NOT NULL AND NOT (length(NEW."latest_successful_run_id") = 36 AND substr(NEW."latest_successful_run_id", 9, 1) = '-' AND substr(NEW."latest_successful_run_id", 14, 1) = '-' AND substr(NEW."latest_successful_run_id", 19, 1) = '-' AND substr(NEW."latest_successful_run_id", 24, 1) = '-' AND length(replace(NEW."latest_successful_run_id", '-', '')) = 32 AND replace(NEW."latest_successful_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_types_update" BEFORE UPDATE ON "workspace_analysis_article"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."project_environment_id" IS NOT NULL AND NOT (length(NEW."project_environment_id") = 36 AND substr(NEW."project_environment_id", 9, 1) = '-' AND substr(NEW."project_environment_id", 14, 1) = '-' AND substr(NEW."project_environment_id", 19, 1) = '-' AND substr(NEW."project_environment_id", 24, 1) = '-' AND length(replace(NEW."project_environment_id", '-', '')) = 32 AND replace(NEW."project_environment_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."environment_revision" IS NOT NULL AND NOT (typeof(NEW."environment_revision") = 'integer' AND NEW."environment_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."definition" IS NOT NULL AND NOT (typeof(NEW."definition") = 'text' AND json_valid(NEW."definition")))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."latest_successful_run_id" IS NOT NULL AND NOT (length(NEW."latest_successful_run_id") = 36 AND substr(NEW."latest_successful_run_id", 9, 1) = '-' AND substr(NEW."latest_successful_run_id", 14, 1) = '-' AND substr(NEW."latest_successful_run_id", 19, 1) = '-' AND substr(NEW."latest_successful_run_id", 24, 1) = '-' AND length(replace(NEW."latest_successful_run_id", '-', '')) = 32 AND replace(NEW."latest_successful_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_query_receipt_types_insert" BEFORE INSERT ON "workspace_analysis_article_query_receipt"
WHEN (NEW."run_id" IS NOT NULL AND NOT (length(NEW."run_id") = 36 AND substr(NEW."run_id", 9, 1) = '-' AND substr(NEW."run_id", 14, 1) = '-' AND substr(NEW."run_id", 19, 1) = '-' AND substr(NEW."run_id", 24, 1) = '-' AND length(replace(NEW."run_id", '-', '')) = 32 AND replace(NEW."run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."query_run_id" IS NOT NULL AND NOT (length(NEW."query_run_id") = 36 AND substr(NEW."query_run_id", 9, 1) = '-' AND substr(NEW."query_run_id", 14, 1) = '-' AND substr(NEW."query_run_id", 19, 1) = '-' AND substr(NEW."query_run_id", 24, 1) = '-' AND length(replace(NEW."query_run_id", '-', '')) = 32 AND replace(NEW."query_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."row_count" IS NOT NULL AND NOT (typeof(NEW."row_count") = 'integer' AND NEW."row_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."byte_count" IS NOT NULL AND NOT (typeof(NEW."byte_count") = 'integer' AND NEW."byte_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."duration_ms" IS NOT NULL AND NOT (typeof(NEW."duration_ms") = 'integer' AND NEW."duration_ms" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_query_receipt_types_update" BEFORE UPDATE ON "workspace_analysis_article_query_receipt"
WHEN (NEW."run_id" IS NOT NULL AND NOT (length(NEW."run_id") = 36 AND substr(NEW."run_id", 9, 1) = '-' AND substr(NEW."run_id", 14, 1) = '-' AND substr(NEW."run_id", 19, 1) = '-' AND substr(NEW."run_id", 24, 1) = '-' AND length(replace(NEW."run_id", '-', '')) = 32 AND replace(NEW."run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."query_run_id" IS NOT NULL AND NOT (length(NEW."query_run_id") = 36 AND substr(NEW."query_run_id", 9, 1) = '-' AND substr(NEW."query_run_id", 14, 1) = '-' AND substr(NEW."query_run_id", 19, 1) = '-' AND substr(NEW."query_run_id", 24, 1) = '-' AND length(replace(NEW."query_run_id", '-', '')) = 32 AND replace(NEW."query_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."row_count" IS NOT NULL AND NOT (typeof(NEW."row_count") = 'integer' AND NEW."row_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."byte_count" IS NOT NULL AND NOT (typeof(NEW."byte_count") = 'integer' AND NEW."byte_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."duration_ms" IS NOT NULL AND NOT (typeof(NEW."duration_ms") = 'integer' AND NEW."duration_ms" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_revision_types_insert" BEFORE INSERT ON "workspace_analysis_article_revision"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."base_revision" IS NOT NULL AND NOT (typeof(NEW."base_revision") = 'integer' AND NEW."base_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_revision_types_update" BEFORE UPDATE ON "workspace_analysis_article_revision"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."base_revision" IS NOT NULL AND NOT (typeof(NEW."base_revision") = 'integer' AND NEW."base_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_run_types_insert" BEFORE INSERT ON "workspace_analysis_article_run"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_revision" IS NOT NULL AND NOT (typeof(NEW."article_revision") = 'integer' AND NEW."article_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."runner_id" IS NOT NULL AND NOT (length(NEW."runner_id") = 36 AND substr(NEW."runner_id", 9, 1) = '-' AND substr(NEW."runner_id", 14, 1) = '-' AND substr(NEW."runner_id", 19, 1) = '-' AND substr(NEW."runner_id", 24, 1) = '-' AND length(replace(NEW."runner_id", '-', '')) = 32 AND replace(NEW."runner_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."runner_capability_generation" IS NOT NULL AND NOT (typeof(NEW."runner_capability_generation") = 'integer' AND NEW."runner_capability_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."schema_fingerprints" IS NOT NULL AND NOT (typeof(NEW."schema_fingerprints") = 'text' AND json_valid(NEW."schema_fingerprints")))
  OR (NEW."row_count" IS NOT NULL AND NOT (typeof(NEW."row_count") = 'integer' AND NEW."row_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."byte_count" IS NOT NULL AND NOT (typeof(NEW."byte_count") = 'integer' AND NEW."byte_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."cancel_requested_at" IS NOT NULL AND NOT (typeof(NEW."cancel_requested_at") = 'text' AND length(NEW."cancel_requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cancel_requested_at") IS NEW."cancel_requested_at"))
  OR (NEW."started_at" IS NOT NULL AND NOT (typeof(NEW."started_at") = 'text' AND length(NEW."started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."started_at") IS NEW."started_at"))
  OR (NEW."finished_at" IS NOT NULL AND NOT (typeof(NEW."finished_at") = 'text' AND length(NEW."finished_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."finished_at") IS NEW."finished_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_article_run_types_update" BEFORE UPDATE ON "workspace_analysis_article_run"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_revision" IS NOT NULL AND NOT (typeof(NEW."article_revision") = 'integer' AND NEW."article_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."runner_id" IS NOT NULL AND NOT (length(NEW."runner_id") = 36 AND substr(NEW."runner_id", 9, 1) = '-' AND substr(NEW."runner_id", 14, 1) = '-' AND substr(NEW."runner_id", 19, 1) = '-' AND substr(NEW."runner_id", 24, 1) = '-' AND length(replace(NEW."runner_id", '-', '')) = 32 AND replace(NEW."runner_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."runner_capability_generation" IS NOT NULL AND NOT (typeof(NEW."runner_capability_generation") = 'integer' AND NEW."runner_capability_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."schema_fingerprints" IS NOT NULL AND NOT (typeof(NEW."schema_fingerprints") = 'text' AND json_valid(NEW."schema_fingerprints")))
  OR (NEW."row_count" IS NOT NULL AND NOT (typeof(NEW."row_count") = 'integer' AND NEW."row_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."byte_count" IS NOT NULL AND NOT (typeof(NEW."byte_count") = 'integer' AND NEW."byte_count" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."cancel_requested_at" IS NOT NULL AND NOT (typeof(NEW."cancel_requested_at") = 'text' AND length(NEW."cancel_requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cancel_requested_at") IS NEW."cancel_requested_at"))
  OR (NEW."started_at" IS NOT NULL AND NOT (typeof(NEW."started_at") = 'text' AND length(NEW."started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."started_at") IS NEW."started_at"))
  OR (NEW."finished_at" IS NOT NULL AND NOT (typeof(NEW."finished_at") = 'text' AND length(NEW."finished_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."finished_at") IS NEW."finished_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_publication_types_insert" BEFORE INSERT ON "workspace_analysis_publication"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_revision" IS NOT NULL AND NOT (typeof(NEW."article_revision") = 'integer' AND NEW."article_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."source_run_id" IS NOT NULL AND NOT (length(NEW."source_run_id") = 36 AND substr(NEW."source_run_id", 9, 1) = '-' AND substr(NEW."source_run_id", 14, 1) = '-' AND substr(NEW."source_run_id", 19, 1) = '-' AND substr(NEW."source_run_id", 24, 1) = '-' AND length(replace(NEW."source_run_id", '-', '')) = 32 AND replace(NEW."source_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."version" IS NOT NULL AND NOT (typeof(NEW."version") = 'integer' AND NEW."version" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."replaces_publication_id" IS NOT NULL AND NOT (length(NEW."replaces_publication_id") = 36 AND substr(NEW."replaces_publication_id", 9, 1) = '-' AND substr(NEW."replaces_publication_id", 14, 1) = '-' AND substr(NEW."replaces_publication_id", 19, 1) = '-' AND substr(NEW."replaces_publication_id", 24, 1) = '-' AND length(replace(NEW."replaces_publication_id", '-', '')) = 32 AND replace(NEW."replaces_publication_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."snapshot" IS NOT NULL AND NOT (typeof(NEW."snapshot") = 'text' AND json_valid(NEW."snapshot")))
  OR (NEW."published_at" IS NOT NULL AND NOT (typeof(NEW."published_at") = 'text' AND length(NEW."published_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."published_at") IS NEW."published_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_publication_types_update" BEFORE UPDATE ON "workspace_analysis_publication"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_revision" IS NOT NULL AND NOT (typeof(NEW."article_revision") = 'integer' AND NEW."article_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."source_run_id" IS NOT NULL AND NOT (length(NEW."source_run_id") = 36 AND substr(NEW."source_run_id", 9, 1) = '-' AND substr(NEW."source_run_id", 14, 1) = '-' AND substr(NEW."source_run_id", 19, 1) = '-' AND substr(NEW."source_run_id", 24, 1) = '-' AND length(replace(NEW."source_run_id", '-', '')) = 32 AND replace(NEW."source_run_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."version" IS NOT NULL AND NOT (typeof(NEW."version") = 'integer' AND NEW."version" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."replaces_publication_id" IS NOT NULL AND NOT (length(NEW."replaces_publication_id") = 36 AND substr(NEW."replaces_publication_id", 9, 1) = '-' AND substr(NEW."replaces_publication_id", 14, 1) = '-' AND substr(NEW."replaces_publication_id", 19, 1) = '-' AND substr(NEW."replaces_publication_id", 24, 1) = '-' AND length(replace(NEW."replaces_publication_id", '-', '')) = 32 AND replace(NEW."replaces_publication_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."snapshot" IS NOT NULL AND NOT (typeof(NEW."snapshot") = 'text' AND json_valid(NEW."snapshot")))
  OR (NEW."published_at" IS NOT NULL AND NOT (typeof(NEW."published_at") = 'text' AND length(NEW."published_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."published_at") IS NEW."published_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_runner_types_insert" BEFORE INSERT ON "workspace_analysis_runner"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."runner_capability_generation" IS NOT NULL AND NOT (typeof(NEW."runner_capability_generation") = 'integer' AND NEW."runner_capability_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."last_seen_at" IS NOT NULL AND NOT (typeof(NEW."last_seen_at") = 'text' AND length(NEW."last_seen_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_seen_at") IS NEW."last_seen_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_analysis_runner_types_update" BEFORE UPDATE ON "workspace_analysis_runner"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."runner_capability_generation" IS NOT NULL AND NOT (typeof(NEW."runner_capability_generation") = 'integer' AND NEW."runner_capability_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."last_seen_at" IS NOT NULL AND NOT (typeof(NEW."last_seen_at") = 'text' AND length(NEW."last_seen_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."last_seen_at") IS NEW."last_seen_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_article_invitation_types_insert" BEFORE INSERT ON "workspace_article_invitation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."accepted_at" IS NOT NULL AND NOT (typeof(NEW."accepted_at") = 'text' AND length(NEW."accepted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."accepted_at") IS NEW."accepted_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_article_invitation_types_update" BEFORE UPDATE ON "workspace_article_invitation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."article_id" IS NOT NULL AND NOT (length(NEW."article_id") = 36 AND substr(NEW."article_id", 9, 1) = '-' AND substr(NEW."article_id", 14, 1) = '-' AND substr(NEW."article_id", 19, 1) = '-' AND substr(NEW."article_id", 24, 1) = '-' AND length(replace(NEW."article_id", '-', '')) = 32 AND replace(NEW."article_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_revision" IS NOT NULL AND NOT (typeof(NEW."connection_revision") = 'integer' AND NEW."connection_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."accepted_at" IS NOT NULL AND NOT (typeof(NEW."accepted_at") = 'text' AND length(NEW."accepted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."accepted_at") IS NEW."accepted_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_audit_event_types_insert" BEFORE INSERT ON "workspace_audit_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."redacted_summary" IS NOT NULL AND NOT (typeof(NEW."redacted_summary") = 'text' AND json_valid(NEW."redacted_summary")))
  OR (NEW."request_id" IS NOT NULL AND NOT (length(NEW."request_id") = 36 AND substr(NEW."request_id", 9, 1) = '-' AND substr(NEW."request_id", 14, 1) = '-' AND substr(NEW."request_id", 19, 1) = '-' AND substr(NEW."request_id", 24, 1) = '-' AND length(replace(NEW."request_id", '-', '')) = 32 AND replace(NEW."request_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_audit_event_types_update" BEFORE UPDATE ON "workspace_audit_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."redacted_summary" IS NOT NULL AND NOT (typeof(NEW."redacted_summary") = 'text' AND json_valid(NEW."redacted_summary")))
  OR (NEW."request_id" IS NOT NULL AND NOT (length(NEW."request_id") = 36 AND substr(NEW."request_id", 9, 1) = '-' AND substr(NEW."request_id", 14, 1) = '-' AND substr(NEW."request_id", 19, 1) = '-' AND substr(NEW."request_id", 24, 1) = '-' AND length(replace(NEW."request_id", '-', '')) = 32 AND replace(NEW."request_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_connection_types_insert" BEFORE INSERT ON "workspace_connection"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."port" IS NOT NULL AND NOT (typeof(NEW."port") = 'integer' AND NEW."port" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."readonly_default" IS NOT NULL AND NOT (typeof(NEW."readonly_default") = 'integer' AND NEW."readonly_default" IN (0, 1)))
  OR (NEW."allow_writes" IS NOT NULL AND NOT (typeof(NEW."allow_writes") = 'integer' AND NEW."allow_writes" IN (0, 1)))
  OR (NEW."provider_integration_id" IS NOT NULL AND NOT (length(NEW."provider_integration_id") = 36 AND substr(NEW."provider_integration_id", 9, 1) = '-' AND substr(NEW."provider_integration_id", 14, 1) = '-' AND substr(NEW."provider_integration_id", 19, 1) = '-' AND substr(NEW."provider_integration_id", 24, 1) = '-' AND length(replace(NEW."provider_integration_id", '-', '')) = 32 AND replace(NEW."provider_integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."provider_resource" IS NOT NULL AND NOT (typeof(NEW."provider_resource") = 'text' AND json_valid(NEW."provider_resource")))
  OR (NEW."provider_resource_id" IS NOT NULL AND NOT (length(NEW."provider_resource_id") = 36 AND substr(NEW."provider_resource_id", 9, 1) = '-' AND substr(NEW."provider_resource_id", 14, 1) = '-' AND substr(NEW."provider_resource_id", 19, 1) = '-' AND substr(NEW."provider_resource_id", 24, 1) = '-' AND length(replace(NEW."provider_resource_id", '-', '')) = 32 AND replace(NEW."provider_resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."content_revision" IS NOT NULL AND NOT (typeof(NEW."content_revision") = 'integer' AND NEW."content_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
  OR (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_connection_types_update" BEFORE UPDATE ON "workspace_connection"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."port" IS NOT NULL AND NOT (typeof(NEW."port") = 'integer' AND NEW."port" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."readonly_default" IS NOT NULL AND NOT (typeof(NEW."readonly_default") = 'integer' AND NEW."readonly_default" IN (0, 1)))
  OR (NEW."allow_writes" IS NOT NULL AND NOT (typeof(NEW."allow_writes") = 'integer' AND NEW."allow_writes" IN (0, 1)))
  OR (NEW."provider_integration_id" IS NOT NULL AND NOT (length(NEW."provider_integration_id") = 36 AND substr(NEW."provider_integration_id", 9, 1) = '-' AND substr(NEW."provider_integration_id", 14, 1) = '-' AND substr(NEW."provider_integration_id", 19, 1) = '-' AND substr(NEW."provider_integration_id", 24, 1) = '-' AND length(replace(NEW."provider_integration_id", '-', '')) = 32 AND replace(NEW."provider_integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."provider_resource" IS NOT NULL AND NOT (typeof(NEW."provider_resource") = 'text' AND json_valid(NEW."provider_resource")))
  OR (NEW."provider_resource_id" IS NOT NULL AND NOT (length(NEW."provider_resource_id") = 36 AND substr(NEW."provider_resource_id", 9, 1) = '-' AND substr(NEW."provider_resource_id", 14, 1) = '-' AND substr(NEW."provider_resource_id", 19, 1) = '-' AND substr(NEW."provider_resource_id", 24, 1) = '-' AND length(replace(NEW."provider_resource_id", '-', '')) = 32 AND replace(NEW."provider_resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."content_revision" IS NOT NULL AND NOT (typeof(NEW."content_revision") = 'integer' AND NEW."content_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
  OR (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_connection_grant_types_insert" BEFORE INSERT ON "workspace_connection_grant"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_connection_grant_types_update" BEFORE UPDATE ON "workspace_connection_grant"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_credential_lease_types_insert" BEFORE INSERT ON "workspace_credential_lease"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."active_slot" IS NOT NULL AND NOT (typeof(NEW."active_slot") = 'integer' AND NEW."active_slot" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."cleanup_attempts" IS NOT NULL AND NOT (typeof(NEW."cleanup_attempts") = 'integer' AND NEW."cleanup_attempts" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."cleanup_next_attempt_at" IS NOT NULL AND NOT (typeof(NEW."cleanup_next_attempt_at") = 'text' AND length(NEW."cleanup_next_attempt_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cleanup_next_attempt_at") IS NEW."cleanup_next_attempt_at"))
  OR (NEW."cleanup_claimed_at" IS NOT NULL AND NOT (typeof(NEW."cleanup_claimed_at") = 'text' AND length(NEW."cleanup_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cleanup_claimed_at") IS NEW."cleanup_claimed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_credential_lease_types_update" BEFORE UPDATE ON "workspace_credential_lease"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."active_slot" IS NOT NULL AND NOT (typeof(NEW."active_slot") = 'integer' AND NEW."active_slot" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."cleanup_attempts" IS NOT NULL AND NOT (typeof(NEW."cleanup_attempts") = 'integer' AND NEW."cleanup_attempts" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."cleanup_next_attempt_at" IS NOT NULL AND NOT (typeof(NEW."cleanup_next_attempt_at") = 'text' AND length(NEW."cleanup_next_attempt_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cleanup_next_attempt_at") IS NEW."cleanup_next_attempt_at"))
  OR (NEW."cleanup_claimed_at" IS NOT NULL AND NOT (typeof(NEW."cleanup_claimed_at") = 'text' AND length(NEW."cleanup_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cleanup_claimed_at") IS NEW."cleanup_claimed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_data_key_types_insert" BEFORE INSERT ON "workspace_data_key"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."version" IS NOT NULL AND NOT (typeof(NEW."version") = 'integer' AND NEW."version" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."retired_at" IS NOT NULL AND NOT (typeof(NEW."retired_at") = 'text' AND length(NEW."retired_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."retired_at") IS NEW."retired_at"))
  OR (NEW."destroyed_at" IS NOT NULL AND NOT (typeof(NEW."destroyed_at") = 'text' AND length(NEW."destroyed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."destroyed_at") IS NEW."destroyed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_data_key_types_update" BEFORE UPDATE ON "workspace_data_key"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."version" IS NOT NULL AND NOT (typeof(NEW."version") = 'integer' AND NEW."version" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."retired_at" IS NOT NULL AND NOT (typeof(NEW."retired_at") = 'text' AND length(NEW."retired_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."retired_at") IS NEW."retired_at"))
  OR (NEW."destroyed_at" IS NOT NULL AND NOT (typeof(NEW."destroyed_at") = 'text' AND length(NEW."destroyed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."destroyed_at") IS NEW."destroyed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_data_key_rotation_types_insert" BEFORE INSERT ON "workspace_data_key_rotation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."from_data_key_id" IS NOT NULL AND NOT (length(NEW."from_data_key_id") = 36 AND substr(NEW."from_data_key_id", 9, 1) = '-' AND substr(NEW."from_data_key_id", 14, 1) = '-' AND substr(NEW."from_data_key_id", 19, 1) = '-' AND substr(NEW."from_data_key_id", 24, 1) = '-' AND length(replace(NEW."from_data_key_id", '-', '')) = 32 AND replace(NEW."from_data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."to_data_key_id" IS NOT NULL AND NOT (length(NEW."to_data_key_id") = 36 AND substr(NEW."to_data_key_id", 9, 1) = '-' AND substr(NEW."to_data_key_id", 14, 1) = '-' AND substr(NEW."to_data_key_id", 19, 1) = '-' AND substr(NEW."to_data_key_id", 24, 1) = '-' AND length(replace(NEW."to_data_key_id", '-', '')) = 32 AND replace(NEW."to_data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."idempotency_key" IS NOT NULL AND NOT (length(NEW."idempotency_key") = 36 AND substr(NEW."idempotency_key", 9, 1) = '-' AND substr(NEW."idempotency_key", 14, 1) = '-' AND substr(NEW."idempotency_key", 19, 1) = '-' AND substr(NEW."idempotency_key", 24, 1) = '-' AND length(replace(NEW."idempotency_key", '-', '')) = 32 AND replace(NEW."idempotency_key", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."processed_backups" IS NOT NULL AND NOT (typeof(NEW."processed_backups") = 'integer' AND NEW."processed_backups" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."claim_id" IS NOT NULL AND NOT (length(NEW."claim_id") = 36 AND substr(NEW."claim_id", 9, 1) = '-' AND substr(NEW."claim_id", 14, 1) = '-' AND substr(NEW."claim_id", 19, 1) = '-' AND substr(NEW."claim_id", 24, 1) = '-' AND length(replace(NEW."claim_id", '-', '')) = 32 AND replace(NEW."claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."claim_expires_at" IS NOT NULL AND NOT (typeof(NEW."claim_expires_at") = 'text' AND length(NEW."claim_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claim_expires_at") IS NEW."claim_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."completed_at" IS NOT NULL AND NOT (typeof(NEW."completed_at") = 'text' AND length(NEW."completed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."completed_at") IS NEW."completed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_data_key_rotation_types_update" BEFORE UPDATE ON "workspace_data_key_rotation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."from_data_key_id" IS NOT NULL AND NOT (length(NEW."from_data_key_id") = 36 AND substr(NEW."from_data_key_id", 9, 1) = '-' AND substr(NEW."from_data_key_id", 14, 1) = '-' AND substr(NEW."from_data_key_id", 19, 1) = '-' AND substr(NEW."from_data_key_id", 24, 1) = '-' AND length(replace(NEW."from_data_key_id", '-', '')) = 32 AND replace(NEW."from_data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."to_data_key_id" IS NOT NULL AND NOT (length(NEW."to_data_key_id") = 36 AND substr(NEW."to_data_key_id", 9, 1) = '-' AND substr(NEW."to_data_key_id", 14, 1) = '-' AND substr(NEW."to_data_key_id", 19, 1) = '-' AND substr(NEW."to_data_key_id", 24, 1) = '-' AND length(replace(NEW."to_data_key_id", '-', '')) = 32 AND replace(NEW."to_data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."idempotency_key" IS NOT NULL AND NOT (length(NEW."idempotency_key") = 36 AND substr(NEW."idempotency_key", 9, 1) = '-' AND substr(NEW."idempotency_key", 14, 1) = '-' AND substr(NEW."idempotency_key", 19, 1) = '-' AND substr(NEW."idempotency_key", 24, 1) = '-' AND length(replace(NEW."idempotency_key", '-', '')) = 32 AND replace(NEW."idempotency_key", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."processed_backups" IS NOT NULL AND NOT (typeof(NEW."processed_backups") = 'integer' AND NEW."processed_backups" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."claim_id" IS NOT NULL AND NOT (length(NEW."claim_id") = 36 AND substr(NEW."claim_id", 9, 1) = '-' AND substr(NEW."claim_id", 14, 1) = '-' AND substr(NEW."claim_id", 19, 1) = '-' AND substr(NEW."claim_id", 24, 1) = '-' AND length(replace(NEW."claim_id", '-', '')) = 32 AND replace(NEW."claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."claim_expires_at" IS NOT NULL AND NOT (typeof(NEW."claim_expires_at") = 'text' AND length(NEW."claim_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claim_expires_at") IS NEW."claim_expires_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."completed_at" IS NOT NULL AND NOT (typeof(NEW."completed_at") = 'text' AND length(NEW."completed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."completed_at") IS NEW."completed_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_deletion_receipt_types_insert" BEFORE INSERT ON "workspace_deletion_receipt"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."requested_at" IS NOT NULL AND NOT (typeof(NEW."requested_at") = 'text' AND length(NEW."requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."requested_at") IS NEW."requested_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
  OR (NEW."cancelled_at" IS NOT NULL AND NOT (typeof(NEW."cancelled_at") = 'text' AND length(NEW."cancelled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cancelled_at") IS NEW."cancelled_at"))
  OR (NEW."purged_at" IS NOT NULL AND NOT (typeof(NEW."purged_at") = 'text' AND length(NEW."purged_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purged_at") IS NEW."purged_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_deletion_receipt_types_update" BEFORE UPDATE ON "workspace_deletion_receipt"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."requested_at" IS NOT NULL AND NOT (typeof(NEW."requested_at") = 'text' AND length(NEW."requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."requested_at") IS NEW."requested_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
  OR (NEW."cancelled_at" IS NOT NULL AND NOT (typeof(NEW."cancelled_at") = 'text' AND length(NEW."cancelled_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."cancelled_at") IS NEW."cancelled_at"))
  OR (NEW."purged_at" IS NOT NULL AND NOT (typeof(NEW."purged_at") = 'text' AND length(NEW."purged_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purged_at") IS NEW."purged_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_metadata_backup_types_insert" BEFORE INSERT ON "workspace_metadata_backup"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_revision" IS NOT NULL AND NOT (typeof(NEW."source_revision") = 'integer' AND NEW."source_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."data_key_id" IS NOT NULL AND NOT (length(NEW."data_key_id") = 36 AND substr(NEW."data_key_id", 9, 1) = '-' AND substr(NEW."data_key_id", 14, 1) = '-' AND substr(NEW."data_key_id", 19, 1) = '-' AND substr(NEW."data_key_id", 24, 1) = '-' AND length(replace(NEW."data_key_id", '-', '')) = 32 AND replace(NEW."data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."reencrypted_at" IS NOT NULL AND NOT (typeof(NEW."reencrypted_at") = 'text' AND length(NEW."reencrypted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."reencrypted_at") IS NEW."reencrypted_at"))
  OR (NEW."reencrypted_by_rotation_id" IS NOT NULL AND NOT (length(NEW."reencrypted_by_rotation_id") = 36 AND substr(NEW."reencrypted_by_rotation_id", 9, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 14, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 19, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 24, 1) = '-' AND length(replace(NEW."reencrypted_by_rotation_id", '-', '')) = 32 AND replace(NEW."reencrypted_by_rotation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_metadata_backup_types_update" BEFORE UPDATE ON "workspace_metadata_backup"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."source_revision" IS NOT NULL AND NOT (typeof(NEW."source_revision") = 'integer' AND NEW."source_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."data_key_id" IS NOT NULL AND NOT (length(NEW."data_key_id") = 36 AND substr(NEW."data_key_id", 9, 1) = '-' AND substr(NEW."data_key_id", 14, 1) = '-' AND substr(NEW."data_key_id", 19, 1) = '-' AND substr(NEW."data_key_id", 24, 1) = '-' AND length(replace(NEW."data_key_id", '-', '')) = 32 AND replace(NEW."data_key_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."reencrypted_at" IS NOT NULL AND NOT (typeof(NEW."reencrypted_at") = 'text' AND length(NEW."reencrypted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."reencrypted_at") IS NEW."reencrypted_at"))
  OR (NEW."reencrypted_by_rotation_id" IS NOT NULL AND NOT (length(NEW."reencrypted_by_rotation_id") = 36 AND substr(NEW."reencrypted_by_rotation_id", 9, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 14, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 19, 1) = '-' AND substr(NEW."reencrypted_by_rotation_id", 24, 1) = '-' AND length(replace(NEW."reencrypted_by_rotation_id", '-', '')) = 32 AND replace(NEW."reencrypted_by_rotation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."deleted_at" IS NOT NULL AND NOT (typeof(NEW."deleted_at") = 'text' AND length(NEW."deleted_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deleted_at") IS NEW."deleted_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_profile_types_insert" BEFORE INSERT ON "workspace_profile"
WHEN (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."deletion_receipt_id" IS NOT NULL AND NOT (length(NEW."deletion_receipt_id") = 36 AND substr(NEW."deletion_receipt_id", 9, 1) = '-' AND substr(NEW."deletion_receipt_id", 14, 1) = '-' AND substr(NEW."deletion_receipt_id", 19, 1) = '-' AND substr(NEW."deletion_receipt_id", 24, 1) = '-' AND length(replace(NEW."deletion_receipt_id", '-', '')) = 32 AND replace(NEW."deletion_receipt_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."deletion_requested_at" IS NOT NULL AND NOT (typeof(NEW."deletion_requested_at") = 'text' AND length(NEW."deletion_requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deletion_requested_at") IS NEW."deletion_requested_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_profile_types_update" BEFORE UPDATE ON "workspace_profile"
WHEN (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."deletion_receipt_id" IS NOT NULL AND NOT (length(NEW."deletion_receipt_id") = 36 AND substr(NEW."deletion_receipt_id", 9, 1) = '-' AND substr(NEW."deletion_receipt_id", 14, 1) = '-' AND substr(NEW."deletion_receipt_id", 19, 1) = '-' AND substr(NEW."deletion_receipt_id", 24, 1) = '-' AND length(replace(NEW."deletion_receipt_id", '-', '')) = 32 AND replace(NEW."deletion_receipt_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."deletion_requested_at" IS NOT NULL AND NOT (typeof(NEW."deletion_requested_at") = 'text' AND length(NEW."deletion_requested_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."deletion_requested_at") IS NEW."deletion_requested_at"))
  OR (NEW."purge_after" IS NOT NULL AND NOT (typeof(NEW."purge_after") = 'text' AND length(NEW."purge_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."purge_after") IS NEW."purge_after"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_discovery_receipt_types_insert" BEFORE INSERT ON "workspace_provider_discovery_receipt"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_generation" IS NOT NULL AND NOT (typeof(NEW."integration_generation") = 'integer' AND NEW."integration_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_discovery_receipt_types_update" BEFORE UPDATE ON "workspace_provider_discovery_receipt"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_generation" IS NOT NULL AND NOT (typeof(NEW."integration_generation") = 'integer' AND NEW."integration_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."expires_at" IS NOT NULL AND NOT (typeof(NEW."expires_at") = 'text' AND length(NEW."expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."expires_at") IS NEW."expires_at"))
  OR (NEW."consumed_at" IS NOT NULL AND NOT (typeof(NEW."consumed_at") = 'text' AND length(NEW."consumed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."consumed_at") IS NEW."consumed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_import_request_types_insert" BEFORE INSERT ON "workspace_provider_import_request"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."production_approved" IS NOT NULL AND NOT (typeof(NEW."production_approved") = 'integer' AND NEW."production_approved" IN (0, 1)))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_import_request_types_update" BEFORE UPDATE ON "workspace_provider_import_request"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."production_approved" IS NOT NULL AND NOT (typeof(NEW."production_approved") = 'integer' AND NEW."production_approved" IN (0, 1)))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."connection_id" IS NOT NULL AND NOT (length(NEW."connection_id") = 36 AND substr(NEW."connection_id", 9, 1) = '-' AND substr(NEW."connection_id", 14, 1) = '-' AND substr(NEW."connection_id", 19, 1) = '-' AND substr(NEW."connection_id", 24, 1) = '-' AND length(replace(NEW."connection_id", '-', '')) = 32 AND replace(NEW."connection_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_integration_types_insert" BEFORE INSERT ON "workspace_provider_integration"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."credential_expires_at" IS NOT NULL AND NOT (typeof(NEW."credential_expires_at") = 'text' AND length(NEW."credential_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."credential_expires_at") IS NEW."credential_expires_at"))
  OR (NEW."local_verification_target" IS NOT NULL AND NOT (typeof(NEW."local_verification_target") = 'text' AND json_valid(NEW."local_verification_target")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."generation" IS NOT NULL AND NOT (typeof(NEW."generation") = 'integer' AND NEW."generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."refresh_claimed_at" IS NOT NULL AND NOT (typeof(NEW."refresh_claimed_at") = 'text' AND length(NEW."refresh_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_claimed_at") IS NEW."refresh_claimed_at"))
  OR (NEW."refresh_claim_id" IS NOT NULL AND NOT (length(NEW."refresh_claim_id") = 36 AND substr(NEW."refresh_claim_id", 9, 1) = '-' AND substr(NEW."refresh_claim_id", 14, 1) = '-' AND substr(NEW."refresh_claim_id", 19, 1) = '-' AND substr(NEW."refresh_claim_id", 24, 1) = '-' AND length(replace(NEW."refresh_claim_id", '-', '')) = 32 AND replace(NEW."refresh_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."refresh_generation" IS NOT NULL AND NOT (typeof(NEW."refresh_generation") = 'integer' AND NEW."refresh_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."refresh_remote_started_at" IS NOT NULL AND NOT (typeof(NEW."refresh_remote_started_at") = 'text' AND length(NEW."refresh_remote_started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_remote_started_at") IS NEW."refresh_remote_started_at"))
  OR (NEW."disconnect_generation" IS NOT NULL AND NOT (typeof(NEW."disconnect_generation") = 'integer' AND NEW."disconnect_generation" BETWEEN -9007199254740991 AND 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_integration_types_update" BEFORE UPDATE ON "workspace_provider_integration"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."credential_expires_at" IS NOT NULL AND NOT (typeof(NEW."credential_expires_at") = 'text' AND length(NEW."credential_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."credential_expires_at") IS NEW."credential_expires_at"))
  OR (NEW."local_verification_target" IS NOT NULL AND NOT (typeof(NEW."local_verification_target") = 'text' AND json_valid(NEW."local_verification_target")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."generation" IS NOT NULL AND NOT (typeof(NEW."generation") = 'integer' AND NEW."generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
  OR (NEW."revoked_at" IS NOT NULL AND NOT (typeof(NEW."revoked_at") = 'text' AND length(NEW."revoked_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revoked_at") IS NEW."revoked_at"))
  OR (NEW."revocation_pending_at" IS NOT NULL AND NOT (typeof(NEW."revocation_pending_at") = 'text' AND length(NEW."revocation_pending_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_pending_at") IS NEW."revocation_pending_at"))
  OR (NEW."revocation_claimed_at" IS NOT NULL AND NOT (typeof(NEW."revocation_claimed_at") = 'text' AND length(NEW."revocation_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."revocation_claimed_at") IS NEW."revocation_claimed_at"))
  OR (NEW."revocation_claim_id" IS NOT NULL AND NOT (length(NEW."revocation_claim_id") = 36 AND substr(NEW."revocation_claim_id", 9, 1) = '-' AND substr(NEW."revocation_claim_id", 14, 1) = '-' AND substr(NEW."revocation_claim_id", 19, 1) = '-' AND substr(NEW."revocation_claim_id", 24, 1) = '-' AND length(replace(NEW."revocation_claim_id", '-', '')) = 32 AND replace(NEW."revocation_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."refresh_claimed_at" IS NOT NULL AND NOT (typeof(NEW."refresh_claimed_at") = 'text' AND length(NEW."refresh_claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_claimed_at") IS NEW."refresh_claimed_at"))
  OR (NEW."refresh_claim_id" IS NOT NULL AND NOT (length(NEW."refresh_claim_id") = 36 AND substr(NEW."refresh_claim_id", 9, 1) = '-' AND substr(NEW."refresh_claim_id", 14, 1) = '-' AND substr(NEW."refresh_claim_id", 19, 1) = '-' AND substr(NEW."refresh_claim_id", 24, 1) = '-' AND length(replace(NEW."refresh_claim_id", '-', '')) = 32 AND replace(NEW."refresh_claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."refresh_generation" IS NOT NULL AND NOT (typeof(NEW."refresh_generation") = 'integer' AND NEW."refresh_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."refresh_remote_started_at" IS NOT NULL AND NOT (typeof(NEW."refresh_remote_started_at") = 'text' AND length(NEW."refresh_remote_started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."refresh_remote_started_at") IS NEW."refresh_remote_started_at"))
  OR (NEW."disconnect_generation" IS NOT NULL AND NOT (typeof(NEW."disconnect_generation") = 'integer' AND NEW."disconnect_generation" BETWEEN -9007199254740991 AND 9007199254740991))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_operation_types_insert" BEFORE INSERT ON "workspace_provider_operation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_generation" IS NOT NULL AND NOT (typeof(NEW."integration_generation") = 'integer' AND NEW."integration_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."idempotency_key" IS NOT NULL AND NOT (length(NEW."idempotency_key") = 36 AND substr(NEW."idempotency_key", 9, 1) = '-' AND substr(NEW."idempotency_key", 14, 1) = '-' AND substr(NEW."idempotency_key", 19, 1) = '-' AND substr(NEW."idempotency_key", 24, 1) = '-' AND length(replace(NEW."idempotency_key", '-', '')) = 32 AND replace(NEW."idempotency_key", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."plan_version" IS NOT NULL AND NOT (typeof(NEW."plan_version") = 'integer' AND NEW."plan_version" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."plan_expires_at" IS NOT NULL AND NOT (typeof(NEW."plan_expires_at") = 'text' AND length(NEW."plan_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."plan_expires_at") IS NEW."plan_expires_at"))
  OR (NEW."redacted_plan" IS NOT NULL AND NOT (typeof(NEW."redacted_plan") = 'text' AND json_valid(NEW."redacted_plan")))
  OR (NEW."redacted_result" IS NOT NULL AND NOT (typeof(NEW."redacted_result") = 'text' AND json_valid(NEW."redacted_result")))
  OR (NEW."claim_id" IS NOT NULL AND NOT (length(NEW."claim_id") = 36 AND substr(NEW."claim_id", 9, 1) = '-' AND substr(NEW."claim_id", 14, 1) = '-' AND substr(NEW."claim_id", 19, 1) = '-' AND substr(NEW."claim_id", 24, 1) = '-' AND length(replace(NEW."claim_id", '-', '')) = 32 AND replace(NEW."claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."claimed_at" IS NOT NULL AND NOT (typeof(NEW."claimed_at") = 'text' AND length(NEW."claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claimed_at") IS NEW."claimed_at"))
  OR (NEW."remote_started_at" IS NOT NULL AND NOT (typeof(NEW."remote_started_at") = 'text' AND length(NEW."remote_started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."remote_started_at") IS NEW."remote_started_at"))
  OR (NEW."reconcile_after" IS NOT NULL AND NOT (typeof(NEW."reconcile_after") = 'text' AND length(NEW."reconcile_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."reconcile_after") IS NEW."reconcile_after"))
  OR (NEW."completed_at" IS NOT NULL AND NOT (typeof(NEW."completed_at") = 'text' AND length(NEW."completed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."completed_at") IS NEW."completed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_operation_types_update" BEFORE UPDATE ON "workspace_provider_operation"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."integration_generation" IS NOT NULL AND NOT (typeof(NEW."integration_generation") = 'integer' AND NEW."integration_generation" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."idempotency_key" IS NOT NULL AND NOT (length(NEW."idempotency_key") = 36 AND substr(NEW."idempotency_key", 9, 1) = '-' AND substr(NEW."idempotency_key", 14, 1) = '-' AND substr(NEW."idempotency_key", 19, 1) = '-' AND substr(NEW."idempotency_key", 24, 1) = '-' AND length(replace(NEW."idempotency_key", '-', '')) = 32 AND replace(NEW."idempotency_key", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."plan_version" IS NOT NULL AND NOT (typeof(NEW."plan_version") = 'integer' AND NEW."plan_version" BETWEEN -2147483648 AND 2147483647))
  OR (NEW."plan_expires_at" IS NOT NULL AND NOT (typeof(NEW."plan_expires_at") = 'text' AND length(NEW."plan_expires_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."plan_expires_at") IS NEW."plan_expires_at"))
  OR (NEW."redacted_plan" IS NOT NULL AND NOT (typeof(NEW."redacted_plan") = 'text' AND json_valid(NEW."redacted_plan")))
  OR (NEW."redacted_result" IS NOT NULL AND NOT (typeof(NEW."redacted_result") = 'text' AND json_valid(NEW."redacted_result")))
  OR (NEW."claim_id" IS NOT NULL AND NOT (length(NEW."claim_id") = 36 AND substr(NEW."claim_id", 9, 1) = '-' AND substr(NEW."claim_id", 14, 1) = '-' AND substr(NEW."claim_id", 19, 1) = '-' AND substr(NEW."claim_id", 24, 1) = '-' AND length(replace(NEW."claim_id", '-', '')) = 32 AND replace(NEW."claim_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."claimed_at" IS NOT NULL AND NOT (typeof(NEW."claimed_at") = 'text' AND length(NEW."claimed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."claimed_at") IS NEW."claimed_at"))
  OR (NEW."remote_started_at" IS NOT NULL AND NOT (typeof(NEW."remote_started_at") = 'text' AND length(NEW."remote_started_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."remote_started_at") IS NEW."remote_started_at"))
  OR (NEW."reconcile_after" IS NOT NULL AND NOT (typeof(NEW."reconcile_after") = 'text' AND length(NEW."reconcile_after") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."reconcile_after") IS NEW."reconcile_after"))
  OR (NEW."completed_at" IS NOT NULL AND NOT (typeof(NEW."completed_at") = 'text' AND length(NEW."completed_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."completed_at") IS NEW."completed_at"))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_operation_approval_types_insert" BEFORE INSERT ON "workspace_provider_operation_approval"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."operation_id" IS NOT NULL AND NOT (length(NEW."operation_id") = 36 AND substr(NEW."operation_id", 9, 1) = '-' AND substr(NEW."operation_id", 14, 1) = '-' AND substr(NEW."operation_id", 19, 1) = '-' AND substr(NEW."operation_id", 24, 1) = '-' AND length(replace(NEW."operation_id", '-', '')) = 32 AND replace(NEW."operation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_operation_approval_types_update" BEFORE UPDATE ON "workspace_provider_operation_approval"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."operation_id" IS NOT NULL AND NOT (length(NEW."operation_id") = 36 AND substr(NEW."operation_id", 9, 1) = '-' AND substr(NEW."operation_id", 14, 1) = '-' AND substr(NEW."operation_id", 19, 1) = '-' AND substr(NEW."operation_id", 24, 1) = '-' AND length(replace(NEW."operation_id", '-', '')) = 32 AND replace(NEW."operation_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_principal_claim_types_insert" BEFORE INSERT ON "workspace_provider_principal_claim"
WHEN (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_principal_claim_types_update" BEFORE UPDATE ON "workspace_provider_principal_claim"
WHEN (NEW."integration_id" IS NOT NULL AND NOT (length(NEW."integration_id") = 36 AND substr(NEW."integration_id", 9, 1) = '-' AND substr(NEW."integration_id", 14, 1) = '-' AND substr(NEW."integration_id", 19, 1) = '-' AND substr(NEW."integration_id", 24, 1) = '-' AND length(replace(NEW."integration_id", '-', '')) = 32 AND replace(NEW."integration_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_resource_types_insert" BEFORE INSERT ON "workspace_provider_resource"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource" IS NOT NULL AND NOT (typeof(NEW."resource") = 'text' AND json_valid(NEW."resource")))
  OR (NEW."redacted_metadata" IS NOT NULL AND NOT (typeof(NEW."redacted_metadata") = 'text' AND json_valid(NEW."redacted_metadata")))
  OR (NEW."capability_manifest" IS NOT NULL AND NOT (typeof(NEW."capability_manifest") = 'text' AND json_valid(NEW."capability_manifest")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_provider_resource_types_update" BEFORE UPDATE ON "workspace_provider_resource"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource" IS NOT NULL AND NOT (typeof(NEW."resource") = 'text' AND json_valid(NEW."resource")))
  OR (NEW."redacted_metadata" IS NOT NULL AND NOT (typeof(NEW."redacted_metadata") = 'text' AND json_valid(NEW."redacted_metadata")))
  OR (NEW."capability_manifest" IS NOT NULL AND NOT (typeof(NEW."capability_manifest") = 'text' AND json_valid(NEW."capability_manifest")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_conflict_types_insert" BEFORE INSERT ON "workspace_resource_conflict"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expected_revision" IS NOT NULL AND NOT (typeof(NEW."expected_revision") = 'integer' AND NEW."expected_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."server_version_id" IS NOT NULL AND NOT (length(NEW."server_version_id") = 36 AND substr(NEW."server_version_id", 9, 1) = '-' AND substr(NEW."server_version_id", 14, 1) = '-' AND substr(NEW."server_version_id", 19, 1) = '-' AND substr(NEW."server_version_id", 24, 1) = '-' AND length(replace(NEW."server_version_id", '-', '')) = 32 AND replace(NEW."server_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."candidate_version_id" IS NOT NULL AND NOT (length(NEW."candidate_version_id") = 36 AND substr(NEW."candidate_version_id", 9, 1) = '-' AND substr(NEW."candidate_version_id", 14, 1) = '-' AND substr(NEW."candidate_version_id", 19, 1) = '-' AND substr(NEW."candidate_version_id", 24, 1) = '-' AND length(replace(NEW."candidate_version_id", '-', '')) = 32 AND replace(NEW."candidate_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_conflict_types_update" BEFORE UPDATE ON "workspace_resource_conflict"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."expected_revision" IS NOT NULL AND NOT (typeof(NEW."expected_revision") = 'integer' AND NEW."expected_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."server_version_id" IS NOT NULL AND NOT (length(NEW."server_version_id") = 36 AND substr(NEW."server_version_id", 9, 1) = '-' AND substr(NEW."server_version_id", 14, 1) = '-' AND substr(NEW."server_version_id", 19, 1) = '-' AND substr(NEW."server_version_id", 24, 1) = '-' AND length(replace(NEW."server_version_id", '-', '')) = 32 AND replace(NEW."server_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."candidate_version_id" IS NOT NULL AND NOT (length(NEW."candidate_version_id") = 36 AND substr(NEW."candidate_version_id", 9, 1) = '-' AND substr(NEW."candidate_version_id", 14, 1) = '-' AND substr(NEW."candidate_version_id", 19, 1) = '-' AND substr(NEW."candidate_version_id", 24, 1) = '-' AND length(replace(NEW."candidate_version_id", '-', '')) = 32 AND replace(NEW."candidate_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_conflict_resolution_types_insert" BEFORE INSERT ON "workspace_resource_conflict_resolution"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."conflict_id" IS NOT NULL AND NOT (length(NEW."conflict_id") = 36 AND substr(NEW."conflict_id", 9, 1) = '-' AND substr(NEW."conflict_id", 14, 1) = '-' AND substr(NEW."conflict_id", 19, 1) = '-' AND substr(NEW."conflict_id", 24, 1) = '-' AND length(replace(NEW."conflict_id", '-', '')) = 32 AND replace(NEW."conflict_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resulting_version_id" IS NOT NULL AND NOT (length(NEW."resulting_version_id") = 36 AND substr(NEW."resulting_version_id", 9, 1) = '-' AND substr(NEW."resulting_version_id", 14, 1) = '-' AND substr(NEW."resulting_version_id", 19, 1) = '-' AND substr(NEW."resulting_version_id", 24, 1) = '-' AND length(replace(NEW."resulting_version_id", '-', '')) = 32 AND replace(NEW."resulting_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_conflict_resolution_types_update" BEFORE UPDATE ON "workspace_resource_conflict_resolution"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."conflict_id" IS NOT NULL AND NOT (length(NEW."conflict_id") = 36 AND substr(NEW."conflict_id", 9, 1) = '-' AND substr(NEW."conflict_id", 14, 1) = '-' AND substr(NEW."conflict_id", 19, 1) = '-' AND substr(NEW."conflict_id", 24, 1) = '-' AND length(replace(NEW."conflict_id", '-', '')) = 32 AND replace(NEW."conflict_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resulting_version_id" IS NOT NULL AND NOT (length(NEW."resulting_version_id") = 36 AND substr(NEW."resulting_version_id", 9, 1) = '-' AND substr(NEW."resulting_version_id", 14, 1) = '-' AND substr(NEW."resulting_version_id", 19, 1) = '-' AND substr(NEW."resulting_version_id", 24, 1) = '-' AND length(replace(NEW."resulting_version_id", '-', '')) = 32 AND replace(NEW."resulting_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_version_types_insert" BEFORE INSERT ON "workspace_resource_version"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."base_revision" IS NOT NULL AND NOT (typeof(NEW."base_revision") = 'integer' AND NEW."base_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."parent_version_id" IS NOT NULL AND NOT (length(NEW."parent_version_id") = 36 AND substr(NEW."parent_version_id", 9, 1) = '-' AND substr(NEW."parent_version_id", 14, 1) = '-' AND substr(NEW."parent_version_id", 19, 1) = '-' AND substr(NEW."parent_version_id", 24, 1) = '-' AND length(replace(NEW."parent_version_id", '-', '')) = 32 AND replace(NEW."parent_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_resource_version_types_update" BEFORE UPDATE ON "workspace_resource_version"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."resource_id" IS NOT NULL AND NOT (length(NEW."resource_id") = 36 AND substr(NEW."resource_id", 9, 1) = '-' AND substr(NEW."resource_id", 14, 1) = '-' AND substr(NEW."resource_id", 19, 1) = '-' AND substr(NEW."resource_id", 24, 1) = '-' AND length(replace(NEW."resource_id", '-', '')) = 32 AND replace(NEW."resource_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."revision" IS NOT NULL AND NOT (typeof(NEW."revision") = 'integer' AND NEW."revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."base_revision" IS NOT NULL AND NOT (typeof(NEW."base_revision") = 'integer' AND NEW."base_revision" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."parent_version_id" IS NOT NULL AND NOT (length(NEW."parent_version_id") = 36 AND substr(NEW."parent_version_id", 9, 1) = '-' AND substr(NEW."parent_version_id", 14, 1) = '-' AND substr(NEW."parent_version_id", 19, 1) = '-' AND substr(NEW."parent_version_id", 24, 1) = '-' AND length(replace(NEW."parent_version_id", '-', '')) = 32 AND replace(NEW."parent_version_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."payload" IS NOT NULL AND NOT (typeof(NEW."payload") = 'text' AND json_valid(NEW."payload")))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_sync_event_types_insert" BEFORE INSERT ON "workspace_sync_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."sequence" IS NOT NULL AND NOT (typeof(NEW."sequence") = 'integer' AND NEW."sequence" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."audit_event_id" IS NOT NULL AND NOT (length(NEW."audit_event_id") = 36 AND substr(NEW."audit_event_id", 9, 1) = '-' AND substr(NEW."audit_event_id", 14, 1) = '-' AND substr(NEW."audit_event_id", 19, 1) = '-' AND substr(NEW."audit_event_id", 24, 1) = '-' AND length(replace(NEW."audit_event_id", '-', '')) = 32 AND replace(NEW."audit_event_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."tombstone" IS NOT NULL AND NOT (typeof(NEW."tombstone") = 'integer' AND NEW."tombstone" IN (0, 1)))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_sync_event_types_update" BEFORE UPDATE ON "workspace_sync_event"
WHEN (NEW."id" IS NOT NULL AND NOT (length(NEW."id") = 36 AND substr(NEW."id", 9, 1) = '-' AND substr(NEW."id", 14, 1) = '-' AND substr(NEW."id", 19, 1) = '-' AND substr(NEW."id", 24, 1) = '-' AND length(replace(NEW."id", '-', '')) = 32 AND replace(NEW."id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."sequence" IS NOT NULL AND NOT (typeof(NEW."sequence") = 'integer' AND NEW."sequence" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."audit_event_id" IS NOT NULL AND NOT (length(NEW."audit_event_id") = 36 AND substr(NEW."audit_event_id", 9, 1) = '-' AND substr(NEW."audit_event_id", 14, 1) = '-' AND substr(NEW."audit_event_id", 19, 1) = '-' AND substr(NEW."audit_event_id", 24, 1) = '-' AND length(replace(NEW."audit_event_id", '-', '')) = 32 AND replace(NEW."audit_event_id", '-', '') NOT GLOB '*[^0-9a-f]*'))
  OR (NEW."tombstone" IS NOT NULL AND NOT (typeof(NEW."tombstone") = 'integer' AND NEW."tombstone" IN (0, 1)))
  OR (NEW."created_at" IS NOT NULL AND NOT (typeof(NEW."created_at") = 'text' AND length(NEW."created_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."created_at") IS NEW."created_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_sync_head_types_insert" BEFORE INSERT ON "workspace_sync_head"
WHEN (NEW."last_sequence" IS NOT NULL AND NOT (typeof(NEW."last_sequence") = 'integer' AND NEW."last_sequence" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;

CREATE TRIGGER "workspace_sync_head_types_update" BEFORE UPDATE ON "workspace_sync_head"
WHEN (NEW."last_sequence" IS NOT NULL AND NOT (typeof(NEW."last_sequence") = 'integer' AND NEW."last_sequence" BETWEEN -9007199254740991 AND 9007199254740991))
  OR (NEW."updated_at" IS NOT NULL AND NOT (typeof(NEW."updated_at") = 'text' AND length(NEW."updated_at") = 24 AND strftime('%Y-%m-%dT%H:%M:%fZ', NEW."updated_at") IS NEW."updated_at"))
BEGIN SELECT RAISE(ABORT, 'invalid Workspace storage type'); END;
