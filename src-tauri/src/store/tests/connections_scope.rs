//! Store baseline, shared connection binding, and catalog scope-isolation tests.

use super::fixtures::*;
use crate::features::knowledge::test_support::{
    KnowledgeGrantPort, KnowledgeGraphRepositoryPort, KnowledgeMappingRepositoryPort,
    KnowledgeRepositoryPort, KnowledgeScopeRepositoryPort, SqliteKnowledgeRepository,
};
use crate::kernel::access::WorkspaceKind;

fn assert_knowledge_source_revision_ipc_uses_camel_case_fields() {
    use crate::features::knowledge::transport::serialize_knowledge_source_revision_for_test;
    use dopedb_protocol::SourceRevisionIdentity;

    let cases = [
        (
            SourceRevisionIdentity::Github {
                repository_id: "42".into(),
                repository: "owner/repository".into(),
                ref_name: "main".into(),
                commit_sha: "0123456789abcdef0123456789abcdef01234567".into(),
            },
            serde_json::json!({
                "kind": "github",
                "repositoryId": "42",
                "repository": "owner/repository",
                "refName": "main",
                "commitSha": "0123456789abcdef0123456789abcdef01234567",
            }),
        ),
        (
            SourceRevisionIdentity::LocalGit {
                root_fingerprint: "root".into(),
                git_root_fingerprint: "git-root".into(),
                ref_name: "feature".into(),
                commit_sha: "89abcdef0123456789abcdef0123456789abcdef".into(),
                dirty: true,
                worktree: false,
            },
            serde_json::json!({
                "kind": "local_git",
                "rootFingerprint": "root",
                "gitRootFingerprint": "git-root",
                "refName": "feature",
                "commitSha": "89abcdef0123456789abcdef0123456789abcdef",
                "dirty": true,
                "worktree": false,
            }),
        ),
        (
            SourceRevisionIdentity::LocalSnapshot {
                root_fingerprint: "root".into(),
                snapshot_sha256: "snapshot".into(),
            },
            serde_json::json!({
                "kind": "local_snapshot",
                "rootFingerprint": "root",
                "snapshotSha256": "snapshot",
            }),
        ),
    ];

    for (revision, expected) in cases {
        assert_eq!(
            serialize_knowledge_source_revision_for_test(revision),
            expected,
        );
    }
}

async fn assert_current_store_baseline_and_invariants() {
    let pool = memory_pool().await;
    assert_eq!(
        super::super::bootstrap::bootstrap_local_store(&pool)
            .await
            .unwrap(),
        super::super::bootstrap::LocalStoreBootstrap::Ready { created: true }
    );
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, super::super::bootstrap::LOCAL_SCHEMA_BASELINE);
    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        application_id,
        super::super::bootstrap::LOCAL_SCHEMA_APPLICATION_ID
    );

    let integrity_connection_id = Uuid::from_u128(0x1200);
    let store = Store::from_pool_for_test(pool.clone());
    let knowledge = SqliteKnowledgeRepository::new(store.clone());
    store
        .upsert_connection(&sqlite_profile(integrity_connection_id, "integrity-guard"))
        .await
        .unwrap();
    let mut local_safety = store.get_safety(integrity_connection_id).await.unwrap();
    local_safety.allow_writes = true;
    local_safety.allow_schema_changes = true;
    assert!(store
        .set_safety(integrity_connection_id, 1, true, &local_safety)
        .await
        .unwrap());
    assert!(
        store
            .get_connection(integrity_connection_id)
            .await
            .unwrap()
            .allow_writes
    );
    assert!(
        store
            .get_safety(integrity_connection_id)
            .await
            .unwrap()
            .allow_writes
    );
    assert!(
        store
            .get_safety(integrity_connection_id)
            .await
            .unwrap()
            .allow_schema_changes
    );
    let mut invalid_schema_safety = local_safety.clone();
    invalid_schema_safety.allow_writes = false;
    assert!(matches!(
        store
            .set_safety(integrity_connection_id, 2, true, &invalid_schema_safety,)
            .await,
        Err(AppError::Blocked { .. })
    ));
    local_safety.max_rows = 321;
    assert!(!store
        .set_safety(integrity_connection_id, 2, true, &local_safety)
        .await
        .unwrap());
    assert_eq!(
        store
            .get_safety(integrity_connection_id)
            .await
            .unwrap()
            .max_rows,
        321
    );
    assert!(matches!(
        store
            .set_safety(integrity_connection_id, 1, true, &local_safety)
            .await,
        Err(AppError::Blocked { .. })
    ));
    local_safety.allow_writes = false;
    local_safety.allow_schema_changes = false;
    assert!(store
        .set_safety(integrity_connection_id, 2, true, &local_safety)
        .await
        .unwrap());
    assert!(
        !store
            .get_connection(integrity_connection_id)
            .await
            .unwrap()
            .allow_writes
    );
    assert!(
        !store
            .get_safety(integrity_connection_id)
            .await
            .unwrap()
            .allow_writes
    );
    assert!(
        sqlx::query("UPDATE connections SET port = 65536 WHERE id = ?1")
            .bind(integrity_connection_id.to_string())
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE connections SET extra_params = '{' WHERE id = ?1")
            .bind(integrity_connection_id.to_string())
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE connections SET provider_target = '[]' WHERE id = ?1")
            .bind(integrity_connection_id.to_string())
            .execute(&pool)
            .await
            .is_err()
    );
    sqlx::query(
        "INSERT INTO workspace_connection_bindings
             (connection_id, account_user_id, username, extra_params, updated_at)
         VALUES (?1, 'integrity-member', '', '{}', CURRENT_TIMESTAMP)",
    )
    .bind(integrity_connection_id.to_string())
    .execute(&pool)
    .await
    .unwrap();
    assert!(sqlx::query(
        "UPDATE workspace_connection_bindings SET extra_params = '[]'
         WHERE connection_id = ?1 AND account_user_id = 'integrity-member'",
    )
    .bind(integrity_connection_id.to_string())
    .execute(&pool)
    .await
    .is_err());
    sqlx::query("DELETE FROM connections WHERE id = ?1")
        .bind(integrity_connection_id.to_string())
        .execute(&pool)
        .await
        .unwrap();

    use crate::features::knowledge::domain::{
        EnvironmentRiskClass, KnowledgeGrant, KnowledgeMappingProposal, MappingProposalState,
        Project, ProjectEnvironment,
    };
    use crate::kernel::identity::{AccountId, WorkspaceId};
    use dopedb_protocol::{
        GraphBuildArtifactV1, KnowledgeSourceProvider, KnowledgeSourceVisibility,
        SourceRevisionIdentity,
    };

    let personal_workspace_id = Uuid::parse_str(schema::PERSONAL_WORKSPACE_ID).unwrap();
    let local_project = knowledge
        .create_knowledge_project(
            personal_workspace_id,
            "Personal Inventory",
            &[("Development".into(), EnvironmentRiskClass::Development)],
        )
        .await
        .unwrap();
    let local_inventory = knowledge
        .knowledge_projects(personal_workspace_id)
        .await
        .unwrap();
    assert_eq!(local_inventory, vec![local_project.clone()]);
    let local_project = knowledge
        .create_knowledge_environment(
            personal_workspace_id,
            local_project.project.id,
            "Production",
            EnvironmentRiskClass::Production,
        )
        .await
        .unwrap();
    assert_eq!(local_project.project.revision, 2);
    assert_eq!(local_project.environments.len(), 2);
    let local_environment_id = local_project.environments[0].id;
    assert!(local_project
        .environments
        .iter()
        .any(|environment| environment.id == local_environment_id));
    assert!(knowledge
        .knowledge_projects(Uuid::from_u128(0xdead))
        .await
        .unwrap()
        .is_empty());
    assert!(knowledge
        .create_knowledge_environment(
            personal_workspace_id,
            local_project.project.id,
            "Production",
            EnvironmentRiskClass::Production,
        )
        .await
        .is_err());
    assert!(knowledge
        .create_knowledge_project(
            personal_workspace_id,
            "Personal Inventory",
            &[("Production".into(), EnvironmentRiskClass::Production)],
        )
        .await
        .is_err());

    let artifact: GraphBuildArtifactV1 = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../dopedb-protocol/tests/fixtures/graph-build-artifact-v1.json"
    )))
    .unwrap();
    let project = Project {
        id: artifact.binding.project_id,
        workspace_id: WorkspaceId::from(personal_workspace_id),
        name: "DopeDB".into(),
        revision: 1,
    };
    let environment = ProjectEnvironment {
        id: artifact.binding.project_environment_id,
        project_id: project.id,
        name: "Development".into(),
        risk_class: EnvironmentRiskClass::Development,
        revision: artifact.environment_revision,
    };
    knowledge
        .save_scope(
            &project,
            &environment,
            &artifact.binding,
            artifact.environment_revision,
        )
        .await
        .unwrap();
    knowledge.stage(&artifact).await.unwrap();
    knowledge.activate(&artifact).await.unwrap();
    assert_eq!(
        knowledge
            .active_for_source(artifact.binding.source_id)
            .await
            .unwrap()
            .unwrap()
            .graph_revision_id,
        artifact.graph_revision_id
    );
    let mut second = artifact.clone();
    second.binding.source_id = Uuid::from_u128(0x126);
    second.binding.display_name = "Web".into();
    second.binding.provider = KnowledgeSourceProvider::LocalFolder;
    second.binding.visibility = KnowledgeSourceVisibility::LocalOnly;
    second.binding.revision = SourceRevisionIdentity::LocalSnapshot {
        root_fingerprint: "b".repeat(64),
        snapshot_sha256: "c".repeat(64),
    };
    second.graph_revision_id = Uuid::from_u128(0x1260);
    second.parent_graph_revision_id = None;
    for evidence in &mut second.evidence {
        evidence.source_id = second.binding.source_id;
    }
    knowledge
        .save_scope(
            &project,
            &environment,
            &second.binding,
            second.environment_revision,
        )
        .await
        .unwrap();
    knowledge.stage(&second).await.unwrap();
    knowledge.activate(&second).await.unwrap();
    let active_set = [
        knowledge
            .active_for_source(artifact.binding.source_id)
            .await
            .unwrap()
            .unwrap(),
        knowledge
            .active_for_source(second.binding.source_id)
            .await
            .unwrap()
            .unwrap(),
    ];
    assert_eq!(active_set.len(), 2);
    assert!(active_set
        .iter()
        .any(|candidate| candidate.graph_revision_id == artifact.graph_revision_id));
    assert!(active_set
        .iter()
        .any(|candidate| candidate.graph_revision_id == second.graph_revision_id));

    let account_id = AccountId::new("knowledge-member").unwrap();
    store
        .remember_workspace_account(&crate::features::workspaces::WorkspaceAuthUser {
            id: account_id.clone(),
            email: "knowledge@example.com".into(),
            display_name: "Knowledge owner".into(),
        })
        .await
        .unwrap();
    let grant = KnowledgeGrant {
        id: Uuid::from_u128(0x1262),
        workspace_id: project.workspace_id,
        account_id,
        project_id: project.id,
        project_environment_id: environment.id,
        environment_revision: environment.revision,
        graph_revision_ids: active_set
            .iter()
            .filter(|candidate| candidate.binding.provider == KnowledgeSourceProvider::Github)
            .map(|candidate| candidate.graph_revision_id)
            .collect(),
        expires_at: Utc::now() + chrono::Duration::hours(1),
    };
    knowledge.save_grant(&grant).await.unwrap();
    knowledge
        .retain_granted_environment_heads(environment.id, &grant.graph_revision_ids)
        .await
        .unwrap();
    assert!(knowledge
        .active_for_source(artifact.binding.source_id)
        .await
        .unwrap()
        .is_some());
    assert!(knowledge
        .active_for_source(second.binding.source_id)
        .await
        .unwrap()
        .is_some());

    let mapping = KnowledgeMappingProposal {
        id: Uuid::from_u128(0x1261),
        project_environment_id: environment.id,
        graph_revision_id: artifact.graph_revision_id,
        schema_fingerprint: "a".repeat(64),
        from_node_id: artifact.nodes[0].id.clone(),
        target_kind: "table".into(),
        target_identity: serde_json::json!({
            "connectionId": Uuid::from_u128(0x1291),
            "connectionRevision": 1,
            "database": "app",
            "qualifiedTarget": "public.users"
        })
        .to_string(),
        state: MappingProposalState::Proposed,
        proposed_at: Utc::now(),
    };
    knowledge.propose_mapping(&mapping).await.unwrap();
    let stored_mapping_state: String =
        sqlx::query_scalar("SELECT state FROM knowledge_mapping_proposals WHERE id = ?1")
            .bind(mapping.id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_mapping_state, "proposed");

    let current_connection_id = Uuid::from_u128(0x1291);
    let secondary_connection_id = Uuid::from_u128(0x1292);
    let mut resource_scope = crate::features::knowledge::domain::KnowledgeSessionScope {
        project_id: project.id,
        knowledge_grant_id: Some(Uuid::from_u128(0x1290)),
        project_environment_id: environment.id,
        environment_revision: environment.revision,
        authority_connection_id: current_connection_id,
        authority_connection_revision: 1,
        sources: Vec::new(),
        graph_revision_ids: active_set
            .iter()
            .map(|candidate| candidate.graph_revision_id)
            .collect(),
        connections: vec![
            crate::features::knowledge::domain::KnowledgeSessionConnection {
                connection_id: current_connection_id,
                connection_revision: 1,
                remote_connection_id: None,
                connection_content_revision: 1,
                role: "primary".into(),
                alias: "Primary".into(),
            },
            crate::features::knowledge::domain::KnowledgeSessionConnection {
                connection_id: secondary_connection_id,
                connection_revision: 2,
                remote_connection_id: None,
                connection_content_revision: 2,
                role: "analytics".into(),
                alias: "Analytics".into(),
            },
        ],
    };
    crate::features::agents::acp::narrow_resource_scope(
        &mut resource_scope,
        &[secondary_connection_id],
        &[],
    )
    .unwrap();
    assert_eq!(resource_scope.connections.len(), 1);
    assert_eq!(
        resource_scope.connections[0].connection_id,
        secondary_connection_id
    );
    assert_eq!(
        resource_scope.authority_connection_id,
        current_connection_id
    );
    assert!(resource_scope.graph_revision_ids.is_empty());
    assert_eq!(resource_scope.knowledge_grant_id, None);
    assert!(matches!(
        crate::features::agents::acp::narrow_resource_scope(
            &mut resource_scope,
            &[Uuid::from_u128(0xdead)],
            &[],
        ),
        Err(AppError::Blocked { .. })
    ));
    let mut failed = artifact.clone();
    failed.graph_revision_id = Uuid::from_u128(127);
    failed.parent_graph_revision_id = Some(artifact.graph_revision_id);
    failed.health.complete = false;
    assert!(matches!(
        knowledge.stage(&failed).await,
        Err(AppError::Blocked { .. })
    ));
    let mut stale = artifact.clone();
    stale.graph_revision_id = Uuid::from_u128(128);
    stale.parent_graph_revision_id = None;
    knowledge.stage(&stale).await.unwrap();
    assert!(matches!(
        knowledge.activate(&stale).await,
        Err(AppError::Blocked { .. })
    ));
    assert_eq!(
        knowledge
            .active_for_source(artifact.binding.source_id)
            .await
            .unwrap()
            .unwrap()
            .graph_revision_id,
        artifact.graph_revision_id
    );
    let connection_count_before_project_delete: i64 =
        sqlx::query_scalar("SELECT count(*) FROM connections")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(matches!(
        knowledge
            .delete_knowledge_project(personal_workspace_id, project.id, project.revision + 1)
            .await,
        Err(AppError::Blocked { .. })
    ));
    assert!(knowledge
        .active_for_source(artifact.binding.source_id)
        .await
        .unwrap()
        .is_some());
    knowledge
        .delete_knowledge_project(personal_workspace_id, project.id, project.revision)
        .await
        .unwrap();
    assert!(knowledge
        .active_for_source(artifact.binding.source_id)
        .await
        .unwrap()
        .is_none());
    assert!(knowledge
        .active_for_source(second.binding.source_id)
        .await
        .unwrap()
        .is_none());
    assert!(knowledge
        .knowledge_projects(personal_workspace_id)
        .await
        .unwrap()
        .iter()
        .all(|candidate| candidate.project.id != project.id));
    let connection_count_after_project_delete: i64 =
        sqlx::query_scalar("SELECT count(*) FROM connections")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        connection_count_after_project_delete,
        connection_count_before_project_delete
    );
    assert!(matches!(
        knowledge
            .delete_knowledge_project(personal_workspace_id, project.id, project.revision)
            .await,
        Err(AppError::NotFound(_))
    ));
    let runner_account = Uuid::from_u128(0x991).to_string();
    let runner_workspace = Uuid::from_u128(0x992);
    let runner_device = store
        .analysis_run_device_id(&runner_account, runner_workspace)
        .await
        .unwrap();
    assert_eq!(
        store
            .analysis_run_device_id(&runner_account, runner_workspace)
            .await
            .unwrap(),
        runner_device
    );
    let replacement_runner_device = store
        .replace_analysis_run_device_id(&runner_account, runner_workspace)
        .await
        .unwrap();
    assert_ne!(replacement_runner_device, runner_device);
    assert_eq!(
        store
            .analysis_run_device_id(&runner_account, runner_workspace)
            .await
            .unwrap(),
        replacement_runner_device
    );
    assert_ne!(
        store
            .analysis_run_device_id(&runner_account, Uuid::from_u128(0x993))
            .await
            .unwrap(),
        replacement_runner_device
    );
    assert_ne!(
        store
            .analysis_run_device_id(&Uuid::from_u128(0x994).to_string(), runner_workspace)
            .await
            .unwrap(),
        replacement_runner_device
    );
    sqlx::query("PRAGMA query_only = ON")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        super::super::bootstrap::bootstrap_local_store(&pool)
            .await
            .unwrap(),
        super::super::bootstrap::LocalStoreBootstrap::Ready { created: false }
    );
    sqlx::query("PRAGMA query_only = OFF")
        .execute(&pool)
        .await
        .unwrap();

    let legacy_root = tempfile::tempdir().unwrap();
    let legacy_path = legacy_root.path().join("app.db");
    let legacy_pool = super::super::open_local_store_pool(&legacy_path)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE legacy_marker (value TEXT NOT NULL)")
        .execute(&legacy_pool)
        .await
        .unwrap();
    sqlx::query("PRAGMA application_id = 1146048581")
        .execute(&legacy_pool)
        .await
        .unwrap();
    sqlx::query("PRAGMA user_version = 26")
        .execute(&legacy_pool)
        .await
        .unwrap();
    legacy_pool.close().await;

    let reset_store = Store::open_at(&legacy_path).await.unwrap();
    let reset_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(reset_store.pool())
        .await
        .unwrap();
    assert_eq!(
        reset_version,
        super::super::bootstrap::LOCAL_SCHEMA_BASELINE
    );
    let reset_application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(reset_store.pool())
        .await
        .unwrap();
    assert_eq!(
        reset_application_id,
        super::super::bootstrap::LOCAL_SCHEMA_APPLICATION_ID
    );
    assert!(
        sqlx::query_scalar::<_, String>("SELECT value FROM legacy_marker")
            .fetch_optional(reset_store.pool())
            .await
            .is_err()
    );

    let gate = crate::startup::PostPaintRecoveryGate::new();
    assert!(gate.claim_start());
    assert!(!gate.claim_start());
    let waiting_gate = gate.clone();
    let waiter = tokio::spawn(async move { waiting_gate.wait().await });
    tokio::task::yield_now().await;
    assert!(!waiter.is_finished());
    gate.finish(true);
    waiter.await.unwrap().unwrap();
}

async fn assert_agent_acp_batch_replay_is_bounded(store: &Store, connection_id: Uuid) {
    use crate::features::agents::domain::{
        AcpSessionEvent, AcpSessionEventPayload, AcpSessionLifecycle, AcpSessionSummary,
        AgentProvider,
    };
    use crate::features::knowledge::domain::{KnowledgeSessionConnection, KnowledgeSessionScope};
    use crate::kernel::identity::{AcpSessionId, ConnectionId};

    let scope = store.active_resource_scope().await.unwrap();
    let now = Utc::now();
    let session_id = AcpSessionId::from(Uuid::new_v4());
    let summary = AcpSessionSummary {
        id: session_id,
        connection_id: ConnectionId::from(connection_id),
        provider: AgentProvider::Codex,
        title: "Bounded replay".into(),
        lifecycle: AcpSessionLifecycle::Ready,
        acp_session_id: Some("official-adapter-session".into()),
        knowledge_scopes: vec![KnowledgeSessionScope {
            project_id: Uuid::from_u128(0xac01),
            knowledge_grant_id: None,
            project_environment_id: Uuid::from_u128(0xac02),
            environment_revision: 1,
            authority_connection_id: connection_id,
            authority_connection_revision: 1,
            sources: Vec::new(),
            graph_revision_ids: Vec::new(),
            connections: vec![KnowledgeSessionConnection {
                connection_id,
                connection_revision: 1,
                remote_connection_id: None,
                connection_content_revision: 1,
                role: "primary".into(),
                alias: "Primary".into(),
            }],
        }],
        write_connection_id: Some(connection_id),
        error: None,
        created_at: now,
        updated_at: now,
    };
    let small_events = (1..=513)
        .map(|sequence| AcpSessionEvent {
            session_id,
            sequence,
            created_at: now,
            payload: AcpSessionEventPayload::SessionUpdate {
                update: serde_json::json!({
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": "x" }
                }),
            },
        })
        .collect::<Vec<_>>();
    store
        .persist_agent_acp_events(&scope, &summary, &small_events)
        .await
        .unwrap();
    let persisted_scope = store
        .list_agent_acp_sessions()
        .await
        .unwrap()
        .into_iter()
        .find(|candidate| candidate.id == session_id)
        .unwrap();
    assert_eq!(persisted_scope.knowledge_scopes, summary.knowledge_scopes);
    assert_eq!(persisted_scope.write_connection_id, Some(connection_id));
    store
        .persist_agent_acp_events(&scope, &summary, &small_events)
        .await
        .unwrap();
    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM agent_acp_events WHERE session_id = ?1")
            .bind(session_id.to_string())
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert_eq!(event_count, 512);

    let large_text = "z".repeat(480_000);
    let mut boundary_events = (600..609)
        .map(|sequence| AcpSessionEvent {
            session_id,
            sequence,
            created_at: now,
            payload: AcpSessionEventPayload::SessionUpdate {
                update: serde_json::json!({
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": large_text.as_str() }
                }),
            },
        })
        .collect::<Vec<_>>();
    boundary_events.push(AcpSessionEvent {
        session_id,
        sequence: 609,
        created_at: now,
        payload: AcpSessionEventPayload::TurnEnd {
            stop_reason: "end_turn".into(),
        },
    });
    store
        .persist_agent_acp_events(&scope, &summary, &boundary_events)
        .await
        .unwrap();
    let persisted_bytes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(length(CAST(payload AS BLOB))), 0)
         FROM agent_acp_events WHERE session_id = ?1",
    )
    .bind(session_id.to_string())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert!(persisted_bytes <= 4 * 1024 * 1024);

    let focus = store
        .focus_agent_acp_session(session_id, Some(0))
        .await
        .unwrap();
    assert!(focus.replay_truncated);
    assert!(focus
        .events
        .windows(2)
        .all(|events| events[0].sequence < events[1].sequence));
    assert_eq!(focus.events.last().map(|event| event.sequence), Some(609));

    let corrupt_session_id = AcpSessionId::from(Uuid::new_v4());
    let mut corrupt_summary = summary.clone();
    corrupt_summary.id = corrupt_session_id;
    corrupt_summary.title = "Unreadable metadata".into();
    corrupt_summary.created_at = now + chrono::Duration::milliseconds(1);
    corrupt_summary.updated_at = corrupt_summary.created_at;
    let corrupt_event = AcpSessionEvent {
        session_id: corrupt_session_id,
        sequence: 1,
        created_at: corrupt_summary.created_at,
        payload: AcpSessionEventPayload::SessionUpdate {
            update: serde_json::json!({
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "preserved" }
            }),
        },
    };
    store
        .persist_agent_acp_events(&scope, &corrupt_summary, &[corrupt_event])
        .await
        .unwrap();
    sqlx::query(
        "UPDATE agent_acp_sessions
         SET knowledge_scopes = '[{\"projectId\":true}]'
         WHERE id = ?1",
    )
    .bind(corrupt_session_id.to_string())
    .execute(store.pool())
    .await
    .unwrap();
    let recovered = store
        .list_agent_acp_sessions()
        .await
        .unwrap()
        .into_iter()
        .find(|session| session.id == corrupt_session_id)
        .unwrap();
    assert_eq!(recovered.lifecycle, AcpSessionLifecycle::Failed);
    assert_eq!(recovered.acp_session_id, None);
    assert_eq!(
        recovered.error.as_deref(),
        Some("agent_session_metadata_unavailable")
    );
    assert!(recovered.knowledge_scopes.is_empty());
    let recovered_focus = store
        .focus_agent_acp_session(corrupt_session_id, None)
        .await
        .unwrap();
    assert_eq!(recovered_focus.events.len(), 1);
    assert_eq!(
        recovered_focus.session.error.as_deref(),
        Some("agent_session_metadata_unavailable")
    );
    sqlx::query("DELETE FROM agent_acp_sessions WHERE id = ?1")
        .bind(corrupt_session_id.to_string())
        .execute(store.pool())
        .await
        .unwrap();

    for index in 0..=100 {
        let mut historical = summary.clone();
        historical.id = AcpSessionId::from(Uuid::new_v4());
        historical.title = format!("Historical session {index}");
        historical.lifecycle = AcpSessionLifecycle::Closed;
        historical.created_at = now + chrono::Duration::seconds(index);
        historical.updated_at = historical.created_at;
        store
            .persist_agent_acp_session(&scope, &historical)
            .await
            .unwrap();
    }
    let retained: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_acp_sessions
         WHERE workspace_id = ?1 AND account_scope = ?2",
    )
    .bind(scope.workspace_id.to_string())
    .bind(scope.account_scope.storage_key())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(retained, 100);
    assert_eq!(store.list_agent_acp_sessions().await.unwrap().len(), 100);

    // Active sessions must never be discarded to make room for history. The
    // runtime admits at most eight, but persistence still handles an imported
    // over-cap state fail-safe: the next terminal transition restores the bound.
    let mut overflow_active = None;
    for index in 0..100 {
        let mut active = summary.clone();
        active.id = AcpSessionId::from(Uuid::new_v4());
        active.title = format!("Concurrent active session {index}");
        active.created_at = now + chrono::Duration::minutes(10 + index);
        active.updated_at = active.created_at;
        if index == 99 {
            overflow_active = Some(active.clone());
        }
        store
            .persist_agent_acp_session(&scope, &active)
            .await
            .unwrap();
    }
    let active_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_acp_sessions
         WHERE workspace_id = ?1 AND account_scope = ?2
           AND lifecycle IN ('starting', 'ready', 'running', 'waiting_permission')",
    )
    .bind(scope.workspace_id.to_string())
    .bind(scope.account_scope.storage_key())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(active_count, 101);

    let mut closed_overflow = overflow_active.unwrap();
    closed_overflow.lifecycle = AcpSessionLifecycle::Closed;
    closed_overflow.updated_at = now + chrono::Duration::hours(3);
    store
        .persist_agent_acp_session(&scope, &closed_overflow)
        .await
        .unwrap();
    let retained_after_close: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM agent_acp_sessions
         WHERE workspace_id = ?1 AND account_scope = ?2",
    )
    .bind(scope.workspace_id.to_string())
    .bind(scope.account_scope.storage_key())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(retained_after_close, 100);
}

#[tokio::test]
async fn remote_template_sync_preserves_member_local_credential_binding() {
    assert_knowledge_source_revision_ipc_uses_camel_case_fields();
    assert_current_store_baseline_and_invariants().await;
    let pool = memory_pool().await;
    sqlx::raw_sql(schema::SCHEMA).execute(&pool).await.unwrap();
    let store = Store::from_pool_for_test(pool);
    let knowledge = SqliteKnowledgeRepository::new(store.clone());
    let workspace_id = Uuid::new_v4();
    let user = workspace_user("10000000-0000-0000-0000-000000000001", "Owner");
    store
        .sync_account_workspaces(
            &user,
            &[(workspace_id, "Team".into(), WorkspaceRole::Owner)],
        )
        .await
        .unwrap();

    // Authentication is independent from workspace navigation: selecting the
    // account exposes its memberships but leaves the current Personal scope active.
    let personal_before_login = store.active_workspace().await.unwrap();
    assert_eq!(personal_before_login.kind, WorkspaceKind::Personal);
    let personal_after_login = store.activate_workspace_account(&user.id).await.unwrap();
    assert_eq!(personal_after_login.id, personal_before_login.id);
    assert_eq!(personal_after_login.kind, WorkspaceKind::Personal);
    assert_eq!(
        store
            .active_workspace_account_id()
            .await
            .unwrap()
            .as_deref(),
        Some(user.id.as_str())
    );

    let cursor_page = crate::features::workspaces::WorkspacePullPage {
        next_cursor: 4,
        has_more: false,
        reset: false,
        refresh_connections: true,
        refresh_analyses: true,
        connection_tombstone: false,
        analysis_tombstone: false,
    };
    assert_eq!(
        store
            .workspace_pull_cursor(workspace_id, &user.id)
            .await
            .unwrap(),
        None
    );
    store
        .commit_workspace_pull_cursor(workspace_id, &user.id, None, cursor_page)
        .await
        .unwrap();
    assert_eq!(
        store
            .workspace_pull_cursor(workspace_id, &user.id)
            .await
            .unwrap(),
        Some(4)
    );
    let stale_cursor = store
        .commit_workspace_pull_cursor(
            workspace_id,
            &user.id,
            Some(3),
            crate::features::workspaces::WorkspacePullPage {
                next_cursor: 5,
                ..cursor_page
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(stale_cursor, AppError::Blocked { .. }));
    store
        .commit_workspace_pull_cursor(
            workspace_id,
            &user.id,
            Some(4),
            crate::features::workspaces::WorkspacePullPage {
                next_cursor: 2,
                reset: true,
                ..cursor_page
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .workspace_pull_cursor(workspace_id, &user.id)
            .await
            .unwrap(),
        Some(2)
    );
    store
        .commit_workspace_pull_cursor(
            workspace_id,
            &user.id,
            Some(2),
            crate::features::workspaces::WorkspacePullPage {
                next_cursor: 10_000,
                reset: true,
                ..cursor_page
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .workspace_pull_cursor(workspace_id, &user.id)
            .await
            .unwrap(),
        Some(10_000)
    );
    let other_user = workspace_user("20000000-0000-0000-0000-000000000002", "Editor");
    store
        .sync_account_workspaces(
            &other_user,
            &[(workspace_id, "Team".into(), WorkspaceRole::Editor)],
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .workspace_pull_cursor(workspace_id, &other_user.id)
            .await
            .unwrap(),
        None
    );

    let id = Uuid::new_v4();
    let mut local_binding = sqlite_profile(id, "shared");
    local_binding.workspace_access = crate::model::WorkspaceConnectionAccess::Write;
    local_binding.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    let bigquery_id = Uuid::new_v4();
    let mut bigquery_template = sqlite_profile(bigquery_id, "shared analytics");
    bigquery_template.engine = Engine::Bigquery;
    bigquery_template.provider = crate::model::Provider::Generic;
    bigquery_template.driver_id = Some("google-bq-cli".into());
    bigquery_template.host = "example-project".into();
    bigquery_template.port = 443;
    bigquery_template.database = "analytics".into();
    bigquery_template.readonly_default = true;
    bigquery_template.allow_writes = false;
    bigquery_template.workspace_access = crate::model::WorkspaceConnectionAccess::Read;
    bigquery_template.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    store
        .sync_remote_connections(
            workspace_id,
            &user.id,
            &[(local_binding, 1), (bigquery_template.clone(), 1)],
        )
        .await
        .unwrap();
    let mut member_options = HashMap::new();
    member_options.insert("member-local-option".into(), "on".into());
    let binding_ref = id.to_string();
    store
        .bind_connection_credentials(
            id,
            &user.id,
            "member-account",
            &member_options,
            Some(&binding_ref),
        )
        .await
        .unwrap();
    let mut bigquery_member_options = HashMap::new();
    bigquery_member_options.insert("authMode".into(), "serviceAccount".into());
    bigquery_member_options.insert("maximumBytesBilled".into(), "1073741824".into());
    store
        .bind_connection_credentials(bigquery_id, &user.id, "", &bigquery_member_options, None)
        .await
        .unwrap();

    let mut remote_update = sqlite_profile(id, "renamed");
    remote_update.username.clear();
    remote_update.extra_params.clear();
    remote_update.secret_ref = None;
    remote_update.allow_writes = false;
    remote_update.workspace_access = crate::model::WorkspaceConnectionAccess::Read;
    remote_update.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    store
        .sync_remote_connections(
            workspace_id,
            &user.id,
            &[(remote_update, 2), (bigquery_template, 1)],
        )
        .await
        .unwrap();
    store
        .activate_workspace(workspace_id, Some(&user.id))
        .await
        .unwrap();

    let loaded = store.get_connection(id).await.unwrap();
    assert_eq!(loaded.name, "renamed");
    assert_eq!(loaded.username, "member-account");
    assert_eq!(
        loaded
            .extra_params
            .get("member-local-option")
            .map(String::as_str),
        Some("on")
    );
    let expected_secret_ref = id.to_string();
    assert_eq!(
        loaded.secret_ref.as_deref(),
        Some(expected_secret_ref.as_str())
    );
    assert_eq!(
        loaded.workspace_access,
        crate::model::WorkspaceConnectionAccess::Read
    );
    assert!(!loaded.allow_writes);
    let loaded_bigquery = store.get_connection(bigquery_id).await.unwrap();
    assert!(loaded_bigquery.username.is_empty());
    assert!(loaded_bigquery.secret_ref.is_none());
    assert_eq!(
        loaded_bigquery
            .extra_params
            .get("authMode")
            .map(String::as_str),
        Some("serviceAccount")
    );
    assert_eq!(
        loaded_bigquery
            .extra_params
            .get("maximumBytesBilled")
            .map(String::as_str),
        Some("1073741824")
    );

    // An Environment with a GitHub source but no graph remains an exact Agent
    // scope. Raw source identity is pinned independently from graph grants.
    sqlx::raw_sql(schema::KNOWLEDGE_SCHEMA)
        .execute(store.pool())
        .await
        .unwrap();
    let project_id = Uuid::new_v4();
    let environment_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO knowledge_projects
             (id, workspace_id, name, revision, created_at, updated_at)
         VALUES (?1, ?2, 'Database only', 1, ?3, ?3)",
    )
    .bind(project_id.to_string())
    .bind(workspace_id.to_string())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO knowledge_project_environments
             (id, project_id, name, production, risk_class, revision, created_at, updated_at)
         VALUES (?1, ?2, 'Main', 0, 'development', 1, ?3, ?3)",
    )
    .bind(environment_id.to_string())
    .bind(project_id.to_string())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    let source_id = Uuid::new_v4();
    let binding = dopedb_protocol::KnowledgeSourceBindingV1 {
        source_id,
        project_id,
        project_environment_id: environment_id,
        provider: dopedb_protocol::KnowledgeSourceProvider::Github,
        display_name: "json-choi/raw".into(),
        visibility: dopedb_protocol::KnowledgeSourceVisibility::SharedGraph,
        revision: dopedb_protocol::SourceRevisionIdentity::Github {
            repository_id: "1004".into(),
            repository: "json-choi/raw".into(),
            ref_name: "main".into(),
            commit_sha: "7".repeat(40),
        },
    };
    sqlx::query(
        "INSERT INTO knowledge_sources
             (id, project_id, project_environment_id, environment_revision,
              provider, display_name, visibility, binding_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, 'github', 'json-choi/raw', 'shared_graph', ?4, ?5, ?5)",
    )
    .bind(source_id.to_string())
    .bind(project_id.to_string())
    .bind(environment_id.to_string())
    .bind(serde_json::to_string(&binding).unwrap())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    let environment_binding_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO knowledge_environment_connections
             (id, workspace_id, project_environment_id, environment_revision,
              connection_id, connection_revision, role, alias, created_at)
         VALUES (?1, ?2, ?3, 1, ?4, 2, 'primary', 'Primary', ?5)",
    )
    .bind(environment_binding_id.to_string())
    .bind(workspace_id.to_string())
    .bind(environment_id.to_string())
    .bind(id.to_string())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    let pinned = store.pin_connection_for_read(id).await.unwrap();
    let duplicate_project_id = Uuid::new_v4();
    let duplicate_environment_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO knowledge_projects
             (id, workspace_id, name, revision, created_at, updated_at)
         VALUES (?1, ?2, 'Duplicate target', 1, ?3, ?3)",
    )
    .bind(duplicate_project_id.to_string())
    .bind(workspace_id.to_string())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO knowledge_project_environments
             (id, project_id, name, production, risk_class, revision, created_at, updated_at)
         VALUES (?1, ?2, 'QA', 0, 'test', 1, ?3, ?3)",
    )
    .bind(duplicate_environment_id.to_string())
    .bind(duplicate_project_id.to_string())
    .bind(Utc::now())
    .execute(store.pool())
    .await
    .unwrap();
    assert!(matches!(
        knowledge
            .bind_environment_connection(
                Uuid::new_v4(),
                &pinned,
                duplicate_environment_id,
                "primary",
                "Duplicate",
            )
            .await,
        Err(AppError::Blocked { .. })
    ));
    let environments = knowledge
        .agent_knowledge_environments(&pinned)
        .await
        .unwrap();
    assert_eq!(environments.len(), 1);
    assert_eq!(environments[0].graph_revision_count, 0);
    let environment_scope = knowledge
        .knowledge_session_scope(&pinned, Some(environment_id))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(environment_scope.knowledge_grant_id, None);
    assert!(environment_scope.graph_revision_ids.is_empty());
    assert_eq!(environment_scope.connections.len(), 1);
    assert_eq!(environment_scope.sources.len(), 1);
    assert_eq!(environment_scope.sources[0].source_id, source_id);
    assert_eq!(environment_scope.sources[0].commit_sha, "7".repeat(40));
    assert!(knowledge
        .exact_knowledge_session_graphs(&environment_scope, workspace_id, user.id.as_str())
        .await
        .unwrap()
        .is_empty());

    // A transient hosted-inventory miss may tombstone the local cache before
    // the same immutable binding is observed again. Reconciliation must revive
    // that exact binding instead of leaving Agent Environment selection empty.
    knowledge
        .revoke_environment_connection(workspace_id, environment_binding_id)
        .await
        .unwrap();
    assert!(knowledge
        .agent_knowledge_environments(&pinned)
        .await
        .unwrap()
        .is_empty());
    let revived = knowledge
        .bind_environment_connection(
            environment_binding_id,
            &pinned,
            environment_id,
            "primary",
            "Primary",
        )
        .await
        .unwrap();
    assert_eq!(revived.id, environment_binding_id);
    assert_eq!(
        knowledge
            .agent_knowledge_environments(&pinned)
            .await
            .unwrap()
            .len(),
        1
    );

    assert_agent_acp_batch_replay_is_bounded(&store, id).await;

    let removed_credential_ids = store
        .sync_remote_connections(workspace_id, &user.id, &[])
        .await
        .unwrap();
    assert!(removed_credential_ids.contains(&id));
    assert!(store.list_connections().await.unwrap().is_empty());
    let binding_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM workspace_connection_bindings WHERE connection_id = ?1",
    )
    .bind(id.to_string())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(binding_count, 0);
}

#[tokio::test]
async fn managed_remote_template_never_reads_or_accepts_a_local_binding() {
    let pool = memory_pool().await;
    sqlx::raw_sql(schema::SCHEMA).execute(&pool).await.unwrap();
    let store = Store::from_pool_for_test(pool);
    let workspace_id = Uuid::new_v4();
    let user = workspace_user("10000000-0000-0000-0000-000000000001", "Owner");
    store
        .sync_account_workspaces(
            &user,
            &[(workspace_id, "Team".into(), WorkspaceRole::Owner)],
        )
        .await
        .unwrap();
    let id = Uuid::new_v4();
    let mut template = sqlite_profile(id, "managed");
    template.workspace_access = crate::model::WorkspaceConnectionAccess::Manage;
    template.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    store
        .sync_remote_connections(workspace_id, &user.id, &[(template.clone(), 1)])
        .await
        .unwrap();
    let credential_id = Uuid::new_v4();
    store
        .bind_connection_credentials(
            id,
            &user.id,
            "member-account",
            &HashMap::new(),
            Some(&credential_id.to_string()),
        )
        .await
        .unwrap();
    template.credential_mode = crate::model::WorkspaceCredentialMode::Managed;
    template.allow_writes = true;
    let provider_target = crate::model::ConnectionProviderTarget::Neon {
        project_id: "project-main".into(),
        branch_id: "br-development".into(),
        branch_name: Some("development".into()),
        current_state: Some(crate::model::NeonBranchState::Ready),
        pending_state: None,
        default: Some(false),
        protected: Some(false),
    };
    template.provider_target = Some(provider_target.clone());
    let removed_credential_ids = store
        .sync_remote_connections(workspace_id, &user.id, &[(template.clone(), 2)])
        .await
        .unwrap();
    assert!(removed_credential_ids.contains(&credential_id));
    store
        .activate_workspace(workspace_id, Some(&user.id))
        .await
        .unwrap();

    let loaded = store.get_connection(id).await.unwrap();
    assert_eq!(
        loaded.credential_mode,
        crate::model::WorkspaceCredentialMode::Managed
    );
    assert!(loaded.username.is_empty());
    assert!(loaded.secret_ref.is_none());
    assert!(loaded.allow_writes);
    assert_eq!(loaded.provider_target, Some(provider_target));
    assert!(
        sqlx::query("UPDATE connections SET extra_params = '{' WHERE id = ?1")
            .bind(id.to_string())
            .execute(store.pool())
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE connections SET provider_target = '{' WHERE id = ?1")
            .bind(id.to_string())
            .execute(store.pool())
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE connections SET port = -1 WHERE id = ?1")
            .bind(id.to_string())
            .execute(store.pool())
            .await
            .is_err()
    );
    let unchanged = store.get_connection(id).await.unwrap();
    assert_eq!(unchanged.port, loaded.port);
    assert_eq!(unchanged.extra_params, loaded.extra_params);
    assert_eq!(unchanged.provider_target, loaded.provider_target);
    assert!(!store.get_safety(id).await.unwrap().allow_writes);
    let mut device_safety = store.get_safety(id).await.unwrap();
    device_safety.allow_writes = true;
    assert!(store
        .set_safety(id, 2, false, &device_safety)
        .await
        .unwrap());
    store
        .sync_remote_connections(workspace_id, &user.id, &[(template.clone(), 3)])
        .await
        .unwrap();
    assert!(store.get_safety(id).await.unwrap().allow_writes);
    template.engine = crate::model::Engine::Postgres;
    template.provider = crate::model::Provider::GcpCloudSql;
    template.provider_target = None;
    store
        .sync_remote_connections(workspace_id, &user.id, &[(template.clone(), 4)])
        .await
        .unwrap();
    device_safety.allow_schema_changes = true;
    assert!(store
        .set_safety(id, 4, false, &device_safety)
        .await
        .unwrap());
    assert!(store.get_safety(id).await.unwrap().allow_schema_changes);
    template.allow_writes = false;
    store
        .sync_remote_connections(workspace_id, &user.id, &[(template, 5)])
        .await
        .unwrap();
    let revoked_safety = store.get_safety(id).await.unwrap();
    assert!(!revoked_safety.allow_writes);
    assert!(!revoked_safety.allow_schema_changes);
    let binding_material: (String, String, Option<String>) = sqlx::query_as(
        "SELECT username, extra_params, secret_ref
         FROM workspace_connection_bindings
         WHERE connection_id = ?1 AND account_user_id = ?2",
    )
    .bind(id.to_string())
    .bind(user.id.as_str())
    .fetch_one(store.pool())
    .await
    .unwrap();
    assert_eq!(binding_material, ("".into(), "{}".into(), None));
    assert!(matches!(
        store
            .bind_connection_credentials(
                id,
                &user.id,
                "should-not-persist",
                &HashMap::new(),
                Some(&Uuid::new_v4().to_string()),
            )
            .await,
        Err(AppError::Blocked { .. })
    ));
    let pin = store.pin_connection_for_read(id).await.unwrap();
    assert_eq!(pin.catalog_cache_policy, CatalogCachePolicy::EphemeralOnly);
    let snapshot = catalog_snapshot(id, ":memory:", 'c');
    assert_eq!(
        store.put_catalog_if_current(&pin, &snapshot).await.unwrap(),
        CacheWriteOutcome::NotPersisted
    );
    let cache_rows: i64 = sqlx::query_scalar("SELECT count(*) FROM catalog_cache")
        .fetch_one(store.pool())
        .await
        .unwrap();
    assert_eq!(cache_rows, 0);
}

#[tokio::test]
async fn shared_connection_bindings_are_isolated_per_signed_in_account() {
    let pool = memory_pool().await;
    sqlx::raw_sql(schema::SCHEMA).execute(&pool).await.unwrap();
    let store = Store::from_pool_for_test(pool);
    let workspace_id = Uuid::new_v4();
    let connection_id = Uuid::new_v4();
    let user_a = workspace_user("10000000-0000-0000-0000-000000000001", "Alpha");
    let user_b = workspace_user("20000000-0000-0000-0000-000000000002", "Beta");
    for user in [&user_a, &user_b] {
        store
            .sync_account_workspaces(
                user,
                &[(workspace_id, "Shared".into(), WorkspaceRole::Analyst)],
            )
            .await
            .unwrap();
    }
    let mut template = sqlite_profile(connection_id, "shared");
    template.workspace_access = crate::model::WorkspaceConnectionAccess::Write;
    template.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    template.allow_writes = true;
    let mut read_only_template = template.clone();
    read_only_template.workspace_access = crate::model::WorkspaceConnectionAccess::Read;
    read_only_template.allow_writes = false;
    let missing_binding = crate::connection::fetch_profile_secret(&read_only_template).unwrap_err();
    assert!(matches!(
        &missing_binding,
        AppError::CredentialBindingRequired
    ));
    assert_eq!(missing_binding.kind(), "credentialBindingRequired");
    store
        .sync_remote_connections(workspace_id, &user_a.id, &[(template, 1)])
        .await
        .unwrap();
    let member_local_safety: bool =
        sqlx::query_scalar("SELECT allow_writes FROM connection_safety WHERE connection_id = ?1")
            .bind(connection_id.to_string())
            .fetch_one(store.pool())
            .await
            .unwrap();
    assert!(!member_local_safety);
    store
        .sync_remote_connections(workspace_id, &user_b.id, &[(read_only_template, 1)])
        .await
        .unwrap();
    let ref_a = Uuid::new_v4().to_string();
    let ref_b = Uuid::new_v4().to_string();
    let empty_options = HashMap::new();
    store
        .bind_connection_credentials(
            connection_id,
            &user_a.id,
            "alpha-db-user",
            &empty_options,
            Some(&ref_a),
        )
        .await
        .unwrap();
    store
        .bind_connection_credentials(
            connection_id,
            &user_b.id,
            "beta-db-user",
            &empty_options,
            Some(&ref_b),
        )
        .await
        .unwrap();

    store
        .activate_workspace(workspace_id, Some(&user_a.id))
        .await
        .unwrap();
    let profile_a = store.get_connection(connection_id).await.unwrap();
    assert_eq!(profile_a.username, "alpha-db-user");
    assert_eq!(profile_a.secret_ref.as_deref(), Some(ref_a.as_str()));
    assert_eq!(
        profile_a.workspace_access,
        crate::model::WorkspaceConnectionAccess::Write
    );
    assert!(profile_a.allow_writes);
    assert!(sqlx::query(
        "UPDATE workspace_connection_bindings SET extra_params = '{'
         WHERE connection_id = ?1 AND account_user_id = ?2",
    )
    .bind(connection_id.to_string())
    .bind(user_a.id.as_str())
    .execute(store.pool())
    .await
    .is_err());
    let unchanged_profile_a = store.get_connection(connection_id).await.unwrap();
    assert_eq!(unchanged_profile_a.username, profile_a.username);
    assert_eq!(unchanged_profile_a.extra_params, profile_a.extra_params);
    assert_eq!(unchanged_profile_a.secret_ref, profile_a.secret_ref);
    let execution_pin_a = store.pin_connection_for_read(connection_id).await.unwrap();
    let history_id = Uuid::new_v4();
    let history_sql = format!("SELECT '{}'", "x".repeat(700));
    store
        .insert_history_if_current(
            &execution_pin_a,
            &HistoryEntry {
                id: history_id,
                connection_id,
                sql: history_sql.clone(),
                kind: QueryKind::Read,
                status: "ok".into(),
                row_count: Some(1),
                duration_ms: Some(1),
                error: None,
                executed_at: Utc::now(),
                origin: "manual".into(),
            },
        )
        .await
        .unwrap();
    let audit_sql = format!("SELECT '{}'", "audit".repeat(700));
    let first_audit = crate::audit::record(
        &store,
        crate::audit::RecordArgs {
            connection_id,
            engine: Engine::Sqlite,
            agent_prompt: Some("inspect the shared connection".repeat(30)),
            sql: audit_sql.clone(),
            kind: QueryKind::Read,
            action: "execute".into(),
            approved_by: None,
            affected_estimate: Some(1),
            error: None,
        },
    )
    .await
    .unwrap();
    crate::audit::record(
        &store,
        crate::audit::RecordArgs {
            connection_id,
            engine: Engine::Sqlite,
            agent_prompt: None,
            sql: audit_sql.clone(),
            kind: QueryKind::Read,
            action: "analysis_article:run".into(),
            approved_by: None,
            affected_estimate: Some(1),
            error: None,
        },
    )
    .await
    .unwrap();
    let services_snapshot =
        crate::features::queries::validate_query_service_session_snapshot(serde_json::json!({
            "schemaVersion": 2,
            "id": "document-alpha:1",
            "documentId": "document-alpha",
            "connectionId": connection_id,
            "connectionName": "Shared",
            "consoleTitle": "Alpha query",
            "database": ":memory:",
            "namespace": "main",
            "sql": "SELECT 'alpha'",
            "startedAt": "2026-01-01T00:00:00Z",
            "startedLabel": "00:00:00",
            "updatedAt": 1,
            "status": "completed",
            "result": {"kind": "materialized"}
        }))
        .unwrap();
    store
        .save_query_service_session(workspace_id, user_a.id.as_str(), services_snapshot.clone())
        .await
        .unwrap();

    store
        .activate_workspace(workspace_id, Some(&user_b.id))
        .await
        .unwrap();
    let profile_b = store.get_connection(connection_id).await.unwrap();
    assert_eq!(profile_b.username, "beta-db-user");
    assert_eq!(profile_b.secret_ref.as_deref(), Some(ref_b.as_str()));
    assert_eq!(
        profile_b.workspace_access,
        crate::model::WorkspaceConnectionAccess::Read
    );
    assert!(!profile_b.allow_writes);
    assert!(matches!(
        store
            .insert_history_if_current(
                &execution_pin_a,
                &HistoryEntry {
                    id: Uuid::new_v4(),
                    connection_id,
                    sql: "SELECT 'stale-alpha'".into(),
                    kind: QueryKind::Read,
                    status: "error".into(),
                    row_count: None,
                    duration_ms: None,
                    error: Some("connection failed".into()),
                    executed_at: Utc::now(),
                    origin: "agent".into(),
                },
            )
            .await,
        Err(AppError::Blocked { .. })
    ));
    assert!(store
        .list_history_page(connection_id, None, None, None, None)
        .await
        .unwrap()
        .items
        .is_empty());
    assert!(store
        .list_query_service_sessions(workspace_id, user_b.id.as_str())
        .await
        .unwrap()
        .is_empty());
    assert!(matches!(
        store
            .list_query_service_sessions(workspace_id, user_a.id.as_str())
            .await,
        Err(AppError::Blocked { .. })
    ));
    assert!(matches!(
        store
            .save_query_service_session(workspace_id, user_a.id.as_str(), services_snapshot,)
            .await,
        Err(AppError::Blocked { .. })
    ));
    store
        .activate_workspace(workspace_id, Some(&user_a.id))
        .await
        .unwrap();
    let history_page = store
        .list_history_page(connection_id, None, None, None, None)
        .await
        .unwrap();
    assert_eq!(history_page.items.len(), 1);
    assert!(history_page.items[0].sql_truncated);
    assert_eq!(history_page.items[0].sql_preview.chars().count(), 512);
    assert_eq!(
        store
            .get_history_entry(connection_id, history_id)
            .await
            .unwrap()
            .sql,
        history_sql
    );
    let audit_page = crate::audit::page_after(&store, connection_id, None)
        .await
        .unwrap();
    assert_eq!(audit_page.items.len(), 2);
    assert!(audit_page.items.iter().all(|entry| entry.sql_truncated));
    assert_eq!(
        crate::audit::entry(&store, connection_id, first_audit.id)
            .await
            .unwrap()
            .sql,
        audit_sql
    );
    let verification = crate::audit::verify_chain(&store, connection_id)
        .await
        .unwrap();
    assert!(verification.ok);
    assert_eq!(verification.entry_count, 2);
    assert!(verification.tail_hash.is_some());
    sqlx::query("UPDATE audit_log SET sql = 'tampered' WHERE id = ?1")
        .bind(first_audit.id.to_string())
        .execute(store.pool())
        .await
        .unwrap();
    let verification = crate::audit::verify_chain(&store, connection_id)
        .await
        .unwrap();
    assert!(!verification.ok);
    assert_eq!(verification.first_bad_index, Some(0));
    assert_eq!(verification.first_bad_id, Some(first_audit.id));
    assert_eq!(
        store
            .list_query_service_sessions(workspace_id, user_a.id.as_str())
            .await
            .unwrap()
            .len(),
        1
    );
    let removed_for_b = store
        .sync_remote_connections(workspace_id, &user_b.id, &[])
        .await
        .unwrap();
    assert_eq!(removed_for_b, vec![Uuid::parse_str(&ref_b).unwrap()]);
    assert_eq!(
        store
            .get_connection(connection_id)
            .await
            .unwrap()
            .secret_ref
            .as_deref(),
        Some(ref_a.as_str())
    );
    store
        .activate_workspace(workspace_id, Some(&user_b.id))
        .await
        .unwrap();
    assert!(store.list_connections().await.unwrap().is_empty());
    assert!(matches!(
        store.get_connection(connection_id).await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        store
            .bind_connection_credentials(
                connection_id,
                &user_b.id,
                "no-longer-authorized",
                &HashMap::new(),
                None,
            )
            .await,
        Err(AppError::NotFound(_))
    ));
    store
        .activate_workspace(workspace_id, Some(&user_a.id))
        .await
        .unwrap();
    assert_eq!(store.list_connections().await.unwrap().len(), 1);
}

#[tokio::test]
async fn pinned_catalog_cache_rejects_scope_aba_and_keeps_accounts_isolated() {
    let pool = memory_pool().await;
    sqlx::raw_sql(schema::SCHEMA).execute(&pool).await.unwrap();
    let store = Store::from_pool_for_test(pool);
    let workspace_id = Uuid::new_v4();
    let connection_id = Uuid::new_v4();
    let user_a = workspace_user("10000000-0000-0000-0000-000000000001", "Alpha");
    let user_b = workspace_user("20000000-0000-0000-0000-000000000002", "Beta");
    for user in [&user_a, &user_b] {
        store
            .sync_account_workspaces(
                user,
                &[(workspace_id, "Shared".into(), WorkspaceRole::Analyst)],
            )
            .await
            .unwrap();
    }
    let mut template = sqlite_profile(connection_id, "shared");
    template.workspace_access = crate::model::WorkspaceConnectionAccess::Read;
    template.credential_mode = crate::model::WorkspaceCredentialMode::MemberLocal;
    for user in [&user_a, &user_b] {
        store
            .sync_remote_connections(workspace_id, &user.id, &[(template.clone(), 1)])
            .await
            .unwrap();
        store
            .bind_connection_credentials(
                connection_id,
                &user.id,
                &format!("{}-db-user", user.display_name.to_lowercase()),
                &HashMap::new(),
                Some(&Uuid::new_v4().to_string()),
            )
            .await
            .unwrap();
    }

    store
        .activate_workspace(workspace_id, Some(&user_a.id))
        .await
        .unwrap();
    let pin_a = store.pin_connection_for_read(connection_id).await.unwrap();
    assert_eq!(pin_a.scope.workspace_id, workspace_id);
    assert_eq!(pin_a.scope.account_scope.storage_key(), user_a.id.as_str());
    assert_eq!(pin_a.profile.username, "alpha-db-user");
    assert!(pin_a.requires_remote_rbac);
    assert_eq!(pin_a.catalog_cache_policy, CatalogCachePolicy::Persistent);
    assert!(store.is_pin_current(&pin_a).await.unwrap());

    let snapshot = catalog_snapshot(connection_id, ":memory:", 'a');
    assert_eq!(
        store
            .put_catalog_if_current(&pin_a, &snapshot)
            .await
            .unwrap(),
        CacheWriteOutcome::Stored
    );
    assert_eq!(
        store.get_catalog_if_current(&pin_a).await.unwrap().unwrap(),
        snapshot
    );
    store
        .activate_workspace(workspace_id, Some(&user_b.id))
        .await
        .unwrap();
    assert!(!store.is_pin_current(&pin_a).await.unwrap());
    assert_eq!(
        store
            .put_catalog_if_current(&pin_a, &snapshot)
            .await
            .unwrap(),
        CacheWriteOutcome::Stale
    );
    let pin_b = store.pin_connection_for_read(connection_id).await.unwrap();
    assert_eq!(pin_b.scope.account_scope.storage_key(), user_b.id.as_str());
    assert_eq!(pin_b.profile.username, "beta-db-user");
    assert!(store
        .get_catalog_if_current(&pin_b)
        .await
        .unwrap()
        .is_none());

    // Returning to A does not revive an in-flight A pin: generation defeats ABA.
    store
        .activate_workspace(workspace_id, Some(&user_a.id))
        .await
        .unwrap();
    let repinned_a = store.pin_connection_for_read(connection_id).await.unwrap();
    assert!(repinned_a.scope.generation > pin_a.scope.generation);
    assert!(!store.is_pin_current(&pin_a).await.unwrap());
    assert_eq!(
        store
            .get_catalog_if_current(&repinned_a)
            .await
            .unwrap()
            .unwrap(),
        snapshot,
        "a current pin may reuse the same account/revision cache after re-selection"
    );

    // A role-only membership refresh changes the active grant even though the
    // workspace and account tuple are unchanged. The generation must fence every
    // pin issued under the previous role.
    store
        .sync_account_workspaces(
            &user_a,
            &[(workspace_id, "Shared".into(), WorkspaceRole::Viewer)],
        )
        .await
        .unwrap();
    assert!(!store.is_pin_current(&repinned_a).await.unwrap());
    let role_repinned_a = store.pin_connection_for_read(connection_id).await.unwrap();
    assert!(role_repinned_a.scope.generation > repinned_a.scope.generation);
    let unchanged_generation = role_repinned_a.scope.generation;
    let unchanged_connections = store
        .active_connection_authority_fingerprint()
        .await
        .unwrap();
    store
        .sync_account_workspaces(
            &user_a,
            &[(workspace_id, "Shared".into(), WorkspaceRole::Viewer)],
        )
        .await
        .unwrap();
    let unchanged_pin = store.pin_connection_for_read(connection_id).await.unwrap();
    assert_eq!(unchanged_pin.scope.generation, unchanged_generation);
    assert_eq!(
        store
            .active_connection_authority_fingerprint()
            .await
            .unwrap(),
        unchanged_connections,
        "an identical hosted refresh must not invent a runtime authority change"
    );
    let repinned_a = role_repinned_a;

    let refreshed = catalog_snapshot(connection_id, ":memory:", 'd');
    assert_eq!(
        store
            .put_catalog_if_current(&repinned_a, &refreshed)
            .await
            .unwrap(),
        CacheWriteOutcome::Stored
    );
    assert_eq!(
        store
            .get_catalog_if_current(&repinned_a)
            .await
            .unwrap()
            .unwrap(),
        refreshed
    );

    sqlx::query(
        "UPDATE catalog_cache SET captured_at = 'not-a-time'
             WHERE workspace_id = ?1 AND account_scope = ?2 AND connection_id = ?3",
    )
    .bind(workspace_id.to_string())
    .bind(user_a.id.as_str())
    .bind(connection_id.to_string())
    .execute(store.pool())
    .await
    .unwrap();
    assert!(store
        .get_catalog_if_current(&repinned_a)
        .await
        .unwrap()
        .is_none());
    store
        .put_catalog_if_current(&repinned_a, &refreshed)
        .await
        .unwrap();

    sqlx::query(
        "UPDATE catalog_cache SET catalog_json = '{'
             WHERE workspace_id = ?1 AND account_scope = ?2 AND connection_id = ?3",
    )
    .bind(workspace_id.to_string())
    .bind(user_a.id.as_str())
    .bind(connection_id.to_string())
    .execute(store.pool())
    .await
    .unwrap();
    assert!(store
        .get_catalog_if_current(&repinned_a)
        .await
        .unwrap()
        .is_none());
    store
        .put_catalog_if_current(&repinned_a, &refreshed)
        .await
        .unwrap();

    let mut tampered = serde_json::to_value(&refreshed).unwrap();
    tampered["fingerprint"] = serde_json::Value::String("e".repeat(64));
    sqlx::query(
        "UPDATE catalog_cache
             SET fingerprint = ?1, catalog_json = ?2
             WHERE workspace_id = ?3 AND account_scope = ?4 AND connection_id = ?5",
    )
    .bind("e".repeat(64))
    .bind(serde_json::to_string(&tampered).unwrap())
    .bind(workspace_id.to_string())
    .bind(user_a.id.as_str())
    .bind(connection_id.to_string())
    .execute(store.pool())
    .await
    .unwrap();
    assert!(store
        .get_catalog_if_current(&repinned_a)
        .await
        .unwrap()
        .is_none());
    store
        .put_catalog_if_current(&repinned_a, &refreshed)
        .await
        .unwrap();

    sqlx::query(
        "UPDATE catalog_cache SET catalog_schema_version = 1
             WHERE workspace_id = ?1 AND account_scope = ?2 AND connection_id = ?3",
    )
    .bind(workspace_id.to_string())
    .bind(user_a.id.as_str())
    .bind(connection_id.to_string())
    .execute(store.pool())
    .await
    .unwrap();
    assert!(store
        .get_catalog_if_current(&repinned_a)
        .await
        .unwrap()
        .is_none());
}
