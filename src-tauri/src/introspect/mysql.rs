//! MySQL/MariaDB introspection via `information_schema`. On PlanetScale/Vitess
//! FK metadata is unreliable (sharded), so `skip_fk` drops it.

use std::collections::HashMap;

use dopedb_protocol::{Constraint, ConstraintKind, IndexKey, SortDirection};
use sqlx::mysql::MySqlRow;
use sqlx::{AssertSqlSafe, MySqlPool, Row};

use crate::error::{AppError, AppResult};

use crate::features::catalog::{
    CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation,
};

use super::{Catalog, Column, DatabaseObject, ForeignKey, Index, Table};

const COLS_SQL: &str = r#"
SELECT table_name, column_name, column_type, is_nullable, column_key,
       ordinal_position, character_maximum_length, numeric_precision,
       numeric_scale, column_default, extra, generation_expression,
       collation_name, column_comment
FROM information_schema.columns
WHERE table_schema = DATABASE()
ORDER BY table_name, ordinal_position
"#;

const FK_SQL: &str = r#"
SELECT k.table_name, k.constraint_name, k.ordinal_position, k.column_name,
       k.referenced_table_name, k.referenced_column_name,
       r.update_rule, r.delete_rule
FROM information_schema.key_column_usage k
JOIN information_schema.referential_constraints r
  ON r.constraint_schema = k.constraint_schema
 AND r.constraint_name = k.constraint_name
 AND r.table_name = k.table_name
WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL
ORDER BY k.table_name, k.constraint_name, k.ordinal_position
"#;

// Secondary indexes (bulk equivalent of `SHOW INDEX` — one round trip). PRIMARY excluded.
const IDX_SQL: &str = r#"
SELECT table_name, index_name, non_unique, column_name, index_type, collation
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'
ORDER BY table_name, index_name, seq_in_index
"#;

// MySQL 8.0.13+ exposes the exact text for functional key parts in EXPRESSION.
// Older MySQL and MariaDB releases do not have that column, so introspect() falls
// back to IDX_SQL when this query is rejected.
const IDX_EXPR_SQL: &str = r#"
SELECT table_name, index_name, non_unique, column_name, `EXPRESSION` AS index_expression,
       index_type, collation
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY'
ORDER BY table_name, index_name, seq_in_index
"#;

// table_type is 'BASE TABLE' or 'VIEW'; estimate is meaningful only for base tables.
const EST_SQL: &str = r#"
SELECT table_name AS table_name, table_type AS table_type,
       CAST(table_rows AS SIGNED) AS estimate, table_comment AS table_comment
FROM information_schema.tables
WHERE table_schema = DATABASE()
"#;

// Intentionally relation-only: the workspace tree must not read columns,
// constraints, indexes, routines, or triggers before the user needs them.
const OVERVIEW_SQL: &str = r#"
SELECT table_name AS table_name, table_type AS table_type,
       CAST(table_rows AS SIGNED) AS estimate,
       NULLIF(table_comment, '') AS table_comment
FROM information_schema.tables
WHERE table_schema = DATABASE()
ORDER BY table_name
"#;

const DATABASES_SQL: &str = r#"
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')
ORDER BY schema_name
"#;

pub(crate) async fn databases(pool: &MySqlPool) -> AppResult<Vec<String>> {
    sqlx::query_scalar::<_, String>(DATABASES_SQL)
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

const CONSTRAINTS_SQL: &str = r#"
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       k.column_name, k.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage k
  ON k.constraint_schema = tc.constraint_schema
 AND k.table_name = tc.table_name
 AND k.constraint_name = tc.constraint_name
WHERE tc.table_schema = DATABASE()
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_name, k.ordinal_position
"#;

const CHECKS_SQL: &str = r#"
SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON cc.constraint_schema = tc.constraint_schema
 AND cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = DATABASE() AND tc.constraint_type = 'CHECK'
ORDER BY tc.table_name, tc.constraint_name
"#;

const ROUTINES_SQL: &str = r#"
SELECT routine_schema AS schema_name,
       routine_name AS object_name,
       LOWER(routine_type) AS object_kind,
       NULLIF(dtd_identifier, '') AS object_detail,
       NULLIF(data_type, '') AS return_type,
       external_language AS language,
       NULLIF(routine_comment, '') AS object_comment
FROM information_schema.routines
WHERE routine_schema = DATABASE()
ORDER BY routine_type, routine_name
"#;

const TRIGGERS_SQL: &str = r#"
SELECT trigger_schema AS schema_name,
       trigger_name AS object_name,
       CONCAT(action_timing, ' ', event_manipulation) AS object_detail,
       event_object_table AS parent_name
FROM information_schema.triggers
WHERE trigger_schema = DATABASE()
ORDER BY trigger_name
"#;

pub async fn introspect(pool: &MySqlPool, skip_fk: bool) -> AppResult<Catalog> {
    let mut tables: Vec<Table> = Vec::new();
    let mut idx: HashMap<String, usize> = HashMap::new();

    for r in sqlx::query(COLS_SQL).fetch_all(pool).await? {
        let name: String = r.try_get("table_name")?;
        let i = *idx.entry(name.clone()).or_insert_with(|| {
            tables.push(Table {
                schema: None,
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
        let nullable: String = r.try_get("is_nullable")?;
        let key: String = r.try_get("column_key")?;
        let extra: String = r.try_get("extra").unwrap_or_default();
        let generation_expression: Option<String> = r
            .try_get::<String, _>("generation_expression")
            .ok()
            .filter(|value| !value.trim().is_empty());
        tables[i].columns.push(Column {
            name: r.try_get("column_name")?,
            data_type: r.try_get("column_type")?,
            nullable: nullable.eq_ignore_ascii_case("YES"),
            pk: key == "PRI",
            ordinal: r
                .try_get::<i32, _>("ordinal_position")
                .ok()
                .and_then(|value| u32::try_from(value).ok())
                .unwrap_or(0),
            length: r
                .try_get::<Option<i64>, _>("character_maximum_length")
                .unwrap_or(None)
                .and_then(|value| u64::try_from(value).ok()),
            precision: r
                .try_get::<Option<i64>, _>("numeric_precision")
                .unwrap_or(None)
                .and_then(|value| u32::try_from(value).ok()),
            scale: r
                .try_get::<Option<i64>, _>("numeric_scale")
                .unwrap_or(None)
                .and_then(|value| u32::try_from(value).ok()),
            default_expression: r.try_get("column_default").unwrap_or(None),
            generated_expression: generation_expression,
            auto_increment: extra
                .split_whitespace()
                .any(|value| value.eq_ignore_ascii_case("auto_increment")),
            collation: r.try_get("collation_name").unwrap_or(None),
            comment: r
                .try_get::<String, _>("column_comment")
                .ok()
                .filter(|value| !value.is_empty()),
            ..Column::default()
        });
    }

    let mut constraints = HashMap::<(String, String), Constraint>::new();
    for r in sqlx::query(CONSTRAINTS_SQL).fetch_all(pool).await? {
        let table: String = r.try_get("table_name")?;
        let name: String = r.try_get("constraint_name")?;
        let kind = match r.try_get::<String, _>("constraint_type")?.as_str() {
            "PRIMARY KEY" => ConstraintKind::Primary,
            "UNIQUE" => ConstraintKind::Unique,
            _ => continue,
        };
        constraints
            .entry((table, name.clone()))
            .or_insert_with(|| Constraint {
                name,
                kind,
                columns: Vec::new(),
                referenced_relation: None,
                referenced_columns: Vec::new(),
                check_expression: None,
                update_action: None,
                delete_action: None,
                deferrable: false,
                validated: true,
            })
            .columns
            .push(r.try_get("column_name")?);
    }
    for ((table, _), constraint) in constraints {
        if let Some(&i) = idx.get(&table) {
            tables[i].constraints.push(constraint);
        }
    }
    if let Ok(rows) = sqlx::query(CHECKS_SQL).fetch_all(pool).await {
        for r in rows {
            let table: String = r.try_get("table_name")?;
            let Some(&i) = idx.get(&table) else { continue };
            tables[i].constraints.push(Constraint {
                name: r.try_get("constraint_name")?,
                kind: ConstraintKind::Check,
                columns: Vec::new(),
                referenced_relation: None,
                referenced_columns: Vec::new(),
                check_expression: r.try_get("check_clause")?,
                update_action: None,
                delete_action: None,
                deferrable: false,
                validated: true,
            });
        }
    }

    if !skip_fk {
        for r in sqlx::query(FK_SQL).fetch_all(pool).await? {
            let name: String = r.try_get("table_name")?;
            if let Some(&i) = idx.get(&name) {
                tables[i].foreign_keys.push(ForeignKey {
                    name: r.try_get("constraint_name").ok(),
                    ordinal: r
                        .try_get::<i64, _>("ordinal_position")
                        .ok()
                        .and_then(|value| u32::try_from(value).ok())
                        .unwrap_or(0),
                    column: r.try_get("column_name")?,
                    references_table: r.try_get("referenced_table_name")?,
                    references_column: r.try_get("referenced_column_name")?,
                    references_schema: None,
                    update_action: r.try_get("update_rule").ok(),
                    delete_action: r.try_get("delete_rule").ok(),
                    ..ForeignKey::default()
                });
            }
        }
    }

    // Group ordered rows into per-index column lists. Prefer the MySQL 8 query
    // that preserves functional expressions, but remain compatible with servers
    // whose information_schema.statistics predates the EXPRESSION column.
    let (index_rows, has_expression) = fetch_index_rows(pool).await?;
    for r in index_rows {
        let name: String = r.try_get("table_name")?;
        let Some(&i) = idx.get(&name) else { continue };
        let iname: String = r.try_get("index_name")?;
        let col: Option<String> = r.try_get("column_name")?;
        let expression = if has_expression {
            r.try_get::<Option<String>, _>("index_expression")?
        } else {
            None
        };
        let non_unique: i64 = r.try_get("non_unique")?;
        let direction = match r.try_get::<Option<String>, _>("collation")? {
            Some(value) if value.eq_ignore_ascii_case("D") => Some(SortDirection::Desc),
            Some(_) => Some(SortDirection::Asc),
            None => None,
        };
        let key = IndexKey {
            column: col.clone(),
            expression: expression.clone(),
            direction,
        };
        push_index_part(
            &mut tables[i].indexes,
            iname,
            col,
            expression,
            non_unique == 0,
            key,
            r.try_get("index_type").ok(),
        );
    }

    for r in sqlx::query(EST_SQL).fetch_all(pool).await? {
        let name: String = r.try_get("table_name")?;
        if let Some(&i) = idx.get(&name) {
            let ty: String = r.try_get("table_type")?;
            if ty.eq_ignore_ascii_case("VIEW") {
                tables[i].kind = "view".into();
            } else {
                tables[i].row_estimate = r
                    .try_get::<Option<i64>, _>("estimate")
                    .unwrap_or(None)
                    .filter(|&n| n >= 0);
            }
            tables[i].comment = r
                .try_get::<String, _>("table_comment")
                .ok()
                .filter(|value| !value.is_empty());
        }
    }

    let mut objects = Vec::new();
    for row in sqlx::query(ROUTINES_SQL).fetch_all(pool).await? {
        objects.push(DatabaseObject {
            schema: row.try_get("schema_name")?,
            name: row.try_get("object_name")?,
            kind: row.try_get("object_kind")?,
            detail: row.try_get("object_detail")?,
            parent: None,
            return_type: row.try_get("return_type")?,
            language: row.try_get("language")?,
            comment: row.try_get("object_comment")?,
            ..DatabaseObject::default()
        });
    }
    for row in sqlx::query(TRIGGERS_SQL).fetch_all(pool).await? {
        objects.push(DatabaseObject {
            schema: row.try_get("schema_name")?,
            name: row.try_get("object_name")?,
            kind: "trigger".into(),
            detail: row.try_get("object_detail")?,
            parent: row.try_get("parent_name")?,
            ..DatabaseObject::default()
        });
    }
    objects.sort_by(|a, b| {
        (&a.schema, &a.kind, &a.name, &a.detail).cmp(&(&b.schema, &b.kind, &b.name, &b.detail))
    });

    Ok(Catalog { tables, objects })
}

/// List MySQL/MariaDB relations without invoking the complete metadata scan.
/// `information_schema.tables` is sufficient to render the connection tree;
/// detailed metadata remains explicitly deferred to [`introspect`].
pub(crate) async fn overview(pool: &MySqlPool, database: &str) -> AppResult<CatalogOverview> {
    let namespaces = sqlx::query_scalar::<_, Option<String>>("SELECT DATABASE()")
        .fetch_one(pool)
        .await?
        .into_iter()
        .collect();
    let relations = sqlx::query(OVERVIEW_SQL)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| {
            let table_type: String = row.try_get("table_type")?;
            Ok(CatalogOverviewRelation {
                schema: None,
                name: row.try_get("table_name")?,
                kind: if table_type.eq_ignore_ascii_case("VIEW") {
                    "view".into()
                } else {
                    "table".into()
                },
                native_id: None,
                comment: row.try_get("table_comment")?,
                row_estimate: (!table_type.eq_ignore_ascii_case("VIEW"))
                    .then(|| row.try_get("estimate"))
                    .transpose()?
                    .flatten()
                    .filter(|estimate: &i64| *estimate >= 0),
                parent: None,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(CatalogOverview {
        database: database.to_owned(),
        namespaces,
        relations,
        detail_state: CatalogOverviewDetailState::Deferred,
    })
}

async fn fetch_index_rows(pool: &MySqlPool) -> Result<(Vec<MySqlRow>, bool), sqlx::Error> {
    match sqlx::query(IDX_EXPR_SQL).fetch_all(pool).await {
        Ok(rows) => Ok((rows, true)),
        Err(_) => sqlx::query(IDX_SQL)
            .fetch_all(pool)
            .await
            .map(|rows| (rows, false)),
    }
}

fn push_index_part(
    indexes: &mut Vec<Index>,
    name: String,
    column: Option<String>,
    expression: Option<String>,
    unique: bool,
    key: IndexKey,
    method: Option<String>,
) {
    let column = column
        .filter(|value| !value.is_empty())
        .or_else(|| expression.filter(|value| !value.is_empty()))
        .unwrap_or_else(|| "<expression>".into());
    match indexes.last_mut() {
        Some(last) if last.name == name => {
            last.columns.push(column);
            last.keys.push(key);
        }
        _ => indexes.push(Index {
            name,
            columns: vec![column],
            unique,
            method,
            keys: vec![key],
            ..Index::default()
        }),
    }
}

/// `SHOW CREATE TABLE` — the server's own, authoritative DDL. Also works for views
/// (returns `CREATE VIEW`). The table name is backtick-quoted (identifiers escaped).
pub async fn table_ddl(pool: &MySqlPool, table: &str) -> AppResult<String> {
    let quoted = format!("`{}`", table.replace('`', "``"));
    let row = sqlx::query(AssertSqlSafe(format!("SHOW CREATE TABLE {quoted}")))
        .fetch_one(pool)
        .await?;
    // Column 1 is "Create Table" (or "Create View"); fetch by index to cover both.
    row.try_get::<String, _>(1)
        .map_err(|e| AppError::NotFound(format!("no DDL for {table}: {e}")))
}
