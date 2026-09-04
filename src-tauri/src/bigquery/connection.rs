//! BigQuery connection query, catalog, cancellation, and bounded CLI execution.

use super::*;

impl BigQueryConnection {
    pub(crate) fn project(&self) -> &str {
        &self.inner.project
    }

    pub(crate) fn dataset(&self) -> &str {
        &self.inner.dataset
    }

    pub(crate) fn location(&self) -> &str {
        &self.inner.location
    }

    pub(crate) async fn ping(&self) -> AppResult<()> {
        let metadata = self.dataset_metadata().await?;
        validate_dataset_reference(&metadata, self.project(), self.dataset())?;
        Ok(())
    }

    pub(crate) async fn query(
        &self,
        sql: &str,
        max_rows: u64,
        cancellation: Option<&CancelHandle>,
    ) -> AppResult<QueryResult> {
        self.query_with_timeout(sql, max_rows, cancellation, QUERY_TIMEOUT)
            .await
    }

    pub(crate) async fn query_byte_capped(
        &self,
        sql: &str,
        max_rows: u64,
        max_bytes: usize,
        cancellation: Option<&CancelHandle>,
    ) -> AppResult<QueryResult> {
        let mut result = self.query(sql, max_rows, cancellation).await?;
        let mut retained = 0usize;
        let mut keep = result.rows.len();
        for (index, row) in result.rows.iter().enumerate() {
            let bytes = serde_json::to_vec(row)?.len();
            if bytes > max_bytes {
                return Err(AppError::Blocked {
                    reason: format!(
                        "one export row exceeds the {} MiB batch safety limit",
                        max_bytes / 1024 / 1024
                    ),
                });
            }
            if retained.saturating_add(bytes) > max_bytes {
                keep = index;
                result.truncated = true;
                break;
            }
            retained += bytes;
        }
        result.rows.truncate(keep);
        result.row_count = result.rows.len();
        Ok(result)
    }

    pub(crate) async fn dry_run_bytes(&self, sql: &str) -> AppResult<Option<u64>> {
        Ok(self.dry_run(sql, None).await?.total_bytes_processed)
    }

    async fn query_with_timeout(
        &self,
        sql: &str,
        max_rows: u64,
        cancellation: Option<&CancelHandle>,
        timeout: Duration,
    ) -> AppResult<QueryResult> {
        validate_sql(sql)?;
        if cancellation.is_some_and(CancelHandle::is_cancelled) {
            return Err(AppError::Safety("query cancelled".into()));
        }
        let started = Instant::now();
        let dry_run = self.dry_run(sql, cancellation).await?;
        let job_id = format!(
            "dopedb_{}",
            cancellation
                .map(CancelHandle::id)
                .unwrap_or_else(Uuid::new_v4)
                .simple()
        );
        let max_rows = max_rows.min(MAX_LIST_RESULTS);
        let fetch_rows = max_rows.saturating_add(1);
        let job_timeout_ms = timeout
            .saturating_sub(Duration::from_secs(5))
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        let mut args = self.global_args(true);
        args.extend([
            "query".into(),
            "--use_legacy_sql=false".into(),
            format!("--max_rows={fetch_rows}"),
            format!("--maximum_bytes_billed={}", self.inner.maximum_bytes_billed),
            format!("--job_timeout_ms={job_timeout_ms}"),
            format!("--job_id={job_id}"),
        ]);
        let output = match self
            .run_command(&args, Some(sql.as_bytes()), cancellation, timeout)
            .await
        {
            Ok(output) => output,
            Err(CommandFailure::Cancelled) => {
                self.confirm_cancelled_job(&job_id).await?;
                return Err(AppError::Safety("query cancelled".into()));
            }
            Err(CommandFailure::TimedOut) => {
                self.confirm_cancelled_job(&job_id).await?;
                return Err(AppError::Timeout(format!(
                    "BigQuery job exceeded the {} second query limit and was cancelled",
                    timeout.as_secs()
                )));
            }
            Err(CommandFailure::Cleanup) => {
                return Err(AppError::OutcomeUnknown(
                    "the BigQuery client process could not be fully stopped; inspect the exact job in Google Cloud before retrying"
                        .into(),
                ));
            }
            Err(error) => return Err(command_failure(error)),
        };
        ensure_success(&output)?;
        let mut rows = parse_query_rows(&output.stdout, &dry_run.columns)?;
        let truncated = rows.len() > max_rows as usize;
        if truncated {
            rows.truncate(max_rows as usize);
        }
        Ok(QueryResult {
            row_count: rows.len(),
            columns: dry_run.columns,
            rows,
            truncated,
            duration_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn dry_run(&self, sql: &str, cancellation: Option<&CancelHandle>) -> AppResult<DryRun> {
        validate_sql(sql)?;
        let mut args = self.global_args(true);
        args.extend([
            "query".into(),
            "--use_legacy_sql=false".into(),
            "--dry_run=true".into(),
            format!("--maximum_bytes_billed={}", self.inner.maximum_bytes_billed),
        ]);
        let output = self
            .run_command(&args, Some(sql.as_bytes()), cancellation, CONNECT_TIMEOUT)
            .await
            .map_err(command_failure)?;
        ensure_success(&output)?;
        parse_dry_run(&output.stdout)
    }

    pub(super) async fn verify_version(&self) -> AppResult<()> {
        let mut args = self.global_args(false);
        args.push("version".into());
        let output = self
            .run_command(&args, None, None, CONNECT_TIMEOUT)
            .await
            .map_err(command_failure)?;
        ensure_success(&output)?;
        let text = String::from_utf8(output.stdout).map_err(|_| {
            AppError::Config("BigQuery CLI returned non-UTF-8 version output".into())
        })?;
        let version = text
            .split_ascii_whitespace()
            .find_map(|part| {
                Version::parse(part.trim_matches(|c: char| !c.is_ascii_digit() && c != '.')).ok()
            })
            .ok_or_else(|| AppError::Config("BigQuery CLI version could not be verified".into()))?;
        let minimum = Version::parse(MINIMUM_BQ_VERSION).expect("valid BigQuery minimum version");
        if version < minimum {
            return Err(AppError::Config(format!(
                "BigQuery CLI {version} is too old; update Google Cloud CLI to provide bq {minimum} or newer"
            )));
        }
        Ok(())
    }

    pub(super) async fn dataset_metadata(&self) -> AppResult<Value> {
        let mut args = self.global_args(false);
        args.extend([
            "show".into(),
            "--dataset=true".into(),
            format!("{}:{}", self.project(), self.dataset()),
        ]);
        let output = self
            .run_command(&args, None, None, CONNECT_TIMEOUT)
            .await
            .map_err(command_failure)?;
        ensure_success(&output)?;
        parse_json(&output.stdout, "dataset metadata")
    }

    pub(crate) async fn databases(&self) -> AppResult<Vec<String>> {
        let mut args = self.global_args(false);
        args.extend([
            "ls".into(),
            "--datasets=true".into(),
            format!("--max_results={MAX_LIST_RESULTS}"),
            self.project().into(),
        ]);
        let output = self
            .run_command(&args, None, None, CONNECT_TIMEOUT)
            .await
            .map_err(command_failure)?;
        ensure_success(&output)?;
        let value = parse_json(&output.stdout, "dataset list")?;
        let rows = value
            .as_array()
            .ok_or_else(|| AppError::Config("BigQuery returned an invalid dataset list".into()))?;
        if rows.len() > MAX_LIST_RESULTS as usize {
            return Err(AppError::Config(
                "BigQuery dataset list exceeded its bound".into(),
            ));
        }
        let mut datasets = Vec::with_capacity(rows.len());
        for row in rows {
            let reference = row
                .get("datasetReference")
                .and_then(Value::as_object)
                .ok_or_else(|| AppError::Config("BigQuery dataset reference is missing".into()))?;
            let project = reference
                .get("projectId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::Config("BigQuery dataset project is missing".into()))?;
            let dataset = reference
                .get("datasetId")
                .and_then(Value::as_str)
                .filter(|dataset| valid_dataset_id(dataset))
                .ok_or_else(|| AppError::Config("BigQuery dataset ID is invalid".into()))?;
            if project != self.project() {
                return Err(AppError::Config(
                    "BigQuery returned a dataset outside the configured project".into(),
                ));
            }
            datasets.push(dataset.to_owned());
        }
        Ok(datasets)
    }

    pub(crate) async fn overview(&self) -> AppResult<CatalogOverview> {
        let mut args = self.global_args(true);
        args.extend([
            "ls".into(),
            format!("--max_results={MAX_LIST_RESULTS}"),
            format!("{}:{}", self.project(), self.dataset()),
        ]);
        let output = self
            .run_command(&args, None, None, CONNECT_TIMEOUT)
            .await
            .map_err(command_failure)?;
        ensure_success(&output)?;
        let value = parse_json(&output.stdout, "table list")?;
        let rows = value
            .as_array()
            .ok_or_else(|| AppError::Config("BigQuery returned an invalid table list".into()))?;
        if rows.len() > MAX_LIST_RESULTS as usize {
            return Err(AppError::Config(
                "BigQuery table list exceeded its bound".into(),
            ));
        }
        let mut relations = Vec::with_capacity(rows.len());
        for row in rows {
            let reference = validated_table_reference(row, self.project(), self.dataset())?;
            let table_id = reference
                .get("tableId")
                .and_then(Value::as_str)
                .expect("validated table id");
            let raw_type = row.get("type").and_then(Value::as_str).unwrap_or("TABLE");
            relations.push(CatalogOverviewRelation {
                schema: Some(self.dataset().into()),
                name: table_id.into(),
                kind: relation_kind(raw_type).into(),
                native_id: Some(format!(
                    "{}:{}.{}",
                    self.project(),
                    self.dataset(),
                    table_id
                )),
                comment: None,
                row_estimate: None,
                parent: None,
            });
        }
        relations.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(CatalogOverview {
            database: self.dataset().into(),
            namespaces: vec![self.dataset().into()],
            relations,
            detail_state: CatalogOverviewDetailState::Deferred,
        })
    }

    pub(crate) async fn introspect(&self) -> AppResult<Catalog> {
        let qualified = format!("{}.{}", self.project(), self.dataset());
        let sql = format!(
            "SELECT t.table_name, t.table_type, c.column_name, c.data_type, \
             c.is_nullable, c.ordinal_position \
             FROM `{qualified}.INFORMATION_SCHEMA.TABLES` AS t \
             LEFT JOIN `{qualified}.INFORMATION_SCHEMA.COLUMNS` AS c \
             USING (table_catalog, table_schema, table_name) \
             ORDER BY t.table_name, c.ordinal_position"
        );
        let result = self.query(&sql, MAX_LIST_RESULTS, None).await?;
        if result.truncated {
            return Err(AppError::Config(
                "BigQuery schema exceeds the 10,000-column introspection bound".into(),
            ));
        }
        let indexes = column_indexes(
            &result.columns,
            &[
                "table_name",
                "table_type",
                "column_name",
                "data_type",
                "is_nullable",
                "ordinal_position",
            ],
        )?;
        let mut order = Vec::<String>::new();
        let mut tables = HashMap::<String, (String, Vec<Column>)>::new();
        for row in &result.rows {
            let name = cell_string(row, indexes[0], "table_name")?;
            if !valid_table_id(&name) {
                return Err(AppError::Config(
                    "BigQuery returned an invalid table ID".into(),
                ));
            }
            let table_type = cell_string(row, indexes[1], "table_type")?;
            if !tables.contains_key(&name) {
                order.push(name.clone());
                tables.insert(name.clone(), (table_type.clone(), Vec::new()));
            }
            let Some(column_name) = cell_optional_string(row, indexes[2])? else {
                continue;
            };
            if !valid_table_id(&column_name) {
                return Err(AppError::Config(
                    "BigQuery returned an invalid column name".into(),
                ));
            }
            let data_type = cell_string(row, indexes[3], "data_type")?;
            let nullable = cell_string(row, indexes[4], "is_nullable")? == "YES";
            let ordinal = cell_u32(row, indexes[5], "ordinal_position")?;
            tables
                .get_mut(&name)
                .expect("table inserted above")
                .1
                .push(Column {
                    name: column_name,
                    data_type,
                    nullable,
                    ordinal,
                    ..Column::default()
                });
        }
        let mut relations = Vec::new();
        let mut objects = Vec::new();
        for name in order {
            let (table_type, mut columns) = tables
                .remove(&name)
                .expect("ordered BigQuery table remains in map");
            columns.sort_by_key(|column| column.ordinal);
            let native_id = format!("{}:{}.{}", self.project(), self.dataset(), name);
            if table_type.eq_ignore_ascii_case("MATERIALIZED VIEW") {
                objects.push(DatabaseObject {
                    schema: Some(self.dataset().into()),
                    name,
                    kind: "materialized_view".into(),
                    native_id: Some(native_id),
                    ..DatabaseObject::default()
                });
                continue;
            }
            relations.push(Table {
                database: Some(self.dataset().into()),
                schema: Some(self.dataset().into()),
                name,
                kind: if table_type.eq_ignore_ascii_case("VIEW") {
                    "view"
                } else {
                    "table"
                }
                .into(),
                native_id: Some(native_id),
                columns,
                foreign_keys: Vec::new(),
                constraints: Vec::new(),
                indexes: Vec::new(),
                row_estimate: None,
                ..Table::default()
            });
        }
        Ok(Catalog {
            tables: relations,
            objects,
        })
    }

    fn global_args(&self, include_dataset: bool) -> Vec<String> {
        let mut args = vec![
            format!("--bigqueryrc={}", null_device()),
            "--api=https://bigquery.googleapis.com".into(),
            "--format=json".into(),
            "--headless=true".into(),
            "--quiet=true".into(),
            "--debug_mode=false".into(),
            "--disable_ssl_validation=false".into(),
            "--httplib2_debuglevel=0".into(),
            "--synchronous_mode=true".into(),
            format!("--project_id={}", self.project()),
        ];
        if include_dataset {
            args.push(format!(
                "--dataset_id={}:{}",
                self.project(),
                self.dataset()
            ));
            if !self.location().is_empty() {
                args.push(format!("--location={}", self.location()));
            }
        }
        args
    }

    async fn confirm_cancelled_job(&self, job_id: &str) -> AppResult<()> {
        let mut args = self.global_args(false);
        args.extend([
            "cancel".into(),
            format!("--location={}", self.location()),
            format!("{}:{job_id}", self.project()),
        ]);
        match self.run_command(&args, None, None, CANCEL_TIMEOUT).await {
            Ok(output) if output.status.success() => Ok(()),
            _ => Err(AppError::OutcomeUnknown(format!(
                "BigQuery job {job_id} could not be confirmed cancelled; inspect it in Google Cloud before retrying"
            ))),
        }
    }

    async fn run_command(
        &self,
        args: &[String],
        stdin: Option<&[u8]>,
        cancellation: Option<&CancelHandle>,
        timeout: Duration,
    ) -> Result<CommandOutput, CommandFailure> {
        let executable = self.inner.executable.identity.revalidate().await?;
        let mut command = Command::new(executable);
        command
            .args(args)
            .env_clear()
            .env("PATH", safe_path())
            .env("HOME", &self.inner.home)
            .env("CLOUDSDK_CONFIG", &self.inner.cloudsdk_config)
            .env("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")
            .env("CLOUDSDK_CORE_DISABLE_USAGE_REPORTING", "true")
            .env("CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK", "1")
            .env("CLOUDSDK_CORE_LOG_HTTP", "false")
            .env("PYTHONIOENCODING", "utf-8")
            .kill_on_drop(true)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        self.inner.executable.environment.apply(&mut command);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        command.creation_flags(
            windows_sys::Win32::System::Threading::CREATE_NO_WINDOW
                | windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP,
        );
        let mut child = command.spawn().map_err(|_| CommandFailure::Spawn)?;
        let mut tree = match ProcessTree::attach(&child) {
            Ok(tree) => tree,
            Err(_) => {
                let _ = child.start_kill();
                let _ = child.wait().await;
                return Err(CommandFailure::Isolation);
            }
        };
        let stdout = child.stdout.take().ok_or(CommandFailure::Output)?;
        let stderr = child.stderr.take().ok_or(CommandFailure::Output)?;
        let mut child_stdin = child.stdin.take();
        let input = stdin.map(ToOwned::to_owned);
        let io = async move {
            let write = async move {
                if let (Some(mut handle), Some(input)) = (child_stdin.take(), input) {
                    handle
                        .write_all(&input)
                        .await
                        .map_err(|_| CommandFailure::Output)?;
                    handle
                        .shutdown()
                        .await
                        .map_err(|_| CommandFailure::Output)?;
                }
                Ok::<(), CommandFailure>(())
            };
            let read = async move {
                tokio::try_join!(
                    read_bounded(stdout, MAX_OUTPUT_BYTES),
                    read_bounded(stderr, MAX_ERROR_BYTES)
                )
            };
            let (_, (stdout, stderr)) = tokio::try_join!(write, read)?;
            Ok::<_, CommandFailure>((stdout, stderr))
        };
        let result = tokio::select! {
            biased;
            _ = async {
                match cancellation {
                    Some(handle) => handle.cancelled().await,
                    None => std::future::pending::<()>().await,
                }
            } => Err(CommandFailure::Cancelled),
            result = tokio::time::timeout(timeout, io) => match result {
                Ok(result) => result,
                Err(_) => Err(CommandFailure::TimedOut),
            },
        };
        let status = tree
            .terminate_and_reap(&mut child)
            .await
            .map_err(map_process_tree_error)?;
        let (stdout, stderr) = result?;
        Ok(CommandOutput {
            status,
            stdout,
            stderr,
        })
    }
}
