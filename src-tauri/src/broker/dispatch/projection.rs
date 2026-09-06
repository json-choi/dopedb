//! Shared broker authority conversion, wire projection, and stable error mapping.
use super::*;
use crate::features::queries::{AgentQueryRunError, AgentQueryRunPrepareError};

pub(super) fn terminal_authority(
    session: &AuthenticatedSession,
    client_protocol_version: u16,
) -> TerminalAuthority {
    TerminalAuthority {
        terminal_session_id: session.terminal_session_id,
        workspace_id: session.workspace_id,
        account_scope: session.account_scope.clone(),
        scope_generation: session.scope_generation,
        connection_id: session.connection_id,
        connection_revision: session.connection_revision,
        client_protocol_version,
    }
}

pub(super) fn terminal_authority_for_selector(
    session: &AuthenticatedSession,
    selector: &ConnectionSelector,
    client_protocol_version: u16,
) -> Result<TerminalAuthority, ErrorCode> {
    let selected_connection = |id: Uuid| {
        session
            .knowledge_scopes
            .iter()
            .flat_map(|scope| scope.connections.iter())
            .find(|connection| connection.connection_id == id)
    };
    let resource_set_enforced =
        session.agent_plugin_id.is_some() && !session.knowledge_scopes.is_empty();
    let (connection_id, connection_revision) = match selector {
        ConnectionSelector::Current if !resource_set_enforced => {
            (session.connection_id, session.connection_revision)
        }
        ConnectionSelector::Current => {
            let connection = selected_connection(Uuid::from(session.connection_id))
                .ok_or(ErrorCode::ScopeDenied)?;
            (
                ConnectionId::from(connection.connection_id),
                connection.connection_revision,
            )
        }
        ConnectionSelector::Id(id)
            if !resource_set_enforced && *id == Uuid::from(session.connection_id) =>
        {
            (session.connection_id, session.connection_revision)
        }
        ConnectionSelector::Id(id) => {
            let connection = selected_connection(*id).ok_or(ErrorCode::ScopeDenied)?;
            (
                ConnectionId::from(connection.connection_id),
                connection.connection_revision,
            )
        }
        ConnectionSelector::Name(_) => return Err(ErrorCode::ScopeDenied),
    };
    Ok(TerminalAuthority {
        terminal_session_id: session.terminal_session_id,
        workspace_id: session.workspace_id,
        account_scope: session.account_scope.clone(),
        scope_generation: session.scope_generation,
        connection_id,
        connection_revision,
        client_protocol_version,
    })
}

pub(super) fn connection_summary(summary: &AgentConnectionSummary) -> ConnectionSummary {
    ConnectionSummary {
        id: summary.id.into(),
        name: summary.name.clone(),
        engine: database_engine(summary.engine),
        database: summary.database.clone(),
        environment: summary.environment.clone(),
        readonly: summary.readonly,
        allow_writes: summary.allow_writes,
    }
}

pub(super) const fn database_engine(engine: Engine) -> DatabaseEngine {
    match engine {
        Engine::Postgres => DatabaseEngine::Postgres,
        Engine::Mysql => DatabaseEngine::Mysql,
        Engine::Sqlite => DatabaseEngine::Sqlite,
        Engine::Mongodb => DatabaseEngine::Mongodb,
        Engine::Bigquery => DatabaseEngine::Bigquery,
    }
}

pub(super) fn query_health(health: &HealthSnapshot) -> QueryHealth {
    QueryHealth {
        level: health.level.clone(),
        coverage: health.coverage.clone(),
        total_connections: health.total_connections,
        max_connections: health.max_connections,
        connection_usage_percent: health.connection_usage_percent,
        active_queries: health.active_queries,
        long_running_queries: health.long_running_queries,
        lock_waits: health.lock_waits,
        replication_lag_seconds: health.replication_lag_seconds,
        reasons: health.reasons.clone(),
        captured_at: health.captured_at,
    }
}

pub(super) fn query_result(result: &QueryResult) -> QueryResultPage {
    QueryResultPage {
        columns: result.columns.clone(),
        rows: result.rows.clone(),
        row_count: result.row_count,
        truncated: result.truncated,
        duration_ms: result.duration_ms,
    }
}

pub(super) fn document_query_from_protocol(query: ProtocolDocumentQuery) -> DocumentQuery {
    match query {
        ProtocolDocumentQuery::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        } => DocumentQuery::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        },
        ProtocolDocumentQuery::Aggregate {
            collection,
            pipeline,
        } => DocumentQuery::Aggregate {
            collection,
            pipeline,
        },
        ProtocolDocumentQuery::Count { collection, filter } => {
            DocumentQuery::Count { collection, filter }
        }
    }
}

pub(super) fn document_query_to_protocol(query: &DocumentQuery) -> ProtocolDocumentQuery {
    match query {
        DocumentQuery::Find {
            collection,
            filter,
            projection,
            sort,
            skip,
            limit,
        } => ProtocolDocumentQuery::Find {
            collection: collection.clone(),
            filter: filter.clone(),
            projection: projection.clone(),
            sort: sort.clone(),
            skip: *skip,
            limit: *limit,
        },
        DocumentQuery::Aggregate {
            collection,
            pipeline,
        } => ProtocolDocumentQuery::Aggregate {
            collection: collection.clone(),
            pipeline: pipeline.clone(),
        },
        DocumentQuery::Count { collection, filter } => ProtocolDocumentQuery::Count {
            collection: collection.clone(),
            filter: filter.clone(),
        },
    }
}

pub(super) fn document_page(page: &DocumentPage) -> ProtocolDocumentPage {
    ProtocolDocumentPage {
        documents: page.documents.clone(),
        doc_count: page.doc_count,
        truncated: page.truncated,
        duration_ms: page.duration_ms,
    }
}

pub(super) fn namespace_name(namespace: &Option<String>) -> String {
    namespace.clone().unwrap_or_else(|| "default".into())
}

pub(super) fn validate_sql(sql: &str) -> Result<(), ErrorCode> {
    if sql.trim().is_empty() || sql.len() > MAX_SQL_BYTES || sql.contains('\0') {
        Err(ErrorCode::InvalidRequest)
    } else {
        Ok(())
    }
}

pub(super) fn map_prepare_error(error: AgentQueryRunPrepareError) -> ErrorCode {
    match error {
        AgentQueryRunPrepareError::UnknownOrAlreadyUsed => ErrorCode::OperationConflict,
        AgentQueryRunPrepareError::Expired => ErrorCode::OperationExpired,
        AgentQueryRunPrepareError::SessionMismatch
        | AgentQueryRunPrepareError::AuthorityChanged => ErrorCode::ScopeDenied,
        AgentQueryRunPrepareError::StoredPlanInvalid => ErrorCode::InvalidRequest,
        AgentQueryRunPrepareError::Application(error) => map_application_error(error),
    }
}

pub(super) fn map_query_run_error(error: AgentQueryRunError) -> ErrorCode {
    match error {
        AgentQueryRunError::Connection(error) => map_target_error(error),
        AgentQueryRunError::Execution(failure) => map_query_execution_error(failure.error()),
        AgentQueryRunError::ProvenancePersistence(failure) => {
            map_application_error(failure.into_error())
        }
    }
}

pub(super) fn map_document_error(error: AgentDocumentReadError) -> ErrorCode {
    match error {
        AgentDocumentReadError::NonDocumentConnection => ErrorCode::InvalidRequest,
        AgentDocumentReadError::Rejected(rejected) => {
            drop(rejected);
            ErrorCode::PolicyBlocked
        }
        AgentDocumentReadError::Application(error) => map_application_error(error),
        AgentDocumentReadError::Execution(failure) => map_target_error(failure.into_error()),
    }
}

pub(super) fn map_query_execution_error(error: &AppError) -> ErrorCode {
    match error {
        AppError::Timeout(_) | AppError::Db(sqlx::Error::PoolTimedOut) => ErrorCode::Timeout,
        AppError::Db(sqlx::Error::Database(error)) if error.code().as_deref() == Some("57014") => {
            if error.message() == "canceling statement due to statement timeout" {
                ErrorCode::Timeout
            } else {
                ErrorCode::Cancelled
            }
        }
        AppError::Safety(reason) if reason == "query cancelled" => ErrorCode::Cancelled,
        AppError::Safety(reason) if reason.starts_with("query timed out after ") => {
            ErrorCode::Timeout
        }
        _ => ErrorCode::TargetExecutionFailed,
    }
}

pub(super) fn map_target_error(error: AppError) -> ErrorCode {
    match error {
        AppError::Blocked { .. } => ErrorCode::ScopeDenied,
        AppError::CredentialBindingRequired
        | AppError::AuthenticationRequired(_)
        | AppError::ManagedConnectionRecoveryRequired
        | AppError::Config(_)
        | AppError::Parse(_) => ErrorCode::InvalidRequest,
        AppError::Db(_) | AppError::Timeout(_) => map_query_execution_error(&error),
        AppError::Mongo(_) | AppError::Network(_) => ErrorCode::TargetExecutionFailed,
        _ => ErrorCode::Internal,
    }
}

pub(super) fn map_operation_error(error: AppError) -> ErrorCode {
    match error {
        AppError::NotFound(_) => ErrorCode::OperationConflict,
        AppError::Blocked { .. } => ErrorCode::ScopeDenied,
        AppError::OutcomeUnknown(_) => ErrorCode::OperationConflict,
        other => map_application_error(other),
    }
}

pub(super) fn map_application_error(error: AppError) -> ErrorCode {
    match error {
        AppError::Blocked { .. } => ErrorCode::PolicyBlocked,
        AppError::ProposalRequired => ErrorCode::PolicyBlocked,
        AppError::Safety(_) => ErrorCode::PolicyBlocked,
        AppError::CredentialBindingRequired
        | AppError::AuthenticationRequired(_)
        | AppError::ManagedConnectionRecoveryRequired
        | AppError::NotFound(_)
        | AppError::Config(_)
        | AppError::Parse(_) => ErrorCode::InvalidRequest,
        AppError::Db(_) | AppError::Timeout(_) => map_query_execution_error(&error),
        AppError::Mongo(_) => ErrorCode::TargetExecutionFailed,
        AppError::OutcomeUnknown(_) => ErrorCode::OperationConflict,
        AppError::Agent(_)
        | AppError::Network(_)
        | AppError::Keychain(_)
        | AppError::Io(_)
        | AppError::Serialization(_) => ErrorCode::Internal,
    }
}

#[cfg(test)]
pub(super) fn assert_execution_error_contract() {
    use std::borrow::Cow;
    use std::error::Error;

    #[derive(Debug, thiserror::Error)]
    #[error("{message}")]
    struct DriverFailure {
        code: Option<&'static str>,
        message: &'static str,
    }

    impl sqlx::error::DatabaseError for DriverFailure {
        fn message(&self) -> &str {
            self.message
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            self.code.map(Cow::Borrowed)
        }
        fn as_error(&self) -> &(dyn Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    for (code, message, expected) in [
        (
            Some("57014"),
            "canceling statement due to statement timeout",
            ErrorCode::Timeout,
        ),
        (
            Some("57014"),
            "canceling statement due to user request",
            ErrorCode::Cancelled,
        ),
        (
            Some("57014"),
            "query interrupted: private-diagnostic",
            ErrorCode::Cancelled,
        ),
        (
            Some("42601"),
            "syntax error near private-diagnostic",
            ErrorCode::TargetExecutionFailed,
        ),
        (
            Some("P0001"),
            "canceling statement due to statement timeout",
            ErrorCode::TargetExecutionFailed,
        ),
        (
            None,
            "canceling statement due to statement timeout",
            ErrorCode::TargetExecutionFailed,
        ),
    ] {
        let failure = || {
            AppError::Db(sqlx::Error::Database(Box::new(DriverFailure {
                code,
                message,
            })))
        };
        for actual in [
            map_query_execution_error(&failure()),
            map_target_error(failure()),
            map_application_error(failure()),
        ] {
            assert_eq!(actual, expected);
            let envelope = ProtocolError::new(actual, false);
            assert!(!envelope.is_retryable());
            let wire = serde_json::to_string(&envelope).unwrap();
            assert!(!wire.contains("private-diagnostic"));
            assert!(!wire.contains(message));
        }
    }
    assert_eq!(
        map_application_error(AppError::Db(sqlx::Error::PoolTimedOut)),
        ErrorCode::Timeout,
    );
}

#[derive(Clone, Copy)]
pub(super) enum SkillMutation {
    Install,
    Repair,
    Remove,
}

pub(super) fn map_skill_error(error: AppError) -> ErrorCode {
    match error {
        AppError::Blocked { .. } => ErrorCode::OperationConflict,
        AppError::NotFound(_) | AppError::Config(_) => ErrorCode::InvalidRequest,
        AppError::Io(_) | AppError::Serialization(_) => ErrorCode::Internal,
        other => map_application_error(other),
    }
}

pub(super) fn respond<T: Serialize>(
    request_id: Uuid,
    result: Result<T, ErrorCode>,
) -> ResponseEnvelope {
    match result {
        Ok(result) => success(request_id, &result),
        Err(code) => failure(request_id, code, false),
    }
}

pub(super) fn response_at_protocol(
    response: ResponseEnvelope,
    protocol_version: u16,
) -> ResponseEnvelope {
    if let Some(result) = response.result() {
        ResponseEnvelope::success(protocol_version, response.request_id(), result.clone())
    } else if let Some(error) = response.error() {
        ResponseEnvelope::failure(protocol_version, response.request_id(), error.clone())
    } else {
        ResponseEnvelope::failure(
            protocol_version,
            response.request_id(),
            ProtocolError::new(ErrorCode::Internal, false),
        )
    }
}

pub(super) fn success<T: Serialize>(request_id: Uuid, result: &T) -> ResponseEnvelope {
    let response = match serde_json::to_value(result) {
        Ok(result) => ResponseEnvelope::success(PROTOCOL_MAX, request_id, result),
        Err(_) => return failure(request_id, ErrorCode::Internal, false),
    };
    if encode_frame(&response, MAX_RESPONSE_BYTES).is_err() {
        failure(request_id, ErrorCode::ResponseTooLarge, false)
    } else {
        response
    }
}

pub(super) fn failure(request_id: Uuid, code: ErrorCode, retryable: bool) -> ResponseEnvelope {
    ResponseEnvelope::failure(
        PROTOCOL_MAX,
        request_id,
        ProtocolError::new(code, retryable),
    )
}
