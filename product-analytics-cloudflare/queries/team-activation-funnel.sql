WITH workspace_steps AS (
  SELECT
    workspace_key,
    MAX(name = 'workspace_scope_ready') AS scope_ready,
    MAX(name = 'workspace_membership_ready') AS membership_ready,
    MAX(name = 'knowledge_environment_created') AS environment_created,
    MAX(name = 'environment_connection_bound') AS connection_bound,
    MAX(name = 'query_execution_completed'
        AND json_extract(properties_json, '$.outcome') = 'success') AS successful_query,
    MAX(name = 'agent_turn_completed'
        AND json_extract(properties_json, '$.outcome') = 'success') AS successful_agent_turn
  FROM product_analytics_event
  WHERE workspace_kind = 'team'
    AND workspace_key IS NOT NULL
    AND occurred_at_ms >= unixepoch('now', '-30 days') * 1000
  GROUP BY workspace_key
)
SELECT
  COUNT(*) AS consenting_team_workspaces,
  SUM(scope_ready) AS scope_ready,
  SUM(membership_ready) AS membership_ready,
  SUM(environment_created) AS environment_created,
  SUM(connection_bound) AS connection_bound,
  SUM(successful_query) AS successful_query,
  SUM(successful_agent_turn) AS successful_agent_turn
FROM workspace_steps;
