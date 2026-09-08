//! Read-only structural comparison of canonical catalogs, matching Desktop's
//! relation-kind, column type/nullability/PK, index, and foreign-key projection.
//! Database names, native IDs, row estimates, and capture times are not identity.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{CatalogSnapshot, ConstraintKind, DatabaseEngine, ObjectKind, Relation};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaDiffSource {
    pub connection_id: Uuid,
    pub database: String,
    pub fingerprint: String,
    pub captured_at: String,
}

impl From<&CatalogSnapshot> for SchemaDiffSource {
    fn from(catalog: &CatalogSnapshot) -> Self {
        Self {
            connection_id: catalog.connection_id(),
            database: catalog.database().into(),
            fingerprint: catalog.fingerprint().into(),
            captured_at: catalog.captured_at().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SchemaDiffStatus {
    Added,
    Missing,
    Changed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SchemaDiffObjectType {
    Table,
    View,
    Column,
    Index,
    ForeignKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaDiffObject {
    pub table: String,
    pub object_type: SchemaDiffObjectType,
    pub name: String,
    pub status: SchemaDiffStatus,
    pub baseline_value: String,
    pub target_value: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaDiffCounts {
    pub added: usize,
    pub missing: usize,
    pub changed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaDiff {
    pub schema_version: u16,
    pub engine: DatabaseEngine,
    pub baseline: SchemaDiffSource,
    pub target: SchemaDiffSource,
    pub counts: SchemaDiffCounts,
    pub total: usize,
    pub objects: Vec<SchemaDiffObject>,
}

pub fn compare_schema_catalogs(
    baseline: &CatalogSnapshot,
    target: &CatalogSnapshot,
) -> Result<SchemaDiff, &'static str> {
    if baseline.engine() != target.engine() {
        return Err("schema diff requires two databases using the same engine");
    }
    if baseline.engine() == DatabaseEngine::Mongodb {
        return Err("schema diff requires a relational catalog; MongoDB is not supported");
    }
    fn relations(catalog: &CatalogSnapshot) -> BTreeMap<(Option<String>, String), &Relation> {
        catalog
            .relations()
            .iter()
            .map(|relation| {
                (
                    (
                        relation.object.namespace.clone(),
                        relation.object.name.clone(),
                    ),
                    relation,
                )
            })
            .collect::<BTreeMap<_, _>>()
    }
    let base = relations(baseline);
    let current = relations(target);
    let keys = base.keys().chain(current.keys()).collect::<BTreeSet<_>>();
    let mut objects = Vec::new();
    for key in keys {
        let table = match key.0.as_deref().filter(|namespace| !namespace.is_empty()) {
            Some(namespace) => format!("{namespace}.{}", key.1),
            None => key.1.clone(),
        };
        match (base.get(key), current.get(key)) {
            (Some(base), Some(current)) => {
                if base.object.kind != current.object.kind {
                    objects.push(entry(
                        &table,
                        relation_type(current),
                        &current.object.name,
                        SchemaDiffStatus::Changed,
                        kind_label(base),
                        kind_label(current),
                    ));
                }
                compare_named(
                    &mut objects,
                    &table,
                    SchemaDiffObjectType::Column,
                    columns(base),
                    columns(current),
                );
                compare_named(
                    &mut objects,
                    &table,
                    SchemaDiffObjectType::Index,
                    indexes(base),
                    indexes(current),
                );
                compare_foreign_keys(&mut objects, &table, base, current);
            }
            (None, Some(current)) => objects.push(entry(
                &table,
                relation_type(current),
                &current.object.name,
                SchemaDiffStatus::Added,
                "—",
                kind_label(current),
            )),
            (Some(base), None) => objects.push(entry(
                &table,
                relation_type(base),
                &base.object.name,
                SchemaDiffStatus::Missing,
                kind_label(base),
                "—",
            )),
            (None, None) => unreachable!(),
        }
    }
    let mut counts = SchemaDiffCounts::default();
    for object in &objects {
        match object.status {
            SchemaDiffStatus::Added => counts.added += 1,
            SchemaDiffStatus::Missing => counts.missing += 1,
            SchemaDiffStatus::Changed => counts.changed += 1,
        }
    }
    Ok(SchemaDiff {
        schema_version: 1,
        engine: baseline.engine(),
        baseline: baseline.into(),
        target: target.into(),
        counts,
        total: objects.len(),
        objects,
    })
}

fn relation_type(relation: &Relation) -> SchemaDiffObjectType {
    if relation.object.kind == ObjectKind::View {
        SchemaDiffObjectType::View
    } else {
        SchemaDiffObjectType::Table
    }
}

fn kind_label(relation: &Relation) -> &'static str {
    match relation.object.kind {
        ObjectKind::Table => "table",
        ObjectKind::View => "view",
        ObjectKind::MaterializedView => "materialized_view",
        ObjectKind::Routine => "function",
        ObjectKind::Sequence => "sequence",
        ObjectKind::Type => "type",
        ObjectKind::Trigger => "trigger",
        ObjectKind::Other => "other",
    }
}

// The first string is the comparison signature; the second preserves the full
// display value. Type spelling alone is case/whitespace insensitive in Desktop.
type Definitions = BTreeMap<String, (String, String)>;

fn columns(relation: &Relation) -> Definitions {
    let primary = relation
        .constraints
        .iter()
        .filter(|constraint| constraint.kind == ConstraintKind::Primary)
        .flat_map(|constraint| constraint.columns.iter())
        .collect::<BTreeSet<_>>();
    relation
        .columns
        .iter()
        .map(|column| {
            let pk = primary.contains(&column.name);
            let signature = format!(
                "{}|{}|{pk}",
                column.native_type.trim().to_lowercase(),
                column.nullable
            );
            let value = format!(
                "{} · {}{}",
                column.native_type,
                if column.nullable { "NULL" } else { "NOT NULL" },
                if pk { " · PK" } else { "" }
            );
            (column.name.clone(), (signature, value))
        })
        .collect()
}

fn indexes(relation: &Relation) -> Definitions {
    relation
        .indexes
        .iter()
        .map(|index| {
            let columns = index
                .keys
                .iter()
                .filter_map(|key| key.column.as_deref())
                .collect::<Vec<_>>();
            let value = format!(
                "{}({})",
                if index.unique { "UNIQUE " } else { "" },
                columns.join(", ")
            );
            (index.name.clone(), (value.clone(), value))
        })
        .collect()
}

fn compare_named(
    objects: &mut Vec<SchemaDiffObject>,
    table: &str,
    kind: SchemaDiffObjectType,
    baseline: Definitions,
    target: Definitions,
) {
    for name in baseline
        .keys()
        .chain(target.keys())
        .collect::<BTreeSet<_>>()
    {
        match (baseline.get(name), target.get(name)) {
            (Some(base), Some(current)) if base.0 != current.0 => objects.push(entry(
                table,
                kind,
                name,
                SchemaDiffStatus::Changed,
                &base.1,
                &current.1,
            )),
            (None, Some(current)) => objects.push(entry(
                table,
                kind,
                name,
                SchemaDiffStatus::Added,
                "—",
                &current.1,
            )),
            (Some(base), None) => objects.push(entry(
                table,
                kind,
                name,
                SchemaDiffStatus::Missing,
                &base.1,
                "—",
            )),
            _ => {}
        }
    }
}

fn foreign_keys(relation: &Relation) -> BTreeMap<String, Vec<String>> {
    let mut columns = BTreeMap::<String, Vec<String>>::new();
    for constraint in &relation.constraints {
        if constraint.kind != ConstraintKind::Foreign {
            continue;
        }
        let Some(reference) = &constraint.referenced_relation else {
            continue;
        };
        let namespace = reference
            .namespace
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| format!("{value}."))
            .unwrap_or_default();
        for (index, column) in constraint.columns.iter().enumerate() {
            let referenced_column = constraint
                .referenced_columns
                .get(index)
                .map(String::as_str)
                .unwrap_or("");
            columns.entry(column.clone()).or_default().push(format!(
                "{column} → {namespace}{}.{referenced_column}",
                reference.name
            ));
        }
    }
    for values in columns.values_mut() {
        values.sort();
    }
    columns
}

fn compare_foreign_keys(
    objects: &mut Vec<SchemaDiffObject>,
    table: &str,
    baseline: &Relation,
    target: &Relation,
) {
    let baseline = foreign_keys(baseline);
    let target = foreign_keys(target);
    for column in baseline
        .keys()
        .chain(target.keys())
        .collect::<BTreeSet<_>>()
    {
        let base = baseline.get(column).map(Vec::as_slice).unwrap_or_default();
        let current = target.get(column).map(Vec::as_slice).unwrap_or_default();
        if base.len() == 1 && current.len() == 1 && base != current {
            objects.push(entry(
                table,
                SchemaDiffObjectType::ForeignKey,
                column,
                SchemaDiffStatus::Changed,
                &base[0],
                &current[0],
            ));
            continue;
        }
        let mut remaining = base.to_vec();
        for value in current {
            if let Some(index) = remaining.iter().position(|candidate| candidate == value) {
                remaining.remove(index);
            } else {
                objects.push(entry(
                    table,
                    SchemaDiffObjectType::ForeignKey,
                    column,
                    SchemaDiffStatus::Added,
                    "—",
                    value,
                ));
            }
        }
        for value in remaining {
            objects.push(entry(
                table,
                SchemaDiffObjectType::ForeignKey,
                column,
                SchemaDiffStatus::Missing,
                &value,
                "—",
            ));
        }
    }
}

fn entry(
    table: &str,
    object_type: SchemaDiffObjectType,
    name: &str,
    status: SchemaDiffStatus,
    baseline_value: &str,
    target_value: &str,
) -> SchemaDiffObject {
    SchemaDiffObject {
        table: table.into(),
        object_type,
        name: name.into(),
        status,
        baseline_value: baseline_value.into(),
        target_value: target_value.into(),
    }
}
