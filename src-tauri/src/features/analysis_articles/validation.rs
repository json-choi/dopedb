//! Runtime validation for the current one-query Analysis Article contract.

use std::collections::HashSet;

use crate::error::{AppError, AppResult};
use dopedb_protocol::{
    AnalysisArticleConnection, AnalysisArticleDefinition, AnalysisColumn, AnalysisColumnMasking,
    AnalysisColumnRole, AnalysisColumnSensitivity, AnalysisColumnType, SharedAnalysisArticleCreate,
};

pub(crate) const MAX_ARTICLE_RESULT_BYTES: usize = 16 * 1024 * 1024;

fn valid_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphabetic()
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn safe_text(value: &str, maximum: usize, allow_empty: bool) -> bool {
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

fn valid_column(column: &AnalysisColumn) -> bool {
    safe_text(&column.name, 256, false)
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

pub(crate) fn validate_definition(
    definition: &AnalysisArticleDefinition,
    connections: &[AnalysisArticleConnection],
) -> AppResult<()> {
    let query = &definition.query;
    let connection_ids = connections
        .iter()
        .map(|connection| connection.connection_id)
        .collect::<HashSet<_>>();
    let connection_roles = connections
        .iter()
        .map(|connection| connection.role.as_str())
        .collect::<HashSet<_>>();
    let column_names = query
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<HashSet<_>>();
    if definition.version != 3
        || !safe_text(&definition.title, 160, false)
        || !safe_text(&definition.html, 262_144, true)
        || connections.len() != 1
        || connection_ids.len() != connections.len()
        || connection_roles.len() != connections.len()
        || connections.iter().any(|connection| {
            connection.connection_revision < 1
                || !valid_id(&connection.role)
                || !safe_text(&connection.alias, 128, false)
        })
        || !valid_id(&query.id)
        || !safe_text(&query.title, 256, false)
        || !connection_roles.contains(query.connection_role.as_str())
        || query.sql.trim().is_empty()
        || query.sql.len() > 100_000
        || query.sql.contains('\0')
        || query.sql.contains("{{")
        || query.sql.contains("}}")
        || !(1..=50_000).contains(&query.max_rows)
        || !(1_024..=MAX_ARTICLE_RESULT_BYTES).contains(&query.max_bytes)
        || query.columns.is_empty()
        || query.columns.len() > 256
        || column_names.len() != query.columns.len()
        || !query.columns.iter().all(valid_column)
    {
        return Err(AppError::Config(
            "Analysis Article must contain sanitized HTML and one exact manual query".into(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_shared_create(article: &SharedAnalysisArticleCreate) -> AppResult<()> {
    if !article.validate() {
        return Err(AppError::Config(
            "Analysis Article create contract is invalid".into(),
        ));
    }
    validate_definition(&article.definition, &article.connections)
}
