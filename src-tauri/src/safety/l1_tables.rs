//! L1 table collection for the approval card (best-effort; UX only).
//!
//! It walks the stable `TableFactor::Table` / `Derived` / CTE nodes only and
//! skips INSERT target tables and nested-join relations (deep, version-fragile
//! AST shapes). The list feeds the approval card, never a safety decision, so
//! L2 stays authoritative regardless of what is missed here.

use sqlparser::ast::{FromTable, Query, SetExpr, Statement, TableFactor, TableWithJoins};

pub(super) fn collect_tables(stmt: &Statement, out: &mut Vec<String>) {
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
        Statement::Explain { statement, .. } => collect_tables(statement, out),
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
        SetExpr::Insert(stmt)
        | SetExpr::Update(stmt)
        | SetExpr::Delete(stmt)
        | SetExpr::Merge(stmt) => collect_tables(stmt, out),
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

pub(super) fn dedup(v: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    v.retain(|t| seen.insert(t.clone()));
}
