WITH weekly_activity AS (
  SELECT
    strftime('%Y-%W', occurred_at) AS week,
    COUNT(DISTINCT installation_id) AS active_consenting_installations,
    COUNT(DISTINCT CASE
      WHEN name = 'query_execution_completed'
       AND json_extract(properties_json, '$.outcome') = 'success'
      THEN installation_id END) AS querying_installations,
    COUNT(DISTINCT CASE
      WHEN name = 'agent_turn_completed'
       AND json_extract(properties_json, '$.outcome') = 'success'
      THEN installation_id END) AS agent_installations
  FROM product_analytics_event
  WHERE occurred_at_ms >= unixepoch('now', '-30 days') * 1000
  GROUP BY week
)
SELECT * FROM weekly_activity ORDER BY week DESC;
