//! PostgreSQL relation DDL for one relation, read by oid from the server catalog.
//!
//! The server renders every fragment (`format_type`, `pg_get_expr`,
//! `pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_viewdef`, partition keys and
//! bounds) under an empty `search_path`, so names are schema-qualified and quoted
//! exactly as PostgreSQL would. This module only arranges those fragments. The
//! result is a reconstruction for reading and review, not a pg_dump-exact dump:
//! ownership, grants, triggers, policies, sequence positions and per-partition column
//! overrides are not reproduced. A serial column's owned sequence is: it is created
//! before the table its default references and attached to the column afterwards.

use std::fmt::Write;
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use sqlx::{AssertSqlSafe, PgPool, Row};

use super::timeout::{catalog_stage_timeout, is_statement_timeout, statement_timeout_sql};
use crate::error::{AppError, AppResult};

/// One relation's catalog read is small; the bound only stops a pathological catalog
/// from turning a DDL view into an unbounded foreground operation.
const RELATION_DDL_TIMEOUT: Duration = Duration::from_secs(15);

/// A relation another session holds exclusively (an ALTER in progress) is reported as
/// busy quickly instead of waiting out the whole statement timeout.
const RELATION_DDL_LOCK_TIMEOUT: Duration = Duration::from_secs(3);

const DDL_HEADER: &str =
    "-- Reconstructed from the PostgreSQL catalog (not pg_dump-exact); review before running.";

/// Version-gated catalog fragments: declarative partitions and identity columns
/// arrived in PostgreSQL 10, constraint parents in 11, generated columns in 12.
fn relation_ddl_sql(server_version_num: u32) -> String {
    let partitions = server_version_num >= 100_000;
    let is_partition = if partitions {
        "c.relispartition"
    } else {
        "false"
    };
    let partition_bound = if partitions {
        "CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END"
    } else {
        "NULL::text"
    };
    let partition_key = if partitions {
        "CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END"
    } else {
        "NULL::text"
    };
    let identity_kind = if partitions {
        "a.attidentity::text"
    } else {
        "''::text"
    };
    let generated_kind = if server_version_num >= 120_000 {
        "a.attgenerated::text"
    } else {
        "''::text"
    };
    // A partition's copies of its parent's constraints (and the per-partition rows a
    // key referencing a partitioned table derives) come back with `PARTITION OF`.
    let declared_constraint = if server_version_num >= 110_000 {
        "AND con.conparentid = 0"
    } else {
        ""
    };
    // A serial column owns its sequence through an auto dependency; an identity
    // column's sequence is internal and recreated by the column itself. Sequence
    // options live in pg_sequence from PostgreSQL 10; older servers keep defaults.
    let (sequence_options, sequence_join) = if partitions {
        (
            "'dataType', format_type(seq.seqtypid, NULL),
                  'start', seq.seqstart::text,
                  'increment', seq.seqincrement::text,
                  'minimum', seq.seqmin::text,
                  'maximum', seq.seqmax::text,
                  'cache', seq.seqcache::text,
                  'cycle', seq.seqcycle,",
            "JOIN pg_sequence seq ON seq.seqrelid = s.oid",
        )
    } else {
        ("", "")
    };
    format!(
        r#"
WITH target AS (
  SELECT c.oid,
         c.relkind::text AS relation_kind,
         c.relpersistence::text AS persistence,
         {is_partition} AS is_partition,
         {partition_bound} AS partition_bound,
         {partition_key} AS partition_key,
         c.reloptions,
         format('%I.%I', n.nspname, c.relname) AS qualified_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = ($2::text)::name
    AND ($1::text IS NULL OR n.nspname = ($1::text)::name)
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND c.relpersistence <> 't'
  ORDER BY n.nspname
  LIMIT 1
)
SELECT t.qualified_name,
       t.relation_kind,
       t.persistence,
       t.is_partition,
       t.partition_bound,
       t.partition_key,
       CASE WHEN t.relation_kind IN ('v', 'm') THEN pg_get_viewdef(t.oid, true) END
         AS view_definition,
       (
         SELECT json_agg(format('%I.%I', pn.nspname, pc.relname) ORDER BY inh.inhseqno)
         FROM pg_inherits inh
         JOIN pg_class pc ON pc.oid = inh.inhparent
         JOIN pg_namespace pn ON pn.oid = pc.relnamespace
         WHERE inh.inhrelid = t.oid
       )::text AS parents_json,
       (
         SELECT json_agg(reloption.option ORDER BY reloption.position)
         FROM unnest(t.reloptions) WITH ORDINALITY AS reloption(option, position)
       )::text AS options_json,
       (
         SELECT format('SERVER %I', server.srvname)
                || COALESCE(' OPTIONS (' || (
                     SELECT string_agg(
                              format('%I %L', split_part(fdw.option, '=', 1),
                                     substr(fdw.option, strpos(fdw.option, '=') + 1)),
                              ', ' ORDER BY fdw.position)
                     FROM unnest(foreign_table.ftoptions)
                       WITH ORDINALITY AS fdw(option, position)
                   ) || ')', '')
         FROM pg_foreign_table foreign_table
         JOIN pg_foreign_server server ON server.oid = foreign_table.ftserver
         WHERE foreign_table.ftrelid = t.oid
       ) AS foreign_server,
       quote_literal(obj_description(t.oid, 'pg_class')) AS comment_literal,
       (
         SELECT json_agg(json_build_object(
                  'name', quote_ident(a.attname),
                  'dataType', format_type(a.atttypid, a.atttypmod),
                  'notNull', a.attnotnull,
                  'local', a.attislocal,
                  'default', CASE WHEN {generated_kind} = ''
                                  THEN pg_get_expr(def.adbin, def.adrelid) END,
                  'generated', CASE WHEN {generated_kind} <> ''
                                    THEN pg_get_expr(def.adbin, def.adrelid) END,
                  'generatedKind', {generated_kind},
                  'identityKind', {identity_kind},
                  'collation', CASE WHEN a.attcollation <> 0
                                     AND a.attcollation <> ty.typcollation
                                    THEN format('%I.%I', coll_ns.nspname, coll.collname)
                               END,
                  'comment', quote_literal(col_description(t.oid, a.attnum))
                ) ORDER BY a.attnum)
         FROM pg_attribute a
         JOIN pg_type ty ON ty.oid = a.atttypid
         LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
         LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
         LEFT JOIN pg_namespace coll_ns ON coll_ns.oid = coll.collnamespace
         WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
       )::text AS columns_json,
       (
         SELECT json_agg(json_build_object(
                  'name', quote_ident(con.conname),
                  'definition', pg_get_constraintdef(con.oid, true),
                  'validated', con.convalidated
                ) ORDER BY CASE con.contype
                             WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'x' THEN 2
                             WHEN 'f' THEN 3 ELSE 4
                           END,
                           con.conname)
         FROM pg_constraint con
         WHERE con.conrelid = t.oid
           AND con.contype IN ('p', 'u', 'x', 'f', 'c')
           AND con.conislocal
           {declared_constraint}
       )::text AS constraints_json,
       (
         SELECT json_agg(pg_get_indexdef(i.indexrelid) ORDER BY index_class.relname)
         FROM pg_index i
         JOIN pg_class index_class ON index_class.oid = i.indexrelid
         WHERE i.indrelid = t.oid
           AND NOT EXISTS (
             SELECT 1 FROM pg_constraint con
             WHERE con.conrelid = i.indrelid
               AND con.conindid = i.indexrelid
               AND con.contype IN ('p', 'u', 'x')
           )
           AND NOT EXISTS (
             SELECT 1 FROM pg_inherits parent_index
             WHERE parent_index.inhrelid = i.indexrelid
           )
       )::text AS indexes_json,
       (
         SELECT json_agg(json_build_object(
                  {sequence_options}
                  'name', format('%I.%I', sn.nspname, s.relname),
                  'column', quote_ident(a.attname)
                ) ORDER BY a.attnum)
         FROM pg_depend d
         JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
         JOIN pg_namespace sn ON sn.oid = s.relnamespace
         {sequence_join}
         JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
         WHERE d.classid = 'pg_class'::regclass
           AND d.refclassid = 'pg_class'::regclass
           AND d.refobjid = t.oid
           AND d.deptype = 'a'
           AND a.attislocal
           AND NOT a.attisdropped
       )::text AS sequences_json
FROM target t
"#
    )
}

/// A serial column's sequence, created before the table whose default calls it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnedSequence {
    name: String,
    column: String,
    data_type: Option<String>,
    start: Option<String>,
    increment: Option<String>,
    minimum: Option<String>,
    maximum: Option<String>,
    cache: Option<String>,
    #[serde(default)]
    cycle: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DdlColumn {
    name: String,
    data_type: String,
    not_null: bool,
    local: bool,
    default: Option<String>,
    generated: Option<String>,
    generated_kind: String,
    identity_kind: String,
    collation: Option<String>,
    comment: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DdlConstraint {
    name: String,
    definition: String,
    validated: bool,
}

/// Every fragment of one relation's DDL, already rendered by the server.
#[derive(Debug)]
struct RelationDdl {
    qualified_name: String,
    kind: String,
    persistence: String,
    is_partition: bool,
    partition_bound: Option<String>,
    partition_key: Option<String>,
    view_definition: Option<String>,
    parents: Vec<String>,
    options: Vec<String>,
    foreign_server: Option<String>,
    comment: Option<String>,
    columns: Vec<DdlColumn>,
    constraints: Vec<DdlConstraint>,
    indexes: Vec<String>,
    sequences: Vec<OwnedSequence>,
}

fn json_list<T: DeserializeOwned>(value: Option<String>) -> AppResult<Vec<T>> {
    match value {
        Some(json) => Ok(serde_json::from_str(&json)?),
        None => Ok(Vec::new()),
    }
}

/// Reconstruct one relation's DDL (tables, partitioned tables and partitions,
/// inheritance children, foreign tables, views and materialized views) by reading
/// only that relation. Two network round trips on a warm connection: BEGIN with the
/// timeouts and an empty search_path, then the relation query.
pub async fn table_ddl(pool: &PgPool, schema: Option<&str>, table: &str) -> AppResult<String> {
    let mut tx = pool
        .begin_with(AssertSqlSafe(format!(
            "BEGIN READ ONLY; {}; SET LOCAL lock_timeout = {}; SET LOCAL search_path = ''",
            statement_timeout_sql(RELATION_DDL_TIMEOUT),
            RELATION_DDL_LOCK_TIMEOUT.as_millis()
        )))
        .await?;
    let server_version_num = match tx.server_version_num() {
        Some(version) => version,
        None => sqlx::query_scalar::<_, String>("SHOW server_version_num")
            .fetch_one(&mut *tx)
            .await?
            .trim()
            .parse::<u32>()
            .map_err(|_| {
                AppError::Config("PostgreSQL returned an invalid server_version_num".into())
            })?,
    };
    let started = Instant::now();
    let row = match sqlx::query(AssertSqlSafe(relation_ddl_sql(server_version_num)))
        .bind(schema)
        .bind(table)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(row) => row,
        Err(error) if is_statement_timeout(&error) => {
            return Err(catalog_stage_timeout(
                "relation DDL",
                started.elapsed(),
                RELATION_DDL_TIMEOUT,
            ));
        }
        Err(error) => return Err(error.into()),
    };
    // A catalog read has nothing to commit; dropping the transaction queues its
    // ROLLBACK, which the pool flushes before the connection is reused.
    drop(tx);
    let row = row.ok_or_else(|| AppError::NotFound(format!("table {table}")))?;
    let relation = RelationDdl {
        qualified_name: row.try_get("qualified_name")?,
        kind: row.try_get("relation_kind")?,
        persistence: row.try_get("persistence")?,
        is_partition: row.try_get("is_partition")?,
        partition_bound: row.try_get("partition_bound")?,
        partition_key: row.try_get("partition_key")?,
        view_definition: row.try_get("view_definition")?,
        parents: json_list(row.try_get("parents_json")?)?,
        options: json_list(row.try_get("options_json")?)?,
        foreign_server: row.try_get("foreign_server")?,
        comment: row.try_get("comment_literal")?,
        columns: json_list(row.try_get("columns_json")?)?,
        constraints: json_list(row.try_get("constraints_json")?)?,
        indexes: json_list(row.try_get("indexes_json")?)?,
        sequences: json_list(row.try_get("sequences_json")?)?,
    };
    Ok(render_relation_ddl(&relation))
}

fn render_column(column: &DdlColumn) -> String {
    let mut line = format!("    {} {}", column.name, column.data_type);
    if let Some(collation) = &column.collation {
        let _ = write!(line, " COLLATE {collation}");
    }
    match column.identity_kind.as_str() {
        "a" => line.push_str(" GENERATED ALWAYS AS IDENTITY"),
        "d" => line.push_str(" GENERATED BY DEFAULT AS IDENTITY"),
        _ => {}
    }
    if let Some(expression) = &column.generated {
        let storage = if column.generated_kind == "v" {
            "VIRTUAL"
        } else {
            "STORED"
        };
        let _ = write!(line, " GENERATED ALWAYS AS ({expression}) {storage}");
    } else if let Some(default) = &column.default {
        let _ = write!(line, " DEFAULT {default}");
    }
    if column.not_null {
        line.push_str(" NOT NULL");
    }
    line
}

fn comment_target(kind: &str) -> &'static str {
    match kind {
        "v" => "VIEW",
        "m" => "MATERIALIZED VIEW",
        "f" => "FOREIGN TABLE",
        _ => "TABLE",
    }
}

fn render_view(out: &mut String, relation: &RelationDdl) {
    let materialized = relation.kind == "m";
    let _ = write!(
        out,
        "CREATE {}VIEW {}",
        if materialized { "MATERIALIZED " } else { "" },
        relation.qualified_name
    );
    if !relation.options.is_empty() {
        let _ = write!(out, " WITH ({})", relation.options.join(", "));
    }
    // pg_get_viewdef ends its query with a semicolon; the statement adds its own.
    let definition = relation
        .view_definition
        .as_deref()
        .unwrap_or_default()
        .trim_end()
        .trim_end_matches(';')
        .trim_end();
    let _ = write!(out, " AS\n{definition}");
    if materialized {
        out.push_str("\nWITH NO DATA");
    }
    out.push_str(";\n");
}

fn render_table(out: &mut String, relation: &RelationDdl) {
    let foreign = relation.kind == "f";
    let _ = write!(
        out,
        "CREATE {}{} {}",
        if relation.persistence == "u" {
            "UNLOGGED "
        } else {
            ""
        },
        if foreign { "FOREIGN TABLE" } else { "TABLE" },
        relation.qualified_name
    );
    // CREATE TABLE ignores NOT VALID, so such constraints are added afterwards.
    let constraints = relation
        .constraints
        .iter()
        .filter(|constraint| constraint.validated)
        .map(|constraint| {
            format!(
                "    CONSTRAINT {} {}",
                constraint.name, constraint.definition
            )
        });
    if relation.is_partition {
        // A partition takes every column from its parent; it declares only its own
        // constraints and its bound.
        let parent = relation.parents.first().map(String::as_str).unwrap_or("");
        let _ = write!(out, " PARTITION OF {parent}");
        let lines = constraints.collect::<Vec<_>>();
        if !lines.is_empty() {
            let _ = write!(out, " (\n{}\n)", lines.join(",\n"));
        }
        let _ = write!(
            out,
            "\n    {}",
            relation.partition_bound.as_deref().unwrap_or("DEFAULT")
        );
    } else {
        // Inherited columns come from INHERITS; only local ones are declared.
        let mut lines = relation
            .columns
            .iter()
            .filter(|column| column.local)
            .map(render_column)
            .collect::<Vec<_>>();
        lines.extend(constraints);
        if lines.is_empty() {
            out.push_str(" ()");
        } else {
            let _ = write!(out, " (\n{}\n)", lines.join(",\n"));
        }
        if !relation.parents.is_empty() {
            let _ = write!(out, "\nINHERITS ({})", relation.parents.join(", "));
        }
    }
    if let Some(partition_key) = &relation.partition_key {
        let _ = write!(out, "\nPARTITION BY {partition_key}");
    }
    if !relation.options.is_empty() {
        let _ = write!(out, "\nWITH ({})", relation.options.join(", "));
    }
    if let Some(server) = &relation.foreign_server {
        let _ = write!(out, "\n{server}");
    }
    out.push_str(";\n");
    for constraint in relation
        .constraints
        .iter()
        .filter(|constraint| !constraint.validated)
    {
        let _ = writeln!(
            out,
            "ALTER TABLE {} ADD CONSTRAINT {} {};",
            relation.qualified_name, constraint.name, constraint.definition
        );
    }
}

/// Options come from pg_sequence; a server without it (before 10) keeps defaults.
fn render_owned_sequence(out: &mut String, sequence: &OwnedSequence) {
    let _ = write!(out, "CREATE SEQUENCE {}", sequence.name);
    if let Some(data_type) = &sequence.data_type {
        let _ = write!(out, " AS {data_type}");
    }
    for (keyword, value) in [
        ("START WITH", &sequence.start),
        ("INCREMENT BY", &sequence.increment),
        ("MINVALUE", &sequence.minimum),
        ("MAXVALUE", &sequence.maximum),
        ("CACHE", &sequence.cache),
    ] {
        if let Some(value) = value {
            let _ = write!(out, " {keyword} {value}");
        }
    }
    if sequence.cycle {
        out.push_str(" CYCLE");
    }
    out.push_str(";\n");
}

fn render_relation_ddl(relation: &RelationDdl) -> String {
    let mut out = format!("{DDL_HEADER}\n");
    if matches!(relation.kind.as_str(), "v" | "m") {
        render_view(&mut out, relation);
    } else {
        // A serial default calls its sequence by regclass, so it must exist first.
        for sequence in &relation.sequences {
            render_owned_sequence(&mut out, sequence);
        }
        render_table(&mut out, relation);
        for sequence in &relation.sequences {
            let _ = writeln!(
                out,
                "ALTER SEQUENCE {} OWNED BY {}.{};",
                sequence.name, relation.qualified_name, sequence.column
            );
        }
    }
    for index in &relation.indexes {
        let _ = writeln!(out, "{index};");
    }
    if let Some(comment) = &relation.comment {
        let _ = writeln!(
            out,
            "COMMENT ON {} {} IS {comment};",
            comment_target(&relation.kind),
            relation.qualified_name
        );
    }
    for column in &relation.columns {
        if let Some(comment) = &column.comment {
            let _ = writeln!(
                out,
                "COMMENT ON COLUMN {}.{} IS {comment};",
                relation.qualified_name, column.name
            );
        }
    }
    out.truncate(out.trim_end().len());
    out
}
