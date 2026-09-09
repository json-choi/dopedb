#!/usr/bin/env node
// Execute the production Cloud SQL policy against an isolated PostgreSQL cluster.
// No cloud credentials, application data, or existing database are used.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const scratch = mkdtempSync(path.join(tmpdir(), "dopedb-pg-policy-"));
const binary = (name) => process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
const data = path.join(scratch, "data");
let started = false;
const run = (name, args) => execFileSync(binary(name), args, { encoding: "utf8", stdio: "pipe" });
const query = (sql, database = "app", user = "policy_admin", failure = null) => {
  const result = spawnSync(binary("psql"), ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", scratch, "-p", "55479", "-U", user, "-d", database],
  { input: sql, encoding: "utf8" });
  if (failure) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, failure);
  } else assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
};
const snapshot = () => query(`SELECT json_build_object(
  'relations', (SELECT json_agg(row(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'routines', (SELECT json_agg(row(p.oid,p.proowner,p.proacl,p.prosecdef) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
  'types', (SELECT json_agg(row(t.oid,t.typowner,t.typacl) ORDER BY t.oid)
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
  'schema', (SELECT nspacl FROM pg_namespace WHERE nspname='public'),
  'database', (SELECT datacl FROM pg_database WHERE datname=current_database()),
  'defaults', (SELECT json_agg(row(d.defaclrole,d.defaclnamespace,d.defaclobjtype,d.defaclacl) ORDER BY d.oid)
    FROM pg_default_acl d));`);
try {
  // Compile the actual policy and its error type, without rewriting their logic.
  writeFileSync(path.join(scratch, "package.json"), '{"type":"module"}');
  for (const name of ["gcp-cloud-schema-policy", "provider-types"]) {
    const source = readFileSync(path.join(root, "workspace-cloud/lib/providers", `${name}.ts`), "utf8");
    writeFileSync(path.join(scratch, `${name}.js`), stripTypeScriptTypes(source, { mode: "transform" })
      .replace('"./provider-types"', '"./provider-types.js"'));
  }
  const { gcpSchemaDatabasePolicySql, gcpSchemaOwnerInventorySql } =
    await import(pathToFileURL(path.join(scratch, "gcp-cloud-schema-policy.js")));
  run("initdb", ["-D", data, "-U", "policy_admin", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", path.join(scratch, "server.log"), "-o",
    `-k ${scratch} -p 55479 -c listen_addresses=''`, "-w", "start"]);
  started = true;
  query(`CREATE ROLE app_runtime LOGIN; CREATE ROLE app_reader;
    CREATE ROLE cloudsqliamserviceaccount;
    CREATE ROLE schema_owner LOGIN;
    GRANT cloudsqliamserviceaccount TO schema_owner;
    GRANT schema_owner TO policy_admin WITH ADMIN FALSE;
    CREATE DATABASE app OWNER app_runtime;`, "postgres");
  const policy = gcpSchemaDatabasePolicySql({ postgresMajorVersion: 17,
    database: "app", schemaUser: "schema_owner", readRole: null, writeRole: null });
  query(`GRANT CREATE ON SCHEMA public TO PUBLIC;
    SET ROLE app_runtime;
    CREATE TABLE app_data(id bigserial PRIMARY KEY, value text);
    INSERT INTO app_data(value) VALUES ('preserved');
    ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
    CREATE VIEW app_view AS SELECT * FROM app_data;
    CREATE TYPE app_state AS ENUM ('ready');
    CREATE FUNCTION app_count() RETURNS bigint LANGUAGE SQL SECURITY DEFINER
      AS 'SELECT count(*) FROM public.app_data';
    GRANT SELECT ON app_data TO app_reader;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_reader;`);
  const before = snapshot();
  query(policy, "app", "policy_admin", /reviewed application ownership migration/);
  assert.equal(snapshot(), before, "Rejected setup changed application ownership or ACLs");
  assert.equal(query("SELECT app_count(), (SELECT count(*) FROM app_data);", "app", "app_runtime"), "1|1");
  assert.equal(query("BEGIN; ALTER TABLE app_data ADD COLUMN migration_probe text; ROLLBACK;", "app", "app_runtime"), "BEGIN\nALTER TABLE\nROLLBACK");
  assert.match(query(gcpSchemaOwnerInventorySql("schema_owner")), /app_runtime/);

  // Empty databases still must not lose inherited PUBLIC access during setup.
  query("CREATE DATABASE empty_app OWNER app_runtime;", "postgres");
  const emptyPolicy = gcpSchemaDatabasePolicySql({ postgresMajorVersion: 17,
    database: "empty_app", schemaUser: "schema_owner", readRole: null, writeRole: null });
  query(emptyPolicy, "empty_app", "policy_admin", /reviewed PUBLIC privileges/);
  assert.equal(query("SELECT has_database_privilege('app_reader', current_database(), 'TEMPORARY');", "empty_app"), "t");

  // A separately reviewed, isolated schema owner may be configured repeatedly.
  // Fixture-only migration is explicit; production setup never performs it.
  query(`DROP DATABASE app; CREATE DATABASE app OWNER app_runtime;`, "postgres");
  query(`REVOKE TEMPORARY, CREATE ON DATABASE app FROM PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA public TO schema_owner;
    SET ROLE schema_owner;
    ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_runtime;
    CREATE TABLE existing_data(id bigserial PRIMARY KEY, value text);
    CREATE FUNCTION managed_count() RETURNS bigint LANGUAGE SQL AS 'SELECT 1::bigint';`);
  query(policy);
  const approved = snapshot();
  query(policy);
  assert.equal(snapshot(), approved, "Repair changed approved runtime grants or creator defaults");
  query(`CREATE TABLE future_data(id bigserial PRIMARY KEY, value text);
    CREATE FUNCTION future_count() RETURNS bigint LANGUAGE SQL AS 'SELECT 2::bigint';`, "app", "schema_owner");
  query(`BEGIN;
    INSERT INTO existing_data(value) VALUES ('existing');
    INSERT INTO future_data(value) VALUES ('future');
    UPDATE future_data SET value='updated';
    DO $$ BEGIN
      IF (SELECT count(*) FROM future_data WHERE value='updated') <> 1
        OR managed_count() <> 1 OR future_count() <> 2 THEN
        RAISE EXCEPTION 'Runtime access failed'; END IF;
    END $$;
    DELETE FROM future_data; ROLLBACK;`, "app", "app_runtime");
  assert.equal(query(`SELECT pg_has_role('app_runtime','schema_owner','MEMBER'),
    has_table_privilege('app_reader','future_data','SELECT'),
    has_table_privilege('app_reader','future_data','INSERT');`), "f|f|f");

  // Repair also preserves callers of existing routines instead of revoking PUBLIC.
  query("GRANT EXECUTE ON FUNCTION managed_count() TO PUBLIC;");
  const publicRoutine = snapshot();
  query(policy, "app", "policy_admin", /reviewed routine access/);
  assert.equal(snapshot(), publicRoutine);
  console.log("PASS: application ownership, RLS, DDL, routine access, PUBLIC access, repair, future runtime grants, and unrelated-role isolation");
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(scratch, { recursive: true, force: true });
}
