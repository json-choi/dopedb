WITH installation_steps AS (
  SELECT
    installation_id,
    LOGICAL_OR(name = 'desktop_installation_ready') AS installed,
    LOGICAL_OR(name = 'workspace_authentication_completed'
        AND JSON_VALUE(properties_json, '$.outcome') = 'success') AS authenticated,
    LOGICAL_OR(name = 'workspace_scope_ready') AS scope_ready,
    LOGICAL_OR(name = 'query_execution_completed'
        AND JSON_VALUE(properties_json, '$.outcome') = 'success') AS first_value
  FROM `dopedb-503203.product_analytics.events`
  WHERE app_version != '0.0.0-analytics-verification'
    AND occurred_at_ms >= UNIX_MILLIS(TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
  GROUP BY installation_id
)
SELECT
  COUNT(*) AS consenting_installations,
  COUNTIF(installed) AS installation_ready,
  COUNTIF(authenticated) AS authenticated,
  COUNTIF(scope_ready) AS workspace_ready,
  COUNTIF(first_value) AS successful_query
FROM installation_steps;
