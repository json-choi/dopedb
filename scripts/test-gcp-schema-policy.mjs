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

// gcpConnectionDatabaseRoles() (workspace-cloud/lib/providers/gcp-cloud-connection-policy.ts)
// already refuses automatic managed access below PostgreSQL 14, because the roles it grants
// -- pg_read_all_data and pg_write_all_data -- are PostgreSQL 14+ predefined roles. This script
// grants those same roles against a real cluster, so it cannot run below that floor either; a
// full pass here (RLS forcing, ALTER DEFAULT PRIVILEGES ... ON SCHEMAS, pg_default_acl behavior
// for future schemas/tables) has been verified on PostgreSQL 14.18 and 15.15.
const MIN_SERVER_VERSION = 14;
const REQUIRED_SERVER_BINARIES = ["initdb", "pg_ctl", "psql"];

const root = path.resolve(import.meta.dirname, "..");
const binary = (name) => process.env.PG_BIN ? path.join(process.env.PG_BIN, name) : name;
const binLocation = () => process.env.PG_BIN ? path.resolve(process.env.PG_BIN) : "the current PATH";

// A libpq-only client package (e.g. a conda/anaconda `postgresql` client build) ships `pg_config`
// and `psql` but not the server programs, so `initdb` fails with a bare ENOENT and no explanation.
// Confirm all three server binaries actually resolve and run before touching any cluster state.
function preflightServerBinaries() {
  const missing = REQUIRED_SERVER_BINARIES.filter((name) => {
    const result = spawnSync(binary(name), ["--version"], { encoding: "utf8", stdio: "pipe" });
    return Boolean(result.error) || result.status !== 0;
  });
  if (missing.length > 0) {
    console.error(
      `Missing PostgreSQL server binaries (${missing.join(", ")}) at ${binLocation()}.\n` +
      "PG_BIN (or PATH) must point at the bindir of a PostgreSQL install that includes the " +
      "server, not a libpq-only client package. For example, from a server-bearing install:\n" +
      '  PG_BIN="$(pg_config --bindir)" node scripts/test-gcp-schema-policy.mjs',
    );
    process.exit(1);
  }
}

function preflightServerVersion() {
  const result = spawnSync(binary("pg_ctl"), ["--version"], { encoding: "utf8", stdio: "pipe" });
  const major = Number(/PostgreSQL\)?\s+(\d+)/.exec(result.stdout)?.[1]);
  if (!Number.isInteger(major) || major < MIN_SERVER_VERSION) {
    console.error(
      `PostgreSQL server at ${binLocation()} reports "${result.stdout.trim()}"; this policy ` +
      `requires PostgreSQL ${MIN_SERVER_VERSION} or later, matching the floor ` +
      "gcpConnectionDatabaseRoles() already enforces for managed access " +
      "(pg_read_all_data/pg_write_all_data are PostgreSQL 14+ predefined roles). " +
      "Point PG_BIN at a newer server install.",
    );
    process.exit(1);
  }
}

preflightServerBinaries();
preflightServerVersion();

const scratch = mkdtempSync(path.join(tmpdir(), "dopedb-pg-policy-"));
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
  // Execute the roles supplied by the production Cloud SQL users.insert body.
  writeFileSync(path.join(scratch, "package.json"), '{"type":"module"}');
  for (const name of ["gcp-cloud-connection-policy", "provider-types"]) {
    const source = readFileSync(path.join(root, "workspace-cloud/lib/providers", `${name}.ts`), "utf8");
    writeFileSync(path.join(scratch, `${name}.js`), stripTypeScriptTypes(source, { mode: "transform" })
      .replace('"./provider-types"', '"./provider-types.js"'));
  }
  const { gcpConnectionDatabaseRoles, assertDatabaseUserRoles } =
    await import(pathToFileURL(path.join(scratch, "gcp-cloud-connection-policy.js")));
  run("initdb", ["-D", data, "-U", "policy_admin", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", path.join(scratch, "server.log"), "-o",
    `-k ${scratch} -p 55479 -c listen_addresses=''`, "-w", "start"]);
  started = true;
  query(`CREATE ROLE app_migration LOGIN; CREATE ROLE app_runtime LOGIN;
    CREATE DATABASE app OWNER app_migration;`, "postgres");
  query(`SET ROLE app_migration;
    ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO app_runtime;
    ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
    ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
    CREATE SCHEMA existing;
    CREATE TABLE existing.events(id bigserial PRIMARY KEY, value text);
    INSERT INTO existing.events(value) VALUES ('preserved');
    CREATE TABLE public.owner_data(id int);
    ALTER TABLE public.owner_data ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.app_count() RETURNS bigint LANGUAGE SQL SECURITY DEFINER
      AS 'SELECT count(*) FROM existing.events';`);
  const before = snapshot();
  const memberships = () => query(`SELECT rolname, rolcreaterole, rolcreatedb, rolbypassrls,
    (SELECT string_agg(roleid::text, ',' ORDER BY roleid) FROM pg_auth_members WHERE member=r.oid)
    FROM pg_roles r WHERE rolname IN ('app_runtime','app_migration') ORDER BY rolname`);
  const originalMemberships = memberships();
  const readRoles = gcpConnectionDatabaseRoles("POSTGRES_17", false);
  const writeRoles = gcpConnectionDatabaseRoles("POSTGRES_17", true);
  // Cloud SQL assigns these at creation; no existing role is a GRANT target.
  query(`CREATE ROLE dopedb_read LOGIN; CREATE ROLE dopedb_write LOGIN;
    GRANT ${readRoles.join(",")} TO dopedb_read;
    GRANT ${writeRoles.join(",")} TO dopedb_write;`);
  assert.equal(snapshot(), before);
  assert.equal(memberships(), originalMemberships);
  for (let attempt = 0; attempt < 2; attempt++) {
    assertDatabaseUserRoles({ type: "CLOUD_IAM_SERVICE_ACCOUNT", databaseRoles: readRoles }, readRoles);
    assert.throws(() => assertDatabaseUserRoles({
      type: "CLOUD_IAM_SERVICE_ACCOUNT", databaseRoles: ["application_role"],
    }, readRoles), /Existing roles were preserved/);
    assert.equal(snapshot(), before, "Repair or refusal changed application ACLs/defaults/owners");
  }
  query(`SET ROLE app_migration; CREATE SCHEMA future;
    CREATE TABLE future.events(id bigserial PRIMARY KEY, value text);
    INSERT INTO future.events(value) VALUES ('new schema');
    ALTER TABLE public.owner_data ADD COLUMN migration_probe text;`);
  for (const user of ["app_runtime", "dopedb_read", "dopedb_write"]) {
    assert.equal(query("SELECT count(*) FROM existing.events;", "app", user), "1");
    assert.equal(query("SELECT count(*) FROM future.events;", "app", user), "1");
  }
  query("INSERT INTO future.events(value) VALUES ('still writable');", "app", "app_runtime");
  query("INSERT INTO future.events(value) VALUES ('managed write');", "app", "dopedb_write");
  query("INSERT INTO future.events(value) VALUES ('denied');", "app", "dopedb_read", /permission denied/);
  assert.equal(query("SELECT app_count();", "app", "app_runtime"), "1");
  assert.equal(query("SELECT has_database_privilege('app_runtime',current_database(),'TEMPORARY');"), "t");
  assert.equal(memberships(), originalMemberships);
  console.log("PASS: existing application users, owners, RLS, PUBLIC, defaults, repair refusal, future schemas and data-only managed roles");

  // A pre-existing migration owner may already be inherited by the application.
  // Schema setup adds membership only to a NEW login; SQL runs as the old owner.
  const owner = "migration_owner";
  const schemaLogin = "dopedb-s-1234567890abcd@dopedb-fixture.iam";
  query(`CREATE ROLE cloudsqliamserviceaccount NOLOGIN;
    CREATE ROLE ${owner} NOLOGIN;
    CREATE ROLE schema_app LOGIN;
    GRANT ${owner} TO schema_app;
    CREATE DATABASE schema_app;`, "postgres");
  query(`REVOKE TEMPORARY ON DATABASE schema_app FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE, CREATE ON SCHEMA public TO ${owner};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    SET ROLE ${owner};
    CREATE TABLE contents(id int, visibility text DEFAULT 'public');
    INSERT INTO contents VALUES (1, 'public'), (2, 'private');`, "schema_app");
  const savedAccess = () => query(`SELECT json_build_object(
    'members', (SELECT json_agg(row(member,roleid,admin_option) ORDER BY member,roleid) FROM pg_auth_members WHERE member IN
      (SELECT oid FROM pg_roles WHERE rolname IN ('schema_app','${owner}'))),
    'defaults', (SELECT json_agg(row(defaclrole,defaclnamespace,defaclobjtype,defaclacl) ORDER BY oid) FROM pg_default_acl),
    'schema', (SELECT nspacl FROM pg_namespace WHERE nspname='public'),
    'database', (SELECT datacl FROM pg_database WHERE datname=current_database()),
    'owner', (SELECT relowner FROM pg_class WHERE oid='public.contents'::regclass));`, "schema_app");
  const saved = savedAccess();
  query(`CREATE ROLE "${schemaLogin}" LOGIN;
    GRANT cloudsqliamserviceaccount, ${owner} TO "${schemaLogin}";`, "schema_app");
  assert.equal(savedAccess(), saved);
  const policySource = readFileSync(path.join(root, "src-tauri/src/connection/gcp_schema_policy.rs"), "utf8");
  const policySql = /POLICY: &str = r#"([\s\S]*?)"#;/.exec(policySource)[1];
  const setupSql = `SET ROLE ${owner}; SET statement_timeout='5min';
    SET idle_in_transaction_session_timeout='1min'; SET idle_session_timeout='5min';
    SET search_path=public; SET default_transaction_read_only=off;`;
  const checkPolicy = () => JSON.parse(query(`${setupSql}
    SELECT row_to_json(policy) FROM (${policySql.replaceAll("$1", `'${owner}'`)}) policy;`,
    "schema_app", schemaLogin).split("\n").at(-1));
  const assertSafe = () => {
    for (const [name, safe] of Object.entries(checkPolicy())) assert.equal(safe, true, name);
  };
  assertSafe();
  query(`${setupSql}
    CREATE TYPE public.content_visibility AS ENUM ('private','public','unlisted');
    ALTER TABLE contents ALTER COLUMN visibility DROP DEFAULT;
    ALTER TABLE contents ALTER COLUMN visibility TYPE public.content_visibility
      USING visibility::text::public.content_visibility;
    ALTER TABLE contents ALTER COLUMN visibility SET DEFAULT 'public'::public.content_visibility;
    CREATE TABLE public.new_content(id int);
    INSERT INTO public.new_content VALUES (3);`, "schema_app", schemaLogin);
  assert.equal(query("SELECT count(*) FROM contents; SELECT count(*) FROM new_content;", "schema_app", "schema_app"), "2\n1");
  assert.equal(savedAccess(), saved, "Schema execution rewrote existing access or ownership");
  assertSafe(); // another physical connection preserves and revalidates the owner
  query(`ALTER ROLE ${owner} CREATEDB;`, "schema_app");
  assert.equal(checkPolicy().safe_login_role, false);
  query(`ALTER ROLE ${owner} NOCREATEDB; GRANT pg_read_all_data TO ${owner};`, "schema_app");
  assert.equal(checkPolicy().exact_membership, false);
  query(`REVOKE pg_read_all_data FROM ${owner};
    GRANT ${owner} TO "${schemaLogin}" WITH ADMIN OPTION;`, "schema_app");
  assert.equal(checkPolicy().exact_membership, false);
  query(`REVOKE ADMIN OPTION FOR ${owner} FROM "${schemaLogin}";`, "schema_app");
  assertSafe();
  assert.equal(savedAccess(), saved);
  console.log("PASS: delegated schema owner, enum migration, future application reads, repeated connection checks and authority drift rejection");

} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(scratch, { recursive: true, force: true });
}
