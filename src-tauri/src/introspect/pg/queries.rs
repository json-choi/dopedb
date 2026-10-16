//! Version-aware PostgreSQL metadata statements.
//!
//! Every statement skips temporary relations and schemas: another session's
//! `pg_temp_N` objects are unreadable from this session and vanish with it.

/// Columns of persistent relations. PostgreSQL 10 added identity columns and 12
/// added generated columns. A generated column stores its expression in
/// `pg_attrdef`, so it is reported as `generation_expression`, never as a DEFAULT.
pub(super) fn columns_sql(server_version_num: u32) -> String {
    let identity = if server_version_num >= 100_000 {
        "a.attidentity <> ''"
    } else {
        "false"
    };
    let generated = if server_version_num >= 120_000 {
        "a.attgenerated <> ''"
    } else {
        "false"
    };
    format!(
        r#"
SELECT n.nspname AS table_schema,
       c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS formatted_type,
       NOT a.attnotnull AS is_nullable,
       a.attnum::integer AS ordinal_position,
       information_schema._pg_char_max_length(a.atttypid, a.atttypmod)
         AS character_maximum_length,
       information_schema._pg_numeric_precision(a.atttypid, a.atttypmod)
         AS numeric_precision,
       information_schema._pg_numeric_scale(a.atttypid, a.atttypmod)
         AS numeric_scale,
       CASE WHEN NOT ({generated}) THEN pg_get_expr(def.adbin, def.adrelid) END
         AS column_default,
       CASE WHEN {generated} THEN pg_get_expr(def.adbin, def.adrelid) END
         AS generation_expression,
       {identity} AS is_identity,
       coll.collname AS collation_name,
       col_description(c.oid, a.attnum) AS column_comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND c.relpersistence <> 't'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  -- Hide objects owned by an extension (e.g. pg_stat_statements) — they are noise in
  -- a table browser and some error on SELECT *.
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dep
    WHERE dep.deptype = 'e'
      AND dep.classid = 'pg_class'::regclass
      AND dep.objid = c.oid
  )
ORDER BY n.nspname, c.relname, a.attnum
"#
    )
}

/// Secondary index key parts (primary-key indexes are excluded — the primary key is
/// read from its constraint). Expression keys (indkey = 0) carry their expression
/// text. PostgreSQL 11 added covering indexes: positions past `indnkeyatts` are
/// INCLUDE columns, not keys.
pub(super) fn indexes_sql(server_version_num: u32) -> String {
    let included = if server_version_num >= 110_000 {
        "k.ord > i.indnkeyatts"
    } else {
        "false"
    };
    format!(
        r#"
SELECT n.nspname AS table_schema,
       t.relname AS table_name,
       ic.relname AS index_name,
       i.indisunique AS is_unique,
       am.amname AS index_method,
       a.attname AS column_name,
       CASE WHEN a.attname IS NULL
            THEN pg_get_indexdef(i.indexrelid, k.ord::integer, true)
            ELSE NULL
       END AS index_expression,
       CASE WHEN (i.indoption[(k.ord - 1)::integer] & 1) = 1
            THEN 'desc' ELSE 'asc'
       END AS sort_direction,
       {included} AS is_included,
       pg_get_expr(i.indpred, i.indrelid) AS predicate,
       i.indisvalid AS is_valid
FROM pg_index i
JOIN pg_class t      ON t.oid = i.indrelid
JOIN pg_class ic     ON ic.oid = i.indexrelid
JOIN pg_namespace n  ON n.oid = t.relnamespace
JOIN pg_am am         ON am.oid = ic.relam
JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND t.relpersistence <> 't'
  AND NOT i.indisprimary
ORDER BY n.nspname, t.relname, ic.relname, k.ord
"#
    )
}

/// Foreign-key edges resolved on pg_catalog so composite keys stay per-column-correct.
/// Zipping conkey/confkey WITH ORDINALITY pairs each local column with its referenced
/// column without cross-joining composite or same-named constraints. Since
/// PostgreSQL 11 a key that references a partitioned table also stores one derived
/// constraint per referenced partition on the same table; only the declared key is
/// metadata, so derived rows are skipped. A partition's own copy of its parent's key
/// lives on the partition and stays.
pub(super) fn foreign_keys_sql(server_version_num: u32) -> String {
    let declared = if server_version_num >= 110_000 {
        "AND NOT EXISTS (
    SELECT 1 FROM pg_constraint declared
    WHERE declared.oid = con.conparentid AND declared.conrelid = con.conrelid
  )"
    } else {
        ""
    };
    format!(
        r#"
SELECT cn.nspname   AS table_schema,
       cl.relname   AS table_name,
       con.conname  AS constraint_name,
       k.ord        AS ordinal_position,
       att.attname  AS column_name,
       fn.nspname   AS foreign_schema,
       fcl.relname  AS foreign_table,
       fatt.attname AS foreign_column,
       CASE con.confupdtype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS update_action,
       CASE con.confdeltype
         WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS delete_action,
       con.condeferrable AS is_deferrable,
       con.convalidated AS is_validated
FROM pg_constraint con
JOIN pg_class cl       ON cl.oid = con.conrelid
JOIN pg_namespace cn   ON cn.oid = cl.relnamespace
JOIN pg_class fcl      ON fcl.oid = con.confrelid
JOIN pg_namespace fn   ON fn.oid = fcl.relnamespace
JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(conkey, confkey, ord) ON true
JOIN pg_attribute att  ON att.attrelid = con.conrelid  AND att.attnum = k.conkey
JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = k.confkey
WHERE con.contype = 'f'
  AND cl.relpersistence <> 't'
  AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
  {declared}
ORDER BY cn.nspname, cl.relname, con.conname, k.ord
"#
    )
}

const ROUTINES_SQL: &str = r#"
SELECT n.nspname AS schema_name,
       p.proname AS object_name,
       CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS object_kind,
       pg_get_function_identity_arguments(p.oid) AS object_detail,
       NULL::text AS parent_name,
       p.oid::text AS native_id,
       pg_get_function_result(p.oid) AS return_type,
       l.lanname AS language,
       obj_description(p.oid, 'pg_proc') AS object_comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast_)?temp_'
  AND p.prokind IN ('f', 'p', 'w')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid)"#;

const ROUTINES_PRE_11_SQL: &str = r#"
SELECT n.nspname AS schema_name,
       p.proname AS object_name,
       'function' AS object_kind,
       pg_get_function_identity_arguments(p.oid) AS object_detail,
       NULL::text AS parent_name,
       p.oid::text AS native_id,
       pg_get_function_result(p.oid) AS return_type,
       l.lanname AS language,
       obj_description(p.oid, 'pg_proc') AS object_comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast_)?temp_'
  AND NOT p.proisagg
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid)"#;

// Materialized views are relations (with columns and indexes) and are read with
// them, so only sequences remain here. Enum, domain, standalone composite and range
// types are user-defined types a column can name; array types, a table's row type
// and the multirange PostgreSQL derives from each range are implementation details
// of other objects. The `detail` is the type's definition in SQL form.
const OTHER_OBJECTS_SQL: &str = r#"
UNION ALL
SELECT n.nspname, c.relname, 'sequence',
       NULL::text, NULL::text, c.oid::text, NULL::text, NULL::text, obj_description(c.oid, 'pg_class')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'S'
  AND c.relpersistence <> 't'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_class'::regclass AND dep.objid = c.oid)
UNION ALL
SELECT n.nspname, t.tgname, 'trigger', pg_get_triggerdef(t.oid, false), c.relname,
       t.oid::text, NULL::text, NULL::text, obj_description(t.oid, 'pg_trigger')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND c.relpersistence <> 't'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_trigger'::regclass AND dep.objid = t.oid)
UNION ALL
SELECT n.nspname, ty.typname, 'type',
       CASE ty.typtype
         WHEN 'e' THEN 'ENUM (' || COALESCE(
           (SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
            FROM pg_enum e WHERE e.enumtypid = ty.oid), '') || ')'
         WHEN 'c' THEN 'COMPOSITE (' || COALESCE(
           (SELECT string_agg(quote_ident(a.attname) || ' '
                              || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
            FROM pg_attribute a
            WHERE a.attrelid = ty.typrelid AND a.attnum > 0 AND NOT a.attisdropped), '') || ')'
         WHEN 'r' THEN 'RANGE (SUBTYPE = ' || COALESCE(
           (SELECT format_type(r.rngsubtype, NULL) FROM pg_range r WHERE r.rngtypid = ty.oid),
           '') || ')'
         ELSE concat_ws(' ',
           'DOMAIN ' || format_type(ty.typbasetype, ty.typtypmod),
           CASE WHEN ty.typnotnull THEN 'NOT NULL' END,
           'DEFAULT ' || ty.typdefault,
           (SELECT string_agg(pg_get_constraintdef(con.oid, true), ' ' ORDER BY con.conname)
            FROM pg_constraint con WHERE con.contypid = ty.oid AND con.contype = 'c'))
       END,
       NULL::text, ty.oid::text, NULL::text, NULL::text, obj_description(ty.oid, 'pg_type')
FROM pg_type ty
JOIN pg_namespace n ON n.oid = ty.typnamespace
WHERE (ty.typtype IN ('e', 'd', 'r')
       OR (ty.typtype = 'c' AND EXISTS (
             SELECT 1 FROM pg_class rc WHERE rc.oid = ty.typrelid AND rc.relkind = 'c')))
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname !~ '^pg_(toast_)?temp_'
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_type'::regclass AND dep.objid = ty.oid)
ORDER BY schema_name, object_kind, object_name, object_detail
"#;

/// Routines, sequences, triggers and user-defined enum, domain, composite and range
/// types. PostgreSQL 11
/// replaced `proisagg` with `prokind` and added procedures.
pub(super) fn objects_sql(server_version_num: u32) -> String {
    let routines = if server_version_num >= 110_000 {
        ROUTINES_SQL
    } else {
        ROUTINES_PRE_11_SQL
    };
    format!("{routines}{OTHER_OBJECTS_SQL}")
}
