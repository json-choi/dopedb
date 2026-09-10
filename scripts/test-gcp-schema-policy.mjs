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

} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  rmSync(scratch, { recursive: true, force: true });
}
