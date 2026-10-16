//! L1 re-parse of valid dialect forms the parser does not model (`TABLE t`,
//! PostgreSQL `ROWS FROM` and XML name arguments, SQLite `INDEXED BY` and
//! `IS [NOT] expr`). The token rewrite touches only those read-only shapes and
//! never removes or renames a data-changing keyword, so a write keeps its write
//! classification. The rewritten text is used for classification only; the
//! submitted SQL is what runs.

use sqlparser::ast::Statement;
use sqlparser::dialect::Dialect;
use sqlparser::keywords::Keyword;
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer};

use crate::model::Engine;

pub(super) fn next_significant(tokens: &[Token], from: usize) -> Option<usize> {
    (from..tokens.len()).find(|&index| !matches!(tokens[index], Token::Whitespace(_)))
}

pub(super) fn previous_significant(tokens: &[Token], before: usize) -> Option<usize> {
    (0..before)
        .rev()
        .find(|&index| !matches!(tokens[index], Token::Whitespace(_)))
}

pub(super) fn word_is(token: &Token, value: &str) -> bool {
    matches!(token, Token::Word(word) if word.quote_style.is_none() && word.value.eq_ignore_ascii_case(value))
}

pub(super) fn keyword_is(token: &Token, keyword: Keyword) -> bool {
    matches!(token, Token::Word(word) if word.quote_style.is_none() && word.keyword == keyword)
}

/// Re-parse a statement after rewriting only read-only dialect shapes that the
/// parser does not model. No rewrite removes or renames a data-changing keyword,
/// so a write keeps its write classification; the rewritten text is never run.
pub(super) fn parse_compatible_form(
    sql: &str,
    engine: Engine,
    dialect: &dyn Dialect,
) -> Option<Vec<Statement>> {
    let tokens = Tokenizer::new(dialect, sql).tokenize().ok()?;
    let mut replaced: Vec<Option<String>> = vec![None; tokens.len()];
    let mut changed = false;
    for index in 0..tokens.len() {
        let token = &tokens[index];
        // `TABLE name` is the SQL-standard shorthand for `SELECT * FROM name`.
        if matches!(engine, Engine::Postgres | Engine::Mysql) && keyword_is(token, Keyword::TABLE) {
            let starts_query = match previous_significant(&tokens, index).map(|i| &tokens[i]) {
                None | Some(Token::LParen) => true,
                Some(previous) => [
                    Keyword::UNION,
                    Keyword::INTERSECT,
                    Keyword::EXCEPT,
                    Keyword::ALL,
                    Keyword::DISTINCT,
                ]
                .iter()
                .any(|keyword| keyword_is(previous, *keyword)),
            };
            let names_relation = next_significant(&tokens, index + 1)
                .is_some_and(|next| matches!(tokens[next], Token::Word(_)));
            if starts_query && names_relation {
                replaced[index] = Some("SELECT * FROM".into());
                changed = true;
            }
        }
        if engine == Engine::Sqlite {
            // `INDEXED BY name` / `NOT INDEXED` are planner hints only.
            if word_is(token, "indexed") {
                let by = next_significant(&tokens, index + 1)
                    .filter(|&i| keyword_is(&tokens[i], Keyword::BY));
                let name = by.and_then(|by| {
                    next_significant(&tokens, by + 1)
                        .filter(|&i| matches!(tokens[i], Token::Word(_)))
                });
                if let Some(name) = name {
                    replaced[index..=name].fill(Some(String::new()));
                    changed = true;
                } else if let Some(not) = previous_significant(&tokens, index)
                    .filter(|&i| keyword_is(&tokens[i], Keyword::NOT))
                {
                    replaced[not..=index].fill(Some(String::new()));
                    changed = true;
                }
            }
            // SQLite `a IS b` / `a IS NOT b` compare two arbitrary expressions.
            if keyword_is(token, Keyword::IS) {
                let next = next_significant(&tokens, index + 1);
                let negated = next.filter(|&i| keyword_is(&tokens[i], Keyword::NOT));
                let operand = match negated {
                    Some(not) => next_significant(&tokens, not + 1),
                    None => next,
                };
                let standard = operand.is_some_and(|i| {
                    [
                        Keyword::NULL,
                        Keyword::TRUE,
                        Keyword::FALSE,
                        Keyword::DISTINCT,
                        Keyword::UNKNOWN,
                        Keyword::JSON,
                        Keyword::NORMALIZED,
                        Keyword::NFC,
                        Keyword::NFD,
                        Keyword::NFKC,
                        Keyword::NFKD,
                    ]
                    .iter()
                    .any(|keyword| keyword_is(&tokens[i], *keyword))
                });
                if operand.is_some() && !standard {
                    match negated {
                        Some(not) => {
                            replaced[index] = Some("IS DISTINCT FROM".into());
                            replaced[index + 1..=not].fill(Some(String::new()));
                        }
                        None => replaced[index] = Some("IS NOT DISTINCT FROM".into()),
                    }
                    changed = true;
                }
            }
        }
        if engine == Engine::Postgres {
            // `ROWS FROM (f(...), g(...))` zips set-returning functions.
            if keyword_is(token, Keyword::ROWS) {
                let from = next_significant(&tokens, index + 1)
                    .filter(|&i| keyword_is(&tokens[i], Keyword::FROM));
                if let Some(from) = from.filter(|&from| {
                    next_significant(&tokens, from + 1).is_some_and(|i| tokens[i] == Token::LParen)
                }) {
                    replaced[index] = Some("unnest".into());
                    replaced[index + 1..=from].fill(Some(String::new()));
                    changed = true;
                }
            }
            // `xmlelement(name tag, ...)` and `xmlpi(name target, ...)` name a tag.
            if word_is(token, "xmlelement") || word_is(token, "xmlpi") {
                let name = next_significant(&tokens, index + 1)
                    .filter(|&i| tokens[i] == Token::LParen)
                    .and_then(|open| next_significant(&tokens, open + 1))
                    .filter(|&i| word_is(&tokens[i], "name"));
                if let Some(name) = name {
                    if let Some(tag) = next_significant(&tokens, name + 1) {
                        if let Token::Word(word) = &tokens[tag] {
                            replaced[name..tag].fill(Some(String::new()));
                            replaced[tag] = Some(format!("'{}'", word.value.replace('\'', "''")));
                            changed = true;
                        }
                    }
                }
            }
        }
    }
    if !changed {
        return None;
    }
    let rewritten = tokens
        .iter()
        .zip(replaced)
        .map(|(token, replacement)| replacement.unwrap_or_else(|| token.to_string()))
        .collect::<String>();
    Parser::parse_sql(dialect, &rewritten).ok()
}
