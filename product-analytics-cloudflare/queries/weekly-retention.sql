WITH weekly_activity AS (
  SELECT
    FORMAT_TIMESTAMP('%G-%V', occurred_at) AS week,
    COUNT(DISTINCT installation_id) AS active_consenting_installations,
    COUNT(DISTINCT CASE
      WHEN name = 'query_execution_completed'
       AND JSON_VALUE(properties_json, '$.outcome') = 'success'
      THEN installation_id END) AS querying_installations,
    COUNT(DISTINCT CASE
      WHEN name = 'agent_turn_completed'
       AND JSON_VALUE(properties_json, '$.outcome') = 'success'
      THEN installation_id END) AS agent_installations
  FROM `dopedb-503203.product_analytics.events`
  WHERE app_version != '0.0.0-analytics-verification'
    AND occurred_at_ms >= UNIX_MILLIS(TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
  GROUP BY week
)
SELECT * FROM weekly_activity ORDER BY week DESC;
