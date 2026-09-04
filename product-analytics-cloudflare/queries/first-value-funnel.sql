WITH installation_steps AS (
  SELECT
    installation_id,
    MAX(name = 'desktop_installation_ready') AS installed,
    MAX(name = 'workspace_authentication_completed'
        AND json_extract(properties_json, '$.outcome') = 'success') AS authenticated,
    MAX(name = 'workspace_scope_ready') AS scope_ready,
    MAX(name = 'query_execution_completed'
        AND json_extract(properties_json, '$.outcome') = 'success') AS first_value
  FROM product_analytics_event
  WHERE occurred_at_ms >= unixepoch('now', '-30 days') * 1000
  GROUP BY installation_id
)
SELECT
  COUNT(*) AS consenting_installations,
  SUM(installed) AS installation_ready,
  SUM(authenticated) AS authenticated,
  SUM(scope_ready) AS workspace_ready,
  SUM(first_value) AS successful_query
FROM installation_steps;
