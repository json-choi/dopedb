//! Query and document-read broker handlers.
use super::*;

pub(super) async fn handle(
    dispatcher: &BrokerDispatcher,
    request: &RequestEnvelope,
) -> ResponseEnvelope {
    let request_id = request.request_id;
    let client_protocol_version = request.protocol_version;
    let capability = match request.command {
        CommandName::DocumentRun => BrokerCapability::DocumentRead,
        CommandName::QueryPlan => BrokerCapability::QueryPlan,
        CommandName::QueryRun => BrokerCapability::QueryRun,
        CommandName::QueryCancel | CommandName::OperationCancel => {
            BrokerCapability::OperationCancel
        }
        CommandName::SqlPropose => BrokerCapability::SqlPropose,
        CommandName::OperationShow | CommandName::OperationWait => BrokerCapability::OperationRead,
        _ => return failure(request_id, ErrorCode::InvalidRequest, false),
    };
    let session = match dispatcher.authenticate(request, capability) {
        Ok(session) => session,
        Err((code, retryable)) => return failure(request_id, code, retryable),
    };
    match request.command {
        CommandName::DocumentRun => {
            let arguments = match decode_arguments::<DocumentRunCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .document_run(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::QueryPlan => {
            let arguments = match decode_arguments::<QueryPlanCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .query_plan(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::QueryRun => {
            let arguments = match decode_arguments::<QueryRunCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .query_run(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::QueryCancel => {
            let arguments = match decode_arguments::<QueryCancelCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .cancel_operation(
                        &session,
                        arguments.operation_id,
                        arguments.connection.as_ref(),
                        client_protocol_version,
                    )
                    .await,
            )
        }
        CommandName::SqlPropose => {
            let arguments = match decode_arguments::<SqlProposeCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .sql_propose(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::OperationShow => {
            let arguments = match decode_arguments::<OperationShowCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .show_operation(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::OperationWait => {
            let arguments = match decode_arguments::<OperationWaitCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .wait_operation(&session, arguments, client_protocol_version)
                    .await,
            )
        }
        CommandName::OperationCancel => {
            let arguments = match decode_arguments::<OperationCancelCommand>(request) {
                Ok(arguments) => arguments,
                Err(_) => return failure(request_id, ErrorCode::InvalidRequest, false),
            };
            respond(
                request_id,
                dispatcher
                    .cancel_operation(
                        &session,
                        arguments.operation_id,
                        arguments.connection.as_ref(),
                        client_protocol_version,
                    )
                    .await,
            )
        }
        _ => unreachable!(),
    }
}

impl BrokerDispatcher {
    async fn sql_propose(
        &self,
        session: &AuthenticatedSession,
        arguments: SqlProposeArguments,
        client_protocol_version: u16,
    ) -> Result<OperationSummary, ErrorCode> {
        validate_sql(&arguments.sql)?;
        let connection = self
            .resolve_connection(session, &arguments.connection, client_protocol_version)
            .await?;
        let authority = terminal_authority_for_selector(
            session,
            &arguments.connection,
            client_protocol_version,
        )?;
        if session.agent_plugin_id.is_some()
            && session.write_connection_id != Some(authority.connection_id)
        {
            return Err(ErrorCode::ScopeDenied);
        }
        // An external Agent's proposals are decided only in the bounded approval
        // queue; never create one it could not show. The Agent waits instead.
        if !self
            .external_agent_requests
            .accepts_proposal(session.terminal_session_id)
        {
            return Err(ErrorCode::OperationConflict);
        }
        let receipt = self
            .services()?
            .queries
            .propose_terminal_sql(TerminalSqlProposalRequest {
                connection_id: connection.id.into(),
                sql: arguments.sql,
                database: arguments.database,
                authority: authority.clone(),
            })
            .await
            .map_err(|error| map_application_error(error.into_error()))?;
        // The proposal is approvable only while this exact session holds its
        // grant; the registry hands it to cancellation when the session ends.
        self.sessions
            .track_proposal(session.terminal_session_id, receipt.operation_id.into());
        let summary = self
            .services()?
            .operation
            .show_terminal(&authority, receipt.operation_id.into())
            .await
            .map_err(map_operation_error)?;
        super::external_agent::surface_proposal(self, session.terminal_session_id, &summary);
        Ok(summary)
    }

    async fn show_operation(
        &self,
        session: &AuthenticatedSession,
        arguments: OperationArguments,
        client_protocol_version: u16,
    ) -> Result<OperationSummary, ErrorCode> {
        let authority = match arguments.connection.as_ref() {
            Some(connection) => {
                terminal_authority_for_selector(session, connection, client_protocol_version)?
            }
            None => terminal_authority(session, client_protocol_version),
        };
        self.services()?
            .operation
            .show_terminal(&authority, arguments.operation_id)
            .await
            .map_err(map_operation_error)
    }

    async fn wait_operation(
        &self,
        session: &AuthenticatedSession,
        arguments: OperationWaitArguments,
        client_protocol_version: u16,
    ) -> Result<OperationSummary, ErrorCode> {
        let timeout = Duration::from_millis(arguments.timeout_ms);
        if timeout.is_zero() || timeout > MAX_OPERATION_WAIT {
            return Err(ErrorCode::InvalidRequest);
        }
        let authority = match arguments.connection.as_ref() {
            Some(connection) => {
                terminal_authority_for_selector(session, connection, client_protocol_version)?
            }
            None => terminal_authority(session, client_protocol_version),
        };
        self.services()?
            .operation
            .wait_terminal(&authority, arguments.operation_id, timeout)
            .await
            .map_err(|error| {
                if matches!(error, AppError::Safety(_)) {
                    ErrorCode::Timeout
                } else {
                    map_operation_error(error)
                }
            })
    }

    pub(super) async fn cancel_operation(
        &self,
        session: &AuthenticatedSession,
        operation_id: Uuid,
        connection: Option<&ConnectionSelector>,
        client_protocol_version: u16,
    ) -> Result<OperationSummary, ErrorCode> {
        let authority = match connection {
            Some(connection) => {
                terminal_authority_for_selector(session, connection, client_protocol_version)?
            }
            None => terminal_authority(session, client_protocol_version),
        };
        self.services()?
            .operation
            .cancel_terminal(&authority, operation_id)
            .await
            .map_err(map_operation_error)
    }

    async fn document_run(
        &self,
        session: &AuthenticatedSession,
        arguments: DocumentRunArguments,
        client_protocol_version: u16,
    ) -> Result<DocumentRunResult, ErrorCode> {
        if arguments.max_rows == Some(0) {
            return Err(ErrorCode::InvalidRequest);
        }
        let connection = self
            .resolve_connection(session, &arguments.connection, client_protocol_version)
            .await?;
        let authority = terminal_authority_for_selector(
            session,
            &arguments.connection,
            client_protocol_version,
        )?;
        let receipt = self
            .services()?
            .document
            .run_terminal_read(TerminalDocumentReadRequest {
                connection_id: connection.id,
                query: document_query_from_protocol(arguments.query),
                max_rows: arguments.max_rows,
                authority,
            })
            .await
            .map_err(map_document_error)?;
        let result = receipt.result();
        Ok(DocumentRunResult {
            operation_id: result.operation_id,
            connection_id: result.context.connection_id,
            connection_name: result.context.connection_name.clone(),
            query: document_query_to_protocol(&result.query),
            result: document_page(&result.page),
        })
    }

    async fn query_plan(
        &self,
        session: &AuthenticatedSession,
        arguments: QueryPlanArguments,
        client_protocol_version: u16,
    ) -> Result<QueryPlanResult, ErrorCode> {
        validate_sql(&arguments.sql)?;
        if arguments.max_rows == Some(0) {
            return Err(ErrorCode::InvalidRequest);
        }
        let connection = self
            .resolve_connection(session, &arguments.connection, client_protocol_version)
            .await?;
        let authority = terminal_authority_for_selector(
            session,
            &arguments.connection,
            client_protocol_version,
        )?;
        let receipt = self
            .services()?
            .queries
            .plan_terminal_read(TerminalQueryPlanRequest {
                connection_id: connection.id.into(),
                sql: arguments.sql,
                database: arguments.database,
                max_rows: arguments.max_rows,
                authority,
            })
            .await;
        let receipt = match receipt {
            Ok(receipt) => receipt,
            Err(AgentQueryPlanError::DocumentConnection) => return Err(ErrorCode::InvalidRequest),
            Err(AgentQueryPlanError::NotSingleRead) => return Err(ErrorCode::PolicyBlocked),
            Err(AgentQueryPlanError::Application(error)) => {
                return Err(map_application_error(error))
            }
        };
        let plan = receipt.plan();
        Ok(QueryPlanResult {
            connection_id: plan.connection_id.into(),
            connection_name: plan.connection_name.clone(),
            database: plan.database.clone(),
            environment: plan.environment.clone(),
            plan_id: plan.plan_id.into(),
            decision: plan.decision.clone(),
            notices: plan.notices.clone(),
            suggestions: plan.suggestions.clone(),
            estimated_rows: plan.estimated_rows,
            health: query_health(&plan.health),
            expires_at: plan.expires_at,
        })
    }

    async fn query_run(
        &self,
        session: &AuthenticatedSession,
        arguments: QueryRunArguments,
        client_protocol_version: u16,
    ) -> Result<QueryRunResult, ErrorCode> {
        let authority = match &arguments.connection {
            Some(connection) => {
                terminal_authority_for_selector(session, connection, client_protocol_version)?
            }
            None => terminal_authority(session, client_protocol_version),
        };
        let prepared = self
            .services()?
            .queries
            .prepare_terminal_run(arguments.plan_id.into(), &authority)
            .await
            .map_err(map_prepare_error)?;
        // An open manual transaction (and its uncommitted rows) is visible only to a
        // read on the ACP session's single write target, or to a non-ACP terminal
        // session pinned to that one connection; every other read stays on the
        // database-enforced read-only pool.
        let prepared = if session.agent_plugin_id.is_none()
            || session.write_connection_id == Some(authority.connection_id)
        {
            prepared.within_write_target()
        } else {
            prepared
        };
        let receipt = prepared.execute().await.map_err(map_query_run_error)?;
        let run = receipt.run();
        Ok(QueryRunResult {
            connection_id: run.connection_id.into(),
            connection_name: run.connection_name.clone(),
            database: run.database.clone(),
            plan_id: run.plan_id.into(),
            query_run_id: run.query_run_id.into(),
            planning_decision: run.planning_decision.clone(),
            result: query_result(&run.result),
        })
    }
}
