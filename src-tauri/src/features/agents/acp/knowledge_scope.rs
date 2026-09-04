//! Exact Project Knowledge resolution port for connection-pinned ACP sessions.

use std::collections::{BTreeSet, HashSet};
use std::future::Future;
use std::pin::Pin;

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::features::knowledge::{domain::KnowledgeSessionScope, KnowledgeFeature};
use crate::kernel::access::PinnedConnection;

use super::super::domain::AcpSessionSummary;

type KnowledgeScopeFuture<'a, T> = Pin<Box<dyn Future<Output = AppResult<T>> + Send + 'a>>;

pub(super) trait AcpKnowledgeScopePort: Send + Sync {
    fn resolve<'a>(
        &'a self,
        connection: &'a PinnedConnection,
        environment_id: Option<Uuid>,
    ) -> KnowledgeScopeFuture<'a, Option<KnowledgeSessionScope>>;

    fn verify<'a>(
        &'a self,
        scope: &'a KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &'a str,
    ) -> KnowledgeScopeFuture<'a, ()>;
}

pub(super) struct FeatureKnowledgeScopePort {
    knowledge: KnowledgeFeature,
}

impl FeatureKnowledgeScopePort {
    pub(super) fn new(knowledge: KnowledgeFeature) -> Self {
        Self { knowledge }
    }
}

impl AcpKnowledgeScopePort for FeatureKnowledgeScopePort {
    fn resolve<'a>(
        &'a self,
        connection: &'a PinnedConnection,
        environment_id: Option<Uuid>,
    ) -> KnowledgeScopeFuture<'a, Option<KnowledgeSessionScope>> {
        Box::pin(async move {
            self.knowledge
                .knowledge_session_scope(connection, environment_id)
                .await
        })
    }

    fn verify<'a>(
        &'a self,
        scope: &'a KnowledgeSessionScope,
        workspace_id: Uuid,
        account_id: &'a str,
    ) -> KnowledgeScopeFuture<'a, ()> {
        Box::pin(async move {
            self.knowledge
                .exact_knowledge_session_graphs(scope, workspace_id, account_id)
                .await
                .map(|_| ())
        })
    }
}

pub(super) fn summary_scopes(summary: &AcpSessionSummary) -> AppResult<Vec<KnowledgeSessionScope>> {
    if summary.knowledge_scopes.is_empty() || summary.knowledge_scopes.len() > 16 {
        return Err(incomplete_scope());
    }
    let project_ids = summary
        .knowledge_scopes
        .iter()
        .map(|scope| scope.project_id)
        .collect::<BTreeSet<_>>();
    if project_ids.len() != 1 || project_ids.contains(&Uuid::nil()) {
        return Err(incomplete_scope());
    }
    let mut environment_ids = BTreeSet::new();
    let mut connection_ids = BTreeSet::new();
    let mut source_ids = BTreeSet::new();
    for scope in &summary.knowledge_scopes {
        validate_scope(scope)?;
        if !environment_ids.insert(scope.project_environment_id)
            || scope
                .connections
                .iter()
                .any(|connection| !connection_ids.insert(connection.connection_id))
            || scope
                .sources
                .iter()
                .any(|source| !source_ids.insert(source.source_id))
        {
            return Err(incomplete_scope());
        }
    }
    Ok(summary.knowledge_scopes.clone())
}

fn validate_scope(scope: &KnowledgeSessionScope) -> AppResult<()> {
    let graph_ids_empty = scope.graph_revision_ids.is_empty();
    if scope.environment_revision == 0
        || scope.authority_connection_id.is_nil()
        || scope.authority_connection_revision <= 0
        || (scope.connections.is_empty() && scope.sources.is_empty())
        || scope.connections.len() > 32
        || scope.sources.len() > 100
        || scope.graph_revision_ids.len() > 100
        || !scope
            .sources
            .iter()
            .all(crate::features::knowledge::domain::KnowledgeSessionSource::validate)
        || scope
            .sources
            .iter()
            .map(|source| source.source_id)
            .collect::<BTreeSet<_>>()
            .len()
            != scope.sources.len()
        || scope
            .connections
            .iter()
            .map(|connection| connection.connection_id)
            .collect::<BTreeSet<_>>()
            .len()
            != scope.connections.len()
        || scope
            .graph_revision_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != scope.graph_revision_ids.len()
        || ((graph_ids_empty && scope.knowledge_grant_id.is_some())
            || (!graph_ids_empty && scope.knowledge_grant_id.is_none()))
    {
        return Err(incomplete_scope());
    }
    Ok(())
}

fn incomplete_scope() -> AppError {
    AppError::Blocked {
        reason: "the persisted Agent Knowledge scope is incomplete".into(),
    }
}

pub(crate) fn narrow_resource_scope(
    scope: &mut KnowledgeSessionScope,
    requested_connection_ids: &[Uuid],
    requested_source_ids: &[Uuid],
) -> AppResult<()> {
    let requested_connections = requested_connection_ids
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let requested_sources = requested_source_ids.iter().copied().collect::<HashSet<_>>();
    if requested_connections.len() != requested_connection_ids.len()
        || requested_sources.len() != requested_source_ids.len()
        || requested_connections.len() > 32
        || requested_sources.len() > 100
        || (requested_connections.is_empty() && requested_sources.is_empty())
        || requested_connections.iter().any(|connection_id| {
            !scope
                .connections
                .iter()
                .any(|connection| connection.connection_id == *connection_id)
        })
        || requested_sources.iter().any(|source_id| {
            !scope
                .sources
                .iter()
                .any(|source| source.source_id == *source_id)
        })
    {
        return Err(AppError::Blocked {
            reason: "the selected Agent Project resource subset is invalid".into(),
        });
    }
    scope
        .connections
        .retain(|connection| requested_connections.contains(&connection.connection_id));
    scope
        .sources
        .retain(|source| requested_sources.contains(&source.source_id));
    // Raw GitHub source browsing is independently pinned by source ID + commit.
    // Graph products remain dormant for an arbitrary source subset until a
    // source-to-graph identity is part of the public grant contract.
    scope.graph_revision_ids.clear();
    scope.knowledge_grant_id = None;
    validate_scope(scope)
}

pub(super) fn resource_context(
    scopes: &[KnowledgeSessionScope],
    write_connection_id: Option<Uuid>,
) -> String {
    let primary = scopes.first().expect("non-empty resource scopes");
    serde_json::to_string_pretty(&serde_json::json!({
        "projectId": primary.project_id,
        "environments": scopes.iter().map(|scope| serde_json::json!({
            "projectEnvironmentId": scope.project_environment_id,
            "environmentRevision": scope.environment_revision,
        })).collect::<Vec<_>>(),
        "databases": scopes.iter().flat_map(|scope| scope.connections.iter()).map(|connection| serde_json::json!({
            "connectionId": connection.connection_id,
            "role": connection.role,
            "alias": connection.alias,
        })).collect::<Vec<_>>(),
        "sources": scopes.iter().flat_map(|scope| scope.sources.iter()).map(|source| serde_json::json!({
            "sourceId": source.source_id,
            "displayName": source.display_name,
            "repository": source.repository,
            "refName": source.ref_name,
            "commitSha": source.commit_sha,
        })).collect::<Vec<_>>(),
        "writeConnectionId": write_connection_id,
    }))
    .expect("credential-free Project resource context is JSON-serializable")
}
