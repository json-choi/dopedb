//! Cross-runtime validation for the current one-query Analysis Article DTO.

use std::collections::HashSet;
use std::hash::Hash;

use uuid::{Uuid, Variant};

use crate::{
    AnalysisArticleConnection, AnalysisArticleDefinition, AnalysisColumn, AnalysisColumnMasking,
    AnalysisColumnRole, AnalysisColumnSensitivity, AnalysisColumnType, SharedAnalysisArticleCreate,
};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_ARTICLE_RESULT_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn shared_create_is_valid(article: &SharedAnalysisArticleCreate) -> bool {
    contract_uuid(&article.id)
        && contract_uuid(&article.project_environment_id)
        && (1..=MAX_SAFE_INTEGER).contains(&article.environment_revision)
        && article
            .source_knowledge_grant_id
            .as_ref()
            .is_none_or(contract_uuid)
        && article.graph_revision_ids.len() <= 32
        && article.graph_revision_ids.iter().all(contract_uuid)
        && unique(article.graph_revision_ids.iter())
        && (article.source_knowledge_grant_id.is_none() == article.graph_revision_ids.is_empty())
        && validate_connections(&article.connections)
        && validate_definition(&article.definition, &article.connections)
}

fn contract_uuid(value: &Uuid) -> bool {
    value.get_variant() == Variant::RFC4122 && (1..=8).contains(&value.get_version_num())
}

fn unique<T, I>(values: I) -> bool
where
    T: Eq + Hash,
    I: IntoIterator<Item = T>,
{
    let mut seen = HashSet::new();
    values.into_iter().all(|value| seen.insert(value))
}

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphabetic()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn display_text(value: &str, maximum: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.chars().count() <= maximum
        && !value.chars().any(|character| {
            matches!(
                character,
                '\u{0000}'..='\u{0008}'
                    | '\u{000b}'
                    | '\u{000c}'
                    | '\u{000e}'..='\u{001f}'
                    | '\u{007f}'
                    | '\u{202a}'..='\u{202e}'
                    | '\u{2066}'..='\u{2069}'
                    | '\u{feff}'
            )
        })
}

fn validate_connections(connections: &[AnalysisArticleConnection]) -> bool {
    !connections.is_empty()
        && connections.len() <= 32
        && connections.iter().all(|connection| {
            contract_uuid(&connection.connection_id)
                && (1..=MAX_SAFE_INTEGER).contains(&connection.connection_revision)
                && valid_id(&connection.role)
                && display_text(&connection.alias, 128, false)
        })
        && unique(
            connections
                .iter()
                .map(|connection| &connection.connection_id),
        )
        && unique(connections.iter().map(|connection| &connection.role))
}

fn validate_column(column: &AnalysisColumn) -> bool {
    display_text(&column.name, 256, false)
        && !(column.role == AnalysisColumnRole::Identifier
            && !matches!(
                column.masking,
                AnalysisColumnMasking::Hash | AnalysisColumnMasking::Redact
            ))
        && !(column.role == AnalysisColumnRole::FreeText
            && column.masking != AnalysisColumnMasking::Redact)
        && !(column.sensitivity == AnalysisColumnSensitivity::Restricted
            && column.masking != AnalysisColumnMasking::Redact)
        && !(column.sensitivity == AnalysisColumnSensitivity::Confidential
            && column.masking == AnalysisColumnMasking::None)
        && !(column.masking == AnalysisColumnMasking::Bucket
            && column.sensitivity != AnalysisColumnSensitivity::Public)
        && !(column.masking == AnalysisColumnMasking::Hash
            && column.column_type != AnalysisColumnType::String)
}

fn validate_columns(columns: &[AnalysisColumn]) -> bool {
    !columns.is_empty()
        && columns.len() <= 256
        && columns.iter().all(validate_column)
        && unique(columns.iter().map(|column| &column.name))
}

fn validate_definition(
    definition: &AnalysisArticleDefinition,
    connections: &[AnalysisArticleConnection],
) -> bool {
    let query = &definition.query;
    definition.version == 3
        && display_text(&definition.title, 160, false)
        && display_text(&definition.html, 262_144, true)
        && valid_id(&query.id)
        && display_text(&query.title, 256, false)
        && connections
            .iter()
            .any(|connection| connection.role == query.connection_role)
        && !query.sql.trim().is_empty()
        && query.sql.len() <= 100_000
        && !query.sql.contains('\0')
        && !query.sql.contains("{{")
        && !query.sql.contains("}}")
        && crate::analysis_article_sql::read_only_sql(&query.sql)
        && (1..=50_000).contains(&query.max_rows)
        && (1_024..=MAX_ARTICLE_RESULT_BYTES).contains(&query.max_bytes)
        && validate_columns(&query.columns)
}
