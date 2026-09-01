//! BigQuery CLI response parsing and profile/query validation.

use super::*;

pub(super) fn ensure_success(output: &CommandOutput) -> AppResult<()> {
    if output.status.success() {
        return Ok(());
    }
    Err(safe_cli_error(&output.stderr))
}

pub(super) fn safe_cli_error(stderr: &[u8]) -> AppError {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("reauthentication failed")
        || text.contains("gcloud auth login")
        || text.contains("invalid_grant")
        || text.contains("login required")
    {
        return AppError::AuthenticationRequired("Google Cloud".into());
    }
    if text.contains("access denied")
        || text.contains("permission denied")
        || text.contains("does not have") && text.contains("permission")
    {
        return AppError::Blocked {
            reason:
                "the active Google Cloud CLI account is not allowed to read this BigQuery dataset"
                    .into(),
        };
    }
    if text.contains("not found") || text.contains("notfound") {
        return AppError::Config(
            "the BigQuery project or dataset was not found in the active Google Cloud CLI account"
                .into(),
        );
    }
    if text.contains("maximum bytes billed") || text.contains("bytes billed limit") {
        return AppError::Blocked {
            reason: "the query exceeds this connection's maximum bytes billed limit; no billed query was started"
                .into(),
        };
    }
    AppError::Config(
        "BigQuery CLI rejected the request; verify `bq version`, the active gcloud account, project, dataset, and location"
            .into(),
    )
}

pub(super) fn command_failure(error: CommandFailure) -> AppError {
    match error {
        CommandFailure::Unavailable => AppError::Config(
            "the verified BigQuery CLI executable is no longer available".into(),
        ),
        CommandFailure::Changed => AppError::Blocked {
            reason: "the BigQuery CLI executable changed after verification; restart DopeDB before using it"
                .into(),
        },
        CommandFailure::Spawn => {
            AppError::Config("the verified BigQuery CLI could not be started".into())
        }
        CommandFailure::Isolation => AppError::Blocked {
            reason: "the BigQuery CLI process could not be isolated safely".into(),
        },
        CommandFailure::Cleanup => AppError::OutcomeUnknown(
            "the BigQuery CLI process tree could not be proven stopped".into(),
        ),
        CommandFailure::Output => AppError::Blocked {
            reason: "BigQuery CLI output exceeded the local safety bound or was incomplete".into(),
        },
        CommandFailure::Cancelled => AppError::Safety("query cancelled".into()),
        CommandFailure::TimedOut => {
            AppError::Timeout("BigQuery CLI exceeded its bounded execution time".into())
        }
    }
}

pub(super) fn map_process_tree_error(error: ProcessTreeError) -> CommandFailure {
    match error {
        ProcessTreeError::Isolation => CommandFailure::Isolation,
        ProcessTreeError::Cleanup => CommandFailure::Cleanup,
    }
}

pub(super) fn parse_json(bytes: &[u8], label: &str) -> AppResult<Value> {
    serde_json::from_slice(bytes)
        .map_err(|_| AppError::Config(format!("BigQuery returned invalid {label} JSON")))
}

pub(super) fn parse_dry_run(bytes: &[u8]) -> AppResult<DryRun> {
    let value = parse_json(bytes, "dry-run")?;
    let query = value
        .get("statistics")
        .and_then(|value| value.get("query"))
        .ok_or_else(|| AppError::Config("BigQuery dry-run statistics are missing".into()))?;
    let statement_type = query
        .get("statementType")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Config("BigQuery dry-run statement type is missing".into()))?;
    if statement_type != "SELECT" {
        return Err(AppError::Blocked {
            reason: format!(
                "BigQuery server classified this statement as {statement_type}, not SELECT"
            ),
        });
    }
    let fields = query
        .get("schema")
        .and_then(|value| value.get("fields"))
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::Config("BigQuery dry-run result schema is missing".into()))?;
    let mut seen = HashSet::new();
    let mut columns = Vec::with_capacity(fields.len());
    for field in fields {
        let name = field
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| valid_table_id(name))
            .ok_or_else(|| AppError::Config("BigQuery returned an invalid result column".into()))?;
        if !seen.insert(name.to_owned()) {
            return Err(AppError::Blocked {
                reason: "BigQuery result columns must have unique names".into(),
            });
        }
        columns.push(name.to_owned());
    }
    let total_bytes_processed = query
        .get("totalBytesProcessed")
        .and_then(value_u64)
        .or_else(|| {
            value
                .pointer("/statistics/totalBytesProcessed")
                .and_then(value_u64)
        });
    Ok(DryRun {
        columns,
        total_bytes_processed,
    })
}

pub(super) fn parse_query_rows(bytes: &[u8], columns: &[String]) -> AppResult<Vec<Vec<Value>>> {
    let value = parse_json(bytes, "query result")?;
    let rows = value
        .as_array()
        .ok_or_else(|| AppError::Config("BigQuery query result is not an array".into()))?;
    let expected = columns.iter().map(String::as_str).collect::<HashSet<_>>();
    rows.iter()
        .map(|row| {
            let object = row.as_object().ok_or_else(|| {
                AppError::Config("BigQuery query result contains a non-object row".into())
            })?;
            if object.keys().any(|key| !expected.contains(key.as_str())) {
                return Err(AppError::Config(
                    "BigQuery query result does not match its dry-run schema".into(),
                ));
            }
            Ok(columns
                .iter()
                .map(|column| object.get(column).cloned().unwrap_or(Value::Null))
                .collect())
        })
        .collect()
}

pub(super) fn validate_dataset_reference(
    value: &Value,
    project: &str,
    dataset: &str,
) -> AppResult<()> {
    let reference = value
        .get("datasetReference")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::Config("BigQuery dataset reference is missing".into()))?;
    if reference.get("projectId").and_then(Value::as_str) != Some(project)
        || reference.get("datasetId").and_then(Value::as_str) != Some(dataset)
    {
        return Err(AppError::Config(
            "BigQuery returned metadata for a different project or dataset".into(),
        ));
    }
    Ok(())
}

pub(super) fn validated_table_reference<'a>(
    row: &'a Value,
    project: &str,
    dataset: &str,
) -> AppResult<&'a serde_json::Map<String, Value>> {
    let reference = row
        .get("tableReference")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::Config("BigQuery table reference is missing".into()))?;
    if reference.get("projectId").and_then(Value::as_str) != Some(project)
        || reference.get("datasetId").and_then(Value::as_str) != Some(dataset)
        || !reference
            .get("tableId")
            .and_then(Value::as_str)
            .is_some_and(valid_table_id)
    {
        return Err(AppError::Config(
            "BigQuery returned a table outside the configured dataset".into(),
        ));
    }
    Ok(reference)
}

pub(super) fn exact_string<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter()
        .try_fold(value, |current, segment| current.get(*segment))?
        .as_str()
}

pub(super) fn column_indexes(columns: &[String], required: &[&str]) -> AppResult<Vec<usize>> {
    required
        .iter()
        .map(|name| {
            columns
                .iter()
                .position(|column| column == name)
                .ok_or_else(|| {
                    AppError::Config(format!("BigQuery schema result is missing {name}"))
                })
        })
        .collect()
}

pub(super) fn cell_string(row: &[Value], index: usize, field: &str) -> AppResult<String> {
    row.get(index)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::Config(format!("BigQuery schema {field} is invalid")))
}

pub(super) fn cell_optional_string(row: &[Value], index: usize) -> AppResult<Option<String>> {
    match row.get(index) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(AppError::Config(
            "BigQuery schema column name is invalid".into(),
        )),
    }
}

pub(super) fn cell_u32(row: &[Value], index: usize, field: &str) -> AppResult<u32> {
    row.get(index)
        .and_then(value_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| AppError::Config(format!("BigQuery schema {field} is invalid")))
}

pub(super) fn value_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

pub(super) fn maximum_bytes_billed(profile: &ConnectionProfile) -> AppResult<u64> {
    let value = match profile.extra_params.get("maximumBytesBilled") {
        Some(value) => value.parse::<u64>().ok(),
        None => Some(DEFAULT_MAXIMUM_BYTES_BILLED),
    }
    .filter(|value| (1..=MAXIMUM_BYTES_BILLED_LIMIT).contains(value))
    .ok_or_else(|| {
        AppError::Config(
            "BigQuery maximum bytes billed must be an integer between 1 byte and 10 TiB".into(),
        )
    })?;
    Ok(value)
}

pub(super) fn validate_sql(sql: &str) -> AppResult<()> {
    if sql.trim().is_empty() || sql.len() > MAX_SQL_BYTES || sql.as_bytes().contains(&0) {
        return Err(AppError::Blocked {
            reason: "BigQuery SQL must be non-empty, NUL-free, and at most 1 MiB".into(),
        });
    }
    Ok(())
}

pub(super) fn valid_project_id(value: &str) -> bool {
    (6..=30).contains(&value.len())
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.ends_with('-')
}

pub(super) fn valid_dataset_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

pub(super) fn valid_table_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1024
        && !value.chars().any(char::is_control)
        && !value.contains(['`', '\n', '\r'])
}

pub(super) fn valid_location(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub(super) fn relation_kind(value: &str) -> &'static str {
    if value.eq_ignore_ascii_case("VIEW") {
        "view"
    } else if value.eq_ignore_ascii_case("MATERIALIZED_VIEW")
        || value.eq_ignore_ascii_case("MATERIALIZED VIEW")
    {
        "materialized_view"
    } else {
        "table"
    }
}

#[cfg(windows)]
pub(super) fn null_device() -> &'static str {
    "NUL"
}

#[cfg(not(windows))]
pub(super) fn null_device() -> &'static str {
    "/dev/null"
}

#[cfg(windows)]
pub(super) fn safe_path() -> &'static str {
    r"C:\Windows\System32"
}

#[cfg(not(windows))]
pub(super) fn safe_path() -> &'static str {
    "/usr/bin:/bin:/usr/sbin:/sbin"
}

#[cfg(test)]
pub(crate) fn assert_bigquery_contract() {
    onboarding::assert_onboarding_contract();
    runtime::assert_runtime_contract();
    let authentication_required = safe_cli_error(b"invalid_grant: login required");
    assert_eq!(authentication_required.kind(), "authenticationRequired");
    assert_eq!(
        authentication_required.to_string(),
        "Google Cloud authentication is required",
    );
    assert_eq!(
        serde_json::to_value(&authentication_required)
            .expect("authentication-required error contract"),
        serde_json::json!({
            "kind": "authenticationRequired",
            "message": "Google Cloud authentication is required",
        }),
    );
    assert!(valid_project_id("sample-analytics-2026"));
    assert!(!valid_project_id("Sample-analytics-2026"));
    assert!(valid_dataset_id("analytics_2026"));
    assert!(!valid_dataset_id("analytics-prod"));
    assert!(valid_location("asia-northeast3"));
    let profile = ConnectionProfile {
        id: Uuid::new_v4(),
        name: "BigQuery fixture".into(),
        engine: crate::model::Engine::Bigquery,
        provider: crate::model::Provider::Generic,
        driver_id: Some("google-bq-cli".into()),
        host: "sample-analytics-2026".into(),
        port: 443,
        database: "analytics_2026".into(),
        username: String::new(),
        sslmode: "require".into(),
        extra_params: HashMap::new(),
        readonly_default: true,
        allow_writes: false,
        secret_ref: None,
        env: None,
        schema_group: None,
        workspace_access: crate::model::WorkspaceConnectionAccess::Local,
        credential_mode: crate::model::WorkspaceCredentialMode::Local,
        provider_target: None,
    };
    assert!(validate_profile(&profile).is_ok());
    assert_eq!(
        maximum_bytes_billed(&profile).expect("default billing ceiling"),
        DEFAULT_MAXIMUM_BYTES_BILLED,
    );
    assert!(validate_profile(&ConnectionProfile {
        sslmode: "disable".into(),
        ..profile.clone()
    })
    .is_err());
    assert!(validate_profile(&ConnectionProfile {
        allow_writes: true,
        ..profile
    })
    .is_err());
    let dry_run = parse_dry_run(
        br#"{
          "statistics": {"query": {
            "statementType": "SELECT",
            "totalBytesProcessed": "42",
            "schema": {"fields": [{"name":"count","type":"INTEGER"}]}
          }}
        }"#,
    )
    .expect("valid dry-run fixture");
    assert_eq!(dry_run.columns, ["count"]);
    assert_eq!(dry_run.total_bytes_processed, Some(42));
    let rows = parse_query_rows(br#"[{"count":"9007199254740993"}]"#, &dry_run.columns)
        .expect("valid row fixture");
    assert_eq!(rows, vec![vec![Value::String("9007199254740993".into())]]);
    assert!(matches!(
        parse_dry_run(
            br#"{"statistics":{"query":{"statementType":"INSERT","schema":{"fields":[]}}}}"#
        ),
        Err(AppError::Blocked { .. })
    ));
}
