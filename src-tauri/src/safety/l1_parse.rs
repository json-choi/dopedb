//! L1 — parse & classify. A **UX pre-filter only** (L2 is authoritative), except
//! where a target has no database-enforced read-only session (Cloudflare D1), so
//! every write shape must classify as a write here.
//!
//! Contract with the rest of the engine:
//! - `> 1` top-level statement → High risk, kind `Write` (stacked-injection guard).
//! - `Query` bodies and CTEs are recursed; any `INSERT`/`UPDATE`/`DELETE`/`MERGE`
//!   anywhere in the set-expression tree reclassifies the statement to `Write`.
//! - `EXPLAIN ANALYZE` (keyword or `(ANALYZE ...)` option) executes its statement
//!   and inherits that statement's kind; a plain `EXPLAIN` stays a read.
//! - `SHOW`, `DESCRIBE`, and read-only SQLite `PRAGMA` forms are reads; writable
//!   `PRAGMA` forms stay blocked. `USE`/`SET` are rejected as session statements.
//! - `UPDATE`/`DELETE` with `selection.is_none()` → `no_where` + High risk.
//! - **Any parse error or ambiguity → `Privilege` / High risk (fail safe), never
//!   an `Err`** — once DML and DDL have separate authority, an unknown statement
//!   must not inherit the narrower data-change credential. The privilege gate
//!   hard-stops it, and [`ClassificationAnalysis::rejection`] names the reason
//!   (parse failure with its position, session statement, or policy block).
//! - A few valid dialect forms the parser lacks (`TABLE t`, `ROWS FROM`, XML name
//!   arguments, SQLite `INDEXED BY` and `IS [NOT] expr`) are re-parsed after a
//!   token rewrite that only touches those read-only shapes; the rewritten text
//!   is used for classification only, never executed.
//!
//! This module owns the analysis contract and parse-failure positions.
//! Statement-kind tables and the `set_config` scan live in
//! `l1_statement_kinds.rs`, the dialect rewrite in `l1_rewrite.rs`, SQLite
//! `PRAGMA` decisions in `l1_pragma.rs`, and approval-card table collection in
//! `l1_tables.rs`.

use sqlparser::ast::Statement;
use sqlparser::dialect::{
    BigQueryDialect, Dialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::{Parser, ParserError};
use sqlparser::tokenizer::{Token, Tokenizer};

use crate::error::{AppError, AppResult};
use crate::model::{Classification, Engine, QueryKind, RiskLevel};

#[path = "l1_pragma.rs"]
mod pragma;
#[path = "l1_rewrite.rs"]
mod rewrite;
#[path = "l1_statement_kinds.rs"]
mod statement_kinds;
#[path = "l1_tables.rs"]
mod tables;

use pragma::pragma_analysis;
use rewrite::parse_compatible_form;
use statement_kinds::{classify_stmt, session_setting_call};
use tables::{collect_tables, dedup};

/// Parser confidence that is deliberately kept outside the serialized SQL
/// classification wire contract. Callers that may acquire a target capability
/// must use this signal rather than interpreting human-facing `notes` strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassificationIntegrity {
    /// Exactly one statement parsed under the selected SQL dialect.
    ExactSingle,
    /// Parsing failed or produced no statement.
    ParseFailed,
    /// More than one top-level statement was present.
    MultipleStatements,
    /// The connection uses a document API rather than a SQL dialect.
    DocumentFamily,
    /// A statement parsed but its shape is not allowlisted by the classifier.
    Ambiguous,
    /// A session-state statement (`USE`, `SET`, or a `set_config` call). DopeDB
    /// owns database and schema selection and the pooled session's read-only
    /// default, so it is rejected rather than run on a pooled session.
    SessionStatement,
}

/// Parser detail kept for a [`ClassificationIntegrity::ParseFailed`] result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlParseFailure {
    /// Parser message without its trailing line/column suffix.
    pub message: String,
    /// 1-based character offset into the classified SQL text.
    pub position: Option<usize>,
}

/// Internal classification result that pairs the stable wire payload with its
/// non-serializable parser-integrity signal.
#[derive(Debug, Clone)]
pub struct ClassificationAnalysis {
    pub classification: Classification,
    pub integrity: ClassificationIntegrity,
    pub parse_failure: Option<SqlParseFailure>,
    /// 1-based character offset a blocked statement reports: the session-setting
    /// call when one was found, otherwise the first significant token.
    pub statement_start: Option<usize>,
}

impl ClassificationAnalysis {
    /// The typed pre-execution rejection for a statement that the gate blocks as
    /// privileged or unclassifiable. `offset` is the 1-based character position
    /// of the classified text inside the SQL the user submitted (1 when the text
    /// was submitted on its own), so script statements report script positions.
    pub fn rejection(&self, offset: usize) -> AppError {
        let shift = |position: usize| offset.max(1).saturating_add(position).saturating_sub(1);
        let start = Some(shift(self.statement_start.unwrap_or(1)));
        match self.integrity {
            ClassificationIntegrity::ParseFailed => {
                let failure = self.parse_failure.clone().unwrap_or(SqlParseFailure {
                    message: "no executable SQL statement was found".into(),
                    position: None,
                });
                AppError::SqlParseFailed {
                    message: failure.message,
                    position: failure.position.map(shift).or(start),
                }
            }
            ClassificationIntegrity::SessionStatement => {
                AppError::SessionStatementBlocked { position: start }
            }
            _ => AppError::SqlPolicyBlocked { position: start },
        }
    }

    /// Whether a casual Explain may acquire a read target capability.
    pub fn is_exact_single_read(&self) -> bool {
        matches!(self.integrity, ClassificationIntegrity::ExactSingle)
            && matches!(self.classification.kind, QueryKind::Read)
    }

    /// Whether an impact preview may acquire a target read capability before a
    /// durable approval exists. Only a clean read or direct DML is
    /// eligible; every fail-safe classification remains pre-connection only.
    pub fn may_touch_target_for_impact_preview(&self) -> bool {
        matches!(self.integrity, ClassificationIntegrity::ExactSingle)
            && (matches!(self.classification.kind, QueryKind::Read)
                || (matches!(self.classification.kind, QueryKind::Write)
                    && self.classification.direct_dml))
    }
}

fn dialect_for(engine: Engine) -> Option<Box<dyn Dialect>> {
    match engine {
        Engine::Postgres => Some(Box::new(PostgreSqlDialect {})),
        Engine::Mysql => Some(Box::new(MySqlDialect {})),
        Engine::Sqlite => Some(Box::new(SQLiteDialect {})),
        Engine::Mongodb => None,
        Engine::Bigquery => Some(Box::new(BigQueryDialect {})),
    }
}

/// Fail-safe classification: treat as a High-risk privilege change so the gate
/// hard-stops it instead of letting ambiguous DDL inherit a DML credential.
fn fail_safe(
    note: impl Into<String>,
    integrity: ClassificationIntegrity,
) -> ClassificationAnalysis {
    ClassificationAnalysis {
        classification: Classification {
            kind: QueryKind::Privilege,
            risk: RiskLevel::High,
            statement_count: 1,
            no_where: false,
            tables: Vec::new(),
            notes: vec![note.into()],
            direct_dml: false,
        },
        integrity,
        parse_failure: None,
        statement_start: None,
    }
}

/// Classify `sql` and return its precise pre-execution rejection. Callers that
/// kept only the wire classification use this on the (rare) blocked path.
pub fn rejection_error(sql: &str, engine: Engine) -> AppError {
    rejection_error_at(sql, engine, 1)
}

/// [`rejection_error`] for one statement of a script that starts at the 1-based
/// character `offset` of the submitted script.
pub fn rejection_error_at(statement: &str, engine: Engine, offset: usize) -> AppError {
    match classify_with_integrity(statement, engine) {
        Ok(analysis) => analysis.rejection(offset),
        Err(error) => error,
    }
}

/// Classify one SQL string. Never returns `Err` for a *statement-level* problem
/// (those become fail-safe writes); the `AppResult` signature is kept so callers
/// have a uniform error channel for genuinely impossible states.
pub fn classify_with_integrity(sql: &str, engine: Engine) -> AppResult<ClassificationAnalysis> {
    let Some(dialect) = dialect_for(engine) else {
        return Ok(fail_safe(
            "MongoDB document operations must use the typed document-query API",
            ClassificationIntegrity::DocumentFamily,
        ));
    };
    let mut analysis = classify_parsed(sql, engine, &*dialect);
    // Only a blocked result reports a position, so ordinary reads and writes
    // never pay for the extra tokenizer pass.
    if analysis.classification.kind == QueryKind::Privilege && analysis.statement_start.is_none() {
        analysis.statement_start = first_significant_position(sql, &*dialect);
    }
    Ok(analysis)
}

fn classify_parsed(sql: &str, engine: Engine, dialect: &dyn Dialect) -> ClassificationAnalysis {
    if engine == Engine::Sqlite
        && sql
            .as_bytes()
            .windows(6)
            .any(|window| window.eq_ignore_ascii_case(b"pragma"))
    {
        if let Some(analysis) = pragma_analysis(sql, dialect) {
            return analysis;
        }
    }
    let statements = match Parser::parse_sql(dialect, sql) {
        Ok(s) => s,
        Err(original) => match parse_compatible_form(sql, engine, dialect) {
            Some(statements) => statements,
            None => {
                let mut analysis = fail_safe(
                    "SQL could not be parsed — blocked before execution (fail-safe)",
                    ClassificationIntegrity::ParseFailed,
                );
                analysis.parse_failure = Some(parse_failure(sql, &original));
                return analysis;
            }
        },
    };

    if statements.is_empty() {
        return fail_safe(
            "no parseable statement — treated as a write (fail-safe)",
            ClassificationIntegrity::ParseFailed,
        );
    }

    if statements.len() > 1 {
        let mut tables = Vec::new();
        for s in &statements {
            collect_tables(s, &mut tables);
        }
        dedup(&mut tables);
        return ClassificationAnalysis {
            classification: Classification {
                kind: QueryKind::Write,
                risk: RiskLevel::High,
                statement_count: statements.len() as u32,
                no_where: false,
                tables,
                notes: vec![format!(
                    "{} statements found — only single statements are allowed",
                    statements.len()
                )],
                direct_dml: false,
            },
            integrity: ClassificationIntegrity::MultipleStatements,
            parse_failure: None,
            statement_start: None,
        };
    }

    // A session-setting call outlives the statement on a pooled connection, so it
    // is a session statement wherever it appears (select list, FROM, subquery).
    if let Some(position) = session_setting_call(sql, engine, dialect) {
        let mut analysis = fail_safe(
            "set_config changes session settings — blocked like SET",
            ClassificationIntegrity::SessionStatement,
        );
        analysis.statement_start = Some(position);
        return analysis;
    }

    let stmt = &statements[0];
    let mut notes = Vec::new();
    let mut no_where = false;

    let (kind, integrity) = classify_stmt(stmt, &mut notes, &mut no_where);

    if no_where {
        notes.push("UPDATE/DELETE without a WHERE clause — affects every row".into());
    }

    let risk = match kind {
        QueryKind::Read => RiskLevel::Low,
        QueryKind::Write if no_where => RiskLevel::High,
        QueryKind::Write => RiskLevel::Medium,
        QueryKind::Ddl | QueryKind::Privilege => RiskLevel::High,
    };

    let mut tables = Vec::new();
    collect_tables(stmt, &mut tables);
    dedup(&mut tables);

    ClassificationAnalysis {
        classification: Classification {
            kind,
            risk,
            statement_count: 1,
            no_where,
            tables,
            notes,
            // Utility statements and write-like query forms stay gated, while
            // direct DML can participate in bounded table-change workflows.
            direct_dml: matches!(
                stmt,
                Statement::Insert(_) | Statement::Update(_) | Statement::Delete(_)
            ),
        },
        integrity,
        parse_failure: None,
        statement_start: None,
    }
}

/// Stable public classification wire payload for callers that do not acquire a
/// target capability. Capability-owning flows use [`classify_with_integrity`].
pub fn classify(sql: &str, engine: Engine) -> AppResult<Classification> {
    Ok(classify_with_integrity(sql, engine)?.classification)
}

// ---- Parse failure detail ---------------------------------------------------

/// Split sqlparser's ` at Line: L, Column: C` suffix into a 1-based character
/// offset so the UI can point at the exact token like a PostgreSQL error.
fn parse_failure(sql: &str, error: &ParserError) -> SqlParseFailure {
    let raw = match error {
        ParserError::TokenizerError(message) | ParserError::ParserError(message) => {
            message.as_str()
        }
        ParserError::RecursionLimitExceeded => "the statement is nested too deeply",
    };
    let (message, location) = match raw.rfind(" at Line: ") {
        Some(index) => (
            &raw[..index],
            parse_location(&raw[index + " at Line: ".len()..]),
        ),
        None => (raw, None),
    };
    // sqlparser reports an unexpected end of input without a location; point
    // just past the last significant character, as PostgreSQL does.
    let position = match location {
        Some((line, column)) => {
            char_offset(sql, line, column).map(|offset| named_token_offset(sql, message, offset))
        }
        None if message.ends_with("found: EOF") => Some(sql.trim_end().chars().count() + 1),
        None => None,
    };
    SqlParseFailure {
        message: message.trim().chars().take(500).collect(),
        position,
    }
}

/// sqlparser can report the location of the token after the one its message
/// names ("found: FROM" located at the following identifier). When the named
/// token sits immediately before the reported offset, separated only by
/// whitespace, point at the named token instead.
fn named_token_offset(sql: &str, message: &str, reported: usize) -> usize {
    let Some((_, found)) = message.rsplit_once("found: ") else {
        return reported;
    };
    let needle: Vec<char> = found.trim().chars().collect();
    if needle.is_empty() || found.trim() == "EOF" {
        return reported;
    }
    let chars: Vec<char> = sql.chars().collect();
    let at = reported.saturating_sub(1).min(chars.len());
    let matches_at = |start: usize| {
        chars
            .get(start..start + needle.len())
            .is_some_and(|window| {
                window
                    .iter()
                    .zip(&needle)
                    .all(|(left, right)| left.eq_ignore_ascii_case(right))
            })
    };
    if matches_at(at) {
        return reported;
    }
    let mut end = at;
    while end > 0 && chars[end - 1].is_whitespace() {
        end -= 1;
    }
    match end.checked_sub(needle.len()) {
        Some(start) if matches_at(start) => start + 1,
        _ => reported,
    }
}

fn parse_location(text: &str) -> Option<(usize, usize)> {
    let (line, rest) = text.split_once(", Column: ")?;
    let column = rest
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    Some((line.trim().parse().ok()?, column.parse().ok()?))
}

/// Convert sqlparser's 1-based line/column (columns count characters) into a
/// 1-based character offset. A location just past the end maps to `len + 1`.
fn char_offset(sql: &str, line: usize, column: usize) -> Option<usize> {
    if line == 0 || column == 0 {
        return None;
    }
    let (mut current_line, mut current_column) = (1_usize, 1_usize);
    let mut count = 0_usize;
    for character in sql.chars() {
        if current_line == line && current_column == column {
            return Some(count + 1);
        }
        count += 1;
        if character == '\n' {
            current_line += 1;
            current_column = 1;
        } else {
            current_column += 1;
        }
    }
    (current_line == line && current_column <= column).then_some(count + 1)
}

/// 1-based character offset of the first non-whitespace, non-comment token.
fn first_significant_position(sql: &str, dialect: &dyn Dialect) -> Option<usize> {
    let tokens = Tokenizer::new(dialect, sql).tokenize_with_location().ok()?;
    let start = tokens
        .iter()
        .find(|token| !matches!(token.token, Token::Whitespace(_)))?
        .span
        .start;
    char_offset(sql, start.line as usize, start.column as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(sql: &str) -> Classification {
        classify(sql, Engine::Postgres).unwrap()
    }

    fn analysis(sql: &str, engine: Engine) -> ClassificationAnalysis {
        classify_with_integrity(sql, engine).unwrap()
    }

    #[test]
    fn integrity_marks_exact_parse_failures_multi_statement_and_document_family() {
        assert_eq!(
            analysis("SELECT id FROM users", Engine::Postgres).integrity,
            ClassificationIntegrity::ExactSingle
        );
        assert_eq!(
            analysis("this is not sql", Engine::Postgres).integrity,
            ClassificationIntegrity::ParseFailed
        );
        assert_eq!(
            analysis("SELECT 1; SELECT 2", Engine::Postgres).integrity,
            ClassificationIntegrity::MultipleStatements
        );
        assert_eq!(
            analysis(r#"{ "find": "users" }"#, Engine::Mongodb).integrity,
            ClassificationIntegrity::DocumentFamily
        );
        // Session statements are rejected with their own typed reason.
        for (sql, engine) in [
            ("SET search_path = audit", Engine::Postgres),
            ("SET search_path TO audit", Engine::Postgres),
            ("USE analytics", Engine::Mysql),
            ("SET NAMES utf8mb4", Engine::Mysql),
        ] {
            let parsed = analysis(sql, engine);
            assert_eq!(
                parsed.integrity,
                ClassificationIntegrity::SessionStatement,
                "{sql}"
            );
            assert_eq!(parsed.classification.kind, QueryKind::Privilege, "{sql}");
            let error = serde_json::to_value(parsed.rejection(1)).unwrap();
            assert_eq!(error["kind"], "sessionStatementBlocked", "{sql}");
            assert_eq!(error["position"], 1, "{sql}");
        }
        // A set_config call would leave a pooled session writable or switch its
        // role, so it is a session statement wherever it appears and however the
        // name is spelled; the position points at the call. A string literal, a
        // comment, or reading a setting is not a call.
        for (sql, position) in [
            (
                "SELECT set_config('default_transaction_read_only', 'off', false)",
                8,
            ),
            (
                "SELECT 1 FROM pg_catalog.set_config('role', 'admin', false)",
                26,
            ),
            (
                r#"SELECT "pg_catalog"."set_config" ('role', 'admin', false)"#,
                21,
            ),
            (r#"SELECT U&"set\005fconfig"('role', 'admin', false)"#, 8),
            (
                "SELECT id FROM t WHERE x = (SELECT set_config('search_path', 'x', false))",
                36,
            ),
        ] {
            let parsed = analysis(sql, Engine::Postgres);
            assert_eq!(
                parsed.integrity,
                ClassificationIntegrity::SessionStatement,
                "{sql}"
            );
            let error = serde_json::to_value(parsed.rejection(1)).unwrap();
            assert_eq!(error["kind"], "sessionStatementBlocked", "{sql}");
            assert_eq!(error["position"], position, "{sql}");
        }
        for sql in [
            "SELECT 'set_config(' AS s",
            "SELECT 1 -- set_config(\n",
            "SELECT current_setting('default_transaction_read_only')",
        ] {
            let parsed = analysis(sql, Engine::Postgres);
            assert_eq!(
                parsed.integrity,
                ClassificationIntegrity::ExactSingle,
                "{sql}"
            );
            assert_eq!(parsed.classification.kind, QueryKind::Read, "{sql}");
        }
        // A parse failure keeps the parser position as a 1-based character
        // offset (multi-byte text counts characters) and is shifted into the
        // script that contained the statement.
        let failed = analysis("SELECT '한글'\nFROM t WHERE a = = 1", Engine::Postgres);
        assert_eq!(failed.integrity, ClassificationIntegrity::ParseFailed);
        assert_eq!(failed.classification.kind, QueryKind::Privilege);
        let detail = failed.parse_failure.clone().unwrap();
        assert_eq!(detail.position, Some(30));
        assert!(!detail.message.contains("Line:"));
        let standalone = serde_json::to_value(failed.rejection(1)).unwrap();
        assert_eq!(standalone["kind"], "sqlParseFailed");
        assert_eq!(standalone["position"], 30);
        let in_script = serde_json::to_value(failed.rejection(5)).unwrap();
        assert_eq!(in_script["position"], 34);
        let truncated = analysis("UPDATE t SET  ", Engine::Postgres);
        assert_eq!(truncated.parse_failure.unwrap().position, Some(13));
        // The caret points at the token the message names, not the one after it.
        let misplaced = analysis("SELECT id, FROM sales.orders WHERE", Engine::Postgres);
        assert_eq!(misplaced.parse_failure.unwrap().position, Some(12));
        let blocked = serde_json::to_value(
            analysis("\n  GRANT SELECT ON t TO r", Engine::Postgres).rejection(1),
        )
        .unwrap();
        assert_eq!(blocked["kind"], "sqlPolicyBlocked");
        assert_eq!(blocked["position"], 4);
    }

    #[test]
    fn integrity_does_not_depend_on_human_facing_notes() {
        let mut parsed = analysis("this is not sql", Engine::Postgres);
        let integrity = parsed.integrity;
        let target_touch_allowed = parsed.may_touch_target_for_impact_preview();
        parsed.classification.notes = vec!["changed copy for a localized UI".into()];
        assert_eq!(integrity, ClassificationIntegrity::ParseFailed);
        assert_eq!(parsed.integrity, ClassificationIntegrity::ParseFailed);
        assert!(!target_touch_allowed);
        assert!(!parsed.may_touch_target_for_impact_preview());
    }

    #[test]
    fn select_is_read() {
        let r = c("SELECT id FROM users WHERE id = 1");
        assert_eq!(r.kind, QueryKind::Read);
        assert_eq!(r.risk, RiskLevel::Low);
        assert!(r.tables.contains(&"users".to_string()));
        // Read-only utility statements and dialect forms the parser lacks.
        for (sql, engine) in [
            ("SHOW search_path", Engine::Postgres),
            ("TABLE users", Engine::Postgres),
            (
                "SELECT * FROM ROWS FROM (generate_series(1, 2), generate_series(1, 3)) AS x(a, b)",
                Engine::Postgres,
            ),
            ("SELECT xmlelement(name item, 'body')", Engine::Postgres),
            ("SHOW TABLES", Engine::Mysql),
            ("SHOW CREATE TABLE users", Engine::Mysql),
            ("DESCRIBE users", Engine::Mysql),
            ("TABLE users ORDER BY id LIMIT 5", Engine::Mysql),
            ("PRAGMA table_info(users)", Engine::Sqlite),
            ("PRAGMA main.table_info('users');", Engine::Sqlite),
            ("PRAGMA user_version", Engine::Sqlite),
            (
                "SELECT * FROM users INDEXED BY users_name WHERE name IS NOT nickname",
                Engine::Sqlite,
            ),
        ] {
            let parsed = analysis(sql, engine);
            assert_eq!(parsed.classification.kind, QueryKind::Read, "{sql}");
            assert_eq!(
                parsed.integrity,
                ClassificationIntegrity::ExactSingle,
                "{sql}"
            );
        }
    }

    #[test]
    fn delete_without_where_is_high_risk_write() {
        let r = c("DELETE FROM orders");
        assert_eq!(r.kind, QueryKind::Write);
        assert!(r.no_where);
        assert_eq!(r.risk, RiskLevel::High);
    }

    #[test]
    fn update_with_where_is_medium() {
        let r = c("UPDATE users SET name = 'x' WHERE id = 1");
        assert!(!r.no_where);
        assert_eq!(r.risk, RiskLevel::Medium);
    }

    #[test]
    fn multi_statement_rejected() {
        let r = c("SELECT 1; DROP TABLE users");
        assert!(r.statement_count > 1);
        assert_eq!(r.risk, RiskLevel::High);
    }

    #[test]
    fn writable_cte_reclassified_as_write() {
        let r = c("WITH d AS (INSERT INTO log VALUES (1) RETURNING id) SELECT * FROM d");
        assert_eq!(r.kind, QueryKind::Write);
        // Cloudflare D1 trusts this classifier alone, so every writable shape
        // (CTE bodies, a DML body after WITH, MERGE, rewritten dialect forms)
        // must stay a write.
        for (sql, engine) in [
            ("WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d", Engine::Postgres),
            ("WITH stale AS (SELECT 1) DELETE FROM orders", Engine::Postgres),
            ("WITH s AS (SELECT 1 AS id) MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE", Engine::Postgres),
            ("MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE", Engine::Postgres),
            ("DELETE FROM t WHERE id IN (TABLE ids)", Engine::Postgres),
            ("DELETE FROM t INDEXED BY t_id WHERE a IS b", Engine::Sqlite),
            ("WITH old AS (SELECT id FROM t) DELETE FROM t WHERE id IN (SELECT id FROM old)", Engine::Sqlite),
        ] {
            assert_eq!(analysis(sql, engine).classification.kind, QueryKind::Write, "{sql}");
        }
    }

    #[test]
    fn ddl_is_ddl() {
        for sql in [
            "DROP TABLE users",
            "CREATE FUNCTION answer() RETURNS integer LANGUAGE SQL AS 'SELECT 42'",
            "ALTER TYPE mood ADD VALUE 'calm'",
            "COMMENT ON TABLE users IS 'accounts'",
        ] {
            assert_eq!(c(sql).kind, QueryKind::Ddl, "{sql}");
        }
    }

    #[test]
    fn explain_analyze_delete_is_write() {
        assert_eq!(c("EXPLAIN SELECT * FROM users").kind, QueryKind::Read);
        // EXPLAIN ANALYZE actually runs the DELETE — must be a write, not a read.
        let r = c("EXPLAIN ANALYZE DELETE FROM orders");
        assert_eq!(r.kind, QueryKind::Write);
        assert!(r.no_where);
        assert_eq!(r.risk, RiskLevel::High);
        // The option-list spelling executes too; only an explicit false does not.
        let options = c("EXPLAIN (ANALYZE) DELETE FROM orders");
        assert_eq!(options.kind, QueryKind::Write);
        assert!(options.no_where);
        for sql in [
            "EXPLAIN (ANALYZE true, BUFFERS) DELETE FROM orders WHERE id = 1",
            "EXPLAIN (FORMAT JSON, ANALYZE on) UPDATE orders SET paid = true WHERE id = 1",
        ] {
            assert_eq!(c(sql).kind, QueryKind::Write, "{sql}");
        }
        for sql in [
            "EXPLAIN (ANALYZE false) DELETE FROM orders",
            "EXPLAIN (COSTS off) DELETE FROM orders",
            "EXPLAIN (ANALYZE) SELECT * FROM orders",
        ] {
            assert_eq!(c(sql).kind, QueryKind::Read, "{sql}");
        }
    }

    #[test]
    fn select_into_is_not_read() {
        let r = c("SELECT * INTO backup FROM users");
        assert_ne!(r.kind, QueryKind::Read);
        assert_eq!(r.kind, QueryKind::Ddl);
    }

    #[test]
    fn select_for_update_is_write() {
        let r = c("SELECT id FROM users WHERE id = 1 FOR UPDATE");
        assert_eq!(r.kind, QueryKind::Write);
        assert_eq!(r.risk, RiskLevel::Medium);
    }

    #[test]
    fn garbage_fails_safe_to_privilege_block() {
        let r = c("this is not sql");
        assert_eq!(r.kind, QueryKind::Privilege);
        assert_eq!(r.risk, RiskLevel::High);
        // State-changing PRAGMA forms and unknown utility statements stay blocked.
        for (sql, engine) in [
            ("PRAGMA foreign_keys = OFF", Engine::Sqlite),
            ("PRAGMA user_version = 5", Engine::Sqlite),
            ("PRAGMA user_version(5)", Engine::Sqlite),
            ("PRAGMA wal_checkpoint", Engine::Sqlite),
            ("PRAGMA table_info(t); DELETE FROM t", Engine::Sqlite),
            ("SHOW PROCESSLIST", Engine::Mysql),
        ] {
            assert_eq!(
                analysis(sql, engine).classification.kind,
                QueryKind::Privilege,
                "{sql}"
            );
        }
    }

    #[test]
    fn mongodb_is_rejected_by_the_sql_classifier() {
        let r = classify(r#"{ "find": "users" }"#, Engine::Mongodb).unwrap();
        assert_eq!(r.kind, QueryKind::Privilege);
        assert_eq!(r.risk, RiskLevel::High);
        assert!(r.notes[0].contains("typed document-query API"));
    }

    #[test]
    fn startup_scripts_allow_only_literal_session_settings() {
        use crate::connection::providers::validate_startup_script;

        assert!(validate_startup_script(
            "SET application_name = 'DopeDB'; SET statement_timeout = 5000",
            Engine::Postgres,
        )
        .is_ok());
        assert!(validate_startup_script("SET NAMES utf8mb4", Engine::Mysql).is_ok());
        assert!(validate_startup_script("DELETE FROM users", Engine::Postgres).is_err());
        assert!(validate_startup_script("SET ROLE admin", Engine::Postgres).is_err());
        assert!(validate_startup_script(
            "SET application_name = dangerous_function()",
            Engine::Postgres,
        )
        .is_err());
    }
}
