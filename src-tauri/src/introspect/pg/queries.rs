//! Version-aware PostgreSQL object metadata statements.

const OBJECTS_SQL: &str = r#"
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
  AND p.prokind IN ('f', 'p', 'w')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid)
UNION ALL
SELECT n.nspname, c.relname, CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'materialized_view' END,
       NULL::text, NULL::text, c.oid::text, NULL::text, NULL::text, obj_description(c.oid, 'pg_class')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('S', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_class'::regclass AND dep.objid = c.oid)
UNION ALL
SELECT n.nspname, t.tgname, 'trigger', pg_get_triggerdef(t.oid, false), c.relname,
       t.oid::text, NULL::text, NULL::text, obj_description(t.oid, 'pg_trigger')
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_trigger'::regclass AND dep.objid = t.oid)
ORDER BY schema_name, object_kind, object_name, object_detail
"#;

const OBJECTS_PRE_11_SQL: &str = r#"
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
  AND NOT p.proisagg
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid)
UNION ALL
SELECT n.nspname, c.relname, CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'materialized_view' END,
       NULL::text, NULL::text, c.oid::text, NULL::text, NULL::text, obj_description(c.oid, 'pg_class')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('S', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_class'::regclass AND dep.objid = c.oid)
UNION ALL
SELECT n.nspname, t.tgname, 'trigger', pg_get_triggerdef(t.oid, false), c.relname,
       t.oid::text, NULL::text, NULL::text, obj_description(t.oid, 'pg_trigger')
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.deptype = 'e'
                 AND dep.classid = 'pg_trigger'::regclass AND dep.objid = t.oid)
ORDER BY schema_name, object_kind, object_name, object_detail
"#;

pub(super) fn objects_sql_for_version(server_version_num: u32) -> &'static str {
    if server_version_num >= 110_000 {
        OBJECTS_SQL
    } else {
        OBJECTS_PRE_11_SQL
    }
}
