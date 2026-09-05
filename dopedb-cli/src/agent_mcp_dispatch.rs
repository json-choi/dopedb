//! MCP tool dispatch and broker request execution.

use super::*;

pub(super) async fn call_tool(
    client: &BrokerClient,
    params: &Value,
    cancellation: &ToolCancellation,
) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "the tool name is required".to_owned())?;
    if is_dormant_knowledge_tool(name) {
        return Err(
            "knowledge graph tools are unavailable; use pinned source and database tools".into(),
        );
    }
    match name {
        TOOL_SESSION_CONTEXT => {
            let _: EmptyArguments = tool_arguments(params)?;
            let connection = broker_request::<ConnectionShowCommand>(
                client,
                &ConnectionSelectorArguments {
                    connection: ConnectionSelector::Current,
                },
            )
            .await?;
            tool_success(&SessionContextResult {
                connection_scope: "current",
                bridge_version: env!("CARGO_PKG_VERSION"),
                connection,
            })
        }
        TOOL_ENVIRONMENT_CONTEXT => {
            let _: EmptyArguments = tool_arguments(params)?;
            let result =
                broker_request::<EnvironmentContextCommand>(client, &EmptyArguments {}).await?;
            tool_success(&result)
        }
        TOOL_CONNECTION_TEST => {
            let arguments: ConnectionArguments = tool_arguments(params)?;
            let result = broker_request::<ConnectionTestCommand>(
                client,
                &ConnectionSelectorArguments {
                    connection: connection_selector(arguments.connection_id),
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_DATABASE_LIST => {
            let arguments: ConnectionArguments = tool_arguments(params)?;
            let result = broker_request::<DatabaseListCommand>(
                client,
                &DatabaseListArguments {
                    connection: connection_selector(arguments.connection_id),
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_SCHEMA_LIST => {
            let arguments: DatabaseArguments = tool_arguments(params)?;
            validate_database(arguments.database.as_deref())?;
            let result = broker_request::<SchemaListCommand>(
                client,
                &CatalogArguments {
                    connection: connection_selector(arguments.connection_id),
                    database: arguments.database,
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_CATALOG_SEARCH => catalog_search(client, tool_arguments(params)?).await,
        TOOL_TABLE_DESCRIBE => {
            let arguments: TableDescribeToolArguments = tool_arguments(params)?;
            validate_database(arguments.database.as_deref())?;
            validate_text(&arguments.table, MAX_TABLE_BYTES, "table")?;
            let result = broker_request::<TableDescribeCommand>(
                client,
                &TableDescribeArguments {
                    connection: connection_selector(arguments.connection_id),
                    database: arguments.database,
                    table: arguments.table,
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_SEARCH => {
            let arguments: KnowledgeSearchArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgeSearchCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_SOURCE_SEARCH => {
            let arguments: SourceSearchArguments = tool_arguments(params)?;
            let result = broker_request::<SourceSearchCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_SOURCE_READ => {
            let arguments: SourceReadArguments = tool_arguments(params)?;
            if arguments.line_end < arguments.line_start
                || arguments.line_end - arguments.line_start >= MAX_SOURCE_READ_LINES
            {
                return Err(format!(
                    "source lineEnd must be at least lineStart and the inclusive range must not exceed {MAX_SOURCE_READ_LINES} lines"
                ));
            }
            validate_text(&arguments.path, MAX_SOURCE_PATH_BYTES, "source path")?;
            let result = broker_request::<SourceReadCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_EXPLAIN => {
            let arguments: KnowledgeNodeArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgeExplainCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_NEIGHBORS => {
            let arguments: KnowledgeNeighborsArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgeNeighborsCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_PATH => {
            let arguments: KnowledgePathArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgePathCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_EVIDENCE => {
            let arguments: KnowledgeEvidenceArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgeEvidenceCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_DIFF => {
            let arguments: KnowledgeDiffArguments = tool_arguments(params)?;
            let result = broker_request::<KnowledgeDiffCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_KNOWLEDGE_MAPPING_PROPOSE => {
            let arguments: KnowledgeMappingProposeArguments = tool_arguments(params)?;
            validate_database(arguments.database.as_deref())?;
            validate_text(
                &arguments.target_identity,
                MAX_KNOWLEDGE_TARGET_IDENTITY_BYTES,
                "mapping target",
            )?;
            let result =
                broker_request::<KnowledgeMappingProposeCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_FUNNEL_TRACE => {
            let arguments: FunnelTraceArguments = tool_arguments(params)?;
            let result = broker_request::<FunnelTraceCommand>(client, &arguments).await?;
            tool_success(&result)
        }
        TOOL_ANALYSIS_ARTICLE_LIST => {
            let _: EmptyArguments = tool_arguments(params)?;
            let result =
                broker_request::<AnalysisArticleListCommand>(client, &EmptyArguments {}).await?;
            tool_success(&result)
        }
        TOOL_ANALYSIS_ARTICLE_VERIFY => {
            let arguments: AnalysisArticleVerifyArguments = tool_arguments(params)?;
            let result =
                analysis_article_request::<AnalysisArticleVerifyCommand>(client, &arguments)
                    .await?;
            tool_success(&result)
        }
        TOOL_ANALYSIS_ARTICLE_PROPOSE => {
            let arguments: AnalysisArticleProposeArguments = tool_arguments(params)?;
            let result =
                analysis_article_request::<AnalysisArticleProposeCommand>(client, &arguments)
                    .await?;
            tool_success(&result)
        }
        TOOL_ANALYSIS_ARTICLE_UPDATE => {
            let arguments: AnalysisArticleUpdateArguments = tool_arguments(params)?;
            let result =
                analysis_article_request::<AnalysisArticleUpdateCommand>(client, &arguments)
                    .await?;
            tool_success(&result)
        }
        TOOL_QUERY_READ => query_read(client, tool_arguments(params)?, cancellation).await,
        TOOL_DOCUMENT_READ => {
            let arguments: DocumentReadToolArguments = tool_arguments(params)?;
            let result = broker_request::<DocumentRunCommand>(
                client,
                &DocumentRunArguments {
                    connection: connection_selector(arguments.connection_id),
                    query: arguments.query,
                    max_rows: arguments.max_rows,
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_SQL_PROPOSE => {
            let arguments: SqlProposeToolArguments = tool_arguments(params)?;
            validate_database(arguments.database.as_deref())?;
            validate_text(&arguments.sql, MAX_STRING_BYTES, "SQL")?;
            let result = broker_request::<SqlProposeCommand>(
                client,
                &SqlProposeArguments {
                    connection: connection_selector(arguments.connection_id),
                    database: arguments.database,
                    sql: arguments.sql,
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_QUERY_CANCEL => {
            let arguments: OperationIdArguments = tool_arguments(params)?;
            let result = broker_request::<QueryCancelCommand>(
                client,
                &QueryCancelArguments {
                    operation_id: arguments.operation_id,
                    connection: arguments.connection_id.map(ConnectionSelector::Id),
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_OPERATION_STATUS => {
            let arguments: OperationIdArguments = tool_arguments(params)?;
            let result = broker_request::<OperationShowCommand>(
                client,
                &OperationArguments {
                    operation_id: arguments.operation_id,
                    connection: arguments.connection_id.map(ConnectionSelector::Id),
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_OPERATION_WAIT => {
            let arguments: OperationWaitToolArguments = tool_arguments(params)?;
            if arguments.timeout_ms == 0 || arguments.timeout_ms > MAX_OPERATION_WAIT_MS {
                return Err("operation wait must be between 1 and 30000 milliseconds".into());
            }
            let result = broker_request::<OperationWaitCommand>(
                client,
                &OperationWaitArguments {
                    operation_id: arguments.operation_id,
                    timeout_ms: arguments.timeout_ms,
                    connection: arguments.connection_id.map(ConnectionSelector::Id),
                },
            )
            .await?;
            tool_success(&result)
        }
        TOOL_OPERATION_CANCEL => {
            let arguments: OperationIdArguments = tool_arguments(params)?;
            let result = broker_request::<OperationCancelCommand>(
                client,
                &OperationArguments {
                    operation_id: arguments.operation_id,
                    connection: arguments.connection_id.map(ConnectionSelector::Id),
                },
            )
            .await?;
            tool_success(&result)
        }
        _ => Err("unknown DopeDB tool".into()),
    }
}

async fn broker_request<C>(
    client: &BrokerClient,
    arguments: &C::Arguments,
) -> Result<C::Result, String>
where
    C: CommandSpec,
{
    broker_request_with_invalid_hint::<C>(client, arguments, None).await
}

async fn analysis_article_request<C>(
    client: &BrokerClient,
    arguments: &C::Arguments,
) -> Result<C::Result, String>
where
    C: CommandSpec,
{
    broker_request_with_invalid_hint::<C>(client, arguments, Some(ANALYSIS_ARTICLE_INVALID_REQUEST))
        .await
}

async fn broker_request_with_invalid_hint<C>(
    client: &BrokerClient,
    arguments: &C::Arguments,
    invalid_request_hint: Option<&'static str>,
) -> Result<C::Result, String>
where
    C: CommandSpec,
{
    for attempt in 0..=AUTHORITY_RETRY_ATTEMPTS {
        match client.request::<C>(arguments).await {
            Ok(result) => return Ok(result),
            Err(ClientError::Remote(error))
                if error.code() == ErrorCode::InvalidRequest && invalid_request_hint.is_some() =>
            {
                return Err(invalid_request_hint
                    .expect("guarded Analysis Article hint")
                    .into());
            }
            Err(ClientError::Remote(error))
                if error.code() == ErrorCode::RuntimeUnavailable && error.is_retryable() =>
            {
                if attempt == AUTHORITY_RETRY_ATTEMPTS {
                    return Err(
                        "DopeDB is revalidating workspace access. The chat is still connected; retry this tool shortly."
                            .into(),
                    );
                }
                // The Desktop returns this receipt before authentication or
                // command dispatch while it verifies hosted workspace authority.
                // Retrying therefore cannot replay a database operation.
                tokio::time::sleep(AUTHORITY_RETRY_DELAY).await;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("the DopeDB runtime is unavailable; retry shortly".into())
}

async fn query_read(
    client: &BrokerClient,
    arguments: QueryReadToolArguments,
    cancellation: &ToolCancellation,
) -> Result<Value, String> {
    validate_database(arguments.database.as_deref())?;
    validate_text(&arguments.sql, MAX_STRING_BYTES, "SQL")?;
    let connection = connection_selector(arguments.connection_id);
    let plan = broker_request::<QueryPlanCommand>(
        client,
        &QueryPlanArguments {
            connection: connection.clone(),
            database: arguments.database,
            sql: arguments.sql,
            max_rows: arguments.max_rows,
        },
    )
    .await?;
    if !matches!(plan.decision.as_str(), "ready" | "caution") {
        return Err(format!(
            "the Broker returned a non-executable query plan decision: {}",
            plan.decision
        ));
    }
    cancellation.set_operation(plan.plan_id, arguments.connection_id);
    let timeout_ms = arguments
        .timeout_ms
        .unwrap_or(DEFAULT_QUERY_READ_TIMEOUT_MS);
    if timeout_ms == 0 || timeout_ms > MAX_QUERY_READ_TIMEOUT_MS {
        return Err("query timeout exceeds the configured bounds".into());
    }
    let run_arguments = QueryRunArguments {
        plan_id: plan.plan_id,
        connection: Some(connection.clone()),
    };
    let run_request = broker_request::<QueryRunCommand>(client, &run_arguments);
    let run = match tokio::time::timeout(Duration::from_millis(timeout_ms), run_request).await {
        Ok(result) => result?,
        Err(_) => {
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                client.request::<QueryCancelCommand>(&QueryCancelArguments {
                    operation_id: plan.plan_id,
                    connection: Some(connection),
                }),
            )
            .await;
            return Err(format!(
                "query timed out after {timeout_ms}ms for connection {}",
                plan.connection_id
            ));
        }
    };
    tool_success(&json!({ "plan": plan, "run": run }))
}

async fn catalog_search(
    client: &BrokerClient,
    arguments: CatalogSearchArguments,
) -> Result<Value, String> {
    validate_database(arguments.database.as_deref())?;
    let query = arguments
        .query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .unwrap_or("*")
        .to_owned();
    validate_text(&query, MAX_CATALOG_SEARCH_QUERY_BYTES, "catalog query")?;
    let requested_limit = arguments.limit.unwrap_or(DEFAULT_CATALOG_MATCHES);
    if arguments.kinds.len() > MAX_CATALOG_SEARCH_KINDS || requested_limit == 0 {
        return Err("catalog search arguments exceed the configured bounds".to_owned());
    }
    let limit = requested_limit.min(MAX_CATALOG_SEARCH_MATCHES);
    let result = broker_request::<CatalogSearchCommand>(
        client,
        &BrokerCatalogSearchArguments {
            connection: connection_selector(arguments.connection_id),
            database: arguments.database,
            query,
            kinds: arguments.kinds,
            limit: Some(limit),
        },
    )
    .await?;
    tool_success(&result)
}
