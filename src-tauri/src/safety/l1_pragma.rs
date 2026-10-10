//! L1 classification of SQLite `PRAGMA` statements. Schema-introspection forms
//! and the bare (value-reading) form of a closed set of settings are reads; any
//! assignment, unknown name, or unexpected shape changes connection or database
//! state and stays blocked. Cloudflare D1 relies on this decision alone.

use sqlparser::dialect::Dialect;
use sqlparser::tokenizer::{Token, Tokenizer};

use crate::model::{Classification, QueryKind, RiskLevel};

use super::rewrite::word_is;
use super::{fail_safe, ClassificationAnalysis, ClassificationIntegrity};

/// Schema-introspection PRAGMAs: every form only reads the catalog.
const SQLITE_INTROSPECTION_PRAGMAS: &[&str] = &[
    "collation_list",
    "compile_options",
    "database_list",
    "foreign_key_check",
    "foreign_key_list",
    "function_list",
    "index_info",
    "index_list",
    "index_xinfo",
    "integrity_check",
    "module_list",
    "pragma_list",
    "quick_check",
    "table_info",
    "table_list",
    "table_xinfo",
];

/// Setting PRAGMAs whose bare form (no value) only reports the current value.
/// Any assignment (`= value` or `(value)`) changes state and stays blocked.
const SQLITE_READABLE_SETTING_PRAGMAS: &[&str] = &[
    "application_id",
    "auto_vacuum",
    "data_version",
    "encoding",
    "foreign_keys",
    "freelist_count",
    "journal_mode",
    "page_count",
    "page_size",
    "schema_version",
    "user_version",
];

/// Classify a SQLite `PRAGMA [schema.]name [= value | (value)]` statement before
/// the generic parser, which cannot read identifier arguments such as
/// `PRAGMA table_info(t)`. Returns `None` when the text is not a PRAGMA.
pub(super) fn pragma_analysis(sql: &str, dialect: &dyn Dialect) -> Option<ClassificationAnalysis> {
    let tokens = Tokenizer::new(dialect, sql).tokenize().ok()?;
    let significant = tokens
        .iter()
        .filter(|token| !matches!(token, Token::Whitespace(_)))
        .collect::<Vec<_>>();
    if !significant
        .first()
        .is_some_and(|token| word_is(token, "pragma"))
    {
        return None;
    }
    let mut rest = &significant[1..];
    while rest.last().is_some_and(|token| **token == Token::SemiColon) {
        rest = &rest[..rest.len() - 1];
    }
    if rest.len() >= 2 && *rest[1] == Token::Period {
        rest = &rest[2..];
    }
    let name = match rest.first() {
        Some(Token::Word(word)) => word.value.to_ascii_lowercase(),
        _ => {
            return Some(fail_safe(
                "unsupported PRAGMA form — blocked (fail-safe)",
                ClassificationIntegrity::Ambiguous,
            ))
        }
    };
    let argument = &rest[1..];
    let bare = argument.is_empty();
    let single_argument = argument.len() == 3
        && *argument[0] == Token::LParen
        && *argument[2] == Token::RParen
        && matches!(
            argument[1],
            Token::Word(_) | Token::SingleQuotedString(_) | Token::Number(_, _)
        );
    let introspection = SQLITE_INTROSPECTION_PRAGMAS.contains(&name.as_str());
    let readable = (introspection && (bare || single_argument))
        || (bare && SQLITE_READABLE_SETTING_PRAGMAS.contains(&name.as_str()));
    if !readable {
        return Some(fail_safe(
            "PRAGMA changes connection or database state — blocked",
            ClassificationIntegrity::Ambiguous,
        ));
    }
    Some(ClassificationAnalysis {
        classification: Classification {
            kind: QueryKind::Read,
            risk: RiskLevel::Low,
            statement_count: 1,
            no_where: false,
            tables: Vec::new(),
            notes: Vec::new(),
            direct_dml: false,
        },
        integrity: ClassificationIntegrity::ExactSingle,
        parse_failure: None,
        statement_start: None,
    })
}
