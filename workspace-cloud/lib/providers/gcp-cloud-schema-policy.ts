// Stable PostgreSQL ownership boundary for short-lived GCP Cloud SQL schema
// leases. The IAM database role is durable, but every usable password is a
// short-lived Google access token.

import { ProviderRequestError } from "./provider-types";

function pgIdentifier(value: string) {
  return `"${value.split("\"").join("\"\"")}"`;
}

function pgLiteral(value: string) {
  return `'${value.split("'").join("''")}'`;
}

function postgresRole(value: string) {
  if (
    value.length === 0
    || value.length > 63
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Invalid Cloud SQL schema database user",
      409,
    );
  }
  return value;
}

function postgresMajorVersion(value: number) {
  if (!Number.isInteger(value) || value < 9 || value > 99) {
    throw new ProviderRequestError(
      "gcpCloudSql",
      "Unsupported Cloud SQL PostgreSQL version",
      409,
    );
  }
  return value;
}

function ownedObjectUnion() {
  return `SELECT object.relowner AS owner_oid FROM pg_catalog.pg_class object `
    + `JOIN pg_catalog.pg_namespace schema ON schema.oid = object.relnamespace `
    + `WHERE schema.nspname = 'public' `
    + `AND object.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c') `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_class'::regclass `
    + `AND dependency.objid = object.oid AND dependency.deptype = 'e') `
    + `UNION SELECT routine.proowner FROM pg_catalog.pg_proc routine `
    + `JOIN pg_catalog.pg_namespace schema ON schema.oid = routine.pronamespace `
    + `WHERE schema.nspname = 'public' `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_proc'::regclass `
    + `AND dependency.objid = routine.oid AND dependency.deptype = 'e') `
    + `UNION SELECT type.typowner FROM pg_catalog.pg_type type `
    + `JOIN pg_catalog.pg_namespace schema ON schema.oid = type.typnamespace `
    + `WHERE schema.nspname = 'public' AND type.typrelid = 0 AND type.typelem = 0 `
    + `AND type.typtype IN ('b', 'c', 'd', 'e', 'm', 'r') `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_type'::regclass `
    + `AND dependency.objid = type.oid AND dependency.deptype = 'e')`;
}

function requiredOwnerUnion() {
  return ownedObjectUnion()
    + ` UNION SELECT database.datdba FROM pg_catalog.pg_database database `
    + `WHERE database.datname = current_database() `
    + `UNION SELECT schema.nspowner FROM pg_catalog.pg_namespace schema `
    + `WHERE schema.nspname = 'public'`;
}

/** Enumerate only the roles the temporary setup user must inherit while it
 * revokes database/schema ACLs and transfers existing public objects. Reserved
 * owners are intentionally omitted here and rejected transactionally below. */
export function gcpSchemaOwnerInventorySql(schemaUser: string) {
  const owner = postgresRole(schemaUser);
  return `SELECT DISTINCT role.rolname AS owner_role `
    + `FROM pg_catalog.pg_roles role JOIN (${requiredOwnerUnion()}) owners `
    + `ON owners.owner_oid = role.oid `
    + `WHERE role.rolname <> ${pgLiteral(owner)} AND NOT role.rolsuper `
    + `AND (role.rolname = 'cloudsqlsuperuser' `
    + `OR role.rolname !~ '^(pg_|cloudsql)') `
    + `ORDER BY role.rolname LIMIT 101`;
}

function roleGrantSql(role: string | null, write: boolean) {
  if (!role) return "";
  const identifier = pgIdentifier(role);
  return write
    ? `EXECUTE 'GRANT USAGE ON SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier}'; `
      + `EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${identifier}'; `
    : `EXECUTE 'GRANT USAGE ON SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}'; `
      + `EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${identifier}'; `
      + `EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${identifier}'; `;
}

/** Move every non-extension object in public to the dedicated IAM database role
 * and install its object defaults. Any unmanageable owner aborts the whole
 * transaction, so a repair cannot leave a partial ownership takeover. */
export function gcpSchemaDatabasePolicySql(input: {
  postgresMajorVersion: number;
  database: string;
  schemaUser: string;
  readRole: string | null;
  writeRole: string | null;
}) {
  const schemaUser = postgresRole(input.schemaUser);
  const database = postgresRole(input.database);
  const majorVersion = postgresMajorVersion(input.postgresMajorVersion);
  const readRole = input.readRole ? postgresRole(input.readRole) : null;
  const writeRole = input.writeRole ? postgresRole(input.writeRole) : null;
  const grants = roleGrantSql(readRole, false) + roleGrantSql(writeRole, true);
  const targetMembershipMode = majorVersion >= 16 ? "SET" : "MEMBER";
  const idleSessionDefault = majorVersion >= 14
    ? `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET idle_session_timeout = %L', `
      + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}, '5min'); `
    : "";
  const routineKind = majorVersion >= 11
    ? "CASE routine.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END"
    : "CASE WHEN routine.proisagg THEN 'AGGREGATE' ELSE 'FUNCTION' END";
  const routinePrivilegeKind = majorVersion >= 11 ? "ROUTINE" : "FUNCTION";
  return `BEGIN; SET LOCAL ROLE NONE; `
    + `REVOKE CREATE, TEMPORARY ON DATABASE ${pgIdentifier(database)} FROM PUBLIC; `
    + `REVOKE CREATE ON SCHEMA public FROM PUBLIC; `
    + `REVOKE ALL PRIVILEGES ON DATABASE ${pgIdentifier(database)} FROM ${pgIdentifier(schemaUser)}; `
    + `GRANT CONNECT ON DATABASE ${pgIdentifier(database)} TO ${pgIdentifier(schemaUser)}; `
    + `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${pgIdentifier(schemaUser)}; `
    + `GRANT USAGE, CREATE ON SCHEMA public TO ${pgIdentifier(schemaUser)}; `
    + `DO $dopedb$ DECLARE setup_role text := session_user; owner_row record; `
    + `object_row record; BEGIN `
    + `IF current_user <> session_user OR current_database() <> ${pgLiteral(database)} THEN `
    + `RAISE EXCEPTION 'Cloud SQL setup session identity changed'; END IF; `
    + `IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role `
    + `WHERE role.rolname = ${pgLiteral(schemaUser)} AND role.rolcanlogin `
    + `AND NOT role.rolsuper AND NOT role.rolcreaterole `
    + `AND NOT role.rolcreatedb AND NOT role.rolreplication `
    + `AND NOT role.rolbypassrls) THEN `
    + `RAISE EXCEPTION 'DopeDB schema login role is unsafe'; END IF; `
    + `IF NOT pg_has_role(setup_role, ${pgLiteral(schemaUser)}, ${pgLiteral(targetMembershipMode)}) THEN `
    + `RAISE EXCEPTION 'Cloud SQL setup role cannot transfer schema ownership'; END IF; `
    + `IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role `
    + `WHERE role.rolname = 'cloudsqliamserviceaccount' `
    + `AND NOT role.rolcanlogin AND NOT role.rolsuper `
    + `AND NOT role.rolcreaterole AND NOT role.rolcreatedb `
    + `AND NOT role.rolreplication AND NOT role.rolbypassrls) `
    + `OR has_database_privilege('cloudsqliamserviceaccount', current_database(), 'CREATE') `
    + `OR has_database_privilege('cloudsqliamserviceaccount', current_database(), 'TEMPORARY') `
    + `OR has_database_privilege('cloudsqliamserviceaccount', current_database(), 'CONNECT WITH GRANT OPTION') `
    + `OR has_schema_privilege('cloudsqliamserviceaccount', 'public', 'CREATE') `
    + `OR has_schema_privilege('cloudsqliamserviceaccount', 'public', 'USAGE WITH GRANT OPTION') `
    + `OR has_schema_privilege('cloudsqliamserviceaccount', 'public', 'CREATE WITH GRANT OPTION') `
    + `OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership `
    + `JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member `
    + `WHERE member_role.rolname = 'cloudsqliamserviceaccount') THEN `
    + `RAISE EXCEPTION 'Cloud SQL IAM service-account role exceeds the schema boundary'; END IF; `
    + `IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership `
    + `JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid `
    + `JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member `
    + `WHERE member_role.rolname = ${pgLiteral(schemaUser)} `
    + `AND (granted.rolname <> 'cloudsqliamserviceaccount' `
    + `OR membership.admin_option)) `
    + `OR (SELECT count(*) FROM pg_catalog.pg_auth_members membership `
    + `JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid `
    + `JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member `
    + `WHERE member_role.rolname = ${pgLiteral(schemaUser)} `
    + `AND granted.rolname = 'cloudsqliamserviceaccount') <> 1 THEN `
    + `RAISE EXCEPTION 'DopeDB schema login role membership drift'; END IF; `
    + `IF (SELECT count(*) FROM pg_catalog.pg_auth_members membership `
    + `JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid `
    + `JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member `
    + `WHERE granted.rolname = ${pgLiteral(schemaUser)} `
    + `AND member_role.rolname = setup_role AND NOT membership.admin_option) <> 1 `
    + `OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership `
    + `JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid `
    + `JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member `
    + `WHERE granted.rolname = ${pgLiteral(schemaUser)} `
    + `AND (member_role.rolname <> setup_role OR membership.admin_option)) THEN `
    + `RAISE EXCEPTION 'DopeDB schema login role has an unexpected member'; END IF; `
    + `IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace schema `
    + `WHERE schema.nspname <> 'public' AND schema.nspname <> 'information_schema' `
    + `AND schema.nspname !~ '^pg_' AND (`
    + `has_schema_privilege(${pgLiteral(schemaUser)}, schema.oid, 'USAGE') `
    + `OR has_schema_privilege(${pgLiteral(schemaUser)}, schema.oid, 'CREATE') `
    + `OR has_schema_privilege('cloudsqliamserviceaccount', schema.oid, 'USAGE') `
    + `OR has_schema_privilege('cloudsqliamserviceaccount', schema.oid, 'CREATE'))) THEN `
    + `RAISE EXCEPTION 'Cloud SQL schema principal can access another user schema'; END IF; `
    + `FOR owner_row IN SELECT DISTINCT role.oid, role.rolname, role.rolsuper `
    + `FROM pg_catalog.pg_roles role JOIN (${ownedObjectUnion()}) owners `
    + `ON owners.owner_oid = role.oid WHERE role.rolname <> ${pgLiteral(schemaUser)} `
    + `ORDER BY role.rolname LOOP `
    + `IF owner_row.rolsuper `
    + `OR (owner_row.rolname ~ '^(pg_|cloudsql)' `
    + `AND owner_row.rolname <> 'cloudsqlsuperuser') THEN `
    + `RAISE EXCEPTION 'Cloud SQL object has a reserved owner'; END IF; `
    + `IF NOT pg_has_role(setup_role, owner_row.oid, 'USAGE') THEN `
    + `RAISE EXCEPTION 'Cloud SQL setup role cannot inherit an object owner'; END IF; `
    + `FOR object_row IN SELECT CASE object.relkind `
    + `WHEN 'r' THEN format('ALTER TABLE %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'p' THEN format('ALTER TABLE %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'v' THEN format('ALTER VIEW %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'm' THEN format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'f' THEN format('ALTER FOREIGN TABLE %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'S' THEN format('ALTER SEQUENCE %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) `
    + `WHEN 'c' THEN format('ALTER TYPE %I.%I OWNER TO %I', schema.nspname, object.relname, ${pgLiteral(schemaUser)}) END AS ddl `
    + `FROM pg_catalog.pg_class object JOIN pg_catalog.pg_namespace schema `
    + `ON schema.oid = object.relnamespace WHERE schema.nspname = 'public' `
    + `AND object.relowner = owner_row.oid AND object.relkind IN ('r','p','v','m','f','S','c') `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_class'::regclass AND dependency.objid = object.oid `
    + `AND dependency.deptype = 'e') `
    + `AND (object.relkind <> 'S' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend owned_sequence `
    + `WHERE owned_sequence.classid = 'pg_class'::regclass `
    + `AND owned_sequence.objid = object.oid `
    + `AND owned_sequence.refclassid = 'pg_class'::regclass `
    + `AND owned_sequence.deptype IN ('a','i'))) LOOP EXECUTE object_row.ddl; END LOOP; `
    + `FOR object_row IN SELECT format('ALTER %s %I.%I(%s) OWNER TO %I', `
    + `${routineKind}, schema.nspname, routine.proname, `
    + `pg_get_function_identity_arguments(routine.oid), ${pgLiteral(schemaUser)}) AS ddl `
    + `FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace schema `
    + `ON schema.oid = routine.pronamespace WHERE schema.nspname = 'public' `
    + `AND routine.proowner = owner_row.oid `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_proc'::regclass AND dependency.objid = routine.oid `
    + `AND dependency.deptype = 'e') LOOP EXECUTE object_row.ddl; END LOOP; `
    + `FOR object_row IN SELECT format('ALTER %s %I.%I OWNER TO %I', `
    + `CASE type.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, `
    + `schema.nspname, type.typname, ${pgLiteral(schemaUser)}) AS ddl `
    + `FROM pg_catalog.pg_type type JOIN pg_catalog.pg_namespace schema `
    + `ON schema.oid = type.typnamespace WHERE schema.nspname = 'public' `
    + `AND type.typowner = owner_row.oid AND type.typrelid = 0 AND type.typelem = 0 `
    + `AND type.typtype IN ('b','c','d','e','m','r') `
    + `AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency `
    + `WHERE dependency.classid = 'pg_type'::regclass AND dependency.objid = type.oid `
    + `AND dependency.deptype = 'e') LOOP EXECUTE object_row.ddl; END LOOP; `
    + `END LOOP; `
    + `EXECUTE format('SET LOCAL ROLE %I', ${pgLiteral(schemaUser)}); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET ALL', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET role = %L', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}, 'none'); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = public', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}, '5min'); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}, '1min'); `
    + `EXECUTE format('ALTER ROLE %I IN DATABASE %I SET default_transaction_read_only = %L', `
    + `${pgLiteral(schemaUser)}, ${pgLiteral(database)}, 'off'); `
    + idleSessionDefault
    + `FOR object_row IN SELECT format('REVOKE EXECUTE ON ${routinePrivilegeKind} %I.%I(%s) FROM PUBLIC', `
    + `schema.nspname, routine.proname, pg_get_function_identity_arguments(routine.oid)) AS ddl `
    + `FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace schema `
    + `ON schema.oid = routine.pronamespace WHERE schema.nspname = 'public' `
    + `AND routine.proowner = (SELECT role.oid FROM pg_catalog.pg_roles role `
    + `WHERE role.rolname = ${pgLiteral(schemaUser)}) `
    + `LOOP EXECUTE object_row.ddl; END LOOP; `
    + `EXECUTE 'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'; `
    + `EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'; `
    + grants
    + `EXECUTE 'SET ROLE NONE'; `
    + `IF has_database_privilege(${pgLiteral(schemaUser)}, current_database(), 'CREATE') `
    + `OR has_database_privilege(${pgLiteral(schemaUser)}, current_database(), 'TEMPORARY') `
    + `OR has_database_privilege(${pgLiteral(schemaUser)}, current_database(), 'CONNECT WITH GRANT OPTION') `
    + `OR NOT has_database_privilege(${pgLiteral(schemaUser)}, current_database(), 'CONNECT') `
    + `OR NOT has_schema_privilege(${pgLiteral(schemaUser)}, 'public', 'USAGE') `
    + `OR NOT has_schema_privilege(${pgLiteral(schemaUser)}, 'public', 'CREATE') `
    + `OR has_schema_privilege(${pgLiteral(schemaUser)}, 'public', 'USAGE WITH GRANT OPTION') `
    + `OR has_schema_privilege(${pgLiteral(schemaUser)}, 'public', 'CREATE WITH GRANT OPTION') THEN `
    + `RAISE EXCEPTION 'Cloud SQL schema principal privilege boundary is unavailable'; END IF; `
    + `IF EXISTS (${ownedObjectUnion()} EXCEPT SELECT role.oid `
    + `FROM pg_catalog.pg_roles role WHERE role.rolname = ${pgLiteral(schemaUser)}) THEN `
    + `RAISE EXCEPTION 'Cloud SQL schema ownership transfer is incomplete'; END IF; `
    + `END $dopedb$; COMMIT;`;
}
