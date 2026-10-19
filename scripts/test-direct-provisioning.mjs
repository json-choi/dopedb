#!/usr/bin/env node
// Prove the real direct-access PostgreSQL/MySQL target adapters against throwaway Docker servers.
// Role: end-to-end verification outside the 208-test budget. It starts postgres:16 and mysql:8.4 on
// random loopback ports with generated passwords, seeds an existing application, drives the
// feature-gated `direct_access_e2e` example (the production planner, verifier, ownership proof and
// sqlx session code), and fails if anything other than the DopeDB principal's own rows changes.
// No cloud credentials, application data, or existing database are used; containers are removed
// on exit.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const secrets = new Set();
const secret = () => {
  const value = randomBytes(18).toString("base64url");
  secrets.add(value);
  return value;
};
const redact = (text) => [...secrets].reduce((out, value) => out.split(value).join("***"), String(text ?? ""));
const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
const fail = (message) => {
  console.error(redact(message));
  process.exit(1);
};

if (run("docker", ["info"]).status !== 0) fail("Docker is not reachable; start it (for example colima) and retry.");

// ---------- build the driver ----------
const metadata = run("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
  cwd: path.join(root, "src-tauri"),
});
if (metadata.status !== 0) fail("cargo metadata failed");
const targetDir = JSON.parse(metadata.stdout).target_directory;
const build = run("cargo", ["build", "--example", "direct_access_e2e", "--features", "direct-access-e2e"], {
  cwd: path.join(root, "src-tauri"),
  stdio: ["ignore", "inherit", "inherit"],
});
if (build.status !== 0) fail("building the direct-access-e2e driver failed");
const driverBinary = path.join(targetDir, "debug", "examples", "direct_access_e2e");

// ---------- containers ----------
const containers = [];
const removeContainers = () => {
  for (const name of containers.splice(0)) run("docker", ["rm", "-f", name]);
};
process.on("exit", removeContainers);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

const startContainer = (kind, image, envs, internalPort) => {
  const name = `dopedb-e2e-${kind}-${randomBytes(4).toString("hex")}`;
  const port = randomInt(20000, 60000);
  const args = ["run", "-d", "--name", name, "-p", `127.0.0.1:${port}:${internalPort}`];
  for (const [key, value] of Object.entries(envs)) args.push("-e", `${key}=${value}`);
  const started = run("docker", [...args, image]);
  if (started.status !== 0) fail(`starting ${image} failed: ${started.stderr}`);
  containers.push(name);
  return { name, port };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (probe, label) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (probe()) return;
    await sleep(1000);
  }
  fail(`${label} did not become ready`);
};

// ---------- result bookkeeping ----------
const results = [];
const lingering = [];
let current = null;
const check = (label, condition, detail = "") => {
  current.checks += 1;
  if (!condition) current.failures.push(`${label}${detail ? ` -> ${redact(detail)}` : ""}`);
};
const scenarioRun = async (engine, name, body) => {
  current = { engine: engine.name, name, checks: 0, failures: [] };
  results.push(current);
  try {
    const before = engine.snapshot();
    await body();
    const after = engine.snapshot();
    check("existing state identical except the principal's own rows", before === after, diffLines(before, after));
    for (const [label, sql] of engine.appReads()) {
      const read = engine.member(label.user, label.password, sql);
      check(`application role ${label.user} still reads (${label.what})`, read.ok, JSON.stringify(read));
    }
  } catch (error) {
    current.failures.push(`threw: ${redact(error?.stack ?? error)}`);
  }
};
const diffLines = (before, after) => {
  const a = new Set(before.split("\n"));
  const b = new Set(after.split("\n"));
  return [...a].filter((line) => !b.has(line)).map((l) => `- ${l}`).concat([...b].filter((line) => !a.has(line)).map((l) => `+ ${l}`)).slice(0, 8).join(" | ");
};

// ---------- driver calls ----------
const driverEnv = (admin, memberPassword) => ({
  ...process.env,
  E2E_ADMIN_USER: admin?.user ?? "",
  E2E_ADMIN_PASSWORD: admin?.password ?? "",
  E2E_MEMBER_PASSWORD: memberPassword ?? "",
});
const parseLast = (stdout) => {
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
};
const driver = (engine, request, { admin, memberPassword } = {}) => {
  const result = run(driverBinary, [JSON.stringify({ engine: engine.name, ...engine.endpoint, ...request })], {
    env: driverEnv(admin ?? engine.admins.full, memberPassword),
  });
  if (result.status !== 0) throw new Error(`driver exited ${result.status}: ${redact(result.stderr).slice(0, 400)}`);
  return parseLast(result.stdout);
};
const hold = (engine, principal, sql) => {
  const child = spawn(driverBinary, [JSON.stringify({ engine: engine.name, ...engine.endpoint, cmd: "hold", name: principal.name, sql })], {
    env: driverEnv(null, principal.password),
  });
  let output = "";
  let ready;
  const readyPromise = new Promise((resolve) => (ready = resolve));
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("ready")) ready(true);
  });
  const exited = new Promise((resolve) => child.on("exit", () => resolve(true)));
  child.on("exit", () => ready(false));
  return {
    ready: readyPromise,
    // Resolves to the driver's final report ({ended, code}) or null on timeout.
    outcome: async (timeoutMs) => {
      const done = await Promise.race([exited, sleep(timeoutMs).then(() => false)]);
      if (!done) child.kill();
      try {
        return done ? parseLast(output.replace(/^ready\n/, "")) : null;
      } catch {
        return null;
      }
    },
  };
};

const newPrincipal = () => ({
  name: `dopedb_${randomBytes(10).toString("hex")}`,
  marker: randomBytes(12).toString("base64url"),
  password: secret(),
  identity: undefined,
});
const receipt = (principal, state = "ready", overrides = {}) => ({
  name: principal.name,
  marker: principal.marker,
  identity: principal.identity,
  state,
  ...overrides,
});
const create = (engine, principal, level, options = {}) => {
  const result = driver(
    engine,
    { cmd: "create", scope: engine.scope, level, ...receipt(principal, "requested", { identity: undefined }), ...options.request },
    { admin: options.admin, memberPassword: principal.password },
  );
  if (result.ok) principal.identity = result.identity;
  return result;
};
const change = (engine, principal, from, to, extra = {}) =>
  driver(engine, { cmd: "change", scope: engine.scope, from, to, ...receipt(principal), ...extra.request }, {
    memberPassword: extra.password ?? principal.password,
  });
const drop = (engine, principal, from, overrides = {}, admin = undefined) =>
  driver(engine, { cmd: "drop", scope: engine.scope, from, ...receipt(principal, "ready", overrides) }, {
    admin,
    memberPassword: principal.password,
  });
const login = (engine, principal, sql, scalar = false) => engine.member(principal.name, principal.password, sql, scalar);
const denied = (engine, result) => !result.ok && engine.deniedCodes.includes(String(result.code));
const authFailed = (result) => !result.ok && (String(result.code).startsWith("28") || String(result.code) === "1045");
const exists = (engine, principal) => driver(engine, { cmd: "observe", name: principal.name }).exists;

// ---------- engines ----------
const buildPostgres = async () => {
  const superPassword = secret();
  const { name, port } = startContainer("pg", "postgres:16", { POSTGRES_PASSWORD: superPassword }, 5432);
  const psql = (sql, database = "shop") => {
    const out = run("docker", ["exec", "-i", name, "psql", "-U", "postgres", "-d", database, "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql });
    if (out.status !== 0) throw new Error(`psql failed: ${redact(out.stderr).slice(0, 300)}`);
    return out.stdout.trim();
  };
  await waitFor(() => run("docker", ["exec", name, "psql", "-U", "postgres", "-h", "127.0.0.1", "-c", "select 1"]).status === 0, "postgres");
  const pw = { owner: secret(), reader: secret(), writer: secret(), full: secret(), weak: secret(), none: secret() };
  psql(
    `CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_reader LOGIN PASSWORD '${pw.reader}';
CREATE ROLE app_writer LOGIN PASSWORD '${pw.writer}';
CREATE ROLE dba_admin LOGIN CREATEROLE PASSWORD '${pw.full}';
CREATE ROLE weak_admin LOGIN CREATEROLE PASSWORD '${pw.weak}';
CREATE ROLE no_admin LOGIN PASSWORD '${pw.none}';
CREATE DATABASE shop OWNER app_owner;
COMMENT ON ROLE app_reader IS 'existing application reader';
ALTER ROLE app_writer CONNECTION LIMIT 50;`,
    "postgres",
  );
  psql(
    `REVOKE ALL ON DATABASE shop FROM PUBLIC;
GRANT CONNECT ON DATABASE shop TO app_reader, app_writer, dba_admin, weak_admin, no_admin;
GRANT app_owner TO dba_admin;
ALTER ROLE app_reader IN DATABASE shop SET statement_timeout = '20s';
SET ROLE app_owner;
CREATE SCHEMA sales; CREATE SCHEMA hr; CREATE SCHEMA secret;
CREATE TABLE sales.orders(id serial PRIMARY KEY, note text);
CREATE TABLE hr.people(id serial PRIMARY KEY, note text);
CREATE TABLE secret.keys(id serial PRIMARY KEY, note text);
INSERT INTO sales.orders(note) VALUES ('seed'); INSERT INTO hr.people(note) VALUES ('seed'); INSERT INTO secret.keys(note) VALUES ('seed');
GRANT USAGE ON SCHEMA sales, hr TO app_reader, app_writer;
GRANT USAGE ON SCHEMA sales TO PUBLIC;
REVOKE ALL ON SCHEMA hr FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA hr TO PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA sales, hr TO app_reader;
GRANT ALL ON ALL TABLES IN SCHEMA sales, hr TO app_writer;
GRANT ALL ON ALL SEQUENCES IN SCHEMA sales, hr TO app_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA sales GRANT SELECT ON TABLES TO app_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA sales GRANT ALL ON TABLES TO app_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA sales GRANT USAGE ON SEQUENCES TO app_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA hr GRANT SELECT ON TABLES TO app_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner GRANT EXECUTE ON FUNCTIONS TO app_writer;`,
  );

  const acl = (tag, from, ownerExpr, kind, where = "true") =>
    `SELECT '${tag}|' || ${from.label} || '|' || pg_get_userbyid(${ownerExpr}) || '|' || coalesce(pg_get_userbyid(a.grantor), '') || '|' ||
       CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || '|' || a.privilege_type || '|' || a.is_grantable
     FROM ${from.table}, aclexplode(COALESCE(${from.acl}, acldefault('${kind}', ${ownerExpr}))) a
     WHERE ${where} AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) !~ '^dopedb_')`;
  const snapshotSql = `SELECT line FROM (
SELECT 'role|' || rolname || '|' || rolsuper || rolinherit || rolcreaterole || rolcreatedb || rolcanlogin || rolreplication || rolbypassrls || '|' || rolconnlimit || '|' || coalesce(rolvaliduntil::text, '') || '|' || coalesce(rolpassword, '') AS line FROM pg_authid WHERE rolname !~ '^dopedb_'
UNION ALL SELECT 'member|' || pg_get_userbyid(g.roleid) || '|' || pg_get_userbyid(g.member) || '|' || g.admin_option || g.inherit_option || g.set_option || '|' || pg_get_userbyid(g.grantor)
  FROM pg_auth_members g WHERE pg_get_userbyid(g.roleid) !~ '^dopedb_' AND pg_get_userbyid(g.member) !~ '^dopedb_'
UNION ALL SELECT 'comment|' || r.rolname || '|' || d.description FROM pg_shdescription d JOIN pg_roles r ON r.oid = d.objoid WHERE d.classoid = 'pg_authid'::regclass AND r.rolname !~ '^dopedb_'
UNION ALL SELECT 'setting|' || coalesce(s.setdatabase::text, '') || '|' || coalesce(pg_get_userbyid(nullif(s.setrole, 0)), '') || '|' || array_to_string(s.setconfig, ',') FROM pg_db_role_setting s
UNION ALL ${acl("database", { label: "d.datname", table: "pg_database d", acl: "d.datacl" }, "d.datdba", "d")}
UNION ALL ${acl("schema", { label: "n.nspname", table: "pg_namespace n", acl: "n.nspacl" }, "n.nspowner", "n", "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'")}
UNION ALL SELECT 'object|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
UNION ALL ${acl("relation", { label: "n.nspname || '.' || c.relname", table: "pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace", acl: "c.relacl" }, "c.relowner", "r", "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f','S')")}
UNION ALL SELECT 'defacl|' || coalesce(n.nspname, '') || '|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|' || CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || '|' || a.privilege_type || '|' || a.is_grantable
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a WHERE a.grantee = 0 OR pg_get_userbyid(a.grantee) !~ '^dopedb_'
) s ORDER BY line;`;

  const member = (user, password, sql, scalar = false) =>
    driver({ name: "postgres", endpoint: { host: "127.0.0.1", port, database: "shop" }, admins: {} }, { cmd: scalar ? "scalar" : "exec", name: user, sql }, { admin: { user: "x", password: "x" }, memberPassword: password });
  return {
    name: "postgres",
    endpoint: { host: "127.0.0.1", port, database: "shop" },
    scope: ["sales", "hr"],
    admins: { full: { user: "dba_admin", password: pw.full }, weak: { user: "weak_admin", password: pw.weak }, none: { user: "no_admin", password: pw.none }, inspector: { user: "dba_admin", password: pw.full }, terminator: { user: "dba_admin", password: pw.full } },
    appReader: { user: "app_reader", password: pw.reader },
    deniedCodes: ["42501"],
    snapshot: () => psql(snapshotSql),
    member,
    sql: (sql) => psql(sql),
    asOwner: (sql) => psql(`SET ROLE app_owner; ${sql}`),
    appReads: () => {
      const reads = [
        [{ user: "app_reader", password: pw.reader, what: "sales.orders" }, "SELECT count(*)::text FROM sales.orders"],
        [{ user: "app_reader", password: pw.reader, what: "hr.people" }, "SELECT count(*)::text FROM hr.people"],
        [{ user: "app_writer", password: pw.writer, what: "write sales.orders" }, "UPDATE sales.orders SET note = note"],
      ];
      if (psql("SELECT to_regclass('sales.fresh') IS NOT NULL") === "t") {
        reads.push([{ user: "app_reader", password: pw.reader, what: "sales.fresh (new)" }, "SELECT count(*)::text FROM sales.fresh"]);
      }
      return reads;
    },
    probe: (name) => psql(`SELECT rolcanlogin::text || coalesce(rolpassword, '') || coalesce(shobj_description(oid, 'pg_authid'), '') || has_database_privilege(rolname, 'shop', 'CONNECT') || has_schema_privilege(rolname, 'sales', 'USAGE') || has_table_privilege(rolname, 'sales.orders', 'SELECT') FROM pg_authid WHERE rolname = '${name}'`),
    createForeign: (name, password) => psql(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`),
    grantForeignMembership: (name) => psql(`GRANT app_reader TO ${name}`),
    revokeForeignMembership: (name) => psql(`REVOKE app_reader FROM ${name}`),
    removeForeign: (name) => psql(`DROP ROLE ${name}`),
    newTable: () => psql("SET ROLE app_owner; CREATE TABLE sales.fresh(id int); INSERT INTO sales.fresh VALUES (1)"),
    dropNewTable: () => psql("SET ROLE app_owner; DROP TABLE IF EXISTS sales.fresh"),
    readOne: "SELECT count(*)::text FROM sales.orders",
    readTwo: "SELECT count(*)::text FROM hr.people",
    readFresh: "SELECT count(*)::text FROM sales.fresh",
    outOfScope: ["SELECT count(*)::text FROM secret.keys"],
    insert: "INSERT INTO sales.orders(note) VALUES ('member')",
    update: "UPDATE sales.orders SET note = 'member' WHERE note = 'member'",
    delete: "DELETE FROM sales.orders WHERE note = 'member'",
    ddl: "CREATE TABLE sales.nope(i int)",
    unexpectedScope: ["ghost"],
    ownObject: "CREATE TABLE hr.mine(i int)",
    cleanOwnObject: () => psql("DROP TABLE IF EXISTS hr.mine"),
    ownsObjects: true,
    publicCreateNamespace: "hr",
    wildcardLeak: null,
    cleanup: () => {},
  };
};

const buildMysql = async () => {
  const rootPassword = secret();
  const { name, port } = startContainer("mysql", "mysql:8.4", { MYSQL_ROOT_PASSWORD: rootPassword }, 3306);
  const mysql = (sql) => {
    const out = run("docker", ["exec", "-i", "-e", `MYSQL_PWD=${rootPassword}`, name, "mysql", "-uroot", "-N", "-B", "--raw"], { input: sql });
    if (out.status !== 0) throw new Error(`mysql failed: ${redact(out.stderr).slice(0, 300)}`);
    return out.stdout.trim();
  };
  await waitFor(() => run("docker", ["exec", "-e", `MYSQL_PWD=${rootPassword}`, name, "mysql", "-uroot", "-h127.0.0.1", "-e", "select 1"]).status === 0, "mysql");
  const pw = { owner: secret(), reader: secret(), writer: secret(), full: secret(), weak: secret(), none: secret(), inspector: secret() };
  mysql(
    `CREATE USER 'app_owner'@'%' IDENTIFIED BY '${pw.owner}';
CREATE USER 'app_reader'@'%' IDENTIFIED BY '${pw.reader}' COMMENT 'existing application reader';
CREATE USER 'app_writer'@'%' IDENTIFIED BY '${pw.writer}';
CREATE ROLE 'app_role'@'%';
CREATE DATABASE shop_a; CREATE DATABASE shop_b; CREATE DATABASE shopXa;
CREATE TABLE shop_a.orders(id int AUTO_INCREMENT PRIMARY KEY, note varchar(40));
CREATE TABLE shop_b.people(id int AUTO_INCREMENT PRIMARY KEY, note varchar(40));
CREATE TABLE shopXa.\`keys\`(id int AUTO_INCREMENT PRIMARY KEY, note varchar(40));
INSERT INTO shop_a.orders(note) VALUES ('seed'); INSERT INTO shop_b.people(note) VALUES ('seed'); INSERT INTO shopXa.\`keys\`(note) VALUES ('seed');
GRANT ALL ON shop_a.* TO 'app_owner'@'%';
GRANT SELECT ON shop_a.* TO 'app_role'@'%';
GRANT 'app_role'@'%' TO 'app_reader'@'%';
SET DEFAULT ROLE ALL TO 'app_reader'@'%';
GRANT SELECT ON \`shop\\_b\`.* TO 'app_reader'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_a\`.* TO 'app_writer'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_b\`.* TO 'app_writer'@'%';
CREATE USER 'dba_admin'@'%' IDENTIFIED BY '${pw.full}';
GRANT CREATE USER ON *.* TO 'dba_admin'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_a\`.* TO 'dba_admin'@'%' WITH GRANT OPTION;
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_b\`.* TO 'dba_admin'@'%' WITH GRANT OPTION;
CREATE USER 'weak_admin'@'%' IDENTIFIED BY '${pw.weak}';
GRANT CREATE USER ON *.* TO 'weak_admin'@'%';
GRANT SELECT ON \`shop\\_a\`.* TO 'weak_admin'@'%';
CREATE USER 'no_admin'@'%' IDENTIFIED BY '${pw.none}';
GRANT SELECT ON \`shop\\_a\`.* TO 'no_admin'@'%';
CREATE USER 'inspector'@'%' IDENTIFIED BY '${pw.inspector}';
GRANT CREATE USER, CONNECTION_ADMIN, PROCESS ON *.* TO 'inspector'@'%';
GRANT SELECT ON mysql.* TO 'inspector'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_a\`.* TO 'inspector'@'%' WITH GRANT OPTION;
GRANT SELECT, INSERT, UPDATE, DELETE ON \`shop\\_b\`.* TO 'inspector'@'%' WITH GRANT OPTION;`,
  );

  const excluded = (column) => `${column} NOT REGEXP '^dopedb_'`;
  const snapshotSql = `SELECT * FROM mysql.user WHERE ${excluded("User")} ORDER BY User, Host;
SELECT * FROM mysql.db WHERE ${excluded("User")} ORDER BY User, Host, Db;
SELECT * FROM mysql.tables_priv WHERE ${excluded("User")} ORDER BY User, Host, Db, Table_name;
SELECT * FROM mysql.columns_priv WHERE ${excluded("User")} ORDER BY User, Host, Db, Table_name, Column_name;
SELECT * FROM mysql.procs_priv WHERE ${excluded("User")} ORDER BY User, Host, Db, Routine_name;
SELECT * FROM mysql.proxies_priv WHERE ${excluded("User")} ORDER BY User, Host;
SELECT * FROM mysql.global_grants WHERE ${excluded("USER")} ORDER BY USER, HOST, PRIV;
SELECT * FROM mysql.role_edges WHERE ${excluded("FROM_USER")} AND ${excluded("TO_USER")} ORDER BY 1, 2, 3, 4;
SELECT * FROM mysql.default_roles WHERE ${excluded("USER")} ORDER BY USER, HOST;
SELECT USER, HOST, CAST(ATTRIBUTE AS CHAR) FROM information_schema.USER_ATTRIBUTES WHERE ${excluded("USER")} ORDER BY USER, HOST;
SELECT table_schema, table_name, table_type FROM information_schema.TABLES WHERE table_schema NOT IN ('mysql','sys','information_schema','performance_schema') ORDER BY 1, 2;
SELECT schema_name, default_character_set_name FROM information_schema.SCHEMATA ORDER BY 1;`;

  // sqlx authenticates caching_sha2_password over TLS only, as production endpoints require.
  const endpoint = { host: "127.0.0.1", port, database: "shop_a", sslmode: "required" };
  const stub = { name: "mysql", endpoint, admins: {} };
  const member = (user, password, sql, scalar = false) =>
    driver(stub, { cmd: scalar ? "scalar" : "exec", name: user, sql }, { admin: { user: "x", password: "x" }, memberPassword: password });
  return {
    name: "mysql",
    endpoint,
    scope: ["shop_a", "shop_b"],
    admins: { full: { user: "dba_admin", password: pw.full }, weak: { user: "weak_admin", password: pw.weak }, none: { user: "no_admin", password: pw.none }, inspector: { user: "inspector", password: pw.inspector }, terminator: { user: "inspector", password: pw.inspector } },
    appReader: { user: "app_reader", password: pw.reader },
    deniedCodes: ["1142", "1044"],
    snapshot: () => mysql(snapshotSql),
    member,
    sql: (sql) => mysql(sql),
    asOwner: (sql) => mysql(sql),
    appReads: () => {
      const reads = [
        [{ user: "app_reader", password: pw.reader, what: "shop_a.orders" }, "SELECT CAST(count(*) AS CHAR) FROM shop_a.orders"],
        [{ user: "app_reader", password: pw.reader, what: "shop_b.people" }, "SELECT CAST(count(*) AS CHAR) FROM shop_b.people"],
        [{ user: "app_writer", password: pw.writer, what: "write shop_b.people" }, "UPDATE shop_b.people SET note = note"],
      ];
      if (mysql("SELECT COUNT(*) FROM information_schema.TABLES WHERE table_schema = 'shop_a' AND table_name = 'fresh'") === "1") {
        reads.push([{ user: "app_writer", password: pw.writer, what: "shop_a.fresh (new)" }, "SELECT CAST(count(*) AS CHAR) FROM shop_a.fresh"]);
      }
      return reads;
    },
    probe: (name) =>
      mysql(`SELECT u.plugin, u.authentication_string, u.account_locked, CAST(a.ATTRIBUTE AS CHAR) FROM mysql.user u LEFT JOIN information_schema.USER_ATTRIBUTES a ON a.USER = u.User AND a.HOST = u.Host WHERE u.User = '${name}'`) +
      (mysql(`SELECT COUNT(*) FROM mysql.user WHERE User = '${name}'`) === "1" ? mysql(`SHOW GRANTS FOR '${name}'@'%'`) : ""),
    createForeign: (name, password) => mysql(`CREATE USER '${name}'@'%' IDENTIFIED BY '${password}'`),
    grantForeignMembership: (name) => mysql(`GRANT 'app_role'@'%' TO '${name}'@'%'`),
    revokeForeignMembership: (name) => mysql(`REVOKE 'app_role'@'%' FROM '${name}'@'%'`),
    removeForeign: (name) => mysql(`DROP USER '${name}'@'%'`),
    newTable: () => mysql("CREATE TABLE shop_a.fresh(id int); INSERT INTO shop_a.fresh VALUES (1)"),
    dropNewTable: () => mysql("DROP TABLE IF EXISTS shop_a.fresh"),
    readOne: "SELECT CAST(count(*) AS CHAR) FROM shop_a.orders",
    readTwo: "SELECT CAST(count(*) AS CHAR) FROM shop_b.people",
    readFresh: "SELECT CAST(count(*) AS CHAR) FROM shop_a.fresh",
    // `_` is a single-character wildcard in database grant patterns: shopXa must stay unreadable.
    outOfScope: ["SELECT CAST(count(*) AS CHAR) FROM shopXa.`keys`"],
    insert: "INSERT INTO shop_a.orders(note) VALUES ('member')",
    update: "UPDATE shop_a.orders SET note = 'member' WHERE note = 'member'",
    delete: "DELETE FROM shop_a.orders WHERE note = 'member'",
    ddl: "CREATE TABLE shop_a.nope(i int)",
    unexpectedScope: null,
    ownObject: null,
    cleanOwnObject: () => {},
    ownsObjects: false,
    publicCreateNamespace: null,
    cleanup: () => {},
  };
};

// ---------- scenarios ----------
const scalarOk = (result) => result.ok && Number(result.value) >= 0;

const scenarios = async (engine) => {
  const label = engine.name;

  await scenarioRun(engine, "a. preflight", async () => {
    const full = driver(engine, { cmd: "preflight", scope: engine.scope, write: true });
    check("full admin: preflight ok", full.ok, JSON.stringify(full));
    check("version reported", /^\d+\.\d+\.\d+$/.test(full.version ?? ""), full.version);
    check("full admin can create principals", full.canCreatePrincipal === true);
    const byName = Object.fromEntries((full.namespaces ?? []).map((n) => [n.name, n]));
    check("every scope namespace is grantable", engine.scope.every((n) => byName[n]?.grantable === true), JSON.stringify(full.namespaces));
    if (engine.publicCreateNamespace) {
      check("public_create warning raised", (full.warnings ?? []).includes("public_create"), JSON.stringify(full.warnings));
      check("public_create flagged only on the PUBLIC-writable schema", byName[engine.publicCreateNamespace]?.publicCreate === true && byName.sales?.publicCreate === false);
    } else {
      check("no public_create warning", !(full.warnings ?? []).includes("public_create"));
      check("wildcard-matching database is not grantable", byName.shopXa?.grantable !== true, JSON.stringify(byName.shopXa));
    }
    check("no grantor warning for the full admin", !(full.warnings ?? []).includes("grantor_insufficient"));
    const weak = driver(engine, { cmd: "preflight", scope: engine.scope, write: true }, { admin: engine.admins.weak });
    check("under-privileged admin can create but is not a grantor", weak.ok && weak.canCreatePrincipal === true && (weak.warnings ?? []).includes("grantor_insufficient"), JSON.stringify(weak));
    const none = driver(engine, { cmd: "preflight", scope: engine.scope, write: false }, { admin: engine.admins.none });
    check("admin without create rights is reported", none.ok && none.canCreatePrincipal === false, JSON.stringify(none));
    const bad = driver(engine, { cmd: "preflight", scope: engine.scope, write: false }, { admin: { user: engine.admins.full.user, password: "wrong-password" } });
    check("wrong admin password -> credential_missing", !bad.ok && bad.code === "credential_missing", JSON.stringify(bad));
  });

  const p1 = newPrincipal();
  await scenarioRun(engine, "b+c. create, change, regrant", async () => {
    const made = create(engine, p1, "read");
    check("create read principal", made.ok && made.identity, JSON.stringify(made));
    const one = login(engine, p1, engine.readOne, true);
    check("principal logs in with the member password and SELECTs scope 1", scalarOk(one), JSON.stringify(one));
    check("principal SELECTs scope 2", scalarOk(login(engine, p1, engine.readTwo, true)));
    for (const sql of engine.outOfScope) {
      const out = login(engine, p1, sql, true);
      check("out-of-scope object denied", denied(engine, out), JSON.stringify(out));
    }
    const insert = login(engine, p1, engine.insert);
    check("read principal: INSERT denied", denied(engine, insert), JSON.stringify(insert));
    const ddl = login(engine, p1, engine.ddl);
    check("read principal: DDL denied", denied(engine, ddl), JSON.stringify(ddl));
    const bad = engine.member(p1.name, "not-the-password", engine.readOne, true);
    check("wrong member password rejected", authFailed(bad), JSON.stringify(bad));

    const raise = change(engine, p1, "read", "write");
    check("read -> write", raise.ok, JSON.stringify(raise));
    check("write: INSERT", login(engine, p1, engine.insert).ok);
    check("write: UPDATE", login(engine, p1, engine.update).ok);
    check("write: DELETE", login(engine, p1, engine.delete).ok);
    const wddl = login(engine, p1, engine.ddl);
    check("write principal: DDL still denied", denied(engine, wddl), JSON.stringify(wddl));

    const lower = change(engine, p1, "write", "read");
    check("write -> read", lower.ok, JSON.stringify(lower));
    const again = login(engine, p1, engine.insert);
    check("back at read: INSERT denied again", denied(engine, again), JSON.stringify(again));
    check("back at read: SELECT still works", scalarOk(login(engine, p1, engine.readOne, true)));

    engine.newTable();
    const before = login(engine, p1, engine.readFresh, true);
    if (engine.name === "postgres") {
      check("PG: table created after the grant is invisible", denied(engine, before), JSON.stringify(before));
      const regrant = change(engine, p1, "read", "read");
      check("PG: same-level regrant", regrant.ok, JSON.stringify(regrant));
      check("PG: new table visible after regrant", scalarOk(login(engine, p1, engine.readFresh, true)));
    } else {
      check("MySQL: new table visible immediately", scalarOk(before), JSON.stringify(before));
    }

    const rotatedPassword = secret();
    const rotated = change(engine, p1, "read", "read", { request: { rotate: true }, password: rotatedPassword });
    check("verifier rotation", rotated.ok, JSON.stringify(rotated));
    const oldPassword = engine.member(p1.name, p1.password, engine.readOne, true);
    check("old password rejected after rotation", authFailed(oldPassword), JSON.stringify(oldPassword));
    p1.password = rotatedPassword;
    check("new password works after rotation", scalarOk(login(engine, p1, engine.readOne, true)));
    const app = engine.member(engine.appReader.user, engine.appReader.password, engine.readFresh, true);
    check("existing application role reads the newly created table", scalarOk(app), JSON.stringify(app));
    engine.dropNewTable();
  });

  // `lingerAllowed` marks the documented MySQL limit: without PROCESS + CONNECTION_ADMIN the
  // administrator cannot find or kill the member's open connection, which keeps the db-level
  // privileges it cached at login; the account is locked and dropped so no new login works.
  const revokeWhileConnected = async (title, admin, expectTerminated, lingerAllowed = false) => {
    await scenarioRun(engine, title, async () => {
      const victim = newPrincipal();
      const made = create(engine, victim, "read");
      check("principal created", made.ok, JSON.stringify(made));
      const session = hold(engine, victim, engine.readOne);
      check("principal session opened", await session.ready);
      const dropped = driver(engine, { cmd: "drop", scope: engine.scope, from: "read", ...receipt(victim) }, { admin, memberPassword: victim.password });
      check("drop principal", dropped.ok, JSON.stringify(dropped));
      const outcome = await session.outcome(20000);
      if (!lingerAllowed) check("open session can no longer read", outcome?.ended === true, JSON.stringify(outcome));
      if (expectTerminated) {
        // PostgreSQL reports a terminated backend as 57P01, MySQL as a closed connection.
        check("open session terminated by the server", ["transport", "57P01"].includes(outcome?.code), JSON.stringify(outcome));
      }
      if (lingerAllowed && outcome === null) lingering.push(`${engine.name}: open session outlived the drop`);
      const after = login(engine, victim, engine.readOne, true);
      check("new login refused", authFailed(after), JSON.stringify(after));
      check("principal gone from the server", !exists(engine, victim));
    });
  };
  await revokeWhileConnected("d. revoke ends open session", engine.admins.terminator, true);
  if (engine.admins.terminator.user !== engine.admins.full.user) {
    // Without PROCESS/CONNECTION_ADMIN the session cannot be ended, but it must have lost access.
    await revokeWhileConnected("d2. revoke without session-kill rights", engine.admins.full, false, true);
  }

  await scenarioRun(engine, "e. ownership refusals", async () => {
    // Pre-existing object with the generated name and no marker.
    const foreign = newPrincipal();
    engine.createForeign(foreign.name, foreign.password);
    const probeBefore = engine.probe(foreign.name);
    foreign.identity = undefined;
    const taken = create(engine, foreign, "read");
    check("create over a foreign same-name principal -> name_conflict", !taken.ok && taken.code === "name_conflict", JSON.stringify(taken));
    const foreignDrop = drop(engine, { ...foreign, identity: "0" }, "read");
    check("drop of an unmarked principal refused", !foreignDrop.ok && foreignDrop.code === "name_conflict", JSON.stringify(foreignDrop));
    check("foreign principal untouched", engine.probe(foreign.name) === probeBefore && probeBefore !== "");
    engine.removeForeign(foreign.name);

    const owned = newPrincipal();
    const made = create(engine, owned, "read");
    check("create principal for refusal tests", made.ok, JSON.stringify(made));
    const mark = change(engine, owned, "read", "none", { request: { marker: randomBytes(12).toString("base64url") } });
    check("marker mismatch -> marker_mismatch", !mark.ok && mark.code === "marker_mismatch", JSON.stringify(mark));
    const wrongIdentity = drop(engine, owned, "read", { identity: engine.name === "postgres" ? "999999" : "00000000-0000-0000-0000-000000000000" });
    check("identity mismatch -> oid_mismatch", !wrongIdentity.ok && wrongIdentity.code === "oid_mismatch", JSON.stringify(wrongIdentity));
    check("refused principal still works", scalarOk(login(engine, owned, engine.readOne, true)));

    engine.grantForeignMembership(owned.name);
    const member = drop(engine, owned, "read", {}, engine.admins.inspector);
    check("foreign membership -> unexpected_membership", !member.ok && member.code === "unexpected_membership", JSON.stringify(member));
    check("principal not dropped after membership refusal", exists(engine, owned));
    engine.revokeForeignMembership(owned.name);

    if (engine.ownsObjects) {
      const mine = login(engine, owned, engine.ownObject);
      check("principal can create in the PUBLIC-writable schema (the warned risk)", mine.ok, JSON.stringify(mine));
      const owns = drop(engine, owned, "read");
      check("owned object -> owns_objects", !owns.ok && owns.code === "owns_objects", JSON.stringify(owns));
      check("principal not dropped when it owns objects", exists(engine, owned));
      engine.cleanOwnObject();
    }
    const finalDrop = drop(engine, owned, "read");
    check("drop succeeds once proven and clean", finalDrop.ok, JSON.stringify(finalDrop));
    check("principal gone", !exists(engine, owned));
  });

  await scenarioRun(engine, "f. failed provision leaves nothing", async () => {
    const noRights = newPrincipal();
    const refused = create(engine, noRights, "read", { admin: engine.admins.none });
    check("admin without create right -> permission_denied", !refused.ok && refused.code === "permission_denied", JSON.stringify(refused));
    check("nothing created by the refused admin", !exists(engine, noRights));

    const partial = newPrincipal();
    if (engine.unexpectedScope) {
      const ghost = create(engine, partial, "read", { request: { scope: [...engine.scope, ...engine.unexpectedScope] } });
      check("missing schema in the plan fails", !ghost.ok, JSON.stringify(ghost));
      check("PostgreSQL transaction rolled the role back", !exists(engine, partial));
    }
    const weakPrincipal = newPrincipal();
    const weak = create(engine, weakPrincipal, "read", { admin: engine.admins.weak });
    if (weak.ok) {
      // A grantor that cannot grant must not produce a principal that silently has no access.
      const read = login(engine, weakPrincipal, engine.readOne, true);
      check("insufficient grantor: the create reported ok only if access really exists", scalarOk(read), JSON.stringify(read));
    } else {
      check("insufficient grantor: provision refused", true);
    }
    check("insufficient grantor leaves no partial principal", !exists(engine, weakPrincipal));
  });
};

// ---------- main ----------
const engines = [];
try {
  engines.push(await buildPostgres());
  engines.push(await buildMysql());
  for (const engine of engines) await scenarios(engine);
} catch (error) {
  console.error(redact(error?.stack ?? error));
  process.exitCode = 1;
} finally {
  removeContainers();
}

const width = Math.max(...results.map((r) => `${r.engine} ${r.name}`.length), 10);
console.log("\nresult  scenario".padEnd(width + 12) + "checks");
let failed = 0;
for (const r of results) {
  const ok = r.failures.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}    ${`${r.engine} ${r.name}`.padEnd(width)}  ${r.checks - r.failures.length}/${r.checks}`);
  for (const line of r.failures) console.log(`          - ${redact(line)}`);
}
for (const note of lingering) console.log(`\nNOTE ${note} (admin lacks PROCESS + CONNECTION_ADMIN; documented limit)`);
console.log(failed === 0 && process.exitCode !== 1 ? "\nAll direct provisioning scenarios passed." : `\n${failed} scenario(s) failed.`);
process.exit(failed === 0 && process.exitCode !== 1 ? 0 : 1);
