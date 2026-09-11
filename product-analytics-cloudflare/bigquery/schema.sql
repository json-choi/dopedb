CREATE SCHEMA `dopedb-503203.product_analytics`
OPTIONS(location = 'EU', default_partition_expiration_days = 30,
        max_time_travel_hours = 48,
        description = 'DopeDB opt-in Desktop product events');

CREATE TABLE `dopedb-503203.product_analytics.events_raw` (
  event_id STRING NOT NULL, name STRING NOT NULL,
  occurred_at TIMESTAMP NOT NULL, occurred_at_ms INT64 NOT NULL,
  received_at TIMESTAMP NOT NULL, received_at_ms INT64 NOT NULL,
  installation_id STRING NOT NULL, session_id STRING NOT NULL,
  app_version STRING NOT NULL, platform STRING NOT NULL, locale STRING NOT NULL,
  actor_key STRING, workspace_key STRING, workspace_kind STRING,
  properties_json STRING NOT NULL
)
PARTITION BY DATE(received_at)
CLUSTER BY event_id, name
OPTIONS(partition_expiration_days = 30, require_partition_filter = true);

-- insertId is best effort. All operator queries use this view so response-loss
-- retries count once, even when repeated outside Google's deduplication window.
CREATE VIEW `dopedb-503203.product_analytics.events` AS
SELECT * FROM `dopedb-503203.product_analytics.events_raw`
WHERE received_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY received_at) = 1;
