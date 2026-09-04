//! Postgres introspection through bounded `pg_catalog` scans.

mod queries;
#[path = "pg_timeout.rs"]
mod timeout;

use queries::objects_sql_for_version;
use timeout::*;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use dopedb_protocol::{Constraint, ConstraintKind, IndexKey, ObjectKind, ObjectRef, SortDirection};
use sqlx::{postgres::PgRow, AssertSqlSafe, PgPool, Postgres, Row, Transaction};

use crate::error::{AppError, AppResult};
use crate::features::catalog::{
    CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation,
    CatalogOverviewRelationRef,
};

use super::{Catalog, Column, DatabaseObject, ForeignKey, Index, Table};

const COLS_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS formatted_type,
       NOT a.attnotnull AS is_nullable,
       a.attnum::integer AS ordinal_position,
       information_schema._pg_char_max_length(a.atttypid, a.atttypmod)
         AS character_maximum_length,
       information_schema._pg_numeric_precision(a.atttypid, a.atttypmod)
         AS numeric_precision,
       information_schema._pg_numeric_scale(a.atttypid, a.atttypmod)
         AS numeric_scale,
       pg_get_expr(def.adbin, def.adrelid) AS column_default,
       a.attidentity <> '' AS is_identity,
       coll.collname AS collation_name,
       col_description(c.oid, a.attnum) AS column_comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  -- Hide objects owned by an extension (e.g. pg_stat_statements) — they are noise in
  -- a table browser and some error on SELECT *.
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dep
    WHERE dep.deptype = 'e'
      AND dep.classid = 'pg_class'::regclass
      AND dep.objid = c.oid
  )
ORDER BY n.nspname, c.relname, a.attnum
"#;

// PostgreSQL 10 introduced generated identity columns and `pg_attribute.attidentity`.
// Identity is necessarily false on PostgreSQL 9.6 because the server cannot define one.
const COLS_PRE_10_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS formatted_type,
       NOT a.attnotnull AS is_nullable,
       a.attnum::integer AS ordinal_position,
       information_schema._pg_char_max_length(a.atttypid, a.atttypmod)
         AS character_maximum_length,
       information_schema._pg_numeric_precision(a.atttypid, a.atttypmod)
         AS numeric_precision,
       information_schema._pg_numeric_scale(a.atttypid, a.atttypmod)
         AS numeric_scale,
       pg_get_expr(def.adbin, def.adrelid) AS column_default,
       false AS is_identity,
       coll.collname AS collation_name,
       col_description(c.oid, a.attnum) AS column_comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dep
    WHERE dep.deptype = 'e'
      AND dep.classid = 'pg_class'::regclass
      AND dep.objid = c.oid
  )
ORDER BY n.nspname, c.relname, a.attnum
"#;

fn columns_sql_for_version(server_version_num: u32) -> &'static str {
    if server_version_num >= 100_000 {
        COLS_SQL
    } else {
        COLS_PRE_10_SQL
    }
}

// The browser must be useful even when a very large schema makes detail collection
// expensive.  This deliberately small pg_catalog scan is the core catalog: it returns
// the table/view tree before columns, constraints, indexes, estimates, or routines.
// Keep its extension filter aligned with COLS_SQL so a partial catalog never grows
// surprising extension-owned entries.
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
       pn.nspname AS parent_schema,
       pc.relname AS parent_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_inherits inh ON inh.inhrelid = c.oid
LEFT JOIN pg_class pc ON pc.oid = inh.inhparent
LEFT JOIN pg_namespace pn ON pn.oid = pc.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
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

// FK edges resolved on pg_catalog so composite keys stay per-column-correct. Zipping
// conkey/confkey WITH ORDINALITY pairs each local column to the matching referenced
// column without cross-joining composite or same-named constraints.
const FK_SQL: &str = r#"
SELECT cn.nspname   AS table_schema,
       cl.relname   AS table_name,
       con.conname  AS constraint_name,
       k.ord        AS ordinal_position,
       att.attname  AS column_name,
       fn.nspname   AS foreign_schema,
       fcl.relname  AS foreign_table,
       fatt.attname AS foreign_column,
       CASE con.confupdtype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS update_action,
       CASE con.confdeltype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS delete_action,
       con.condeferrable AS is_deferrable,
       con.convalidated AS is_validated
FROM pg_constraint con
JOIN pg_class cl       ON cl.oid = con.conrelid
JOIN pg_namespace cn   ON cn.oid = cl.relnamespace
JOIN pg_class fcl      ON fcl.oid = con.confrelid
JOIN pg_namespace fn   ON fn.oid = fcl.relnamespace
JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true
JOIN pg_attribute att  ON att.attrelid = con.conrelid  AND att.attnum = k.conkey
JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = k.confkey
WHERE con.contype = 'f'
  AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY cn.nspname, cl.relname, con.conname, k.ord
"#;

// Secondary indexes (PK indexes excluded — the PK is already on the columns). Expression
// columns (indkey = 0) surface as "(expression)".
const IDX_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       t.relname AS table_name,
       ic.relname AS index_name,
       i.indisunique AS is_unique,
       am.amname AS index_method,
       a.attname AS column_name,
       CASE WHEN a.attname IS NULL
            THEN pg_get_indexdef(i.indexrelid, k.ord::integer, true)
            ELSE NULL
       END AS index_expression,
       CASE WHEN (i.indoption[(k.ord - 1)::integer] & 1) = 1
            THEN 'desc' ELSE 'asc'
       END AS sort_direction,
       pg_get_expr(i.indpred, i.indrelid) AS predicate,
       i.indisvalid AS is_valid
FROM pg_index i
JOIN pg_class t      ON t.oid = i.indrelid
JOIN pg_class ic     ON ic.oid = i.indexrelid
JOIN pg_namespace n  ON n.oid = t.relnamespace
JOIN pg_am am         ON am.oid = ic.relam
JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT i.indisprimary
ORDER BY n.nspname, t.relname, ic.relname, k.ord
"#;

const CONSTRAINTS_SQL: &str = r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype::text AS constraint_type,
       COALESCE(
         ARRAY(
           SELECT a.attname
           FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = key.attnum
           ORDER BY key.ord
         ),
         ARRAY[]::text[]
       ) AS columns,
       CASE WHEN con.contype = 'c' THEN pg_get_expr(con.conbin, con.conrelid) END
         AS check_expression,
       con.condeferrable AS is_deferrable,
       con.convalidated AS is_validated
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype IN ('p', 'u', 'c')
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

async fn fetch_relation_overview(
    tx: &mut Transaction<'_, Postgres>,
) -> AppResult<Vec<RelationOverviewRow>> {
    let started = Instant::now();
    match sqlx::query(RELATIONS_SQL).fetch_all(&mut **tx).await {
        Ok(rows) => {
            let rows = rows
                .into_iter()
                .map(relation_overview_from_row)
                .collect::<AppResult<Vec<_>>>()?;
            tracing::debug!(
                stage = "relations",
                elapsed_ms = started.elapsed().as_millis() as u64,
                relations = rows.len(),
                "PostgreSQL catalog core relation stage completed"
            );
            Ok(rows)
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

/// Fetch only the complete relation tree under the core timeout. This response has
/// no full-catalog persistence path, so deferred details cannot poison snapshots.
pub(crate) async fn overview(pool: &PgPool, database: &str) -> AppResult<CatalogOverview> {
    let mut tx = pool.begin().await?;
    sqlx::query(AssertSqlSafe(statement_timeout_sql(CORE_RELATION_TIMEOUT)))
        .execute(&mut *tx)
        .await?;
    let namespaces = sqlx::query_scalar::<_, String>(SCHEMAS_SQL)
        .fetch_all(&mut *tx)
        .await?;
    let relations = fetch_relation_overview(&mut tx)
        .await?
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
    tx.commit().await?;
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
    sqlx::query(AssertSqlSafe(format!("ROLLBACK TO SAVEPOINT {savepoint}")))
        .execute(&mut **tx)
        .await?;
    sqlx::query(AssertSqlSafe(format!("RELEASE SAVEPOINT {savepoint}")))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Run one complete-catalog metadata statement under a savepoint. PostgreSQL marks
/// a transaction failed after statement_timeout; rolling back the savepoint lets us
/// emit a precise non-retryable timeout rather than leaking a poisoned pool connection.
async fn fetch_detail_rows(
    tx: &mut Transaction<'_, Postgres>,
    stage: MetadataStage,
    timeout: Duration,
    sql: &'static str,
) -> AppResult<Vec<PgRow>> {
    let started = Instant::now();
    let savepoint = format!("dopedb_catalog_{}", stage.name());
    sqlx::query(AssertSqlSafe(format!("SAVEPOINT {savepoint}")))
        .execute(&mut **tx)
        .await?;
    sqlx::query(AssertSqlSafe(statement_timeout_sql(timeout)))
        .execute(&mut **tx)
        .await?;

    match sqlx::query(sql).fetch_all(&mut **tx).await {
        Ok(rows) => {
            sqlx::query(AssertSqlSafe(format!("RELEASE SAVEPOINT {savepoint}")))
                .execute(&mut **tx)
                .await?;
            tracing::debug!(
                stage = stage.name(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                rows = rows.len(),
                "PostgreSQL catalog metadata stage completed"
            );
            Ok(rows)
        }
        Err(error) if is_statement_timeout(&error) => {
            rollback_stage_savepoint(tx, &savepoint).await?;
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
            // Restore the transaction before returning a non-timeout error.  This is
            // also cancellation-safe: dropping the surrounding transaction rolls it
            // back and releases the read-pool connection.
            rollback_stage_savepoint(tx, &savepoint).await?;
            Err(error.into())
        }
    }
}

async fn next_detail_rows(
    tx: &mut Transaction<'_, Postgres>,
    started: Instant,
    relation_count: usize,
    stage: MetadataStage,
    sql: &'static str,
) -> AppResult<Vec<PgRow>> {
    let Some(timeout) = remaining_detail_timeout(started, relation_count) else {
        let elapsed = started.elapsed();
        tracing::warn!(
            stage = stage.name(),
            elapsed_ms = elapsed.as_millis() as u64,
            budget_ms = DETAIL_SCAN_BUDGET.as_millis() as u64,
            "PostgreSQL catalog detail budget exhausted"
        );
        return Err(catalog_detail_budget_exhausted(stage.name(), elapsed));
    };
    fetch_detail_rows(tx, stage, timeout, sql).await
}

pub async fn introspect(pool: &PgPool) -> AppResult<Catalog> {
    // Keep one server session for a consistent scan. The core tree gets its own
    // bounded query; every detail stage must complete before this becomes cacheable.
    let mut tx = pool.begin().await?;
    sqlx::query(AssertSqlSafe(statement_timeout_sql(CORE_RELATION_TIMEOUT)))
        .execute(&mut *tx)
        .await?;

    let mut tables: Vec<Table> = Vec::new();
    let mut idx: HashMap<(String, String), usize> = HashMap::new();

    for relation in fetch_relation_overview(&mut tx).await? {
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

    let details_started = Instant::now();
    let relation_count = tables.len();

    // This cheap server capability read must happen before the column scan: direct
    // references to `attidentity` fail at parse time on PostgreSQL 9.6 and older.
    let server_version_rows = next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::ServerVersion,
        "SHOW server_version_num",
    )
    .await?;
    let version_row = server_version_rows
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Config("PostgreSQL returned no server_version_num row".into()))?;
    let server_version: String = version_row.try_get(0)?;
    let server_version_num = server_version.trim().parse::<u32>().map_err(|_| {
        AppError::Config("PostgreSQL returned an invalid server_version_num".into())
    })?;

    for r in next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::Columns,
        columns_sql_for_version(server_version_num),
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
            identity: r.try_get("is_identity").unwrap_or(false),
            collation: r.try_get("collation_name").unwrap_or(None),
            comment: r.try_get("column_comment").unwrap_or(None),
            ..Column::default()
        });
    }

    let table_refs = tables
        .iter()
        .map(|table| {
            (
                (table.schema.clone(), table.name.clone()),
                ObjectRef {
                    catalog: None,
                    namespace: table.schema.clone(),
                    name: table.name.clone(),
                    kind: ObjectKind::Table,
                    native_id: table.native_id.clone(),
                },
                table.partition_parent.clone(),
            )
        })
        .collect::<Vec<_>>();
    for (_, child, parent) in table_refs {
        let Some(parent) = parent else { continue };
        if let Some(parent_table) = tables
            .iter_mut()
            .find(|table| table.schema == parent.namespace && table.name == parent.name)
        {
            parent_table.partition_children.push(child);
        }
    }

    for r in next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::Constraints,
        CONSTRAINTS_SQL,
    )
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
        let columns: Vec<String> = r.try_get("columns").unwrap_or_default();
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

    for r in next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::ForeignKeys,
        FK_SQL,
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

    // Group index rows (already ordered by table/index/position) into per-index columns.
    for r in next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::Indexes,
        IDX_SQL,
    )
    .await?
    {
        let key: (String, String) = (r.try_get("table_schema")?, r.try_get("table_name")?);
        let Some(&i) = idx.get(&key) else { continue };
        let iname: String = r.try_get("index_name")?;
        let column: Option<String> = r.try_get("column_name")?;
        let expression: Option<String> = r.try_get("index_expression")?;
        let display = column
            .clone()
            .or_else(|| expression.clone())
            .unwrap_or_else(|| "(expression)".into());
        let unique: bool = r.try_get("is_unique")?;
        let key_part = IndexKey {
            column,
            expression,
            direction: match r.try_get::<String, _>("sort_direction")?.as_str() {
                "desc" => Some(SortDirection::Desc),
                _ => Some(SortDirection::Asc),
            },
        };
        let idxs = &mut tables[i].indexes;
        match idxs.last_mut() {
            Some(last) if last.name == iname => {
                last.columns.push(display);
                last.keys.push(key_part);
            }
            _ => idxs.push(Index {
                name: iname,
                columns: vec![display],
                unique,
                method: r.try_get("index_method").ok(),
                keys: vec![key_part],
                predicate: r.try_get("predicate").unwrap_or(None),
                valid: r.try_get("is_valid").unwrap_or(true),
                ..Index::default()
            }),
        }
    }

    let objects = next_detail_rows(
        &mut tx,
        details_started,
        relation_count,
        MetadataStage::Objects,
        objects_sql_for_version(server_version_num),
    )
    .await?
    .into_iter()
    .map(|row| {
        let detail: Option<String> = row.try_get("object_detail")?;
        Ok(DatabaseObject {
            schema: row.try_get("schema_name")?,
            name: row.try_get("object_name")?,
            kind: row.try_get("object_kind")?,
            native_id: row.try_get("native_id")?,
            detail: detail.clone(),
            parent: row.try_get("parent_name")?,
            arguments: detail
                .filter(|value| !value.trim().is_empty())
                .into_iter()
                .collect(),
            return_type: row.try_get("return_type")?,
            language: row.try_get("language")?,
            comment: row.try_get("object_comment")?,
        })
    })
    .collect::<AppResult<Vec<_>>>()?;

    tx.commit().await?;
    Ok(Catalog { tables, objects })
}

#[path = "pg_ddl.rs"]
mod ddl;
pub use ddl::table_ddl;
