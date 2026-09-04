//! Canonical catalog snapshot cache adapter.

use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use dopedb_protocol::catalog as v2;

use crate::connection::ConnectionContext;
use crate::error::{AppError, AppResult};
use crate::model::{ConnectionProfile, Engine};
use crate::store::{CacheWriteOutcome, Store};

use super::{Catalog, ForeignKey, Table};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CatalogReadMode {
    /// Authorize online, return a current canonical snapshot when present, otherwise
    /// introspect live and write it through.
    CacheFirst,
    /// Delete the current scoped cache first, introspect live, then write through.
    Refresh,
}

/// Load a canonical snapshot while retaining a caller-owned, already authorized scope.
///
/// This helper intentionally consumes `ConnectionContext`, carrying its scope read
/// guard through the cache check, connection acquisition, and compare-and-swap write.
pub(crate) async fn load_catalog_snapshot_in_context(
    store: &Store,
    context: ConnectionContext,
    mode: CatalogReadMode,
) -> AppResult<v2::CatalogSnapshot> {
    if mode == CatalogReadMode::CacheFirst {
        if let Some(snapshot) = store.get_catalog_if_current(context.pin()).await? {
            return Ok(snapshot);
        }
    } else if mode == CatalogReadMode::Refresh {
        store
            .clear_schema_cache(context.pin().connection_id)
            .await?;
    }

    let lease = context.connect().await?;
    if lease.pin().profile.database.trim().is_empty() {
        return Err(AppError::Config(
            "Catalog V2 requires an explicit database name".into(),
        ));
    }
    let catalog = super::introspect(lease.live()).await?;
    let snapshot = snapshot_from_catalog(&lease.pin().profile, &catalog)?;
    match store.put_catalog_if_current(lease.pin(), &snapshot).await? {
        CacheWriteOutcome::Stored | CacheWriteOutcome::NotPersisted => {}
        CacheWriteOutcome::Stale => {
            return Err(AppError::Blocked {
                reason: "workspace or connection access changed; retry schema loading".into(),
            });
        }
    }
    Ok(snapshot)
}

pub(crate) fn snapshot_from_catalog(
    profile: &ConnectionProfile,
    catalog: &Catalog,
) -> AppResult<v2::CatalogSnapshot> {
    let namespaces = catalog
        .tables
        .iter()
        .filter_map(|table| table.schema.clone())
        .chain(
            catalog
                .objects
                .iter()
                .filter_map(|object| object.schema.clone()),
        )
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|name| v2::Namespace {
            name,
            comment: None,
        })
        .collect();

    let relations = catalog
        .tables
        .iter()
        .map(table_to_relation)
        .collect::<Vec<_>>();
    let mut routines = Vec::new();
    let mut other_objects = Vec::new();
    for object in &catalog.objects {
        let object_ref = v2::ObjectRef {
            catalog: None,
            namespace: object.schema.clone(),
            name: object.name.clone(),
            kind: object_kind(&object.kind),
            native_id: object.native_id.clone(),
        };
        if matches!(object.kind.as_str(), "function" | "procedure") {
            routines.push(v2::Routine {
                object: v2::ObjectRef {
                    kind: v2::ObjectKind::Routine,
                    ..object_ref
                },
                native_kind: Some(object.kind.clone()),
                arguments: object.arguments.clone(),
                return_type: object.return_type.clone(),
                language: object.language.clone(),
                comment: object.comment.clone(),
                detail: object.detail.clone(),
                parent: object.parent.clone(),
            });
        } else {
            other_objects.push(v2::DatabaseObject {
                object: object_ref,
                native_kind: Some(object.kind.clone()),
                comment: object.comment.clone(),
                detail: object.detail.clone(),
                parent: object.parent.clone(),
            });
        }
    }

    v2::CatalogSnapshot::capture(
        profile.id,
        engine(profile.engine),
        profile.database.clone(),
        Utc::now(),
        v2::CatalogContents {
            namespaces,
            relations,
            routines,
            other_objects,
        },
    )
    .map_err(|error| AppError::Config(format!("could not build Catalog V2: {error}")))
}

fn table_to_relation(table: &Table) -> v2::Relation {
    let primary_columns = table
        .columns
        .iter()
        .filter(|column| column.pk)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let mut constraints = table.constraints.clone();
    if !primary_columns.is_empty()
        && !constraints
            .iter()
            .any(|constraint| constraint.kind == v2::ConstraintKind::Primary)
    {
        constraints.push(v2::Constraint {
            name: format!("pk_{}", table.name),
            kind: v2::ConstraintKind::Primary,
            columns: primary_columns,
            referenced_relation: None,
            referenced_columns: Vec::new(),
            check_expression: None,
            update_action: None,
            delete_action: None,
            deferrable: false,
            validated: true,
        });
    }
    let mut foreign_key_groups =
        BTreeMap::<(String, Option<String>, String), Vec<&ForeignKey>>::new();
    for foreign_key in &table.foreign_keys {
        let name = foreign_key.name.clone().unwrap_or_else(|| {
            let referenced_namespace = foreign_key
                .references_schema
                .as_deref()
                .unwrap_or("default");
            format!(
                "fk_{}_{}_{}_{}_{}",
                table.name,
                foreign_key.column,
                referenced_namespace,
                foreign_key.references_table,
                foreign_key.references_column
            )
        });
        foreign_key_groups
            .entry((
                name,
                foreign_key.references_schema.clone(),
                foreign_key.references_table.clone(),
            ))
            .or_default()
            .push(foreign_key);
    }
    constraints.extend(foreign_key_groups.into_iter().map(
        |((name, namespace, referenced_table), mut columns)| {
            columns.sort_by_key(|foreign_key| foreign_key.ordinal);
            let first = columns[0];
            v2::Constraint {
                name,
                kind: v2::ConstraintKind::Foreign,
                columns: columns
                    .iter()
                    .map(|foreign_key| foreign_key.column.clone())
                    .collect(),
                referenced_relation: Some(v2::ObjectRef {
                    catalog: None,
                    namespace,
                    name: referenced_table,
                    kind: v2::ObjectKind::Table,
                    native_id: None,
                }),
                referenced_columns: columns
                    .iter()
                    .map(|foreign_key| foreign_key.references_column.clone())
                    .collect(),
                check_expression: None,
                update_action: first.update_action.clone(),
                delete_action: first.delete_action.clone(),
                deferrable: first.deferrable,
                validated: first.validated,
            }
        },
    ));

    v2::Relation {
        object: v2::ObjectRef {
            catalog: None,
            namespace: table.schema.clone(),
            name: table.name.clone(),
            kind: object_kind(&table.kind),
            native_id: table.native_id.clone(),
        },
        comment: table.comment.clone(),
        row_estimate: table.row_estimate,
        partition_parent: table.partition_parent.clone(),
        partition_children: table.partition_children.clone(),
        columns: table
            .columns
            .iter()
            .enumerate()
            .map(|(index, column)| v2::Column {
                name: column.name.clone(),
                ordinal: if column.ordinal == 0 {
                    u32::try_from(index + 1).unwrap_or(u32::MAX)
                } else {
                    column.ordinal
                },
                native_type: column.data_type.clone(),
                type_family: type_family(&column.data_type),
                length: column.length,
                precision: column.precision,
                scale: column.scale,
                nullable: column.nullable,
                default_expression: column.default_expression.clone(),
                generated_expression: column.generated_expression.clone(),
                identity: column.identity,
                auto_increment: column.auto_increment,
                collation: column.collation.clone(),
                comment: column.comment.clone(),
                sensitivity: None,
            })
            .collect(),
        constraints,
        indexes: table
            .indexes
            .iter()
            .map(|index| v2::Index {
                name: index.name.clone(),
                method: index.method.clone(),
                keys: if index.keys.is_empty() {
                    index
                        .columns
                        .iter()
                        .map(|column| v2::IndexKey {
                            column: Some(column.clone()),
                            expression: None,
                            direction: None,
                        })
                        .collect()
                } else {
                    index.keys.clone()
                },
                included_columns: index.included_columns.clone(),
                predicate: index.predicate.clone(),
                unique: index.unique,
                valid: index.valid,
            })
            .collect(),
    }
}

const fn engine(engine: Engine) -> v2::DatabaseEngine {
    match engine {
        Engine::Postgres => v2::DatabaseEngine::Postgres,
        Engine::Mysql => v2::DatabaseEngine::Mysql,
        Engine::Sqlite => v2::DatabaseEngine::Sqlite,
        Engine::Mongodb => v2::DatabaseEngine::Mongodb,
        Engine::Bigquery => v2::DatabaseEngine::Bigquery,
    }
}

fn object_kind(kind: &str) -> v2::ObjectKind {
    match kind {
        "table" | "collection" => v2::ObjectKind::Table,
        "view" => v2::ObjectKind::View,
        "materialized_view" => v2::ObjectKind::MaterializedView,
        "function" | "procedure" | "routine" => v2::ObjectKind::Routine,
        "sequence" => v2::ObjectKind::Sequence,
        "type" => v2::ObjectKind::Type,
        "trigger" => v2::ObjectKind::Trigger,
        _ => v2::ObjectKind::Other,
    }
}

fn type_family(native_type: &str) -> v2::NormalizedTypeFamily {
    let data_type = native_type.trim().to_ascii_lowercase();
    if data_type.ends_with("[]") || data_type.contains(" array") {
        return v2::NormalizedTypeFamily::Array;
    }
    let base = data_type
        .split(|character: char| character == '(' || character.is_ascii_whitespace())
        .next()
        .unwrap_or(data_type.as_str());
    if matches!(base, "bool" | "boolean") {
        v2::NormalizedTypeFamily::Boolean
    } else if matches!(
        base,
        "int"
            | "int2"
            | "int4"
            | "int8"
            | "integer"
            | "smallint"
            | "bigint"
            | "tinyint"
            | "mediumint"
            | "serial"
            | "smallserial"
            | "bigserial"
            | "year"
    ) {
        v2::NormalizedTypeFamily::Integer
    } else if matches!(base, "decimal" | "numeric" | "money") {
        v2::NormalizedTypeFamily::Decimal
    } else if matches!(base, "float" | "float4" | "float8" | "double" | "real") {
        v2::NormalizedTypeFamily::Float
    } else if matches!(base, "json" | "jsonb") {
        v2::NormalizedTypeFamily::Json
    } else if base == "uuid" {
        v2::NormalizedTypeFamily::Uuid
    } else if matches!(base, "timestamp" | "timestamptz" | "datetime") {
        v2::NormalizedTypeFamily::Timestamp
    } else if base == "date" {
        v2::NormalizedTypeFamily::Date
    } else if matches!(base, "time" | "timetz") {
        v2::NormalizedTypeFamily::Time
    } else if matches!(
        base,
        "bytea" | "blob" | "tinyblob" | "mediumblob" | "longblob" | "binary" | "varbinary"
    ) {
        v2::NormalizedTypeFamily::Binary
    } else if matches!(base, "document" | "bson") {
        v2::NormalizedTypeFamily::Document
    } else if matches!(
        base,
        "char"
            | "character"
            | "varchar"
            | "nvarchar"
            | "nchar"
            | "text"
            | "tinytext"
            | "mediumtext"
            | "longtext"
            | "string"
            | "citext"
            | "xml"
    ) {
        v2::NormalizedTypeFamily::Text
    } else {
        v2::NormalizedTypeFamily::Other
    }
}
