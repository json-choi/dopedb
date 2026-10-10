//! L1 statement-kind tables: which parsed statement shapes read, change data,
//! change the schema, or are blocked. Writable queries are detected anywhere in
//! the query tree (DML in CTE bodies or the set-expression tree, row locks,
//! `SELECT … INTO`), `EXPLAIN ANALYZE` in keyword or option form inherits its
//! inner statement's kind, and any unmodeled shape fails closed as privileged.
//! A call to a session-setting function (`set_config`) anywhere in a statement
//! makes it a session statement, rejected exactly like `SET`.

use sqlparser::ast::{Expr, ObjectType, Query, SetExpr, Statement, Value};
use sqlparser::dialect::Dialect;
use sqlparser::tokenizer::{Token, TokenWithSpan, Tokenizer};

use crate::model::{Engine, QueryKind};

use super::{char_offset, ClassificationIntegrity};

/// Functions that change session settings which outlive the statement on a
/// pooled connection, like `SET`: `set_config('default_transaction_read_only',
/// 'off', false)` would leave the read pool writable and `set_config('role', …)`
/// would switch roles. PostgreSQL has no other built-in that changes a setting
/// (`UPDATE pg_settings` is a write and never runs on the read path).
const SESSION_SETTING_FUNCTIONS: &[&str] = &["set_config"];

/// 1-based character position of the first call to a session-setting function.
/// It works on tokens, so a string literal or comment that mentions one never
/// counts, while a quoted, schema-qualified (`pg_catalog.set_config`), or
/// PostgreSQL Unicode-escaped (`U&"set\005fconfig"`) name still does.
pub(super) fn session_setting_call(
    sql: &str,
    engine: Engine,
    dialect: &dyn Dialect,
) -> Option<usize> {
    // Most statements never mention one; skip the tokenizer pass for them.
    let bytes = sql.as_bytes();
    let named = bytes
        .windows(10)
        .any(|window| window.eq_ignore_ascii_case(b"set_config"));
    let escaped = engine == Engine::Postgres && bytes.windows(2).any(|pair| pair == b"&\"");
    if !named && !escaped {
        return None;
    }
    let tokens = Tokenizer::new(dialect, sql).tokenize_with_location().ok()?;
    tokens.iter().enumerate().find_map(|(index, token)| {
        let Token::Word(word) = &token.token else {
            return None;
        };
        let unicode = engine == Engine::Postgres && unicode_escaped(&tokens, index);
        let name = if unicode {
            unicode_identifier(&word.value)?
        } else {
            word.value.clone()
        };
        let called = (index + 1..tokens.len())
            .find(|&next| !matches!(tokens[next].token, Token::Whitespace(_)))
            .is_some_and(|next| tokens[next].token == Token::LParen);
        if !called
            || !SESSION_SETTING_FUNCTIONS
                .iter()
                .any(|function| name.eq_ignore_ascii_case(function))
        {
            return None;
        }
        let start = if unicode {
            tokens[index - 2].span.start
        } else {
            token.span.start
        };
        Some(char_offset(sql, start.line as usize, start.column as usize).unwrap_or(1))
    })
}

/// PostgreSQL reads `U&"…"` with no space before the quote as one identifier
/// with Unicode escapes; the tokenizer splits it into `U`, `&`, and the word.
fn unicode_escaped(tokens: &[TokenWithSpan], index: usize) -> bool {
    let Token::Word(word) = &tokens[index].token else {
        return false;
    };
    index >= 2
        && word.quote_style == Some('"')
        && tokens[index - 1].token == Token::Ampersand
        && matches!(
            &tokens[index - 2].token,
            Token::Word(prefix) if prefix.quote_style.is_none() && prefix.value.eq_ignore_ascii_case("u")
        )
}

/// Decode PostgreSQL identifier escapes: `\XXXX`, `\+XXXXXX`, and `\\`.
/// `UESCAPE` forms do not parse, so they never reach this point.
fn unicode_identifier(raw: &str) -> Option<String> {
    let mut decoded = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            decoded.push(character);
            continue;
        }
        let digits = match chars.clone().next()? {
            '\\' => {
                chars.next();
                decoded.push('\\');
                continue;
            }
            '+' => {
                chars.next();
                6
            }
            _ => 4,
        };
        let hex = chars.by_ref().take(digits).collect::<String>();
        if hex.len() != digits || !hex.chars().all(|digit| digit.is_ascii_hexdigit()) {
            return None;
        }
        decoded.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
    }
    Some(decoded)
}

/// Recursive statement classification. Recurses for `EXPLAIN ANALYZE`, which
/// actually EXECUTES its inner statement, so it must inherit that statement's kind.
pub(super) fn classify_stmt(
    stmt: &Statement,
    notes: &mut Vec<String>,
    no_where: &mut bool,
) -> (QueryKind, ClassificationIntegrity) {
    match stmt {
        Statement::Query(q) => {
            if query_has_dml(q) {
                notes.push(
                    "data-changing statement inside the query or its CTEs — reclassified as a write"
                        .into(),
                );
                (QueryKind::Write, ClassificationIntegrity::ExactSingle)
            } else if query_selects_into(q) {
                // SELECT ... INTO <table> creates and populates a table — not a read.
                notes.push("SELECT ... INTO creates a table — reclassified as DDL".into());
                (QueryKind::Ddl, ClassificationIntegrity::ExactSingle)
            } else if query_has_locks(q) {
                // FOR UPDATE / FOR SHARE takes row locks (would fail on a read-only txn).
                notes.push(
                    "SELECT ... FOR UPDATE/SHARE takes row locks — reclassified as a write".into(),
                );
                (QueryKind::Write, ClassificationIntegrity::ExactSingle)
            } else {
                (QueryKind::Read, ClassificationIntegrity::ExactSingle)
            }
        }
        // Plain EXPLAIN just plans (Read); EXPLAIN ANALYZE runs the statement, so
        // classify by the boxed inner statement (EXPLAIN ANALYZE DELETE = Write/high).
        // PostgreSQL also spells it as an option list: EXPLAIN (ANALYZE[, ...]) ...
        Statement::Explain {
            analyze,
            statement,
            options,
            ..
        } => {
            let analyze_option = options.as_ref().is_some_and(|options| {
                options.iter().any(|option| {
                    option.name.value.eq_ignore_ascii_case("analyze")
                        && !option_disables(option.arg.as_ref())
                })
            });
            if *analyze || analyze_option {
                notes.push(
                    "EXPLAIN ANALYZE executes the statement — classified by its inner statement"
                        .into(),
                );
                classify_stmt(statement, notes, no_where)
            } else {
                (QueryKind::Read, ClassificationIntegrity::ExactSingle)
            }
        }
        // DESCRIBE/SHOW only read catalog or session state. The database-enforced
        // read-only session (L2) remains the final boundary for the result.
        Statement::ExplainTable { .. }
        | Statement::ShowVariable { .. }
        | Statement::ShowVariables { .. }
        | Statement::ShowStatus { .. }
        | Statement::ShowCreate { .. }
        | Statement::ShowColumns { .. }
        | Statement::ShowTables { .. }
        | Statement::ShowViews { .. }
        | Statement::ShowDatabases { .. }
        | Statement::ShowSchemas { .. }
        | Statement::ShowCatalogs { .. }
        | Statement::ShowFunctions { .. }
        | Statement::ShowCollation { .. }
        | Statement::ShowCharset(_)
        | Statement::ShowObjects(_) => (QueryKind::Read, ClassificationIntegrity::ExactSingle),
        // Session-state changes would silently retarget a pooled connection. The
        // schema/database selector owns that choice.
        Statement::Use(_) | Statement::Set(_) => {
            notes.push(
                "USE/SET changes session state — choose the database and schema with the selector"
                    .into(),
            );
            (
                QueryKind::Privilege,
                ClassificationIntegrity::SessionStatement,
            )
        }

        Statement::Insert(_) | Statement::Merge(_) => {
            (QueryKind::Write, ClassificationIntegrity::ExactSingle)
        }
        Statement::Update(update) => {
            *no_where = update.selection.is_none();
            (QueryKind::Write, ClassificationIntegrity::ExactSingle)
        }
        Statement::Delete(del) => {
            *no_where = del.selection.is_none();
            (QueryKind::Write, ClassificationIntegrity::ExactSingle)
        }

        Statement::Drop {
            object_type: ObjectType::Role | ObjectType::User,
            ..
        } => (QueryKind::Privilege, ClassificationIntegrity::ExactSingle),

        Statement::CreateTable(_)
        | Statement::CreateIndex(_)
        | Statement::CreateView { .. }
        | Statement::CreateVirtualTable { .. }
        | Statement::CreateSchema { .. }
        | Statement::CreateDatabase { .. }
        | Statement::CreateFunction(_)
        | Statement::CreateTrigger(_)
        | Statement::CreateProcedure { .. }
        | Statement::CreateSequence { .. }
        | Statement::CreateDomain(_)
        | Statement::CreateType { .. }
        | Statement::CreateExtension(_)
        | Statement::CreateCollation(_)
        | Statement::CreateOperator(_)
        | Statement::CreateOperatorFamily(_)
        | Statement::CreateOperatorClass(_)
        | Statement::AlterTable { .. }
        | Statement::AlterSchema(_)
        | Statement::AlterIndex { .. }
        | Statement::AlterView { .. }
        | Statement::AlterFunction(_)
        | Statement::AlterType(_)
        | Statement::AlterCollation(_)
        | Statement::AlterOperator(_)
        | Statement::AlterOperatorFamily(_)
        | Statement::AlterOperatorClass(_)
        | Statement::Drop { .. }
        | Statement::DropFunction(_)
        | Statement::DropDomain(_)
        | Statement::DropProcedure { .. }
        | Statement::DropTrigger(_)
        | Statement::DropExtension(_)
        | Statement::DropOperator(_)
        | Statement::DropOperatorFamily(_)
        | Statement::DropOperatorClass(_)
        | Statement::RenameTable(_)
        | Statement::Comment { .. }
        | Statement::Truncate { .. } => (QueryKind::Ddl, ClassificationIntegrity::ExactSingle),

        Statement::CreateRole(_)
        | Statement::AlterRole { .. }
        | Statement::CreateUser(_)
        | Statement::AlterUser(_)
        | Statement::CreatePolicy(_)
        | Statement::AlterPolicy(_)
        | Statement::DropPolicy(_)
        | Statement::Grant { .. }
        | Statement::Deny(_)
        | Statement::Revoke { .. } => (QueryKind::Privilege, ClassificationIntegrity::ExactSingle),

        // Unknown / unmodeled statement: the privilege gate hard-stops it. This
        // prevents new parser variants from silently inheriting DML authority.
        other => {
            notes.push(format!(
                "unrecognized statement shape — blocked as privileged (fail-safe): {}",
                short_kind(other)
            ));
            (QueryKind::Privilege, ClassificationIntegrity::Ambiguous)
        }
    }
}

/// True for `SELECT ... INTO <table>` at the top-level select body.
fn query_selects_into(q: &Query) -> bool {
    matches!(&*q.body, SetExpr::Select(s) if s.into.is_some())
}

fn short_kind(stmt: &Statement) -> &'static str {
    match stmt {
        Statement::Query(_) => "Query",
        Statement::Insert(_) => "Insert",
        Statement::Update(_) => "Update",
        Statement::Delete(_) => "Delete",
        _ => "Other",
    }
}

/// `EXPLAIN (ANALYZE false|off|0)` explicitly disables execution; any other
/// argument (or none) enables it, so unknown spellings fail closed as ANALYZE.
fn option_disables(argument: Option<&Expr>) -> bool {
    match argument {
        Some(Expr::Value(value)) => match &value.value {
            Value::Boolean(enabled) => !enabled,
            Value::Number(number, _) => number == "0",
            Value::SingleQuotedString(text) => {
                matches!(
                    text.to_ascii_lowercase().as_str(),
                    "false" | "off" | "0" | "no"
                )
            }
            _ => false,
        },
        Some(Expr::Identifier(ident)) => {
            matches!(
                ident.value.to_ascii_lowercase().as_str(),
                "false" | "off" | "no"
            )
        }
        _ => false,
    }
}

// ---- DML-in-query detection -----------------------------------------------

fn query_has_dml(q: &Query) -> bool {
    if let Some(with) = &q.with {
        if with.cte_tables.iter().any(|cte| query_has_dml(&cte.query)) {
            return true;
        }
    }
    setexpr_has_dml(&q.body)
}

fn setexpr_has_dml(se: &SetExpr) -> bool {
    match se {
        // sqlparser wraps writable-CTE bodies (`WITH ... DELETE`, a CTE whose
        // body is `DELETE ... RETURNING`) as these variants.
        SetExpr::Insert(_) | SetExpr::Update(_) | SetExpr::Delete(_) | SetExpr::Merge(_) => true,
        SetExpr::Query(q) => query_has_dml(q),
        SetExpr::SetOperation { left, right, .. } => {
            setexpr_has_dml(left) || setexpr_has_dml(right)
        }
        SetExpr::Select(_) | SetExpr::Values(_) | SetExpr::Table(_) => false,
    }
}

/// Row-locking clauses anywhere in the query tree, including CTE bodies.
fn query_has_locks(q: &Query) -> bool {
    if !q.locks.is_empty() {
        return true;
    }
    if let Some(with) = &q.with {
        if with
            .cte_tables
            .iter()
            .any(|cte| query_has_locks(&cte.query))
        {
            return true;
        }
    }
    setexpr_has_locks(&q.body)
}

fn setexpr_has_locks(se: &SetExpr) -> bool {
    match se {
        SetExpr::Query(q) => query_has_locks(q),
        SetExpr::SetOperation { left, right, .. } => {
            setexpr_has_locks(left) || setexpr_has_locks(right)
        }
        _ => false,
    }
}
