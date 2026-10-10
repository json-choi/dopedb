//! ACP-only Analysis Article operations. The Agent supplies declarative
//! content; the authenticated session supplies every authority and revision pin.

use dopedb_protocol::{
    AnalysisArticleListCommand, AnalysisArticleListResult, AnalysisArticleProposeArguments,
    AnalysisArticleProposeCommand, AnalysisArticleRecord, AnalysisArticleRecordResult,
    AnalysisArticleSource, AnalysisArticleUpdateArguments, AnalysisArticleUpdateCommand,
    AnalysisArticleVerifyArguments, AnalysisArticleVerifyCommand, AnalysisRunReceipt,
    AnalysisRunState, SharedAnalysisArticleCreate,
};
use futures::stream::{self, StreamExt, TryStreamExt};
use tauri::Emitter;

use crate::features::analysis_articles::AnalysisDefinitionRunRequest;
use crate::features::knowledge::domain::KnowledgeSessionScope;

use super::*;

/// Granted Article bodies read at once while listing; each is one bounded read.
const ARTICLE_BODY_READ_CONCURRENCY: usize = 4;

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    let capability = match request.command {
        CommandName::AnalysisArticleList => BrokerCapability::AnalysisArticleRead,
        CommandName::AnalysisArticlePropose
        | CommandName::AnalysisArticleUpdate
        | CommandName::AnalysisArticleVerify => BrokerCapability::AnalysisArticlePropose,
        _ => return failure(request_id, ErrorCode::InvalidRequest, false),
    };
    let session = match dispatcher.authenticate(request, capability) {
        Ok(session) => session,
        Err((code, retryable)) => return failure(request_id, code, retryable),
    };
    if session.knowledge_scopes.is_empty() {
        return failure(request_id, ErrorCode::ScopeDenied, false);
    }
    let source = match session.agent_plugin_id {
        Some(dopedb_protocol::AcpPluginId::Claude) => AnalysisArticleSource::DopedbAcpClaude,
        Some(dopedb_protocol::AcpPluginId::Codex) => AnalysisArticleSource::DopedbAcpCodex,
        None => return failure(request_id, ErrorCode::ScopeDenied, false),
    };
    if session.account_scope.as_str() == "personal" {
        return failure(request_id, ErrorCode::ScopeDenied, false);
    }
    let services = match dispatcher.services() {
        Ok(services) => services,
        Err(code) => return failure(request_id, code, false),
    };
    for scope in &session.knowledge_scopes {
        if let Err(error) = services
            .knowledge
            .exact_knowledge_session_graphs(
                scope,
                Uuid::from(session.workspace_id),
                session.account_scope.as_str(),
            )
            .await
        {
            return failure(request_id, map_application_error(error), false);
        }
    }

    let result = match request.command {
        CommandName::AnalysisArticleList => {
            if decode_arguments::<AnalysisArticleListCommand>(request).is_err() {
                Err(ErrorCode::InvalidRequest)
            } else {
                match list_granted_articles(services, &session).await {
                    Ok(articles) => serde_json::to_value(AnalysisArticleListResult { articles })
                        .map_err(|_| ErrorCode::Internal),
                    Err(error) => return failure(request_id, map_application_error(error), false),
                }
            }
        }
        CommandName::AnalysisArticlePropose => {
            let arguments = match decode_arguments::<AnalysisArticleProposeCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            propose(dispatcher, &session, source, arguments).await
        }
        CommandName::AnalysisArticleUpdate => {
            let arguments = match decode_arguments::<AnalysisArticleUpdateCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            update_article(dispatcher, &session, source, arguments).await
        }
        CommandName::AnalysisArticleVerify => {
            let arguments = match decode_arguments::<AnalysisArticleVerifyCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            verify_article(dispatcher, &session, source, arguments).await
        }
        _ => Err(ErrorCode::InvalidRequest),
    };

    respond(request_id, result)
}

/// Workspace membership can expose more Articles than this Agent's exact selected
/// database grant permits: only the exact Environment revision and connection pins pass.
fn article_in_grant(
    scope: &KnowledgeSessionScope,
    project_environment_id: Uuid,
    environment_revision: i64,
    connection_id: Uuid,
    connection_revision: i64,
) -> bool {
    project_environment_id == scope.project_environment_id
        && u64::try_from(environment_revision).ok() == Some(scope.environment_revision)
        && scope.connections.iter().any(|connection| {
            connection.remote_connection_id == Some(connection_id)
                && connection.connection_content_revision == connection_revision
        })
}

/// Filters the bounded title-only listing by the exact grant first, so a few large
/// bodies elsewhere cannot exceed one collection response cap, then reads only the
/// granted bodies and checks the same pins on what was actually read.
async fn list_granted_articles(
    services: &ApplicationServices,
    session: &AuthenticatedSession,
) -> Result<Vec<AnalysisArticleRecord>, AppError> {
    let account = session.account_scope.as_str();
    let workspace_id = Uuid::from(session.workspace_id);
    let mut articles = Vec::new();
    for scope in &session.knowledge_scopes {
        let granted = services
            .analysis_article
            .list_remote_summaries(account, workspace_id, Some(scope.project_environment_id))
            .await?
            .into_iter()
            .filter(|summary| {
                article_in_grant(
                    scope,
                    summary.project_environment_id,
                    summary.environment_revision,
                    summary.connection_id,
                    summary.connection_revision,
                )
            });
        let bodies = stream::iter(granted.map(|summary| async move {
            match services
                .analysis_article
                .get_remote(account, workspace_id, summary.id)
                .await
            {
                Ok(article) => Ok(Some(article)),
                // Deleted after the listing: no longer part of the result.
                Err(AppError::NotFound(_)) => Ok(None),
                Err(error) => Err(error),
            }
        }))
        .buffered(ARTICLE_BODY_READ_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await?;
        articles.extend(bodies.into_iter().flatten().filter(|article| {
            article_in_grant(
                scope,
                article.project_environment_id,
                article.environment_revision,
                article.connection_id,
                article.connection_revision,
            )
        }));
    }
    Ok(articles)
}

fn article_create(
    scope: &KnowledgeSessionScope,
    connection_id: Uuid,
    source: AnalysisArticleSource,
    definition: dopedb_protocol::AnalysisArticleInputDefinition,
    article_id: Uuid,
) -> Result<SharedAnalysisArticleCreate, ErrorCode> {
    let environment_revision =
        i64::try_from(scope.environment_revision).map_err(|_| ErrorCode::InvalidRequest)?;
    let definition = definition.with_source(source);
    let scoped_connection = scope
        .connections
        .iter()
        .find(|connection| connection.connection_id == connection_id)
        .ok_or(ErrorCode::ScopeDenied)?;
    let remote_connection_id = scoped_connection
        .remote_connection_id
        .ok_or(ErrorCode::ScopeDenied)?;
    let article = SharedAnalysisArticleCreate {
        id: article_id,
        project_environment_id: scope.project_environment_id,
        environment_revision,
        connection_id: remote_connection_id,
        connection_revision: scoped_connection.connection_content_revision,
        definition,
    };
    article
        .validate()
        .then_some(article)
        .ok_or(ErrorCode::InvalidRequest)
}

fn scope_for_connection(
    session: &AuthenticatedSession,
    connection_id: Uuid,
) -> Result<&crate::features::knowledge::domain::KnowledgeSessionScope, ErrorCode> {
    session
        .knowledge_scopes
        .iter()
        .find(|scope| {
            scope
                .connections
                .iter()
                .any(|connection| connection.connection_id == connection_id)
        })
        .ok_or(ErrorCode::ScopeDenied)
}

async fn propose(
    dispatcher: &BrokerDispatcher,
    session: &AuthenticatedSession,
    source: AnalysisArticleSource,
    arguments: AnalysisArticleProposeArguments,
) -> Result<serde_json::Value, ErrorCode> {
    let scope = scope_for_connection(session, arguments.connection_id)?;
    let article = article_create(
        scope,
        arguments.connection_id,
        source,
        arguments.definition,
        Uuid::new_v4(),
    )?;
    let created = dispatcher
        .services()?
        .analysis_article
        .create_remote(
            session.account_scope.as_str(),
            Uuid::from(session.workspace_id),
            &article,
        )
        .await
        .map_err(map_application_error)?;
    emit_changed(dispatcher, created.id, created.revision, "proposed");
    serde_json::to_value(AnalysisArticleRecordResult { article: created })
        .map_err(|_| ErrorCode::Internal)
}

async fn update_article(
    dispatcher: &BrokerDispatcher,
    session: &AuthenticatedSession,
    source: AnalysisArticleSource,
    arguments: AnalysisArticleUpdateArguments,
) -> Result<serde_json::Value, ErrorCode> {
    if arguments.expected_revision < 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    let workspace_id = Uuid::from(session.workspace_id);
    let existing = dispatcher
        .services()?
        .analysis_article
        .get_remote(
            session.account_scope.as_str(),
            workspace_id,
            arguments.article_id,
        )
        .await
        .map_err(map_application_error)?;
    let scope = scope_for_connection(session, arguments.connection_id)?;
    if existing.revision != arguments.expected_revision
        || existing.project_environment_id != scope.project_environment_id
    {
        return Err(ErrorCode::OperationConflict);
    }
    let article = article_create(
        scope,
        arguments.connection_id,
        source,
        arguments.definition,
        arguments.article_id,
    )?;
    if existing.connection_id != article.connection_id
        || existing.connection_revision != article.connection_revision
    {
        return Err(ErrorCode::OperationConflict);
    }
    let updated = dispatcher
        .services()?
        .analysis_article
        .mutate_remote(
            session.account_scope.as_str(),
            workspace_id,
            arguments.article_id,
            arguments.expected_revision,
            &article,
        )
        .await
        .map_err(map_application_error)?;
    emit_changed(dispatcher, updated.id, updated.revision, "updated");
    serde_json::to_value(AnalysisArticleRecordResult { article: updated })
        .map_err(|_| ErrorCode::Internal)
}

async fn verify_article(
    dispatcher: &BrokerDispatcher,
    session: &AuthenticatedSession,
    source: AnalysisArticleSource,
    arguments: AnalysisArticleVerifyArguments,
) -> Result<serde_json::Value, ErrorCode> {
    let article_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let scope = scope_for_connection(session, arguments.connection_id)?;
    let article = article_create(
        scope,
        arguments.connection_id,
        source,
        arguments.definition,
        article_id,
    )?;
    let receipt = dispatcher
        .services()?
        .analysis_article
        .run_definition(AnalysisDefinitionRunRequest {
            workspace_id: Some(Uuid::from(session.workspace_id)),
            project_environment_id: Some(article.project_environment_id),
            article_id,
            article_revision: 1,
            definition: article.definition,
            connection_id: article.connection_id,
            connection_revision: article.connection_revision,
            run_id,
            persist_local_result: false,
        })
        .await
        .map_err(map_application_error)?;
    serde_json::to_value(AnalysisRunReceipt {
        id: receipt.run_id,
        article_id: receipt.article_id,
        article_revision: receipt.article_revision,
        state: AnalysisRunState::Succeeded,
        query_receipts: receipt.query_receipts,
        result: receipt.result,
        result_hash: Some(receipt.result_hash),
        error: None,
        started_at: receipt.started_at,
        finished_at: receipt.finished_at,
    })
    .map_err(|_| ErrorCode::Internal)
}

fn emit_changed(
    dispatcher: &BrokerDispatcher,
    article_id: Uuid,
    revision: i64,
    action: &'static str,
) {
    let Some(app) = &dispatcher.app_handle else {
        return;
    };
    if let Err(error) = app.emit(
        "analysis-article:changed",
        serde_json::json!({
            "articleId": article_id,
            "revision": revision,
            "action": action,
        }),
    ) {
        tracing::warn!(%error, "failed to emit Analysis Article mutation");
    }
}
