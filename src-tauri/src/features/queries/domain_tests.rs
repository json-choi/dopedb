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
    crate::features::diagnostics::assert_local_diagnostics_contract();
    crate::features::connections::assert_connection_test_failure_contract();
    crate::features::connections::assert_local_listener_discovery_contract();
    let job_event = crate::features::jobs::JobChangedEvent {
        connection_id: Uuid::new_v4().into(),
        job_id: Uuid::new_v4().into(),
        kind: crate::features::jobs::JobKind::Import,
        state: crate::features::jobs::JobState::Succeeded,
        rows_processed: 2,
        bytes_processed: 40,
    };
    let job_wire = serde_json::to_value(job_event).unwrap();
    assert_eq!(job_wire["kind"], "import");
    assert_eq!(job_wire["state"], "succeeded");
    assert_eq!(job_wire["rowsProcessed"], 2);
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
        env: Some(crate::kernel::environment::EnvironmentKind::Production),
        effective_env: Some(crate::kernel::environment::EnvironmentKind::Production),
        schema_group: None,
        workspace_access: WorkspaceConnectionAccess::Local,
        credential_mode: WorkspaceCredentialMode::Local,
        provider_target: None,
        schema_access_available: false,
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
    assert_services_snapshots_persist_only_terminal_disk_backed_results();
    assert_planning_guidance_audit_actions_and_sink_errors_keep_their_contracts();
    assert_knowledge_bindings_and_article_results_reject_stale_or_foreign_input();

    #[cfg(not(feature = "packaged-benchmark"))]
    crate::app_paths::assert_application_data_root_contract();
    crate::broker::assert_dispatch_contract();
    crate::features::agents::acp::assert_editor_context_scope_contract();
    crate::features::agents::acp::assert_session_configuration_contract();
    crate::features::agents::domain::assert_agent_event_wire_contract();
    crate::features::agents::assert_agent_cli_probe_contract();
    crate::cli_environment::assert_cli_environment_contract();
    crate::skills::assert_skill_installation_contract();
    crate::features::agents::runtime::assert_acp_plugin_runtime_contract();
    crate::hosted_control_plane::assert_shared_http_client_contract();
    crate::features::workspaces::adapters::desktop_login::assert_desktop_login_contract().await;
    crate::features::workspaces::adapters::control_plane::assert_hosted_workspace_response_bounds_contract();
    crate::features::workspace_admin::assert_workspace_admin_contract();
    crate::features::direct_access::assert_direct_access_contract().await;
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    crate::features::workspaces::adapters::desktop_callbacks::assert_workspace_callback_contract();
    crate::connection::keychain::assert_workspace_session_keychain_async_contract().await;
    crate::connection::assert_warm_cache_authorization_contract();
    crate::bigquery::assert_bigquery_contract();
    super::adapters::assert_ephemeral_page_contract();
    super::adapters::assert_decode_failure_export_contract();
}

fn production_profile() -> ConnectionProfile {
    let mut profile: ConnectionProfile = serde_json::from_value(serde_json::json!({
        "id": Uuid::new_v4(),
        "name": "query-guidance-fixture",
        "engine": "postgres",
        "host": "db.example.invalid",
        "port": 5432,
        "database": "app",
        "username": "reader",
        "sslmode": "require",
        "readonlyDefault": true,
        "allowWrites": false,
        "secretRef": null
    }))
    .unwrap();
    profile.effective_env = Some(crate::kernel::environment::EnvironmentKind::Production);
    profile
}

fn health(level: &str, coverage: &str) -> HealthSnapshot {
    HealthSnapshot {
        level: level.into(),
        coverage: coverage.into(),
        total_connections: None,
        max_connections: None,
        connection_usage_percent: None,
        active_queries: None,
        long_running_queries: None,
        lock_waits: None,
        replication_lag_seconds: None,
        reasons: Vec::new(),
        captured_at: Utc::now(),
    }
}

fn assert_services_snapshots_persist_only_terminal_disk_backed_results() {
    use super::domain::{QueryDomainError, QueryServiceSessionStatus};

    let operation = Uuid::new_v4().to_string();
    let stream_result = serde_json::json!({
        "kind": "stream",
        "stream": {
            "operationId": operation,
            "phase": "complete",
            "rowCount": 3,
            "rowSource": {
                "operationId": operation,
                "capability": "a".repeat(64),
                "pageRows": 256,
                "rowCount": 3,
                "complete": true
            }
        }
    });
    let snapshot = |status: &str, result: serde_json::Value| {
        serde_json::json!({
            "schemaVersion": 2,
            "id": "document-1:1",
            "documentId": "document-1",
            "connectionId": Uuid::nil(),
            "connectionName": "Fixture",
            "consoleTitle": "Query",
            "database": "app",
            "namespace": "public",
            "sql": "SELECT 1",
            "startedAt": "2026-01-01T00:00:00Z",
            "startedLabel": "00:00:00",
            "updatedAt": 1,
            "status": status,
            "result": result
        })
    };

    // Only terminal sessions persist, each with the one result kind it can carry.
    for (status, kind, expected) in [
        (
            "completed",
            "materialized",
            QueryServiceSessionStatus::Completed,
        ),
        ("completed", "script", QueryServiceSessionStatus::Completed),
        ("failed", "error", QueryServiceSessionStatus::Failed),
        ("cancelled", "none", QueryServiceSessionStatus::Cancelled),
    ] {
        let validated = validate_query_service_session_snapshot(snapshot(
            status,
            serde_json::json!({ "kind": kind }),
        ))
        .unwrap();
        assert_eq!(validated.status, expected, "{status}/{kind}");
        assert_eq!(validated.status.as_str(), status);
        assert_eq!(validated.id, "document-1:1");
        assert_eq!(validated.updated_at, 1);
    }
    let accepted = snapshot("completed", stream_result.clone());
    assert_eq!(
        validate_query_service_session_snapshot(accepted.clone())
            .unwrap()
            .snapshot,
        accepted
    );

    let invalid = |label: &str, value: serde_json::Value| {
        assert!(
            matches!(
                validate_query_service_session_snapshot(value),
                Err(QueryDomainError::Invalid(_) | QueryDomainError::Serialization(_))
            ),
            "{label} must be rejected"
        );
    };
    for (status, kind) in [
        ("completed", "error"),
        ("completed", "none"),
        ("failed", "materialized"),
        ("cancelled", "error"),
        ("running", "none"),
    ] {
        invalid(
            &format!("{status}/{kind}"),
            snapshot(status, serde_json::json!({ "kind": kind })),
        );
    }
    invalid("missing kind", snapshot("completed", serde_json::json!({})));
    let base = snapshot("completed", serde_json::json!({ "kind": "materialized" }));
    for (field, value) in [
        ("schemaVersion", serde_json::json!(1)),
        ("id", serde_json::json!("")),
        ("id", serde_json::json!("i".repeat(513))),
        ("documentId", serde_json::json!("document\u{0}1")),
        ("connectionName", serde_json::json!("")),
        ("consoleTitle", serde_json::json!("title\n")),
        ("database", serde_json::json!("d".repeat(513))),
        ("namespace", serde_json::json!("")),
        ("startedLabel", serde_json::json!("")),
        ("startedAt", serde_json::json!("yesterday")),
        ("updatedAt", serde_json::json!(0)),
        ("updatedAt", serde_json::json!(-1)),
        ("connectionId", serde_json::json!("not-a-uuid")),
        ("unexpectedField", serde_json::json!(true)),
    ] {
        let mut changed = base.clone();
        changed[field] = value;
        invalid(field, changed);
    }

    // A disk-backed stream is persisted only as a complete, self-consistent
    // handle with a 256-row page size and a 64-hex capability.
    for (label, pointer, value) in [
        ("missing stream", "/stream", serde_json::Value::Null),
        (
            "missing row source",
            "/stream/rowSource",
            serde_json::Value::Null,
        ),
        (
            "missing operation",
            "/stream/rowSource/operationId",
            serde_json::Value::Null,
        ),
        (
            "invalid operation",
            "/stream/rowSource/operationId",
            serde_json::json!("op-1"),
        ),
        (
            "missing capability",
            "/stream/rowSource/capability",
            serde_json::Value::Null,
        ),
        (
            "short capability",
            "/stream/rowSource/capability",
            serde_json::json!("a".repeat(63)),
        ),
        (
            "non-hex capability",
            "/stream/rowSource/capability",
            serde_json::json!("g".repeat(64)),
        ),
        (
            "page size",
            "/stream/rowSource/pageRows",
            serde_json::json!(255),
        ),
        (
            "row count",
            "/stream/rowSource/rowCount",
            serde_json::json!(4),
        ),
        (
            "incomplete",
            "/stream/rowSource/complete",
            serde_json::json!(false),
        ),
        (
            "foreign operation",
            "/stream/operationId",
            serde_json::json!(Uuid::new_v4().to_string()),
        ),
        (
            "running phase",
            "/stream/phase",
            serde_json::json!("streaming"),
        ),
    ] {
        let mut result = stream_result.clone();
        *result.pointer_mut(pointer).unwrap() = value;
        invalid(label, snapshot("completed", result));
    }

    // The whole snapshot is bounded before it is decoded.
    let mut oversized = base;
    oversized["sql"] = serde_json::json!("x".repeat(16 * 1024 * 1024));
    assert!(matches!(
        validate_query_service_session_snapshot(oversized),
        Err(QueryDomainError::LimitExceeded(_))
    ));
}

fn assert_planning_guidance_audit_actions_and_sink_errors_keep_their_contracts() {
    use super::domain::{AgentQueryInvocationOrigin, DesktopSqlStreamSinkError};

    // A healthy, bounded read on a non-production connection is ready.
    let mut development = production_profile();
    development.effective_env = None;
    let (decision, notices, suggestions) =
        planning_guidance(&development, &health("normal", "full"), Some(10), 50_000);
    assert_eq!(decision, "ready");
    assert!(notices.is_empty() && suggestions.is_empty());
    // A production read without a row estimate, a busy database, or an estimate
    // above a negative threshold (clamped to zero) is never ready.
    let (decision, notices, suggestions) =
        planning_guidance(&production_profile(), &health("busy", "full"), None, 50_000);
    assert_eq!(decision, "caution");
    assert!(notices
        .iter()
        .any(|notice| notice.contains("did not provide a usable row estimate")));
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.contains("database pressure")));
    let (decision, _, _) =
        planning_guidance(&development, &health("elevated", "full"), Some(0), 50_000);
    assert_eq!(decision, "caution");
    let (decision, notices, _) =
        planning_guidance(&development, &health("normal", "full"), Some(1), -5);
    assert_eq!(decision, "caution");
    assert!(notices.iter().any(|notice| notice.contains("estimates 1 ")));

    // Agent plan and run audit rows carry the frozen adapter family.
    let origin = AgentQueryInvocationOrigin::Cli;
    assert_eq!(
        serde_json::to_value(origin).unwrap(),
        serde_json::json!(origin.as_str())
    );
    assert_eq!(origin.plan_audit_action(), "cli:plan_query");
    assert_eq!(origin.run_audit_action(), "cli:run_query");

    // Only a real cancellation renders as the text the Broker maps to its
    // cancelled code; every other sink failure stays distinct.
    let errors = [
        DesktopSqlStreamSinkError::ReceiverDropped,
        DesktopSqlStreamSinkError::AcknowledgementTimedOut,
        DesktopSqlStreamSinkError::StreamAlreadyActive,
        DesktopSqlStreamSinkError::StreamNotActive,
        DesktopSqlStreamSinkError::InvalidAcknowledgement,
        DesktopSqlStreamSinkError::BatchTooLarge,
        DesktopSqlStreamSinkError::Cancelled,
        DesktopSqlStreamSinkError::ResultStoreUnavailable,
        DesktopSqlStreamSinkError::ResultReceiptMismatch,
    ];
    let messages = errors.map(|error| error.to_string());
    for (error, message) in errors.iter().zip(&messages) {
        assert_eq!(
            message == "query cancelled",
            *error == DesktopSqlStreamSinkError::Cancelled,
            "{error:?}"
        );
    }
    let mut unique = messages.to_vec();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), errors.len());
}

fn assert_knowledge_bindings_and_article_results_reject_stale_or_foreign_input() {
    use crate::features::knowledge::domain::{
        validate_binding_draft, ProjectEnvironment, SourceBindingDraft, SourceLocator,
    };

    let environment = ProjectEnvironment {
        id: Uuid::new_v4(),
        project_id: Uuid::new_v4(),
        kind: crate::kernel::environment::EnvironmentKind::Staging,
        revision: 4,
    };
    let draft = SourceBindingDraft {
        source_id: Uuid::new_v4(),
        project_id: environment.project_id,
        project_environment_id: environment.id,
        environment_revision: 4,
        display_name: "Application source".into(),
        locator: SourceLocator::Github {
            installation_id: Uuid::new_v4(),
            repository_id: "1".into(),
            repository: "example/app".into(),
            ref_name: "main".into(),
        },
    };
    assert!(validate_binding_draft(&draft, &environment).is_ok());
    let mut zero_revision = environment.clone();
    zero_revision.revision = 0;
    let mut zero_draft = draft.clone();
    zero_draft.environment_revision = 0;
    assert!(validate_binding_draft(&zero_draft, &zero_revision).is_err());
    let with = |change: &dyn Fn(&mut SourceBindingDraft)| {
        let mut changed = draft.clone();
        change(&mut changed);
        changed
    };
    for (label, changed) in [
        (
            "foreign environment",
            with(&|draft| draft.project_environment_id = Uuid::new_v4()),
        ),
        (
            "foreign project",
            with(&|draft| draft.project_id = Uuid::new_v4()),
        ),
        (
            "stale revision",
            with(&|draft| draft.environment_revision = 3),
        ),
        (
            "future revision",
            with(&|draft| draft.environment_revision = 5),
        ),
        (
            "blank name",
            with(&|draft| draft.display_name = "  ".into()),
        ),
        (
            "long name",
            with(&|draft| draft.display_name = "n".repeat(513)),
        ),
        (
            "control name",
            with(&|draft| draft.display_name = "app\u{1b}[2J".into()),
        ),
    ] {
        assert!(
            matches!(
                validate_binding_draft(&changed, &environment),
                Err(crate::error::AppError::Config(_))
            ),
            "{label} must be rejected"
        );
    }
    let mut longest = draft;
    longest.display_name = "n".repeat(512);
    assert!(validate_binding_draft(&longest, &environment).is_ok());

    // An unreadable or extended local result never decodes, and the refusal does
    // not echo the stored bytes.
    for bytes in [
        b"result-secret-must-not-escape".as_slice(),
        br#"{"runId":"result-secret-must-not-escape"}"#.as_slice(),
    ] {
        match crate::features::analysis_articles::deserialize_local_result(bytes) {
            Err(crate::error::AppError::Config(message)) => {
                assert!(!message.contains("result-secret-must-not-escape"));
            }
            other => panic!("local result must be refused: {other:?}"),
        }
    }
}
