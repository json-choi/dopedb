use std::collections::HashMap;

use chrono::Utc;
use uuid::Uuid;

use super::domain::{planning_guidance, validate_query_service_session_snapshot};
use crate::executor::namespace::{postgres_search_path_statement, resolve_sql_namespace};
use crate::model::{
    ConnectionProfile, Engine, Provider, WorkspaceConnectionAccess, WorkspaceCredentialMode,
};
use crate::monitoring::HealthSnapshot;

#[tokio::test]
async fn query_and_skill_security_contracts_stay_fail_closed() {
    crate::features::connections::assert_connection_test_failure_contract();
    let production = ConnectionProfile {
        id: Uuid::new_v4(),
        name: "query-feature-test".into(),
        engine: Engine::Sqlite,
        provider: Provider::Generic,
        driver_id: Some("sqlx-sqlite".into()),
        host: String::new(),
        port: 0,
        database: "test.db".into(),
        username: String::new(),
        sslmode: "disable".into(),
        extra_params: HashMap::new(),
        readonly_default: true,
        allow_writes: false,
        secret_ref: None,
        env: Some("prod".into()),
        schema_group: None,
        workspace_access: WorkspaceConnectionAccess::Local,
        credential_mode: WorkspaceCredentialMode::Local,
        provider_target: None,
    };
    let health = HealthSnapshot {
        level: "normal".into(),
        coverage: "limited".into(),
        total_connections: Some(1),
        max_connections: Some(100),
        connection_usage_percent: Some(1.0),
        active_queries: Some(1),
        long_running_queries: Some(0),
        lock_waits: Some(0),
        replication_lag_seconds: None,
        reasons: vec!["Monitoring coverage is limited without pg_monitor.".into()],
        captured_at: Utc::now(),
    };
    let (decision, notices, suggestions) =
        planning_guidance(&production, &health, Some(100_001), 50_000);

    assert_eq!(decision, "caution");
    assert!(notices
        .iter()
        .any(|notice| notice == "This connection is labeled production."));
    assert!(notices
        .iter()
        .any(|notice| notice.contains("EXPLAIN estimates 100001")));
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.contains("pg_monitor")));
    assert!(suggestions.windows(2).all(|pair| pair[0] <= pair[1]));

    let mut postgres = production.clone();
    postgres.engine = Engine::Postgres;
    postgres.database = "app".into();
    let adversarial = "tenant\"; DROP SCHEMA public; --";
    assert_eq!(
        resolve_sql_namespace(&postgres, None, Some(adversarial.into())).unwrap(),
        Some(adversarial.into()),
    );
    assert_eq!(
        postgres_search_path_statement(adversarial),
        "SET LOCAL search_path TO \"tenant\"\"; DROP SCHEMA public; --\"",
    );
    assert!(resolve_sql_namespace(&production, None, Some("attached".into())).is_err());

    let connection_id = Uuid::new_v4();
    let services_snapshot = serde_json::json!({
        "schemaVersion": 2,
        "id": "document-1:1",
        "documentId": "document-1",
        "connectionId": connection_id,
        "connectionName": "Fixture",
        "consoleTitle": "Query",
        "database": "app",
        "namespace": "public",
        "sql": "SELECT 1",
        "startedAt": "2026-01-01T00:00:00Z",
        "startedLabel": "00:00:00",
        "updatedAt": 1,
        "status": "completed",
        "result": {"kind": "materialized"}
    });
    let validated = validate_query_service_session_snapshot(services_snapshot.clone()).unwrap();
    assert_eq!(Uuid::from(validated.connection_id), connection_id);
    assert_eq!(validated.status.as_str(), "completed");
    let mut running_snapshot = services_snapshot;
    running_snapshot["status"] = serde_json::json!("running");
    assert!(validate_query_service_session_snapshot(running_snapshot).is_err());

    #[cfg(not(feature = "packaged-benchmark"))]
    crate::app_paths::assert_application_data_root_contract();
    crate::broker::assert_catalog_search_contract();
    crate::features::agents::acp::assert_editor_context_scope_contract();
    crate::features::agents::domain::assert_agent_event_wire_contract();
    crate::features::agents::assert_agent_cli_probe_contract();
    crate::cli_environment::assert_cli_environment_contract();
    crate::skills::assert_skill_installation_contract();
    crate::features::agents::runtime::assert_acp_plugin_runtime_contract();
    crate::features::knowledge::domain::assert_knowledge_domain_contract();
    crate::features::product_analytics::assert_product_analytics_contract();
    crate::features::product_analytics::transport::assert_product_analytics_response_contract();
    crate::hosted_control_plane::assert_shared_http_client_contract();
    crate::features::workspaces::adapters::control_plane::assert_hosted_workspace_response_bounds_contract();
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    crate::features::workspaces::adapters::desktop_login_callback::assert_workspace_login_callback_contract();
    crate::connection::keychain::assert_workspace_session_keychain_async_contract().await;
    crate::connection::assert_warm_cache_authorization_contract();
    crate::bigquery::assert_bigquery_contract();
    super::adapters::assert_ephemeral_page_contract();
}
