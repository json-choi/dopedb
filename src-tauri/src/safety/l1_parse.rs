//! L1 — parse & classify. A **UX pre-filter only** (L2 is authoritative).
//!
//! Contract with the rest of the engine:
//! - `> 1` top-level statement → High risk, kind `Write` (stacked-injection guard).
//! - `Query` bodies are recursed for DML CTEs; any `INSERT`/`UPDATE` inside a CTE
//!   reclassifies the whole statement to `Write`.
//! - `UPDATE`/`DELETE` with `selection.is_none()` → `no_where` + High risk.
//! - **Any parse error or ambiguity → `Privilege` / High risk (fail safe), never
//!   an `Err`** — once DML and DDL have separate authority, an unknown statement
//!   must not inherit the narrower data-change credential. The privilege gate
//!   hard-stops it.

use sqlparser::ast::{
    FromTable, ObjectType, Query, SetExpr, Statement, TableFactor, TableWithJoins,
};
use sqlparser::dialect::{
    BigQueryDialect, Dialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;

use crate::error::AppResult;
use crate::model::{Classification, Engine, QueryKind, RiskLevel};

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
}

/// Internal classification result that pairs the stable wire payload with its
/// non-serializable parser-integrity signal.
#[derive(Debug, Clone)]
pub struct ClassificationAnalysis {
    pub classification: Classification,
    pub integrity: ClassificationIntegrity,
}

impl ClassificationAnalysis {
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
    let statements = match Parser::parse_sql(&*dialect, sql) {
        Ok(s) => s,
        Err(e) => {
            return Ok(fail_safe(
                format!("parse error — blocked as privileged (fail-safe): {e}"),
                ClassificationIntegrity::ParseFailed,
            ))
        }
    };

    if statements.is_empty() {
        return Ok(fail_safe(
            "no parseable statement — treated as a write (fail-safe)",
            ClassificationIntegrity::ParseFailed,
        ));
    }

    if statements.len() > 1 {
        let mut tables = Vec::new();
        for s in &statements {
            collect_tables(s, &mut tables);
        }
        dedup(&mut tables);
        return Ok(ClassificationAnalysis {
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
        });
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

    Ok(ClassificationAnalysis {
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
    })
}

/// Stable public classification wire payload for callers that do not acquire a
/// target capability. Capability-owning flows use [`classify_with_integrity`].
pub fn classify(sql: &str, engine: Engine) -> AppResult<Classification> {
    Ok(classify_with_integrity(sql, engine)?.classification)
}

/// Recursive statement classification. Recurses for `EXPLAIN ANALYZE`, which
/// actually EXECUTES its inner statement, so it must inherit that statement's kind.
fn classify_stmt(
    stmt: &Statement,
    notes: &mut Vec<String>,
    no_where: &mut bool,
) -> (QueryKind, ClassificationIntegrity) {
    match stmt {
        Statement::Query(q) => {
            if query_has_dml(q) {
                notes.push("write DML inside a CTE — reclassified as a write".into());
                (QueryKind::Write, ClassificationIntegrity::ExactSingle)
            } else if query_selects_into(q) {
                // SELECT ... INTO <table> creates and populates a table — not a read.
                notes.push("SELECT ... INTO creates a table — reclassified as DDL".into());
                (QueryKind::Ddl, ClassificationIntegrity::ExactSingle)
            } else if !q.locks.is_empty() {
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
        Statement::Explain {
            analyze, statement, ..
        } => {
            if *analyze {
                notes.push(
                    "EXPLAIN ANALYZE executes the statement — classified by its inner statement"
                        .into(),
                );
                classify_stmt(statement, notes, no_where)
            } else {
                (QueryKind::Read, ClassificationIntegrity::ExactSingle)
            }
        }

        Statement::Insert(_) => (QueryKind::Write, ClassificationIntegrity::ExactSingle),
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

// ---- DML-in-CTE detection -------------------------------------------------

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
        // sqlparser wraps writable-CTE bodies as these variants.
        SetExpr::Insert(_) | SetExpr::Update(_) => true,
        SetExpr::Query(q) => query_has_dml(q),
        SetExpr::SetOperation { left, right, .. } => {
            setexpr_has_dml(left) || setexpr_has_dml(right)
        }
        _ => false,
    }
}

// ---- Table collection (best-effort; UX only) ------------------------------
//
// ponytail: walks the stable `TableFactor::Table` / `Derived` / CTE nodes only.
// Skips INSERT target tables and nested-join relations (deep, version-fragile
// AST shapes) — this list feeds the approval card, not any safety decision, so
// L2 stays authoritative regardless of what we miss here.

fn collect_tables(stmt: &Statement, out: &mut Vec<String>) {
    match stmt {
        Statement::Query(q) => walk_query(q, out),
        // Only the update target table; the optional `FROM` join sources are a
        // version-fragile AST shape and are UX-only, so we skip them.
        Statement::Update(update) => walk_twj(&update.table, out),
        Statement::Delete(del) => match &del.from {
            FromTable::WithFromKeyword(v) | FromTable::WithoutKeyword(v) => {
                for twj in v {
                    walk_twj(twj, out);
                }
            }
        },
        Statement::Insert(ins) => {
            if let Some(src) = &ins.source {
                walk_query(src, out);
            }
        }
        _ => {}
    }
}

fn walk_query(q: &Query, out: &mut Vec<String>) {
    if let Some(with) = &q.with {
        for cte in &with.cte_tables {
            walk_query(&cte.query, out);
        }
    }
    walk_setexpr(&q.body, out);
}

fn walk_setexpr(se: &SetExpr, out: &mut Vec<String>) {
    match se {
        SetExpr::Select(sel) => {
            for twj in &sel.from {
                walk_twj(twj, out);
            }
        }
        SetExpr::Query(q) => walk_query(q, out),
        SetExpr::SetOperation { left, right, .. } => {
            walk_setexpr(left, out);
            walk_setexpr(right, out);
        }
        SetExpr::Insert(stmt) | SetExpr::Update(stmt) => collect_tables(stmt, out),
        _ => {}
    }
}

fn walk_twj(twj: &TableWithJoins, out: &mut Vec<String>) {
    walk_tf(&twj.relation, out);
    for join in &twj.joins {
        walk_tf(&join.relation, out);
    }
}

fn walk_tf(tf: &TableFactor, out: &mut Vec<String>) {
    match tf {
        TableFactor::Table { name, .. } => out.push(name.to_string()),
        TableFactor::Derived { subquery, .. } => walk_query(subquery, out),
        _ => {}
    }
}

fn dedup(v: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    v.retain(|t| seen.insert(t.clone()));
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
