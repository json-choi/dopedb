//! Collection discovery for the shared [`Catalog`] contract. Collections map to
//! tables (schema `None`, like SQLite/MySQL), sampled top-level fields map to
//! columns, `listIndexes` maps to indexes exactly, and `estimatedDocumentCount`
//! fills the row estimate — matching the contract's "statistics, not exact"
//! semantics. Sampled columns are approximate by nature; only `_id` is certain.

use std::collections::BTreeMap;

use futures::stream::{self, StreamExt, TryStreamExt};
use mongodb::bson::{Bson, Document};
use mongodb::results::CollectionType;

use crate::error::{AppError, AppResult};
use crate::features::catalog::{
    Catalog, CatalogOverview, CatalogOverviewDetailState, CatalogOverviewRelation, Column, Index,
    Table,
};

use super::MongoConnection;

/// How many documents to sample per collection for the field structure.
// ponytail: first-N sample (natural order), not $sample — cheap and cached; use
// $sample only if skewed prefixes turn out to matter in practice.
const SAMPLE_DOCS: usize = 50;
/// Concurrent per-collection introspection probes.
const PROBE_CONCURRENCY: usize = 8;

pub(crate) async fn databases(conn: &MongoConnection) -> AppResult<Vec<String>> {
    let configured = conn.database_name();
    let mut names = conn
        .database_names()
        .await?
        .into_iter()
        .filter(|name| name == configured || !matches!(name.as_str(), "admin" | "config" | "local"))
        .collect::<Vec<_>>();
    names.sort();
    Ok(names)
}

/// Introspect the profile's database into the shared catalog shape.
pub async fn introspect(conn: &MongoConnection) -> AppResult<Catalog> {
    let db = conn.database();
    let mut specs: Vec<_> = db
        .list_collections()
        .await?
        .try_collect::<Vec<_>>()
        .await?
        .into_iter()
        .filter(|spec| !spec.name.starts_with("system."))
        .collect();
    specs.sort_by(|a, b| a.name.cmp(&b.name));

    let tables = stream::iter(specs.into_iter().map(|spec| {
        let db = db.clone();
        async move { table_for(&db, spec.name, spec.collection_type).await }
    }))
    .buffered(PROBE_CONCURRENCY)
    .try_collect::<Vec<_>>()
    .await?;

    Ok(Catalog {
        tables,
        objects: Vec::new(),
    })
}

/// List MongoDB collections and views without sampling documents, requesting
/// indexes, or estimating document counts. Those probes belong exclusively to
/// the complete catalog path.
pub(crate) async fn overview(conn: &MongoConnection, database: &str) -> AppResult<CatalogOverview> {
    let mut specs: Vec<_> = conn
        .database()
        .list_collections()
        .await?
        .try_collect::<Vec<_>>()
        .await?
        .into_iter()
        .filter(|spec| !spec.name.starts_with("system."))
        .map(|spec| {
            overview_relation(
                spec.name,
                matches!(spec.collection_type, CollectionType::View),
            )
        })
        .collect();
    specs.sort_by(|left, right| left.name.cmp(&right.name));

    Ok(CatalogOverview {
        database: database.to_owned(),
        namespaces: Vec::new(),
        relations: specs,
        detail_state: CatalogOverviewDetailState::Deferred,
    })
}

fn overview_relation(name: String, is_view: bool) -> CatalogOverviewRelation {
    CatalogOverviewRelation {
        schema: None,
        name,
        kind: if is_view { "view" } else { "table" }.into(),
        native_id: None,
        comment: None,
        row_estimate: None,
        parent: None,
    }
}

async fn table_for(
    db: &mongodb::Database,
    name: String,
    collection_type: CollectionType,
) -> AppResult<Table> {
    let is_view = matches!(collection_type, CollectionType::View);
    let coll = db.collection::<Document>(&name);

    // The three probes are independent reads — run them concurrently so a
    // remote server pays one round-trip latency per collection, not three.
    let (columns, indexes, row_estimate) = futures::try_join!(
        sample_columns(&coll),
        collection_indexes(&coll, is_view),
        async {
            if is_view {
                Ok(None)
            } else {
                let count = coll.estimated_document_count().await?;
                let count = i64::try_from(count).map_err(|_| {
                    AppError::Config("MongoDB row estimate exceeds the catalog range".into())
                })?;
                Ok::<_, AppError>(Some(count))
            }
        },
    )?;

    Ok(Table {
        schema: None,
        name,
        kind: if is_view {
            "view".into()
        } else {
            "table".into()
        },
        columns,
        foreign_keys: Vec::new(),
        indexes,
        row_estimate,
        ..Table::default()
    })
}

/// Exact index metadata via `listIndexes` (unlike the sampled columns).
/// Views have no collection indexes; every actual driver error is propagated so
/// callers never mistake an incomplete catalog for a complete one.
async fn collection_indexes(
    coll: &mongodb::Collection<Document>,
    is_view: bool,
) -> AppResult<Vec<Index>> {
    if is_view {
        return Ok(Vec::new());
    }
    let mut cursor = coll.list_indexes().await?;
    let mut indexes = Vec::new();
    while let Some(model) = cursor.try_next().await? {
        let options = model.options.as_ref();
        let index_name = options.and_then(|o| o.name.clone()).unwrap_or_default();
        // `_id_` is implicit — its PK-ness is already on the column.
        if index_name == "_id_" {
            continue;
        }
        indexes.push(Index {
            name: index_name,
            columns: model.keys.keys().cloned().collect(),
            unique: options.and_then(|o| o.unique).unwrap_or(false),
            ..Index::default()
        });
    }
    Ok(indexes)
}

/// Union the top-level fields of up to [`SAMPLE_DOCS`] documents into columns.
/// `data_type` is the most frequent observed BSON type; `nullable` means the
/// field was absent or null in at least one sampled document.
async fn sample_columns(coll: &mongodb::Collection<Document>) -> AppResult<Vec<Column>> {
    let mut cursor = coll.find(Document::new()).limit(SAMPLE_DOCS as i64).await?;
    let mut seen = 0usize;
    let mut fields: BTreeMap<String, (BTreeMap<&'static str, usize>, usize)> = BTreeMap::new();
    while let Some(doc) = cursor.try_next().await? {
        seen += 1;
        for (key, value) in doc {
            let entry = fields.entry(key).or_default();
            if matches!(value, Bson::Null) {
                entry.1 += 1; // null counts as present-but-nullable
            } else {
                *entry.0.entry(bson_type_name(&value)).or_default() += 1;
            }
        }
    }

    let mut columns: Vec<Column> = fields
        .into_iter()
        .map(|(name, (types, nulls))| {
            let total = types.values().sum::<usize>() + nulls;
            let data_type = types
                .iter()
                .max_by_key(|(_, count)| **count)
                .map(|(t, _)| (*t).to_string())
                .unwrap_or_else(|| "null".into());
            Column {
                pk: name == "_id",
                nullable: nulls > 0 || total < seen,
                name,
                data_type,
                ..Column::default()
            }
        })
        .collect();
    // `_id` first, everything else keeps the BTreeMap's alphabetical order.
    columns.sort_by_key(|c| !c.pk);
    Ok(columns)
}

fn bson_type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binData",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}
