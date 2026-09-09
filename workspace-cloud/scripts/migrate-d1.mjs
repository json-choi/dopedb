// Bind the exact checked-in migration bytes to each atomic D1 migration receipt.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, isAbsolute } from "node:path";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const migrationDirectory = resolve(cwd, "d1-migrations");

export function verifyD1MigrationPrefix(files, receipts, appliedNames) {
  if (receipts.length !== appliedNames.length || receipts.length > files.length) {
    throw new Error("D1 migration history is incomplete or belongs to another baseline");
  }
  for (let i = 0; i < receipts.length; i += 1) {
    if (receipts[i].file !== files[i].name || receipts[i].sha256 !== files[i].sha256
      || appliedNames[i] !== files[i].name) {
      throw new Error("D1 migration bytes or ordering differ from the deployed history");
    }
  }
  return files.length - receipts.length;
}

async function readMigrations() {
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (names.length === 0) throw new Error("No D1 migrations found");
  return Promise.all(names.map(async (name, index) => {
    if (Number(name.slice(0, 4)) !== index) throw new Error("D1 migration sequence has a gap");
    const source = await readFile(resolve(migrationDirectory, name), "utf8");
    return { name, source, sha256: createHash("sha256").update(source).digest("hex") };
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const checkOnly = args.includes("--check");
  const stateIndex = args.indexOf("--persist-to");
  const stateValue = stateIndex >= 0 ? args[stateIndex + 1] : undefined;
  const flags = args.filter((_, index) => stateIndex < 0 || (index !== stateIndex && index !== stateIndex + 1));
  if (flags.some((arg) => !["--check", "--local"].includes(arg)) || new Set(flags).size !== flags.length
    || args.filter((arg) => arg === "--persist-to").length > 1
    || (stateIndex >= 0 && (!local || !stateValue || !isAbsolute(stateValue)))) {
    throw new Error("Usage: node scripts/migrate-d1.mjs [--check] [--local [--persist-to /absolute/local/state]]");
  }
  const localState = stateValue ?? resolve(cwd, ".wrangler/state");
  await mkdir(resolve(cwd, ".wrangler"), { recursive: true });
  const config = JSON.parse(await readFile(resolve(cwd, "wrangler.jsonc"), "utf8"));
  const binding = config.d1_databases?.find((entry) => entry.binding === "WORKSPACE_DB");
  if (!binding || binding.database_name !== "dopedb-workspace" || !/^[a-f0-9-]{36}$/.test(binding.database_id)) {
    throw new Error("Workspace D1 deployment binding is not configured");
  }
  function wrangler(parameters, configPath = resolve(cwd, "wrangler.jsonc"), json = true) {
    const child = spawnSync("pnpm", ["exec", "wrangler", ...parameters, "--config", configPath], {
      cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CI: "true" },
    });
    if (child.status !== 0) {
      writeFileSync(resolve(cwd, ".wrangler/d1-migration-error.log"), child.stdout + child.stderr, { mode: 0o600 });
      throw new Error(`D1 ${parameters[0]} step failed; inspect the local .wrangler/d1-migration-error.log`);
    }
    if (!json) return child.stdout;
    const start = child.stdout.search(/^[\t ]*[\[{][\t ]*$/m);
    if (start < 0) throw new Error("Wrangler did not return a JSON receipt");
    return JSON.parse(child.stdout.slice(start));
  }
  if (!local) {
    const identity = wrangler(["whoami", "--json"]);
    if (!identity.loggedIn || !identity.accounts?.some((account) => account.id === config.account_id)) {
      throw new Error("Active Wrangler account does not match the Workspace account");
    }
  }
  const query = (sql) => {
    const result = wrangler(["d1", "execute", "WORKSPACE_DB", local ? "--local" : "--remote", ...(local ? ["--persist-to", localState] : []), "--command", sql, "--json"]);
    if (result.length !== 1 || !result[0].success) throw new Error("D1 preflight query failed");
    return result[0].results;
  };
  const files = await readMigrations();
  const tables = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name");
  let receipts = [];
  let appliedNames = [];
  if (tables.some((table) => table.name === "workspace_schema_migration")) {
    receipts = query("SELECT file, sha256 FROM workspace_schema_migration ORDER BY file");
    appliedNames = query("SELECT name FROM d1_migrations ORDER BY id").map((row) => row.name);
  } else if (tables.length > 0) {
    throw new Error("Existing D1 database lacks a verified migration ledger; refusing automatic adoption or reset");
  }
  const pending = verifyD1MigrationPrefix(files, receipts, appliedNames);
  console.log(`D1 migration preflight passed: ${receipts.length} applied, ${pending} pending.`);
  if (checkOnly || pending === 0) return;
  await mkdir(resolve(cwd, ".wrangler"), { recursive: true });
  const temporary = await mkdtemp(resolve(cwd, ".wrangler/d1-migrations-"));
  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const ledger = i === 0 ? `CREATE TABLE workspace_schema_migration (
        file TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );\n` : "";
      await writeFile(resolve(temporary, file.name), ledger + file.source
        + `\nINSERT INTO workspace_schema_migration (file, sha256) VALUES ('${file.name}', '${file.sha256}');\n`);
    }
    const temporaryConfig = resolve(temporary, "wrangler.jsonc");
    await writeFile(temporaryConfig, JSON.stringify({
      name: config.name, account_id: config.account_id, compatibility_date: config.compatibility_date,
      d1_databases: [{ ...binding, migrations_dir: temporary }],
    }));
    if (!local) {
      const identity = wrangler(["whoami", "--json"], temporaryConfig);
      if (!identity.accounts?.some((account) => account.id === config.account_id)) {
        throw new Error("Migration staging resolved a different Wrangler account");
      }
    }
    wrangler(["d1", "migrations", "apply", "WORKSPACE_DB", local ? "--local" : "--remote", ...(local ? ["--persist-to", localState] : [])], temporaryConfig, false);
    receipts = query("SELECT file, sha256 FROM workspace_schema_migration ORDER BY file");
    appliedNames = query("SELECT name FROM d1_migrations ORDER BY id").map((row) => row.name);
    if (verifyD1MigrationPrefix(files, receipts, appliedNames) !== 0) throw new Error("D1 migration receipt is incomplete");
    console.log(`D1 migrations verified: ${receipts.length} exact file receipts.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    console.error(error instanceof Error ? error.message : "D1 migration failed");
    process.exitCode = 1;
  }
}
