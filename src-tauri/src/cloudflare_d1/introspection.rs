//! SQLite catalog projection over Cloudflare D1's bounded raw-query endpoint.

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::features::catalog::{
    Catalog, CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation, Column,
    DatabaseObject, ForeignKey, Index, Table,
};

use super::D1Connection;

impl D1Connection {
    pub(crate) async fn overview(&self, database: &str) -> AppResult<CatalogOverview> {
        let result = self
            .raw(
                "SELECT name, type, rootpage FROM sqlite_master \
                 WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
                10_000,
            )
            .await?;
        let relations = result
            .rows
            .into_iter()
            .filter_map(|row| {
                let name = string_cell(&row, 0)?;
                let kind = if string_cell(&row, 1).as_deref() == Some("view") {
                    "view"
                } else {
                    "table"
                };
                let rootpage = integer_cell(&row, 2).filter(|value| *value > 0);
                Some(CatalogOverviewRelation {
                    schema: Some("main".into()),
                    name,
                    kind: kind.into(),
                    native_id: rootpage.map(|value| value.to_string()),
                    ..CatalogOverviewRelation::default()
                })
            })
            .collect();
        Ok(CatalogOverview {
            database: database.to_owned(),
            namespaces: vec!["main".into()],
            relations,
            detail_state: CatalogOverviewDetailState::Deferred,
        })
    }

    pub(crate) async fn introspect(&self) -> AppResult<Catalog> {
        let entries = self
            .raw(
                "SELECT name, type, sql, rootpage FROM sqlite_master \
                 WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
                10_000,
            )
            .await?;
        let mut tables = Vec::with_capacity(entries.rows.len());
        for row in entries.rows {
            let Some(name) = string_cell(&row, 0) else {
                continue;
            };
            let kind = if string_cell(&row, 1).as_deref() == Some("view") {
                "view"
            } else {
                "table"
            };
            let rootpage = integer_cell(&row, 3).filter(|value| *value > 0);
            tables.push(Table {
                schema: Some("main".into()),
                columns: self.columns(&name).await?,
                foreign_keys: self.foreign_keys(&name).await?,
                indexes: self.indexes(&name).await?,
                name,
                kind: kind.into(),
                native_id: rootpage.map(|value| value.to_string()),
                ..Table::default()
            });
        }
        let triggers = self
            .raw(
                "SELECT name, tbl_name, sql FROM sqlite_master \
                 WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                10_000,
            )
            .await?;
        let objects = triggers
            .rows
            .into_iter()
            .filter_map(|row| {
                Some(DatabaseObject {
                    schema: Some("main".into()),
                    name: string_cell(&row, 0)?,
                    kind: "trigger".into(),
                    parent: string_cell(&row, 1),
                    detail: string_cell(&row, 2),
                    ..DatabaseObject::default()
                })
            })
            .collect();
        Ok(Catalog { tables, objects })
    }

    async fn columns(&self, table: &str) -> AppResult<Vec<Column>> {
        let result = self
            .raw(
                &format!("PRAGMA table_xinfo({})", quote_ident(table)),
                10_000,
            )
            .await?;
        Ok(result
            .rows
            .into_iter()
            .filter_map(|row| {
                let cid = integer_cell(&row, 0)?;
                Some(Column {
                    name: string_cell(&row, 1)?,
                    data_type: string_cell(&row, 2).unwrap_or_default(),
                    nullable: integer_cell(&row, 3).unwrap_or(0) == 0,
                    default_expression: string_cell(&row, 4),
                    pk: integer_cell(&row, 5).unwrap_or(0) > 0,
                    ordinal: u32::try_from(cid.saturating_add(1)).unwrap_or(u32::MAX),
                    identity: integer_cell(&row, 6).unwrap_or(0) == 1,
                    ..Column::default()
                })
            })
            .collect())
    }

    async fn foreign_keys(&self, table: &str) -> AppResult<Vec<ForeignKey>> {
        let result = self
            .raw(
                &format!("PRAGMA foreign_key_list({})", quote_ident(table)),
                10_000,
            )
            .await?;
        Ok(result
            .rows
            .into_iter()
            .filter_map(|row| {
                let id = integer_cell(&row, 0)?;
                let ordinal = integer_cell(&row, 1).unwrap_or(0);
                Some(ForeignKey {
                    name: Some(format!("fk_{table}_{id}")),
                    ordinal: u32::try_from(ordinal.saturating_add(1)).unwrap_or(u32::MAX),
                    references_table: string_cell(&row, 2)?,
                    column: string_cell(&row, 3)?,
                    references_column: string_cell(&row, 4).unwrap_or_default(),
                    references_schema: Some("main".into()),
                    update_action: string_cell(&row, 5),
                    delete_action: string_cell(&row, 6),
                    ..ForeignKey::default()
                })
            })
            .collect())
    }

    async fn indexes(&self, table: &str) -> AppResult<Vec<Index>> {
        let listed = self
            .raw(
                &format!("PRAGMA index_list({})", quote_ident(table)),
                10_000,
            )
            .await?;
        let mut indexes = Vec::new();
        for row in listed.rows {
            if string_cell(&row, 3).as_deref() == Some("pk") {
                continue;
            }
            let Some(name) = string_cell(&row, 1) else {
                continue;
            };
            let details = self
                .raw(
                    &format!("PRAGMA index_info({})", quote_ident(&name)),
                    10_000,
                )
                .await?;
            indexes.push(Index {
                name,
                columns: details
                    .rows
                    .iter()
                    .filter_map(|detail| string_cell(detail, 2))
                    .collect(),
                unique: integer_cell(&row, 2).unwrap_or(0) != 0,
                method: Some("btree".into()),
                ..Index::default()
            });
        }
        Ok(indexes)
    }

    pub(crate) async fn table_ddl(&self, table: &str) -> AppResult<String> {
        let escaped = quote_literal(table);
        let result = self
            .raw(
                &format!(
                    "SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = {escaped} \
                     UNION ALL SELECT sql FROM sqlite_master WHERE type = 'index' \
                     AND tbl_name = {escaped} AND sql IS NOT NULL ORDER BY sql"
                ),
                10_000,
            )
            .await?;
        let statements = result
            .rows
            .iter()
            .filter_map(|row| string_cell(row, 0))
            .collect::<Vec<_>>();
        if statements.is_empty() {
            return Err(AppError::NotFound(format!("table {table}")));
        }
        Ok(statements
            .into_iter()
            .map(|statement| format!("{};", statement.trim_end_matches(';')))
            .collect::<Vec<_>>()
            .join("\n\n"))
    }
}

fn string_cell(row: &[Value], index: usize) -> Option<String> {
    match row.get(index)? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    }
}

fn integer_cell(row: &[Value], index: usize) -> Option<i64> {
    match row.get(index)? {
        Value::Number(value) => value.as_i64(),
        Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
