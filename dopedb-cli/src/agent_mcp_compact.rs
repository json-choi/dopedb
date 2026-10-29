//! Conversation-sized projections of Broker results for the Agent bridge.
//!
//! Every MCP result is re-read by the model on each later turn, so these shapes keep
//! the evidence an Agent needs (receipts, columns, keys, attention-worthy plan
//! diagnostics) and drop fields that only repeat defaults or Broker bookkeeping.
//! Rows beyond the requested preview never enter the conversation; the read stays
//! listed in Desktop Activity, where the user can reopen and rerun its SQL.

use dopedb_protocol::{
    CatalogSearchResult, Column, ConstraintKind, Index, ObjectRef, QueryPlanResult, QueryRunResult,
    Relation, SortDirection,
};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const FULL_RESULT_NOTE: &str = "Rows after the preview are not in this conversation. This read is listed as an Agent entry in the connection's Desktop Activity, where the user can reopen its SQL in a SQL tab; reopening runs it again against current data.";

/// One executed read: the receipt, the bounded preview, and plan diagnostics only
/// when the Broker flagged something worth attention.
pub(super) fn query_read(
    plan: &QueryPlanResult,
    run: QueryRunResult,
    preview_rows: usize,
) -> Value {
    let mut out = Map::new();
    out.insert("connectionId".into(), json!(run.connection_id));
    out.insert("database".into(), json!(run.database));
    out.insert("queryRunId".into(), json!(run.query_run_id));
    let result = run.result;
    let returned = result.rows.len().min(preview_rows);
    out.insert("columns".into(), json!(result.columns));
    out.insert(
        "rows".into(),
        json!(result.rows.into_iter().take(returned).collect::<Vec<_>>()),
    );
    out.insert("rowCount".into(), json!(result.row_count));
    out.insert("truncated".into(), json!(result.truncated));
    out.insert("durationMs".into(), json!(result.duration_ms));
    let failures = result
        .decode_failures
        .into_iter()
        .filter(|failure| failure.row_index < returned)
        .collect::<Vec<_>>();
    if !failures.is_empty() {
        out.insert("decodeFailures".into(), json!(failures));
    }
    if result.row_count > returned {
        out.insert(
            "preview".into(),
            json!({
                "returnedRows": returned,
                "omittedRows": result.row_count - returned,
                "fullResult": FULL_RESULT_NOTE,
            }),
        );
    }
    if plan.decision != "ready" || !plan.notices.is_empty() || !plan.suggestions.is_empty() {
        let mut diagnostics = Map::new();
        diagnostics.insert("decision".into(), json!(plan.decision));
        if let Some(environment) = &plan.environment {
            diagnostics.insert("environment".into(), json!(environment));
        }
        if let Some(rows) = plan.estimated_rows {
            diagnostics.insert("estimatedRows".into(), json!(rows));
        }
        diagnostics.insert("notices".into(), json!(plan.notices));
        diagnostics.insert("suggestions".into(), json!(plan.suggestions));
        if plan.health.level != "normal" {
            diagnostics.insert("healthLevel".into(), json!(plan.health.level));
        }
        out.insert("plan".into(), Value::Object(diagnostics));
    }
    Value::Object(out)
}

/// Catalog matches without per-match object bookkeeping; the comment and row
/// estimate let the Agent skip empty or deprecated look-alikes.
pub(super) fn catalog_search(result: CatalogSearchResult) -> Value {
    let matches = result
        .matches
        .into_iter()
        .map(|item| {
            let mut out = Map::new();
            out.insert("qualifiedName".into(), json!(item.qualified_name));
            out.insert("kind".into(), json!(item.object.kind));
            if !item.matched_fields.is_empty() {
                out.insert("matchedFields".into(), json!(item.matched_fields));
            }
            if let Some(comment) = item.comment {
                out.insert("comment".into(), json!(comment));
            }
            if let Some(rows) = item.row_estimate {
                out.insert("rowEstimate".into(), json!(rows));
            }
            Value::Object(out)
        })
        .collect::<Vec<_>>();
    json!({
        "connectionId": result.connection_id,
        "engine": result.engine,
        "database": result.database,
        "capturedAt": result.captured_at,
        "query": result.query,
        "totalMatches": result.total_matches,
        "truncated": result.truncated,
        "matches": matches,
    })
}

/// Describe results for one or more relations in a single conversation entry.
pub(super) fn relations(
    connection_id: Uuid,
    database: &str,
    relations: &[Relation],
    errors: Vec<Value>,
) -> Value {
    let mut out = json!({
        "connectionId": connection_id,
        "database": database,
        "relations": relations
            .iter()
            .map(|item| relation(item, database))
            .collect::<Vec<_>>(),
    });
    if !errors.is_empty() {
        out["errors"] = Value::Array(errors);
    }
    out
}

fn relation(relation: &Relation, database: &str) -> Value {
    let local_name = |object: &ObjectRef| local_name(object, database);
    let mut out = Map::new();
    out.insert("name".into(), json!(local_name(&relation.object)));
    out.insert("kind".into(), json!(relation.object.kind));
    if let Some(comment) = &relation.comment {
        out.insert("comment".into(), json!(comment));
    }
    if let Some(rows) = relation.row_estimate {
        out.insert("rowEstimate".into(), json!(rows));
    }
    if let Some(parent) = &relation.partition_parent {
        out.insert("partitionOf".into(), json!(local_name(parent)));
    }
    if !relation.partition_children.is_empty() {
        out.insert(
            "partitions".into(),
            json!(relation
                .partition_children
                .iter()
                .map(local_name)
                .collect::<Vec<_>>()),
        );
    }
    out.insert(
        "columns".into(),
        json!(relation.columns.iter().map(column).collect::<Vec<_>>()),
    );
    let mut backing = Vec::new();
    for constraint in &relation.constraints {
        match constraint.kind {
            ConstraintKind::Primary => {
                backing.push(constraint.name.as_str());
                out.insert("primaryKey".into(), json!(constraint.columns));
            }
            ConstraintKind::Unique => {
                backing.push(constraint.name.as_str());
                push(
                    &mut out,
                    "unique",
                    json!({ "name": constraint.name, "columns": constraint.columns }),
                );
            }
            ConstraintKind::Foreign => {
                let mut key = Map::new();
                key.insert("name".into(), json!(constraint.name));
                key.insert("columns".into(), json!(constraint.columns));
                if let Some(target) = &constraint.referenced_relation {
                    key.insert("references".into(), json!(local_name(target)));
                }
                key.insert(
                    "referencedColumns".into(),
                    json!(constraint.referenced_columns),
                );
                for (field, action) in [
                    ("onUpdate", &constraint.update_action),
                    ("onDelete", &constraint.delete_action),
                ] {
                    if let Some(action) = action
                        .as_deref()
                        .filter(|action| !is_default_action(action))
                    {
                        key.insert(field.into(), json!(action));
                    }
                }
                if constraint.deferrable {
                    key.insert("deferrable".into(), json!(true));
                }
                if !constraint.validated {
                    key.insert("validated".into(), json!(false));
                }
                push(&mut out, "foreignKeys", Value::Object(key));
            }
            ConstraintKind::Check => {
                let mut check = json!({ "name": constraint.name });
                if let Some(expression) = &constraint.check_expression {
                    check["expression"] = json!(expression);
                }
                if !constraint.validated {
                    check["validated"] = json!(false);
                }
                push(&mut out, "checks", check);
            }
        }
    }
    for index in &relation.indexes {
        if !backing.contains(&index.name.as_str()) {
            push(&mut out, "indexes", index_summary(index));
        }
    }
    Value::Object(out)
}

fn column(column: &Column) -> Value {
    let mut out = Map::new();
    out.insert("name".into(), json!(column.name));
    out.insert("type".into(), json!(column.native_type));
    if !column.nullable {
        out.insert("notNull".into(), json!(true));
    }
    if let Some(default) = &column.default_expression {
        out.insert("default".into(), json!(default));
    }
    if let Some(generated) = &column.generated_expression {
        out.insert("generated".into(), json!(generated));
    }
    if column.identity {
        out.insert("identity".into(), json!(true));
    }
    if column.auto_increment {
        out.insert("autoIncrement".into(), json!(true));
    }
    for (field, value) in [
        ("collation", &column.collation),
        ("comment", &column.comment),
        ("sensitivity", &column.sensitivity),
    ] {
        if let Some(value) = value {
            out.insert(field.into(), json!(value));
        }
    }
    Value::Object(out)
}

fn index_summary(index: &Index) -> Value {
    let keys = index
        .keys
        .iter()
        .map(|key| {
            let target = key
                .column
                .as_deref()
                .or(key.expression.as_deref())
                .unwrap_or("?");
            match key.direction {
                Some(SortDirection::Desc) => format!("{target} DESC"),
                _ => target.to_owned(),
            }
        })
        .collect::<Vec<_>>();
    let mut out = Map::new();
    out.insert("name".into(), json!(index.name));
    out.insert("keys".into(), json!(keys));
    if index.unique {
        out.insert("unique".into(), json!(true));
    }
    if let Some(method) = index
        .method
        .as_deref()
        .filter(|method| !method.eq_ignore_ascii_case("btree"))
    {
        out.insert("method".into(), json!(method));
    }
    if !index.included_columns.is_empty() {
        out.insert("include".into(), json!(index.included_columns));
    }
    if let Some(predicate) = &index.predicate {
        out.insert("predicate".into(), json!(predicate));
    }
    if !index.valid {
        out.insert("valid".into(), json!(false));
    }
    Value::Object(out)
}

/// `schema.name`, keeping the catalog only when it names something other than the
/// described database (for example a BigQuery project or another SQL Server database).
fn local_name(object: &ObjectRef, database: &str) -> String {
    [
        object
            .catalog
            .as_deref()
            .filter(|catalog| *catalog != database),
        object.namespace.as_deref(),
        Some(object.name.as_str()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(".")
}

fn is_default_action(action: &str) -> bool {
    action.eq_ignore_ascii_case("NO ACTION") || action.eq_ignore_ascii_case("a")
}

fn push(out: &mut Map<String, Value>, field: &str, value: Value) {
    match out.get_mut(field) {
        Some(Value::Array(items)) => items.push(value),
        _ => {
            out.insert(field.into(), Value::Array(vec![value]));
        }
    }
}
