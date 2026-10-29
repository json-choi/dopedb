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
    match name {
        TOOL_SESSION_CONTEXT => {
            let _: EmptyArguments = tool_arguments(params)?;
            let current = ConnectionSelectorArguments {
                connection: ConnectionSelector::Current,
            };
            // A Project resource set that selected only source repositories has
            // no current database: the Broker denies the anchor connection, so
            // report the pinned resources instead of failing the tool.
            let connection = match client.request::<ConnectionShowCommand>(&current).await {
                Ok(connection) => Some(connection),
                Err(ClientError::Remote(error)) if error.code() == ErrorCode::ScopeDenied => None,
                Err(_) => Some(broker_request::<ConnectionShowCommand>(client, &current).await?),
            };
            match connection {
                Some(connection) => tool_success(&SessionContextResult {
                    connection_scope: "current",
                    bridge_version: env!("CARGO_PKG_VERSION"),
                    connection: Some(connection),
                    resources: None,
                }),
                None => {
                    let resources =
                        broker_request::<EnvironmentContextCommand>(client, &EmptyArguments {})
                            .await?;
                    tool_success(&SessionContextResult {
                        connection_scope: "project_resources",
                        bridge_version: env!("CARGO_PKG_VERSION"),
                        connection: None,
                        resources: Some(resources),
                    })
                }
            }
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
        TOOL_SCHEMA_DIFF => schema_diff(client, tool_arguments(params)?).await,
        TOOL_TABLE_DESCRIBE => table_describe(client, tool_arguments(params)?).await,
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
        TOOL_ANALYSIS_ARTICLE_GUIDE => {
            let _: EmptyArguments = tool_arguments(params)?;
            tool_success(&json!({
                "name": "dopedb-analysis-article",
                "content": include_str!("../../skills/dopedb-analysis-article/SKILL.md"),
            }))
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
            let result = broker_request_with_hints::<SqlProposeCommand>(
                client,
                &SqlProposeArguments {
                    connection: connection_selector(arguments.connection_id),
                    database: arguments.database,
                    sql: arguments.sql,
                },
                SQL_PROPOSE_HINTS,
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
    broker_request_with_hints::<C>(client, arguments, RefusalHints::default()).await
}

async fn analysis_article_request<C>(
    client: &BrokerClient,
    arguments: &C::Arguments,
) -> Result<C::Result, String>
where
    C: CommandSpec,
{
    let hints = RefusalHints {
        invalid_request: Some(ANALYSIS_ARTICLE_INVALID_REQUEST),
        ..RefusalHints::default()
    };
    broker_request_with_hints::<C>(client, arguments, hints).await
}

/// SQL is parsed by Desktop before any target access; its refusals are told
/// in terms the Agent can act on instead of the generic code message.
const SQL_READ_HINTS: RefusalHints = RefusalHints {
    invalid_request: Some(SQL_INVALID_REQUEST),
    policy_blocked: Some(PolicyHint::ReadTool),
    operation_conflict: None,
};
const SQL_PROPOSE_HINTS: RefusalHints = RefusalHints {
    invalid_request: Some(SQL_INVALID_REQUEST),
    policy_blocked: Some(PolicyHint::Fixed(SQL_PROPOSE_POLICY_BLOCKED)),
    operation_conflict: Some(SQL_PROPOSE_CONFLICT),
};

/// Tool-specific text for stable refusals the generic code message explains poorly.
#[derive(Clone, Copy, Default)]
struct RefusalHints {
    invalid_request: Option<&'static str>,
    policy_blocked: Option<PolicyHint>,
    operation_conflict: Option<&'static str>,
}

#[derive(Clone, Copy)]
enum PolicyHint {
    Fixed(&'static str),
    /// A read tool suggests a proposal only when the session has a write target.
    ReadTool,
}

/// The text for a refusal, asking the Broker for the session's write target
/// only on the rare path where the answer depends on it.
async fn refusal_hint(
    client: &BrokerClient,
    hints: RefusalHints,
    code: ErrorCode,
) -> Option<&'static str> {
    match code {
        ErrorCode::InvalidRequest => hints.invalid_request,
        ErrorCode::OperationConflict => hints.operation_conflict,
        ErrorCode::PolicyBlocked => match hints.policy_blocked? {
            PolicyHint::Fixed(text) => Some(text),
            PolicyHint::ReadTool => {
                let writable = client
                    .request::<EnvironmentContextCommand>(&EmptyArguments {})
                    .await
                    .ok()
                    .and_then(|context| context.write_connection_id)
                    .is_some();
                Some(if writable {
                    SQL_READ_POLICY_BLOCKED
                } else {
                    SQL_READ_POLICY_BLOCKED_READ_ONLY
                })
            }
        },
        _ => None,
    }
}

async fn broker_request_with_hints<C>(
    client: &BrokerClient,
    arguments: &C::Arguments,
    hints: RefusalHints,
) -> Result<C::Result, String>
where
    C: CommandSpec,
{
    for attempt in 0..=AUTHORITY_RETRY_ATTEMPTS {
        let error = match client.request::<C>(arguments).await {
            Ok(result) => return Ok(result),
            Err(ClientError::Remote(error)) => error,
            Err(error) => return Err(error.to_string()),
        };
        if let Some(hint) = refusal_hint(client, hints, error.code()).await {
            return Err(hint.into());
        }
        if error.code() != ErrorCode::RuntimeUnavailable || !error.is_retryable() {
            return Err(ClientError::Remote(error).to_string());
        }
        if attempt == AUTHORITY_RETRY_ATTEMPTS {
            return Err(
                "DopeDB is revalidating workspace access. The chat is still connected; retry this tool shortly."
                    .into(),
            );
        }
        // The Desktop returns this receipt before authentication or command
        // dispatch while it verifies hosted workspace authority. Retrying
        // therefore cannot replay a database operation.
        tokio::time::sleep(AUTHORITY_RETRY_DELAY).await;
    }
    Err("the DopeDB runtime is unavailable; retry shortly".into())
}

async fn query_read(
    client: &BrokerClient,
    arguments: QueryReadToolArguments,
    cancellation: &ToolCancellation,
) -> Result<Value, String> {
    validate_database(arguments.database.as_deref())?;
    let preview_rows = arguments.preview_rows.unwrap_or(DEFAULT_QUERY_PREVIEW_ROWS);
    if preview_rows == 0 || preview_rows > MAX_QUERY_PREVIEW_ROWS {
        return Err("previewRows exceeds the configured bounds".into());
    }
    let timeout_ms = arguments
        .timeout_ms
        .unwrap_or(DEFAULT_QUERY_READ_TIMEOUT_MS);
    if timeout_ms == 0 || timeout_ms > MAX_QUERY_READ_TIMEOUT_MS {
        return Err("query timeout exceeds the configured bounds".into());
    }
    let batched = !arguments.reads.is_empty();
    let reads = match (arguments.sql, batched) {
        (Some(sql), false) => vec![QueryReadItem {
            sql,
            max_rows: arguments.max_rows,
        }],
        (None, true) if arguments.reads.len() <= MAX_QUERY_READ_BATCH => arguments.reads,
        (None, true) => {
            return Err(format!(
                "reads accepts at most {MAX_QUERY_READ_BATCH} SQL reads"
            ))
        }
        _ => return Err("provide exactly one of sql or reads".into()),
    };
    for read in &reads {
        validate_text(&read.sql, MAX_STRING_BYTES, "SQL")?;
    }
    let connection = connection_selector(arguments.connection_id);
    if !batched {
        let read = reads.into_iter().next().expect("one validated read");
        let (plan, run) = plan_and_run(
            client,
            &connection,
            arguments.connection_id,
            arguments.database,
            read,
            timeout_ms,
            cancellation,
        )
        .await?;
        return tool_success(&compact::query_read(&plan, run, preview_rows));
    }
    // Independent reads share one tool round trip, but each keeps its own Broker
    // plan, single-use run, timeout, and receipt. The first failure stops the batch:
    // a timeout or session-level error would only repeat, and a failed read should be
    // investigated before more reads run.
    let mut results = Vec::with_capacity(reads.len());
    let mut failure = None;
    for read in reads {
        if failure.is_some() {
            results.push(json!({
                "skipped": "not run because an earlier read in this batch failed",
            }));
            continue;
        }
        let max_rows = read.max_rows.or(arguments.max_rows);
        let outcome = plan_and_run(
            client,
            &connection,
            arguments.connection_id,
            arguments.database.clone(),
            QueryReadItem {
                sql: read.sql,
                max_rows,
            },
            timeout_ms,
            cancellation,
        )
        .await;
        match outcome {
            Ok((plan, run)) => results.push(compact::query_read(&plan, run, preview_rows)),
            Err(error) => {
                results.push(json!({ "error": error }));
                failure = Some(error);
            }
        }
    }
    if let (Some(error), Some(first)) = (&failure, results.first()) {
        if first.get("error").is_some() {
            return Err(format!(
                "read 1 of {} failed and the remaining reads were not run: {error}",
                results.len()
            ));
        }
    }
    tool_success(&json!({ "results": results }))
}

/// The Broker's mandatory plan request followed by its single-use run request.
async fn plan_and_run(
    client: &BrokerClient,
    connection: &ConnectionSelector,
    connection_id: Option<Uuid>,
    database: Option<String>,
    read: QueryReadItem,
    timeout_ms: u64,
    cancellation: &ToolCancellation,
) -> Result<(QueryPlanResult, QueryRunResult), String> {
    let plan = broker_request_with_hints::<QueryPlanCommand>(
        client,
        &QueryPlanArguments {
            connection: connection.clone(),
            database,
            sql: read.sql,
            max_rows: read.max_rows,
        },
        SQL_READ_HINTS,
    )
    .await?;
    if !matches!(plan.decision.as_str(), "ready" | "caution") {
        return Err(format!(
            "the Broker returned a non-executable query plan decision: {}",
            plan.decision
        ));
    }
    cancellation.set_operation(plan.plan_id, connection_id);
    let run_arguments = QueryRunArguments {
        plan_id: plan.plan_id,
        connection: Some(connection.clone()),
    };
    let run_request = broker_request::<QueryRunCommand>(client, &run_arguments);
    // A finished read is no longer a cancellation target for the next read's planning.
    // A timed-out read stays one until its own cancel attempt has been sent.
    match tokio::time::timeout(Duration::from_millis(timeout_ms), run_request).await {
        Ok(run) => {
            cancellation.clear_operation();
            Ok((plan, run?))
        }
        Err(_) => {
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                client.request::<QueryCancelCommand>(&QueryCancelArguments {
                    operation_id: plan.plan_id,
                    connection: Some(connection.clone()),
                }),
            )
            .await;
            cancellation.clear_operation();
            Err(format!(
                "query timed out after {timeout_ms}ms for connection {}",
                plan.connection_id
            ))
        }
    }
}

/// One or more exact relations described in a single conversation entry; an unknown
/// relation is reported beside the others instead of failing the whole call.
async fn table_describe(
    client: &BrokerClient,
    arguments: TableDescribeToolArguments,
) -> Result<Value, String> {
    validate_database(arguments.database.as_deref())?;
    let tables = match (arguments.table, arguments.tables.is_empty()) {
        (Some(table), true) => vec![table],
        (None, false) if arguments.tables.len() <= MAX_TABLE_DESCRIBE_BATCH => arguments.tables,
        (None, false) => {
            return Err(format!(
                "tables accepts at most {MAX_TABLE_DESCRIBE_BATCH} relations"
            ))
        }
        _ => return Err("provide exactly one of table or tables".into()),
    };
    for table in &tables {
        validate_text(table, MAX_TABLE_BYTES, "table")?;
    }
    let single = tables.len() == 1;
    let mut described = Vec::with_capacity(tables.len());
    let mut errors = Vec::new();
    let mut target = None;
    for table in tables {
        match broker_request::<TableDescribeCommand>(
            client,
            &TableDescribeArguments {
                connection: connection_selector(arguments.connection_id),
                database: arguments.database.clone(),
                table: table.clone(),
            },
        )
        .await
        {
            Ok(result) => {
                target.get_or_insert((result.connection_id, result.database));
                described.push(result.relation);
            }
            Err(error) if single => return Err(error),
            Err(error) => errors.push(json!({ "table": table, "error": error })),
        }
    }
    let Some((connection_id, database)) = target else {
        return Err(format!(
            "no requested relation could be described: {}",
            serde_json::to_string(&errors).unwrap_or_default()
        ));
    };
    tool_success(&compact::relations(
        connection_id,
        &database,
        &described,
        errors,
    ))
}

async fn schema_diff(
    client: &BrokerClient,
    arguments: SchemaDiffArguments,
) -> Result<Value, String> {
    let limit = arguments.limit.unwrap_or(100);
    if limit == 0 || limit > 200 {
        return Err("schema diff limit must be between 1 and 200".into());
    }
    if arguments.offset > 0
        && (arguments.baseline_fingerprint.is_none() || arguments.target_fingerprint.is_none())
    {
        return Err("continuing a schema diff requires both returned catalog fingerprints".into());
    }
    let mut result = crate::schema_diff::load(
        client,
        CatalogArguments {
            connection: ConnectionSelector::Id(arguments.baseline_connection_id),
            database: arguments.baseline_database,
        },
        CatalogArguments {
            connection: ConnectionSelector::Id(arguments.target_connection_id),
            database: arguments.target_database,
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    if arguments
        .baseline_fingerprint
        .as_ref()
        .is_some_and(|value| value != &result.baseline.fingerprint)
        || arguments
            .target_fingerprint
            .as_ref()
            .is_some_and(|value| value != &result.target.fingerprint)
    {
        return Err("a catalog changed between schema diff pages; restart from offset 0".into());
    }
    let offset = arguments.offset as usize;
    if offset > result.total {
        return Err("schema diff offset exceeds the total difference count".into());
    }
    let mut bytes = 0;
    let mut page = Vec::new();
    for object in result.objects.into_iter().skip(offset).take(limit as usize) {
        let length = serde_json::to_vec(&object)
            .map_err(|_| "invalid schema diff result")?
            .len();
        if bytes + length > MAX_REQUEST_BYTES / 4 {
            if page.is_empty() {
                return Err("one schema difference exceeds the Agent output limit; inspect that relation with table_describe".into());
            }
            break;
        }
        bytes += length;
        page.push(object);
    }
    let end = offset + page.len();
    result.objects = page;
    tool_success(&json!({
        "diff": result,
        "offset": offset,
        "nextOffset": if end < result.total { Some(end) } else { None },
        "truncated": end < result.total
    }))
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
    tool_success(&compact::catalog_search(result))
}
