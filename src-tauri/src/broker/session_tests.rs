//! Terminal session capability contract: 256-bit redacted memory-only tokens,
//! exact scope and capability binding, expiry, process binding, and revocation.

use std::str::FromStr;
use std::time::Duration;

use crate::features::knowledge::domain::KnowledgeSessionConnection;

use super::test_support::pinned_connection as pin;
use super::*;

fn registration(plugin_id: dopedb_protocol::AcpPluginId) -> AgentSessionRegisterArguments {
    let root = if cfg!(windows) {
        r"C:\DopeDB"
    } else {
        "/opt/dopedb"
    };
    AgentSessionRegisterArguments {
        plugin_id,
        adapter_bundle_version: "1.0.0".into(),
        runtime_executable: format!("{root}/node"),
        runtime_resolved_executable: format!("{root}/node"),
        runtime_sha256: "ab".repeat(32),
        adapter_entrypoint: format!("{root}/plugins/adapter.js"),
        adapter_entrypoint_sha256: "cd".repeat(32),
        provider_cli_executable: format!("{root}/provider-cli"),
        provider_cli_resolved_executable: format!("{root}/provider-cli"),
        provider_cli_sha256: "ef".repeat(32),
    }
}

#[test]
fn capability_is_256_bit_redacted_and_memory_only() {
    let runtime_id = RuntimeId::from(Uuid::new_v4());
    let registry = BrokerSessionRegistry::new(runtime_id);
    let session_id = TerminalSessionId::from(Uuid::new_v4());
    let issued = registry
        .issue(
            session_id,
            &pin(Uuid::new_v4()),
            [BrokerCapability::QueryPlan],
            Duration::from_secs(60),
        )
        .unwrap();
    assert_eq!(issued.token().len(), SESSION_TOKEN_BYTES * 2);
    assert!(hex::decode(issued.token()).is_ok());
    let debug = format!("{issued:?}");
    assert!(debug.contains("<redacted>"));
    assert!(!debug.contains(issued.token()));
    assert_eq!(issued.terminal_session_id, session_id);
    assert_eq!(registry.len(), 1);

    // The registry's own records never print a bearer or bootstrap token.
    let descriptor = registration(dopedb_protocol::AcpPluginId::Claude);
    let agent_session_id = TerminalSessionId::from(Uuid::new_v4());
    let agent = registry
        .issue_agent(
            agent_session_id,
            &pin(Uuid::new_v4()),
            [BrokerCapability::QueryPlan],
            Duration::from_secs(60),
            descriptor.clone(),
        )
        .unwrap();
    let record_debug = |id| format!("{:?}", *registry.sessions.get(&id).unwrap());
    for (id, token, expected) in [
        (session_id, issued.token(), "bearer:<redacted>"),
        (
            agent_session_id,
            agent.token(),
            "agent_bootstrap:<redacted>",
        ),
    ] {
        let debug = record_debug(id);
        assert!(debug.contains(expected), "{expected} must label the record");
        assert!(
            !debug.contains(token),
            "{expected} must not print its token"
        );
    }
    let root = super::super::peer::current_process_identity_for_test().unwrap();
    registry
        .bind_agent_process(
            &SessionAuthentication::new(agent_session_id.into(), agent.token().to_owned()),
            root,
            &descriptor,
        )
        .unwrap();
    let bound = record_debug(agent_session_id);
    assert!(bound.contains("\"agent_process\""));
    assert!(!bound.contains(agent.token()));
}

#[test]
fn authentication_is_exact_scope_capability_and_revocation_bound() {
    let runtime_id =
        RuntimeId::from(Uuid::from_str("018f0000-1111-7222-8333-444455556666").unwrap());
    let connection_id = ConnectionId::from(Uuid::new_v4());
    let terminal_session_id = TerminalSessionId::from(Uuid::new_v4());
    let registry = BrokerSessionRegistry::new(runtime_id);
    let issued = registry
        .issue(
            terminal_session_id,
            &pin(connection_id.into()),
            [BrokerCapability::QueryPlan],
            Duration::from_secs(60),
        )
        .unwrap();
    let authentication =
        SessionAuthentication::new(issued.terminal_session_id.into(), issued.token().to_owned());
    let authenticated = registry.authenticate(&authentication, None).unwrap();
    assert_eq!(authenticated.terminal_session_id, terminal_session_id);
    assert_eq!(authenticated.runtime_id, runtime_id);
    assert_eq!(authenticated.connection_id, connection_id);
    assert_eq!(authenticated.connection_revision, 11);
    assert_eq!(authenticated.scope_generation, 7);
    assert_eq!(authenticated.knowledge_account_scope.as_str(), "personal");
    assert!(authenticated.require(BrokerCapability::QueryPlan).is_ok());
    assert!(authenticated.require(BrokerCapability::SqlPropose).is_err());

    // A routine hosted-authority refresh pauses new Broker work without
    // deleting the process capability. Confirming the unchanged authority
    // resumes the same session only after the in-flight guard is released.
    let refresh = registry.begin_authority_refresh();
    assert!(registry.authenticate(&authentication, None).is_err());
    assert!(registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(connection_id.into()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
        )
        .is_err());
    registry.confirm_authority();
    assert!(registry.authenticate(&authentication, None).is_err());
    drop(refresh);
    assert!(registry.authenticate(&authentication, None).is_ok());

    // A failed Team-authority verification stays fail closed across the end
    // of its request, then a later proven refresh restores the same capability.
    let failed_refresh = registry.begin_authority_refresh();
    registry.mark_authority_unverified();
    drop(failed_refresh);
    assert!(registry.authenticate(&authentication, None).is_err());
    let recovered_refresh = registry.begin_authority_refresh();
    registry.confirm_authority();
    drop(recovered_refresh);
    assert!(registry.authenticate(&authentication, None).is_ok());

    let wrong = SessionAuthentication::new(issued.terminal_session_id.into(), "00".repeat(32));
    assert!(registry.authenticate(&wrong, None).is_err());

    let root = super::super::peer::current_process_identity_for_test().unwrap();
    let descriptor = registration(dopedb_protocol::AcpPluginId::Claude);
    assert!(registry
        .bind_agent_process(&authentication, root, &descriptor)
        .is_err());

    let agent_session_id = TerminalSessionId::from(Uuid::new_v4());
    let agent = registry
        .issue_agent(
            agent_session_id,
            &pin(connection_id.into()),
            [BrokerCapability::QueryPlan],
            Duration::from_secs(60),
            descriptor.clone(),
        )
        .unwrap();
    let agent_authentication =
        SessionAuthentication::new(agent.terminal_session_id.into(), agent.token().to_owned());
    // Bootstrap capabilities are command-specific and cannot authorize a
    // normal Broker command before registration.
    assert!(registry.authenticate(&agent_authentication, None).is_err());
    let mut wrong_descriptor = descriptor.clone();
    wrong_descriptor.plugin_id = dopedb_protocol::AcpPluginId::Codex;
    assert!(registry
        .bind_agent_process(&agent_authentication, root, &wrong_descriptor)
        .is_err());
    registry
        .bind_agent_process(&agent_authentication, root, &descriptor)
        .unwrap();
    // Registration consumes the bearer atomically; neither ordinary use
    // nor a second registration may reuse it.
    assert!(registry.authenticate(&agent_authentication, None).is_err());
    assert!(registry
        .bind_agent_process(&agent_authentication, root, &descriptor)
        .is_err());

    let process_bound = SessionAuthentication::process_bound(agent_session_id.into());
    assert!(registry.authenticate(&process_bound, Some(&root)).is_ok());
    let reused_pid = super::super::peer::PeerProcessIdentity::for_test(
        root.pid(),
        root.started_at().saturating_add(1),
    );
    assert!(registry
        .authenticate(&process_bound, Some(&reused_pid))
        .is_err());
    let unrelated =
        super::super::peer::PeerProcessIdentity::for_test(root.pid().saturating_add(1), 0);
    assert!(registry
        .authenticate(&process_bound, Some(&unrelated))
        .is_err());
    // Revoking a grant hands every proposal it created to cancellation, so
    // nothing it proposed stays approvable; a late report is cancelled at once.
    let (revoked_sender, mut revoked) = tokio::sync::mpsc::unbounded_channel();
    registry.install_revocation_sink(revoked_sender);
    let proposal = Uuid::new_v4();
    registry.track_proposal(agent_session_id, proposal);
    assert!(registry.is_live(agent_session_id));
    assert!(registry.revoke(agent_session_id));
    assert!(!registry.is_live(agent_session_id));
    let revocation = revoked.try_recv().unwrap();
    assert_eq!(revocation.terminal_session_id, agent_session_id);
    assert_eq!(revocation.operations, vec![proposal]);
    let late = Uuid::new_v4();
    registry.track_proposal(agent_session_id, late);
    assert_eq!(revoked.try_recv().unwrap().operations, vec![late]);
    assert!(registry.authenticate(&process_bound, Some(&root)).is_err());
    assert!(registry.revoke(terminal_session_id));
    assert!(registry.authenticate(&authentication, None).is_err());

    let mut signed_in_personal = pin(connection_id.into());
    signed_in_personal.scope.selected_account_id = Some("account-123".into());
    let signed_in_session_id = TerminalSessionId::from(Uuid::new_v4());
    let signed_in = registry
        .issue(
            signed_in_session_id,
            &signed_in_personal,
            [BrokerCapability::KnowledgeRead],
            Duration::from_secs(60),
        )
        .unwrap();
    let signed_in_authentication = SessionAuthentication::new(
        signed_in.terminal_session_id.into(),
        signed_in.token().to_owned(),
    );
    let signed_in_authenticated = registry
        .authenticate(&signed_in_authentication, None)
        .unwrap();
    assert_eq!(signed_in_authenticated.account_scope.as_str(), "personal");
    assert_eq!(
        signed_in_authenticated.knowledge_account_scope.as_str(),
        "account-123"
    );
}

#[test]
fn connection_revocation_removes_only_matching_sessions() {
    let registry = BrokerSessionRegistry::new(RuntimeId::from(Uuid::new_v4()));
    let first_connection = ConnectionId::from(Uuid::new_v4());
    let second_connection = ConnectionId::from(Uuid::new_v4());
    let selected_connection = ConnectionId::from(Uuid::new_v4());
    registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(first_connection.into()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
        )
        .unwrap();
    registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(second_connection.into()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
        )
        .unwrap();
    registry
        .issue_agent_with_knowledge(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(second_connection.into()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
            registration(dopedb_protocol::AcpPluginId::Codex),
            AgentKnowledgeAuthorization {
                scopes: vec![KnowledgeSessionScope {
                    project_id: Uuid::new_v4(),
                    project_environment_id: Uuid::new_v4(),
                    environment_revision: 1,
                    authority_connection_id: Uuid::from(second_connection),
                    authority_connection_revision: 11,
                    sources: Vec::new(),
                    connections: vec![KnowledgeSessionConnection {
                        connection_id: Uuid::from(selected_connection),
                        connection_revision: 3,
                        remote_connection_id: None,
                        connection_content_revision: 3,
                        role: "secondary".into(),
                        alias: "Secondary".into(),
                    }],
                }],
                write_connection_id: None,
            },
        )
        .unwrap();
    assert_eq!(registry.revoke_connection(first_connection), 1);
    assert_eq!(registry.len(), 2);
    assert_eq!(registry.revoke_connection(selected_connection), 1);
    assert_eq!(registry.len(), 1);

    // Revoking everything removes every session and hands each one's
    // proposals to cancellation exactly once, including a ledger whose
    // session was already gone.
    let (revoked_sender, mut revoked) = tokio::sync::mpsc::unbounded_channel();
    registry.install_revocation_sink(revoked_sender);
    let remaining = registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(first_connection.into()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
        )
        .unwrap();
    let proposal = Uuid::new_v4();
    registry.track_proposal(remaining.terminal_session_id, proposal);
    let orphaned = TerminalSessionId::from(Uuid::new_v4());
    let orphaned_proposal = Uuid::new_v4();
    registry.proposals.insert(orphaned, vec![orphaned_proposal]);
    registry.revoke_all();
    assert_eq!(registry.len(), 0);
    assert!(registry.proposals.is_empty());
    assert!(registry
        .authenticate(
            &SessionAuthentication::new(
                remaining.terminal_session_id.into(),
                remaining.token().to_owned(),
            ),
            None,
        )
        .is_err());
    let mut released = std::collections::HashMap::new();
    while let Ok(revocation) = revoked.try_recv() {
        assert!(
            released
                .insert(revocation.terminal_session_id, revocation.operations)
                .is_none(),
            "each session is reported once"
        );
    }
    assert_eq!(released.len(), 3);
    assert_eq!(released[&remaining.terminal_session_id], vec![proposal]);
    assert_eq!(released[&orphaned], vec![orphaned_proposal]);
}

#[test]
fn expired_capability_is_rejected_and_eagerly_removed() {
    let registry = BrokerSessionRegistry::new(RuntimeId::from(Uuid::new_v4()));
    let issued = registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(Uuid::new_v4()),
            [BrokerCapability::ConnectionRead],
            Duration::from_millis(1),
        )
        .unwrap();
    let authentication =
        SessionAuthentication::new(issued.terminal_session_id.into(), issued.token().to_owned());
    std::thread::sleep(Duration::from_millis(5));
    assert!(registry.authenticate(&authentication, None).is_err());
    assert_eq!(registry.len(), 0);

    // A session nothing authenticates with again is still released by the
    // periodic sweep, which reports it so its queued state is dropped too.
    let (revoked_sender, mut revoked) = tokio::sync::mpsc::unbounded_channel();
    registry.install_revocation_sink(revoked_sender);
    let idle = TerminalSessionId::from(Uuid::new_v4());
    registry
        .issue(
            idle,
            &pin(Uuid::new_v4()),
            [BrokerCapability::ConnectionRead],
            Duration::from_millis(1),
        )
        .unwrap();
    std::thread::sleep(Duration::from_millis(5));
    assert_eq!(registry.sweep_expired(), 1);
    assert_eq!(registry.len(), 0);
    assert_eq!(revoked.try_recv().unwrap().terminal_session_id, idle);

    // Agent bootstrap and process-bound sessions fail closed on every
    // malformed, mismatched, foreign-runtime, or expired authentication.
    let root = super::super::peer::current_process_identity_for_test().unwrap();
    let descriptor = registration(dopedb_protocol::AcpPluginId::Claude);
    let issue_agent = |id| {
        registry
            .issue_agent(
                id,
                &pin(Uuid::new_v4()),
                [BrokerCapability::QueryPlan],
                Duration::from_secs(60),
                descriptor.clone(),
            )
            .unwrap()
    };
    let expire = |id| {
        registry.sessions.get_mut(&id).unwrap().metadata.expires_at =
            Utc::now() - chrono::Duration::seconds(1);
    };
    let bootstrap_id = TerminalSessionId::from(Uuid::new_v4());
    let bootstrap = issue_agent(bootstrap_id);
    let bootstrap_auth =
        || SessionAuthentication::new(bootstrap_id.into(), bootstrap.token().to_owned());
    let mut relative = descriptor.clone();
    relative.adapter_entrypoint = "plugins/adapter.js".into();
    let denied = [
        ("relative registration path", bootstrap_auth(), relative),
        (
            "non-hex bootstrap token",
            SessionAuthentication::new(bootstrap_id.into(), "zz".repeat(32)),
            descriptor.clone(),
        ),
        (
            "unknown session",
            SessionAuthentication::new(Uuid::new_v4(), bootstrap.token().to_owned()),
            descriptor.clone(),
        ),
        (
            "missing bootstrap token",
            SessionAuthentication::process_bound(bootstrap_id.into()),
            descriptor.clone(),
        ),
    ];
    for (label, authentication, registration) in denied {
        assert!(
            registry
                .bind_agent_process(&authentication, root, &registration)
                .is_err(),
            "{label} must be denied"
        );
    }
    registry
        .sessions
        .get_mut(&bootstrap_id)
        .unwrap()
        .metadata
        .runtime_id = RuntimeId::from(Uuid::new_v4());
    assert!(registry
        .bind_agent_process(&bootstrap_auth(), root, &descriptor)
        .is_err());
    assert_eq!(
        registry.len(),
        1,
        "a foreign-runtime record is only refused"
    );
    assert!(registry.revoke(bootstrap_id));
    let _ = revoked.try_recv();

    let expired_bootstrap_id = TerminalSessionId::from(Uuid::new_v4());
    let expired_bootstrap = issue_agent(expired_bootstrap_id);
    expire(expired_bootstrap_id);
    assert!(registry
        .bind_agent_process(
            &SessionAuthentication::new(
                expired_bootstrap_id.into(),
                expired_bootstrap.token().to_owned()
            ),
            root,
            &descriptor,
        )
        .is_err());
    assert_eq!(registry.len(), 0, "an expired bootstrap is removed");
    assert_eq!(
        revoked.try_recv().unwrap().terminal_session_id,
        expired_bootstrap_id
    );

    let bound_id = TerminalSessionId::from(Uuid::new_v4());
    let bound = issue_agent(bound_id);
    registry
        .bind_agent_process(
            &SessionAuthentication::new(bound_id.into(), bound.token().to_owned()),
            root,
            &descriptor,
        )
        .unwrap();
    let bearer = registry
        .issue(
            TerminalSessionId::from(Uuid::new_v4()),
            &pin(Uuid::new_v4()),
            [BrokerCapability::ConnectionRead],
            Duration::from_secs(60),
        )
        .unwrap();
    let process_bound = SessionAuthentication::process_bound(bound_id.into());
    assert!(registry.authenticate(&process_bound, Some(&root)).is_ok());
    assert!(
        registry.authenticate(&process_bound, None).is_err(),
        "a process-bound session needs the peer identity"
    );
    assert!(
        registry
            .authenticate(
                &SessionAuthentication::process_bound(bearer.terminal_session_id.into()),
                Some(&root),
            )
            .is_err(),
        "a bearer session cannot be used by process identity alone"
    );
    expire(bound_id);
    assert!(registry.authenticate(&process_bound, Some(&root)).is_err());
    assert!(
        !registry.is_live(bound_id),
        "an expired process session is removed"
    );
    assert_eq!(revoked.try_recv().unwrap().terminal_session_id, bound_id);
    assert_eq!(registry.len(), 1);
}
