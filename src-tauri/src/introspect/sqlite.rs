//! SQLite introspection via `sqlite_master` + metadata-only PRAGMAs.
//! PRAGMA args can't be bound, so table names are interpolated with `"`-quoting
//! (identifiers come from `sqlite_master`, not user input, but we quote regardless).

use std::collections::{HashMap, HashSet};

use dopedb_protocol::{Constraint, ConstraintKind, IndexKey, SortDirection};
use sqlparser::{
    ast::{ColumnOption, Expr, Statement, TableConstraint},
    dialect::SQLiteDialect,
    parser::Parser,
};
use sqlx::{AssertSqlSafe, Row, SqlitePool};

use crate::error::{AppError, AppResult};

use crate::features::catalog::{
    CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation,
};

use super::{Catalog, Column, DatabaseObject, ForeignKey, Index, Table};

const OVERVIEW_SQL: &str = "SELECT name, type, rootpage FROM sqlite_master\n\
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";

/// Quote an identifier for interpolation into a PRAGMA/COUNT statement.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[derive(Debug, Default)]
struct TableDdlMetadata {
    generated: HashMap<String, String>,
    collations: HashMap<String, String>,
    auto_increment: HashSet<String>,
    constraints: Vec<Constraint>,
}

#[derive(Debug, Default)]
struct IndexDdlMetadata {
    keys: Vec<IndexKey>,
    predicate: Option<String>,
}

pub async fn introspect(pool: &SqlitePool) -> AppResult<Catalog> {
    // Both tables and views; keep the type so the sidebar can group them.
    let entries: Vec<(String, String, Option<String>, i64)> = sqlx::query(
        "SELECT name, type, sql, rootpage FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| {
        Ok((
            r.try_get::<String, _>("name")?,
            r.try_get::<String, _>("type")?,
            r.try_get::<Option<String>, _>("sql")?,
            r.try_get::<i64, _>("rootpage")?,
        ))
    })
    .collect::<AppResult<_>>()?;

    // sqlite_stat1 is populated by ANALYZE and gives a cheap estimate in its first
    // integer. It may not exist at all, so absence is a normal cache miss.
    let row_estimates = load_row_estimates(pool).await;
    let mut tables = Vec::with_capacity(entries.len());
    for (name, ty, table_sql, rootpage) in entries {
        let q = quote_ident(&name);
        let ddl_metadata = table_sql
            .as_deref()
            .map(|sql| parse_table_ddl(&name, sql))
            .unwrap_or_default();

        let mut columns = Vec::new();
        for r in sqlx::query(AssertSqlSafe(format!("PRAGMA table_xinfo({q})")))
            .fetch_all(pool)
            .await?
        {
            let column_name: String = r.try_get("name")?;
            let notnull: i64 = r.try_get("notnull")?;
            let pk: i64 = r.try_get("pk")?;
            let cid: i64 = r.try_get("cid")?;
            let hidden: i64 = r.try_get("hidden")?;
            columns.push(Column {
                name: column_name.clone(),
                data_type: r.try_get("type")?,
                nullable: notnull == 0,
                pk: pk > 0,
                ordinal: u32::try_from(cid.saturating_add(1)).unwrap_or(u32::MAX),
                default_expression: r.try_get("dflt_value")?,
                generated_expression: ddl_metadata.generated.get(&column_name).cloned(),
                auto_increment: ddl_metadata.auto_increment.contains(&column_name),
                collation: ddl_metadata.collations.get(&column_name).cloned(),
                // `hidden` 2/3 identifies virtual/stored generated columns. If an
                // older parser cannot recover the expression, keep the marker.
                identity: hidden == 1,
                ..Column::default()
            });
        }

        let mut foreign_keys = Vec::new();
        for r in sqlx::query(AssertSqlSafe(format!("PRAGMA foreign_key_list({q})")))
            .fetch_all(pool)
            .await?
        {
            let foreign_key_id: i64 = r.try_get("id")?;
            let ordinal: i64 = r.try_get("seq")?;
            // `to` is NULL when the FK references the parent's primary key.
            let to: Option<String> = r.try_get("to")?;
            let ref_table: String = r.try_get("table")?;
            foreign_keys.push(ForeignKey {
                name: Some(format!("fk_{name}_{foreign_key_id}")),
                ordinal: u32::try_from(ordinal.saturating_add(1)).unwrap_or(u32::MAX),
                column: r.try_get("from")?,
                references_table: ref_table,
                references_column: to.unwrap_or_default(),
                references_schema: Some("main".into()),
                update_action: r.try_get("on_update")?,
                delete_action: r.try_get("on_delete")?,
                ..ForeignKey::default()
            });
        }

        // Indexes: index_list gives name/unique/origin; index_info gives the columns.
        // origin 'pk' = the implicit primary-key index, dropped (PK is on the columns).
        let mut indexes = Vec::new();
        let mut constraints = ddl_metadata.constraints;
        for r in sqlx::query(AssertSqlSafe(format!("PRAGMA index_list({q})")))
            .fetch_all(pool)
            .await?
        {
            let origin: String = r.try_get("origin")?;
            if origin == "pk" {
                continue;
            }
            let iname: String = r.try_get("name")?;
            let unique: i64 = r.try_get("unique")?;
            let partial: i64 = r.try_get("partial")?;
            let iq = quote_ident(&iname);
            let index_sql: Option<String> = sqlx::query_scalar(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(&iname)
            .fetch_optional(pool)
            .await?
            .flatten();
            let parsed_index = index_sql
                .as_deref()
                .map(parse_index_ddl)
                .unwrap_or_default();
            let mut cols = Vec::new();
            let mut keys = Vec::new();
            for ir in sqlx::query(AssertSqlSafe(format!("PRAGMA index_xinfo({iq})")))
                .fetch_all(pool)
                .await?
            {
                let is_key: i64 = ir.try_get("key")?;
                if is_key == 0 {
                    continue;
                }
                let seqno: i64 = ir.try_get("seqno")?;
                let cid: i64 = ir.try_get("cid")?;
                let desc: i64 = ir.try_get("desc")?;
                // `name` is NULL for an expression column.
                let cn: Option<String> = ir.try_get("name")?;
                let parsed_key = usize::try_from(seqno)
                    .ok()
                    .and_then(|index| parsed_index.keys.get(index));
                let expression = (cid == -2)
                    .then(|| parsed_key.and_then(|key| key.expression.clone()))
                    .flatten();
                let label = cn
                    .clone()
                    .or_else(|| expression.clone())
                    .unwrap_or_else(|| "(expression)".into());
                cols.push(label);
                keys.push(IndexKey {
                    column: cn,
                    expression,
                    direction: Some(if desc == 0 {
                        SortDirection::Asc
                    } else {
                        SortDirection::Desc
                    }),
                });
            }
            if origin == "u" {
                constraints.push(Constraint {
                    name: iname.clone(),
                    kind: ConstraintKind::Unique,
                    columns: keys.iter().filter_map(|key| key.column.clone()).collect(),
                    referenced_relation: None,
                    referenced_columns: Vec::new(),
                    check_expression: None,
                    update_action: None,
                    delete_action: None,
                    deferrable: false,
                    validated: true,
                });
            }
            indexes.push(Index {
                name: iname,
                columns: cols,
                unique: unique != 0,
                method: Some("btree".into()),
                keys,
                predicate: (partial != 0).then_some(parsed_index.predicate).flatten(),
                ..Index::default()
            });
        }

        // Never COUNT(*) during schema discovery. A database with many large tables
        // must remain metadata-bound; ANALYZE statistics are the only cheap estimate.
        let row_estimate = (ty != "view")
            .then(|| row_estimates.get(&name).copied())
            .flatten();

        tables.push(Table {
            schema: Some("main".into()),
            name,
            kind: if ty == "view" {
                "view".into()
            } else {
                "table".into()
            },
            native_id: (rootpage > 0).then(|| rootpage.to_string()),
            columns,
            foreign_keys,
            constraints,
            indexes,
            row_estimate,
            ..Table::default()
        });
    }

    let objects = sqlx::query(
        "SELECT name, tbl_name, sql FROM sqlite_master
         WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(DatabaseObject {
            schema: Some("main".into()),
            name: row.try_get("name")?,
            kind: "trigger".into(),
            detail: row.try_get("sql")?,
            parent: row.try_get("tbl_name")?,
            ..DatabaseObject::default()
        })
    })
    .collect::<AppResult<Vec<_>>>()?;

    Ok(Catalog { tables, objects })
}

/// List SQLite relations without parsing DDL or issuing per-relation PRAGMAs.
/// The root page is the only stable native identity SQLite exposes in this path.
pub(crate) async fn overview(pool: &SqlitePool, database: &str) -> AppResult<CatalogOverview> {
    let relations = sqlx::query(OVERVIEW_SQL)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| {
            let ty: String = row.try_get("type")?;
            let rootpage: i64 = row.try_get("rootpage")?;
            Ok(CatalogOverviewRelation {
                schema: Some("main".into()),
                name: row.try_get("name")?,
                kind: if ty == "view" { "view" } else { "table" }.into(),
                native_id: (rootpage > 0).then(|| rootpage.to_string()),
                comment: None,
                row_estimate: None,
                parent: None,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    Ok(CatalogOverview {
        database: database.to_owned(),
        namespaces: vec!["main".into()],
        relations,
        detail_state: CatalogOverviewDetailState::Deferred,
    })
}

async fn load_row_estimates(pool: &SqlitePool) -> HashMap<String, i64> {
    let rows = match sqlx::query("SELECT tbl, stat FROM sqlite_stat1")
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows,
        Err(_) => return HashMap::new(),
    };
    let mut estimates = HashMap::<String, i64>::new();
    for row in rows {
        let table = match row.try_get::<String, _>("tbl") {
            Ok(table) => table,
            Err(_) => continue,
        };
        let stat = match row.try_get::<String, _>("stat") {
            Ok(stat) => stat,
            Err(_) => continue,
        };
        let Some(estimate) = stat
            .split_ascii_whitespace()
            .next()
            .and_then(|part| part.parse::<i64>().ok())
        else {
            continue;
        };
        estimates
            .entry(table)
            .and_modify(|current| *current = (*current).max(estimate))
            .or_insert(estimate);
    }
    estimates
}

fn parse_table_ddl(table_name: &str, sql: &str) -> TableDdlMetadata {
    let Ok(mut statements) = Parser::parse_sql(&SQLiteDialect {}, sql) else {
        return TableDdlMetadata::default();
    };
    let Some(Statement::CreateTable(create)) = statements.pop() else {
        return TableDdlMetadata::default();
    };

    let mut metadata = TableDdlMetadata::default();
    let mut check_index = 0usize;
    for column in create.columns {
        for option in column.options {
            match option.option {
                ColumnOption::Generated {
                    generation_expr: Some(expression),
                    ..
                } => {
                    metadata
                        .generated
                        .insert(column.name.value.clone(), expression.to_string());
                }
                ColumnOption::Collation(collation) => {
                    metadata
                        .collations
                        .insert(column.name.value.clone(), collation.to_string());
                }
                ColumnOption::DialectSpecific(tokens)
                    if tokens
                        .iter()
                        .any(|token| token.to_string().eq_ignore_ascii_case("AUTOINCREMENT")) =>
                {
                    metadata.auto_increment.insert(column.name.value.clone());
                }
                ColumnOption::Check(check) => {
                    check_index += 1;
                    metadata.constraints.push(Constraint {
                        name: check
                            .name
                            .map(|name| name.value)
                            .unwrap_or_else(|| format!("ck_{table_name}_{check_index}")),
                        kind: ConstraintKind::Check,
                        columns: vec![column.name.value.clone()],
                        referenced_relation: None,
                        referenced_columns: Vec::new(),
                        check_expression: Some(check.expr.to_string()),
                        update_action: None,
                        delete_action: None,
                        deferrable: false,
                        validated: true,
                    });
                }
                _ => {}
            }
        }
    }

    for constraint in create.constraints {
        if let TableConstraint::Check(check) = constraint {
            check_index += 1;
            metadata.constraints.push(Constraint {
                name: check
                    .name
                    .map(|name| name.value)
                    .unwrap_or_else(|| format!("ck_{table_name}_{check_index}")),
                kind: ConstraintKind::Check,
                columns: Vec::new(),
                referenced_relation: None,
                referenced_columns: Vec::new(),
                check_expression: Some(check.expr.to_string()),
                update_action: None,
                delete_action: None,
                deferrable: false,
                validated: true,
            });
        }
    }
    metadata
}

fn parse_index_ddl(sql: &str) -> IndexDdlMetadata {
    let Ok(mut statements) = Parser::parse_sql(&SQLiteDialect {}, sql) else {
        return IndexDdlMetadata::default();
    };
    let Some(Statement::CreateIndex(create)) = statements.pop() else {
        return IndexDdlMetadata::default();
    };
    IndexDdlMetadata {
        keys: create
            .columns
            .into_iter()
            .map(|column| {
                let (name, expression) = match column.column.expr {
                    Expr::Identifier(identifier) => (Some(identifier.value), None),
                    expression => (None, Some(expression.to_string())),
                };
                IndexKey {
                    column: name,
                    expression,
                    direction: column.column.options.asc.map(|asc| {
                        if asc {
                            SortDirection::Asc
                        } else {
                            SortDirection::Desc
                        }
                    }),
                }
            })
            .collect(),
        predicate: create.predicate.map(|predicate| predicate.to_string()),
    }
}

/// The stored DDL for a table/view plus the DDL of its (non-auto) indexes, as SQLite
/// itself recorded them in `sqlite_master`.
pub async fn table_ddl(pool: &SqlitePool, table: &str) -> AppResult<String> {
    let sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
    )
    .bind(table)
    .fetch_optional(pool)
    .await?;
    let mut out = sql.ok_or_else(|| AppError::NotFound(format!("table {table}")))?;
    out.push(';');

    // Auto-created indexes (UNIQUE/PK constraints) have a NULL sql; skip them.
    let index_sql: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND sql IS NOT NULL
         ORDER BY name",
    )
    .bind(table)
    .fetch_all(pool)
    .await?;
    for s in index_sql {
        out.push_str("\n\n");
        out.push_str(&s);
        out.push(';');
    }
    Ok(out)
}
