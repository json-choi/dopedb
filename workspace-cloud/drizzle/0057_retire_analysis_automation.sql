-- Retire every previously issued Analysis automation authority. Historical
-- rows remain available for audit and a controlled data migration, but no
-- schedule, signal, or hosted-result producer remains active.
UPDATE "workspace_control"."workspace_analysis_runner"
SET "background_allowed" = FALSE
WHERE "background_allowed" = TRUE;--> statement-breakpoint

UPDATE "workspace_control"."workspace_analysis_article"
SET "state" = 'live',
    "live_revision" = "revision",
    "live_run_id" = NULL,
    "next_refresh_at" = NULL
WHERE "deleted_at" IS NULL
  AND (
    "state" <> 'live'
    OR "live_revision" IS DISTINCT FROM "revision"
    OR "live_run_id" IS NOT NULL
    OR "next_refresh_at" IS NOT NULL
  );--> statement-breakpoint

UPDATE "workspace_control"."workspace_analysis_refresh_lease"
SET "revoked_at" = COALESCE("revoked_at", now())
WHERE "completed_at" IS NULL AND "revoked_at" IS NULL;--> statement-breakpoint

UPDATE "workspace_control"."workspace_analysis_article_run"
SET "state" = 'stale',
    "finished_at" = COALESCE("finished_at", now()),
    "error_kind" = COALESCE("error_kind", 'feature_retired'),
    "error_message" = COALESCE(
      "error_message",
      'Background Analysis execution was retired; run the saved query manually in Desktop.'
    )
WHERE "trigger" <> 'manual' AND "state" IN ('queued', 'running');--> statement-breakpoint

UPDATE "workspace_control"."workspace_analysis_signal"
SET "enabled" = FALSE,
    "deleted_at" = COALESCE("deleted_at", now()),
    "updated_at" = now()
WHERE "enabled" = TRUE OR "deleted_at" IS NULL;--> statement-breakpoint

UPDATE "workspace_control"."workspace_analysis_signal_notification"
SET "state" = 'failed',
    "claim_id" = NULL,
    "claimed_at" = NULL,
    "error_kind" = COALESCE("error_kind", 'feature_retired')
WHERE "state" = 'pending';
