//! Per-physical-connection schema authority verification. The server pins the owner;
//! SET ROLE preserves existing object ownership and default ACLs without rewriting them.
use sqlx::{AssertSqlSafe, Executor, Row};

pub(super) const POLICY: &str = r#"SELECT session_user::text ~ '^dopedb-s-[0-9a-f]{14}@[a-z][a-z0-9-]{4,28}[a-z0-9][.]iam$' AS exact_schema_login,
 (($1::text = '' AND current_user = session_user) OR current_user::text = $1) AS exact_schema_owner,
 login.rolcanlogin AND NOT login.rolsuper AND NOT login.rolcreaterole AND NOT login.rolcreatedb AND NOT login.rolreplication AND NOT login.rolbypassrls AND NOT lease.rolsuper AND NOT lease.rolcreaterole AND NOT lease.rolcreatedb AND NOT lease.rolreplication AND NOT lease.rolbypassrls AS safe_login_role,
 NOT system_role.rolcanlogin AND NOT system_role.rolsuper AND NOT system_role.rolcreaterole AND NOT system_role.rolcreatedb AND NOT system_role.rolreplication AND NOT system_role.rolbypassrls AS safe_system_role,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles admin WHERE admin.rolname IN ('postgres',
 'cloudsqlsuperuser',
 'cloudsqladmin') AND pg_has_role(session_user,
 admin.oid,
 'MEMBER')) AS no_admin_role,
 EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member = login.oid AND m.roleid = system_role.oid AND NOT m.admin_option)
 AND (login.oid = lease.oid OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member = login.oid AND m.roleid = lease.oid AND NOT m.admin_option))
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member = login.oid AND (m.roleid NOT IN (lease.oid,
 system_role.oid) OR m.admin_option))
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid = login.oid)
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
 WHERE m.member = lease.oid AND (m.roleid <> system_role.oid OR m.admin_option))
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = system_role.oid)
 AS exact_membership,
 NOT has_database_privilege(session_user,
 current_database(),
 'CREATE') AND NOT has_database_privilege( system_role.oid,
 current_database(),
 'CREATE') AS no_database_create,
 NOT has_database_privilege(session_user,
 current_database(),
 'TEMPORARY') AND NOT has_database_privilege( system_role.oid,
 current_database(),
 'TEMPORARY') AS no_temporary,
 has_database_privilege(session_user,
 current_database(),
 'CONNECT') AND NOT has_database_privilege( session_user,
 current_database(),
 'CONNECT WITH GRANT OPTION') AND NOT has_database_privilege( system_role.oid,
 current_database(),
 'CONNECT WITH GRANT OPTION') AS no_connect_grant,
 has_schema_privilege(session_user,
 'public',
 'USAGE') AND has_schema_privilege(session_user,
 'public',
 'CREATE') AND NOT has_schema_privilege( session_user,
 'public',
 'USAGE WITH GRANT OPTION') AND NOT has_schema_privilege( session_user,
 'public',
 'CREATE WITH GRANT OPTION') AND NOT has_schema_privilege(system_role.oid,
 'public',
 'CREATE') AND NOT has_schema_privilege( system_role.oid,
 'public',
 'USAGE WITH GRANT OPTION') AND NOT has_schema_privilege( system_role.oid,
 'public',
 'CREATE WITH GRANT OPTION') AS exact_public_schema,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema WHERE schema.nspname <> 'public' AND schema.nspname <> 'information_schema' AND schema.nspname !~ '^pg_' AND (has_schema_privilege(session_user,
 schema.oid,
 'USAGE') OR has_schema_privilege(session_user,
 schema.oid,
 'CREATE') OR has_schema_privilege(system_role.oid,
 schema.oid,
 'USAGE') OR has_schema_privilege(system_role.oid,
 schema.oid,
 'CREATE'))) AS no_other_schema,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace WHERE schema.nspname = 'public' AND object.relkind IN ('r',
 'p',
 'v',
 'm',
 'f',
 'S',
 'c') AND object.relowner <> lease.oid AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency WHERE dependency.classid = 'pg_class'::regclass AND dependency.objid = object.oid AND dependency.deptype = 'e')) AS exact_relation_owners,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace schema ON schema.oid = routine.pronamespace WHERE schema.nspname = 'public' AND routine.proowner <> lease.oid AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency WHERE dependency.classid = 'pg_proc'::regclass AND dependency.objid = routine.oid AND dependency.deptype = 'e')) AS exact_routine_owners,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type type JOIN pg_catalog.pg_namespace schema ON schema.oid = type.typnamespace WHERE schema.nspname = 'public' AND type.typrelid = 0 AND type.typelem = 0 AND type.typtype IN ('b','c','d','e','m','r') AND type.typowner <> lease.oid AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency WHERE dependency.classid = 'pg_type'::regclass AND dependency.objid = type.oid AND dependency.deptype = 'e')) AS exact_type_owners,
 NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace schema ON schema.oid = routine.pronamespace CROSS JOIN LATERAL aclexplode( COALESCE(routine.proacl,
 acldefault('f',
 routine.proowner))) acl WHERE schema.nspname = 'public' AND routine.proowner = lease.oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS no_public_managed_routine,
 NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE( (SELECT defaults.defaclacl FROM pg_catalog.pg_default_acl defaults WHERE defaults.defaclrole = lease.oid AND defaults.defaclnamespace = 0 AND defaults.defaclobjtype = 'f'),
 acldefault('f',
 lease.oid))) acl WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl defaults JOIN pg_catalog.pg_namespace schema ON schema.oid = defaults.defaclnamespace CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl WHERE defaults.defaclrole = lease.oid AND schema.nspname = 'public' AND defaults.defaclobjtype = 'f' AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS no_public_function_default,
 current_setting('statement_timeout') = '5min' AS bounded_statement,
 current_setting('idle_in_transaction_session_timeout') = '1min' AS bounded_transaction_idle,
 (current_setting('server_version_num')::int < 140000 OR current_setting('idle_session_timeout',
 true) = '5min') AS bounded_session_idle,
 current_setting('search_path') = 'public' AS exact_search_path,
 current_setting('default_transaction_read_only') = 'off' AS writable_default FROM pg_catalog.pg_roles lease JOIN pg_catalog.pg_roles system_role ON system_role.rolname = 'cloudsqliamserviceaccount' JOIN pg_catalog.pg_roles login ON login.rolname = session_user WHERE lease.rolname = current_user"#;

pub(super) async fn prepare(conn: &mut sqlx::PgConnection, owner: &str) -> Result<(), sqlx::Error> {
    if !owner.is_empty() {
        if owner.len() > 63
            || !owner
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.@-".contains(&c))
        {
            return Err(sqlx::Error::Protocol("Invalid managed schema owner".into()));
        }
        sqlx::raw_sql(AssertSqlSafe(format!("SET ROLE \"{owner}\"")))
            .execute(&mut *conn)
            .await?;
    }
    conn.execute("SET statement_timeout = '5min'; SET idle_in_transaction_session_timeout = '1min'; SET idle_session_timeout = '5min'; SET search_path = public; SET default_transaction_read_only = off").await?;
    let row = sqlx::query(POLICY)
        .bind(owner)
        .fetch_one(&mut *conn)
        .await?;
    for field in [
        "exact_schema_login",
        "exact_schema_owner",
        "safe_login_role",
        "safe_system_role",
        "no_admin_role",
        "exact_membership",
        "no_database_create",
        "no_temporary",
        "no_connect_grant",
        "exact_public_schema",
        "no_other_schema",
        "exact_relation_owners",
        "exact_routine_owners",
        "exact_type_owners",
        "no_public_managed_routine",
        "no_public_function_default",
        "bounded_statement",
        "bounded_transaction_idle",
        "bounded_session_idle",
        "exact_search_path",
        "writable_default",
    ] {
        if !row.try_get::<bool, _>(field)? {
            return Err(sqlx::Error::Protocol(format!(
                "GCP schema authority check failed: {field}. Existing database permissions were preserved; ask the database administrator to review the selected migration owner."
            )));
        }
    }
    Ok(())
}
