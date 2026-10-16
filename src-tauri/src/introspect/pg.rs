//! Postgres introspection through bounded `pg_catalog` scans.

mod queries;
#[path = "pg_timeout.rs"]
mod timeout;

use queries::{columns_sql, foreign_keys_sql, indexes_sql, objects_sql};
use timeout::*;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use dopedb_protocol::{Constraint, ConstraintKind, IndexKey, ObjectKind, ObjectRef, SortDirection};
use futures::TryStreamExt;
use sqlx::{postgres::PgRow, AssertSqlSafe, Either, PgPool, Postgres, Row, Transaction};

use crate::error::{AppError, AppResult};
use crate::features::catalog::{
    CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation,
    CatalogOverviewRelationRef,
};

use super::{Catalog, Column, DatabaseObject, ForeignKey, Index, Table};

// The browser must be useful even when a very large schema makes detail collection
// expensive.  This deliberately small pg_catalog scan is the core catalog: it returns
// the table/view tree before columns, constraints, indexes, estimates, or routines.
// Keep its extension and temporary-relation filters aligned with `columns_sql` so a
// partial catalog never grows surprising entries. Only a declarative partition names
// a parent (a partitioned table, relkind 'p'); classic inheritance may have several
// parents, so joining every pg_inherits row would repeat the relation.
const RELATIONS_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       CASE c.relkind
         WHEN 'v' THEN 'VIEW'
         WHEN 'm' THEN 'MATERIALIZED VIEW'
         ELSE 'BASE TABLE'
       END AS table_type,
       c.oid::text AS native_id,
       obj_description(c.oid, 'pg_class') AS table_comment,
       CASE WHEN c.relkind IN ('r', 'p', 'f') AND c.reltuples >= 0
            THEN c.reltuples::bigint ELSE NULL END AS row_estimate,
       parent.parent_schema,
       parent.parent_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
  SELECT pn.nspname AS parent_schema, pc.relname AS parent_table
  FROM pg_inherits inh
  JOIN pg_class pc ON pc.oid = inh.inhparent
  JOIN pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE inh.inhrelid = c.oid
    AND pc.relkind = 'p'
  LIMIT 1
) parent ON true
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND c.relpersistence <> 't'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend dep
    WHERE dep.deptype = 'e'
      AND dep.classid = 'pg_class'::regclass
      AND dep.objid = c.oid
  )
ORDER BY n.nspname, c.relname
"#;

const SCHEMAS_SQL: &str = r#"
SELECT n.nspname
FROM pg_namespace n
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp_%'
  AND has_schema_privilege(n.oid, 'USAGE')
ORDER BY n.nspname
"#;

const DATABASES_SQL: &str = r#"
SELECT datname
FROM pg_database
WHERE datallowconn
  AND NOT datistemplate
  -- Cloud SQL exposes its provider-owned administration database through
  -- pg_database even though customer sessions are always rejected by its HBA.
  AND datname <> 'cloudsqladmin'
  AND has_database_privilege(oid, 'CONNECT')
ORDER BY datname
"#;

pub(crate) async fn databases(pool: &PgPool) -> AppResult<Vec<String>> {
    sqlx::query_scalar::<_, String>(DATABASES_SQL)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

const CONSTRAINTS_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype::text AS constraint_type,
       COALESCE(
         (
           SELECT json_agg(a.attname ORDER BY key.ord)
           FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = key.attnum
         ),
         '[]'::json
       )::text AS columns_json,
       CASE WHEN con.contype = 'c' THEN pg_get_expr(con.conbin, con.conrelid) END
         AS check_expression,
       con.condeferrable AS is_deferrable,
       con.convalidated AS is_validated
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype IN ('p', 'u', 'c')
  AND c.relpersistence <> 't'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, con.conname
"#;

/// Minimal, cache-safe relation projection for consumers that intentionally show
/// only the database tree. Full [`introspect`] never returns this as a complete
/// catalog snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RelationOverviewRow {
    schema: String,
    name: String,
    kind: String,
    native_id: Option<String>,
    comment: Option<String>,
    row_estimate: Option<i64>,
    parent_schema: Option<String>,
    parent_table: Option<String>,
}

fn relation_overview_from_row(row: PgRow) -> AppResult<RelationOverviewRow> {
    let table_type: String = row.try_get("table_type")?;
    let kind = if table_type.eq_ignore_ascii_case("VIEW") {
        "view"
    } else if table_type.eq_ignore_ascii_case("MATERIALIZED VIEW") {
        "materialized_view"
    } else {
        "table"
    };
    Ok(RelationOverviewRow {
        schema: row.try_get("table_schema")?,
        name: row.try_get("table_name")?,
        kind: kind.into(),
        native_id: row.try_get("native_id").ok(),
        comment: row.try_get("table_comment").unwrap_or(None),
        row_estimate: row.try_get("row_estimate").unwrap_or(None),
        parent_schema: row.try_get("parent_schema").unwrap_or(None),
        parent_table: row.try_get("parent_table").unwrap_or(None),
    })
}

fn relation_overview_rows(rows: Vec<PgRow>) -> AppResult<Vec<RelationOverviewRow>> {
    rows.into_iter().map(relation_overview_from_row).collect()
}

/// Send control statements and catalog queries as ONE simple-protocol message and
/// return each statement's rows in order; a statement without a result set yields an
/// empty group. A whole stage therefore costs one network round trip.
///
/// Unprepared statements stream text-format values, so every column read from these
/// rows is a name, text, an integer, a boolean, or JSON text. SQL arrays are avoided
/// because their text form cannot tell a NULL element from the string "NULL".
async fn fetch_statements(
    tx: &mut Transaction<'_, Postgres>,
    sql: String,
) -> Result<Vec<Vec<PgRow>>, sqlx::Error> {
    let mut statements = Vec::new();
    let mut rows = Vec::new();
    let mut results = sqlx::raw_sql(AssertSqlSafe(sql)).fetch_many(&mut **tx);
    while let Some(result) = results.try_next().await? {
        match result {
            Either::Left(_) => statements.push(std::mem::take(&mut rows)),
            Either::Right(row) => rows.push(row),
        }
    }
    Ok(statements)
}

/// Open the scan transaction and install the core timeout in one round trip. Every
/// stage reads one snapshot: concurrent DDL can neither split a relation from its
/// columns nor make two stages disagree about which objects exist.
async fn begin_scan(pool: &PgPool) -> AppResult<Transaction<'static, Postgres>> {
    Ok(pool
        .begin_with(AssertSqlSafe(format!(
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; {}",
            statement_timeout_sql(CORE_RELATION_TIMEOUT)
        )))
        .await?)
}

/// End a read-only scan without waiting another round trip. Dropping the transaction
/// queues its ROLLBACK, which the pool flushes and confirms before the connection is
/// reused; a catalog read has nothing to commit.
fn finish_read_only_scan(tx: Transaction<'_, Postgres>) {
    drop(tx);
}

/// Run the core relation-tree statements under the core timeout installed by
/// [`begin_scan`]. `sql` may hold several statements sharing the round trip.
async fn fetch_core_statements(
    tx: &mut Transaction<'_, Postgres>,
    sql: String,
) -> AppResult<Vec<Vec<PgRow>>> {
    let started = Instant::now();
    match fetch_statements(tx, sql).await {
        Ok(statements) => {
            tracing::debug!(
                stage = "relations",
                elapsed_ms = started.elapsed().as_millis() as u64,
                relations = statements.last().map_or(0, Vec::len),
                "PostgreSQL catalog core relation stage completed"
            );
            Ok(statements)
        }
        Err(error) if is_statement_timeout(&error) => {
            let elapsed = started.elapsed();
            tracing::warn!(
                stage = "relations",
                elapsed_ms = elapsed.as_millis() as u64,
                timeout_ms = CORE_RELATION_TIMEOUT.as_millis() as u64,
                "PostgreSQL catalog core relation stage timed out"
            );
            Err(catalog_stage_timeout(
                "relations",
                elapsed,
                CORE_RELATION_TIMEOUT,
            ))
        }
        Err(error) => Err(error.into()),
    }
}

/// Run a snapshot scan, rescanning once in a fresh transaction when it raced a
/// concurrent DROP ([`AppError::is_concurrent_catalog_drop`]): the new snapshot no
/// longer lists the dropped object. The normal path keeps its round trips.
async fn rescan_once_after_concurrent_drop<T, F, Fut>(scan: F) -> AppResult<T>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    match scan().await {
        Err(error) if error.is_concurrent_catalog_drop() => {
            tracing::debug!("PostgreSQL catalog scan raced a concurrent DROP; rescanning once");
            scan().await
        }
        result => result,
    }
}

/// Fetch only the complete relation tree under the core timeout. This response has
/// no full-catalog persistence path, so deferred details cannot poison snapshots.
/// BEGIN plus the timeout, then namespaces plus relations: two round trips.
pub(crate) async fn overview(pool: &PgPool, database: &str) -> AppResult<CatalogOverview> {
    rescan_once_after_concurrent_drop(|| overview_scan(pool, database)).await
}

async fn overview_scan(pool: &PgPool, database: &str) -> AppResult<CatalogOverview> {
    let mut tx = begin_scan(pool).await?;
    let statements =
        fetch_core_statements(&mut tx, format!("{SCHEMAS_SQL};{RELATIONS_SQL}")).await?;
    finish_read_only_scan(tx);
    let [namespace_rows, relation_rows]: [Vec<PgRow>; 2] = statements.try_into().map_err(|_| {
        AppError::Config("PostgreSQL returned an unexpected catalog overview shape".into())
    })?;
    let namespaces = namespace_rows
        .iter()
        .map(|row| row.try_get::<String, _>(0))
        .collect::<Result<Vec<_>, _>>()?;
    let relations = relation_overview_rows(relation_rows)?
        .into_iter()
        .map(|relation| CatalogOverviewRelation {
            schema: Some(relation.schema),
            name: relation.name,
            kind: relation.kind,
            native_id: relation.native_id,
            comment: relation.comment,
            row_estimate: relation.row_estimate,
            parent: relation
                .parent_table
                .map(|name| CatalogOverviewRelationRef {
                    schema: relation.parent_schema,
                    name,
                    kind: "table".into(),
                    native_id: None,
                }),
        })
        .collect();
    Ok(CatalogOverview {
        database: database.to_owned(),
        namespaces,
        relations,
        detail_state: CatalogOverviewDetailState::Deferred,
    })
}

async fn rollback_stage_savepoint(
    tx: &mut Transaction<'_, Postgres>,
    savepoint: &str,
) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(AssertSqlSafe(format!(
        "ROLLBACK TO SAVEPOINT {savepoint}; RELEASE SAVEPOINT {savepoint}"
    )))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Bounded detail scan state. A successful stage leaves its savepoint pending so the
/// RELEASE rides with the next stage's message; ending the scan discards the last one.
struct DetailScan {
    started: Instant,
    relation_count: usize,
    pending_release: Option<String>,
}

impl DetailScan {
    fn new(relation_count: usize) -> Self {
        Self {
            started: Instant::now(),
            relation_count,
            pending_release: None,
        }
    }

    async fn rows(
        &mut self,
        tx: &mut Transaction<'_, Postgres>,
        stage: MetadataStage,
        sql: &str,
    ) -> AppResult<Vec<PgRow>> {
        let Some(timeout) = remaining_detail_timeout(self.started, self.relation_count) else {
            let elapsed = self.started.elapsed();
            tracing::warn!(
                stage = stage.name(),
                elapsed_ms = elapsed.as_millis() as u64,
                budget_ms = DETAIL_SCAN_BUDGET.as_millis() as u64,
                "PostgreSQL catalog detail budget exhausted"
            );
            return Err(catalog_detail_budget_exhausted(stage.name(), elapsed));
        };
        fetch_detail_rows(tx, stage, timeout, sql, &mut self.pending_release).await
    }
}

/// Run one complete-catalog metadata statement under a savepoint. PostgreSQL marks
/// a transaction failed after statement_timeout; rolling back the savepoint lets us
/// emit a precise non-retryable timeout rather than leaking a poisoned pool connection.
/// The previous RELEASE, this SAVEPOINT, its timeout and the catalog query travel as
/// one simple-protocol message, so a stage costs one round trip on a remote server.
async fn fetch_detail_rows(
    tx: &mut Transaction<'_, Postgres>,
    stage: MetadataStage,
    timeout: Duration,
    sql: &str,
    pending_release: &mut Option<String>,
) -> AppResult<Vec<PgRow>> {
    let started = Instant::now();
    let savepoint = format!("dopedb_catalog_{}", stage.name());
    let release = pending_release
        .take()
        .map(|previous| format!("RELEASE SAVEPOINT {previous}; "))
        .unwrap_or_default();
    let message = format!(
        "{release}SAVEPOINT {savepoint}; {};{sql}",
        statement_timeout_sql(timeout)
    );

    match fetch_statements(tx, message).await {
        Ok(mut statements) => {
            *pending_release = Some(savepoint);
            let rows = statements.pop().unwrap_or_default();
            tracing::debug!(
                stage = stage.name(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                rows = rows.len(),
                "PostgreSQL catalog metadata stage completed"
            );
            Ok(rows)
        }
        Err(error) if is_statement_timeout(&error) => {
            // Best effort: every caller drops the transaction after an error and the
            // pool rolls it back before reuse, so a failed restore must not mask the
            // timeout.
            let _ = rollback_stage_savepoint(tx, &savepoint).await;
            tracing::warn!(
                stage = stage.name(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                timeout_ms = timeout.as_millis() as u64,
                "PostgreSQL catalog metadata stage timed out"
            );
            Err(catalog_stage_timeout(
                stage.name(),
                started.elapsed(),
                timeout,
            ))
        }
        Err(error) => {
            // Restore the transaction before returning a non-timeout error. When the
            // failed statement preceded the savepoint the restore fails too; the
            // original error stays the one reported.
            let _ = rollback_stage_savepoint(tx, &savepoint).await;
            Err(error.into())
        }
    }
}

/// Read the complete catalog in one server session: BEGIN plus the core timeout, the
/// relation tree, then five bounded detail stages — seven network round trips in all.
pub async fn introspect(pool: &PgPool) -> AppResult<Catalog> {
    rescan_once_after_concurrent_drop(|| introspect_scan(pool)).await
}

async fn introspect_scan(pool: &PgPool) -> AppResult<Catalog> {
    // Keep one server session for the scan. The core tree gets its own bounded
    // statement; every detail stage must complete before this becomes cacheable.
    let mut tx = begin_scan(pool).await?;
    let relation_rows = fetch_core_statements(&mut tx, RELATIONS_SQL.to_owned())
        .await?
        .pop()
        .unwrap_or_default();

    let mut tables: Vec<Table> = Vec::new();
    let mut idx: HashMap<(String, String), usize> = HashMap::new();

    for relation in relation_overview_rows(relation_rows)? {
        let schema = relation.schema;
        let name = relation.name;
        let i = *idx
            .entry((schema.clone(), name.clone()))
            .or_insert_with(|| {
                tables.push(Table {
                    schema: Some(schema),
                    name,
                    kind: "table".into(),
                    columns: Vec::new(),
                    foreign_keys: Vec::new(),
                    indexes: Vec::new(),
                    row_estimate: None,
                    ..Table::default()
                });
                tables.len() - 1
            });
        tables[i].kind = relation.kind;
        tables[i].native_id = relation.native_id;
        tables[i].comment = relation.comment;
        tables[i].row_estimate = relation.row_estimate;
        if let Some(parent_table) = relation.parent_table {
            tables[i].partition_parent = Some(ObjectRef {
                catalog: None,
                namespace: relation.parent_schema,
                name: parent_table,
                kind: ObjectKind::Table,
                native_id: None,
            });
        }
    }

    // One hash lookup per partition links it under its parent.
    let partitions = tables
        .iter()
        .filter_map(|table| {
            let parent = table.partition_parent.as_ref()?;
            let parent_index = *idx.get(&(parent.namespace.clone()?, parent.name.clone()))?;
            Some((
                parent_index,
                ObjectRef {
                    catalog: None,
                    namespace: table.schema.clone(),
                    name: table.name.clone(),
                    kind: ObjectKind::Table,
                    native_id: table.native_id.clone(),
                },
            ))
        })
        .collect::<Vec<_>>();
    for (parent_index, child) in partitions {
        tables[parent_index].partition_children.push(child);
    }

    let mut scan = DetailScan::new(tables.len());

    // The server capability must be known before the column scan: direct references
    // to `attidentity` fail at parse time on PostgreSQL 9.6 and older. The startup
    // ParameterStatus already carries it; only an unparsable report costs a query.
    let server_version_num = match tx.server_version_num() {
        Some(version) => version,
        None => {
            let version_row = scan
                .rows(
                    &mut tx,
                    MetadataStage::ServerVersion,
                    "SHOW server_version_num",
                )
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    AppError::Config("PostgreSQL returned no server_version_num row".into())
                })?;
            let server_version: String = version_row.try_get(0)?;
            server_version.trim().parse::<u32>().map_err(|_| {
                AppError::Config("PostgreSQL returned an invalid server_version_num".into())
            })?
        }
    };

    for r in scan
        .rows(
            &mut tx,
            MetadataStage::Columns,
            &columns_sql(server_version_num),
        )
        .await?
    {
        let key: (String, String) = (r.try_get("table_schema")?, r.try_get("table_name")?);
        let Some(&i) = idx.get(&key) else { continue };
        let ordinal = r
            .try_get::<i32, _>("ordinal_position")
            .ok()
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0);
        tables[i].columns.push(Column {
            name: r.try_get("column_name")?,
            data_type: r.try_get("formatted_type")?,
            nullable: r.try_get("is_nullable")?,
            // Primary-key membership comes from CONSTRAINTS_SQL below. Keeping it
            // out of the hot column scan avoids information_schema joins that grow
            // disproportionately on large schemas.
            pk: false,
            ordinal,
            length: r
                .try_get::<Option<i32>, _>("character_maximum_length")
                .unwrap_or(None)
                .and_then(|value| u64::try_from(value).ok()),
            precision: r
                .try_get::<Option<i32>, _>("numeric_precision")
                .unwrap_or(None)
                .and_then(|value| u32::try_from(value).ok()),
            scale: r
                .try_get::<Option<i32>, _>("numeric_scale")
                .unwrap_or(None)
                .and_then(|value| u32::try_from(value).ok()),
            default_expression: r.try_get("column_default").unwrap_or(None),
            generated_expression: r.try_get("generation_expression").unwrap_or(None),
            identity: r.try_get("is_identity").unwrap_or(false),
            collation: r.try_get("collation_name").unwrap_or(None),
            comment: r.try_get("column_comment").unwrap_or(None),
            ..Column::default()
        });
    }

    for r in scan
        .rows(&mut tx, MetadataStage::Constraints, CONSTRAINTS_SQL)
        .await?
    {
        let key: (String, String) = (r.try_get("table_schema")?, r.try_get("table_name")?);
        let Some(&i) = idx.get(&key) else { continue };
        let kind = match r.try_get::<String, _>("constraint_type")?.as_str() {
            "p" => ConstraintKind::Primary,
            "u" => ConstraintKind::Unique,
            "c" => ConstraintKind::Check,
            _ => continue,
        };
        // Key order, not column order: a composite primary key keeps its declaration.
        let columns: Vec<String> = serde_json::from_str(&r.try_get::<String, _>("columns_json")?)?;
        if kind == ConstraintKind::Primary {
            for column in &mut tables[i].columns {
                if columns.contains(&column.name) {
                    column.pk = true;
                }
            }
        }
        tables[i].constraints.push(Constraint {
            name: r.try_get("constraint_name")?,
            kind,
            columns,
            referenced_relation: None,
            referenced_columns: Vec::new(),
            check_expression: r.try_get("check_expression").unwrap_or(None),
            update_action: None,
            delete_action: None,
            deferrable: r.try_get("is_deferrable").unwrap_or(false),
            validated: r.try_get("is_validated").unwrap_or(true),
        });
    }

    for r in scan
        .rows(
            &mut tx,
            MetadataStage::ForeignKeys,
            &foreign_keys_sql(server_version_num),
        )
        .await?
    {
        let key: (String, String) = (r.try_get("table_schema")?, r.try_get("table_name")?);
        if let Some(&i) = idx.get(&key) {
            tables[i].foreign_keys.push(ForeignKey {
                name: r.try_get("constraint_name").ok(),
                ordinal: r
                    .try_get::<i64, _>("ordinal_position")
                    .ok()
                    .and_then(|value| u32::try_from(value).ok())
                    .unwrap_or(0),
                column: r.try_get("column_name")?,
                references_table: r.try_get("foreign_table")?,
                references_column: r.try_get("foreign_column")?,
                references_schema: r.try_get("foreign_schema").ok(),
                update_action: r.try_get("update_action").unwrap_or(None),
                delete_action: r.try_get("delete_action").unwrap_or(None),
                deferrable: r.try_get("is_deferrable").unwrap_or(false),
                validated: r.try_get("is_validated").unwrap_or(true),
            });
        }
    }

    // Group index rows (already ordered by table/index/position) into per-index keys.
    // INCLUDE columns are payload stored in the index, never part of its key.
    for r in scan
        .rows(
            &mut tx,
            MetadataStage::Indexes,
            &indexes_sql(server_version_num),
        )
        .await?
    {
        let key: (String, String) = (r.try_get("table_schema")?, r.try_get("table_name")?);
        let Some(&i) = idx.get(&key) else { continue };
        let iname: String = r.try_get("index_name")?;
        let column: Option<String> = r.try_get("column_name")?;
        let expression: Option<String> = r.try_get("index_expression")?;
        let included: bool = r.try_get("is_included")?;
        let idxs = &mut tables[i].indexes;
        if idxs.last().is_none_or(|last| last.name != iname) {
            idxs.push(Index {
                name: iname,
                unique: r.try_get("is_unique")?,
                method: r.try_get("index_method").ok(),
                predicate: r.try_get("predicate").unwrap_or(None),
                valid: r.try_get("is_valid").unwrap_or(true),
                ..Index::default()
            });
        }
        let Some(index) = idxs.last_mut() else {
            continue;
        };
        if included {
            index.included_columns.extend(column);
            continue;
        }
        index.columns.push(
            column
                .clone()
                .or_else(|| expression.clone())
                .unwrap_or_else(|| "(expression)".into()),
        );
        index.keys.push(IndexKey {
            column,
            expression,
            direction: match r.try_get::<String, _>("sort_direction")?.as_str() {
                "desc" => Some(SortDirection::Desc),
                _ => Some(SortDirection::Asc),
            },
        });
    }

    let objects = scan
        .rows(
            &mut tx,
            MetadataStage::Objects,
            &objects_sql(server_version_num),
        )
        .await?
        .into_iter()
        .map(|row| {
            let kind: String = row.try_get("object_kind")?;
            let detail: Option<String> = row.try_get("object_detail")?;
            // Only a routine's detail is its identity argument list.
            let arguments = if matches!(kind.as_str(), "function" | "procedure") {
                detail
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .into_iter()
                    .collect()
            } else {
                Vec::new()
            };
            Ok(DatabaseObject {
                schema: row.try_get("schema_name")?,
                name: row.try_get("object_name")?,
                kind,
                native_id: row.try_get("native_id")?,
                detail,
                parent: row.try_get("parent_name")?,
                arguments,
                return_type: row.try_get("return_type")?,
                language: row.try_get("language")?,
                comment: row.try_get("object_comment")?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    finish_read_only_scan(tx);
    Ok(Catalog { tables, objects })
}

#[path = "pg_ddl.rs"]
mod ddl;
pub use ddl::table_ddl;
