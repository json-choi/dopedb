use dopedb_protocol::{
    ErrorCode, OperationSummary, QueryCancelArguments, QueryCancelCommand, QueryPlanArguments,
    QueryPlanCommand, QueryPlanResult, QueryRunArguments, QueryRunCommand, QueryRunResult,
    SqlProposeArguments, SqlProposeCommand, MAX_STRING_BYTES,
};
use uuid::Uuid;

use crate::client::{BrokerClient, ClientError};
use crate::commands::connection::{parse_selector, resolve_selector};
use crate::commands::input::read_stdin_utf8;
use crate::output::{self, OutputMode};

const MAX_SQL_INPUT_BYTES: u64 = MAX_STRING_BYTES as u64;

/// Desktop parses the SQL before any target access; an invalid request here is
/// almost always the SQL itself, otherwise the database or connection named.
const SQL_INVALID: &str = "Desktop could not accept this SQL: send exactly one statement that parses in this connection's SQL dialect. If it is valid, check the database it names and the connection's credentials and settings in Desktop";
const SQL_READ_BLOCKED: &str = "Desktop's safety policy blocked this SQL: `dopedb query` runs one read-only statement, so propose a change with `dopedb sql propose` for approval in Desktop. USE, SET, and transaction control are never run; use --database and schema-qualified names instead";
const SQL_PROPOSE_BLOCKED: &str = "Desktop's safety policy blocked this proposal on this connection: USE, SET, and transaction control are never run, so use --database and send one statement. A read-only role or turned-off data changes also block proposals";

#[derive(Clone, Copy)]
enum SqlRequest {
    Read,
    Propose,
}

/// Explain a refusal of SQL text in terms of that SQL rather than the command
/// line; exit codes still follow the stable remote code.
fn sql_refusal(request: SqlRequest) -> impl Fn(ClientError) -> ClientError {
    move |error| match error {
        ClientError::Remote(remote) => {
            let message = match (remote.code(), request) {
                (ErrorCode::InvalidRequest, _) => SQL_INVALID,
                (ErrorCode::PolicyBlocked, SqlRequest::Read) => SQL_READ_BLOCKED,
                (ErrorCode::PolicyBlocked, SqlRequest::Propose) => SQL_PROPOSE_BLOCKED,
                _ => return ClientError::Remote(remote),
            };
            ClientError::Refused {
                message,
                error: remote,
            }
        }
        other => other,
    }
}

pub(crate) async fn plan(
    connection: &str,
    database: Option<String>,
    file: &str,
    max_rows: Option<u64>,
    mode: OutputMode,
) -> Result<(), ClientError> {
    let sql = read_sql(file)?;
    let client = BrokerClient::discover()?;
    let connection = resolve_selector(&client, parse_selector(connection)?).await?;
    let result: QueryPlanResult = client
        .request::<QueryPlanCommand>(&QueryPlanArguments {
            connection,
            database,
            sql,
            max_rows,
        })
        .await
        .map_err(sql_refusal(SqlRequest::Read))?;
    match mode {
        OutputMode::Json => output::write_json(&result),
        OutputMode::Human => output::write_human(&[
            format!("Plan: {}", result.plan_id),
            format!("Connection: {}", result.connection_name),
            format!("Database: {}", result.database),
            format!("Decision: {}", result.decision),
            format!("Expires: {}", result.expires_at),
        ]),
    }
}

pub(crate) async fn run(plan: &str, mode: OutputMode) -> Result<(), ClientError> {
    let plan_id = parse_uuid(plan)?;
    let client = BrokerClient::discover()?;
    let result: QueryRunResult = client
        .request::<QueryRunCommand>(&QueryRunArguments {
            plan_id,
            connection: None,
        })
        .await?;
    match mode {
        OutputMode::Json => output::write_json(&result),
        OutputMode::Human => {
            let mut lines = vec![
                result.result.columns.join("\t"),
                format!(
                    "{} rows{} in {} ms",
                    result.result.row_count,
                    if result.result.truncated {
                        " (truncated)"
                    } else {
                        ""
                    },
                    result.result.duration_ms
                ),
            ];
            lines.extend(
                result
                    .result
                    .rows
                    .iter()
                    .map(|row| serde_json::to_string(row).unwrap_or_else(|_| "[]".into())),
            );
            output::write_human(&lines)
        }
    }
}

pub(crate) async fn cancel(operation_id: &str, mode: OutputMode) -> Result<(), ClientError> {
    let operation_id = parse_uuid(operation_id)?;
    let client = BrokerClient::discover()?;
    let result: OperationSummary = client
        .request::<QueryCancelCommand>(&QueryCancelArguments {
            operation_id,
            connection: None,
        })
        .await?;
    write_operation(&result, mode)
}

pub(crate) async fn propose(
    connection: &str,
    database: Option<String>,
    file: &str,
    mode: OutputMode,
) -> Result<(), ClientError> {
    let sql = read_sql(file)?;
    let client = BrokerClient::discover()?;
    let connection = resolve_selector(&client, parse_selector(connection)?).await?;
    let result: OperationSummary = client
        .request::<SqlProposeCommand>(&SqlProposeArguments {
            connection,
            database,
            sql,
        })
        .await
        .map_err(sql_refusal(SqlRequest::Propose))?;
    write_operation(&result, mode)
}

pub(crate) fn write_operation(
    result: &OperationSummary,
    mode: OutputMode,
) -> Result<(), ClientError> {
    match mode {
        OutputMode::Json => output::write_json(result),
        OutputMode::Human => {
            let mut lines = vec![
                format!("Operation: {}", result.operation_id),
                format!("State: {:?}", result.state),
                format!("Payload: {}", result.payload_hash),
            ];
            if let Some(reason) = &result.decision_reason {
                lines.push(format!("Rejection reason: {reason}"));
            }
            output::write_human(&lines)
        }
    }
}

pub(crate) fn parse_uuid(value: &str) -> Result<Uuid, ClientError> {
    Uuid::parse_str(value).map_err(|_| ClientError::InvalidArguments)
}

fn read_sql(file: &str) -> Result<String, ClientError> {
    read_stdin_utf8(file, MAX_SQL_INPUT_BYTES)
}
