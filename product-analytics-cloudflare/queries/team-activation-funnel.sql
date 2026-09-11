WITH workspace_steps AS (
  SELECT
    workspace_key,
    LOGICAL_OR(name = 'workspace_scope_ready') AS scope_ready,
    LOGICAL_OR(name = 'workspace_membership_ready') AS membership_ready,
    LOGICAL_OR(name = 'knowledge_environment_created') AS environment_created,
    LOGICAL_OR(name = 'environment_connection_bound') AS connection_bound,
    LOGICAL_OR(name = 'query_execution_completed'
        AND JSON_VALUE(properties_json, '$.outcome') = 'success') AS successful_query,
    LOGICAL_OR(name = 'agent_turn_completed'
        AND JSON_VALUE(properties_json, '$.outcome') = 'success') AS successful_agent_turn
  FROM `dopedb-503203.product_analytics.events`
  WHERE app_version != '0.0.0-analytics-verification'
    AND workspace_kind = 'team'
    AND workspace_key IS NOT NULL
    AND occurred_at_ms >= UNIX_MILLIS(TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY))
  GROUP BY workspace_key
)
SELECT
  COUNT(*) AS consenting_team_workspaces,
  COUNTIF(scope_ready) AS scope_ready,
  COUNTIF(membership_ready) AS membership_ready,
  COUNTIF(environment_created) AS environment_created,
  COUNTIF(connection_bound) AS connection_bound,
  COUNTIF(successful_query) AS successful_query,
  COUNTIF(successful_agent_turn) AS successful_agent_turn
FROM workspace_steps;
