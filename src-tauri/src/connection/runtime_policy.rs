//! Provider-managed database policy verification.

use super::*;
use crate::connection::DbPool;

pub(super) async fn verify_neon_policy(
    live: &Live,
    engine: Engine,
    access: ConnectionAccess,
) -> AppResult<()> {
    if engine != Engine::Postgres {
        return Err(AppError::Blocked {
            reason: "Neon policy opened the wrong engine".into(),
        });
    }
    let sql = live.sql()?;
    let DbPool::Postgres(pool) = &sql.read_pool else {
        return Err(AppError::Blocked {
            reason: "Neon policy opened the wrong engine".into(),
        });
    };
    if access == ConnectionAccess::Schema {
        let row = sqlx::query(
            "SELECT \
               session_user::text ~ '^dopedb_[a-z0-9]{1,8}_[a-z0-9]{1,32}$' AS owned_name, \
               current_user::text ~ '^dopedb_policy_[0-9a-f]{16}$' \
                 AND current_user <> session_user AS exact_policy_owner, \
               lease.rolcanlogin AND NOT lease.rolsuper AND NOT lease.rolcreaterole \
                 AND NOT lease.rolcreatedb AND NOT lease.rolreplication \
                 AND NOT lease.rolbypassrls AND lease.rolconnlimit = 4 \
                 AND lease.rolvaliduntil > now() \
                 AND lease.rolvaliduntil <= now() + interval '10 minutes' AS bounded_role, \
               ((SELECT count(*) = 1 FROM pg_catalog.pg_auth_members membership \
                 JOIN pg_catalog.pg_roles policy ON policy.oid = membership.roleid \
                 WHERE membership.member = lease.oid \
                   AND policy.rolname ~ '^dopedb_policy_[0-9a-f]{16}$' \
                   AND NOT policy.rolcanlogin AND NOT policy.rolsuper \
                   AND NOT policy.rolcreaterole AND NOT policy.rolcreatedb \
                   AND NOT policy.rolreplication AND NOT policy.rolbypassrls \
                   AND membership.admin_option = FALSE \
                   AND membership.inherit_option = FALSE \
                   AND membership.set_option = TRUE) \
                 AND (SELECT count(*) = 1 FROM pg_catalog.pg_auth_members all_memberships \
                   WHERE all_memberships.member = lease.oid)) AS exact_policy_membership, \
               ((SELECT count(DISTINCT membership.member) = 1 \
                   AND COALESCE(bool_or(membership.admin_option), FALSE) \
                   AND COALESCE(bool_or(membership.inherit_option), FALSE) \
                   AND COALESCE(bool_or(membership.set_option), FALSE) \
                 FROM pg_catalog.pg_auth_members membership \
                 JOIN pg_catalog.pg_roles cleanup_owner ON cleanup_owner.oid = membership.member \
                 JOIN pg_catalog.pg_database database ON database.datdba = cleanup_owner.oid \
                 WHERE membership.roleid = lease.oid \
                   AND database.datname = current_database()) \
                 AND (SELECT count(DISTINCT all_members.member) = 1 \
                   FROM pg_catalog.pg_auth_members all_members \
                   WHERE all_members.roleid = lease.oid)) AS exact_cleanup_member, \
               NOT has_database_privilege(current_user, current_database(), 'CREATE') \
                 AS no_database_create, \
               NOT has_database_privilege(current_user, current_database(), 'TEMPORARY') \
                 AS no_temporary, \
               NOT has_database_privilege( \
                 current_user, current_database(), 'CONNECT WITH GRANT OPTION') \
                 AS no_connect_grant, \
               EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema \
                 WHERE schema.nspname <> 'information_schema' \
                   AND schema.nspname !~ '^pg_' \
                   AND has_schema_privilege(current_user, schema.oid, 'CREATE')) \
                 AS has_schema_create, \
               NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema \
                 WHERE schema.nspname <> 'information_schema' \
                   AND schema.nspname !~ '^pg_' \
                   AND (has_schema_privilege(current_user, schema.oid, 'USAGE') \
                     OR has_schema_privilege(current_user, schema.oid, 'CREATE')) \
                   AND (NOT has_schema_privilege(current_user, schema.oid, 'USAGE') \
                     OR NOT has_schema_privilege(current_user, schema.oid, 'CREATE') \
                     OR pg_get_userbyid(schema.nspowner) !~ '^dopedb_policy_[0-9a-f]{16}$')) \
                 AS exact_schema_scope, \
               current_setting('statement_timeout') = '5min' AS bounded_statement, \
               current_setting('idle_in_transaction_session_timeout') = '1min' \
                 AS bounded_transaction_idle, \
               current_setting('idle_session_timeout') = '5min' AS bounded_session_idle \
             FROM pg_catalog.pg_roles lease WHERE lease.rolname = session_user",
        )
        .fetch_one(pool)
        .await?;
        let safe = [
            row.try_get::<bool, _>("owned_name")?,
            row.try_get::<bool, _>("exact_policy_owner")?,
            row.try_get::<bool, _>("bounded_role")?,
            row.try_get::<bool, _>("exact_policy_membership")?,
            row.try_get::<bool, _>("exact_cleanup_member")?,
            row.try_get::<bool, _>("no_database_create")?,
            row.try_get::<bool, _>("no_temporary")?,
            row.try_get::<bool, _>("no_connect_grant")?,
            row.try_get::<bool, _>("has_schema_create")?,
            row.try_get::<bool, _>("exact_schema_scope")?,
            row.try_get::<bool, _>("bounded_statement")?,
            row.try_get::<bool, _>("bounded_transaction_idle")?,
            row.try_get::<bool, _>("bounded_session_idle")?,
        ]
        .into_iter()
        .all(|value| value);
        if !safe {
            return Err(AppError::Blocked {
                reason: "Neon schema credential exceeded its approved database policy".into(),
            });
        }
        return Ok(());
    }
    let role = sqlx::query(
        "SELECT \
           current_user::text ~ '^dopedb_[a-z0-9]{1,8}_[a-z0-9]{1,32}$' AS owned_name, \
           role.rolcanlogin, role.rolsuper, role.rolcreaterole, role.rolcreatedb, \
           role.rolreplication, role.rolbypassrls, \
           role.rolconnlimit = 4 AS bounded_connections, \
           role.rolvaliduntil > now() \
             AND role.rolvaliduntil <= now() + interval '20 minutes' AS bounded_expiry, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership \
             WHERE membership.member = role.oid) AS no_memberships, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership \
             WHERE membership.roleid = role.oid) AS no_members, \
           NOT has_database_privilege(current_user, current_database(), 'CREATE') \
             AS no_database_create, \
           NOT has_database_privilege( \
             current_user, current_database(), 'CONNECT WITH GRANT OPTION') \
             AS no_connect_grant, \
           NOT has_database_privilege(current_user, current_database(), 'TEMPORARY') \
             AS no_temporary, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'CREATE')) \
             AS no_schema_create, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege( \
                 current_user, schema.oid, 'USAGE WITH GRANT OPTION')) \
             AS no_schema_grant, \
           current_setting('statement_timeout') = '5min' AS bounded_statement, \
           current_setting('idle_in_transaction_session_timeout') = '1min' \
             AS bounded_transaction_idle, \
           current_setting('idle_session_timeout') = '5min' AS bounded_session_idle, \
           current_setting('default_transaction_read_only') = $1 AS read_only_default \
         FROM pg_catalog.pg_roles role WHERE role.rolname = current_user",
    )
    .bind(if access == ConnectionAccess::Read {
        "on"
    } else {
        "off"
    })
    .fetch_one(pool)
    .await?;
    let safe_role = [
        role.try_get::<bool, _>("owned_name")?,
        role.try_get::<bool, _>("rolcanlogin")?,
        !role.try_get::<bool, _>("rolsuper")?,
        !role.try_get::<bool, _>("rolcreaterole")?,
        !role.try_get::<bool, _>("rolcreatedb")?,
        !role.try_get::<bool, _>("rolreplication")?,
        !role.try_get::<bool, _>("rolbypassrls")?,
        role.try_get::<bool, _>("bounded_connections")?,
        role.try_get::<bool, _>("bounded_expiry")?,
        role.try_get::<bool, _>("no_memberships")?,
        role.try_get::<bool, _>("no_members")?,
        role.try_get::<bool, _>("no_database_create")?,
        role.try_get::<bool, _>("no_connect_grant")?,
        role.try_get::<bool, _>("no_temporary")?,
        role.try_get::<bool, _>("no_schema_create")?,
        role.try_get::<bool, _>("no_schema_grant")?,
        role.try_get::<bool, _>("bounded_statement")?,
        role.try_get::<bool, _>("bounded_transaction_idle")?,
        role.try_get::<bool, _>("bounded_session_idle")?,
        role.try_get::<bool, _>("read_only_default")?,
    ]
    .into_iter()
    .all(|value| value);

    let write = access == ConnectionAccess::Write;
    let privileges = sqlx::query(
        "SELECT \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
             JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'USAGE') \
               AND object.relkind IN ('r', 'p', 'v', 'm', 'f') \
               AND NOT has_table_privilege(current_user, object.oid, 'SELECT')) AS all_read, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
             JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'USAGE') \
               AND object.relkind IN ('r', 'p', 'v', 'm', 'f') \
               AND CASE WHEN $1 THEN \
                 NOT has_table_privilege(current_user, object.oid, 'INSERT') \
                 OR NOT has_table_privilege(current_user, object.oid, 'UPDATE') \
                 OR NOT has_table_privilege(current_user, object.oid, 'DELETE') \
               ELSE \
                 has_table_privilege(current_user, object.oid, 'INSERT') \
                 OR has_table_privilege(current_user, object.oid, 'UPDATE') \
                 OR has_table_privilege(current_user, object.oid, 'DELETE') \
               END) AS exact_table_mode, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
             JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'USAGE') \
               AND object.relkind = 'S' \
               AND (NOT has_sequence_privilege(current_user, object.oid, 'SELECT') \
                 OR CASE WHEN $1 THEN \
                   NOT has_sequence_privilege(current_user, object.oid, 'USAGE') \
                   OR NOT has_sequence_privilege(current_user, object.oid, 'UPDATE') \
                 ELSE \
                   has_sequence_privilege(current_user, object.oid, 'USAGE') \
                   OR has_sequence_privilege(current_user, object.oid, 'UPDATE') \
                 END)) AS exact_sequence_mode, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
             JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'USAGE') \
               AND object.relkind IN ('r', 'p', 'v', 'm', 'f') \
               AND (has_table_privilege(current_user, object.oid, 'TRUNCATE') \
                 OR has_table_privilege(current_user, object.oid, 'REFERENCES') \
                 OR has_table_privilege(current_user, object.oid, 'TRIGGER') \
                 OR has_table_privilege(current_user, object.oid, 'SELECT WITH GRANT OPTION') \
                 OR has_table_privilege(current_user, object.oid, 'INSERT WITH GRANT OPTION') \
                 OR has_table_privilege(current_user, object.oid, 'UPDATE WITH GRANT OPTION') \
                 OR has_table_privilege(current_user, object.oid, 'DELETE WITH GRANT OPTION'))) \
             AS no_table_escalation, \
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
             JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
             WHERE schema.nspname <> 'information_schema' \
               AND schema.nspname !~ '^pg_' \
               AND has_schema_privilege(current_user, schema.oid, 'USAGE') \
               AND object.relkind = 'S' \
               AND (has_sequence_privilege(current_user, object.oid, 'SELECT WITH GRANT OPTION') \
                 OR has_sequence_privilege(current_user, object.oid, 'USAGE WITH GRANT OPTION') \
                 OR has_sequence_privilege(current_user, object.oid, 'UPDATE WITH GRANT OPTION'))) \
             AS no_sequence_escalation",
    )
    .bind(write)
    .fetch_one(pool)
    .await?;
    let safe_privileges = [
        privileges.try_get::<bool, _>("all_read")?,
        privileges.try_get::<bool, _>("exact_table_mode")?,
        privileges.try_get::<bool, _>("exact_sequence_mode")?,
        privileges.try_get::<bool, _>("no_table_escalation")?,
        privileges.try_get::<bool, _>("no_sequence_escalation")?,
    ]
    .into_iter()
    .all(|value| value);
    if !safe_role || !safe_privileges {
        return Err(AppError::Blocked {
            reason: "Neon credential exceeded its approved database policy".into(),
        });
    }
    Ok(())
}

pub(super) async fn verify_planetscale_policy(
    live: &Live,
    engine: Engine,
    access: ConnectionAccess,
) -> AppResult<()> {
    if access == ConnectionAccess::Schema {
        return Err(AppError::Blocked {
            reason: "PlanetScale managed schema access is not supported".into(),
        });
    }
    if engine != Engine::Postgres {
        // Vitess enforces the provider-created `reader`/`readwriter` password
        // role. A live SELECT plus the server-side exact role request is the
        // non-mutating proof; unlike PostgreSQL it exposes no stable catalog
        // membership contract that can be checked without touching user data.
        return Ok(());
    }
    let sql = live.sql()?;
    let DbPool::Postgres(pool) = &sql.read_pool else {
        return Err(AppError::Blocked {
            reason: "PlanetScale PostgreSQL policy opened the wrong engine".into(),
        });
    };
    let row = sqlx::query(
        "SELECT \
           pg_has_role(current_user, 'pg_read_all_data', 'member') AS can_read, \
           pg_has_role(current_user, 'pg_write_all_data', 'member') AS can_write, \
           EXISTS ( \
             SELECT 1 FROM pg_catalog.pg_roles admin \
             WHERE admin.rolname = 'postgres' \
               AND pg_has_role(current_user, admin.oid, 'member') \
           ) AS is_admin, \
           role.rolsuper, role.rolcreaterole, role.rolcreatedb, \
           role.rolreplication, role.rolbypassrls, \
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create \
         FROM pg_catalog.pg_roles role WHERE role.rolname = current_user",
    )
    .fetch_one(pool)
    .await?;
    let can_read: bool = row.try_get("can_read")?;
    let can_write: bool = row.try_get("can_write")?;
    let is_admin: bool = row.try_get("is_admin")?;
    let elevated = [
        row.try_get::<bool, _>("rolsuper")?,
        row.try_get::<bool, _>("rolcreaterole")?,
        row.try_get::<bool, _>("rolcreatedb")?,
        row.try_get::<bool, _>("rolreplication")?,
        row.try_get::<bool, _>("rolbypassrls")?,
        row.try_get::<bool, _>("can_create")?,
    ]
    .into_iter()
    .any(|value| value);
    if !can_read || can_write != (access == ConnectionAccess::Write) || is_admin || elevated {
        return Err(AppError::Blocked {
            reason: "PlanetScale credential exceeded its approved database policy".into(),
        });
    }
    Ok(())
}

pub(super) async fn verify_gcp_cloud_sql_policy(
    live: &Live,
    engine: Engine,
    access: ConnectionAccess,
    database: &str,
) -> AppResult<()> {
    let sql = live.sql()?;
    let policy_pool = if access == ConnectionAccess::Schema {
        sql.rw()?
    } else {
        &sql.read_pool
    };
    match (policy_pool, engine) {
        (DbPool::Postgres(pool), Engine::Postgres) => {
            if access == ConnectionAccess::Schema {
                let row = sqlx::query(
                    "SELECT \
                       session_user::text ~ \
                         '^dopedb-s-[0-9a-f]{14}@[a-z][a-z0-9-]{4,28}[a-z0-9][.]iam$' \
                         AS exact_schema_login, \
                       current_user = session_user AS exact_schema_owner, \
                       lease.rolcanlogin \
                         AND NOT lease.rolsuper AND NOT lease.rolcreaterole \
                         AND NOT lease.rolcreatedb AND NOT lease.rolreplication \
                         AND NOT lease.rolbypassrls AS safe_login_role, \
                       NOT system_role.rolcanlogin AND NOT system_role.rolsuper \
                         AND NOT system_role.rolcreaterole AND NOT system_role.rolcreatedb \
                         AND NOT system_role.rolreplication \
                         AND NOT system_role.rolbypassrls AS safe_system_role, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles admin \
                         WHERE admin.rolname IN ('postgres', 'cloudsqlsuperuser', 'cloudsqladmin') \
                           AND pg_has_role(session_user, admin.oid, 'MEMBER')) AS no_admin_role, \
                       (SELECT count(*) = 1 \
                         FROM pg_catalog.pg_auth_members membership \
                         JOIN pg_catalog.pg_roles granted \
                           ON granted.oid = membership.roleid \
                         WHERE membership.member = lease.oid \
                           AND granted.rolname = 'cloudsqliamserviceaccount' \
                           AND NOT membership.admin_option) \
                         AND NOT EXISTS (SELECT 1 \
                           FROM pg_catalog.pg_auth_members membership \
                           JOIN pg_catalog.pg_roles granted \
                             ON granted.oid = membership.roleid \
                           WHERE membership.member = lease.oid \
                             AND (granted.rolname <> 'cloudsqliamserviceaccount' \
                               OR membership.admin_option)) \
                         AND (SELECT count(*) = 1 \
                           FROM pg_catalog.pg_auth_members membership \
                           WHERE membership.member = lease.oid) \
                         AND NOT EXISTS (SELECT 1 \
                           FROM pg_catalog.pg_auth_members membership \
                           WHERE membership.roleid = lease.oid) \
                         AND NOT EXISTS (SELECT 1 \
                           FROM pg_catalog.pg_auth_members membership \
                           WHERE membership.member = system_role.oid) \
                         AS exact_membership, \
                       NOT has_database_privilege(session_user, current_database(), 'CREATE') \
                         AND NOT has_database_privilege( \
                           system_role.oid, current_database(), 'CREATE') \
                         AS no_database_create, \
                       NOT has_database_privilege(session_user, current_database(), 'TEMPORARY') \
                         AND NOT has_database_privilege( \
                           system_role.oid, current_database(), 'TEMPORARY') \
                         AS no_temporary, \
                       has_database_privilege(session_user, current_database(), 'CONNECT') \
                         AND NOT has_database_privilege( \
                           session_user, current_database(), 'CONNECT WITH GRANT OPTION') \
                         AND NOT has_database_privilege( \
                           system_role.oid, current_database(), 'CONNECT WITH GRANT OPTION') \
                         AS no_connect_grant, \
                       has_schema_privilege(session_user, 'public', 'USAGE') \
                         AND has_schema_privilege(session_user, 'public', 'CREATE') \
                         AND NOT has_schema_privilege( \
                           session_user, 'public', 'USAGE WITH GRANT OPTION') \
                         AND NOT has_schema_privilege( \
                           session_user, 'public', 'CREATE WITH GRANT OPTION') \
                         AND NOT has_schema_privilege(system_role.oid, 'public', 'CREATE') \
                         AND NOT has_schema_privilege( \
                           system_role.oid, 'public', 'USAGE WITH GRANT OPTION') \
                         AND NOT has_schema_privilege( \
                           system_role.oid, 'public', 'CREATE WITH GRANT OPTION') \
                         AS exact_public_schema, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema \
                         WHERE schema.nspname <> 'public' \
                           AND schema.nspname <> 'information_schema' \
                           AND schema.nspname !~ '^pg_' \
                           AND (has_schema_privilege(session_user, schema.oid, 'USAGE') \
                             OR has_schema_privilege(session_user, schema.oid, 'CREATE') \
                             OR has_schema_privilege(system_role.oid, schema.oid, 'USAGE') \
                             OR has_schema_privilege(system_role.oid, schema.oid, 'CREATE'))) \
                         AS no_other_schema, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object \
                         JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace \
                         WHERE schema.nspname = 'public' \
                           AND object.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c') \
                           AND object.relowner <> lease.oid \
                           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency \
                             WHERE dependency.classid = 'pg_class'::regclass \
                               AND dependency.objid = object.oid \
                               AND dependency.deptype = 'e')) AS exact_relation_owners, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine \
                         JOIN pg_catalog.pg_namespace schema ON schema.oid = routine.pronamespace \
                         WHERE schema.nspname = 'public' AND routine.proowner <> lease.oid \
                           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency \
                             WHERE dependency.classid = 'pg_proc'::regclass \
                               AND dependency.objid = routine.oid \
                               AND dependency.deptype = 'e')) AS exact_routine_owners, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type type \
                         JOIN pg_catalog.pg_namespace schema ON schema.oid = type.typnamespace \
                         WHERE schema.nspname = 'public' AND type.typrelid = 0 \
                           AND type.typelem = 0 AND type.typtype IN ('b','c','d','e','m','r') \
                           AND type.typowner <> lease.oid \
                           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency \
                             WHERE dependency.classid = 'pg_type'::regclass \
                               AND dependency.objid = type.oid \
                               AND dependency.deptype = 'e')) AS exact_type_owners, \
                       NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine \
                         JOIN pg_catalog.pg_namespace schema ON schema.oid = routine.pronamespace \
                         CROSS JOIN LATERAL aclexplode( \
                           COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl \
                         WHERE schema.nspname = 'public' AND routine.proowner = lease.oid \
                           AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') \
                         AS no_public_managed_routine, \
                       NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE( \
                         (SELECT defaults.defaclacl \
                           FROM pg_catalog.pg_default_acl defaults \
                           WHERE defaults.defaclrole = lease.oid \
                             AND defaults.defaclnamespace = 0 \
                             AND defaults.defaclobjtype = 'f'), \
                         acldefault('f', lease.oid))) acl \
                         WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') \
                         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl defaults \
                           JOIN pg_catalog.pg_namespace schema \
                             ON schema.oid = defaults.defaclnamespace \
                           CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl \
                           WHERE defaults.defaclrole = lease.oid \
                             AND schema.nspname = 'public' \
                             AND defaults.defaclobjtype = 'f' \
                             AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') \
                         AS no_public_function_default, \
                       current_setting('statement_timeout') = '5min' AS bounded_statement, \
                       current_setting('idle_in_transaction_session_timeout') = '1min' \
                         AS bounded_transaction_idle, \
                       (current_setting('server_version_num')::int < 140000 \
                         OR current_setting('idle_session_timeout', true) = '5min') \
                         AS bounded_session_idle, \
                       current_setting('search_path') = 'public' AS exact_search_path, \
                       current_setting('default_transaction_read_only') = 'off' \
                         AS writable_default \
                     FROM pg_catalog.pg_roles lease \
                     JOIN pg_catalog.pg_roles system_role \
                       ON system_role.rolname = 'cloudsqliamserviceaccount' \
                     WHERE lease.rolname = session_user",
                )
                .fetch_one(pool)
                .await?;
                let safe = [
                    row.try_get::<bool, _>("exact_schema_login")?,
                    row.try_get::<bool, _>("exact_schema_owner")?,
                    row.try_get::<bool, _>("safe_login_role")?,
                    row.try_get::<bool, _>("safe_system_role")?,
                    row.try_get::<bool, _>("no_admin_role")?,
                    row.try_get::<bool, _>("exact_membership")?,
                    row.try_get::<bool, _>("no_database_create")?,
                    row.try_get::<bool, _>("no_temporary")?,
                    row.try_get::<bool, _>("no_connect_grant")?,
                    row.try_get::<bool, _>("exact_public_schema")?,
                    row.try_get::<bool, _>("no_other_schema")?,
                    row.try_get::<bool, _>("exact_relation_owners")?,
                    row.try_get::<bool, _>("exact_routine_owners")?,
                    row.try_get::<bool, _>("exact_type_owners")?,
                    row.try_get::<bool, _>("no_public_managed_routine")?,
                    row.try_get::<bool, _>("no_public_function_default")?,
                    row.try_get::<bool, _>("bounded_statement")?,
                    row.try_get::<bool, _>("bounded_transaction_idle")?,
                    row.try_get::<bool, _>("bounded_session_idle")?,
                    row.try_get::<bool, _>("exact_search_path")?,
                    row.try_get::<bool, _>("writable_default")?,
                ]
                .into_iter()
                .all(|value| value);
                if !safe {
                    return Err(AppError::Blocked {
                        reason: "GCP Cloud SQL schema credential exceeded its approved PostgreSQL policy"
                            .into(),
                    });
                }
                return Ok(());
            }
            let row = sqlx::query(
                "SELECT \
                   EXISTS ( \
                     SELECT 1 FROM pg_catalog.pg_roles granted \
                     WHERE (granted.rolname = 'pg_read_all_data' \
                            OR granted.rolname ~ '^dopedb_r_[0-9a-f]{14}$') \
                       AND pg_has_role(current_user, granted.oid, 'USAGE') \
                   ) AS can_read, \
                   EXISTS ( \
                     SELECT 1 FROM pg_catalog.pg_roles granted \
                     WHERE (granted.rolname = 'pg_write_all_data' \
                            OR granted.rolname ~ '^dopedb_w_[0-9a-f]{14}$') \
                       AND pg_has_role(current_user, granted.oid, 'USAGE') \
                   ) AS can_write, \
                   EXISTS ( \
                     SELECT 1 FROM pg_catalog.pg_roles admin \
                     WHERE admin.rolname IN ('postgres', 'cloudsqlsuperuser') \
                       AND pg_has_role(current_user, admin.oid, 'MEMBER') \
                   ) AS is_admin, \
                   role.rolsuper, role.rolcreaterole, role.rolcreatedb, \
                   role.rolreplication, role.rolbypassrls, \
                   has_database_privilege(current_user, current_database(), 'CREATE') \
                     AS can_create_database, \
                   has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema \
                 FROM pg_catalog.pg_roles role WHERE role.rolname = current_user",
            )
            .fetch_one(pool)
            .await?;
            let can_read: bool = row.try_get("can_read")?;
            let can_write: bool = row.try_get("can_write")?;
            let is_admin: bool = row.try_get("is_admin")?;
            let elevated = [
                row.try_get::<bool, _>("rolsuper")?,
                row.try_get::<bool, _>("rolcreaterole")?,
                row.try_get::<bool, _>("rolcreatedb")?,
                row.try_get::<bool, _>("rolreplication")?,
                row.try_get::<bool, _>("rolbypassrls")?,
                row.try_get::<bool, _>("can_create_database")?,
                row.try_get::<bool, _>("can_create_schema")?,
            ]
            .into_iter()
            .any(|value| value);
            if !can_read || can_write != (access == ConnectionAccess::Write) || is_admin || elevated
            {
                return Err(AppError::Blocked {
                    reason: "GCP Cloud SQL credential exceeded its approved PostgreSQL policy"
                        .into(),
                });
            }
        }
        (DbPool::Mysql(pool), Engine::Mysql) => {
            if access == ConnectionAccess::Schema {
                return Err(AppError::Blocked {
                    reason: "GCP Cloud SQL managed schema access requires PostgreSQL".into(),
                });
            }
            let rows = sqlx::query("SHOW GRANTS FOR CURRENT_USER")
                .fetch_all(pool)
                .await?;
            let grants = rows
                .iter()
                .map(|row| row.try_get::<String, _>(0))
                .collect::<Result<Vec<_>, _>>()?;
            if !mysql_grants_match_policy(&grants, database, access) {
                return Err(AppError::Blocked {
                    reason: "GCP Cloud SQL credential exceeded its approved MySQL policy".into(),
                });
            }
        }
        _ => {
            return Err(AppError::Blocked {
                reason: "GCP Cloud SQL policy opened the wrong engine".into(),
            });
        }
    }
    Ok(())
}

pub(super) fn mysql_grants_match_policy(
    grants: &[String],
    database: &str,
    access: ConnectionAccess,
) -> bool {
    if grants.is_empty() || database.is_empty() || database.contains('`') {
        return false;
    }
    let expected_object = format!("`{database}`.*");
    let expected_privileges = match access {
        ConnectionAccess::Read => BTreeSet::from(["SELECT"]),
        ConnectionAccess::Write => BTreeSet::from(["DELETE", "INSERT", "SELECT", "UPDATE"]),
        ConnectionAccess::Schema => return false,
    };
    let mut found_data_grant = false;
    for grant in grants {
        let upper = grant.to_ascii_uppercase();
        if !upper.starts_with("GRANT ") || upper.contains("WITH GRANT OPTION") {
            return false;
        }
        let Some(on_index) = upper.find(" ON ") else {
            return false;
        };
        let privileges = upper[6..on_index]
            .split(',')
            .map(str::trim)
            .collect::<BTreeSet<_>>();
        let object_and_principal = &grant[on_index + 4..];
        let object_and_principal_upper = &upper[on_index + 4..];
        let Some(to_index) = object_and_principal_upper.find(" TO ") else {
            return false;
        };
        let object = object_and_principal[..to_index].trim();
        if object == "*.*" && privileges == BTreeSet::from(["USAGE"]) {
            continue;
        }
        if object != expected_object || privileges != expected_privileges || found_data_grant {
            return false;
        }
        found_data_grant = true;
    }
    found_data_grant
}

#[cfg(test)]
pub(crate) fn assert_gcp_mysql_grant_contract() {
    let usage = "GRANT USAGE ON *.* TO `dopedb-r`@`%` REQUIRE SSL".to_owned();
    let read = "GRANT SELECT ON `app`.* TO `dopedb-r`@`%`".to_owned();
    let write = "GRANT SELECT, INSERT, UPDATE, DELETE ON `app`.* TO `dopedb-w`@`%`".to_owned();
    assert!(mysql_grants_match_policy(
        &[usage.clone(), read],
        "app",
        ConnectionAccess::Read,
    ));
    assert!(mysql_grants_match_policy(
        &[usage.clone(), write],
        "app",
        ConnectionAccess::Write,
    ));
    assert!(!mysql_grants_match_policy(
        &[
            usage,
            "GRANT SELECT, CREATE ON `app`.* TO `dopedb-r`@`%`".into(),
        ],
        "app",
        ConnectionAccess::Read,
    ));
}
