//! Exact-scope Desktop read adapter for Analysis Article query nodes.

use chrono::Utc;
use dopedb_protocol::{AnalysisColumn, AnalysisQueryReceipt, AnalysisQueryState};
use uuid::Uuid;

use crate::audit::{self, RecordArgs};
use crate::connection::{ConnectionAccess, ConnectionManager, DbPool};
use crate::error::{AppError, AppResult};
use crate::executor::cancel;
use crate::features::knowledge::KnowledgeFeature;
use crate::kernel::access::PinnedConnection;
use crate::model::{Engine, HistoryEntry, QueryKind, QueryResult};
use crate::operations::canonical_hash;
use crate::safety::{self, PoolRef};
use crate::store::Store;

use super::super::domain::AnalysisDataSet;
use super::super::ports::{
    AnalysisReadExecutionOutcome, AnalysisReadExecutionPort, AnalysisReadExecutionRequest,
};

#[derive(Clone)]
pub(crate) struct DesktopAnalysisReadExecution {
    store: Store,
    connections: ConnectionManager,
    knowledge: KnowledgeFeature,
}

impl DesktopAnalysisReadExecution {
    pub(crate) fn new(
        store: Store,
        connections: ConnectionManager,
        knowledge: KnowledgeFeature,
    ) -> Self {
        Self {
            store,
            connections,
            knowledge,
        }
    }
}

impl AnalysisReadExecutionPort for DesktopAnalysisReadExecution {
    async fn execute_read<'a>(
        &'a self,
        request: AnalysisReadExecutionRequest<'a>,
    ) -> AppResult<AnalysisReadExecutionOutcome> {
        let cancellation = cancel::register(request.cancellation_id);
        if cancellation.is_cancelled() {
            return Err(AppError::Safety("Analysis Article run cancelled".into()));
        }
        let operation_scope = self.connections.begin_operation_scope().await;
        let local_connection_id = if let Some(workspace_id) = request.workspace_id {
            self.knowledge
                .local_connection_id_for_remote(workspace_id, request.connection_id)
                .await?
                .ok_or_else(|| AppError::Blocked {
                    reason: format!(
                        "Analysis Article connection '{}' needs a local credential binding on this device",
                        request.connection_id
                    ),
                })?
        } else {
            request.connection_id
        };
        let pin = operation_scope.pin_connection(local_connection_id).await?;
        let expected_authority_revision =
            match (request.workspace_id, request.project_environment_id) {
                (Some(workspace_id), Some(environment_id)) => {
                    let account_id = pin.scope.selected_account_id.as_deref().ok_or_else(|| {
                        AppError::Blocked {
                            reason:
                                "Analysis Article execution requires the selected workspace account"
                                    .into(),
                        }
                    })?;
                    self.knowledge
                        .analysis_connection_authority_revision(
                            account_id,
                            workspace_id,
                            environment_id,
                            request.connection_id,
                            request.connection_revision,
                        )
                        .await?
                }
                _ => request.connection_revision,
            };
        if pin.connection_revision != expected_authority_revision {
            return Err(AppError::Blocked {
                reason: format!(
                    "Analysis Article connection '{}' changed from revision {} to {}",
                    request.connection_id, expected_authority_revision, pin.connection_revision
                ),
            });
        }
        if pin.profile.engine == Engine::Mongodb {
            return Err(AppError::Blocked {
                reason: "Analysis Articles currently require a relational read source; document sources must use a typed document node".into(),
            });
        }
        let sql = request.query.sql.as_str();
        let classification = safety::classify(sql, pin.profile.engine)?;
        if classification.kind != QueryKind::Read || classification.statement_count != 1 {
            return Err(AppError::Blocked {
                reason: "Analysis Article queries must be one read-only statement".into(),
            });
        }
        let settings = self.store.get_safety(local_connection_id).await?;
        let maximum_rows = request.query.max_rows.min(settings.max_rows.max(1));
        let lease = operation_scope
            .connect(pin.clone(), ConnectionAccess::Read)
            .await?;
        let live = lease.live().sql()?;
        let result = safety::run_read_only_byte_capped_cancellable(
            pool_ref(live.ro()),
            sql,
            maximum_rows,
            request.query.max_bytes,
            Some(&cancellation),
        )
        .await;
        let result = match result {
            Ok(result) => result,
            Err(error) => {
                record_query(
                    &self.store,
                    &pin,
                    sql,
                    "error",
                    None,
                    None,
                    Some(error.to_string()),
                )
                .await;
                return Err(error);
            }
        };
        if let Err(error) =
            validate_query_result_columns(&request.query.columns, &result, &request.query.id)
        {
            record_query(
                &self.store,
                &pin,
                sql,
                "error",
                Some(result.row_count as i64),
                Some(result.duration_ms as i64),
                Some(error.to_string()),
            )
            .await;
            return Err(error);
        }
        let byte_count = serde_json::to_vec(&result)?.len();
        if byte_count > request.query.max_bytes {
            let error = AppError::Blocked {
                reason: format!(
                    "Analysis query '{}' exceeded its byte budget",
                    request.query.title
                ),
            };
            record_query(
                &self.store,
                &pin,
                sql,
                "error",
                Some(result.row_count as i64),
                Some(result.duration_ms as i64),
                Some(error.to_string()),
            )
            .await;
            return Err(error);
        }
        record_query(
            &self.store,
            &pin,
            sql,
            "ok",
            Some(result.row_count as i64),
            Some(result.duration_ms as i64),
            None,
        )
        .await;
        let receipt = AnalysisQueryReceipt {
            query_node_id: request.query.id.clone(),
            connection_id: request.connection_id,
            connection_revision: request.connection_revision,
            query_run_id: request.run_id,
            query_hash: canonical_hash(&serde_json::json!({ "sql": request.query.sql }))?,
            schema_fingerprint: schema_fingerprint(&request.query.columns)?,
            state: AnalysisQueryState::Succeeded,
            row_count: result.row_count as u64,
            byte_count: byte_count as u64,
            duration_ms: result.duration_ms,
        };
        Ok(AnalysisReadExecutionOutcome {
            receipt,
            data: AnalysisDataSet {
                columns: request.query.columns.clone(),
                rows: result.rows,
                truncated: result.truncated,
            },
        })
    }
}

fn validate_query_result_columns(
    declared: &[AnalysisColumn],
    result: &QueryResult,
    query_id: &str,
) -> AppResult<()> {
    let names = declared
        .iter()
        .map(|column| column.name.as_str())
        .collect::<Vec<_>>();
    if result
        .columns
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        != names
        || result.rows.iter().any(|row| row.len() != declared.len())
    {
        return Err(AppError::Blocked {
            reason: format!(
                "Analysis query '{query_id}' result schema changed; update the Article definition before using this local result"
            ),
        });
    }
    Ok(())
}

fn schema_fingerprint(columns: &[AnalysisColumn]) -> AppResult<String> {
    canonical_hash(&serde_json::to_value(columns)?)
}

async fn record_query(
    store: &Store,
    pin: &PinnedConnection,
    sql: &str,
    status: &str,
    row_count: Option<i64>,
    duration_ms: Option<i64>,
    error: Option<String>,
) {
    if let Err(record_error) = audit::record(
        store,
        RecordArgs {
            connection_id: pin.connection_id,
            engine: pin.profile.engine,
            agent_prompt: None,
            sql: sql.to_owned(),
            kind: QueryKind::Read,
            action: "analysis_article:run".into(),
            approved_by: None,
            affected_estimate: row_count,
            error: error.clone(),
        },
    )
    .await
    {
        tracing::error!(connection_id = %pin.connection_id, %record_error, "Analysis Article audit record failed");
    }
    if let Err(history_error) = store
        .insert_history_if_current(
            pin,
            &HistoryEntry {
                id: Uuid::new_v4(),
                connection_id: pin.connection_id,
                sql: sql.to_owned(),
                kind: QueryKind::Read,
                status: status.into(),
                row_count,
                duration_ms,
                error,
                executed_at: Utc::now(),
                origin: "analysis_article".into(),
            },
        )
        .await
    {
        tracing::error!(connection_id = %pin.connection_id, %history_error, "Analysis Article history insert failed");
    }
}

fn pool_ref(pool: &DbPool) -> PoolRef<'_> {
    match pool {
        DbPool::Postgres(pool) => PoolRef::Postgres(pool),
        DbPool::Mysql(pool) => PoolRef::Mysql(pool),
        DbPool::Sqlite(pool) => PoolRef::Sqlite(pool),
        DbPool::Bigquery(connection) => PoolRef::Bigquery(connection),
    }
}

#[cfg(test)]
pub(crate) fn assert_exact_query_contract() {
    assert_eq!(
        safety::classify("SELECT 1", Engine::Sqlite)
            .expect("exact saved query should remain classifiable")
            .kind,
        QueryKind::Read
    );
    assert_ne!(
        safety::classify("DELETE FROM records", Engine::Sqlite)
            .expect("write classification should succeed")
            .kind,
        QueryKind::Read
    );
}
